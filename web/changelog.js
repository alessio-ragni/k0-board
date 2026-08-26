import { render } from '/md.js'

// ── The ChangeLog ────────────────────────────────────────────────────────────
// k0's third page. The board says what is happening; this says what happened.
//
// It is built in two passes on purpose. The facts come back from the server straight away and
// are on screen before you have finished reading the heading; the words take a model half a
// minute, and arrive into a page that was already worth looking at. A summary that shows a
// spinner over an empty sheet is a summary you close.

const $ = (s) => document.querySelector(s)

const api = async (url, opts) => {
  const r = await fetch(url, { headers: { 'content-type': 'application/json' }, ...opts })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText)
  return r.json()
}

const DAY = 24 * 60 * 60 * 1000

// Something to read while the model reads. They are not jokes exactly — they say what is
// actually going on, which is the only reason a waiting message is ever worth having.
const PHRASES = [
  'Reading the commits…',
  'Working out what actually shipped…',
  'Translating git into human…',
  'Looking for what you left half-done…',
  'Checking what never made it out of here…',
  'Putting the day in order…',
]

let period = 'last'
let facts = null
let poll = null
let phrases = null
const put = new Set() // repositories folded away by hand, this visit only

// ── Painting ─────────────────────────────────────────────────────────────────
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const day = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })

/** Which stretch of time is on screen, said the way you would say it. */
function whenLabel(data) {
  const single = data.to - data.from <= DAY
  if (!single) return `${day(data.from)} – ${day(data.to - 1)}`
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (data.from === today.getTime()) return 'Today'
  if (data.from === today.getTime() - DAY) return 'Yesterday'
  return day(data.from)
}

/**
 * The written summary comes back as one piece of Markdown with a `## name` per repository.
 * It is cut back apart here so each repository's words can sit with its own facts — and so
 * that folding a repository away takes its paragraph with it.
 *
 * The headings themselves are dropped: the block already carries the name, and this way a
 * repository is always called what k0 calls it. Anything that matches no repository is kept
 * and shown at the top rather than quietly lost.
 */
function sectionise(html) {
  const holder = document.createElement('div')
  holder.innerHTML = html
  const loose = []
  const map = new Map()
  let current = null
  for (const node of [...holder.childNodes]) {
    if (node.nodeType === 1 && node.tagName === 'H2') {
      current = node.textContent.trim().toLowerCase()
      map.set(current, [])
      continue
    }
    if (current) map.get(current).push(node)
    else loose.push(node)
  }
  return { loose, map }
}

function commitList(r) {
  const ul = document.createElement('ul')
  ul.className = 'commits'
  for (const c of r.commits) {
    const li = document.createElement('li')
    const dot = document.createElement('i')
    dot.className = c.online === false ? 'local' : 'online'
    dot.title = c.online === false ? 'Still on this machine' : 'Online'
    li.append(dot, document.createTextNode(c.subject))
    ul.append(li)
  }
  return ul
}

/** What is still outstanding here — and only for repositories you actually touched. */
function pending(r) {
  const lines = []
  if (r.unpushedTotal) lines.push(`${plural(r.unpushedTotal, 'commit')} still on this machine`)
  if (r.dirtyTotal) lines.push(`${plural(r.dirtyTotal, 'file')} changed and never committed`)
  if (r.unreleased) lines.push(`${plural(r.unreleased.filter((l) => l.startsWith('-')).length, 'changelog line')} not yet released`)
  const open = r.cards.filter((c) => !c.done)
  if (open.length) lines.push(`${plural(open.length, 'card')} still open`)
  if (!lines.length) return null
  const p = document.createElement('p')
  p.className = 'pending'
  p.textContent = lines.join(' · ')
  return p
}

function factsBlock(r) {
  const d = document.createElement('details')
  d.className = 'facts'
  const s = document.createElement('summary')
  const local = r.commits.filter((c) => c.online === false).length
  const bits = []
  if (r.commits.length) bits.push(plural(r.commits.length, 'commit'))
  if (local) bits.push(`${local} not out yet`)
  if (r.dirty.length) bits.push(plural(r.dirty.length, 'file touched', 'files touched'))
  if (r.cards.length) bits.push(plural(r.cards.length, 'card'))
  s.textContent = bits.join(' · ') || 'nothing recorded'
  d.append(s)
  if (r.commits.length) d.append(commitList(r))
  const p = pending(r)
  if (p) d.append(p)
  return d
}

function repoBlock(r, nodes) {
  const sec = document.createElement('section')
  sec.className = 'repo'
  const h = document.createElement('h2')
  h.textContent = r.name
  sec.append(h)
  if (nodes?.length) {
    const prose = document.createElement('div')
    prose.className = 'prose'
    prose.append(...nodes)
    sec.append(prose)
  }
  sec.append(factsBlock(r))
  return sec
}

function paintChips(data) {
  const box = $('#chips')
  box.textContent = ''
  box.hidden = data.repos.length < 2
  for (const r of data.repos) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = r.name
    b.setAttribute('aria-pressed', String(!put.has(r.name)))
    b.onclick = () => {
      if (put.has(r.name)) put.delete(r.name)
      else put.add(r.name)
      paint()
    }
    box.append(b)
  }
}

/** Draws whatever is known right now: the facts always, the words if they have arrived. */
function paint(text = null) {
  const data = facts
  if (!data) return
  const { loose, map } = text ? sectionise(render(text)) : { loose: [], map: new Map() }

  const intro = $('#intro')
  intro.textContent = ''
  if (loose.length) intro.append(...loose)

  const box = $('#repos')
  box.textContent = ''
  const mine = new Set(data.repos.map((r) => r.name.toLowerCase()))
  for (const r of data.repos) {
    if (put.has(r.name)) continue
    box.append(repoBlock(r, map.get(r.name.toLowerCase())))
  }
  // A heading that matches no repository — a name written differently, a paragraph the model
  // decided to group under something of its own. It goes at the top rather than nowhere: losing
  // a piece of the summary without telling anybody is the one failure that would not show.
  for (const [name, nodes] of map) if (!mine.has(name)) intro.append(...nodes)
  paintChips(data)
}

function say(message, kind = 'note') {
  const intro = $('#intro')
  intro.textContent = ''
  const p = document.createElement('p')
  p.className = kind
  p.textContent = message
  intro.append(p)
}

// ── Waiting ──────────────────────────────────────────────────────────────────
function waiting(on) {
  $('#waiting').hidden = !on
  clearInterval(phrases)
  if (!on) return
  let i = 0
  $('#phrase').textContent = PHRASES[0]
  phrases = setInterval(() => {
    i = (i + 1) % PHRASES.length
    $('#phrase').textContent = PHRASES[i]
  }, 2600)
}

function stop() {
  clearInterval(poll)
  poll = null
  waiting(false)
}

function arrived(state) {
  if (state.text) {
    stop()
    paint(state.text)
    return true
  }
  if (state.error) {
    stop()
    say(state.error, 'note')
    return true
  }
  return false
}

async function writeUp() {
  waiting(true)
  try {
    if (arrived(await api(`/api/changelog/write?period=${period}`, { method: 'POST' }))) return
  } catch (err) {
    stop()
    say(String(err.message || err), 'note')
    return
  }
  poll = setInterval(async () => {
    try {
      arrived(await api(`/api/changelog/write?period=${period}`))
    } catch {
      /* the server is restarting: the next round will find it */
    }
  }, 1000)
}

// ── Loading ──────────────────────────────────────────────────────────────────
/**
 * Which of the four is lit. The page opens on none of them — it opens on the last day that had
 * anything in it — but when that day turns out to be today or yesterday, lighting the button
 * says so more clearly than the date does.
 */
function markPeriod(data) {
  let lit = period
  if (period === 'last' && data && data.to - data.from <= DAY) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (data.from === today.getTime()) lit = 'today'
    else if (data.from === today.getTime() - DAY) lit = 'yesterday'
  }
  for (const b of document.querySelectorAll('#periods button')) {
    b.setAttribute('aria-checked', String(b.dataset.period === lit))
  }
}

async function load(p) {
  period = p
  stop()
  markPeriod(null)

  facts = await api(`/api/changelog?period=${p}`)
  markPeriod(facts)
  $('#when').textContent = whenLabel(facts)
  $('#blank').hidden = true
  paint()

  if (!facts.repos.length) {
    // Nothing happened. Say it in a line and stop there — no model, nothing to pad out.
    $('#intro').textContent = ''
    $('#chips').hidden = true
    $('#blank').hidden = false
    $('#blank').textContent =
      p === 'last' ? 'Nothing in the last thirty days.' : `Nothing in ${whenLabel(facts).toLowerCase()}.`
    return
  }

  if (!facts.writer.can) {
    say(`${facts.writer.why} The facts are all here.`)
    return
  }
  writeUp()
}

$('#periods').onclick = (e) => {
  const b = e.target.closest('button[data-period]')
  if (b && b.dataset.period !== period) load(b.dataset.period)
}

load('last')
