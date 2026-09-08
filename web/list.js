import { render, esc } from '/md.js'

// ── The list ─────────────────────────────────────────────────────────────────
// The dashboard's other shape. The kanban is for working — one note at a time, the one in front
// of you; this is for planning — everything at once, in the order you put it in, three levels
// deep and as many repositories as you have.
//
// Three things decide how it is built.
//
// It shows the same stories the board is showing. The state pills, the repository and the epic
// lane are applied before anything gets here, so switching between the two views never changes
// what is in scope — only its shape. That is why `drawList` is handed a list of stories and never
// goes and asks for one.
//
// Nothing is worked out here that the server already knows. Whether a story is blocked, how far
// an epic has got, and above all WHAT TO DO NEXT — all of it arrives decided. The button
// at the end of a row draws the answer `server/backlog.js` gave; it does not have an opinion.
//
// And every call it makes says so when it is refused. A button that goes quietly dead is worse
// than no button, because the story it did nothing to still looks like it moved.

// What board.js lends this view: the fetch that throws readable errors, the toast, the redraw, the
// epic hue, the flag glyph, and the two things only the board knows how to do — do what the next
// step says, and close a story. Handed in rather than imported, so this file has no way to reach
// back into the board and the two cannot quietly grow into one.
let hooks = null

// `stories` is what is on screen, after the pills, the repository and the epic lane have had
// their say. `all` is every story the board knows, and it is here for one reason: a drag rewrites
// the order of a whole group, and a group half of which is hidden behind a filter would come back
// renumbered with the hidden half at the top.
let last = { stories: [], all: [], epics: [] }

// The epic groups that have been closed, by `path|key`. Closed rather than open: a group you have
// never touched should show what is in it, and remembering the exceptions is what makes that true
// for an epic that did not exist the last time this list was drawn.
const folded = new Set(JSON.parse(localStorage.getItem('k0-list-folded') || '[]'))
const saveFolded = () => localStorage.setItem('k0-list-folded', JSON.stringify([...folded]))

// What is open in the panel beside the rows: a story, or an epic, never both. An epic's discussion
// is the same kind of reading as a story's, and two panels stacked would be two places to look for
// one thing.
let openId = 0
let openEpicId = 0
let view = null // the whole of whatever is open, as `/api/backlog/story|epic/:id` gives it
let drawn = '' // the JSON of what is on screen, so a poll that changed nothing redraws nothing
let ticker = null
let ticks = 0
let beat = ''

/**
 * What the board's own answer does not carry: how many decisions are standing, how much of the
 * checklist has passed, whether the last counter-check found something broken.
 *
 * `/api/board` is asked once a second by every open tab and it draws post-its, which have room for
 * none of those; counting them there would be three more queries per story per second for numbers
 * nothing on the board can show. So they are read from `/api/backlog?repo=…`, which counts them
 * already, at the pace the old dense page read them at — and only while this view is on screen.
 *
 * They can be a few seconds behind the rest of the row and that is the trade: a number that lags is
 * worth more than a board that crawls. The story you have actually opened is not affected — its
 * panel re-reads the whole story and puts its own row straight.
 */
const counts = new Map()
let countedAt = 0
let counting = false

const COUNT_EVERY = 30000

// ── Small change ─────────────────────────────────────────────────────────────

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The shape every time here takes. No seconds: nothing on this page is worth reading that finely. */
const CLOCK = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }

const when = (t) => (t ? new Date(Number(t)).toLocaleString(undefined, CLOCK) : '')

const day = (t) => (t ? new Date(Number(t)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '')

/** A state as a pill. The colours are the board's own, from base.css: nothing new was invented. */
const pill = (state) => `<span class="pill" data-state="${esc(state)}">${esc(state)}</span>`

/**
 * How deep in the tree a story sits, which is how far its title is indented — and, at nought, what
 * makes it a story you can drag rather than a task belonging to one.
 *
 * Walked over every story the board knows and not over the rows on screen: a task whose parent has
 * been filtered away is still a task, and drawing it flush with the stories would say it was not.
 * `seen` is the guard against a pair of rows each naming the other as parent — a shape `.k0/` is
 * hand-edited into now and then, and one that would otherwise spin here forever.
 */
function depth(s) {
  const seen = new Set()
  let at = s?.parent_story_id ?? null
  let deep = 0
  while (at && !seen.has(at)) {
    seen.add(at)
    deep++
    at = parents.get(at) ?? null
  }
  return deep
}

/** Every story's parent, for `depth`, rebuilt whenever the board hands a new set of rows over. */
let parents = new Map()

/** The story's counted facts, from whichever of the two answers arrived last. */
const countsOf = (s) => counts.get(s.id) ?? s

// ── The groups ───────────────────────────────────────────────────────────────

/**
 * The rows, in the three levels they are drawn in: repository, epic, story.
 *
 * The order inside a group is the one the rows arrived in, which is the order the server put them
 * in — `sort_hint`, then id — with the tasks falling in directly under the story they belong to.
 * It is also the order a drag rewrites, so what you see and what you are moving are the same list.
 */
function grouped(stories, epics) {
  const repos = new Map()
  const of = (path, name) => {
    if (!repos.has(path)) repos.set(path, { path, name, groups: new Map(), loose: [] })
    return repos.get(path)
  }
  // Every repository with an epic gets a heading whether or not a story of that epic is on screen:
  // an epic being argued out in a terminal has no stories yet, and it is exactly the one you are
  // watching. The stories bring in the rest.
  for (const e of epics) of(e.project_path, e.project_name).groups.set(e.key, { epic: e, stories: [] })
  for (const s of stories) {
    const repo = of(s.project_path, s.project_name)
    if (!s.epic_key) {
      repo.loose.push(s)
      continue
    }
    // A story that names an epic the list was not handed one for still belongs to it, and the
    // heading is written from what the story itself carries. Dropping it in with the ones that
    // have no epic would say something about it that is not true — and it is exactly the name you
    // came to the list to read.
    if (!repo.groups.has(s.epic_key)) {
      const stub = { key: s.epic_key, title: s.epic_title ?? '', project_path: s.project_path }
      repo.groups.set(s.epic_key, { epic: stub, stories: [] })
    }
    repo.groups.get(s.epic_key).stories.push(s)
  }
  return [...repos.values()]
    .map((r) => ({ ...r, groups: [...r.groups.values()], loose: r.loose }))
    // Only what has something in it. A repository whose every story is filtered away is a heading
    // over nothing, and a dozen of those is the list saying "no" a dozen times.
    .filter((r) => r.loose.length || r.groups.some((g) => g.stories.length || g.epic))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

const groupKey = (path, key) => `${path}|${key ?? ''}`

/**
 * How tall the scroller is, and how far down the window it starts — written onto the root as
 * `--port` and `--head` so the stylesheet can have the two numbers it cannot work out for itself.
 *
 * The panel sticks to the top of the view and scrolls on its own, so it has to know the height of
 * what it is sticking inside. Above it are the top bar and, inside an epic, the lane: two elements
 * in another stylesheet, one of which changes height with the width of the window. A number
 * written down here instead would be wrong the first time either of them moved — and wrong in the
 * direction that hides the bottom of the panel below the edge of the screen.
 */
const port = document.querySelector('#viewport')
if (port) {
  const measure = () => {
    const r = port.getBoundingClientRect()
    document.documentElement.style.setProperty('--port', `${Math.round(r.height)}px`)
    document.documentElement.style.setProperty('--head', `${Math.round(r.top)}px`)
  }
  new ResizeObserver(measure).observe(port)
  measure()
}

// ── The rows ─────────────────────────────────────────────────────────────────

const rowsEl = document.createElement('div')
rowsEl.className = 'rows'

const panelEl = document.createElement('section')
panelEl.id = 'panel'
panelEl.hidden = true

/**
 * The one thing to do with this story next, as a button.
 *
 * The label, the command and the reason are all the server's — see `nextStep` in
 * `server/backlog.js`. One button and not a row of them: the interface says what to do next and
 * starts it, and a story offering ten things to do is a story offering none.
 *
 * `null` is an answer and the page does not argue with it: a story whose terminal is open, one
 * waiting to be looked at, one that is done. Nothing here invents a label the server did not give,
 * because a row and a post-it that disagree about the same story is the whole failure this was
 * moved to one place to avoid.
 */
function goHtml(s) {
  const step = s.next_step
  if (!step) return ''
  return `<button type="button" class="go" data-go="${s.id}" title="${esc(step.why ?? '')}">${esc(
    step.label
  )}</button>`
}

function storyRow(s) {
  const c = countsOf(s)
  const broken = c.violations_open > 0
  const decisions = c.decisions_total ? `${c.decisions_open}/${c.decisions_total}` : ''
  const checks = c.checks_total ? `${c.checks_passed}/${c.checks_total}` : ''
  const title = broken
    ? `The last counter-check found ${plural(c.violations_open, 'decision')} broken: ` +
      'it cannot be finished until that is answered.'
    : s.title
  return `<div class="story${s.id === openId ? ' on' : ''}${broken ? ' broken' : ''}" data-id="${s.id}"
       data-repo="${esc(s.project_path)}"${depth(s) ? '' : ' draggable="true"'} title="${esc(title)}">
      <span class="k">${esc(s.key)}</span>
      <span class="title"><span class="in" style="--deep:${depth(s)}">${esc(s.title)}</span></span>
      <span>${pill(s.state)}</span>
      <span class="flag">${s.starred ? hooks.flag : ''}</span>
      <span class="num${broken ? ' bad' : ''}"
        title="Decisions still standing, of all that were taken">${decisions}</span>
      <span class="num" title="Checks passed, of the whole checklist">${checks}</span>
      ${goHtml(s)}
    </div>`
}

/**
 * An epic: a row that opens and closes, how far it has got, and which round the discussion is on.
 *
 * That last line is the only thing moving on an epic that has not turned into stories yet, which is
 * most of an epic's life — `/k0-epic` runs its rounds before a single story exists. Without it the
 * card said "0 of 0" for as long as anybody was watching.
 */
function epicRow(e, open, n) {
  // An epic the list was handed knows how far it has got and which round it is on. One written
  // from a story that merely names it knows neither, and says so by leaving the bar out rather
  // than drawing an empty one — and it carries no id, so it folds and does not open a panel.
  const { done, total } = e.progress ?? {}
  const pct = total ? Math.round((done / total) * 100) : 0
  const of = e.round?.estimated_total ? ` of about ${e.round.estimated_total}` : ''
  const round = e.round ? `round ${e.round.n}${of}` : ''
  const known = e.progress != null
  return `<button type="button" class="epic" style="--h:${hooks.hue(e.key)}" data-group="${groupKey(
    e.project_path,
    e.key
  )}"${e.id ? ` data-epic-id="${e.id}"` : ''} data-repo="${esc(e.project_path)}" data-key="${esc(e.key)}"
      aria-expanded="${open}" title="${esc(`${e.key} — click to open it, or drop a story on it to move it here`)}">
      <span class="caret">${open ? '⌄' : '›'}</span>
      <span class="key">${esc(e.key)}</span>
      <span class="name">${esc(e.title)}</span>
      ${
        known
          ? `<span class="prog" role="img" aria-label="${done} of ${total} done"><i style="width:${pct}%"></i></span>
      <span class="count">${done}/${total}</span>`
          : `<span class="count push">${n}</span>`
      }
      ${round ? `<span class="round">${esc(round)}</span>` : ''}
    </button>`
}

/** The group at the end: the stories of this repository that belong to no epic. */
function looseRow(path, open, n) {
  return `<button type="button" class="epic loose" data-group="${groupKey(path, '')}" data-repo="${esc(path)}"
      data-key="" aria-expanded="${open}" title="Stories with no epic — drop one here to take it out of its epic">
      <span class="caret">${open ? '⌄' : '›'}</span>
      <span class="name">No epic</span>
      <span class="count">${n}</span>
    </button>`
}

function paintRows() {
  // Not while something is in the air. This runs off a poll, and rebuilding the rows under a row
  // being dragged takes the target out from under the pointer half way through the gesture.
  if (dragging) return
  const tree = grouped(last.stories, last.epics)
  if (!tree.length) {
    rowsEl.innerHTML = '<p class="none">Nothing here — or the filters have put it all away.</p>'
    return
  }
  const open = (path, key) => !folded.has(groupKey(path, key))
  rowsEl.innerHTML = tree
    .map((r) => {
      const all = [...r.groups.flatMap((g) => g.stories), ...r.loose]
      const live = all.filter((s) => s.state !== 'Done').length
      const body = [
        ...r.groups.map((g) => {
          const on = open(r.path, g.epic.key)
          return epicRow(g.epic, on, g.stories.length) + (on ? g.stories.map(storyRow).join('') : '')
        }),
        r.loose.length
          ? looseRow(r.path, open(r.path, ''), r.loose.length) +
            (open(r.path, '') ? r.loose.map(storyRow).join('') : '')
          : '',
      ].join('')
      return `<section><div class="repo"><h2>${esc(r.name)}</h2><small>${live} open</small></div>${body}</section>`
    })
    .join('')
}

// ── One story, whole ─────────────────────────────────────────────────────────
// Everything from here to the end of the panel is the old dense page's drawing, lifted rather than
// written again. Getting a broken decision to be impossible to miss took a long time, and doing it
// a second time from memory would have lost exactly the details that do it.

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
    bits.push(`<b>Round ${l.round.n}${l.round.estimated_total ? ` of about ${l.round.estimated_total}` : ''}</b>`)
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
 * is wrong. It is why any of this exists: a decision the last run found broken has to be the first
 * thing you see, not something you find by scrolling.
 */
function counterHtml(v) {
  const latest = v.runs[0] ?? null
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
        latest
          ? esc(`Run ${latest.run} held every decision: ${latest.kept} kept, ${latest.na} not applicable, none broken.`)
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
      }"><b>${esc(d.label)}</b><span>${esc(d.text)}</span>${bits.length ? `<em>${bits.join(' · ')}</em>` : ''}</li>`
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
          .map(
            (s) =>
              `${String(s.session_id ?? '—').slice(0, 8)} · ${day(s.started_at)}${
                s.ended_at ? ` → ${day(s.ended_at)}` : ' · still open'
              }`
          )
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
 * The second half is the one nothing else in k0 shows. A post-it can say what a story is waiting
 * for; the reason to finish one story before another is usually what is stuck behind it, and until
 * this existed that was only ever visible from the other end.
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

const shutHtml = `<button type="button" class="x" data-shut title="Close" aria-label="Close">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M6 6l12 12M18 6L6 18"/>
      </svg>
    </button>`

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
        <b class="key">${esc(s.key)}</b>
        <h2>${esc(s.title)}</h2>
        ${s.starred ? `<span class="flag" title="Flagged">${hooks.flag}</span>` : ''}
      </div>
      <p class="where">${esc(where)}</p>
      ${waitsHtml(v)}
      <p class="live" id="live">${liveHtml(beatOf(v))}</p>
      ${shutHtml}
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
 * single story exists. Without this the whole of that conversation would be invisible while it was
 * happening and stay invisible afterwards.
 */
function epicPanelHtml(v) {
  const e = v.epic
  const pct = e.progress.total ? Math.round((e.progress.done / e.progress.total) * 100) : 0
  const list = v.stories
    .filter((s) => !s.parent_key)
    .map(
      (s) =>
        `<li><button type="button" data-id="${s.id}"><b>${esc(s.key)}</b>` +
        `<span>${esc(s.title)}</span></button>${pill(s.state)}</li>`
    )
    .join('')
  return `<header class="head">
      <div class="who">
        <b class="key">${esc(e.key)}</b>
        <h2>${esc(e.title)}</h2>
      </div>
      <p class="where">${esc(`${e.project_name}  ·  ${e.progress.done} of ${e.progress.total} done`)}</p>
      <p class="live" id="live">${liveHtml(beatOfEpic(v))}</p>
      ${shutHtml}
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
  panelEl.hidden = !openId && !openEpicId
  if (!openId && !openEpicId) {
    panelEl.innerHTML = ''
    drawn = ''
    return
  }
  if (!view) return // the "Reading…" line is already in there; leave it alone
  const same = JSON.stringify(view)
  if (same === drawn) return
  drawn = same
  panelEl.innerHTML = openEpicId ? epicPanelHtml(view) : storyHtml(view)
  keepOpen(panelEl)
}

// ── Following it live ────────────────────────────────────────────────────────

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
    now = await hooks.api(story ? `/api/backlog/story/${story}/live` : `/api/backlog/epic/${epic}/live`)
  } catch {
    return // the server is restarting, or it has gone: the next round will find out
  }
  if (story !== openId || epic !== openEpicId || !now?.state) return

  const line = panelEl.querySelector('#live')
  if (line) line.innerHTML = liveHtml(now)
  if (story) freshen(story, now)

  const s = JSON.stringify(now)
  ticks += 1
  if (s === beat && ticks % 5) return
  beat = s
  await reread()
}

/**
 * The row, brought up to date from the same cheap answer the line under the title just used.
 *
 * The numbers are only touched where the totals are already known. `…/live` says how many decisions
 * are standing and how many checks have passed and never says of how many, so writing them into a
 * row nothing has counted yet would leave `7/` — half a fraction, which the row draws as nothing at
 * all. That row waits for the listing, which is along in half a minute.
 */
function freshen(id, now) {
  const row = last.stories.find((s) => s.id === id)
  const moved = !!row && row.state !== now.state
  if (moved) row.state = now.state
  const before = counts.get(id)
  const counted =
    !!before && (before.decisions_open !== now.decisions || before.checks_passed !== now.checks_passed)
  if (counted) counts.set(id, { ...before, decisions_open: now.decisions, checks_passed: now.checks_passed })
  if (moved || counted) paintRows()
}

/** Reads back whichever of the two is open, and puts the row it came from in step with it. */
async function reread() {
  const story = openId
  const epic = openEpicId
  try {
    if (story) {
      const whole = await hooks.api(`/api/backlog/story/${story}`)
      if (story !== openId || !whole?.story) return
      view = whole
      // The story view has just recounted everything the row shows. Keeping the two in step matters
      // more than the round trip it would take to ask the listing for it again.
      counts.set(story, whole.story)
      const row = last.stories.find((s) => s.id === story)
      if (row) Object.assign(row, { state: whole.story.state, starred: whole.story.starred })
    } else if (epic) {
      const whole = await hooks.api(`/api/backlog/epic/${epic}`)
      if (epic !== openEpicId || !whole?.epic) return
      view = whole
    } else return
    drawPanel()
    paintRows()
  } catch {
    /* nothing is lost by waiting a second: the next round asks again */
  }
}

function follow() {
  clearInterval(ticker)
  ticker = null
  ticks = 0
  beat = ''
  if (openId || openEpicId) ticker = setInterval(tick, 1000)
}

// ── Opening and shutting ─────────────────────────────────────────────────────

async function openStory(id) {
  const n = Number(id)
  if (!n) return
  openId = n
  openEpicId = 0
  await opening('Reading the story…')
}

async function openEpic(id) {
  const n = Number(id)
  if (!n) return
  openEpicId = n
  openId = 0
  await opening('Reading the epic…')
}

/** The half the two of them share: empty the panel, read the thing, start following it. */
async function opening(waiting) {
  view = null
  drawn = ''
  panelEl.hidden = false
  panelEl.innerHTML = `<p class="none">${waiting}</p>`
  panelEl.scrollTop = 0
  rowsEl.parentElement?.classList.add('open')
  paintRows()
  await reread()
  follow()
}

function shut() {
  openId = 0
  openEpicId = 0
  view = null
  drawn = ''
  clearInterval(ticker)
  ticker = null
  rowsEl.parentElement?.classList.remove('open')
  drawPanel()
  paintRows()
}

// ── The counted facts ────────────────────────────────────────────────────────

/**
 * Fills `counts` from the backlog's own listing, for every repository on screen, and no more often
 * than every half minute. It runs beside the board's round rather than inside it: the board is
 * asked once a second and must not wait for this.
 */
async function ensureCounts() {
  if (counting || Date.now() - countedAt < COUNT_EVERY) return
  const paths = [...new Set(last.stories.map((s) => s.project_path))]
  if (!paths.length) return
  counting = true
  try {
    const answers = await Promise.all(
      paths.map((p) => hooks.api(`/api/backlog?repo=${encodeURIComponent(p)}`).catch(() => null))
    )
    for (const a of answers) for (const s of a?.stories ?? []) counts.set(s.id, s)
    countedAt = Date.now()
    paintRows()
  } finally {
    counting = false
  }
}

// ── Dragging ─────────────────────────────────────────────────────────────────
// The two things the interface could not do: put a story somewhere else in the order, and move it
// into another epic. Both are one gesture, and neither changes state — the states are the pills at
// the top and the road a story walks, not somewhere a piece of paper is dropped.

let dragging = null // the row being carried, as `{ id, repo }`

const clearMarks = () => {
  for (const el of rowsEl.querySelectorAll('.over')) el.classList.remove('over')
}

/**
 * The top-level stories of one group, in the order they are drawn in.
 *
 * Tasks are not in it and are never dragged: a task's place is under the story it was split out
 * of. Moving one is moving its parent.
 *
 * The order is the one the rows arrived in, which is the server's — `sort_hint`, then id — so the
 * list being renumbered is the same list that was on the screen.
 */
function groupOf(repo, epicKey) {
  return last.all.filter((s) => s.project_path === repo && (s.epic_key ?? '') === epicKey && !depth(s))
}

/**
 * Where the story has just been dropped, written down.
 *
 * The whole destination group is renumbered rather than a gap being found between two neighbours:
 * every `sort_hint` starts at nought, so on a fresh backlog there is no gap to find. Only the rows
 * whose number really changes are sent, so the second drag in a group costs one request and not
 * eleven.
 *
 * The refusal, whatever it is — a repository gone read-only, a story deleted in another tab — is
 * said out loud. A drag that silently does nothing leaves the row where it was and looks exactly
 * like a drag that was not allowed.
 */
async function drop(story, epicKey, at) {
  const moving = story.epic_key !== (epicKey || null)
  const list = groupOf(story.project_path, epicKey).filter((s) => s.id !== story.id)
  list.splice(Math.max(0, Math.min(at, list.length)), 0, story)
  const writes = []
  list.forEach((s, i) => {
    const hint = (i + 1) * 10
    const change = {}
    if (s.sort_hint !== hint) change.sort_hint = hint
    if (s.id === story.id && moving) change.epic_key = epicKey || null
    if (Object.keys(change).length) writes.push([s.id, change])
  })
  if (!writes.length) return
  try {
    await Promise.all(
      writes.map(([id, change]) =>
        hooks.api(`/api/backlog/story/${id}`, { method: 'PATCH', body: JSON.stringify(change) })
      )
    )
  } catch (e) {
    hooks.toast(`Couldn't move it: ${e.message}`, 8000)
  }
  hooks.redraw()
}

// ── What you can press ───────────────────────────────────────────────────────

rowsEl.onclick = (e) => {
  const go = e.target.closest('[data-go]')
  if (go) {
    e.stopPropagation()
    const story = last.stories.find((s) => s.id === Number(go.dataset.go))
    return story && hooks.next(story)
  }
  const epic = e.target.closest('.epic')
  if (epic) {
    // One click and it does the two things that go together: the group opens, and the epic itself
    // opens beside it — its rounds, its decisions and what it turned into. The loose group has no
    // epic to read, so there it is only the fold.
    const key = epic.dataset.group
    folded.has(key) ? folded.delete(key) : folded.add(key)
    saveFolded()
    paintRows()
    if (epic.dataset.epicId && !folded.has(key)) openEpic(epic.dataset.epicId)
    return
  }
  const row = e.target.closest('.story[data-id]')
  if (!row) return
  // Clicking the row that is already open shuts it. The same gesture in both directions, which is
  // what makes a list you can run down with the mouse rather than one you close between stories.
  if (Number(row.dataset.id) === openId) shut()
  else openStory(row.dataset.id)
}

rowsEl.addEventListener('dragstart', (e) => {
  const row = e.target.closest('.story[draggable="true"]')
  if (!row) return
  dragging = { id: Number(row.dataset.id), repo: row.dataset.repo }
  row.classList.add('dragging')
  e.dataTransfer.effectAllowed = 'move'
  // Nothing reads it — the row is held in `dragging` — but a drag carrying no data at all never
  // starts in Firefox.
  e.dataTransfer.setData('text/plain', row.dataset.id)
})

rowsEl.addEventListener('dragend', (e) => {
  dragging = null
  e.target.closest('.story')?.classList.remove('dragging')
  clearMarks()
  // Whatever the poll wanted to draw while the row was in the air, it can have now.
  paintRows()
})

rowsEl.addEventListener('dragover', (e) => {
  if (!dragging) return
  const target = e.target.closest('.story[draggable], .epic')
  // Only inside the repository it came from. Dropping a story into another repository's epic would
  // be moving work between repositories, which is not something you do by letting go of a piece of
  // paper — and the key it is called by would change under it.
  if (!target || target.dataset.repo !== dragging.repo) return
  if (target.dataset.id && Number(target.dataset.id) === dragging.id) return
  e.preventDefault() // without this the browser refuses the drop, silently
  e.dataTransfer.dropEffect = 'move'
  clearMarks()
  target.classList.add('over')
})

rowsEl.addEventListener('dragleave', (e) => {
  if (!rowsEl.contains(e.relatedTarget)) clearMarks()
})

rowsEl.addEventListener('drop', (e) => {
  e.preventDefault()
  const target = e.target.closest('.story[draggable], .epic')
  const carried = dragging
  clearMarks()
  dragging = null
  if (!carried || !target || target.dataset.repo !== carried.repo) return
  const story = last.stories.find((s) => s.id === carried.id)
  if (!story) return
  // On an epic's own row it goes to the top of that group — you dropped it on the name, not
  // between two rows. On a story it takes that story's place, and the one it displaced goes down.
  if (!target.dataset.id) return drop(story, target.dataset.key ?? '', 0)
  const to = last.stories.find((s) => s.id === Number(target.dataset.id))
  if (!to || depth(to)) return // a task is not a place: it belongs under the story it came from
  const group = groupOf(to.project_path, to.epic_key ?? '')
  drop(story, to.epic_key ?? '', group.findIndex((s) => s.id === to.id))
})

panelEl.onclick = (e) => {
  if (e.target.closest('[data-shut]')) return shut()
  const check = e.target.closest('[data-check]')
  if (check) return tickCheck(check.dataset.check, check.dataset.state)
  // A key in the panel — one this story waits for, one waiting for it, or one under the open
  // epic — is the same gesture as a row: it takes you to that story.
  const jump = e.target.closest('[data-story]')
  if (jump) return openStory(jump.dataset.story)
  const story = e.target.closest('[data-id]')
  if (story) return openStory(story.dataset.id)
}

// Escape shuts the panel, which is the way out of anything on this page. Not while you are typing
// in something: there is a search box on other pages of k0 and this must not learn a habit that
// eats a keystroke somewhere else.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (openId || openEpicId) && !e.target.closest('input, select, textarea')) shut()
})

/** Ticking a line off the checklist by hand, which is what `by: user` on a check means. */
async function tickCheck(id, state) {
  try {
    await hooks.api(`/api/backlog/check/${Number(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: state === 'pass' ? 'todo' : 'pass', by: 'user' }),
    })
    await reread()
  } catch (e) {
    hooks.toast(`Couldn't do it: ${e.message}`, 8000)
  }
}

// ── The way in and the way out ───────────────────────────────────────────────

/**
 * Draw the list into `#board`.
 *
 * The two halves are elements this module keeps rather than makes, and that `render()` leaves alone
 * while the list is on screen: a panel rebuilt from nothing — or merely taken out of the document
 * and put back — would lose where it was scrolled to and shut every disclosure in it, on a poll
 * that runs once a second while somebody is reading.
 */
export function drawList(board, data, wiring) {
  hooks = wiring
  last = data
  parents = new Map((data.all ?? []).map((s) => [s.id, s.parent_story_id ?? null]))
  paintRows()
  drawPanel()
  // Put in place once and then left alone. `append` on a child that is already where it should be
  // still takes it out of the document and puts it back, and an element that has been out of the
  // document comes back scrolled to the top: doing that on every poll is the panel jumping to its
  // header once a second while somebody is reading the decisions at the bottom of it.
  if (rowsEl.parentNode !== board) {
    board.textContent = ''
    board.append(rowsEl, panelEl)
  }
  board.classList.toggle('open', !!(openId || openEpicId))
  // Coming back from the board with something still open: pick the poll up again rather than
  // leaving a panel that has stopped moving in front of a discussion that has not.
  if ((openId || openEpicId) && !ticker) follow()
  ensureCounts()
}

/** Leaving the list for the board: whatever was open stops being followed. */
export function leaveList() {
  clearInterval(ticker)
  ticker = null
}
