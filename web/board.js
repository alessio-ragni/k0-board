import { titleCase } from '/title.js'
import { initView, refit } from '/view.js'
import { weight, gb } from '/units.js'
import { setFavicon } from '/favicon.js'
import { split } from '/recency.js'
import { drawList, leaveList } from '/list.js'
import { search as fuzzy } from '/fuzzy.js'

// ── Statuses ───────────────────────────────────────────────────────
// The order is the attention priority inside a column: first whoever is waiting for you,
// then whoever is grinding away, backlog at the bottom. Change it here and the dashboard changes.
// The codes stay the database's own: only the label you see is in English.
const ORDER = ['ASK', 'PLANNED', 'IDLE', 'WORKING', 'PLANNING', 'BACKLOG', 'COMPLETED']

const LABEL = {
  ASK: 'Needs answer',
  PLANNED: 'Needs approval',
  IDLE: 'Your turn',
  WORKING: 'Working',
  PLANNING: 'Planning',
  BACKLOG: 'Backlog',
  COMPLETED: 'Done',
}

// The statuses where something is really running. The server holds the same rule — a browser
// cannot import a module that reads the filesystem — the way `ORDER` is already written twice.
const BUSY = new Set(['WORKING', 'PLANNING'])

const $ = (s) => document.querySelector(s)
const api = async (url, opts) => {
  const r = await fetch(url, { headers: { 'content-type': 'application/json' }, ...opts })
  const body = await r.json()
  if (!r.ok) {
    // The refusal carries more than a sentence — the decisions the counter-check found broken
    // come with it — and throwing only `body.error` was how they were lost between the server
    // saying which rule was broken and the board telling the user something was.
    const err = new Error(body.error || 'Something went wrong')
    err.body = body
    throw err
  }
  return body
}

/**
 * A refusal, with the decisions it is about named in it.
 *
 * `Run 3 found a decision broken` is true and useless on its own: it tells you to put something
 * right without saying what. The labels are `K7·D3` — an epic's key in front when the rule came
 * down from the epic — and they are the same names the panel and the `.k0/` file print, so
 * one of them is enough to find it. This is the only moment k0 talks about a broken decision to
 * somebody who is not already on the page where the evidence is.
 */
function refusal(e) {
  const broken = e.body?.violations ?? []
  if (!broken.length) return e.message
  return `${e.message}\n\n${broken.map((v) => `${v.label} — ${v.text}`).join('\n')}`
}

let projects = []
let editing = null // id of the story open in the editor, null = a new one
let editingStory = null // the whole story: Start needs to know whether a session exists already
let chosenProject = null
let lastSignature = ''

// The filters are the legend itself: click one to switch it off, and it stays as you left it.
const hidden = new Set(JSON.parse(localStorage.getItem('k0-hidden') || '["COMPLETED"]'))
const saveHidden = () => localStorage.setItem('k0-hidden', JSON.stringify([...hidden]))

// The repositories you have put away by hand. Unlike `held` this outlives the page: putting a
// column away is a decision, not a glance.
const folded = new Set(JSON.parse(localStorage.getItem('k0-folded') || '[]'))
const saveFolded = () => localStorage.setItem('k0-folded', JSON.stringify([...folded]))

// The columns open in this visit. Within one visit the set only ever grows: a column does not
// fold out from under you while you are working — it folds the next time the page loads. It is
// deliberately not remembered, so that reloading is what tidies the board up.
const held = new Set()

// Whether this board has a backlog behind it. The server holds the switch and says so on every
// round; with it off the board is the board it has always been, down to the buttons on a post-it.
let backlogOn = false

// Which shape the same stories come in: the board as it has always been, or a list. Remembered
// like the filters and the folded columns are, because it is the same kind of choice — how you
// want to look at the board, not what is on it. `kanban` is the default and the only answer the
// switch gives while the backlog is off.
//
// The key is the one the switch has always used, and only `list` is read out of it: a board that
// was left on the old `state` columns comes back as a kanban rather than as nothing, which is what
// a stored value nobody recognises would have meant.
let columnsMean = localStorage.getItem('k0-columns') === 'list' ? 'list' : 'kanban'
const byList = () => backlogOn && columnsMean === 'list'

// Which repository, for both views. Empty means all of them.
let repoFilter = localStorage.getItem('k0-repo-filter') || ''

// The epic the board is standing inside, `{ key, path }`, or null for the whole board. It
// survives a reload on purpose: going into an epic is where you decided to work, and a page that
// let go of it on every refresh would make it a place you cannot stay.
let laneEpic = readLane()

// Every epic k0 knows, kept from the last round: the editor's list is drawn from it, and so are
// the headings in the list view.
let allEpics = []

// The weight of each session: on to begin with, switched off from the gauge at the top.
let showLoad = localStorage.getItem('k0-load') !== '0'
let machine = null // how the computer is doing right now
let heaviest = null // the story eating the most, so only that one gets tinted

// ── Render ─────────────────────────────────────────────────────────
/** Coarse-grained time: to the second it was only noise. */
function since(ts, now) {
  if (!ts) return ''
  const m = Math.floor((now - ts) / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h`
  const d = Math.floor(h / 24)
  return d === 1 ? 'yesterday' : `${d} days`
}

/** A stable tilt: it depends on the id, so a story does not dance on every refresh. */
const tilt = (id) => (((id * 37) % 5) - 2) * 0.5

// ── What the backlog adds to a post-it ─────────────────────────────
// Four marks and one button. The marks are the name the story is called by, the epic it belongs to,
// whether it is waiting on something, and the flag; the button is the one thing to do with it next.
// Everything else about a story — its decisions, its rounds, its plan — is the panel in the list
// and not a note, and a post-it that tried to carry it would stop being a post-it. They are all
// drawn only when the server says there is a backlog: with it off the note is the note it has
// always been, down to the last element.

/** The story's name — `K42`, allocated once and never reused, never reassigned, never renamed. */
const keyMark = (story) => `<span class="key" title="${esc(story.key)}">${esc(story.key)}</span>`

/**
 * An epic's colour. Nothing stores one and nothing should: a colour somebody had to choose is one
 * more thing to choose, and it would then have to be kept in step with an epic that can be
 * renamed and moved. The key is a number that never changes, so the hue is worked out from it —
 * by the golden angle, which is what keeps K7 and K8 far apart instead of two shades of one
 * green. Two repositories both have a K7 and both get the same colour; on a board where their
 * notes stand side by side the label says which, and the colour was never the thing that did.
 */
const epicHue = (key) => Math.round((Number(String(key).replace(/\D/g, '') || 0) * 137.508) % 360)

/**
 * The epic, in its colour, and the way into it: click it and the board becomes that epic.
 *
 * Inside that epic it is not drawn at all. Every note in a lane belongs to the same one, so the
 * label would be the same pill repeated down the column saying what the strip at the top already
 * says — and it would be a way in to where you are standing. The foot is the quietest part of the
 * note and it has room for three marks, not for one of them said twice.
 */
function epicChip(story) {
  if (!story.epic_key) return ''
  if (laneEpic && laneEpic.key === story.epic_key && laneEpic.path === story.project_path) return ''
  const label = `${story.epic_key} ${story.epic_title ?? ''}`.trim()
  return `<button class="epic" style="--h:${epicHue(story.epic_key)}" title="${esc(
    `${label} — click to see only this epic`
  )}">${esc(label)}</button>`
}

/**
 * The one thing to do with this story next, and it is the server that decided it — see `nextStep`
 * in `server/backlog.js`. The note draws the answer and never has one of its own: these are the
 * same rules `/k0-next` reasons over, and a second copy of them in here would be a second answer to
 * one question from the day somebody edited one of the two.
 *
 * One button per note, not a row of them. It goes first, ahead of Start and Done, because it is the
 * thing you are being told to do. It answers whether it drew anything, because that is what decides
 * how loud Start is allowed to be next to it: `null` is an answer here — a story that came through
 * its counter-check clean is waiting for a person to press Done, and filling that in with a command
 * would be inventing work.
 */
function nextStepButton(story, btn) {
  const step = story.next_step
  if (!step || !(step.action || step.command)) return false
  btn(step.label, () => doNextStep(story), step.why)
  return true
}

/**
 * Doing it, wherever it was pressed — the note or a row in the list.
 *
 * The two things a suggestion can be: pick a closed conversation back up, or start a session
 * saying `/k0-plan K42`. A step that is neither is a step from a server newer than this page, and
 * doing nothing is the only honest answer left — guessing would put something on a command line.
 *
 * `/k0-work` asks the same question Quick Start asks, because it is the same act: it is the one
 * command here that goes and does the work, and doing it on a story that waits on something
 * unfinished is the moment the note you left yourself was for. The other commands only talk about
 * the story, and being asked before a discussion would be a question with nothing riding on it.
 */
async function doNextStep(story) {
  const step = story.next_step
  if (!step) return
  if (step.action === 'resume') return start(story.id, 'resume')
  if (!step.command) return
  if (step.command === 'k0-work' && !(await mayStart(story))) return
  startCommand(story, step.command)
}

/** What a story is still waiting for. Only what is not done: a dependency that closed is history. */
const waitingOn = (story) => (story.deps ?? []).filter((d) => d.state !== 'Done')

/**
 * The mark that says this one waits on something else.
 *
 * It warns and it does not stop: nothing here refuses to start a blocked story, and the button
 * that starts it asks once and then goes ahead. A backlog that will not let you work on what you
 * want is a backlog you stop using — so this is a note to yourself, drawn the size of one.
 */
function depMark(story) {
  const open = waitingOn(story)
  if (!open.length) return ''
  const list = open.map((d) => `${d.key} ${d.title} (${d.state})`).join(' · ')
  return `<span class="waits" title="${esc(`Waiting on ${list}`)}">${ICON.dep}${
    open.length > 1 ? open.length : ''
  }</span>`
}

/**
 * The flag, at the bottom right, mirroring the pencil at the top.
 *
 * It is a mark and not a target: it is put on from the pencil's dialog, where the rest of the
 * decisions about a story are taken. An empty outline sitting on every note waiting to be clicked
 * was a mark that was everywhere and therefore marked nothing.
 *
 * The note takes a border in the same colour, and that is the half that does the work: the point
 * of flagging something is to find it again from across the room, and a fifteen-pixel glyph cannot
 * be seen from there.
 */
const flagMark = (story) =>
  story.starred ? `<span class="flag" title="Flagged">${ICON.flag}</span>` : ''

// ── The epic you are standing in ───────────────────────────────────

function readLane() {
  try {
    const v = JSON.parse(localStorage.getItem('k0-epic') || 'null')
    return v && v.key && v.path ? { key: v.key, path: v.path } : null
  } catch {
    return null // a lane that cannot be read is no lane: the whole board is the safe answer
  }
}

/** Go into an epic, or come back out of it with null. */
function setLane(lane) {
  laneEpic = lane
  if (lane) localStorage.setItem('k0-epic', JSON.stringify(lane))
  else localStorage.removeItem('k0-epic')
  lastSignature = ''
  refresh()
}

const enterEpic = (story) => setLane({ key: story.epic_key, path: story.project_path })

/**
 * The epic the board is inside, as the server describes it — the title and the progress are its
 * to say, not something worked out here from the notes that happen to be on screen.
 *
 * An epic that is not in the answer any more has been deleted, or its repository has left this
 * machine. Then the way out is taken for you: standing in a lane that no longer exists is an
 * empty board with nothing on it to explain itself.
 */
function currentEpic(data) {
  if (!backlogOn || !laneEpic) return null
  const found = (data.epics ?? []).find((e) => e.key === laneEpic.key && e.project_path === laneEpic.path)
  if (!found) {
    laneEpic = null
    localStorage.removeItem('k0-epic')
  }
  return found ?? null
}

function postit(story, now) {
  const el = document.createElement('article')
  el.className = `postit ${story.status}${backlogOn && story.starred ? ' flagged' : ''}`
  el.dataset.id = story.id
  el.style.transform = `rotate(${tilt(story.id)}deg)`

  const alive = story.session_id && story.session_alive && !story.completed_at
  const dead = story.session_id && !story.session_alive && !story.completed_at
  el.title = alive
    ? 'Double-click to bring its terminal up front'
    : story.completed_at
      ? ''
      : story.session_id
        ? 'Double-click to pick the conversation up where it was'
        : 'Double-click to open a session on it'

  // On a finished story there is nothing left to edit: the bin takes the pencil's place.
  const corner = story.completed_at
    ? { icon: ICON.del, label: 'Delete', cls: 'corner del', act: () => remove(story) }
    : { icon: ICON.edit, label: 'Edit', cls: 'corner', act: () => openEditor(story) }

  el.innerHTML = `
    <button class="${corner.cls}" title="${corner.label}" aria-label="${corner.label}">${corner.icon}</button>
    <div class="head">${backlogOn ? keyMark(story) : ''}<span class="tag">${esc(story.project_name)}</span>${gitChip(
      story.git,
      // A session with a worktree of its own also has files of its own: that is the directory
      // to open. But only while the worktree really exists — `own` comes from the server,
      // which has just read that directory's git state.
      story.git?.own ? story.work_path : story.project_path,
      story.id
    )}${loadChip(story)}</div>
    <div class="title">${esc(story.title)}</div>
    ${
      // Description and prompt travel together in one box, and that box is the only part of the
      // story allowed to shrink: whatever the text does, the repository, the title, the age and
      // the buttons stay where they are.
      story.description || story.prompt
        ? `<div class="body">
             ${story.description ? `<div class="desc">${esc(story.description)}</div>` : ''}
             ${story.prompt ? `<div class="prompt">${esc(story.prompt)}</div>` : ''}
           </div>`
        : ''
    }
    <div class="foot">
      ${
        // The epic and what the story is waiting for: two marks on the line that was already there,
        // rather than a row of their own. The flag is not among them — it is hung in the corner,
        // where it can be seen without reading the note.
        backlogOn ? `${epicChip(story)}${depMark(story)}` : ''
      }
      ${
        // Whoever shut the window, said in the same breath and the same weight — this line is
        // already only an italic, and it stays one. Which of the two it is does not need its own
        // place in the redraw signature: `auto_closed` never moves without `session_alive`
        // moving with it, and that one is in there.
        dead ? `<span class="dead">${story.auto_closed ? 'closed automatically' : 'session closed'}</span>` : ''
      }
      <span class="since" title="${LABEL[story.status]} for ${since(story.status_since, now)}">${since(story.status_since, now)}</span>
    </div>
    <div class="actions"></div>
    ${backlogOn ? flagMark(story) : ''}`

  // The only way to open the editor: clicking the story itself no longer does anything.
  el.querySelector('.corner').onclick = (e) => {
    e.stopPropagation()
    corner.act()
  }

  // The one mark in the foot that does something. `stopPropagation` for the same reason the corner
  // has it: the note answers a double click by bringing its terminal up, and this is not a way of
  // asking for that.
  const chip = el.querySelector('.epic')
  if (chip)
    chip.onclick = (e) => {
      e.stopPropagation()
      enterEpic(story)
    }

  const actions = el.querySelector('.actions')
  const btn = (text, fn, title, cls) => {
    const b = document.createElement('button')
    b.textContent = text
    if (title) b.title = title
    if (cls) b.className = cls
    b.onclick = (e) => {
      e.stopPropagation()
      fn()
    }
    actions.append(b)
  }

  if (story.completed_at) {
    btn('Reopen', () => setCompleted(story.id, false))
  } else if (!story.session_id) {
    // What to do next comes first, and where there is one Quick Start goes to the end of the row as
    // a link — the same place Close takes for the same reason. They are the two roads out and they
    // are not the same road: the suggestion opens a session on `/k0-discuss K42` and takes the long
    // way round, Quick Start opens an empty one and leaves the typing to you. Where there is no
    // suggestion Quick Start is the button it has always been.
    const suggested = backlogOn && nextStepButton(story, btn)
    if (!suggested) btn('Quick Start', () => startStory(story))
    // And Done beside it, once there is a backlog behind the board. A story with no session is not
    // only an idea nobody has touched: it is also the ordinary shape of one planned here and then
    // worked on in a terminal the user opened himself, or checked over by hand. `Done` is the only
    // thing in k0 that closes a story, so without this there is no way to close that one at all —
    // and the backlog's own rule is that any state may follow any other, Backlog to Done included.
    // Switched off, the post-it is exactly the post-it it has always been.
    if (backlogOn) btn('Done', () => setCompleted(story.id, true), 'close this job')
    if (suggested) btn('Quick Start', () => startStory(story), 'open a session on it and type there yourself', 'link')
  } else {
    // A session that is running needs no button at all: the terminal is where the work is, and a
    // double click on the note goes there. One that has ended is a conversation waiting to be
    // picked up, and that is the suggestion the server gives back — so with a backlog behind the
    // board Resume arrives as the suggestion, and the line under it is only for a board with the
    // backlog switched off, where nothing suggests anything.
    const suggested = backlogOn && nextStepButton(story, btn)
    if (dead && !suggested) btn('Resume', () => start(story.id, 'resume'))
    btn('Done', () => setCompleted(story.id, true), 'close this job and its terminal')
    // Close gives the memory back without declaring the work over, and it comes after Done, as a
    // link rather than a button: it is the rarer of the two and should not compete with it. Not
    // while the session is working — stopping one mid-thought is not memory saved, it is work lost.
    if (!dead && !BUSY.has(story.status))
      btn(
        'Close',
        () => closeSession(story.id),
        'stop the session and its terminal, and leave the story where it is',
        'link'
      )
  }

  // The git mark is a link: a double click on it would open two tabs and bring the terminal to
  // the front into the bargain. Double clicks do not reach it.
  el.querySelector('.git')?.addEventListener('dblclick', (e) => e.stopPropagation())

  // Double click: into the work, whatever state the note is in. Its terminal if one is running,
  // the conversation it left behind if there is one, and a fresh session if there is neither — a
  // gesture that does nothing on half the notes is a gesture nobody ends up trusting.
  el.ondblclick = (e) => {
    if (story.completed_at) return
    e.preventDefault()
    if (alive) return focusTerminal(story.id)
    if (story.session_id) return start(story.id, 'resume')
    startStory(story)
  }
  return el
}

// Few icons, all in the same stroke: the pencil opens the editor, the bin throws away, the
// "+" gives birth to a story. The same "+" as the one in the bar at the top.
const ICON = {
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  // Put this column away: it slides off to the right, where `Old` is.
  fold: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6l6 6-6 6"/><path d="M19 5v14"/></svg>',
  // The dev server: a world, because what is behind it is a site. A meridian and a parallel are
  // enough to read it at twelve pixels — more lines and it goes back to being a circle.
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><ellipse cx="12" cy="12" rx="4" ry="9"/></svg>',
  // Waiting on something else: a link of a chain, because that is what a dependency is. Broken in
  // the middle, because it is the half that has not arrived that the mark is about.
  dep: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 14l4-4"/><path d="M13.5 7.5l1-1a3.5 3.5 0 1 1 5 5l-1 1"/><path d="M10.5 16.5l-1 1a3.5 3.5 0 1 1-5-5l1-1"/></svg>',
  // Flagged. Filled, and drawn once — there is no empty flag, because the mark is only ever on a
  // note that has one: an outline on every other note is a mark that says nothing.
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21V4"/><path d="M6 4.5h11.5l-2.4 3.8 2.4 3.7H6" fill="currentColor"/></svg>',
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// ── The git mark ───────────────────────────────────────────────────
// One symbol, on the story and above the column: what is needed is to see at a glance whether
// anything is still outstanding. The rest — which branch, how many files, how many commits, and
// how many of those commits belong to this session — is read by hovering over it, the way the
// time at the bottom of a story already works.
const GIT_ICON = {
  // Things that are nowhere yet: the filled dot editors use.
  dirty: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5.5"/></svg>',
  // Safe locally, but not on the remote.
  push: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V6M6 12l6-6 6 6"/></svg>',
  // All saved: it is there, but it has to disappear into the background.
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5.5 5.5L20 7"/></svg>',
  // Where there is no git there is nothing to say: the lens still leads to the files.
  files: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.2-4.2"/></svg>',
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

function gitDetail(g) {
  const bits = [g.where ? `worktree ${g.where}` : g.branch || 'detached HEAD']
  bits.push(g.dirty ? `${plural(g.dirty, 'file')} not committed` : 'nothing to commit')
  // With no remote configured there is no point talking about pushing: there is simply no push.
  if (!g.remote) bits.push('no remote')
  else if (g.unpushed > 0) {
    const mine = g.own ? ', all from this session' : g.mine > 0 ? `, ${g.mine} from this session` : ''
    bits.push(`${plural(g.unpushed, 'commit')} not pushed${mine}`)
  } else bits.push('everything pushed')
  return bits.join(' · ')
}

/**
 * The git mark is also the door to the files: clicking it opens the viewer in another tab, and
 * the board stays where it is. Where there is no mark — a repository without git, or git that
 * has not answered yet — a lens goes in its place, so every story and every column still leads
 * in.
 */
function gitChip(g, repo, story) {
  const to = esc(`/files.html?repo=${encodeURIComponent(repo)}${story ? `&story=${story}` : ''}`)
  const open = 'click to see the files'
  if (!g) return `<a class="git none" href="${to}" target="_blank" title="${open}">${GIT_ICON.files}</a>`
  const kind = g.dirty > 0 ? 'dirty' : g.unpushed > 0 ? 'push' : 'ok'
  const n = kind === 'dirty' ? g.dirty : kind === 'push' ? g.unpushed : ''
  return `<a class="git ${kind}" href="${to}" target="_blank" title="${esc(gitDetail(g))} · ${open}">${
    GIT_ICON[kind]
  }${n}</a>`
}

// ── The dev server ────────────────────────────────────────────────────
// The globe next to a repository's name: grey when its server is off, green when it is up,
// spinning while it is coming up, red when it tried and could not. One click switches it, two
// restart it, and when it is green the repository's name becomes the way into the site.
//
// The four states are the ones the server sends; nothing is guessed here. The only thing the
// page knows that the server does not is that a click has just happened and no answer has come
// back yet — which is what `switching` is for.
const switching = new Set()

/** Everything the globe knows, for the tooltip. Same idea as `gitDetail`: the detail is on hover. */
function serverDetail(s, state) {
  const bits = []
  if (state === 'up') bits.push(s.adopted ? `up on port ${s.port}, started outside k0` : `up on port ${s.port}`)
  else if (state === 'starting') bits.push('starting…')
  else if (state === 'failed') bits.push(s.error ? `it did not come up: ${s.error}` : 'it did not come up')
  else bits.push('the server is off')
  bits.push(s.command)
  if (state === 'up') bits.push('click to stop, double-click to restart')
  else if (state !== 'starting') bits.push('click to start')
  // Where it went wrong is worth more than any sentence about it going wrong.
  if (state === 'failed') bits.push(s.log)
  return bits.join(' · ')
}

/**
 * The globe, or nothing at all. A repository with no way to start a server does not get a
 * button that would quietly do nothing — the server sends null and this draws none.
 */
function serverChip(s, repo) {
  if (!s) return ''
  const state = switching.has(repo) ? 'starting' : s.state
  const title = serverDetail(s, state)
  const off = s.can.run ? '' : ' disabled'
  return `<button class="globe ${state}" title="${esc(title)}" aria-label="${esc(title)}"${off}>${ICON.globe}</button>`
}

/**
 * One click switches, two restart, and they are fighting over the same first click.
 *
 * What settles it without being seen: when the server is OFF there is nothing to wait for,
 * because "start" and "restart" are the same thing there, so the click goes straight through.
 * Only STOPPING waits the quarter second it takes to learn whether a second click is coming —
 * and even that is invisible, because the globe starts spinning the moment it is pressed.
 */
function wireGlobe(el, repo, s) {
  if (!s.can.run) return
  if (s.state === 'starting' || switching.has(repo)) {
    el.disabled = true
    return
  }
  if (s.state !== 'up') {
    el.onclick = () => switchServer(repo, 'start')
    return
  }
  let timer = null
  el.onclick = () => {
    if (timer) return // the second click of a double: let `ondblclick` have it
    timer = setTimeout(() => {
      timer = null
      switchServer(repo, 'stop')
    }, 250)
  }
  el.ondblclick = () => {
    clearTimeout(timer)
    timer = null
    switchServer(repo, 'restart')
  }
}

async function switchServer(repo, action) {
  switching.add(repo)
  lastSignature = '' // the globe has to start spinning now, not at the next round
  await refresh()
  try {
    const s = await api('/api/server', { method: 'POST', body: JSON.stringify({ path: repo, action }) })
    if (s.state === 'failed') toast(s.error || 'The server did not come up. Hover the globe for the log.', 8000)
  } catch (err) {
    toast(err.message)
  } finally {
    switching.delete(repo)
    lastSignature = ''
    refresh()
  }
}

/** Just enough to compare one round with the next, exactly as `gitSig` does for git. */
const serverSig = (s) => (s ? `${s.state}/${s.port ?? ''}/${s.adopted ? 1 : 0}` : '')

// ── What a session weighs ────────────────────────────────────────────
/**
 * How much this session eats, counting everything it has opened underneath itself. The detail —
 * what is doing the eating in there — is read by hovering, and it is the answer to the real
 * question: why does this terminal weigh so much.
 */
function loadChip(story) {
  if (!showLoad || !story.load) return ''
  const l = story.load
  const bits = l.top.map((t) => `${t.name} ${Math.round(t.rss / 1048576)} MB`)
  if (l.cpu !== null) bits.push(`${Math.round(l.cpu * 100)}% CPU`)
  bits.push(`${l.procs} process${l.procs === 1 ? '' : 'es'}`)
  // Red on one only, and only while the machine is struggling: if they are all red they stop
  // saying anything, and it is not true that they all need closing.
  const hot = machine?.pressure !== 'ok' && story.id === heaviest
  return `<span class="load${hot ? ' hot' : ''}" title="${esc(bits.join(' · '))}">${weight(l.rss)}</span>`
}

/** Just enough to compare one round with the next: if it changes, it redraws. */
const gitSig = (g) => (g ? `${g.dirty}/${g.unpushed}/${g.own ? 1 : 0}/${g.mine ?? ''}` : '')

/**
 * How long this story has been where it is. Until it has ever changed status there is nothing in
 * `session_event` and `status_since` is empty: then it counts from when it came into existence,
 * otherwise a story just created would end up at the bottom of its group.
 */
const freshness = (c) => c.status_since ?? c.created_at ?? 0

/**
 * The order of attention: most urgent status first, and among equal statuses whichever entered
 * it last. It holds between the stories inside a column and — applied to the leading story —
 * between the columns on the board.
 */
const byAttention = (a, b) =>
  ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || freshness(b) - freshness(a)

function render(data) {
  const board = $('#board')

  // The list is a page that scrolls; the board is a surface that moves under a fixed window. The
  // class is what takes the one out of the other — see list.css — and it goes on before anything is
  // drawn, so nothing is ever measured in the wrong world.
  const asList = byList()
  // Emptying the board is how the kanban is redrawn, and in list mode it is exactly what must not
  // happen: the list keeps its two halves between redraws (see `drawList`), and an element taken
  // out of the document comes back scrolled to the top — which on a poll that runs once a second
  // is the panel losing the reader's place while they are reading it.
  if (!asList) board.textContent = ''
  board.classList.toggle('list', asList)
  $('#viewport').classList.toggle('list', asList)
  if (!asList) {
    board.classList.remove('open')
    leaveList()
  }

  // Inside an epic, the board is that epic. Everything below works on `pool` rather than on
  // `data.stories`, so the epic is a lens over the same board and not a second one: the filters
  // still filter, the columns still fold, the notes are the same notes.
  const inEpic = currentEpic(data)
  drawLane(inEpic)
  renderRepoFilter(data, inEpic)
  // The three things that decide what is in scope, applied once and before the fork: the epic lane,
  // the repository, and the status pills. Both views work on what comes out, which is what makes
  // switching between them a change of shape and never a change of what you are looking at.
  const only = inEpic ? '' : repoFilter
  const pool = data.stories.filter(
    (c) =>
      (!inEpic || (c.epic_key === inEpic.key && c.project_path === inEpic.project_path)) &&
      (!only || c.project_path === only)
  )
  const visible = pool.filter((c) => !hidden.has(c.status))

  if (asList) {
    // The epics go through the same two narrowings the stories did. They are not filtered by status
    // — an epic has none — but one belonging to a repository you have filtered away has no business
    // heading a group of nothing.
    const epics = (data.epics ?? []).filter(
      (e) =>
        (!inEpic || (e.key === inEpic.key && e.project_path === inEpic.project_path)) &&
        (!only || e.project_path === only)
    )
    drawList(board, { stories: visible, all: data.stories, epics }, LIST)
    // No message in the middle here: the list says for itself when there is nothing in it, and it
    // says it where the rows would have been rather than across the whole window.
    showEmpty(false, inEpic)
    return
  }

  const columns = (inEpic ? data.columns.filter((c) => c.path === inEpic.project_path) : data.columns)
    .map((col) => ({
      col,
      stories: visible.filter((c) => c.project_path === col.path).sort(byAttention),
    }))
    .filter(({ stories }) => stories.length)

  // In driving mode the columns queue up by attention too: a column is worth as much as its
  // leading story, and since the stories are sorted already, that first one is necessarily the most
  // urgent it has. One red is enough to bring it left; when that red moves into working, the
  // column slides right by itself. On a tie the alphabetical order from the server stands,
  // because `sort` is stable.
  //
  // But ONLY there. In driving mode you see two or three columns at a time, and bringing the most
  // urgent one to the left is the only way to see it without going to look for it. Full screen
  // they are all in front of you already: there is nothing to bring to anybody, and a board that
  // reshuffles itself while you work only loses your place. With the switch off the columns stand
  // still in alphabetical order — the server's, which is not touched here.
  if (data.mode === 'driving') columns.sort((a, b) => byAttention(a.stories[0], b.stories[0]))

  // Which of them are still warm. Everything else folds away into `Old` — see recency.js for the
  // four rules and for why the day is counted back from your last piece of work rather than from
  // the clock.
  //
  // Inside an epic none of that applies: you went in to look at one thing, and a lane that put
  // half of itself away would be answering a question you did not ask. Nothing is folded, and
  // nothing is remembered either — what you do in a lane must not decide what the board looks
  // like when you come back out of it.
  //
  // The repository filter is the same answer twice over. You asked for one repository; folding it
  // away for having been quiet would leave a board with nothing on it and the reason hidden inside
  // a dropdown, and the way back would be through the `Old` column that is not drawn either.
  const { open, alive } = inEpic || only
    ? { open: columns.map(({ col }) => col.path), alive: new Set() }
    : split({
        paths: columns.map((c) => c.col.path),
        stories: pool,
        folded,
        held,
      })
  // A column open now is open for the rest of the visit, and a column that is open is not one
  // you have put away: a session woke up in there, or you went and fetched it back yourself.
  let forget = false
  if (!inEpic && !only)
    for (const p of open) {
      held.add(p)
      if (folded.delete(p)) forget = true
    }
  if (forget) saveFolded()

  const openSet = new Set(open)
  for (const { col, stories } of columns.filter(({ col }) => openSet.has(col.path))) {
    const wrap = document.createElement('section')
    wrap.className = 'column'
    // The "+" next to the name: a new story on THIS repository, without picking it.
    const add = `New story in ${esc(col.name)}`
    // And next to it, the one that puts the column away without waiting for it to go quiet on
    // its own. It sits there in plain sight next to the `+`, because a button you have to go
    // hunting for with the pointer is a button nobody knows exists.
    //
    // Where the column cannot be put away it goes faint and refuses, rather than not being drawn
    // at all. Not being drawn was the first idea and it was the wrong one: a column runs and
    // goes back to your turn every few seconds, so the button would have spent the whole session
    // blinking in and out — and it would have done it on exactly the columns you are working on.
    // A control that stays where it was and says why it will not move is worth more than one
    // that is only there when it agrees with you. The title carries the reason.
    //
    // In a lane there is no fold at all. There is one column and it is the epic: putting it away
    // would leave an empty board with a strip at the top saying which epic it is empty of.
    const live = alive.has(col.path)
    const away = live ? `${col.name} has something going on: it cannot be put away` : `Put ${col.name} away`
    const fold = inEpic
      ? ''
      : `<button class="fold" title="${esc(away)}" aria-label="${esc(away)}"${
          live ? ' disabled' : ''
        }>${ICON.fold}</button>`
    // Two groups and a name between them: what you press on the left, what tells you how things
    // stand on the right. The count of post-its that used to sit after the name is gone — it
    // took up the room the name now uses, and it never answered a question anybody had.
    //
    // With the server up, the name is the door to it. It is the right thing to click for the
    // same reason the git mark is the right thing to click to reach the files: the obvious
    // gesture on the obvious word, leaving the globe free to mean only on and off.
    const url = col.server?.state === 'up' ? col.server.url : null
    const name = url
      ? `<a class="name" href="${esc(url)}" target="_blank" title="${esc(url)}">${esc(col.name)}</a>`
      : `<span class="name">${esc(col.name)}</span>`
    wrap.innerHTML = `<h2><button class="add" title="${add}" aria-label="${add}">${
      ICON.plus
    }</button>${fold}${name}${gitChip(col.git, col.path)}${serverChip(col.server, col.path)}</h2>`
    wrap.querySelector('.add').onclick = () => openEditor(null, col.path)
    const folder = wrap.querySelector('.fold')
    if (folder) folder.onclick = () => putAway(col.path)
    const globe = wrap.querySelector('.globe')
    if (globe) wireGlobe(globe, col.path, col.server)
    for (const c of stories) wrap.append(postit(c, data.now))
    board.append(wrap)
  }

  // The two columns on the right are about the repositories that are NOT in front of you, which is
  // a question a lane has already answered — there is one repository in here, and it is this one —
  // and which the repository filter answers the same way.
  if (!inEpic && !only) {
    board.append(oldColumn(columns.filter(({ col }) => !openSet.has(col.path))))
    board.append(repoColumn(data.projects ?? [], new Set(columns.map((c) => c.col.path))))
  }
  showEmpty(columns.length === 0, inEpic, only)
  refit() // the board changed size: the view comes back inside its limits
}

/**
 * The line in the middle of an empty board, and what it should say.
 *
 * "Add your first story" is right on a board with nothing on it and wrong everywhere else: inside
 * an epic it is not the dashboard that is empty, and behind a repository filter it is not the
 * dashboard that is being looked at. A message that answers the wrong question sends you looking
 * for a fault that is not there.
 */
function showEmpty(empty, inEpic, only = '') {
  const el = $('#empty')
  el.style.display = empty ? 'grid' : 'none'
  if (!empty) return
  if (inEpic) el.textContent = `Nothing in ${inEpic.key} yet — or the filters have put it all away.`
  else if (only) el.textContent = `Nothing in ${nameOf(only)} — or the filters have put it all away.`
  else el.textContent = 'The dashboard is empty. Add your first story.'
}

// ── The epic you are standing in ───────────────────────────────────

/**
 * The strip under the top bar: which epic, how far it has got, and the way out.
 *
 * The progress is the server's arithmetic and not this page's — done over total, no weighting,
 * counted over the stories of the epic and not over the notes that happen to be on screen. Half
 * of them can be hidden by a filter; that does not make the epic half finished.
 */
function drawLane(epic) {
  const bar = $('#epic-lane')
  bar.hidden = !epic
  if (!epic) return
  const { done, total } = epic.progress
  bar.style.setProperty('--h', epicHue(epic.key))
  $('#epic-key').textContent = epic.key
  $('#epic-name').textContent = epic.title
  $('#epic-repo').textContent = epic.project_name
  $('#epic-fill').style.width = `${total ? Math.round((done / total) * 100) : 0}%`
  $('#epic-count').textContent = `${done} of ${total} done`
}

/** Everything the repository menu can offer, newest board first. `''` is all of them. */
let repoOptions = [['', 'All repositories']]

/**
 * Which repository both views are showing, when they are showing one.
 *
 * Only the list is kept here; drawing it is `paintRepoList`, which happens when the menu is opened
 * and not on every redraw of the board. The board is asked for once a second, and rebuilding rows
 * under an open menu is how a menu closes itself out from under the pointer.
 */
function renderRepoFilter(data, inEpic) {
  // Whether it is on the bar at all belongs to `renderColumnsSwitch`, which is the only place that
  // knows all the answers. Here there is only what is in it.
  if (inEpic) return
  // A repository that has no stories left has no column and cannot be filtered to: keeping it
  // would leave the board empty with the reason hidden inside a menu nobody has opened.
  if (repoFilter && !data.columns.some((c) => c.path === repoFilter)) chooseRepo('')
  repoOptions = [['', 'All repositories'], ...data.columns.map((c) => [c.path, c.name])]
  $('#repo-filter-btn').textContent = repoOptions.find(([v]) => v === repoFilter)?.[1] ?? 'All repositories'
}

/** The rows of the repository menu, narrowed by what has been typed into it. */
function paintRepoList(query = '') {
  const rows = fuzzy(repoOptions, query, ([, label]) => label)
  $('#repo-filter-rows').innerHTML = rows.length
    ? rows
        .map(([v, label]) => `<div role="option" data-repo="${esc(v)}" class="${v === repoFilter ? 'on' : ''}"
             aria-selected="${v === repoFilter}">${esc(label)}</div>`)
        .join('')
    : '<div style="color:var(--muted)">no repository with that name</div>'
}

/** Open or shut, in one place: the arrow on the button and the list itself always agree. */
function showRepoList(open) {
  $('#repo-filter-list').hidden = !open
  $('#repo-filter-btn').setAttribute('aria-expanded', String(open))
  if (!open) return
  $('#repo-filter-q').value = ''
  paintRepoList('')
  $('#repo-filter-q').focus()
}

function chooseRepo(path) {
  repoFilter = path
  if (path) localStorage.setItem('k0-repo-filter', path)
  else localStorage.removeItem('k0-repo-filter')
}

/**
 * The switch itself: which of the two is lit, and whether it is on the bar at all — and with it the
 * repository filter, which is on the bar exactly when the switch is.
 *
 * Both are hidden from here and not from the redraw because the redraw does not always happen:
 * switching the backlog off changes nothing the board compares, so the dropdown would have stayed
 * on the bar, still filtering, over a board that has no filter left to apply. Inside a lane there
 * is one repository and it was settled by going in, so there is nothing to choose there either.
 */
function renderColumnsSwitch() {
  $('#columns').hidden = !backlogOn
  const hide = !backlogOn || !!laneEpic
  // Shut before it goes: a menu left open under a hidden element comes back open the next time
  // the element does, over a board nobody asked it to cover.
  if (hide && !$('#repo-filter-list').hidden) showRepoList(false)
  $('#repo-filter').hidden = hide
  // And what the `+` promises. With a backlog behind the board it opens a menu with two things on
  // it, and a button whose label says one of them is a button that lied about the other.
  const plus = backlogOn ? 'New story or epic' : 'New story'
  $('#new-story').title = plus
  $('#new-story').setAttribute('aria-label', plus)
  for (const b of document.querySelectorAll('#columns button')) {
    b.setAttribute('aria-checked', b.dataset.columns === columnsMean ? 'true' : 'false')
  }
}

/** Put a column away by hand, and let go of the place it was holding for this visit. */
function putAway(path) {
  folded.add(path)
  held.delete(path)
  saveFolded()
  lastSignature = ''
  refresh()
}

/** Fetch one back: it stays for the rest of the visit, and folds again on the next load. */
function bringBack(path) {
  held.add(path)
  folded.delete(path)
  saveFolded()
  lastSignature = ''
  refresh()
}

/**
 * The second-to-last column: the repositories that DO have work on the board, just not lately —
 * nothing touched in the day before your most recent piece of work, and nothing alive inside.
 * They are the reason the board was three screens wide: a dozen of them, standing at full width
 * between the three you are actually on.
 *
 * They are folded, not thrown away. Click the row and the column comes back at full width for the
 * rest of the visit.
 *
 * It sits next to `Others` and is built the same way, down to the row: a `+`, a name, a git mark
 * and nothing else. How many stories are parked in there and how long it has been quiet were both
 * in here once, and both had to go — three numbers on a row you are meant to read at a glance is
 * two too many, and the answer to either is one click away in the column itself.
 */
function oldColumn(columns) {
  if (!columns.length) return document.createDocumentFragment()

  const wrap = document.createElement('section')
  wrap.className = 'column repos old'
  // Alphabetical, for the same reason `Others` is: these are rows you scan with your eye looking
  // for a name. In driving mode the columns above have queued up by urgency, and letting that
  // order through to here would be a list that reshuffles itself with nothing urgent in it.
  wrap.innerHTML =
    '<h2>Old<small>' +
    columns.length +
    '</small></h2>' +
    [...columns]
      .sort((a, b) => a.col.name.localeCompare(b.col.name, undefined, { sensitivity: 'base' }))
      .map(({ col }) => {
        const add = `New story in ${esc(col.name)}`
        const back = `Bring ${col.name} back onto the board`
        return `<div class="repo" data-p="${esc(col.path)}">
          <button class="add" title="${add}" aria-label="${add}">${ICON.plus}</button>
          <button class="name" title="${esc(back)}">${esc(col.name)}</button>${gitChip(col.git, col.path)}
        </div>`
      })
      .join('')
  // The whole row brings the column back, not only the name: at this size, asking for the four
  // words exactly is asking for a second click. The `+` and the git lens are the two things in
  // there that mean something else, and they keep meaning it.
  wrap.onclick = (e) => {
    const path = e.target.closest('.repo')?.dataset.p
    if (!path || e.target.closest('.git')) return
    if (e.target.closest('.add')) openEditor(null, path)
    else bringBack(path)
  }
  return wrap
}

/**
 * The last column: the OTHER repositories, the ones with no column because they have not one
 * story between them. Repeating the ones already on the left would be saying the same thing
 * twice. Headings only, in the order you last used them. It is there for two things: getting
 * into the files of a directory you are not working on, and giving birth to the first story
 * there without having to find it in a list.
 */
function repoColumn(projects, shown) {
  // In alphabetical order, not by recency: these are thirty rows you scan with your eye looking
  // for a name, and in a list that reorders itself you find nothing. Recency belongs in the
  // repository picker, where you type; not here.
  const others = projects
    .filter((p) => !shown.has(p.path))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  if (!others.length) return document.createDocumentFragment()

  const wrap = document.createElement('section')
  wrap.className = 'column repos'
  wrap.innerHTML =
    '<h2>Others<small>' +
    others.length +
    '</small></h2>' +
    others
      .map((p) => {
        const add = `New story in ${esc(p.name)}`
        return `<div class="repo" data-p="${esc(p.path)}">
          <button class="add" title="${add}" aria-label="${add}">${ICON.plus}</button>
          <span class="name">${esc(p.name)}</span>${gitChip(p.git, p.path)}
        </div>`
      })
      .join('')
  wrap.onclick = (e) => {
    const b = e.target.closest('.add')
    if (b) openEditor(null, b.closest('.repo').dataset.p)
  }
  return wrap
}

// ── The load gauge ─────────────────────────────────────────────────
/**
 * It lives outside `render`: it updates every round even when the board does not change, which
 * is nearly always. The colour is the kernel's judgement, not a threshold invented here: green
 * while it says all is well, amber at the first warning, red when it is critical.
 */
function renderMachine(m, stories, idleHours = 0) {
  const el = $('#gauge')
  if (!m?.mem) return el.setAttribute('hidden', '') // the first sample is not in yet
  el.removeAttribute('hidden')
  el.className = `gauge ${m.pressure}`

  const ram = Math.round((m.mem.used / m.mem.total) * 100)
  const cpu = m.cpu === null ? '—' : `${Math.round(m.cpu * 100)}%`
  // Whether anybody is looking after the memory for you, and after how long. It belongs on this
  // chip and nowhere else: this is where the memory is already being talked about, and a thing
  // that quietly closes your windows should not be something you have to know about beforehand.
  // Its presence is the whole message — switched off, there is nothing here rather than a nought.
  const closes = idleHours > 0 ? `<span class="idle">closes at ${idleHours}h</span>` : ''
  // RAM over CPU rather than side by side, and the closing time under them rather than beside them.
  // The four mode buttons went two by two to get the bar back onto one row, and this is the other
  // half of the same move: the chip gives back the width it was taking by going up instead of
  // along, and "· closes at 12h" written across was a hundred pixels of it on its own. The dot
  // stays beside the stack, centred on it.
  el.innerHTML = `<i></i><span class="nums"><span>RAM ${ram}%</span><span>CPU ${cpu}</span>${closes}</span>`

  const top = stories.find((c) => c.id === heaviest)
  const lines = [
    `${gb(m.mem.used)} of ${gb(m.mem.total)} in use · ${gb(m.swap.used)} on swap`,
    `${m.alive} session${m.alive === 1 ? '' : 's'} running${m.outside ? `, ${m.outside} not on the dashboard` : ''}`,
  ]
  if (top?.load) lines.push(`heaviest: ${top.title} — ${weight(top.load.rss)}`)
  // What is heavy and is not k0: without it, the board would take blame that belongs to Chrome.
  if (m.others?.length) lines.push(`outside k0: ${m.others.map((o) => `${o.name} ${gb(o.rss)}`).join(' · ')}`)
  // The chip has room for three words; the sentence that explains them goes here, and it is also
  // the only place that can say the closing is switched off — the chip says that by staying quiet.
  lines.push(
    idleHours > 0
      ? `a terminal nobody touches for ${idleHours}h is closed and its memory given back — the story stays, Resume picks it up`
      : 'closing forgotten terminals is switched off'
  )
  lines.push(showLoad ? 'click to hide the weight on each story' : 'click to show the weight on each story')
  el.title = lines.join('\n')
}

function renderFilters() {
  $('#filters').innerHTML = ORDER.map(
    (s) =>
      `<button data-s="${s}" aria-pressed="${!hidden.has(s)}"><i style="background:var(--${s})"></i>${LABEL[s]}</button>`
  ).join('')
}

// ── Actions ───────────────────────────────────────────────────────
function toast(msg, ms = 4000) {
  const t = $('#toast')
  t.textContent = msg
  t.classList.add('show')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => t.classList.remove('show'), ms)
}

/**
 * What a launched terminal is told to say, whichever door it came through. There are three of them
 * now — the story's own prompt, a command the interface suggested, and an epic that has no story to
 * belong to — and one sentence about how it went, so they cannot report the same thing three ways.
 */
function launched(r) {
  // Switched off, every door into the backlog answers with the same sentence and an HTTP 200 — a
  // skill has to be able to tell "there is nothing here" from "you turned this off", and neither
  // of those is an error. `api()` only throws on an error status, so a refusal arrives here looking
  // like a launch with no window in it, and without this the user would be told the opposite of
  // what happened about a session that was never opened.
  if (r.enabled === false) return toast(r.why || 'The k0 backlog is switched off.', 8000)
  if (!r.up) return toast(`${r.name} was launched, but I didn't see it come up within 30s`)
  // `autoSent` before `pasted`, and they are not exclusive: a prompt sent with the session goes on
  // the command line, which counts as pasted too. Asking somebody to hit enter on a session that
  // is already answering is telling them the opposite of what happened.
  if (r.autoSent && r.pasted) return toast(`${r.name} is running and the prompt has gone in`)
  if (r.autoSent) {
    const why = `without the Accessibility permission I can't leave the prompt waiting`
    return toast(`${r.name} started on its own (${why})`, 8000)
  }
  if (r.pasted) return toast(`${r.name} is ready, the prompt is in the terminal: hit enter`)
  toast(`${r.name} is running, but I couldn't write the prompt`, 8000)
}

async function start(id, mode) {
  toast(mode === 'resume' ? 'Resuming the session…' : 'Opening the terminal…', 30000)
  try {
    launched(await api(`/api/story/${id}/${mode}`, { method: 'POST' }))
  } catch (e) {
    toast(`Couldn't do it: ${e.message}`, 8000)
  }
  refresh()
}

/**
 * The suggestion, pressed: a session that opens saying `/k0-plan K42` instead of what the note
 * says. The command is the server's own word — it came down on the story and goes back up
 * unchanged — and the server holds it against a closed list before it goes anywhere near a command
 * line, so a refusal here is a sentence and not a silence.
 */
async function startCommand(story, command) {
  toast(`Opening the terminal on /${command} ${story.key ?? ''}`.trim() + '…', 30000)
  try {
    launched(await api(`/api/backlog/story/${story.id}/start`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    }))
  } catch (e) {
    toast(`Couldn't do it: ${e.message}`, 8000)
  }
  lastSignature = ''
  refresh()
}

/**
 * An epic, which is not a row anywhere yet and is not meant to be: a session in that repository
 * running `/k0-epic`, and the discussion writes the epic down itself once it knows what it is.
 * That is why this takes a repository and nothing else — there is nothing to type in.
 */
async function startEpic(path) {
  toast('Opening the terminal…', 30000)
  try {
    launched(await api('/api/backlog/epic/start', { method: 'POST', body: JSON.stringify({ project_path: path }) }))
  } catch (e) {
    toast(`Couldn't do it: ${e.message}`, 8000)
  }
  lastSignature = ''
  refresh()
}

async function focusTerminal(id) {
  // The answer says `ok: false` when the window could not be brought up, and the request itself
  // can fail — a story deleted in another tab, the server restarting. Both are the same news to
  // whoever double-clicked, and neither may be a double click that did nothing.
  //
  // `resumable` is the difference between news and a dead end: the window is gone but there is a
  // conversation behind it, and the one thing worth doing about that is offered rather than
  // described. Answered with a question and not by resuming on its own — a double click asked for
  // the window that was there, not for a new one.
  try {
    const r = await api(`/api/story/${id}/focus`, { method: 'POST' })
    if (r.ok) return
    const said = r.error || 'That terminal could not be brought up front'
    if (!r.resumable) return toast(said)
    if (await ask(`${said} Open it again?`, { yes: 'Resume', destructive: false })) start(id, 'resume')
  } catch (e) {
    toast(`Couldn't do it: ${e.message}`)
  }
}

/**
 * Starting a story, with the one thing the backlog has to say about it: this waits on something
 * that is not finished.
 *
 * It asks and then it goes ahead — it never refuses. A dependency is a note you left yourself, not
 * a lock, and a backlog that will not let you work on what you want is a backlog you stop using.
 * Asked once, per click: there is nothing remembered here, because the answer belongs to this
 * moment and the dependency may well be closed by the next one.
 */
async function mayStart(story) {
  const open = waitingOn(story)
  if (!open.length) return true
  const list = open.map((d) => `${d.key} ${d.title}`).join(', ')
  return await ask(`“${story.title}” waits on ${list}, which ${open.length === 1 ? 'is' : 'are'} not done.`, {
    yes: 'Start anyway',
    destructive: false,
  })
}

async function startStory(story) {
  if (!(await mayStart(story))) return
  start(story.id, 'start')
}

/**
 * The house confirmation, not the browser's. It is asked before throwing a story away — the one
 * thing there is no coming back from — and before starting work that waits on something else.
 * "Done" is not asked about: that one is undone with Reopen.
 *
 * The two are not the same question and they must not look the same. Throwing away is red and
 * says `Delete`; going ahead anyway is the ordinary dark button, because it is the answer you are
 * expected to give.
 */
function ask(text, { yes = 'Delete', destructive = true } = {}) {
  const dlg = $('#confirm')
  return new Promise((resolve) => {
    $('#confirm-text').textContent = text
    const go = $('#confirm-yes')
    go.textContent = yes
    go.className = destructive ? 'destructive' : 'primary'
    const close = (answer) => {
      dlg.close()
      resolve(answer)
    }
    $('#confirm-yes').onclick = () => close(true)
    $('#confirm-no').onclick = () => close(false)
    dlg.onclose = () => resolve(false) // Esc is a no too; the first answer is the one that counts
    dlg.showModal()
  })
}

async function remove(story) {
  if (!(await ask(`Delete “${story.title}”?`))) return
  // A delete that cannot go through must say so. Without this the confirmation closed, the note
  // stayed exactly where it was, and nothing on the screen had anything to say about it.
  try {
    await api(`/api/story/${story.id}`, { method: 'DELETE' })
  } catch (e) {
    toast(`Couldn't delete it: ${e.message}`, 8000)
  }
  refresh()
}

/**
 * The terminal goes, the story stays. Stopping the session takes a couple of seconds — it is asked
 * to leave and given the time to — so it says what it is doing while it waits.
 */
async function closeSession(id) {
  toast('Closing the terminal…', 10000)
  try {
    await api(`/api/story/${id}/close`, { method: 'POST' })
    toast('Closed. Resume picks the conversation up where it was')
  } catch (e) {
    toast(`Couldn't do it: ${e.message}`, 8000)
  }
  refresh()
}

/**
 * Done, and the one answer it can get that is not yes.
 *
 * The server refuses a story whose last counter-check found a decision broken, and it refuses it
 * with the reason written out. Without the catch that refusal was thrown into nothing: no toast,
 * no redraw, a post-it that sat exactly as it was — the most used button in k0 doing nothing at
 * all, on the one no the whole feature exists to say. It is shown for longer than the others
 * because it is a paragraph and not an acknowledgement.
 */
async function setCompleted(id, completed) {
  try {
    await api(`/api/story/${id}`, { method: 'PATCH', body: JSON.stringify({ completed }) })
  } catch (e) {
    toast(refusal(e), 12000)
  }
  refresh()
}

// ── Making something ───────────────────────────────────────────────
/**
 * The little menu under the `+`.
 *
 * It is a menu and not a second dialog because the choice is one word long — and because the two
 * words are the whole difference between them: a story is typed here, an epic is told. It only
 * exists where there is a backlog; without one the `+` goes straight to the story dialog it always
 * went to.
 */
function toggleNewMenu(open = null) {
  const menu = $('#new-menu')
  const show = open === null ? menu.hidden : open
  menu.hidden = !show
  $('#new-story').setAttribute('aria-expanded', show ? 'true' : 'false')
}

/**
 * The epic dialog, which asks for a repository and nothing else.
 *
 * There is no title field and there is not going to be one. An epic is what is left when a
 * discussion has finished arguing about what the work is; typing a name for it first is naming
 * something nobody has decided the shape of yet, and that name is then what every story under it
 * inherits. So this opens a terminal and `/k0-epic` does the asking.
 */
function openEpicDialog() {
  const sel = $('#e-project')
  // In the order they were last used, which for this one dialog is the right order: you are about
  // to spend an hour talking about a repository, and it is almost always the one you were just in.
  sel.innerHTML = projects
    .map((p) => `<option value="${esc(p.path)}">${esc(p.name)}</option>`)
    .join('')
  const here = laneEpic?.path || repoFilter || projects[0]?.path
  if (here) sel.value = here
  $('#epic-new').showModal()
}

/**
 * `presetPath` is the repository of the column you pressed "+" on: it arrives already chosen and
 * the cursor jumps straight to the title, which is the only thing missing.
 */
function openEditor(story, presetPath = null) {
  editing = story?.id ?? null
  editingStory = story ?? null
  // A repository typed by hand does not count: only a real path counts, taken from the list or
  // handed over by the column.
  chosenProject = story?.project_path ?? presetPath ?? null
  $('#editor-title').textContent = story ? 'Story' : 'New story'
  $('#f-project').value = chosenProject ? nameOf(chosenProject) : ''
  // Session already started: the repository cannot be moved out from under Claude's feet.
  $('#f-project').disabled = !!story?.session_id
  $('#f-project').classList.remove('bad')
  $('#f-title').value = story?.title ?? ''
  // Notes and the flag are things you have an opinion about once the story exists and you have
  // been back to it. Asked at the moment of writing it down they are two fields between you and
  // the only two things there are to do with a new story.
  $('#f-notes-row').hidden = !story
  $('#f-notes').value = story?.description ?? ''
  // The two the backlog adds. They are not on the dialog at all with the feature off: an empty
  // field for something that does not exist is a question nobody can answer.
  $('#f-epic-row').hidden = !backlogOn
  $('#f-flag-row').hidden = !backlogOn || !story
  $('#f-epic').value = story?.epic_title ?? ''
  $('#f-flag').checked = !!story?.starred
  fillEpics()
  $('#f-delete').style.display = story ? '' : 'none'
  // Saving without starting anything is what editing a story is for. A NEW story on a board with
  // a backlog does not have it: there are two roads out of this dialog and both of them open a
  // terminal — the long way round through a discussion, or straight in. A board with the backlog
  // switched off keeps it, because that board is the board it always was.
  $('#f-save').style.display = story || !backlogOn ? '' : 'none'
  // The long way in, and only where there is a backlog to discuss anything into.
  $('#f-discuss').style.display = !story && backlogOn ? '' : 'none'
  // A live session is not restarted: there is only saving to do there.
  $('#f-start').style.display = story?.session_alive ? 'none' : ''
  $('#f-start').textContent = story?.session_id ? 'Resume' : 'Quick Start'
  $('#f-project-list').hidden = true
  $('#editor').showModal()
  ;(chosenProject ? $('#f-title') : $('#f-project')).focus()
  loadProjects() // the repository order changes constantly: re-read on every opening
}

const nameOf = (p) => projects.find((x) => x.path === p)?.name ?? p

/** The epics of the repository the dialog is on. An epic belongs to one repository and only one. */
const epicsHere = () => allEpics.filter((e) => e.project_path === chosenProject)

/**
 * The names the epic field offers. A datalist and not a `<select>`, because the field has to do two
 * things at once: pick one of the epics this repository already has, or name one that does not
 * exist yet — and a dropdown cannot be typed into.
 *
 * The key is the option's label rather than its value: what you leave in the field is a name, so
 * that a name typed from scratch and a name picked from the list are the same thing to `save`.
 */
function fillEpics() {
  $('#f-epics').innerHTML = epicsHere()
    .map((e) => `<option value="${esc(e.title)}">${esc(e.key)}</option>`)
    .join('')
}

/**
 * Which epic the dialog is asking for, as a key: one that already exists, one made on the spot, or
 * `null` for none.
 *
 * Made on the spot is the whole point of the field. An epic wanted while writing a story is an epic
 * wanted now, and sending somebody to another screen to make one first is how a story ends up
 * outside the epic it belongs to for ever.
 */
async function chosenEpic() {
  const name = $('#f-epic').value.trim()
  if (!name) return null
  const q = name.toLowerCase()
  const found = epicsHere().find((e) => e.title.toLowerCase() === q || e.key.toLowerCase() === q)
  if (found) return found.key
  const made = await api('/api/backlog/epic', {
    method: 'POST',
    body: JSON.stringify({ project_path: chosenProject, title: name }),
  })
  return made.key
}

/**
 * The two fields that are the backlog's and not the board's, written after the story itself.
 *
 * They go through `/api/backlog/story/:id`, which is the door that resolves an epic's key and
 * writes the `.k0/` file; the board's own door knows about neither. It is a second request and it
 * is worth it: it means the story is saved whatever happens here, and if the epic cannot be made —
 * a repository gone read-only, a name that collides — what is said is that the epic did not happen,
 * not that the story did not.
 */
async function stampBacklog(id, story) {
  if (!backlogOn) return
  const starred = $('#f-flag').checked
  const before = story?.epic_title ?? ''
  const typed = $('#f-epic').value.trim()
  const epicChanged = typed !== before
  if (!epicChanged && starred === !!story?.starred) return
  try {
    const change = { starred }
    if (epicChanged) change.epic_key = await chosenEpic()
    await api(`/api/backlog/story/${id}`, { method: 'PATCH', body: JSON.stringify(change) })
  } catch (e) {
    toast(`The story is saved, but: ${e.message}`, 8000)
  }
}

let hits = [] // the repositories shown in the list right now
let active = 0 // where you are with the arrows: the row Enter picks

function chooseProject(path) {
  chosenProject = path
  $('#f-project').value = nameOf(path)
  $('#f-project').classList.remove('bad')
  $('#f-project-list').hidden = true
  // An epic belongs to one repository: changing the repository changes which ones are on offer.
  fillEpics()
}

/** With a repository already chosen the whole list is shown: that is where you change it. */
const listQuery = () => (chosenProject ? '' : $('#f-project').value)

const matching = (query) => {
  const q = query.trim().toLowerCase()
  return projects.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 40)
}

function renderProjectList(query = '') {
  hits = matching(query)
  // Redrawing must not lose the highlight: it only moves if it has fallen outside.
  active = Math.max(0, Math.min(active, hits.length - 1))
  const list = $('#f-project-list')
  list.innerHTML = hits.length
    ? hits
        .map(
          (p, i) =>
            `<div data-p="${esc(p.path)}" class="${p.path === chosenProject ? 'on' : ''}${
              i === active ? ' active' : ''
            }">${esc(p.name)}${p.last_used ? `<em>${since(p.last_used, Date.now())}</em>` : ''}</div>`
        )
        .join('')
    : '<div style="color:var(--muted)">no repository with that name</div>'
  list.hidden = false
}

/** On opening, the arrows start from the repository already chosen, not from the top. */
function openProjectList() {
  const found = matching(listQuery()).findIndex((p) => p.path === chosenProject)
  active = Math.max(0, found)
  renderProjectList(listQuery())
  $('#f-project-list').children[active]?.scrollIntoView({ block: 'nearest' })
}

/**
 * On leaving the field: either there is a real repository, or there is nothing. If what you
 * typed identifies exactly one, it takes it; otherwise the field empties, instead of sitting
 * there with a name that does not exist.
 */
function resolveProject() {
  const el = $('#f-project')
  if (chosenProject) {
    el.value = nameOf(chosenProject)
    return
  }
  const q = el.value.trim().toLowerCase()
  const exact = q && projects.find((p) => p.name.toLowerCase() === q)
  const found = q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : []
  if (exact) return chooseProject(exact.path)
  if (found.length === 1) return chooseProject(found[0].path)
  el.value = ''
  el.classList.remove('bad')
}

/**
 * The notes, as a list.
 *
 * A dash is put in front of every line that has not got one, on the way to being saved rather than
 * as you type: a box that rewrites the line under the cursor is a box that fights you in the middle
 * of a word. Blank lines go, because a bullet with nothing after it is not a note.
 *
 * It is what makes the box a list and not a paragraph — which is the whole difference between
 * somewhere to jot three things down and somewhere to write an essay nobody will read again.
 */
const bulleted = (text) =>
  String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (/^[-*•]\s*/.test(line) ? line.replace(/^[-*•]\s*/, '- ') : `- ${line}`))
    .join('\n')

/** Returns the saved story, or null if it could not be saved. */
async function save() {
  if (!$('#editor-form').reportValidity()) return null
  const title = titleCase($('#f-title').value).replace(/-+$/, '')
  // The repository only counts if picked from the list: typed by hand it does not exist.
  if (!chosenProject) {
    $('#f-project').classList.add('bad')
    $('#f-project').focus()
    toast('Pick a repository from the list')
    return null
  }
  if (!title) {
    $('#f-title').focus()
    toast('A title is required')
    return null
  }
  // The notes go in only when the dialog was showing them, which is to say only when a story was
  // being edited. Leaving the key out of the payload is what keeps what is already there:
  // `patchStory` writes only the keys it is given, so a new story is written without touching a
  // description an import may later put on it.
  const payload = { title, project_path: chosenProject }
  if (!$('#f-notes-row').hidden) payload.description = bulleted($('#f-notes').value)
  try {
    const saved = editing
      ? await api(`/api/story/${editing}`, { method: 'PATCH', body: JSON.stringify(payload) })
      : await api('/api/story', { method: 'POST', body: JSON.stringify(payload) })
    await stampBacklog(saved.id, editingStory)
    $('#editor').close()
    lastSignature = ''
    refresh()
    return saved
  } catch (e) {
    toast(e.message)
    return null
  }
}

/**
 * What the four buttons say when you hover over them. The name of the mode on its own would
 * not be enough: the part that really matters — the machine stays awake with the lid closed —
 * is exactly the part that can be missing, and a control that promises something it does not
 * do is worse than one that is switched off. The keys are the `reason` the server sends.
 */
const MODE_STATE = {
  sleep: 'Sleep — the machine may fall asleep and stop what it is doing',
  full: 'Holds even with the lid closed',
  battery: 'On, but sleeping is allowed again: the battery is nearly flat',
  'no-permission': 'On, but only with the lid open. Run `k0-board install` to cover the lid too',
  unsupported: 'On, but this system does not let k0 control what the lid does',
}

/** What each one does: the title of the three buttons that are not the lit one. */
const MODE_WHAT = {
  sleep: 'Sleep — let the machine fall asleep as it normally would',
  away: 'Away — you are not here, but the machine keeps working. The screen may sleep',
  nerd: 'Nerd — the machine and the screen both stay on',
  driving: 'Driving — screen always on, and everything in large type',
}

/**
 * The four modes, put on the page. Two separate things: which button is lit — that is what
 * you asked for — and `data-partial`, which is how well it is managing.
 *
 * The large type stays hung on `data-driving` on the `<html>` element, which is where the
 * stylesheet already looks for it: no measurement is touched here, so there are never two
 * versions of one.
 */
function setMode(mode, reason) {
  const html = document.documentElement
  const large = mode === 'driving'
  // Only when it really changes: rewriting it every round would wake the layout for nothing.
  if (large !== (html.dataset.driving === '')) {
    if (large) html.dataset.driving = ''
    else delete html.dataset.driving
  }
  for (const b of document.querySelectorAll('#modes button')) {
    const its = b.dataset.mode === mode
    b.setAttribute('aria-checked', its ? 'true' : 'false')
    if (its && reason && reason !== 'full' && reason !== 'sleep') b.dataset.partial = ''
    else delete b.dataset.partial
    b.title = its ? (MODE_STATE[reason] ?? MODE_WHAT[mode]) : MODE_WHAT[b.dataset.mode]
  }
}

/**
 * The dot beside the name, and the sentence it carries.
 *
 * Two different pieces of news share one mark: k0 moved on under you while you were not looking,
 * and npm has something newer than what is installed here. They are not the same thing and the
 * title says which, because a mark that could mean either is a mark you learn to ignore.
 *
 * It is a link and nothing else. Nothing here opens the page, and there is no number on the dot:
 * there is nothing to count, and a badge would make an upgrade feel like an unread inbox.
 */
function setWhatsNew(u) {
  const mark = $('#whatsnew')
  if (!mark) return
  const jumped = u?.jump ? `k0 went from ${u.jump.from} to ${u.jump.to} — see what changed` : null
  const newer = u?.latest?.newer ? `npm has k0 ${u.latest.version}; this one is ${u.version}` : null
  const why = jumped || newer
  mark.hidden = !why
  if (why) {
    mark.title = why
    mark.setAttribute('aria-label', why)
  }
}

/**
 * What the list view is lent, and the whole of what it is lent.
 *
 * It is handed over rather than imported from the other side, so the list has no way to reach back
 * into the board: everything it can do to a story is on this object, and the day one of these
 * changes there is one place that says so. `redraw` is the pair of lines every write in here ends
 * with — forget what is on screen, and ask again.
 */
const LIST = {
  api,
  toast,
  hue: epicHue,
  flag: ICON.flag,
  next: doNextStep,
  redraw: () => {
    lastSignature = ''
    refresh()
  },
}

// ── The loop ──────────────────────────────────────────────────────
async function refresh() {
  try {
    const data = await api('/api/board')
    // The icon in the tab is tinted like the one in the menu bar: red if a session is waiting
    // for you, blue if they are grinding away, outline if everything is still.
    setFavicon(data.urgent)
    // The mode is the server's to hold, because it shares it with the menu bar icon: here we
    // simply obey, even when it was changed over there. The `reason` comes with it: if the lid
    // is not covered, the lit button has to say so instead of pretending otherwise.

    setMode(data.mode, data.reason)
    setWhatsNew(data.update)
    backlogOn = !!data.backlog
    // Every epic k0 knows, kept for the editor's list: the dialog is opened between rounds and has
    // to be able to offer them without a request of its own.
    allEpics = data.epics ?? []
    // The switch belongs to the bar and not to the board: it has to appear the moment the server
    // says there is a backlog, whether or not anything on the board changed with it.
    renderColumnsSwitch()
    machine = data.machine ?? null
    // What is eating most right now: it is what tints that one red and nobody else.
    heaviest =
      data.stories.filter((c) => c.load).sort((a, b) => b.load.rss - a.load.rss)[0]?.id ?? null
    renderMachine(machine, data.stories, data.closeIdleAfterHours)

    // Redraw only if something really changed, so the editor and the focus stay where they are.
    // The git state is inside the signature: without it, the mark would stay the one from the
    // first round. The weight goes in already rounded — see `weight` — otherwise the board
    // would redraw on every sample of the load.
    const sig = JSON.stringify([
      showLoad,
      // The column order depends on it: changing mode means the board has to be rebuilt.
      data.mode,
      // Switching the backlog off takes a button off every post-it that has never been started,
      // and a change nothing in here noticed would only show up the next time anything else did.
      backlogOn,
      // What a column means, which repository the state columns are showing, and which epic the
      // board is standing inside: three choices that rebuild the whole board and none of which
      // the server knows anything about.
      columnsMean,
      repoFilter,
      laneEpic && `${laneEpic.path}:${laneEpic.key}`,
      // The epics, for the progress on the strip at the top and for the labels on the notes. Only
      // with the backlog on: off, there are none, and a null here is one fewer thing to compare.
      backlogOn
        ? (data.epics ?? []).map((e) => [
            e.key,
            e.project_path,
            e.title,
            e.progress.done,
            e.progress.total,
            // Which round the discussion is on. The list draws it, and it is the only thing moving
            // on an epic that has not turned into stories yet — which is most of an epic's life.
            e.round?.n ?? '',
          ])
        : null,
      // Not `heaviest` as it is: on a calm machine the heaviest changes constantly without
      // anything changing on screen, and it would redraw for nothing.
      machine?.pressure !== 'ok' ? heaviest : null,
      data.stories.map((c) => [
        c.id,
        c.status,
        c.session_alive,
        c.title,
        c.description,
        c.prompt,
        c.project_path,
        // What folds a column away and what brings it back: the day is measured from the
        // freshest of these, so when none of them moves nothing can fold, and the board is
        // spared a redraw on a timer.
        c.updated_at,
        gitSig(c.git),
        c.load ? weight(c.load.rss) : '',
        // What the backlog draws on the note and on a row in the list. They are all `undefined`
        // with the feature off, which compares as well as anything else.
        c.state,
        c.starred,
        c.epic_key,
        c.epic_title,
        c.blocked,
        // The label on the one button that says what to do next. It can change without anything
        // else on the row changing, and a suggestion nothing noticed would stay wrong until
        // something else moved.
        c.next_step?.label ?? '',
      ]),
      // The server state belongs in here for the same reason the git state does: without it the
      // globe would keep the colour it had on the first round for the rest of the visit.
      data.columns.map((col) => [col.path, gitSig(col.git), serverSig(col.server)]),
      (data.projects ?? []).map((p) => [p.path, gitSig(p.git)]),
    ])
    if (sig !== lastSignature) {
      lastSignature = sig
      render(data)
    }
  } catch {
    /* server down: we try again next round */
  }
}

/** The repository list, re-read every time the editor opens: the order goes stale fast. */
async function loadProjects() {
  try {
    projects = await api('/api/projects')
    if (!$('#f-project-list').hidden) renderProjectList(listQuery())
  } catch {
    /* an old list: better than no list */
  }
}

async function boot() {
  initView() // before anything else: render() assumes the view is already there
  renderFilters()
  renderColumnsSwitch() // hidden until the first answer says there is a backlog
  await loadProjects()

  $('#filters').onclick = (e) => {
    const b = e.target.closest('button')
    if (!b) return
    const s = b.dataset.s
    hidden.has(s) ? hidden.delete(s) : hidden.add(s)
    saveHidden()
    renderFilters()
    lastSignature = ''
    refresh()
  }

  // The gauge is always there; clicking it switches the weights on the stories off and on again,
  // and the choice stays as you left it.
  $('#gauge').onclick = () => {
    showLoad = !showLoad
    localStorage.setItem('k0-load', showLoad ? '1' : '0')
    lastSignature = ''
    refresh()
  }

  // The four buttons are one control: the click is caught on the container, so there are not
  // four handlers saying the same thing. It answers straight away without waiting — a click
  // has to answer — but the last word belongs to the server, which by then has talked to the
  // operating system and is the only one who knows whether the lid is really covered.
  $('#modes').onclick = async (e) => {
    const b = e.target.closest('button[data-mode]')
    if (!b) return
    const mode = b.dataset.mode
    // Clicking the lit one again does nothing, and that is the point: you leave a mode, you do
    // not switch it off. Without this, every re-click would be a round trip for nothing.
    if (b.getAttribute('aria-checked') === 'true') return
    const before = $('#modes button[aria-checked="true"]')?.dataset.mode
    setMode(mode, mode === 'sleep' ? 'sleep' : 'full')
    try {
      const res = await api('/api/mode', { method: 'POST', body: JSON.stringify({ mode }) })
      setMode(res.mode, res.reason)
      if (res.reason === 'no-permission') toast(MODE_STATE['no-permission'])
      if (res.reason === 'unsupported') toast(MODE_STATE.unsupported)
    } catch (err) {
      setMode(before, null) // it did not go through: go back instead of lying
      toast(err.message)
    }
  }

  // Kanban or List. It is a radiogroup like the modes are, and it behaves like one: clicking the
  // lit half does nothing, because you leave a view by going to the other one.
  $('#columns').onclick = (e) => {
    const b = e.target.closest('button[data-columns]')
    if (!b || b.dataset.columns === columnsMean) return
    columnsMean = b.dataset.columns
    localStorage.setItem('k0-columns', columnsMean)
    renderColumnsSwitch()
    lastSignature = ''
    refresh()
  }

  // The repository menu: a button that opens a list with a search in it. Everything that closes
  // it goes through `showRepoList`, so there is no way to leave the arrow saying one thing and the
  // list doing another.
  $('#repo-filter-btn').onclick = (e) => {
    e.stopPropagation()
    showRepoList($('#repo-filter-list').hidden)
  }
  $('#repo-filter-q').oninput = (e) => paintRepoList(e.target.value)
  $('#repo-filter-q').onkeydown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      showRepoList(false)
      $('#repo-filter-btn').focus()
      return
    }
    // Enter takes the first row that is left, which is the one the search put at the top: typing
    // three letters and pressing Enter is the whole gesture, without reaching for the pointer.
    if (e.key !== 'Enter') return
    e.preventDefault()
    $('#repo-filter-rows').querySelector('[data-repo]')?.click()
  }
  $('#repo-filter-rows').onclick = (e) => {
    const row = e.target.closest('[data-repo]')
    if (!row) return
    chooseRepo(row.dataset.repo)
    showRepoList(false)
    lastSignature = ''
    refresh()
  }
  // Anywhere else on the page shuts it. A menu you have to press the button again to be rid of is
  // a menu that stays open over the board.
  document.addEventListener('click', (e) => {
    if (!$('#repo-filter-list').hidden && !e.target.closest('#repo-filter')) showRepoList(false)
  })

  // The way out of an epic. It is a button with words on it and not an ✕: going back to the whole
  // board is not closing something, and there is nothing here to close.
  $('#epic-out').onclick = () => setLane(null)

  // The `+` has two things to make now, and they are made in two different ways: a story is typed
  // here, an epic is told to Claude in a terminal. With the backlog off there is only one of them
  // and the menu never opens — the plus is the plus it has always been.
  $('#new-story').onclick = () => (backlogOn ? toggleNewMenu() : openEditor(null))
  $('#new-menu').onclick = (e) => {
    const b = e.target.closest('button[data-new]')
    if (!b) return
    toggleNewMenu(false)
    if (b.dataset.new === 'story') openEditor(null)
    else openEpicDialog()
  }
  // Anywhere else shuts it, which is what a menu does. It is caught on the way down so a click on
  // something else still does that something else.
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.new-wrap')) toggleNewMenu(false)
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') toggleNewMenu(false)
  })

  $('#e-close').onclick = () => $('#epic-new').close()
  $('#e-cancel').onclick = () => $('#epic-new').close()
  $('#epic-form').onsubmit = (e) => {
    e.preventDefault()
    const path = $('#e-project').value
    if (!path) return
    $('#epic-new').close()
    startEpic(path)
  }
  $('#f-close').onclick = () => $('#editor').close()
  $('#editor-form').onsubmit = (e) => {
    e.preventDefault()
    save()
  }
  // Save and go: the same thing the button on the story does, without going through it. Nothing
  // is sent with it — the terminal opens empty and you type there, which is the whole of what
  // makes this the quick way in.
  $('#f-start').onclick = async () => {
    const saved = await save()
    if (!saved) return
    start(saved.id, editingStory?.session_id ? 'resume' : 'start')
  }
  // And the long way round: the story is written down and the discussion starts on it at once,
  // which is the same `/k0-discuss K42` the post-it's own button would have opened later.
  $('#f-discuss').onclick = async () => {
    const saved = await save()
    if (saved) startCommand(saved, 'k0-discuss')
  }
  // Esc with the list open closes only the list: the dialog leaves on the second Esc.
  $('#editor').oncancel = (e) => {
    if ($('#f-project-list').hidden) return
    e.preventDefault()
    $('#f-project-list').hidden = true
  }

  // The title is normalised as you type. The cursor is put back by normalising the part before
  // it as well: that way you can correct in the middle of a word without being thrown to the
  // end of the field.
  $('#f-title').oninput = (e) => {
    const el = e.target
    const caret = titleCase(el.value.slice(0, el.selectionStart)).length
    el.value = titleCase(el.value)
    el.setSelectionRange(caret, caret)
  }

  // It opens when you click or type in it, not as soon as the field takes focus: otherwise it
  // would cover the rest of the form every time you open the editor.
  $('#f-project').onclick = () => openProjectList()
  $('#f-project').oninput = (e) => {
    // Typing undoes the choice: only a repository picked from the list counts.
    chosenProject = null
    active = 0
    e.target.classList.remove('bad')
    renderProjectList(e.target.value)
  }
  $('#f-project').onkeydown = (e) => {
    const list = $('#f-project-list')
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (list.hidden) return openProjectList() // the first arrow only opens it
      if (!hits.length) return
      active = (active + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length
      renderProjectList(listQuery())
      list.children[active]?.scrollIntoView({ block: 'nearest' })
      return
    }
    if (e.key !== 'Enter') return
    e.preventDefault() // no form submit: here Enter takes the highlighted row
    if (hits[active]) {
      chooseProject(hits[active].path)
      $('#f-title').focus()
    }
  }
  // The delay lets the list's mousedown win, which is what picks a row.
  $('#f-project').onblur = () =>
    setTimeout(() => {
      $('#f-project-list').hidden = true
      resolveProject()
    }, 150)
  $('#f-project-list').onmousedown = (e) => {
    const row = e.target.closest('[data-p]')
    if (!row) return
    chooseProject(row.dataset.p)
    $('#f-title').focus()
  }

  $('#f-delete').onclick = async () => {
    if (!editing || !(await ask(`Delete “${$('#f-title').value}”?`))) return
    // The editor stays open when the delete does not go through: closing it would leave the story
    // on the board with nothing said about why it is still there.
    try {
      await api(`/api/story/${editing}`, { method: 'DELETE' })
    } catch (e) {
      toast(`Couldn't delete it: ${e.message}`, 8000)
      return
    }
    $('#editor').close()
    refresh()
  }

  refresh()
  setInterval(refresh, 1000)

  // A direct link: k0 opened with the new story already in front of you.
  if (location.hash === '#new' || location.hash === '#nuovo') openEditor(null)
}

boot()
