// The read-only board: everything the computer has sent to k0 Cloud, laid out the way k0 lays it out.
import { api, el, gate, header, SignedOut } from './cloud.js'

const STATES = ['Backlog', 'Discussed', 'Planned', 'Working', 'Review', 'Done']
const PAGE = 1000
const REFRESH_MS = 30_000
const RECENT_MS = 14 * 24 * 3600 * 1000
const PREFS_KEY = 'k0.cloud.board'

const root = document.getElementById('root')
const records = new Map() // uid → { kind, uid, data }
let lastSeq = 0
let person = null
let openUid = null
const view = { repo: '', state: '', allDone: false }

// The filters are a convenience for this browser only, so losing them is harmless.
try { Object.assign(view, JSON.parse(localStorage.getItem(PREFS_KEY)) || {}) } catch {}
function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(view)) } catch {} }

// Pages through the records after `lastSeq`. The first load asks only for live rows; later
// ones ask for everything newer, because a deletion arrives as a newer row marked deleted.
async function pull(first) {
  const ws = encodeURIComponent(person.workspace)
  for (;;) {
    const path = '/rest/v1/records?select=kind,uid,data,deleted,seq&workspace_id=eq.' + ws +
      (first ? '&deleted=eq.false' : '') + '&seq=gt.' + lastSeq + '&order=seq.asc&limit=' + PAGE
    const rows = await api(path)
    for (const r of rows) {
      if (r.deleted) records.delete(r.uid)
      else records.set(r.uid, { kind: r.kind, uid: r.uid, data: r.data || {} })
      if (r.seq > lastSeq) lastSeq = r.seq
    }
    if (rows.length < PAGE) return
  }
}

function ofKind(kind) { return [...records.values()].filter(r => r.kind === kind) }

function keyOf(n) {
  if (typeof n !== 'number') return 'K?'
  return n < 0 ? 'K~' + -n : 'K' + n
}

// The newest session per story, by started_at, is what that story is doing right now.
function liveStatus() {
  const newest = new Map()
  for (const s of ofKind('session')) {
    const id = s.data.story_id_uid
    if (!id) continue
    const prev = newest.get(id)
    if (!prev || (s.data.started_at || 0) > (prev.data.started_at || 0)) newest.set(id, s)
  }
  const out = new Map()
  for (const [id, s] of newest) if (s.data.alive === 1 || s.data.alive === true) out.set(id, s.data.status)
  return out
}

function date(ms) { return ms ? new Date(ms).toLocaleString() : '' }

function card(story, epics, live) {
  const d = story.data
  const status = live.get(story.uid)
  const epic = d.epic_id_uid && epics.get(d.epic_id_uid)
  const meta = [d.project_name, epic && epic.data.title].filter(Boolean).join(' · ')
  return el('button', { class: 'card', type: 'button', onclick: () => openPanel(story.uid) },
    el('div', { class: 'row' },
      el('span', { class: 'key' }, keyOf(d.key_num)),
      status && el('span', { class: 'pill ' + status }, status),
      d.starred ? el('span', { class: 'star', title: 'Starred', 'aria-label': 'Starred' }, '★') : null),
    el('div', { class: 'title' }, d.title || 'Untitled'),
    meta && el('div', { class: 'meta' }, meta))
}

function render() {
  const stories = ofKind('story')
  const epics = new Map(ofKind('epic').map(e => [e.uid, e]))
  const live = liveStatus()
  const repos = [...new Set(stories.map(s => s.data.project_name).filter(Boolean))].sort()
  if (view.repo && !repos.includes(view.repo)) view.repo = ''

  const repoSelect = el('select', {
    'aria-label': 'Repository',
    onchange: e => { view.repo = e.target.value; savePrefs(); render() }
  }, el('option', { value: '' }, 'All repositories'), repos.map(r => el('option', { value: r }, r)))
  repoSelect.value = view.repo
  const stateSelect = el('select', {
    'aria-label': 'State',
    onchange: e => { view.state = e.target.value; savePrefs(); render() }
  }, el('option', { value: '' }, 'All states'), STATES.map(s => el('option', { value: s }, s)))
  stateSelect.value = view.state

  const shown = stories.filter(s => !view.repo || s.data.project_name === view.repo)
  const cols = (view.state ? [view.state] : STATES).map(state => {
    let list = shown.filter(s => s.data.state === state)
    let toggle = null
    if (state === 'Done') {
      const recent = list.filter(s => (s.data.completed_at || 0) >= Date.now() - RECENT_MS)
      if (recent.length < list.length || view.allDone) {
        toggle = el('button', {
          type: 'button',
          onclick: () => { view.allDone = !view.allDone; savePrefs(); render() }
        }, view.allDone ? 'last 14 days' : 'show all')
      }
      if (!view.allDone) list = recent
      list.sort((a, b) => (b.data.completed_at || 0) - (a.data.completed_at || 0))
    } else {
      list.sort((a, b) => (b.data.starred ? 1 : 0) - (a.data.starred ? 1 : 0) ||
        (b.data.updated_at || 0) - (a.data.updated_at || 0))
    }
    return el('section', { class: 'col' },
      el('h2', {}, el('span', {}, state + ' · ' + list.length), toggle),
      list.length ? list.map(s => card(s, epics, live)) : el('div', { class: 'empty' }, 'Nothing here'))
  })

  root.replaceChildren(
    header(person, el('div', { class: 'filters' }, repoSelect, stateSelect)),
    el('p', { class: 'note' }, 'Read-only — the board is edited from k0 on your computer.'),
    el('main', { class: 'board' }, cols),
    panel())
}

function section(title, ...body) { return [el('h3', {}, title), ...body] }

function panel() {
  const story = openUid && records.get(openUid)
  if (!story) return el('aside', { class: 'panel', hidden: true })
  const d = story.data
  const epic = d.epic_id_uid && records.get(d.epic_id_uid)
  const parent = d.parent_story_id_uid && records.get(d.parent_story_id_uid)
  const status = liveStatus().get(story.uid)
  const decisions = ofKind('decision')
    .filter(x => x.data.story_id_uid === story.uid)
    .sort((a, b) => (a.data.n || 0) - (b.data.n || 0))

  const facts = [
    d.state, d.project_name, epic && 'Epic: ' + (epic.data.title || ''),
    parent && 'Part of ' + keyOf(parent.data.key_num) + ' ' + (parent.data.title || ''),
    d.created_at && 'Created ' + date(d.created_at),
    d.completed_at && 'Done ' + date(d.completed_at)
  ].filter(Boolean).join(' · ')

  return el('aside', { class: 'panel', 'aria-label': 'Story' },
    el('div', { class: 'head' },
      el('h2', {}, el('span', { class: 'key' }, keyOf(d.key_num)), ' ', d.title || 'Untitled'),
      el('button', { type: 'button', onclick: closePanel, 'aria-label': 'Close' }, 'Close')),
    el('div', { class: 'meta' }, status && el('span', { class: 'pill ' + status }, status), ' ', facts),
    section('Description', d.body ? el('pre', {}, d.body) : el('div', { class: 'empty' }, 'No description.')),
    section('Plan', d.plan ? el('pre', {}, d.plan) : el('div', { class: 'empty' }, 'No plan yet.')),
    section('Decisions', decisions.length
      ? el('ol', {}, decisions.map(x => el('li', {
        class: x.data.superseded_by_uid ? 'superseded' : null,
        value: x.data.n || null
      }, x.data.text || '')))
      : el('div', { class: 'empty' }, 'No decisions recorded.')))
}

function openPanel(uid) { openUid = uid; render() }
function closePanel() { openUid = null; render() }

document.addEventListener('keydown', e => { if (e.key === 'Escape' && openUid) closePanel() })

function fail(e) {
  if (e instanceof SignedOut) return location.reload()
  root.replaceChildren(header(person), el('main', { class: 'gate' },
    el('h1', {}, 'Could not load the board'), el('p', { class: 'error' }, e.message)))
}

async function refresh() {
  if (document.visibilityState !== 'visible') return
  try {
    const before = lastSeq
    await pull(false)
    if (lastSeq !== before) render()
  } catch (e) {
    // A hiccup on a background refresh is not worth replacing the board over; signing out is.
    if (e instanceof SignedOut) fail(e)
  }
}

async function start() {
  person = await gate(root)
  if (!person) return
  if (!person.workspace) {
    root.replaceChildren(header(person), el('main', { class: 'gate' },
      el('h1', {}, 'No board yet'),
      el('p', {}, 'Nothing has been sent from k0 on your computer yet. Sign in there and it will appear here.')))
    return
  }
  try {
    await pull(true)
    render()
  } catch (e) {
    return fail(e)
  }
  setInterval(refresh, REFRESH_MS)
  document.addEventListener('visibilitychange', refresh)
}

start()
