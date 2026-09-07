import { render, esc } from '/md.js'
import { score, positions, runs as stretches } from '/fuzzy.js'

// ── The backlog, dense ────────────────────────────────────────────────────────
// k0's fourth page. The board is for looking at; this is for reading, and for working the
// backlog over — one row per story, everything that can be counted already counted by the
// server, and underneath the table the whole of whichever story you clicked.
//
// Three things decide how it is built.
//
// It is one document. The table, the story you opened and the epics are stacked and the page
// scrolls, rather than being panes that scroll separately: a pane that scrolls on its own is two
// pages pretending to be one, and this is a page you read top to bottom.
//
// Nothing is worked out here that the server already knows. The alias, whether a story is
// blocked, how many decisions are still standing, how far an epic has got — all of it arrives
// counted. What is done here is choosing, sorting and drawing.
//
// And it follows a discussion while the discussion is happening. `…/live` is asked once a second,
// the same cadence the board and the file viewer already use, and the whole story is re-read only
// when that cheap answer says something moved. A terminal can die at round three and this page
// still has the first three.

const $ = (s) => document.querySelector(s)

const api = async (url, opts) => {
  const r = await fetch(url, { headers: { 'content-type': 'application/json' }, ...opts })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.error || r.statusText)
  return body
}

const params = new URLSearchParams(location.search)

/** The six, in the order a story moves through them — which is also the order they sort in. */
const STATES = ['Backlog', 'Discussed', 'Planned', 'Working', 'Review', 'Done']

let repos = [] // [{ path, name }] — the repositories that have a backlog at all
let stories = []
let epics = []
let repo = params.get('repo') || ''
let epicKey = params.get('epic') || ''
// And which repository that epic belongs to. Two repositories can both have a K7 — the keys are
// counted per repository and that is intended — so the key alone is not the name of an epic. Held
// apart from `repo` because an epic can be chosen while every repository is on screen.
let epicRepo = params.get('epic_repo') || ''
const off = new Set() // the states switched off, by name
let query = ''
// `chosen` is whether a column heading has been clicked. Until it has, typing in the search
// orders the rows by how well they match — which is the only order a search has to offer — and
// after it has, the column the user picked wins, because they picked it.
let sort = { by: 'alias', dir: 1, chosen: false }
let openId = Number(params.get('story')) || 0
// Or the epic. The panel under the table holds one or the other and never both: an epic's
// discussion is the same kind of reading as a story's, and two panels stacked would be two
// places to look for one thing.
let openEpicId = Number(params.get('open_epic')) || 0
let view = null // whatever is open, as `/api/backlog/story/:id` or `/api/backlog/epic/:id` gives it
let drawn = '' // the JSON of what is on screen, so a poll that changed nothing redraws nothing
let ticker = null
let ticks = 0
let beat = '' // the last live answer, likewise

// ── Small change ──────────────────────────────────────────────────────────────

const keyNum = (key) => Number(String(key ?? '').replace(/^K/, '')) || 0

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The shape every time on this page takes. No seconds: nothing here is worth reading that finely. */
const CLOCK = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }

const when = (t) => (t ? new Date(Number(t)).toLocaleString(undefined, CLOCK) : '')

const day = (t) => (t ? new Date(Number(t)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '')

/** A state as a pill. The colours are the board's own, from base.css: nothing new was invented. */
const pill = (state) => `<span class="pill" data-state="${esc(state)}">${esc(state)}</span>`

/** The first thing an epic's body says, which is all there is room for next to a progress bar. */
const firstLine = (text) => String(text ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? ''

/** A piece of text with the letters that matched underlined — the file viewer's gesture, reused. */
function lit(text, at) {
  const spans = stretches(at)
  if (!spans.length) return esc(text)
  let out = ''
  let from = 0
  for (const [start, stop] of spans) {
    if (start >= text.length) break
    const end = Math.min(stop, text.length)
    out += `${esc(text.slice(from, start))}<u>${esc(text.slice(start, end))}</u>`
    from = end
  }
  return out + esc(text.slice(from))
}

function toast(msg, ms = 4000) {
  const t = $('#toast')
  t.textContent = msg
  t.classList.add('show')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => t.classList.remove('show'), ms)
}

/** Where you are, in the address bar: a reload comes back to the same repository and the same story. */
function address() {
  const q = new URLSearchParams()
  if (repo) q.set('repo', repo)
  if (epicKey) q.set('epic', epicKey)
  if (epicKey && epicRepo) q.set('epic_repo', epicRepo)
  if (openId) q.set('story', String(openId))
  if (openEpicId) q.set('open_epic', String(openEpicId))
  const s = q.toString()
  history.replaceState(null, '', s ? `?${s}` : location.pathname)
}

// ── The columns ───────────────────────────────────────────────────────────────
// Sorting is offered where it means something and nowhere else. There is no sort on the
// dependencies of a story — a list of keys has no order anybody wants — beyond how many it is
// waiting for, which is the question actually being asked when you click that heading.

/** Positions compare piece by piece, as numbers: 1.9 comes before 1.12, which is why it is here. */
function byAlias(a, b) {
  const x = String(a.alias ?? '').split('.').map(Number)
  const y = String(b.alias ?? '').split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? -1) - (y[i] ?? -1)
    if (d) return d
  }
  return 0
}

// Every `cmp` here is written ASCENDING, without exception, and `down` is what says which way the
// first click on that heading should read it. They were not always: three of them were written
// descending and then multiplied by the same -1 as the rest, which turned them round — the first
// click on `Decisions` sent the stories with a broken decision to the bottom of the table, which
// is the exact opposite of what that column is for. A comparator whose direction is baked into it
// is a comparator that cannot be turned round, so none of them has one.
const COLUMNS = [
  { id: 'repo', label: 'Repository', cls: 'repo', cmp: (a, b) => a.project_name.localeCompare(b.project_name) },
  { id: 'key', label: 'Key', cls: 'key', cmp: (a, b) => keyNum(a.key) - keyNum(b.key) },
  { id: 'alias', label: 'Pos', cls: 'pos', cmp: byAlias, title: 'Where it sits in the tree' },
  { id: 'title', label: 'Title', cls: 'title', cmp: (a, b) => a.title.localeCompare(b.title) },
  { id: 'epic', label: 'Epic', cls: 'epic', cmp: (a, b) => keyNum(a.epic_key) - keyNum(b.epic_key) },
  { id: 'state', label: 'State', cls: 'state', cmp: (a, b) => STATES.indexOf(a.state) - STATES.indexOf(b.state) },
  {
    id: 'star',
    label: '★',
    cls: 'star',
    title: 'Starred',
    down: true,
    cmp: (a, b) => (a.starred ? 1 : 0) - (b.starred ? 1 : 0),
  },
  { id: 'deps', label: 'Waits on', cls: 'deps', down: true, cmp: (a, b) => a.deps.length - b.deps.length },
  {
    id: 'decisions',
    label: 'Decisions',
    cls: 'num',
    title: 'Still standing, of all that were taken',
    down: true,
    // A broken decision sorts above everything, whatever the numbers say: it is the one thing on
    // this page you are meant to deal with before anything else. Ascending here, `down` above:
    // the first click reverses this and the violations come out on top.
    cmp: (a, b) => a.violations_open - b.violations_open || a.decisions_open - b.decisions_open,
  },
  {
    id: 'checks',
    label: 'Checks',
    cls: 'num',
    title: 'Passed, of the whole checklist',
    down: true,
    cmp: (a, b) => share(a) - share(b),
  },
]

/** How much of a checklist has passed. A story with no checklist has none, not nought of nothing. */
const share = (s) => (s.checks_total ? s.checks_passed / s.checks_total : -1)

/** Whether the repository column is worth a column: with one repository on screen it says nothing. */
const manyRepos = () => !repo && new Set(stories.map((s) => s.project_path)).size > 1

const columns = () => COLUMNS.filter((c) => c.id !== 'repo' || manyRepos())

// ── Choosing what is on screen ────────────────────────────────────────────────

/**
 * Everything the repository and epic lists allow, before the states and the search.
 *
 * An epic is its key AND its repository, never the key on its own: `K7` exists in as many
 * repositories as have got that far, and matching on the key alone put two epics' stories in one
 * table under one `1.x` ladder while the dropdown claimed a single epic was selected.
 */
const inScope = () =>
  stories.filter(
    (s) =>
      (!repo || s.project_path === repo) &&
      (!epicKey || (s.epic_key === epicKey && (!epicRepo || s.project_path === epicRepo)))
  )

function chosen() {
  const q = query.trim()
  let rows = inScope().filter((s) => !off.has(s.state))
  if (q) rows = rows.filter((s) => score(s.title, q) >= 0)

  const cmp = COLUMNS.find((c) => c.id === sort.by)?.cmp ?? byAlias
  rows.sort((a, b) => {
    // A search nobody has re-sorted comes out in the order the search itself found: the closest
    // to what was typed first. One click on a heading and that stops being true, on purpose.
    if (q && !sort.chosen) {
      const d = score(b.title, q) - score(a.title, q)
      if (d) return d
    } else {
      const d = cmp(a, b) * sort.dir
      if (d) return d
    }
    return (
      a.project_name.localeCompare(b.project_name) || a.sort_hint - b.sort_hint || a.id - b.id
    )
  })
  return rows
}

// ── The table ─────────────────────────────────────────────────────────────────

function headHtml() {
  const cells = columns()
    .map((c) => {
      const on = sort.chosen && sort.by === c.id
      const order = on ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'
      const arrow = on ? `<i>${sort.dir > 0 ? '▴' : '▾'}</i>` : ''
      return `<th class="${c.cls}" data-sort="${c.id}" aria-sort="${order}"${
        c.title ? ` title="${esc(c.title)}"` : ''
      }>${esc(c.label)}${arrow}</th>`
    })
    .join('')
  return `<tr>${cells}</tr>`
}

/** The keys a story waits for, the unfinished ones marked: that is the whole of what blocks it. */
function depsHtml(s) {
  if (!s.deps.length) return ''
  return s.deps
    .map(
      (d) =>
        `<button type="button" class="dep${d.state === 'Done' ? '' : ' out'}" data-story="${d.id}" ` +
        `title="${esc(`${d.key} · ${d.title} · ${d.state}`)}">${esc(d.key)}</button>`
    )
    .join('')
}

const starHtml = (s) =>
  `<button type="button" class="star" data-star="${s.id}" aria-pressed="${!!s.starred}" ` +
  `title="${s.starred ? 'Starred' : 'Not starred'}">${s.starred ? '★' : '☆'}</button>`

function cellHtml(c, s, at) {
  switch (c.id) {
    case 'repo':
      return esc(s.project_name)
    case 'key':
      return esc(s.key)
    case 'alias':
      return esc(s.alias || '—')
    case 'title':
      // A task is drawn under its parent rather than beside it: the alias already says 1.12.1,
      // and the eye reads the step in faster than it reads the number.
      return `<span class="in" style="--deep:${(s.alias || '').split('.').length - 1}">${lit(s.title, at)}</span>`
    case 'epic':
      return s.epic_key ? `<span title="${esc(s.epic_title ?? '')}">${esc(s.epic_key)}</span>` : ''
    case 'state':
      return pill(s.state)
    case 'star':
      return starHtml(s)
    case 'deps':
      return depsHtml(s)
    case 'decisions':
      return s.decisions_total
        ? `${s.decisions_open}<em>/${s.decisions_total}</em>${
            s.violations_open ? `<b class="broke" title="${esc(brokenWord(s))}">!</b>` : ''
          }`
        : ''
    case 'checks':
      return s.checks_total ? `${s.checks_passed}<em>/${s.checks_total}</em>` : ''
    default:
      return ''
  }
}

const brokenWord = (s) =>
  `The last counter-check found ${plural(s.violations_open, 'decision')} broken. ` +
  'This story cannot be finished until that is answered.'

function rowsHtml(rows) {
  const q = query.trim()
  const cols = columns()
  return rows
    .map((s) => {
      const at = q ? positions(s.title, q) : null
      const cells = cols.map((c) => `<td class="${c.cls}">${cellHtml(c, s, at)}</td>`).join('')
      return `<tr data-id="${s.id}" class="${s.id === openId ? 'on' : ''}${
        s.violations_open ? ' broken' : ''
      }${s.blocked ? ' blocked' : ''}">${cells}</tr>`
    })
    .join('')
}

// ── The filters ───────────────────────────────────────────────────────────────

function paintPickers() {
  const r = $('#repo')
  r.innerHTML =
    `<option value="">Every repository</option>` +
    repos.map((p) => `<option value="${esc(p.path)}">${esc(p.name)}</option>`).join('')
  r.value = repo

  // The epics of the repository in front of you, or all of them grouped by repository — which is
  // the only way `K7` in two repositories can be told apart in a list. The value carries the
  // repository with the key for the same reason: the label distinguishes them for the eye, and
  // without the path in the value nothing distinguishes them for the filter.
  const mine = epics.filter((e) => !repo || e.project_path === repo)
  const groups = new Map()
  for (const e of mine) groups.set(e.project_name, [...(groups.get(e.project_name) ?? []), e])
  const option = (e) =>
    `<option value="${esc(pick(e))}">${esc(`${e.key} · ${e.title}`)}</option>`
  const body =
    groups.size > 1
      ? [...groups]
          .map(([name, list]) => `<optgroup label="${esc(name)}">${list.map(option).join('')}</optgroup>`)
          .join('')
      : mine.map(option).join('')
  const e = $('#epic')
  e.innerHTML = `<option value="">Every epic</option>${body}`
  const wanted = mine.find((x) => x.key === epicKey && (!epicRepo || x.project_path === epicRepo))
  e.value = wanted ? pick(wanted) : ''
  epicKey = wanted ? wanted.key : ''
  epicRepo = wanted ? wanted.project_path : ''
  e.disabled = !mine.length
}

/**
 * One epic as a value a `<select>` can hold: its repository, a bar, and its key.
 *
 * Split at the LAST bar and not the first — a directory can have one in its name, a key never
 * can. A single option value is what a `<select>` gives back, and the two halves have to travel
 * in it together or the choice arrives without the half that makes it unambiguous.
 */
const pick = (e) => `${e.project_path}|${e.key}`

function unpick(value) {
  const cut = String(value ?? '').lastIndexOf('|')
  return cut === -1 ? { path: '', key: '' } : { path: value.slice(0, cut), key: value.slice(cut + 1) }
}

/** The six, each with how many there are — a state with nothing in it says so before you press it. */
function paintStates() {
  const scope = inScope()
  const q = query.trim()
  const counted = q ? scope.filter((s) => score(s.title, q) >= 0) : scope
  $('#states').innerHTML = STATES.map((state) => {
    const n = counted.filter((s) => s.state === state).length
    return `<button type="button" data-state="${state}" aria-pressed="${!off.has(state)}" class="chip" ` +
      `data-pill="${state}">${state}<em>${n}</em></button>`
  }).join('')
}

// ── The epics ─────────────────────────────────────────────────────────────────

function epicHtml(e) {
  const mine = stories.filter((s) => s.project_path === e.project_path && s.epic_key === e.key)
  const pct = e.progress.total ? Math.round((e.progress.done / e.progress.total) * 100) : 0
  const why = firstLine(e.body)
  const list = mine
    .sort(byAlias)
    .map(
      (s) =>
        `<li><button type="button" data-id="${s.id}"><b>${esc(s.key)}</b><i>${esc(s.alias || '')}</i>` +
        `<span>${esc(s.title)}</span></button>${pill(s.state)}</li>`
    )
    .join('')
  // What the discussion has got to, drawn on the card so an epic being argued out in a terminal
  // moves on this page while it happens. The counts come with the listing; the whole of it — the
  // rounds themselves and what they settled — is one click away, in the panel above the epics.
  const talk = [
    e.round ? `Round ${e.round.n}${e.round.estimated_total ? ` of about ${e.round.estimated_total}` : ''}` : '',
    e.decisions_total ? `${e.decisions_open} of ${plural(e.decisions_total, 'decision')} standing` : '',
  ]
    .filter(Boolean)
    .join('  ·  ')
  return `<article class="epic${e.state === 'Done' ? ' done' : ''}">
    <header>
      <button type="button" class="name" data-epic="${esc(e.key)}" data-repo="${esc(e.project_path)}"
        data-open="${e.id}" title="Open this epic: what was asked, what was decided, what it became">
        <b>${esc(e.key)}</b><i>${esc(e.alias || '')}</i><span>${esc(e.title)}</span>
      </button>
      ${pill(e.state)}
      <em class="prog">${e.progress.done}/${e.progress.total} done</em>
    </header>
    <div class="bar" role="img" aria-label="${e.progress.done} of ${e.progress.total} done">
      <i style="width:${pct}%"></i>
    </div>
    ${why ? `<p class="why">${esc(why)}</p>` : ''}
    ${talk ? `<p class="talk">${esc(talk)}</p>` : ''}
    ${list ? `<ul class="mini">${list}</ul>` : '<p class="why">Nothing under it yet.</p>'}
  </article>`
}

function paintEpics() {
  const mine = epics.filter((e) => !repo || e.project_path === repo)
  const box = $('#epics')
  if (!mine.length) {
    box.innerHTML = ''
    return
  }
  const groups = new Map()
  for (const e of mine) groups.set(e.project_name, [...(groups.get(e.project_name) ?? []), e])
  const body = [...groups]
    .map(
      ([name, list]) =>
        `${groups.size > 1 ? `<h3>${esc(name)}</h3>` : ''}${list.map(epicHtml).join('')}`
    )
    .join('')
  box.innerHTML = `<h2>Epics</h2>${body}`
}

// ── Painting the page ─────────────────────────────────────────────────────────

function paint() {
  paintPickers()
  paintStates()
  const rows = chosen()
  $('#head').innerHTML = headHtml()
  $('#rows').innerHTML = rowsHtml(rows)
  const all = inScope().length
  $('#count').textContent = all ? `${rows.length} of ${plural(all, 'story', 'stories')}` : ''
  $('#blank').hidden = rows.length > 0
  $('#blank').textContent = all
    ? 'Nothing here matches what you are looking for.'
    : 'There is no backlog in this repository yet.'
  paintEpics()
}

// ── One story, whole ──────────────────────────────────────────────────────────

/** What the live poll says, and what the first paint says before there has been a poll. */
const beatOf = (v) => ({
  state: v.story.state,
  round: v.rounds.length ? { n: v.rounds.at(-1).n, estimated_total: v.rounds.at(-1).estimated_total } : null,
  session: v.story.session,
})

/** The same for an epic, which has rounds and a state and never a session. */
const beatOfEpic = (v) => ({
  state: v.epic.state,
  round: v.rounds.length ? { n: v.rounds.at(-1).n, estimated_total: v.rounds.at(-1).estimated_total } : null,
  session: null,
})

/**
 * The line that moves while somebody is being asked questions in a terminal. "Round 3 of about 8"
 * is the estimate as it stood at that round, and it is meant to move: the discussion recounts what
 * is still open every time round, so the total goes up as often as down.
 */
function liveHtml(l) {
  const bits = []
  if (l.round) {
    bits.push(
      `<b>Round ${l.round.n}${l.round.estimated_total ? ` of about ${l.round.estimated_total}` : ''}</b>`
    )
  }
  bits.push(pill(l.state))
  if (l.session?.status) {
    bits.push(
      `<span class="sess" data-status="${esc(l.session.status)}">${esc(l.session.status)}` +
        `${l.session.alive ? '' : ' · ended'}</span>`
    )
  }
  return bits.join('')
}

/**
 * The counter-check, and it sits directly under the title on every story whether or not anything
 * is wrong. It is why this page exists: a decision the last run found broken has to be the first
 * thing you see, not something you find by scrolling.
 */
function counterHtml(v) {
  const last = v.runs[0] ?? null
  const history = v.runs.length
    ? `<table class="runs"><tr><th>Run</th><th>When</th><th>Kept</th><th>Broken</th><th>N/A</th></tr>${v.runs
        .map(
          (r) =>
            `<tr><td>${r.run}</td><td>${esc(when(r.at))}</td><td>${r.kept}</td>` +
            `<td class="${r.violated ? 'bad' : ''}">${r.violated}</td><td>${r.na}</td></tr>`
        )
        .join('')}</table>`
    : ''

  if (!v.violations.length) {
    return `<section class="counter clean">
      <h3>Counter-check</h3>
      <p>${
        last
          ? esc(`Run ${last.run} held every decision: ${last.kept} kept, ${last.na} not applicable, none broken.`)
          : 'Nobody has counter-checked this story yet.'
      }</p>
      ${history}
    </section>`
  }

  const rows = v.violations
    .map(
      (x) =>
        `<div class="v">
          <div class="what"><b>${esc(x.label)}</b><span>${esc(x.text)}</span></div>
          <div class="verdict">violated</div>
          <div class="ev">${x.evidence ? esc(x.evidence) : '<i>no evidence was written</i>'}</div>
        </div>`
    )
    .join('')

  return `<section class="counter broken">
    <h3>${esc(`${plural(v.violations.length, 'decision')} broken`)}</h3>
    <div class="verdicts">
      <div class="vhead"><span>What was decided</span><span>The verdict</span><span>The evidence</span></div>
      ${rows}
    </div>
    <p class="rule">Put it right and run the counter-check again, or supersede the decision if it is
      the decision that was wrong. Until then this story cannot be marked Done.</p>
    ${history}
  </section>`
}

function roundHtml(r) {
  return `<article class="round">
    <h4>Round ${r.n}${r.estimated_total ? ` of about ${r.estimated_total}` : ''}<time>${esc(when(r.at))}</time></h4>
    <div class="q prose">${render(r.question || '')}</div>
    ${
      r.answer
        ? `<div class="a prose">${render(r.answer)}</div>`
        : '<p class="a waiting">Asked. Nothing answered yet.</p>'
    }
  </article>`
}

function discussionHtml(v) {
  if (!v.rounds.length && !v.epic_rounds.length) return ''
  const epicPart = v.epic_rounds.length
    ? `<details class="inherited" data-keep="inherited">
        <summary>${esc(
          `${plural(v.epic_rounds.length, 'round')} on ${v.epic?.key ?? 'the epic'}, before this story existed`
        )}</summary>
        ${v.epic_rounds.map(roundHtml).join('')}
      </details>`
    : ''
  return `<section class="block">
    <h3>Discussion</h3>
    ${epicPart}
    ${v.rounds.map(roundHtml).join('') || '<p class="none">This story has not been discussed.</p>'}
  </section>`
}

/** The list itself, so a story's decisions and an epic's own are drawn by one piece of code. */
function decisionList(decisions, { broken = new Set(), epicKey = null } = {}) {
  const items = decisions
    .map((d) => {
      const bits = []
      if (d.owner === 'epic' && epicKey) bits.push(`inherited from ${esc(epicKey)}`)
      if (d.source && d.source !== 'discussion') bits.push(esc(d.source))
      if (d.superseded_by) bits.push('superseded')
      return `<li class="${d.superseded_by ? 'gone' : ''}${broken.has(d.id) ? ' bad' : ''}${
        d.owner === 'epic' && epicKey ? ' up' : ''
      }"><b>${esc(d.label)}</b><span>${esc(d.text)}</span>${
        bits.length ? `<em>${bits.join(' · ')}</em>` : ''
      }</li>`
    })
    .join('')
  return `<ul class="decisions">${items}</ul>`
}

function decisionsHtml(v) {
  if (!v.decisions.length) return ''
  const broken = new Set(v.violations.map((x) => x.decision_id))
  return `<section class="block">
    <h3>Decisions</h3>
    ${decisionList(v.decisions, { broken, epicKey: v.epic?.key ?? 'the epic' })}
  </section>`
}

function checksHtml(v) {
  if (!v.checks.length) return ''
  const mark = { pass: '✓', fail: '✗', skip: '–', todo: '' }
  const items = v.checks
    .map(
      (c) =>
        `<li class="${esc(c.state)}">
          <button type="button" class="tick" data-check="${c.id}" data-state="${esc(c.state)}"
            title="${c.state === 'pass' ? 'Passed — click to put it back' : 'Click when you have seen it work'}"
            aria-pressed="${c.state === 'pass'}">${mark[c.state] ?? ''}</button>
          <span>${esc(c.text)}</span>
          ${c.evidence ? `<em>${esc(c.evidence)}</em>` : ''}
          <i class="by">${esc(c.by)}</i>
        </li>`
    )
    .join('')
  const done = v.checks.filter((c) => c.state === 'pass').length
  return `<section class="block">
    <h3>Checklist<small>${done}/${v.checks.length}</small></h3>
    <ul class="checks">${items}</ul>
  </section>`
}

function logHtml(v) {
  if (!v.log.length && !v.sessions.length) return ''
  const entries = v.log
    .map(
      (l) =>
        `<li><time>${esc(when(l.at))}</time>${
          l.session_id ? `<i>${esc(String(l.session_id).slice(0, 8))}</i>` : ''
        }<div class="prose">${render(l.text || '')}</div></li>`
    )
    .join('')
  const sessions = v.sessions.length
    ? `<p class="sessions">${esc(
        v.sessions
          .map((s) => `${String(s.session_id ?? '—').slice(0, 8)} · ${day(s.started_at)}${
            s.ended_at ? ` → ${day(s.ended_at)}` : ' · still open'
          }`)
          .join('  ·  ')
      )}</p>`
    : ''
  return `<section class="block">
    <h3>Log</h3>
    ${entries ? `<ul class="log">${entries}</ul>` : '<p class="none">Nothing has been written down yet.</p>'}
    ${sessions}
  </section>`
}

/**
 * What this story waits for, and what is waiting for it.
 *
 * The second half is the one nothing else on the board shows. A post-it can say what a story is
 * waiting for; the reason to finish one story before another is usually what is stuck behind it,
 * and until now that was only ever visible from the other end.
 */
function waitsHtml(v) {
  const keys = (list) =>
    list
      .map(
        (d) =>
          `<button type="button" class="dep${d.state === 'Done' ? '' : ' out'}" data-story="${d.id}" ` +
          `title="${esc(`${d.key} · ${d.title} · ${d.state}`)}">${esc(d.key)}</button>`
      )
      .join('')
  const bits = []
  if (v.story.deps.length) bits.push(`<span>waits on</span>${keys(v.story.deps)}`)
  if (v.blocks?.length) bits.push(`<span>and is waited on by</span>${keys(v.blocks)}`)
  return bits.length ? `<p class="waits">${bits.join('')}</p>` : ''
}

function storyHtml(v) {
  const s = v.story
  const where = [
    s.project_name,
    s.epic_key ? `${s.epic_key} · ${s.epic_title}` : null,
    s.parent_key ? `under ${s.parent_key}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ')
  return `<header class="head">
      <div class="who">
        <b class="key">${esc(s.key)}</b><i class="pos">${esc(s.alias || '')}</i>
        <h2>${esc(s.title)}</h2>
        ${starHtml(s)}
      </div>
      <p class="where">${esc(where)}</p>
      ${waitsHtml(v)}
      <p class="live" id="live">${liveHtml(beatOf(v))}</p>
      <button type="button" class="x" id="shut" title="Close" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M6 6l12 12M18 6L6 18"/>
        </svg>
      </button>
    </header>
    ${counterHtml(v)}
    ${s.body ? `<section class="block"><h3>Why</h3><div class="prose">${render(s.body)}</div></section>` : ''}
    ${discussionHtml(v)}
    ${decisionsHtml(v)}
    ${v.plan ? `<section class="block"><h3>Plan</h3><div class="prose">${render(v.plan)}</div></section>` : ''}
    ${checksHtml(v)}
    ${logHtml(v)}`
}

/**
 * An epic in the same panel a story opens in: why it exists, the rounds it was argued out in, the
 * decisions those rounds settled, and what it turned into.
 *
 * It is here because `/k0-epic` is the long way into the backlog and all of it happens before a
 * single story exists. Without this the whole of that conversation was invisible while it was
 * happening and stayed invisible afterwards — the decisions only appeared once a story had been
 * created under the epic and somebody had clicked that story's row.
 */
function epicPanelHtml(v) {
  const e = v.epic
  const pct = e.progress.total ? Math.round((e.progress.done / e.progress.total) * 100) : 0
  const list = v.stories
    .filter((s) => !s.parent_key)
    .map(
      (s) =>
        `<li><button type="button" data-id="${s.id}"><b>${esc(s.key)}</b><i>${esc(s.alias || '')}</i>` +
        `<span>${esc(s.title)}</span></button>${pill(s.state)}</li>`
    )
    .join('')
  return `<header class="head">
      <div class="who">
        <b class="key">${esc(e.key)}</b><i class="pos">${esc(e.alias || '')}</i>
        <h2>${esc(e.title)}</h2>
      </div>
      <p class="where">${esc(`${e.project_name}  ·  ${e.progress.done} of ${e.progress.total} done`)}</p>
      <p class="live" id="live">${liveHtml(beatOfEpic(v))}</p>
      <button type="button" class="x" id="shut" title="Close" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M6 6l12 12M18 6L6 18"/>
        </svg>
      </button>
    </header>
    <div class="bar" role="img" aria-label="${e.progress.done} of ${e.progress.total} done">
      <i style="width:${pct}%"></i>
    </div>
    ${e.body ? `<section class="block"><h3>Why</h3><div class="prose">${render(e.body)}</div></section>` : ''}
    <section class="block">
      <h3>Discussion</h3>
      ${v.rounds.map(roundHtml).join('') || '<p class="none">This epic has not been discussed yet.</p>'}
    </section>
    ${
      v.decisions.length
        ? `<section class="block"><h3>Decisions</h3>${decisionList(v.decisions)}
           <p class="rule">Every story under this epic is held to these, and counter-checked against
             them one by one. Supersede one here and it changes for all of them at once.</p></section>`
        : ''
    }
    <section class="block">
      <h3>Stories<small>${e.progress.done}/${e.progress.total}</small></h3>
      ${list ? `<ul class="mini">${list}</ul>` : '<p class="none">Nothing under it yet.</p>'}
    </section>`
}

/**
 * Which disclosures the reader has opened, by name.
 *
 * The panel is rebuilt from scratch every time the thing it is showing moves — which is the whole
 * point of the once-a-second poll — and a `<details>` drawn fresh is a `<details>` closed. Without
 * this, the inherited rounds somebody opened to read what the epic had settled shut under them on
 * the very round they were waiting for.
 */
const opened = new Set()

function keepOpen(box) {
  for (const d of box.querySelectorAll('details[data-keep]')) {
    const name = d.dataset.keep
    d.open = opened.has(name)
    d.ontoggle = () => (d.open ? opened.add(name) : opened.delete(name))
  }
}

/** Draws whatever is open, and only when it has actually changed: this runs on a poll. */
function drawPanel() {
  const box = $('#story')
  if (!view) {
    box.hidden = true
    box.innerHTML = ''
    return
  }
  const same = JSON.stringify(view)
  if (same === drawn) return
  drawn = same
  box.hidden = false
  box.innerHTML = openEpicId ? epicPanelHtml(view) : storyHtml(view)
  keepOpen(box)
}

// ── Following it live ─────────────────────────────────────────────────────────

/**
 * The cheap round, once a second. It moves the line under the title straight away and re-reads the
 * whole story only when something has moved.
 *
 * The `ticks % 5` is not belt and braces. `…/live` reports the LAST round's number and estimate,
 * and a round is written twice — the question when it is asked, the answer when it comes back —
 * with the same number both times. So an answer landing in a round already announced changes
 * nothing the cheap answer can see, and without this the words would sit there unread until the
 * next question. Five seconds is close enough to watch a conversation by.
 */
async function tick() {
  const story = openId
  const epic = openEpicId
  if (!story && !epic) return
  let now
  try {
    now = await api(story ? `/api/backlog/story/${story}/live` : `/api/backlog/epic/${epic}/live`)
  } catch {
    return // the server is restarting, or it has gone: the next round will find out
  }
  if (story !== openId || epic !== openEpicId || !now?.state) return

  const line = $('#live')
  if (line) line.innerHTML = liveHtml(now)
  if (story) freshen(story, now)

  const s = JSON.stringify(now)
  ticks += 1
  if (s === beat && ticks % 5) return
  beat = s
  await reread()
}

/** The row in the table, brought up to date from the same cheap answer. */
function freshen(id, now) {
  const s = stories.find((x) => x.id === id)
  if (!s) return
  const before = `${s.state}${s.decisions_open}${s.checks_passed}${s.session?.status ?? ''}${s.session?.alive ?? ''}`
  s.state = now.state
  s.decisions_open = now.decisions
  s.checks_passed = now.checks_passed
  s.session = now.session
  if (before !== `${s.state}${s.decisions_open}${s.checks_passed}${s.session?.status ?? ''}${s.session?.alive ?? ''}`) {
    paint()
  }
}

/** Reads back whichever of the two is open, and puts the row or the card it came from in step. */
async function reread() {
  const story = openId
  const epic = openEpicId
  try {
    if (story) {
      const whole = await api(`/api/backlog/story/${story}`)
      if (story !== openId || !whole?.story) return
      view = whole
      // The listing carries counts the story view has just recomputed. Keeping the row in step
      // with the panel matters more than the round trip it would take to ask for it again.
      const row = stories.findIndex((x) => x.id === story)
      if (row !== -1) stories[row] = { ...stories[row], ...whole.story }
    } else if (epic) {
      const whole = await api(`/api/backlog/epic/${epic}`)
      if (epic !== openEpicId || !whole?.epic) return
      view = whole
      const card = epics.findIndex((e) => e.id === epic)
      if (card !== -1) epics[card] = { ...epics[card], ...whole.epic }
    } else return
    drawPanel()
    paint()
  } catch {
    /* same as above: nothing is lost by waiting a second */
  }
}

function follow() {
  clearInterval(ticker)
  ticker = null
  ticks = 0
  beat = ''
  if (openId || openEpicId) ticker = setInterval(tick, 1000)
}

// ── Opening and shutting ──────────────────────────────────────────────────────

async function openStory(id, { jump = true } = {}) {
  const n = Number(id)
  if (!n) return
  const first = n !== openId
  openId = n
  openEpicId = 0
  await opening('Reading the story…', first && jump)
}

async function openEpic(id, { jump = true } = {}) {
  const n = Number(id)
  if (!n) return
  const first = n !== openEpicId
  openEpicId = n
  openId = 0
  await opening('Reading the epic…', first && jump)
}

/** The half the two of them share: empty the panel, read the thing, start following it. */
async function opening(waiting, jump) {
  view = null
  drawn = ''
  address()
  paint()
  $('#story').hidden = false
  $('#story').innerHTML = `<p class="none">${waiting}</p>`
  await reread()
  follow()
  if (jump) $('#story').scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function shut() {
  openId = 0
  openEpicId = 0
  view = null
  drawn = ''
  clearInterval(ticker)
  ticker = null
  address()
  drawPanel()
  paint()
}

// ── The two things this page writes ───────────────────────────────────────────
// Everything else here reads. These two are the gestures you make while looking at a backlog
// rather than while working on it: putting a star on something, and ticking off a line you have
// just seen work with your own eyes — which is what `by: user` on a checklist is for.

async function toggleStar(id) {
  const s = stories.find((x) => x.id === Number(id))
  if (!s) return
  try {
    const after = await api(`/api/backlog/story/${s.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ starred: !s.starred }),
    })
    Object.assign(s, after)
    if (view?.story?.id === s.id) {
      view = { ...view, story: { ...view.story, starred: after.starred } }
      drawPanel()
    }
    paint()
  } catch (err) {
    toast(String(err.message || err))
  }
}

async function tickCheck(id, state) {
  try {
    await api(`/api/backlog/check/${Number(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: state === 'pass' ? 'todo' : 'pass', by: 'user' }),
    })
    await reread()
  } catch (err) {
    toast(String(err.message || err))
  }
}

// ── Loading ───────────────────────────────────────────────────────────────────

/**
 * The repositories worth asking about: the ones with a story on the board, plus the ones with an
 * epic and nothing in it yet — which is exactly the epic somebody is about to fill. Asking every
 * project k0 has ever seen would be a dozen requests to be told no.
 */
function reposOf(board) {
  const found = new Map()
  for (const c of board.columns ?? []) found.set(c.path, { path: c.path, name: c.name })
  for (const e of board.epics ?? []) found.set(e.project_path, { path: e.project_path, name: e.project_name })
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

async function reload() {
  const answers = await Promise.all(
    repos.map((r) => api(`/api/backlog?repo=${encodeURIComponent(r.path)}`).catch(() => null))
  )
  stories = answers.flatMap((a) => a?.stories ?? [])
  epics = answers.flatMap((a) => a?.epics ?? [])
  if (repo && !repos.some((r) => r.path === repo)) repo = ''
  paint()
}

function switchedOff() {
  $('#off').hidden = false
  for (const el of ['#repo', '#epic', '.find', '#states', '#grid', '#epics', '#story']) {
    const node = document.querySelector(el)
    if (node) node.remove()
  }
  $('#count').textContent = ''
}

async function start() {
  let board
  try {
    board = await api('/api/board')
  } catch (err) {
    $('#blank').hidden = false
    $('#blank').textContent = String(err.message || err)
    return
  }
  // The one switch that turns the whole feature off. It is asked of the board rather than of
  // `/api/backlog`, which needs a repository before it will say anything at all.
  if (!board.backlog) return switchedOff()

  repos = reposOf(board)
  await reload()
  if (openId) await openStory(openId, { jump: false })
  else if (openEpicId) await openEpic(openEpicId, { jump: false })

  // The same rhythm the file viewer keeps for its listing: often enough that a story created in a
  // terminal turns up on its own, rarely enough that it is not a poll.
  setInterval(() => reload().catch(() => {}), 30000)
}

// ── What you can press ────────────────────────────────────────────────────────

$('#rows').onclick = (e) => {
  const star = e.target.closest('[data-star]')
  if (star) return toggleStar(star.dataset.star)
  const dep = e.target.closest('[data-story]')
  if (dep) return openStory(dep.dataset.story)
  const row = e.target.closest('tr[data-id]')
  if (!row) return
  // Clicking the row that is already open shuts it. It is the same gesture in both directions,
  // which is what makes a table you can run down with the mouse rather than one you have to
  // close between stories.
  if (Number(row.dataset.id) === openId) shut()
  else openStory(row.dataset.id)
}

$('#head').onclick = (e) => {
  const th = e.target.closest('[data-sort]')
  if (!th) return
  const by = th.dataset.sort
  // The second click on the same heading turns it round. A first click sorts the way that heading
  // is worth reading: names up from A, everything countable down from the most — which is what
  // `down` on the column says, rather than a list of names kept in step with one by hand.
  if (sort.chosen && sort.by === by) sort.dir = -sort.dir
  else sort = { by, dir: COLUMNS.find((c) => c.id === by)?.down ? -1 : 1, chosen: true }
  sort.chosen = true
  paint()
}

$('#states').onclick = (e) => {
  const b = e.target.closest('[data-state]')
  if (!b) return
  const state = b.dataset.state
  if (off.has(state)) off.delete(state)
  else off.add(state)
  paint()
}

$('#repo').onchange = (e) => {
  repo = e.target.value
  epicKey = ''
  epicRepo = ''
  address()
  paint()
}

$('#epic').onchange = (e) => {
  const chosenEpic = unpick(e.target.value)
  epicKey = chosenEpic.key
  epicRepo = chosenEpic.path
  address()
  paint()
}

$('#q').oninput = (e) => {
  query = e.target.value
  paint()
}

$('#story').onclick = (e) => {
  if (e.target.closest('#shut')) return shut()
  const star = e.target.closest('[data-star]')
  if (star) return toggleStar(star.dataset.star)
  const check = e.target.closest('[data-check]')
  if (check) return tickCheck(check.dataset.check, check.dataset.state)
  // A key in the panel — one this story waits for, one waiting for it, or one under the open
  // epic — is the same gesture as a key in the table: it takes you to that story.
  const jump = e.target.closest('[data-story]')
  if (jump) return openStory(jump.dataset.story)
  const story = e.target.closest('[data-id]')
  if (story) return openStory(story.dataset.id)
}

$('#epics').onclick = (e) => {
  const story = e.target.closest('[data-id]')
  if (story) return openStory(story.dataset.id)
  const name = e.target.closest('[data-epic]')
  if (!name) return
  // One gesture, and it does the two things that go together: the table narrows to this epic, and
  // the epic itself opens — its rounds, its decisions and what it turned into. Before this the
  // discussion an epic was argued out in had nowhere on the page it could be read at all.
  repo = name.dataset.repo
  epicRepo = name.dataset.repo
  epicKey = name.dataset.epic
  openEpic(name.dataset.open)
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openId && !e.target.closest('input, select, textarea')) shut()
})

start()
