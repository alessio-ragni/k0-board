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
  setTerminalFont,
  relayoutWindows,
} from './launcher.js'
import * as mode from './mode.js'
import * as settings from './settings.js'
import { dueForClose } from './idle.js'
import { listProjects, onDisk, projectName } from './projects.js'
import { scanSessions } from './sessions.js'
import * as git from './git.js'
import * as changelog from './changelog.js'
import * as writer from './writer.js'
import * as files from './files.js'
import * as pdf from './pdf.js'
import * as machine from './machine.js'
import * as servers from './servers.js'
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
  for (const card of db.listCards()) {
    const { status, alive } = deriveStatus(card, live)
    // The session has just gone out: now that nobody is rewriting the transcript any more, we
    // put in it the name the card has today. That is how a rename made while the session was
    // running still reaches the list of sessions you can resume.
    if (card.session_id && card.session_alive && !alive) {
      renameSession(card.project_path, card.session_id, sessionName(card.title))
    }
    db.applyDerivedStatus(card.id, status, alive)

    // Where it is really working: with an isolated worktree that is not the repository, and a
    // worktree has a working tree of its own. Claude Code's session file tells us, the same
    // source the statuses come from. It is kept after the session ends too: if the worktree is
    // still sitting there with work in it, the card has to be able to say so.
    const cwd = card.session_id ? live.get(card.session_id)?.cwd : null
    if (cwd && cwd !== card.work_path) db.setWorkPath(card.id, cwd)
    dirs.add(card.project_path)
    dirs.add(cwd || card.work_path)
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
  rounds++
}

/**
 * Gives back the memory of the windows you have stopped using.
 *
 * It does exactly what the `Close` link on a card does, and on purpose the same three moves and
 * not a path of its own: stop the session, shut the window, forget the window. The card stays
 * where it is with the status it had, `session_id` is untouched, and `Resume` picks the
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
  const due = dueForClose({ cards: db.listCards(), live, hours })
  if (!due.length) return
  sweeping = true
  try {
    for (const card of due) {
      try {
        await closeTerminal({ winId: card.terminal_window_id, pid: live.get(card.session_id)?.pid })
        db.setTerminalWindow(card.id, null) // that window is gone; Resume opens a new one
        db.setAutoClosed(card.id, true)
        console.log(`k0 — "${card.title}" sat still for ${hours}h: its terminal is closed, Resume picks it up`)
      } catch (err) {
        // One window that refuses to go must not take the others with it, and must certainly not
        // take the server: nothing is awaiting this, so a rejection escaping here would end the
        // process outright. It runs unattended — the next round is the retry.
        console.error(`k0 — could not close the terminal of "${card.title}": ${String(err?.message || err)}`)
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
 * A card's git state. A session with a worktree of its own has a working tree of its own, and
 * that is its truth; the others share the repository's working tree, which belongs to
 * everybody — there, the only thing that really belongs to the session is the commits made
 * since it started, and those are counted from `head_at_start`.
 */
function cardGit(card) {
  const own = card.work_path && card.work_path !== card.project_path ? git.stateOf(card.work_path) : null
  if (own) return { ...publicGit(own), own: true, where: path.basename(card.work_path), mine: own.unpushed }
  const repo = git.stateOf(card.project_path)
  if (!repo) return null
  return { ...publicGit(repo), own: false, where: null, mine: git.sessionShare(repo.shas, card.head_at_start) }
}

function board() {
  // Looking at the board is the only thing that switches the load measurement on: reading the
  // process table costs, and with the tab closed nobody would be looking. See machine.js.
  machine.touch()
  lastBoard = Date.now()
  const live = readLiveSessions()

  const cards = onDisk(db.listCards()).map((c) => ({
    ...c,
    project_name: projectName(c.project_path),
    git: cardGit(c),
    load: machine.loadOf(live.get(c.session_id)?.pid),
  }))
  const paths = [...new Set(cards.map((c) => c.project_path))]
  // And the same for the dev servers: looking at the board is what makes k0 ask the machine
  // who is listening, and it asks only about the repositories in front of you.
  servers.touch(paths)

  // Live sessions no card claims: they weigh the same, and if the computer is struggling it is
  // fair to know there are three of them open outside here.
  const onBoard = new Set(cards.map((c) => c.session_id).filter(Boolean))
  const outside = [...live.keys()].filter((sid) => !onBoard.has(sid)).length

  return {
    // The columns are the projects with at least one card — and that still exist: a card is
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
    cards,
    // The repositories for the last column, the one you go through to reach the files of a
    // directory that has no cards at all. Real projects only: the directories under your home
    // that are just installed software do not belong (see `known` in projects.js).
    projects: listProjects()
      .filter((p) => p.known)
      .map((p) => ({ ...p, git: publicGit(git.stateOf(p.path)) })),
    machine: { ...machine.overview([...live.values()].map((s) => s.pid)), alive: live.size, outside },
    // What colour the icon in the tab should be: the same thing /api/status tells the icon in
    // the menu bar.
    urgent: attention(cards).urgent,
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
    now: Date.now(),
  }
}

// Attention order, the same one that sorts the board's columns.
const ORDER = ['ASK', 'PLANNED', 'IDLE', 'WORKING', 'PLANNING', 'BACKLOG', 'COMPLETED']
const WAITING = new Set(['ASK', 'PLANNED', 'IDLE'])

/**
 * The little the menu bar icon needs: what is waiting for you, and what colour it should turn.
 * It is separate from /api/board because it is asked for every two seconds.
 */
function status() {
  const { urgent, waiting } = attention(onDisk(db.listCards()))
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
  const cards = all.filter((c) => c.session_id && c.session_alive && !c.completed_at)
  const waiting = cards
    .filter((c) => WAITING.has(c.status))
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || (a.status_since ?? 0) - (b.status_since ?? 0))
  // If nothing is waiting but something is running, the icon still stays lit.
  const busy = cards.find((c) => c.status === 'WORKING' || c.status === 'PLANNING')
  return { urgent: waiting[0]?.status ?? busy?.status ?? null, waiting }
}

/**
 * The directories the viewer is allowed to open: the repositories k0 already knows, plus the
 * ones sessions are really working in — which with a worktree are not the same thing. A path
 * arriving from the address bar is not enough on its own: either it is in this list, or
 * nothing is read.
 */
function rootOf(repo) {
  if (!repo) return null
  const roots = new Set(listProjects().map((p) => p.path))
  for (const c of db.listCards()) {
    if (c.project_path) roots.add(c.project_path)
    if (c.work_path) roots.add(c.work_path)
  }
  return roots.has(repo) ? repo : null
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
          cards: r.cards,
        })),
      },
      null,
      2
    ),
  }
  return recap
}

async function api(req, res, url) {
  const seg = url.pathname.split('/').filter(Boolean) // ['api', 'card', '3', 'start']
  const [, resource, idRaw, action] = seg
  const id = Number(idRaw)

  if (resource === 'board' && req.method === 'GET') return send(res, 200, board())
  if (resource === 'status' && req.method === 'GET') return send(res, 200, status())
  if (resource === 'projects' && req.method === 'GET') return send(res, 200, listProjects())

  // ── What you have been doing ───────────────────────────────────────────────
  // Two halves, deliberately apart. The facts come back straight away and the page can already
  // show them; the write-up takes a model half a minute, so it is started and then asked
  // about, the same once-a-second poll the board and the viewer already live on.
  if (resource === 'changelog' && !idRaw && req.method === 'GET') {
    const data = await recapFor(url.searchParams.get('period'))
    return send(res, 200, { ...data.public, writer: writer.capability() })
  }
  if (resource === 'changelog' && idRaw === 'write') {
    const data = await recapFor(url.searchParams.get('period'), { fresh: false })
    if (req.method === 'POST') return send(res, 200, writer.write(data.key, data.payload))
    if (req.method === 'GET') return send(res, 200, writer.state(data.key))
  }

  // ── The four modes ─────────────────────────────────────────────────────────
  // One control, with two handles: the row of buttons on the board and the four entries in the
  // menu bar. The text in terminals that are already open changes STRAIGHT AWAY, not only in
  // the ones you open next — otherwise, to be able to read anything, you would have to close
  // everything and start again.
  //
  // The answer does not only say which mode we are in: it says whether it is holding. Whoever
  // clicked has to know now whether the lid is covered, not in a second's time.
  if (resource === 'mode' && req.method === 'POST') {
    const b = await readBody(req)
    await mode.setMode(b.mode)
    await setTerminalFont(db.listCards().map((c) => c.terminal_window_id))
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
    return send(res, 200, await relayoutWindows(db.listCards().map((c) => c.terminal_window_id)))
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
    // Duplicates are dropped here and not in the database: `card.session_id` has no uniqueness
    // constraint, and this is not the moment to add one to a database that already has data.
    const taken = new Set(db.sessionIds())
    const cards = []
    const skipped = []
    for (const it of items) {
      const raw = String(it.title || '').trim()
      const sessionId = String(it.session_id || '')
      if (!sessionId || !it.project_path || !raw) {
        skipped.push({ session_id: sessionId || null, why: 'session, repository and title are all required' })
        continue
      }
      // The same normalisation as the title field on the dashboard: a card's title is the
      // session's name, and importing must not create one of a different shape.
      const title = sessionName(raw)
      if (taken.has(sessionId)) {
        skipped.push({ session_id: sessionId, why: 'already on the board' })
        continue
      }
      taken.add(sessionId)
      cards.push(
        db.importCard({
          title,
          description: String(it.description || '').trim(),
          project_path: it.project_path,
          session_id: sessionId,
          started_at: it.started_at,
          ended_at: it.ended_at,
        })
      )
    }
    // A session that is still running takes on the colour of what it is doing right away.
    tick()
    return send(res, 200, { created: cards.length, skipped, cards })
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
    // The card is only there to say where the session started from, and it can be missing:
    // from a column you open the repository's files and that is all.
    const cardId = Number(url.searchParams.get('card'))
    const card = Number.isInteger(cardId) && cardId > 0 ? db.getCard(cardId) : null
    // Searching inside the files: the page asks for it as you type, and it needs neither the
    // listing nor git's state.
    // `nerd` is the switch in the page: with it on, the configuration files are listed, so the
    // search inside the text has to look in them too.
    const nerd = url.searchParams.get('nerd') === '1'
    if (url.searchParams.get('only') === 'text') {
      return send(res, 200, { hits: await files.grep(root, url.searchParams.get('q') || '', nerd) })
    }
    const changed = await files.changed(root, card?.head_at_start)
    if (url.searchParams.get('only') === 'changed') return send(res, 200, { changed, now: Date.now() })
    const all = await files.list(root)
    return send(res, 200, {
      root,
      name: projectName(root),
      title: card?.title ?? null,
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

  if (resource === 'card' && req.method === 'POST' && !idRaw) {
    const b = await readBody(req)
    if (!b.title?.trim() || !b.project_path) return send(res, 400, { error: 'Title and repository are required' })
    return send(res, 200, db.createCard({ ...b, title: b.title.trim() }))
  }

  if (resource === 'card' && id) {
    const card = db.getCard(id)
    if (!card) return send(res, 404, { error: 'Card not found' })

    if (req.method === 'PATCH') {
      const b = await readBody(req)
      let updated = db.patchCard(id, b)
      // Done closes the terminal too, and it does it BEFORE marking the card: finished work
      // must not leave behind a window k0 has stopped watching.
      if (b.completed === true && card.session_id) {
        await closeTerminal({ winId: card.terminal_window_id, pid: readLiveSessions().get(card.session_id)?.pid })
      }
      if ('completed' in b) updated = db.setCompleted(id, !!b.completed)
      // A card's name is the session's name: if the title changes — and only the title, the
      // prompt has nothing to do with it — it has to change over there too.
      if (card.session_id && sessionName(updated.title) !== sessionName(card.title)) {
        const name = sessionName(updated.title)
        // In the window's title bar it shows immediately, session running or not.
        await setWindowTitle(card.terminal_window_id, name)
        // In the transcript only once the session has ended: a live process would write the
        // old name back over it. `tick` takes care of that when the session dies. The path is
        // the one from BEFORE the change: that is where the transcript stayed, even if you
        // changed repository in the same move.
        if (!card.session_alive) renameSession(card.project_path, card.session_id, name)
      }
      return send(res, 200, updated)
    }

    if (req.method === 'DELETE') {
      if (card.session_id) forgetSession(card.session_id)
      db.deleteCard(id)
      return send(res, 200, { ok: true })
    }

    // Bringing this session's window back to the front: the double click on the card.
    if (req.method === 'POST' && action === 'focus') {
      return send(res, 200, await focusWindow(card.terminal_window_id))
    }

    // Closing the terminal without closing the work: the same two moves as Done — stop the
    // session, shut its window — and none of the marking. The card stays where it is, with the
    // status it had, and Resume picks the conversation up where it was.
    if (req.method === 'POST' && action === 'close') {
      if (!card.session_id) return send(res, 400, { error: 'This card has no session' })
      // The board is up to a second behind, so a card that was idle when it was clicked may have
      // started thinking since. Nothing that is working gets stopped from here.
      if (busy(card.status)) return send(res, 409, { error: 'It is working: let it finish' })
      const pid = readLiveSessions().get(card.session_id)?.pid
      const out = await closeTerminal({ winId: card.terminal_window_id, pid })
      db.setTerminalWindow(id, null) // that window is gone; Resume opens a new one
      db.setAutoClosed(id, false) // this one was you: the card must not say otherwise
      tick() // so the answer already carries the closed card, without waiting for the loop
      return send(res, 200, { ...out, card: db.getCard(id) })
    }

    if (req.method === 'POST' && (action === 'start' || action === 'resume')) {
      const resuming = action === 'resume' && card.session_id
      const sessionId = resuming ? card.session_id : crypto.randomUUID()
      if (!resuming) {
        if (card.session_id) forgetSession(card.session_id)
        db.attachSession(id, sessionId)
      }
      // From here on, this repository's commits belong to this session. Resuming does not
      // rewrite it: the starting mark stays the first one, otherwise the commits of the first
      // run would lose their owner. It goes before `launch`, which can be away for as long as
      // forty-five seconds.
      if (!resuming || !card.head_at_start) db.setHeadAtStart(id, await git.head(card.project_path))
      try {
        const out = await launch({ card: db.getCard(id), sessionId, mode: resuming ? 'resume' : 'start' })
        db.setTerminalWindow(id, out.winId)
        db.setAutoClosed(id, false) // there is a window again: whoever shut the last one is history
        tick()
        return send(res, 200, { ...out, card: db.getCard(id) })
      } catch (err) {
        // The terminal did not open: the card must not stay attached to a session that was
        // never born, or it would offer a "resume" that cannot work.
        if (!resuming) db.detachSession(id, card.session_id)
        return send(res, 500, { error: String(err.message || err) })
      }
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
    // levers and, where needed, the font size of terminals left open. The server restarts often
    // — just working on k0's own code is enough — and the windows from before do not notice:
    // applying the mode REPAIRS that mismatch instead of adopting it.
    mode.start().then(() => setTerminalFont(db.listCards().map((c) => c.terminal_window_id)))
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
