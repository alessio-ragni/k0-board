import { render } from '/md.js'

// ── What's New ───────────────────────────────────────────────────────────────
// k0 moved on while you were not looking. This is the page that says what it did — written by
// your own Claude, in your language, at the level of detail you asked for.
//
// It is built the way the ChangeLog page is, and for the same reason: the entries come back
// from the server at once and are on screen before you have finished reading the heading, while
// the words take a model half a minute. So there is never a spinner over an empty sheet. At
// worst this page is a changelog, which is what everybody else ships and what people have been
// reading for twenty years.

const $ = (s) => document.querySelector(s)

const api = async (url, opts) => {
  const r = await fetch(url, { headers: { 'content-type': 'application/json' }, ...opts })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText)
  return r.json()
}

const LEVELS = ['plain', 'normal', 'nerd']

// Not a claim about what the model can write — it will write in anything — but a list short
// enough to pick from without scrolling. Whatever the browser is set to is added to it, so the
// one language that matters to the person reading is never the missing one.
const LANGS = ['en', 'it', 'es', 'fr', 'de', 'pt', 'nl', 'pl', 'sv', 'ru', 'tr', 'ja', 'zh']

// Keep a Changelog's order, which is the order a changelog is read in everywhere. A section
// under some other heading is kept and shown after these rather than dropped: somebody wrote it.
const SECTIONS = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']

// Something to read while the model reads. They say what is actually going on, which is the
// only reason a waiting message is ever worth having.
const PHRASES = [
  'Reading the changelog…',
  'Working out what you will actually notice…',
  'Putting the lines that are about one thing together…',
  'Leaving out what changed nothing for you…',
  'Putting it in your own words…',
]

let facts = null
let poll = null
let phrases = null
let quiet = 0 // rounds in a row with no job running and nothing written
let touched = false // the reader opened or closed the entries by hand

// Bumped every time the controls change. A reply to the question before this one is thrown
// away: it is a whole page in the wrong language, and it would arrive looking authoritative.
let asking = 0

// ── What was asked for ───────────────────────────────────────────────────────
const clean = (tag) => (/^[a-z]{2,3}$/.test(String(tag || '').toLowerCase()) ? String(tag).toLowerCase() : '')

let lang = clean(localStorage.getItem('k0-whatsnew-lang')) || clean((navigator.language || '').split('-')[0]) || 'en'
let level = LEVELS.includes(localStorage.getItem('k0-whatsnew-level'))
  ? localStorage.getItem('k0-whatsnew-level')
  : 'normal'

/**
 * The pair goes on the query string of the POST as well as in its body, and on the GET too,
 * because the writer keeps one job per key: the page has to say which job it is asking about on
 * the way in and on the way back, or a language switched mid-run polls the old run and paints
 * its answer.
 */
// `from` is the version the page is actually showing, sent back rather than left to the server to
// work out a second time. Marking the page read moves the mark the server would compute it from,
// and without this a language chosen after that would be answered with a summary of a shorter span
// than the entries printed underneath it.
const writeUrl = () =>
  `/api/whatsnew/write?lang=${encodeURIComponent(lang)}&level=${encodeURIComponent(level)}` +
  `&from=${encodeURIComponent(facts?.from ?? '')}`

function fillLangs() {
  const names = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'code' })
  const sel = $('#lang')
  for (const tag of LANGS.includes(lang) ? LANGS : [lang, ...LANGS]) {
    const o = document.createElement('option')
    o.value = tag
    o.textContent = names.of(tag)
    sel.append(o)
  }
  sel.value = lang
}

function markLevel() {
  for (const b of document.querySelectorAll('#levels button')) {
    b.setAttribute('aria-checked', String(b.dataset.level === level))
  }
}

// ── Painting ─────────────────────────────────────────────────────────────────
/**
 * A date written `2026-09-02` goes through the Date constructor as midnight UTC, which prints as
 * the day before in every timezone behind Greenwich. The three numbers are pulled out by hand
 * instead, and a date in any other shape is shown exactly as it arrived.
 */
function niceDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return String(iso || '')
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** The two versions as a sentence. A page that opens on `0.3.1 → 0.4.0` is a diff, not a page. */
function spanLine(d) {
  const n = d.entries?.length || 0
  if (!d.to) return 'k0 does not know which version it is running.'
  if (!d.from) return `You are running k0 ${d.to}. There is no earlier version to hold it against yet.`
  if (d.from === d.to) return `You are still on k0 ${d.to}, the version you had the last time you looked.`
  const later = n > 1 ? `, ${n} versions later` : ''
  return `You had k0 ${d.from}. You are running ${d.to} now${later}.`
}

function paintSpan(d) {
  const box = $('#span')
  box.textContent = ''
  const p = document.createElement('p')
  p.textContent = spanLine(d)
  box.append(p)
  // Only when the server has said so: this page is also reached from the mark that appears when
  // npm has something newer, and in that case the two versions on their own explain nothing.
  if (d.latest && d.latest !== d.to) {
    const also = document.createElement('p')
    also.className = 'also'
    also.textContent = `npm has ${d.latest}, which is newer than what is installed here.`
    box.append(also)
  }
  if (d.to) document.title = `k0 — What's New in ${d.to}`
}

function versionBlock(e) {
  const art = document.createElement('article')
  art.className = 'version'

  const h = document.createElement('h3')
  h.textContent = e.version || ''
  if (e.date) {
    const t = document.createElement('time')
    t.textContent = niceDate(e.date)
    h.append(t)
  }
  art.append(h)

  const sections = e.sections || {}
  const has = (name) => Array.isArray(sections[name]) && sections[name].length
  const names = [...SECTIONS.filter(has), ...Object.keys(sections).filter((s) => !SECTIONS.includes(s) && has(s))]

  if (!names.length) {
    const p = document.createElement('p')
    p.className = 'empty'
    p.textContent = 'Nothing written down under this version.'
    art.append(p)
    return art
  }

  for (const name of names) {
    const h4 = document.createElement('h4')
    h4.textContent = name
    const ul = document.createElement('ul')
    for (const line of sections[name]) {
      const li = document.createElement('li')
      li.textContent = line // a changelog line is a line, not markup: it goes in as it was typed
      ul.append(li)
    }
    art.append(h4, ul)
  }
  return art
}

function paintEntries(d) {
  const box = $('#versions')
  box.textContent = ''
  for (const e of d.entries || []) box.append(versionBlock(e))
  $('#entries').hidden = !(d.entries || []).length
}

function paintProse(text) {
  const box = $('#prose')
  box.textContent = ''
  if (!text) return
  box.innerHTML = render(text)
  // The entries were what there was to read while the waiting went on; now there is a page, so
  // they step back and become the thing you check it against. Unless they were opened or closed
  // by hand, in which case that stands — nothing moves under the reader's own decision.
  if (!touched) $('#entries').open = false
}

function note(message) {
  const p = $('#note')
  p.textContent = message
  p.hidden = !message
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

/** True once there is nothing left to wait for. */
function arrived(state) {
  if (state.text) {
    stop()
    paintProse(state.text)
    return true
  }
  if (state.error) {
    stop()
    note(state.error)
    return true
  }
  if (state.running) {
    quiet = 0
    return false
  }
  // Nothing running, nothing written and nothing gone wrong: the job died on its way out and
  // nobody is coming back with a page. Two rounds of that and this stops asking, because the
  // alternative is a bar that sweeps until the tab is closed.
  quiet += 1
  if (quiet < 2) return false
  stop()
  note('The writing stopped before it got anywhere. The entries are below, as they were written.')
  return true
}

async function writeUp() {
  const mine = ++asking
  quiet = 0
  note('')
  paintProse('')
  waiting(true)

  try {
    const started = await api(writeUrl(), { method: 'POST', body: JSON.stringify({ lang, level }) })
    if (mine !== asking) return
    if (arrived(started)) return
  } catch (err) {
    if (mine !== asking) return
    stop()
    note(String(err.message || err))
    return
  }

  poll = setInterval(async () => {
    if (mine !== asking) return
    try {
      const state = await api(writeUrl())
      if (mine === asking) arrived(state)
    } catch {
      /* the server is restarting: the next round will find it */
    }
  }, 1000)
}

// ── Loading ──────────────────────────────────────────────────────────────────

/**
 * The mark on the board goes out, and this is the only thing that puts it out.
 *
 * Here rather than on the way out of the tab: closing a tab is not the same as having read what
 * was in it, and the server's own comment says so. It goes after the entries are painted, because
 * by then what changed is on the screen — the write-up says it better, but the entries are the
 * substance and they are already readable. Nothing waits for this and nothing depends on it: a
 * page that could not tell the server it had been read is still a page that was read.
 */
const markSeen = () => api('/api/whatsnew/seen', { method: 'POST' }).catch(() => {})

async function load() {
  stop()
  try {
    facts = await api('/api/whatsnew')
  } catch (err) {
    note(String(err.message || err))
    return
  }

  paintSpan(facts)
  paintEntries(facts)
  markSeen()

  if (!(facts.entries || []).length) {
    // Nothing to summarise. Saying so costs a line; asking a model to say so costs half a minute
    // and comes back with the same line.
    note('Nothing changed between the two versions.')
    return
  }
  if (!facts.writer?.can) {
    note(`${facts.writer?.why || 'Claude Code is not on this machine.'} The entries are below, as they were written.`)
    return
  }
  writeUp()
}

/** A control moved: the same facts, the same page, asked for again. */
function again() {
  if (!facts || !(facts.entries || []).length || !facts.writer?.can) return
  stop()
  writeUp()
}

$('#levels').onclick = (e) => {
  const b = e.target.closest('button[data-level]')
  if (!b || b.dataset.level === level) return
  level = b.dataset.level
  localStorage.setItem('k0-whatsnew-level', level)
  markLevel()
  again()
}

$('#lang').onchange = () => {
  lang = $('#lang').value
  localStorage.setItem('k0-whatsnew-lang', lang)
  again()
}

$('#entries').querySelector('summary').onclick = () => {
  touched = true
}

fillLangs()
markLevel()
load()
