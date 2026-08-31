import { titleCase } from '/title.js'
import { initView, refit } from '/view.js'
import { weight, gb } from '/units.js'
import { setFavicon } from '/favicon.js'
import { split } from '/recency.js'

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
  if (!r.ok) throw new Error(body.error || 'Something went wrong')
  return body
}

let projects = []
let editing = null // id of the card open in the editor, null = a new one
let editingCard = null // the whole card: Start needs to know whether a session exists already
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

// The weight of each session: on to begin with, switched off from the gauge at the top.
let showLoad = localStorage.getItem('k0-load') !== '0'
let machine = null // how the computer is doing right now
let heaviest = null // the card eating the most, so only that one gets tinted

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

/** A stable tilt: it depends on the id, so a card does not dance on every refresh. */
const tilt = (id) => (((id * 37) % 5) - 2) * 0.5

function postit(card, now) {
  const el = document.createElement('article')
  el.className = `postit ${card.status}`
  el.dataset.id = card.id
  el.style.transform = `rotate(${tilt(card.id)}deg)`

  const alive = card.session_id && card.session_alive && !card.completed_at
  const dead = card.session_id && !card.session_alive && !card.completed_at
  if (alive) el.title = 'Double-click to bring its terminal up front'

  // On a finished card there is nothing left to edit: the bin takes the pencil's place.
  const corner = card.completed_at
    ? { icon: ICON.del, label: 'Delete', cls: 'corner del', act: () => remove(card) }
    : { icon: ICON.edit, label: 'Edit', cls: 'corner', act: () => openEditor(card) }

  el.innerHTML = `
    <button class="${corner.cls}" title="${corner.label}" aria-label="${corner.label}">${corner.icon}</button>
    <div class="head"><span class="tag">${esc(card.project_name)}</span>${gitChip(
      card.git,
      // A session with a worktree of its own also has files of its own: that is the directory
      // to open. But only while the worktree really exists — `own` comes from the server,
      // which has just read that directory's git state.
      card.git?.own ? card.work_path : card.project_path,
      card.id
    )}${loadChip(card)}</div>
    <div class="title">${esc(card.title)}</div>
    ${
      // Description and prompt travel together in one box, and that box is the only part of the
      // card allowed to shrink: whatever the text does, the repository, the title, the age and
      // the buttons stay where they are.
      card.description || card.prompt
        ? `<div class="body">
             ${card.description ? `<div class="desc">${esc(card.description)}</div>` : ''}
             ${card.prompt ? `<div class="prompt">${esc(card.prompt)}</div>` : ''}
           </div>`
        : ''
    }
    <div class="foot">
      ${dead ? '<span class="dead">session closed</span>' : ''}
      <span class="since" title="${LABEL[card.status]} for ${since(card.status_since, now)}">${since(card.status_since, now)}</span>
    </div>
    <div class="actions"></div>`

  // The only way to open the editor: clicking the card itself no longer does anything.
  el.querySelector('.corner').onclick = (e) => {
    e.stopPropagation()
    corner.act()
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

  if (card.completed_at) {
    btn('Reopen', () => setCompleted(card.id, false))
  } else if (!card.session_id) {
    btn('Start', () => start(card.id, 'start'))
  } else {
    if (dead) btn('Resume', () => start(card.id, 'resume'))
    // An idea in the backlog cannot be "done": it never started.
    btn('Done', () => setCompleted(card.id, true), 'close this job and its terminal')
    // Close gives the memory back without declaring the work over, and it comes after Done, as a
    // link rather than a button: it is the rarer of the two and should not compete with it. Not
    // while the session is working — stopping one mid-thought is not memory saved, it is work lost.
    if (!dead && !BUSY.has(card.status))
      btn(
        'Close',
        () => closeSession(card.id),
        'stop the session and its terminal, and leave the card where it is',
        'link'
      )
  }

  // The git mark is a link: a double click on it would open two tabs and bring the terminal to
  // the front into the bargain. Double clicks do not reach it.
  el.querySelector('.git')?.addEventListener('dblclick', (e) => e.stopPropagation())

  // Double click: back to this session's terminal, wherever it has ended up.
  el.ondblclick = (e) => {
    if (!alive) return
    e.preventDefault()
    focusTerminal(card.id)
  }
  return el
}

// Few icons, all in the same stroke: the pencil opens the editor, the bin throws away, the
// "+" gives birth to a card. The same "+" as the one in the bar at the top.
const ICON = {
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  // Put this column away: it slides off to the right, where `Old` is.
  fold: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6l6 6-6 6"/><path d="M19 5v14"/></svg>',
  // The dev server: a world, because what is behind it is a site. A meridian and a parallel are
  // enough to read it at twelve pixels — more lines and it goes back to being a circle.
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><ellipse cx="12" cy="12" rx="4" ry="9"/></svg>',
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// ── The git mark ───────────────────────────────────────────────────
// One symbol, on the card and above the column: what is needed is to see at a glance whether
// anything is still outstanding. The rest — which branch, how many files, how many commits, and
// how many of those commits belong to this session — is read by hovering over it, the way the
// time at the bottom of a card already works.
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
 * has not answered yet — a lens goes in its place, so every card and every column still leads
 * in.
 */
function gitChip(g, repo, card) {
  const to = esc(`/files.html?repo=${encodeURIComponent(repo)}${card ? `&card=${card}` : ''}`)
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
function loadChip(card) {
  if (!showLoad || !card.load) return ''
  const l = card.load
  const bits = l.top.map((t) => `${t.name} ${Math.round(t.rss / 1048576)} MB`)
  if (l.cpu !== null) bits.push(`${Math.round(l.cpu * 100)}% CPU`)
  bits.push(`${l.procs} process${l.procs === 1 ? '' : 'es'}`)
  // Red on one only, and only while the machine is struggling: if they are all red they stop
  // saying anything, and it is not true that they all need closing.
  const hot = machine?.pressure !== 'ok' && card.id === heaviest
  return `<span class="load${hot ? ' hot' : ''}" title="${esc(bits.join(' · '))}">${weight(l.rss)}</span>`
}

/** Just enough to compare one round with the next: if it changes, it redraws. */
const gitSig = (g) => (g ? `${g.dirty}/${g.unpushed}/${g.own ? 1 : 0}/${g.mine ?? ''}` : '')

/**
 * How long this card has been where it is. Until it has ever changed status there is nothing in
 * `session_event` and `status_since` is empty: then it counts from when it came into existence,
 * otherwise a card just created would end up at the bottom of its group.
 */
const freshness = (c) => c.status_since ?? c.created_at ?? 0

/**
 * The order of attention: most urgent status first, and among equal statuses whichever entered
 * it last. It holds between the cards inside a column and — applied to the leading card —
 * between the columns on the board.
 */
const byAttention = (a, b) =>
  ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || freshness(b) - freshness(a)

function render(data) {
  const visible = data.cards.filter((c) => !hidden.has(c.status))
  const board = $('#board')
  board.textContent = ''

  const columns = data.columns
    .map((col) => ({
      col,
      cards: visible.filter((c) => c.project_path === col.path).sort(byAttention),
    }))
    .filter(({ cards }) => cards.length)

  // In driving mode the columns queue up by attention too: a column is worth as much as its
  // leading card, and since the cards are sorted already, that first one is necessarily the most
  // urgent it has. One red is enough to bring it left; when that red moves into working, the
  // column slides right by itself. On a tie the alphabetical order from the server stands,
  // because `sort` is stable.
  //
  // But ONLY there. In driving mode you see two or three columns at a time, and bringing the most
  // urgent one to the left is the only way to see it without going to look for it. Full screen
  // they are all in front of you already: there is nothing to bring to anybody, and a board that
  // reshuffles itself while you work only loses your place. With the switch off the columns stand
  // still in alphabetical order — the server's, which is not touched here.
  if (data.mode === 'driving') columns.sort((a, b) => byAttention(a.cards[0], b.cards[0]))

  // Which of them are still warm. Everything else folds away into `Old` — see recency.js for the
  // four rules and for why the day is counted back from your last piece of work rather than from
  // the clock.
  const { open, alive } = split({
    paths: columns.map((c) => c.col.path),
    cards: data.cards,
    folded,
    held,
  })
  // A column open now is open for the rest of the visit, and a column that is open is not one
  // you have put away: a session woke up in there, or you went and fetched it back yourself.
  let forget = false
  for (const p of open) {
    held.add(p)
    if (folded.delete(p)) forget = true
  }
  if (forget) saveFolded()

  const openSet = new Set(open)
  for (const { col, cards } of columns.filter(({ col }) => openSet.has(col.path))) {
    const wrap = document.createElement('section')
    wrap.className = 'column'
    // The "+" next to the name: a new card on THIS repository, without picking it.
    const add = `New card in ${esc(col.name)}`
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
    const live = alive.has(col.path)
    const away = live ? `${col.name} has something going on: it cannot be put away` : `Put ${col.name} away`
    const fold = `<button class="fold" title="${esc(away)}" aria-label="${esc(away)}"${
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
    wrap.querySelector('.fold').onclick = () => putAway(col.path)
    const globe = wrap.querySelector('.globe')
    if (globe) wireGlobe(globe, col.path, col.server)
    for (const c of cards) wrap.append(postit(c, data.now))
    board.append(wrap)
  }

  board.append(oldColumn(columns.filter(({ col }) => !openSet.has(col.path))))
  board.append(repoColumn(data.projects ?? [], new Set(columns.map((c) => c.col.path))))
  $('#empty').style.display = columns.length ? 'none' : 'grid'
  refit() // the board changed size: the view comes back inside its limits
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
 * and nothing else. How many cards are parked in there and how long it has been quiet were both
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
        const add = `New card in ${esc(col.name)}`
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
 * card between them. Repeating the ones already on the left would be saying the same thing
 * twice. Headings only, in the order you last used them. It is there for two things: getting
 * into the files of a directory you are not working on, and giving birth to the first card
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
        const add = `New card in ${esc(p.name)}`
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
function renderMachine(m, cards) {
  const el = $('#gauge')
  if (!m?.mem) return el.setAttribute('hidden', '') // the first sample is not in yet
  el.removeAttribute('hidden')
  el.className = `gauge ${m.pressure}`

  const ram = Math.round((m.mem.used / m.mem.total) * 100)
  const cpu = m.cpu === null ? '—' : `${Math.round(m.cpu * 100)}%`
  el.innerHTML = `<i></i>RAM ${ram}% · CPU ${cpu}`

  const top = cards.find((c) => c.id === heaviest)
  const lines = [
    `${gb(m.mem.used)} of ${gb(m.mem.total)} in use · ${gb(m.swap.used)} on swap`,
    `${m.alive} session${m.alive === 1 ? '' : 's'} running${m.outside ? `, ${m.outside} not on the dashboard` : ''}`,
  ]
  if (top?.load) lines.push(`heaviest: ${top.title} — ${weight(top.load.rss)}`)
  // What is heavy and is not k0: without it, the board would take blame that belongs to Chrome.
  if (m.others?.length) lines.push(`outside k0: ${m.others.map((o) => `${o.name} ${gb(o.rss)}`).join(' · ')}`)
  lines.push(showLoad ? 'click to hide the weight on each card' : 'click to show the weight on each card')
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

async function start(id, mode) {
  toast(mode === 'resume' ? 'Resuming the session…' : 'Opening the terminal…', 30000)
  try {
    const r = await api(`/api/card/${id}/${mode}`, { method: 'POST' })
    if (!r.up) toast(`${r.name} was launched, but I didn't see it come up within 30s`)
    else if (r.pasted) toast(`${r.name} is ready, the prompt is in the terminal: hit enter`)
    else if (r.autoSent) toast(`${r.name} started on its own (without the Accessibility permission I can't leave the prompt waiting)`, 8000)
    else toast(`${r.name} is running, but I couldn't write the prompt`, 8000)
  } catch (e) {
    toast(`Couldn't do it: ${e.message}`, 8000)
  }
  refresh()
}

async function focusTerminal(id) {
  const r = await api(`/api/card/${id}/focus`, { method: 'POST' })
  if (!r.ok) toast(r.error)
}

/**
 * The house confirmation, not the browser's: it is only ever asked before throwing a card away,
 * which is the one thing there is no coming back from. "Done" is not — that one is undone with
 * Reopen.
 */
function ask(text) {
  const dlg = $('#confirm')
  return new Promise((resolve) => {
    $('#confirm-text').textContent = text
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

async function remove(card) {
  if (!(await ask(`Delete “${card.title}”?`))) return
  await api(`/api/card/${card.id}`, { method: 'DELETE' })
  refresh()
}

/**
 * The terminal goes, the card stays. Stopping the session takes a couple of seconds — it is asked
 * to leave and given the time to — so it says what it is doing while it waits.
 */
async function closeSession(id) {
  toast('Closing the terminal…', 10000)
  try {
    await api(`/api/card/${id}/close`, { method: 'POST' })
    toast('Closed. Resume picks the conversation up where it was')
  } catch (e) {
    toast(`Couldn't do it: ${e.message}`, 8000)
  }
  refresh()
}

async function setCompleted(id, completed) {
  await api(`/api/card/${id}`, { method: 'PATCH', body: JSON.stringify({ completed }) })
  refresh()
}

// ── Editor ─────────────────────────────────────────────────────────
/**
 * `presetPath` is the repository of the column you pressed "+" on: it arrives already chosen and
 * the cursor jumps straight to the title, which is the only thing missing.
 */
function openEditor(card, presetPath = null) {
  editing = card?.id ?? null
  editingCard = card ?? null
  // A repository typed by hand does not count: only a real path counts, taken from the list or
  // handed over by the column.
  chosenProject = card?.project_path ?? presetPath ?? null
  $('#editor-title').textContent = card ? 'Card' : 'New card'
  $('#f-project').value = chosenProject ? nameOf(chosenProject) : ''
  // Session already started: the repository cannot be moved out from under Claude's feet.
  $('#f-project').disabled = !!card?.session_id
  $('#f-project').classList.remove('bad')
  $('#f-title').value = card?.title ?? ''
  $('#f-prompt').value = card?.prompt ?? ''
  $('#f-delete').style.display = card ? '' : 'none'
  // A live session is not restarted: there is only saving to do there.
  $('#f-start').style.display = card?.session_alive ? 'none' : ''
  $('#f-start').textContent = card?.session_id ? 'Resume' : 'Start'
  $('#f-project-list').hidden = true
  $('#editor').showModal()
  ;(chosenProject ? $('#f-title') : $('#f-project')).focus()
  loadProjects() // the repository order changes constantly: re-read on every opening
}

const nameOf = (p) => projects.find((x) => x.path === p)?.name ?? p

let hits = [] // the repositories shown in the list right now
let active = 0 // where you are with the arrows: the row Enter picks

function chooseProject(path) {
  chosenProject = path
  $('#f-project').value = nameOf(path)
  $('#f-project').classList.remove('bad')
  $('#f-project-list').hidden = true
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

/** Returns the saved card, or null if it could not be saved. */
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
  // No description here on purpose: a card written by hand does not need one. The field only
  // ever mattered for an imported session, where it is the one line saying what happened in
  // there — and that one is written by the import. Leaving the key out of the payload is what
  // keeps it: `patchCard` writes only the keys it is given.
  const payload = {
    title,
    project_path: chosenProject,
    prompt: $('#f-prompt').value,
  }
  try {
    const saved = editing
      ? await api(`/api/card/${editing}`, { method: 'PATCH', body: JSON.stringify(payload) })
      : await api('/api/card', { method: 'POST', body: JSON.stringify(payload) })
    $('#editor').close()
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
    machine = data.machine ?? null
    // What is eating most right now: it is what tints that one red and nobody else.
    heaviest =
      data.cards.filter((c) => c.load).sort((a, b) => b.load.rss - a.load.rss)[0]?.id ?? null
    renderMachine(machine, data.cards)

    // Redraw only if something really changed, so the editor and the focus stay where they are.
    // The git state is inside the signature: without it, the mark would stay the one from the
    // first round. The weight goes in already rounded — see `weight` — otherwise the board
    // would redraw on every sample of the load.
    const sig = JSON.stringify([
      showLoad,
      // The column order depends on it: changing mode means the board has to be rebuilt.
      data.mode,
      // Not `heaviest` as it is: on a calm machine the heaviest changes constantly without
      // anything changing on screen, and it would redraw for nothing.
      machine?.pressure !== 'ok' ? heaviest : null,
      data.cards.map((c) => [
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

  // The gauge is always there; clicking it switches the weights on the cards off and on again,
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

  $('#new-card').onclick = () => openEditor(null)
  $('#f-close').onclick = () => $('#editor').close()
  $('#editor-form').onsubmit = (e) => {
    e.preventDefault()
    save()
  }
  // Save and go: the same thing the button on the card does, without going through it.
  $('#f-start').onclick = async () => {
    const saved = await save()
    if (!saved) return
    start(saved.id, editingCard?.session_id ? 'resume' : 'start')
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
    await api(`/api/card/${editing}`, { method: 'DELETE' })
    $('#editor').close()
    refresh()
  }

  refresh()
  setInterval(refresh, 1000)

  // A direct link: k0 opened with the new card already in front of you.
  if (location.hash === '#new' || location.hash === '#nuovo') openEditor(null)
}

boot()
