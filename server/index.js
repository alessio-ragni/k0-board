import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import * as db from './db.js'
import { allowed } from './guard.js'
import { ROOT } from './paths.js'
import { readLiveSessions, deriveStatus, forgetSession, renameSession, busy } from './watcher.js'
import {
  launch,
  focusWindow,
  sessionName,
  closeTerminal,
  setWindowTitle,
  applyModeToWindows,
  relayoutWindows,
} from './launcher.js'
import * as mode from './mode.js'
import * as settings from './settings.js'
import { dueForClose } from './idle.js'
import { listProjects, onDisk, projectName, rootOf } from './projects.js'
import { scanSessions } from './sessions.js'
import * as git from './git.js'
import * as changelog from './changelog.js'
import * as writer from './writer.js'
import * as files from './files.js'
import * as pdf from './pdf.js'
import * as machine from './machine.js'
import * as servers from './servers.js'
import * as backlog from './backlog.js'
import * as mirror from './mirror.js'
import * as worktree from './worktree.js'
import * as update from './update.js'
import { report as platformReport, capabilities, why } from '../platform/index.js'
// The same front-matter reader the viewer uses: the PDF has to be called what the page is
// called, and two different readings of the same header would give two different names.
import { matter, titleOf } from '../web/md.js'

const WEB = path.join(ROOT, 'web')
const PORT = Number(process.env.K0_PORT || 4319)

// ── The watching loop ────────────────────────────────────────────────────────
// Runs with the tab closed too, so the history of statuses has no holes.
let rounds = 0
function tick() {
  const live = readLiveSessions()
  const dirs = new Set()
  for (const story of db.listStories()) {
    const { status, alive } = deriveStatus(story, live)
    // The session has just gone out: now that nobody is rewriting the transcript any more, we
    // put in it the name the story has today. That is how a rename made while the session was
    // running still reaches the list of sessions you can resume.
    if (story.session_id && story.session_alive && !alive) {
      renameSession(story.project_path, story.session_id, sessionName(story.title))
    }
    db.applyDerivedStatus(story.id, status, alive)

    // Where it is really working: with an isolated worktree that is not the repository, and a
    // worktree has a working tree of its own. Claude Code's session file tells us, the same
    // source the statuses come from. It is kept after the session ends too: if the worktree is
    // still sitting there with work in it, the story has to be able to say so.
    //
    // Only when k0 has nothing better, and that condition is the whole of it. `worktree.js`
    // writes `work_path` itself the moment it opens one, and the cwd Claude Code reports is the
    // directory the TERMINAL was started in — the repository. Adopting it unconditionally meant
    // this loop overwrote a worktree one second after it was made, and then the merge at the end
    // would have committed in the base repository instead. Two writers, one column, once a
    // second. A path that is no longer on disk is not better than nothing, so that one is
    // replaced: a worktree removed by hand leaves the story free to learn where it is now.
    const cwd = story.session_id ? live.get(story.session_id)?.cwd : null
    const stale = story.work_path && !fs.existsSync(story.work_path)
    if (cwd && cwd !== story.work_path && cwd !== story.project_path && (!story.work_path || stale)) {
      db.setWorkPath(story.id, cwd)
    }
    dirs.add(story.project_path)
    dirs.add(cwd || story.work_path)
  }
  // The last column lists every repository with its git mark. They are only looked at while
  // the board is open, and slowly: see `watch` in git.js.
  git.watch([...dirs], Date.now() - lastBoard < 15000 ? listProjects().map((p) => p.path) : [])

  // The power levers are checked once a minute rather than every round: reading the power
  // state costs processes, and the things it has to follow — the mains plugged in or out, the
  // battery going down — do not change from one second to the next.
  if (rounds % 60 === 0) mode.guard()
  // The forgotten terminals, on the same cadence but half a minute off it, so the two jobs that
  // only run once a minute never land in the same second as each other.
  if (rounds % 60 === 30) sweepIdle(live)
  // The one request k0 makes. Once an hour is how often it is OFFERED: `check` asks npm at most
  // once a day and answers out of what it already knows the rest of the time, and it never
  // rejects — a laptop with no network simply leaves the board saying nothing about updates.
  if (rounds % 3600 === 45) update.check()
  rounds++
}

/**
 * Gives back the memory of the windows you have stopped using.
 *
 * It does exactly what the `Close` link on a post-it does, and on purpose the same three moves
 * and not a path of its own: stop the session, shut the window, forget the window. The story
 * stays where it is with the status it had, the session is untouched, and `Resume` picks the
 * conversation up where it was — a closed terminal is not a lost session.
 *
 * Deliberately not awaited by `tick`: closing a terminal waits up to two seconds for the process
 * to go, and the watching loop must not be held up by it. Hence the latch, the same one
 * `machine.js` and `servers.js` keep for their own sampling — `setInterval` will happily start a
 * second round on top of the first.
 */
let sweeping = false
async function sweepIdle(live) {
  if (sweeping) return
  const hours = settings.read().closeIdleTerminalsAfterHours
  const due = dueForClose({ stories: db.listStories(), live, hours })
  if (!due.length) return
  sweeping = true
  try {
    for (const story of due) {
      try {
        await closeTerminal({ winId: story.terminal_window_id, pid: live.get(story.session_id)?.pid })
        db.setTerminalWindow(story.id, null) // that window is gone; Resume opens a new one
        db.setAutoClosed(story.id, true)
        console.log(`k0 — "${story.title}" sat still for ${hours}h: its terminal is closed, Resume picks it up`)
      } catch (err) {
        // One window that refuses to go must not take the others with it, and must certainly not
        // take the server: nothing is awaiting this, so a rejection escaping here would end the
        // process outright. It runs unattended — the next round is the retry.
        console.error(`k0 — could not close the terminal of "${story.title}": ${String(err?.message || err)}`)
      }
    }
  } finally {
    sweeping = false
  }
}

/** When somebody last looked at the board. */
let lastBoard = 0
setInterval(tick, 1000)

// ── API ──────────────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
}

const send = (res, code, body) => {
  const json = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(json)
}

const clamp = (raw, fallback, min, max) => {
  const n = Math.floor(Number(raw))
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, n)) : fallback
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 1e6) reject(new Error('Request body too large'))
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (e) {
        reject(e)
      }
    })
  })

/** The list of unpushed commits is only needed in here: the board just wants the count. */
const publicGit = (s) => (s ? { branch: s.branch, dirty: s.dirty, unpushed: s.unpushed, remote: s.remote } : null)

/**
 * A story's git state. A session with a worktree of its own has a working tree of its own, and
 * that is its truth; the others share the repository's working tree, which belongs to
 * everybody — there, the only thing that really belongs to the session is the commits made
 * since it started, and those are counted from `head_at_start`.
 */
function storyGit(story) {
  const own = story.work_path && story.work_path !== story.project_path ? git.stateOf(story.work_path) : null
  if (own) return { ...publicGit(own), own: true, where: path.basename(story.work_path), mine: own.unpushed }
  const repo = git.stateOf(story.project_path)
  if (!repo) return null
  return { ...publicGit(repo), own: false, where: null, mine: git.sessionShare(repo.shas, story.head_at_start) }
}

/**
 * What the backlog adds to a post-it: which epic it belongs to, whether anything it is waiting
 * for is still open, and the one thing to do with it next.
 *
 * The key, the star and the live session are not here because they are already on the row —
 * `db.listStories` flattens the session onto the story so the board draws the same dot it has
 * always drawn — and one fact under two names is two facts that will one day disagree. What is
 * added is only what somebody would otherwise have to count.
 */
function backlogPart(story, epics, decided) {
  const epic = story.epic_id ? epics.get(story.epic_id) : null
  const deps = db.dependenciesOf(story.id)
  return {
    epic_key: epic?.key ?? null,
    epic_title: epic?.title ?? null,
    deps: deps.map((d) => ({ id: d.id, key: d.key, title: d.title, state: d.state })),
    blocked: deps.some((d) => d.state !== 'Done'),
    // The one thing to do with it next: the button on the post-it and the one at the end of every
    // list row. Worked out where everything else on this row is worked out — it is the same
    // function `publicStory` calls, so a post-it, a row and the story's own panel cannot suggest
    // two different things about the same story. `decided` is counted once for the whole board and
    // handed in, because otherwise this is four queries per story, once a second, per open tab.
    next_step: backlog.nextStep(story, { decided: decided.has(story.id) }),
  }
}

function board() {
  // Looking at the board is the only thing that switches the load measurement on: reading the
  // process table costs, and with the tab closed nobody would be looking. See machine.js.
  machine.touch()
  lastBoard = Date.now()
  const live = readLiveSessions()

  // With the backlog switched off the board is the board it has always been: not a story here
  // carries a field it did not carry before, and there is no lane to enter. The switch is read
  // once, here, rather than left to each of the three places below to remember.
  const on = backlog.enabled()
  const all = db.listStories()
  const allEpics = on ? db.listEpics() : []
  const epicById = new Map(allEpics.map((e) => [e.id, e]))
  // Which stories anything has been decided about, for the whole board in one question. It is the
  // one fact `nextStep` needs that is not on the row it is handed, and asking it story by story is
  // what turns "what do I do next" into four hundred statements a second.
  const decided = on ? db.decidedStories() : new Set()

  const stories = onDisk(all).map((s) => ({
    ...s,
    project_name: projectName(s.project_path),
    git: storyGit(s),
    load: machine.loadOf(live.get(s.session_id)?.pid),
    ...(on ? backlogPart(s, epicById, decided) : null),
  }))
  const paths = [...new Set(stories.map((s) => s.project_path))]
  // And the same for the dev servers: looking at the board is what makes k0 ask the machine
  // who is listening, and it asks only about the repositories in front of you.
  servers.touch(paths)

  // Live sessions no story claims: they weigh the same, and if the computer is struggling it is
  // fair to know there are three of them open outside here.
  const onBoard = new Set(stories.map((s) => s.session_id).filter(Boolean))
  const outside = [...live.keys()].filter((sid) => !onBoard.has(sid)).length

  return {
    // The columns are the projects with at least one story — and that still exist: a story is
    // kept alive by its directory (see `onDisk` in projects.js).
    columns: paths
      .map((p) => ({
        path: p,
        name: projectName(p),
        git: publicGit(git.stateOf(p)),
        // Null where the repository has no way to start a server: then there is no globe at
        // all, rather than one that would do nothing.
        server: servers.stateOf(p),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    stories,
    // The repositories for the last column, the one you go through to reach the files of a
    // directory that has no stories at all. Real projects only: the directories under your home
    // that are just installed software do not belong (see `known` in projects.js).
    projects: listProjects()
      .filter((p) => p.known)
      .map((p) => ({ ...p, git: publicGit(git.stateOf(p.path)) })),
    machine: { ...machine.overview([...live.values()].map((s) => s.pid)), alive: live.size, outside },
    // What colour the icon in the tab should be: the same thing /api/status tells the icon in
    // the menu bar.
    urgent: attention(stories).urgent,
    // Which mode we are in. It travels in here rather than on an address of its own because
    // the board already makes this round every second: a second address to poll would only be
    // another way of finding out the same thing later.
    //
    // `mode` is what you want; `lid` is what the machine is actually doing. They are two
    // different things — a mode can be on without the lid block holding — and the board has to
    // be able to tell you both.
    mode: mode.current(),
    lid: mode.lid(),
    reason: mode.reason(),
    // After how long a forgotten terminal is closed, so the machine chip can say that it is
    // watching and after how long. Zero means it is switched off, and then the chip says nothing
    // rather than saying "0h" — a number that would read as "closes immediately".
    closeIdleAfterHours: settings.read().closeIdleTerminalsAfterHours,
    // What this machine can and cannot do, so the board greys out the rest and says why
    // instead of offering a button that quietly does nothing.
    platform: platformReport(),
    // Whether the discreet mark next to `k0` should be there, and nothing more than that: the
    // version the user had, the one running, and what npm last said. The board never opens the
    // What's New page by itself — it puts a dot beside the name and waits to be clicked.
    //
    // `jump()` is what makes the mark appear after an upgrade; it also writes the running version
    // down the first time, so a fresh install is not told it has jumped from nowhere. The npm
    // half is whatever the last daily answer was: nothing is asked of the network from in here,
    // and with the check switched off `latest()` is null and the mark says nothing about it.
    update: { version: update.version(), jump: update.jump(), latest: update.latest() },
    // Whether there is a backlog at all. The board has to be told rather than work it out from
    // what is missing: an empty `epics` is a repository nobody has made one in yet, and drawing
    // the lanes and the state columns for somebody who switched the whole thing off would be the
    // one thing the switch promises not to do.
    backlog: on,
    // Every epic k0 knows, flat, the way the stories are flat: each carries the repository it
    // belongs to and the board groups them itself. They are listed whether or not a story of
    // theirs is on the board — an epic with nothing under it yet is exactly the one you are about
    // to put something in — but only from the repositories that are still on this machine, which
    // is the same rule the stories are held to.
    epics: onDisk(allEpics).map((e) => backlog.publicEpic(e)),
    now: Date.now(),
  }
}

// Attention order, most urgent first. These five are everything a live session can be doing.
//
// `BACKLOG` and `COMPLETED` used to sit at the end of this list and they never belonged in it:
// they are not things a session does, they are what the board calls a story with no session and a
// story you have ticked off. Neither can be waiting for you, and `attention` never sees one — it
// looks only at stories whose session is alive and which are not finished. The story's own six
// states are the other axis entirely and are not sorted here at all.
const ORDER = ['ASK', 'PLANNED', 'IDLE', 'WORKING', 'PLANNING']
const WAITING = new Set(['ASK', 'PLANNED', 'IDLE'])

/**
 * The little the menu bar icon needs: what is waiting for you, and what colour it should turn.
 * It is separate from /api/board because it is asked for every two seconds.
 */
function status() {
  const { urgent, waiting } = attention(onDisk(db.listStories()))
  return {
    urgent,
    waiting: waiting.map((c) => ({
      id: c.id,
      title: c.title,
      project: projectName(c.project_path),
      status: c.status,
      window: c.terminal_window_id,
    })),
    // Which of the four entries to tick in the menu. It lives here and not in the icon's own
    // preferences, unlike notifications: it is the same control that is on the board, and two
    // separate copies of the same thing would end up disagreeing. The menu only needs the
    // tick: why a mode is not holding with the lid closed is the board's story to tell, which
    // has the room to say it in words.
    mode: mode.current(),
  }
}

/**
 * What is waiting for you, most urgent first. It is the rule that decides the colour of the
 * icon, and the icon is now in two places — the menu bar and the browser tab. So the rule is
 * written once.
 */
function attention(all) {
  const live = all.filter((s) => s.session_id && s.session_alive && !s.completed_at)
  const waiting = live
    .filter((s) => WAITING.has(s.status))
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || (a.status_since ?? 0) - (b.status_since ?? 0))
  // If nothing is waiting but something is running, the icon still stays lit.
  const busy = live.find((s) => s.status === 'WORKING' || s.status === 'PLANNING')
  return { urgent: waiting[0]?.status ?? busy?.status ?? null, waiting }
}

/**
 * A file served with its real path in the address, so that whatever the page asks for next to
 * itself is actually found. The repository is the first piece, with its slashes disguised, and
 * from there on it is the path inside the repository.
 */
function site(req, res, seg) {
  let repo, rel
  try {
    repo = decodeURIComponent(seg[2] || '')
    rel = seg.slice(3).map(decodeURIComponent).join('/')
  } catch {
    return send(res, 400, { error: 'That address does not mean anything' })
  }
  const root = rootOf(repo)
  const abs = root && rel ? files.safePath(root, rel) : null
  if (!abs) return send(res, 400, { error: 'That file is outside the repository' })
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return send(res, 404, { error: 'File not found' })

  const head = {
    'content-type': files.mimeOf(abs),
    'content-length': fs.statSync(abs).size,
    'cache-control': 'no-store',
  }
  if (files.isPage(abs)) head['content-security-policy'] = SANDBOX
  res.writeHead(200, head)
  return fs.createReadStream(abs).pipe(res)
}

// A page that comes off the disk is text nobody has read, and letting it run would make it a
// resident here: from inside it could call k0's own API, which opens terminals and starts
// sessions. Shut like this it executes nothing and has an origin of its own, so from in there
// it touches nothing. It shows — which is what is wanted — but it does not act.
//
// The cost is fonts. Inside the sandbox the page's origin is opaque, so anything it loads from
// this server is a cross-origin request, and without a CORS header the browser refuses it. k0
// used to send `access-control-allow-origin: *` for exactly that reason, and that header also
// let any site on the internet read files out of your repositories. A web font that falls back
// is a much smaller loss than that, so the header is gone.
const SANDBOX = 'sandbox'

// How much a save is allowed to carry. Well under the megabyte the body reader stops at, which
// would otherwise refuse a large file with a message about requests instead of about the file —
// and far above anything you would actually edit in a browser tab: k0's own README is 56 KB.
const MAX_SAVE = 1 << 18

// ── The recap of a window ────────────────────────────────────────────────────
// Held for a minute, and not as a saved result: the page asks for the facts, then asks for the
// write-up to start, then asks every second whether it is done. Reading every repository's git
// history once a second to answer "not yet" would be absurd. Nothing is written down, and a
// minute later the same question is asked of git again from scratch.
const RECAP_TTL = 60000
let recap = null

async function recapFor(raw, { fresh = true } = {}) {
  const period = changelog.PERIODS.includes(raw) ? raw : 'last'
  // The page asks about the write-up once a second until it is done, and a model can take
  // longer than a minute: those questions must reuse whatever window is already open, or a
  // slow answer would mean a full sweep of every repository's git, every second, while waiting.
  if (recap && recap.period === period && (!fresh || Date.now() - recap.at < RECAP_TTL)) return recap
  const data = await changelog.facts(period)
  recap = {
    period,
    at: Date.now(),
    // The window is part of the name: at midnight "yesterday" becomes a different day, and a
    // summary written for the old one must not be handed over as if it were the new one.
    key: `${data.period}:${data.from}:${data.to}`,
    public: data,
    payload: JSON.stringify(
      {
        period: data.period,
        from: new Date(data.from).toISOString(),
        to: new Date(data.to).toISOString(),
        totals: data.totals,
        repositories: data.repos.map((r) => ({
          name: r.name,
          commits: r.commits.map(({ at, subject, body, online }) => ({ at, subject, body, online })),
          unpushed_total: r.unpushedTotal,
          uncommitted_files: r.dirty.map((f) => f.path),
          unreleased_changelog: r.unreleased,
          stories: r.stories,
        })),
      },
      null,
      2
    ),
  }
  return recap
}

// ── What changed in k0 ───────────────────────────────────────────────────────
// Nothing is stored and nothing is asked of the network here: the entries come out of the
// `CHANGELOG.md` this copy of k0 shipped with, between the version the user last had and the one
// running now. The model's job is to say what they mean in the reader's language; working out
// which entries those are is arithmetic, and arithmetic is not a model's job.

const CHANGELOG_SKILL = 'k0-changelog'
const WHATSNEW_SKILL = 'k0-whatsnew'
const LEVELS = ['plain', 'normal', 'nerd']

/** A language tag, or nothing. It goes into a job key and into a prompt, so it is not free text. */
const language = (raw) => (/^[a-z]{2,3}$/.test(String(raw ?? '').toLowerCase()) ? String(raw).toLowerCase() : 'en')

/**
 * `asked` is the version the page is already showing, and it is only ever the page's own answer
 * handed back: reading the page moves `update.last_seen` to the version running, so a second
 * question about the same visit — another language, another level — would otherwise be answered
 * about a shorter span than the entries the reader has in front of him. It is not taken on trust;
 * it counts only if the changelog really has a version by that name.
 */
function whatsNew(asked = null) {
  const to = update.version()
  // Read before `jump()`, which writes the running version down the first time it is asked: on a
  // fresh install there is no earlier version, and the page has to be able to say so rather than
  // be handed the one that has just been recorded.
  const seen = db.getPref('update.last_seen', null)
  const known = asked ? update.parseChangelog().some((e) => e.version === asked) : false
  const from = (known ? asked : null) ?? update.jump()?.from ?? seen
  // With a span, the entries in it. Without one — the page opened on purpose rather than after an
  // upgrade — the version that is running and nothing older: the whole changelog since 0.1.0 is
  // not "what's new", it is the changelog, and it is already on the page underneath.
  const span = from && from !== to
  // Exactly what the parser gives back — the version, its date, the paragraph it opens with and
  // its sections keyed by heading — because that is the shape the page draws and the shape the
  // skill is handed. There is nothing here worth reshaping, and a reshaping is a second place for
  // a heading to go missing.
  const entries = span ? update.entriesBetween(from, to) : update.entriesBetween(null, to).slice(0, 1)
  return {
    from: from ?? null,
    to: to ?? null,
    latest: update.latest()?.version ?? null,
    entries,
    writer: writer.capability(WHATSNEW_SKILL),
  }
}

/**
 * Opening a Claude Code session on a story: the button on the post-it, and the same thing a skill
 * asks for when it finds a story that has never been started.
 *
 * Written once because there are two doors to it now. `/k0-work` reaches a story that was planned
 * on the board and picked up in a terminal the user opened himself, which has no session at all —
 * and a worktree is recorded against a session, so without this it had nothing to do but refuse.
 * A second copy of forty lines that attach a session, mark HEAD and open a terminal would be a
 * second place for the undo on a failed launch to be forgotten.
 */
async function startSession(res, id, body = {}, { resume = false, prompt = null, command = null } = {}) {
  const story = db.getStory(id)
  if (!story) return send(res, 404, { error: 'Story not found' })
  const resuming = resume && !!story.session_id
  const sessionId = resuming ? story.session_id : crypto.randomUUID()
  // Whether the prompt is sent by itself belongs to the session that is about to start, so it is
  // taken here, before there is a session, and lands on the row `attachSession` makes.
  if ('auto_send' in body) db.setAutoSend(id, !!body.auto_send)
  if (typeof body.prompt === 'string' && body.prompt.trim()) db.patchStory(id, { prompt: body.prompt })
  if (!resuming) {
    if (story.session_id) forgetSession(story.session_id)
    // The command goes on the session and not on the story: it is what THIS conversation was
    // opened to do, and the answer to "is the work under way" is different for `/k0-work` and for
    // `/k0-discuss`. See `applyDerivedStatus`.
    db.attachSession(id, sessionId, command)
  }
  // From here on, this repository's commits belong to this session. Resuming does not rewrite it:
  // the starting mark stays the first one, otherwise the commits of the first run would lose their
  // owner. It goes before `launch`, which can be away for as long as forty-five seconds.
  if (!resuming || !story.head_at_start) db.setHeadAtStart(id, await git.head(story.project_path))
  try {
    // `prompt` is a command the interface asked for — `/k0-plan K42` — and it is handed to the
    // launcher instead of being written to the story first. The story's prompt is what somebody
    // typed on the post-it and it has to survive the session: saving over it would mean pressing
    // a suggestion once and losing what the note said for ever.
    const row = db.getStory(id)
    // `auto_send` with it, and not the story's own: k0 composed this line itself out of a button
    // the user pressed, so there is nothing on it for anybody to read over before sending. A story
    // made from the board has `auto_send` off — the field is not even in the dialog — which left
    // every suggestion opening a window with `/k0-plan K42` sitting unsent under the cursor.
    const opening = prompt ? { ...row, prompt, auto_send: true } : row
    const out = await launch({ story: opening, sessionId, mode: resuming ? 'resume' : 'start' })
    db.setTerminalWindow(id, out.winId)
    db.setAutoClosed(id, false) // there is a window again: whoever shut the last one is history
    // After `tick`, not before it: the round is what notices the session has gone live and — where
    // it was opened to do the work rather than to talk about it — moves the story to `Working`, and
    // the `.k0/` file has both that state and the session's id in its header. Written here rather
    // than from the watching loop, which runs once a second on every story there is and has no
    // business touching a disk.
    tick()
    const note = mirrorStory(id)
    return wrote(res, { ...out, story: db.getStory(id), session: db.currentSession(id) }, note)
  } catch (err) {
    // The terminal did not open: the story must not stay attached to a session that was never
    // born, or it would offer a "resume" that cannot work.
    if (!resuming) db.detachSession(id, story.session_id)
    return send(res, 500, { error: String(err.message || err) })
  }
}

// ── The backlog's own addresses ──────────────────────────────────────────────
// Split off from `api()` because it is a resource with a tree under it rather than one more
// endpoint, and reading `/api/backlog/story/12/decision` off the same four-name destructuring the
// flat endpoints use would be a puzzle every time somebody added one. `rest` here is everything
// after `/api/backlog`.

/**
 * The `.k0/` file follows the row — and when it cannot, the request still succeeds.
 *
 * By the time any of this runs the edit is already in the database, and the database is the truth.
 * A read-only checkout, a full disk, a repository somebody moved out from under k0: none of them
 * may turn a story that WAS created into an error saying it was not, because the next thing the
 * user does is create it again. So the failure comes back as a sentence to put beside the answer
 * instead — `mirror.js` writes one, meant for a screen — and whoever asked can say the readable
 * copy is behind without anybody wondering whether the work was lost.
 *
 * The throw is caught as well as the returned error. `mirror.js` refuses outright, loudly, for a
 * path it will not touch, and that refusal is the same kind of news as a disk that is full.
 */
const mirroring = (fn) => {
  try {
    return fn().error
  } catch (err) {
    return `The .k0/ copy could not be written: ${String(err?.message ?? err)}`
  }
}

const mirrorStory = (id) => mirroring(() => mirror.writeStory(id))

const mirrorEpic = (id) => mirroring(() => mirror.writeEpic(id))

/** The answer, carrying whatever the readable copy had to say about itself — and nothing when it went. */
const wrote = (res, body, note) => send(res, 200, note ? { ...body, mirror: note } : body)

/**
 * What a request may say when it makes a story or an epic, and nothing else. The repository, the
 * epic and the parent are not here: they arrive as keys and are resolved to ids first.
 *
 * `key_num` is the reason this exists. `db.createStory` takes one so that `.k0/` can be read back
 * into an empty database carrying the numbers it was written with — and a request that could send
 * one would give two stories in a repository the same name, after which every skill that resolves
 * a key addresses whichever sorts first and `wt-K3` collides on the branch. The key is the
 * server's to hand out. `state`, `starred` and `completed_at` are left out for a quieter reason:
 * a story is born in the backlog, the star is something the user puts on afterwards, and both are
 * one PATCH away, where they go through the checks that mean something.
 */
const NEW_STORY = ['title', 'description', 'body', 'prompt', 'lang', 'color']
const NEW_EPIC = ['title', 'body', 'lang']

const only = (allowed, body) => Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)))

/**
 * Whether a request is closing a story, read once so the check and the act agree.
 *
 * `completed` arrives inside a JSON body from a skill's `curl`, and `1`, `true` and `"yes"` all
 * mean the same thing to whoever typed them. Testing `=== true` here and acting on `!!` further
 * down is how a story reaches `Done` with a broken decision standing: the refusal never runs, and
 * `setCompleted` has no check of its own.
 */
const closing = (body) => ('completed' in body ? !!body.completed : false)

/**
 * The number of the round being written, or null when there is not one.
 *
 * `round.n` is `INTEGER NOT NULL`, and `Number(undefined)` is `NaN`, which SQLite stores as NULL:
 * without this a body that forgot `n` comes back as a 500 with a constraint message in it. Every
 * other write on this resource says what is missing; this one used to be the exception.
 */
function roundNumber(body) {
  const n = Number(body?.n)
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * A story and everything that was split out of it, parents first.
 *
 * `db.deleteStory` walks the tasks under a story and deletes them too, and every one of them has
 * a `.k0/` file of its own. Removing only the parent's leaves those files on disk for ever — and
 * they are not litter: `importRepo` reads the folder back, their `parent:` names a story that is
 * gone, and the pieces of work somebody deleted come alive again as top-level stories. `seen` is
 * the guard `deleteStory` keeps for the same reason: a database can hold a story that is its own
 * ancestor, and this must not go round for ever over it.
 */
function family(story, seen = new Set()) {
  if (!story || seen.has(story.id)) return []
  seen.add(story.id)
  return [story, ...db.childStories(story.id).flatMap((child) => family(child, seen))]
}

/**
 * A repository is swept once per run of the server, the first time anything asks for its backlog.
 *
 * `importRepo` is the way back into the database; this is the way back out, and without it the
 * folder is only ever as complete as the edits that have happened since it appeared. A board that
 * was filled before this feature existed, a database restored from a backup, a row somebody wrote
 * with `sqlite3`: all of them are stories with no readable copy at all, and a database rebuilt
 * from `.k0/` would lose exactly those. Once per repository and not on every listing — the list
 * asks for this address every thirty seconds, and a sweep rewrites every file in the folder.
 */
const swept = new Set()
function sweepRepo(repo) {
  if (swept.has(repo)) return
  swept.add(repo)
  mirror.syncRepo(repo)
}

async function backlogApi(req, res, url, seg) {
  // Switched off, every door answers the same way and none of them answers with an empty backlog:
  // "there is nothing here" and "you turned this off" look identical to a skill and read identically
  // to a person, and the wrong one of the two sends somebody looking for work they cannot find. The
  // sentence comes from the model rather than from here so there is one wording and not two.
  if (!backlog.enabled()) return send(res, 200, backlog.off())
  const rest = seg.slice(2) // ['story', '12', 'decision']
  const [kind, second, third] = rest
  const id = Number(second)
  const body = req.method === 'POST' || req.method === 'PATCH' ? await readBody(req) : {}

  // ── The listing ──────────────────────────────────────────────────────────
  // The first call every skill and every page makes, and the one place the way back from a lost
  // database belongs. `.k0/` is committed, so a new machine — or a `~/.k0` that went with the old
  // one — still has every story of this repository written down, and this is the moment they are
  // needed: before anybody reads an empty answer as "there is nothing here to do".
  //
  // What to restore and whether to restore at all is `importRepo`'s to decide, not this line's. It
  // refuses a repository that already has work in it, because importing twice does not merge, it
  // duplicates — and with nothing to read it costs one look at the disk.
  if (!kind && req.method === 'GET') {
    const repo = backlog.backlogRepo(url.searchParams.get('repo'))
    if (!repo) return send(res, 400, { error: 'That is not a repository k0 can put a backlog in.' })
    const back = mirror.importRepo(repo)
    sweepRepo(repo)
    const listing = backlog.listing(repo, url.searchParams.get('epic'))
    const restored = back.stories || back.epics || back.error ? back : null
    return send(res, 200, restored ? { ...listing, restored } : listing)
  }

  if (kind === 'next' && req.method === 'GET') {
    const repo = backlog.backlogRepo(url.searchParams.get('repo'))
    if (!repo) return send(res, 400, { error: 'That is not a repository k0 can put a backlog in.' })
    return send(res, 200, backlog.next(repo))
  }

  // ── Epics ────────────────────────────────────────────────────────────────
  if (kind === 'epic' && !second && req.method === 'POST') {
    // The same guard the stories go through, and for the same reason: an epic is a folder inside
    // one repository, and `mirror.js` writes its file into that repository. A path that is not a
    // checkout would make an epic nothing could ever write down.
    const repo = backlog.backlogRepo(body.project_path)
    if (!body.title?.trim() || !repo) return send(res, 400, { error: 'Title and a known repository are required' })
    const epic = db.createEpic({ ...only(NEW_EPIC, body), title: body.title.trim(), project_path: repo })
    return wrote(res, backlog.publicEpic(epic), mirrorEpic(epic.id))
  }

  // An epic told rather than typed: a session running `/k0-epic` in a repository, and not a row
  // anywhere. That is the point of it — there is nothing to write down until the discussion has
  // decided what the epic is, and the skill creates it itself when it knows. Which is also why it
  // cannot go through `startSession`: that attaches a session to a story, and here there is none.
  if (kind === 'epic' && second === 'start' && req.method === 'POST') {
    const repo = backlog.backlogRepo(body.project_path)
    if (!repo) return send(res, 400, { error: 'That is not a repository k0 can put a backlog in.' })
    const { prompt } = backlog.commandPrompt('k0-epic')
    // The launcher takes a story, so it is handed the shape of one and nothing more: a name for the
    // window, the repository to open in, and the line to say. None of it is written down anywhere.
    // `auto_send` is on where a story's is the user's to choose — there is no post-it to go back
    // and read here, so a prompt left sitting unsent under the cursor is a window that did nothing.
    const standIn = { title: `New epic in ${projectName(repo)}`, project_path: repo, prompt, auto_send: true }
    try {
      const out = await launch({ story: standIn, sessionId: crypto.randomUUID() })
      return send(res, 200, { ...out, project_path: repo })
    } catch (err) {
      return send(res, 500, { error: String(err.message || err) })
    }
  }

  if (kind === 'epic' && id) {
    const epic = db.getEpic(id)
    if (!epic) return send(res, 404, { error: 'Epic not found' })

    // The whole epic, which is what a discussion re-reads before every round rather than trusting
    // its memory of a conversation it may have been compacted out of. The shape is `backlog.js`'s,
    // not this line's: it was written out here once, and a hand-composed `K7·D3` beside the one in
    // `db.epicDecisions` is the separator written in two places, waiting for the day it changes.
    if (!third && req.method === 'GET') return send(res, 200, backlog.epicView(id))
    // The cheap half of it, on the same address a story has one on and for the same reason: the
    // panel beside the list follows an epic's discussion while `/k0-epic` is running it, and asking
    // for the whole epic once a second would re-read every story under it to draw a line of text.
    if (third === 'live' && req.method === 'GET') return send(res, 200, backlog.epicLive(id))

    if (!third && req.method === 'PATCH') {
      const after = db.patchEpic(id, body)
      return wrote(res, backlog.publicEpic(after), mirrorEpic(id))
    }
    if (!third && req.method === 'DELETE') {
      // The stories stay and lose their epic, so every one of their files has a line to change:
      // the epic they name is gone.
      const orphans = db.storiesOfEpic(id).map((s) => s.id)
      db.deleteEpic(id)
      // The first complaint and not the last: one of these failing means the folder is read-only
      // or gone, so the rest will say the same thing in the same words, and a screen showing it
      // eleven times says nothing an eleventh time.
      const gone = mirroring(() => mirror.removeEpic(epic.key, epic.project_path))
      const rewritten = orphans.map(mirrorStory).find(Boolean)
      return wrote(res, { ok: true }, gone ?? rewritten)
    }
    // An epic's own discussion. It happens before a single story of it exists, which is exactly
    // why these two exist at all — see the CHECK on `decision` and `round` in db.js.
    if (third === 'round' && req.method === 'POST') {
      if (!roundNumber(body)) return send(res, 400, { error: 'A round is numbered: send `n`, one or more.' })
      return wrote(res, db.addEpicRound(id, body), mirrorEpic(id))
    }
    if (third === 'decision' && req.method === 'POST') {
      if (!String(body.text ?? '').trim()) return send(res, 400, { error: 'A decision has to say something' })
      // The row id comes back with the number, and it is the id every supersede is sent with: `D2`
      // exists on this epic and on every story under it, so the number alone names four different
      // decisions depending on who is reading it.
      return wrote(res, db.addEpicDecision(id, body), mirrorEpic(id))
    }
  }

  // ── Stories ──────────────────────────────────────────────────────────────
  if (kind === 'story' && !second && req.method === 'POST') {
    const repo = backlog.backlogRepo(body.project_path)
    if (!body.title?.trim() || !repo) return send(res, 400, { error: 'Title and a known repository are required' })
    // Skills hold keys, because a key is what the user says out loud. Everything below this line
    // holds ids, and a key that names nothing is refused rather than quietly dropped: a story
    // silently born outside its epic is one nobody notices until the epic's progress is wrong.
    const epic = body.epic_key ? backlog.epicByKey(repo, body.epic_key) : null
    if (body.epic_key && !epic) return send(res, 400, { error: `There is no ${body.epic_key} here` })
    const parent = body.parent_key ? backlog.storyByKey(repo, body.parent_key) : null
    if (body.parent_key && !parent) return send(res, 400, { error: `There is no ${body.parent_key} here` })
    const story = db.createStory({
      ...only(NEW_STORY, body),
      title: body.title.trim(),
      project_path: repo,
      // A task takes its parent's epic unless it was given one of its own. Not tidiness: a
      // story's effective decisions are its own plus its EPIC's, so a task left outside the epic
      // its parent sits in would be planned and counter-checked blind to every rule that shaped
      // the whole thing. It stays a task — it still hangs off its parent — and the epic's
      // progress still counts stories and not their pieces.
      epic_id: epic?.id ?? parent?.epic_id ?? null,
      parent_story_id: parent?.id ?? null,
    })
    return wrote(res, backlog.publicStory(db.getStory(story.id)), mirrorStory(story.id))
  }

  if (kind === 'story' && id) {
    const story = db.getStory(id)
    if (!story) return send(res, 404, { error: 'Story not found' })

    if (!third && req.method === 'GET') return send(res, 200, backlog.storyView(id))
    if (third === 'live' && req.method === 'GET') return send(res, 200, backlog.liveView(id))

    if (!third && req.method === 'PATCH') {
      const fields = { ...body }
      if ('epic_key' in fields) {
        const epic = fields.epic_key ? backlog.epicByKey(story.project_path, fields.epic_key) : null
        if (fields.epic_key && !epic) return send(res, 400, { error: `There is no ${fields.epic_key} here` })
        fields.epic_id = epic?.id ?? null
        delete fields.epic_key
      }
      if ('parent_key' in fields) {
        const parent = fields.parent_key ? backlog.storyByKey(story.project_path, fields.parent_key) : null
        if (fields.parent_key && !parent) return send(res, 400, { error: `There is no ${fields.parent_key} here` })
        fields.parent_story_id = parent?.id ?? null
        delete fields.parent_key
      }
      // The one refusal in the whole feature. A story cannot be called finished while the last
      // counter-check says a decision it was held to is broken and nothing has answered it since
      // — otherwise the discussion that produced those decisions was worth nothing.
      const done = closing(fields)
      if (fields.state === 'Done' || done) {
        const may = backlog.mayFinish(id)
        if (!may.ok) return send(res, 409, { error: may.why, violations: may.violations })
      }
      db.patchStory(id, fields)
      if ('completed' in fields) db.setCompleted(id, done)
      // A story that has moved to another repository leaves a file behind in the old one, and
      // that file is not litter: `importRepo` reads it back, so a database rebuilt from `.k0/`
      // would resurrect the story where it no longer lives. It also carried a key that repository
      // has since handed to something else — see `patchStory`, which renumbers on the move.
      const after = db.getStory(id)
      const left =
        after.project_path === story.project_path
          ? null
          : mirroring(() => mirror.removeStory(story.key, story.project_path))
      // The epic it has just left, or joined, counts its stories in its own file: without this the
      // progress line says `3/11` on a list that now has ten names under it.
      for (const epicId of new Set([story.epic_id, after.epic_id].filter(Boolean))) mirrorEpic(epicId)
      return wrote(res, backlog.publicStory(after), mirrorStory(id) ?? left)
    }

    if (!third && req.method === 'DELETE') {
      // The story and the tasks it was split into: `deleteStory` takes all of them, so all of
      // their files have to go and all of their sessions have to be let go of.
      const going = family(story)
      for (const s of going) if (s.session_id) forgetSession(s.session_id)
      db.deleteStory(id)
      const gone = going.map((s) => mirroring(() => mirror.removeStory(s.key, s.project_path))).find(Boolean)
      // The epic is rewritten whether or not the files went, and not inside a `??`: its list still
      // has the deleted story's name on it, and a `??` that short-circuits would leave it there
      // precisely on the day something else had already gone wrong.
      const epics = new Set(going.map((s) => s.epic_id).filter(Boolean))
      const counted = [...epics].map(mirrorEpic).find(Boolean)
      return wrote(res, { ok: true }, gone ?? counted)
    }

    // Starting a session on a story, which is what the button on the post-it does. It is here as
    // well because a story planned on the board and picked up in a terminal has no session, and
    // a worktree is recorded against one: without this, `/k0-work` had nowhere to go but a
    // refusal. Same path, same launcher — `story` below is the flat endpoint.
    if (third === 'start' && req.method === 'POST') {
      // With no `command` this is the button it has always been and the prompt is the story's own.
      // With one it is the interface saying what to do next out loud — `/k0-plan K42` — and the
      // name is held against a closed list before it goes anywhere near a command line.
      const asked = body.command == null || body.command === '' ? null : backlog.commandPrompt(body.command, story.key)
      if (asked?.error) return send(res, 400, { error: asked.error })
      return await startSession(res, id, body, { prompt: asked?.prompt ?? null, command: asked?.name ?? null })
    }

    // ── The discussion, the decisions, the plan and the log ────────────────
    // Every one of these is written before the next question is asked, which is the whole point of
    // their being separate calls: a terminal that dies at round three does not take the first three
    // with it. So each one answers on its own, and none of them waits for the rest of a discussion.
    if (third === 'round' && req.method === 'POST') {
      if (!roundNumber(body)) return send(res, 400, { error: 'A round is numbered: send `n`, one or more.' })
      return wrote(res, db.addRound(id, body), mirrorStory(id))
    }
    if (third === 'decision' && req.method === 'POST') {
      if (!String(body.text ?? '').trim()) return send(res, 400, { error: 'A decision has to say something' })
      // The row's own id comes back beside its number, and it is the id a supersede is sent with:
      // `D2` is a name inside one owner, and this story's epic has a D2 of its own.
      return wrote(res, db.addDecision(id, body), mirrorStory(id))
    }
    if (third === 'check' && req.method === 'POST') {
      // The whole list or nothing. `setCheckItems` deletes before it writes — that is what
      // replacing means — so a body that misspelled `items` would empty a checklist somebody had
      // ticked off by hand, answer 200 as though that had been asked for, and print the empty
      // list into the `.k0/` file in the same breath. An empty array is still a way to clear it.
      if (!Array.isArray(body.items)) {
        return send(res, 400, {
          error:
            'The checklist is sent whole, as `items`: [{ "text": "…" }]. ' +
            'An empty list clears it; sending nothing does not.',
        })
      }
      // The list as it now stands, under the same name the request sent it under. It replaces the
      // whole checklist, so every id in the answer is a row that did not exist a moment ago and
      // the caller has to read them back before it patches one.
      return wrote(res, { items: db.setCheckItems(id, body.items) }, mirrorStory(id))
    }
    if (third === 'verify' && req.method === 'POST') {
      // The run number is the caller's to send and the server's to sanity-check: a run that
      // would overwrite the one before it is refused rather than silently renumbered, because a
      // counter-check whose earlier run quietly disappeared is worse than no counter-check.
      const run = Number(body.run)
      const latest = db.latestRun(id)
      if (!Number.isInteger(run) || run <= latest) {
        return send(res, 409, { error: `Run ${latest} is already recorded. The next one is ${latest + 1}.` })
      }
      // A run is the whole set or it is not a run. A run that answers nine decisions of ten is
      // refused here rather than written: the tenth would keep whatever verdict it was last given,
      // the counter-check would report a clean sweep of what it happened to look at, and the story
      // would go to Done with a broken rule nobody had mentioned. The labels it left out come back
      // with the refusal, because that is the one thing the caller cannot work out for itself.
      const missing = db.unanswered(id, body.results)
      if (missing.length) {
        return send(res, 409, {
          error:
            `A run answers every decision that is still standing. This one says nothing about ` +
            `${missing.map((d) => d.label).join(', ')}. Look at ${missing.length === 1 ? 'it' : 'them'} and ` +
            'send the whole run again — `na` is a verdict, silence is not.',
          missing: missing.map((d) => ({ decision_id: d.id, label: d.label, text: d.text })),
        })
      }
      // `written` is not decoration: `recordRunChecks` drops a verdict that names no decision of
      // this story and one that is not `kept`, `violated` or `na`, and fewer than were sent is the
      // caller's only sign that some of what it wrote said nothing.
      const written = db.recordRunChecks(id, run, body.results)
      return wrote(res, { run, written, violations: backlog.mayFinish(id).violations }, mirrorStory(id))
    }
    if (third === 'plan' && req.method === 'POST') {
      db.setPlan(id, body.text)
      return wrote(res, backlog.publicStory(db.getStory(id)), mirrorStory(id))
    }
    if (third === 'log' && req.method === 'POST') {
      if (!String(body.text ?? '').trim()) return send(res, 400, { error: 'A log entry has to say something' })
      return wrote(res, { log: db.addLogEntry(id, body) }, mirrorStory(id))
    }
  }

  // ── One decision, one check row ──────────────────────────────────────────
  // The id is the row's, never the per-owner number: D2 exists on the epic and on every story
  // under it, so a number here would point at four different decisions depending on who read it.
  if (kind === 'decision' && id && req.method === 'PATCH') {
    const decision = db.getDecision(id)
    if (!decision) return send(res, 404, { error: 'Decision not found' })
    // The mistake every skill is warned about, caught where it can still be said out loud: `n` sent
    // where the row id belongs. In a young database both are small integers, so `3` meant as D3
    // lands on some other story's rule — which drops out of the plan, out of what `/k0-work` holds
    // itself to and out of the violations that stand between a story and Done, while its `.k0/`
    // file goes on printing it as though it were still in force. Nothing anywhere would say so.
    const by = body.superseded_by
    if (by != null && by !== '' && !db.maySupersede(id, by)) {
      return send(res, 400, {
        error:
          '`superseded_by` is the row `id` of the decision that replaces this one, and it has to ' +
          'belong to the same story or epic. It is not `D3` and it is not the 3 in `D3`: use the ' +
          '`id` the new decision came back with when it was created.',
      })
    }
    const after = db.supersedeDecision(id, by)
    // An epic's decision is superseded on the epic, and every story under it sees the change at
    // once — which is why it belongs there. Only the epic's own file has anything to redraw.
    const note = decision.story_id ? mirrorStory(decision.story_id) : mirrorEpic(decision.epic_id)
    return wrote(res, after, note)
  }

  // A check row knows which story it is on and nothing above it does. There is no helper in db.js
  // that reads one — nothing else has ever needed to — so the story is asked for directly rather
  // than guessed from the request, which does not carry it.
  if (kind === 'check' && id && req.method === 'PATCH') {
    const before = db.default.prepare('SELECT story_id FROM check_item WHERE id = ?').get(id)
    if (!before) return send(res, 404, { error: 'That line is not on any checklist' })
    const after = db.patchCheckItem(id, body)
    return wrote(res, after, mirrorStory(before.story_id))
  }

  // ── What waits on what ───────────────────────────────────────────────────
  if (kind === 'dependency' && req.method === 'POST') {
    const from = db.getStory(Number(body.story_id))
    const on = db.getStory(Number(body.depends_on))
    if (!from || !on) return send(res, 404, { error: 'One of those stories is not on the board' })
    if (body.remove) db.removeDependency(from.id, on.id)
    else if (!db.addDependency(from.id, on.id)) {
      return send(res, 400, { error: 'A story cannot wait for itself' })
    }
    return wrote(res, backlog.publicStory(db.getStory(from.id)), mirrorStory(from.id))
  }

  // ── The worktree ─────────────────────────────────────────────────────────
  // `session` is the row id and not the Claude Code session string, and it is called `session`
  // for exactly that reason: the two were both called `session_id` once and the endpoint was
  // handed whichever one the caller happened to have. The text id is still accepted, under its
  // own name, because that is the one a session knows about itself. The row is read here rather
  // than through a helper because there is none: everything else in k0 reaches a session through
  // the story it belongs to, and this is the one request that arrives holding the session itself.
  if (kind === 'worktree' && req.method === 'POST') {
    const row = body.session
      ? db.default.prepare('SELECT * FROM session WHERE id = ?').get(Number(body.session))
      : body.session_id
        ? db.getSessionByClaudeId(String(body.session_id))
        : null
    if (!row) {
      return send(res, 404, {
        error: 'k0 does not know that session. Send { "session": <the id of the session block> }.',
      })
    }
    if (body.action === 'open') {
      const out = await worktree.open(row)
      return send(res, out.ok ? 200 : 409, out)
    }
    if (body.action === 'merge') {
      const out = await worktree.merge(row)
      return send(res, out.ok ? 200 : 409, out)
    }
    if (body.action === 'state' || !body.action) return send(res, 200, await worktree.state(row))
    return send(res, 400, { error: 'A worktree can be opened or merged, and nothing else.' })
  }

  return send(res, 404, { error: 'No such endpoint' })
}

async function api(req, res, url) {
  const seg = url.pathname.split('/').filter(Boolean) // ['api', 'story', '3', 'start']
  const [, named, idRaw, action] = seg
  const id = Number(idRaw)
  // `card` is what a story used to be called, and the menu bar icon on macOS is a COMPILED binary
  // that still says so: an installed copy keeps posting to /api/card/<id>/focus until somebody
  // rebuilds and ships it. That is the whole reason this line exists, and the only one — the
  // Linux and Windows trays are scripts in this repository, read fresh on every run, so they were
  // simply renamed. Leaving them on the alias would have kept it alive long after the one thing
  // that needs it was rebuilt.
  const resource = named === 'card' ? 'story' : named

  if (resource === 'board' && req.method === 'GET') return send(res, 200, board())
  if (resource === 'status' && req.method === 'GET') return send(res, 200, status())
  if (resource === 'projects' && req.method === 'GET') return send(res, 200, listProjects())

  // ── What you have been doing ───────────────────────────────────────────────
  // Two halves, deliberately apart. The facts come back straight away and the page can already
  // show them; the write-up takes a model half a minute, so it is started and then asked
  // about, the same once-a-second poll the board and the viewer already live on.
  if (resource === 'changelog' && !idRaw && req.method === 'GET') {
    const data = await recapFor(url.searchParams.get('period'))
    return send(res, 200, { ...data.public, writer: writer.capability(CHANGELOG_SKILL) })
  }
  if (resource === 'changelog' && idRaw === 'write') {
    const data = await recapFor(url.searchParams.get('period'), { fresh: false })
    if (req.method === 'POST') return send(res, 200, writer.run(CHANGELOG_SKILL, data.key, data.payload))
    if (req.method === 'GET') return send(res, 200, writer.state(data.key))
  }

  // ── What changed in k0 itself ──────────────────────────────────────────────
  // The same two halves as the ChangeLog, and deliberately the same runner underneath: the two
  // pages can be open at once, so the jobs are keyed and neither cancels the other. The key
  // carries the language and the level, because a page asked for in Italian must not be handed
  // the English one that was already finished.
  if (resource === 'whatsnew' && !idRaw && req.method === 'GET') {
    return send(res, 200, whatsNew())
  }
  if (resource === 'whatsnew' && idRaw === 'write') {
    const facts = whatsNew(url.searchParams.get('from'))
    const lang = language(url.searchParams.get('lang'))
    const level = LEVELS.includes(url.searchParams.get('level')) ? url.searchParams.get('level') : 'normal'
    const key = `whatsnew:${facts.from ?? ''}:${facts.to ?? ''}:${lang}:${level}`
    if (req.method === 'GET') return send(res, 200, writer.state(key))
    if (req.method === 'POST') {
      const payload = JSON.stringify({ from: facts.from, to: facts.to, lang, level, entries: facts.entries }, null, 2)
      return send(res, 200, writer.run(WHATSNEW_SKILL, key, payload))
    }
  }
  // The reader has read it: the mark on the board goes out. It is not the tab closing that does
  // this — closing a tab is not the same as having read what was in it.
  if (resource === 'whatsnew' && idRaw === 'seen' && req.method === 'POST') {
    return send(res, 200, { version: update.seen() })
  }

  // Asking npm now rather than waiting for the day to turn over. It is the one request k0 makes,
  // it is switched off by a preference, and it never throws: `check` answers null and the board
  // simply says nothing.
  if (resource === 'update' && idRaw === 'check' && req.method === 'POST') {
    return send(res, 200, { latest: await update.check({ force: true }), version: update.version() })
  }

  // ── The backlog ────────────────────────────────────────────────────────────
  if (resource === 'backlog') return await backlogApi(req, res, url, seg)

  // ── The four modes ─────────────────────────────────────────────────────────
  // One control, with two handles: the row of buttons on the board and the four entries in the
  // menu bar. Terminals that are already open change STRAIGHT AWAY — text and window size both,
  // not only the ones you open next — otherwise, to be able to read anything, you would have to
  // close everything and start again.
  //
  // The answer does not only say which mode we are in: it says whether it is holding. Whoever
  // clicked has to know now whether the lid is covered, not in a second's time.
  //
  // A pass over the windows that fails says so in the log. It used to fail in silence, which is
  // how driving mode could stop working for days without anybody being able to say when.
  if (resource === 'mode' && req.method === 'POST') {
    const b = await readBody(req)
    await mode.setMode(b.mode)
    const windows = await applyModeToWindows(db.listStories().map((s) => s.terminal_window_id))
    if (windows.error) console.log(`k0 — the terminals did not follow the mode: ${windows.error}`)
    return send(res, 200, { mode: mode.current(), lid: mode.lid(), reason: mode.reason() })
  }

  // ── The dev server of a repository ─────────────────────────────────────────
  // The globe in the column heading. One address for the three gestures, because they are the
  // same gesture with different endings — and `restart` really is stop-then-start, not a third
  // path through the same code.
  //
  // The repository is not taken on trust. It arrives from the page as a plain path and it is a
  // path k0 is about to RUN something in, so it goes through the same allowlist the file viewer
  // uses: a directory k0 already knows as a project, or nothing at all.
  if (resource === 'server' && req.method === 'POST') {
    const b = await readBody(req)
    const repo = rootOf(b.path)
    if (!repo) return send(res, 404, { error: 'k0 does not know that repository.' })
    const action = b.action
    if (action === 'start') return send(res, 200, await servers.start(repo))
    if (action === 'stop') return send(res, 200, await servers.stop(repo))
    if (action === 'restart') return send(res, 200, await servers.restart(repo))
    return send(res, 400, { error: 'That is not something a server can be asked to do.' })
  }

  // The screen changed under the windows: a monitor plugged in or unplugged, a different
  // resolution. This puts them all back in the middle of what is there now, as they were the
  // day they were born. The menu bar icon calls it, being the one piece of k0 that sees that
  // news arrive.
  if (resource === 'windows' && idRaw === 'relayout' && req.method === 'POST') {
    return send(res, 200, await relayoutWindows(db.listStories().map((s) => s.terminal_window_id)))
  }

  // ── A page as a page ───────────────────────────────────────────────────────
  // An `.html` is looked at, not read as source, and to really look at it, it has to bring its
  // things along: the stylesheet next to it, the images in the directory below. Those are
  // written as relative paths, and they resolve against the address — which is why here the
  // file's path is the address's path, and not a parameter on the end as it is for everything
  // else. The repository goes in front, packed into one piece, and goes through the same guard
  // as all the rest.
  if (resource === 'site' && req.method === 'GET') return site(req, res, seg)

  // ── Sessions that already happened ─────────────────────────────────────────
  // The ones opened outside k0, or before k0 existed: they can be looked at and imported.
  if (resource === 'sessions' && idRaw === 'candidates' && req.method === 'GET') {
    const days = clamp(url.searchParams.get('days'), 14, 1, 365)
    const perRepo = clamp(url.searchParams.get('per_repo'), 10, 1, 100)
    return send(
      res,
      200,
      scanSessions({
        days,
        perRepo,
        exclude: new Set(db.sessionIds()),
        live: new Set(readLiveSessions().keys()),
      })
    )
  }

  if (resource === 'sessions' && idRaw === 'import' && req.method === 'POST') {
    const b = await readBody(req)
    const items = Array.isArray(b.items) ? b.items : []
    // Duplicates are dropped here and not in the database: `session.session_id` has no
    // uniqueness constraint, and this is not the moment to add one to a database with data in it.
    const taken = new Set(db.sessionIds())
    const stories = []
    const skipped = []
    // The first complaint and not the last: whatever stops one file being written stops the rest
    // in the same words, and twenty copies of one sentence say nothing the first did not.
    let note = null
    for (const it of items) {
      const raw = String(it.title || '').trim()
      const sessionId = String(it.session_id || '')
      if (!sessionId || !it.project_path || !raw) {
        skipped.push({ session_id: sessionId || null, why: 'session, repository and title are all required' })
        continue
      }
      // The same normalisation as the title field on the dashboard: a story's title is the
      // session's name, and importing must not create one of a different shape.
      const title = sessionName(raw)
      if (taken.has(sessionId)) {
        skipped.push({ session_id: sessionId, why: 'already on the board' })
        continue
      }
      taken.add(sessionId)
      const made = db.importStory({
        title,
        description: String(it.description || '').trim(),
        project_path: it.project_path,
        session_id: sessionId,
        started_at: it.started_at,
        ended_at: it.ended_at,
      })
      stories.push(made)
      // The readable copy is written here as it is at every other door. An imported story that
      // never got one exists on the board and nowhere else, and a database rebuilt from `.k0/`
      // would come back without it — which is the one thing the folder is there to prevent.
      const said = mirrorStory(made.id)
      note ??= said
    }
    // A session that is still running takes on the colour of what it is doing right away.
    tick()
    return wrote(res, { created: stories.length, skipped, stories }, note)
  }

  // ── A repository's files ───────────────────────────────────────────────────
  // The whole listing is big and changes slowly; what changes quickly is the files that have
  // been touched. Which is why `only=changed` exists: that is what the page asks for every
  // three seconds, while it re-reads the complete listing rarely.
  //
  // Which of the names written inside a document are real files. It is only reached for the
  // ones the listing does not already have — most of the time it does not run at all — and it
  // is needed because a directory the listing skips, like `out/`, can hold the very documents
  // that text is naming.
  if (resource === 'files' && idRaw === 'exist' && req.method === 'POST') {
    const b = await readBody(req)
    const root = rootOf(b.repo)
    if (!root) return send(res, 400, { error: 'Unknown repository' })
    return send(res, 200, { paths: files.exist(root, b.paths) })
  }

  if (resource === 'files' && req.method === 'GET') {
    const root = rootOf(url.searchParams.get('repo'))
    if (!root) return send(res, 400, { error: 'Unknown repository' })
    // The story is only there to say where the session started from, and it can be missing:
    // from a column you open the repository's files and that is all. `card` is still read as
    // well as `story`: the viewer's address is one somebody can have bookmarked.
    const storyId = Number(url.searchParams.get('story') || url.searchParams.get('card'))
    const story = Number.isInteger(storyId) && storyId > 0 ? db.getStory(storyId) : null
    // Searching inside the files: the page asks for it as you type, and it needs neither the
    // listing nor git's state.
    // `nerd` is the switch in the page: with it on, the configuration files are listed, so the
    // search inside the text has to look in them too.
    const nerd = url.searchParams.get('nerd') === '1'
    if (url.searchParams.get('only') === 'text') {
      return send(res, 200, { hits: await files.grep(root, url.searchParams.get('q') || '', nerd) })
    }
    const changed = await files.changed(root, story?.head_at_start)
    if (url.searchParams.get('only') === 'changed') return send(res, 200, { changed, now: Date.now() })
    const all = await files.list(root)
    return send(res, 200, {
      root,
      name: projectName(root),
      title: story?.title ?? null,
      git: all.git,
      truncated: all.truncated,
      changed,
      files: all.files,
      // What this machine can do about a file, so the viewer greys the buttons out and says why
      // rather than offering something that would quietly do nothing.
      can: {
        reveal: capabilities.revealInFileManager,
        open: capabilities.openInFileManager,
        whyNot: why('revealInFileManager') || why('openInFileManager'),
      },
      now: Date.now(),
    })
  }

  if (resource === 'file') {
    // `reveal` carries the path in its body the way the other two carry it in the query: it is
    // read from wherever it arrives and then they all go through the same guard.
    const body = req.method === 'POST' ? await readBody(req) : null
    const repo = body ? body.repo : url.searchParams.get('repo')
    const rel = body ? body.path : url.searchParams.get('path')
    const root = rootOf(repo)
    const abs = root && rel ? files.safePath(root, rel) : null
    if (!abs) return send(res, 400, { error: 'That file is outside the repository' })
    if (!fs.existsSync(abs)) return send(res, 404, { error: 'File not found' })

    // The bytes as they are: that is how images and PDFs get seen. With `dl`, the same bytes
    // but announced to the browser as an attachment: the button that carries the file away
    // exactly as it is.
    if (idRaw === 'raw' && req.method === 'GET') {
      const size = fs.statSync(abs).size
      const head = { 'content-type': files.mimeOf(abs), 'content-length': size, 'cache-control': 'no-store' }
      if (url.searchParams.get('dl')) head['content-disposition'] = files.attachment(path.basename(abs))
      else if (files.isPage(abs)) head['content-security-policy'] = SANDBOX
      res.writeHead(200, head)
      return fs.createReadStream(abs).pipe(res)
    }

    // The document laid out on paper. Not the browser's print dialog: a finished file, which
    // lands in your downloads and can be sent to somebody.
    if (idRaw === 'pdf' && req.method === 'GET') {
      const file = files.read(abs)
      if (file.kind !== 'markdown' && file.kind !== 'text') {
        return send(res, 400, { error: 'Only documents come out on paper' })
      }
      const page = `http://127.0.0.1:${PORT}/files.html?${new URLSearchParams({ repo: root, f: rel, pdf: '1' })}`
      let out
      try {
        out = await pdf.render(page)
      } catch (e) {
        return send(res, 500, { error: e.message })
      }
      // The same name the viewer puts on the page: the title written in the front matter, and
      // only failing that the file's name — without its extension, which here is `.pdf`, and
      // nobody wants two extensions stuck together.
      const named = file.kind === 'markdown' ? titleOf(matter(file.text).data) : null
      const base = path.basename(abs, path.extname(abs))
      res.writeHead(200, {
        'content-type': 'application/pdf',
        'content-length': out.length,
        'cache-control': 'no-store',
        'content-disposition': files.attachment(`${named || base}.pdf`),
      })
      return res.end(out)
    }

    // One button, two neighbouring things: a file is pointed at inside its folder, a folder is
    // opened. Which of the two is decided here rather than in the page, because the page would
    // have to guess and the disk already knows.
    if (idRaw === 'reveal' && req.method === 'POST') {
      if (fs.statSync(abs).isDirectory()) await files.openFolder(abs)
      else await files.reveal(abs)
      return send(res, 200, { ok: true })
    }

    // The first thing k0 writes into one of your repositories. Only configuration and notes, only
    // a file that is already there, and only if nobody has touched it since the page read it.
    if (idRaw === 'save' && req.method === 'POST') {
      if (!files.isEditable(rel)) return send(res, 400, { error: 'This kind of file is not edited here' })
      if (typeof body.text !== 'string') return send(res, 400, { error: 'Nothing to save' })
      if (Buffer.byteLength(body.text) > MAX_SAVE) return send(res, 400, { error: 'That is too big to save from here' })
      try {
        return send(res, 200, files.write(abs, body.text, Number(body.mtime)))
      } catch (e) {
        return send(res, e.conflict ? 409 : 500, { error: e.message })
      }
    }
    if (!idRaw && req.method === 'GET') return send(res, 200, { path: rel, ...files.read(abs) })
  }

  // The `+` on the dashboard. It stays where it is and answers with the flat row the board has
  // always drawn — the backlog's own door is `/api/backlog/story`, which resolves keys and writes
  // the `.k0/` file. What it does take from over there is the closed set: a key is the server's to
  // hand out, whichever door the story comes in by.
  if (resource === 'story' && req.method === 'POST' && !idRaw) {
    const b = await readBody(req)
    if (!b.title?.trim() || !b.project_path) return send(res, 400, { error: 'Title and repository are required' })
    const story = db.createStory({ ...only(NEW_STORY, b), title: b.title.trim(), project_path: b.project_path })
    return wrote(res, story, mirrorStory(story.id))
  }

  if (resource === 'story' && id) {
    const story = db.getStory(id)
    if (!story) return send(res, 404, { error: 'Story not found' })

    if (req.method === 'PATCH') {
      const b = await readBody(req)
      // The `Done` button on a post-it is this request, so the one refusal the whole feature
      // exists for has to live here as well as on `/api/backlog/story/:id` — a rule that the most
      // used button in k0 walks straight past is not a rule. With the backlog switched off there
      // are no decisions to have broken and nothing here ever says no.
      const done = closing(b)
      if ((done || b.state === 'Done') && backlog.enabled()) {
        const may = backlog.mayFinish(id)
        if (!may.ok) return send(res, 409, { error: may.why, violations: may.violations })
      }
      let updated = db.patchStory(id, b)
      // Done closes the terminal too, and it does it BEFORE marking the story: finished work
      // must not leave behind a window k0 has stopped watching.
      if (done && story.session_id) {
        await closeTerminal({ winId: story.terminal_window_id, pid: readLiveSessions().get(story.session_id)?.pid })
      }
      if ('completed' in b) updated = db.setCompleted(id, done)
      // A story's name is the session's name: if the title changes — and only the title, the
      // prompt has nothing to do with it — it has to change over there too.
      if (story.session_id && sessionName(updated.title) !== sessionName(story.title)) {
        const name = sessionName(updated.title)
        // In the window's title bar it shows immediately, session running or not.
        await setWindowTitle(story.terminal_window_id, name)
        // In the transcript only once the session has ended: a live process would write the
        // old name back over it. `tick` takes care of that when the session dies. The path is
        // the one from BEFORE the change: that is where the transcript stayed, even if you
        // changed repository in the same move.
        if (!story.session_alive) renameSession(story.project_path, story.session_id, name)
      }
      // The readable copy follows an edit made on the board exactly as it follows one made by a
      // skill: the title in the file's name is the title, and a story renamed here would otherwise
      // leave `K42-fix-api.md` sitting next to `K42-fix-the-api.md` with nothing to say which is
      // the story. A move to another repository leaves its old file behind, and that file is not
      // litter — `importRepo` reads it back, and the story would come alive where it no longer is.
      const left =
        updated.project_path === story.project_path
          ? null
          : mirroring(() => mirror.removeStory(story.key, story.project_path))
      for (const epicId of new Set([story.epic_id, updated.epic_id].filter(Boolean))) mirrorEpic(epicId)
      return wrote(res, updated, mirrorStory(id) ?? left)
    }

    if (req.method === 'DELETE') {
      // The same family as the backlog's own door: the tasks go with the story, and so do their
      // files, or `importRepo` brings them back as work of their own the next time it reads.
      const going = family(story)
      for (const s of going) if (s.session_id) forgetSession(s.session_id)
      db.deleteStory(id)
      const gone = going.map((s) => mirroring(() => mirror.removeStory(s.key, s.project_path))).find(Boolean)
      const epics = new Set(going.map((s) => s.epic_id).filter(Boolean))
      const counted = [...epics].map(mirrorEpic).find(Boolean)
      return wrote(res, { ok: true }, gone ?? counted)
    }

    // Bringing this session's window back to the front: the double click on the post-it.
    //
    // Two answers were one before: a window that has gone and a session that has gone are not the
    // same thing at all, and saying "that window is gone" about a session still thinking in a
    // terminal somebody closed was the board telling him something untrue. So the window is looked
    // for by name before anything is declared, the id that worked is written down — otherwise the
    // next double click would go through the same search — and when there really is no window
    // left, whether the session is still alive is part of the answer, because it decides what he
    // can do about it.
    if (req.method === 'POST' && action === 'focus') {
      const out = await focusWindow(story.terminal_window_id, story.title)
      if (out.handle && String(out.handle) !== String(story.terminal_window_id)) {
        db.setTerminalWindow(id, out.handle)
      }
      if (out.ok) return send(res, 200, { ok: true })
      const alive = !!story.session_id && readLiveSessions().has(story.session_id)
      return send(res, 200, {
        ...out,
        error: alive ? 'Its window was closed, but the session is still running.' : out.error,
        resumable: !!story.session_id,
      })
    }

    // Closing the terminal without closing the work: the same two moves as Done — stop the
    // session, shut its window — and none of the marking. The story stays where it is, with the
    // status it had, and Resume picks the conversation up where it was.
    if (req.method === 'POST' && action === 'close') {
      if (!story.session_id) return send(res, 400, { error: 'This story has no session' })
      // The board is up to a second behind, so a story that was idle when it was clicked may have
      // started thinking since. Nothing that is working gets stopped from here.
      if (busy(story.status)) return send(res, 409, { error: 'It is working: let it finish' })
      const pid = readLiveSessions().get(story.session_id)?.pid
      const out = await closeTerminal({ winId: story.terminal_window_id, pid })
      db.setTerminalWindow(id, null) // that window is gone; Resume opens a new one
      db.setAutoClosed(id, false) // this one was you: the post-it must not say otherwise
      tick() // so the answer already carries the closed story, without waiting for the loop
      return send(res, 200, { ...out, story: db.getStory(id) })
    }

    if (req.method === 'POST' && (action === 'start' || action === 'resume')) {
      const b = await readBody(req).catch(() => ({}))
      return await startSession(res, id, b, { resume: action === 'resume' })
    }
  }

  return send(res, 404, { error: 'No such endpoint' })
}

// ── Static files ─────────────────────────────────────────────────────────────
function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const file = path.join(WEB, rel)
  if (!file.startsWith(WEB) || !fs.existsSync(file)) {
    res.writeHead(404).end('Not found')
    return
  }
  // Nothing here is cached, and that is deliberate. These files have no version in their names
  // and nothing rebuilds them, so with no instruction at all the browser decides for itself how
  // long to keep them — and a tab left open all day keeps the stylesheet it loaded that morning.
  // That turns "change a file, reload the page" into a promise k0 does not keep, and it does the
  // same after an update: the new app on disk, the old interface on screen. They are a few
  // kilobytes over loopback; there is nothing to save here and a whole class of confusion to
  // avoid.
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] || 'application/octet-stream',
    'cache-control': 'no-cache, no-store, must-revalidate',
  })
  fs.createReadStream(file).pipe(res)
}

http
  .createServer(async (req, res) => {
    if (!allowed(req.headers, PORT)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('k0 only answers to its own address on this machine.')
      return
    }
    const url = new URL(req.url, `http://${req.headers.host}`)
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url)
      serveStatic(res, url.pathname)
    } catch (err) {
      send(res, 500, { error: String(err.message || err) })
    }
  })
  .listen(PORT, '127.0.0.1', () => {
    // The settings file, written out with everything in it the first time k0 runs: it is the only
    // list of what can be changed, so it has to exist before anybody goes looking for it.
    settings.ensure()
    tick()
    // The mode is remembered, and at startup it puts the machine back as it was: the sleep
    // levers and, where needed, the size of the text and of the terminals left open. The server
    // restarts often — just working on k0's own code is enough — and the windows from before do
    // not notice: applying the mode REPAIRS that mismatch instead of adopting it.
    mode.start().then(async () => {
      const windows = await applyModeToWindows(db.listStories().map((s) => s.terminal_window_id))
      if (windows.error) console.log(`k0 — the terminals were left as they were: ${windows.error}`)
    })
    console.log(`k0 — dashboard on http://localhost:${PORT}`)
  })

// ── On the way out ───────────────────────────────────────────────────────────
// The first and only orderly shutdown this server has ever had, and it exists for one reason:
// a sleep block is system state, not something of ours held in memory. If k0 goes away while
// it is on, the machine never sleeps again — forever, with nobody knowing why. So whichever
// road the exit takes, it is released; the preference is left as it is and next time
// `mode.start()` puts everything back.
//
// `exit` alone is not enough: a service manager stops the server with a SIGTERM, which without
// a handler of its own skips the orderly exit and never comes through here.
process.on('exit', mode.stopNow)
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, () => {
    mode.stopNow()
    // A summary being written when the server goes down has nobody left to give it to.
    writer.stop()
    process.exit(0)
  })
}
