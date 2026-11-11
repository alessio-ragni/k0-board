// ── ⌘K: finding a story from anywhere on the board ─────────────────────────────
// The board answers "what is going on"; this answers "where is K42". Everything it searches is
// already on the page — the last `/api/board` answer — so typing costs nothing and asks the server
// nothing.
//
// It is not `fuzzy.js`, although it borrows its idea. That one looks for scattered letters in a
// file name and nothing else; here the thing you remember about a story is a word of its title, a
// half-word of its notes, or its number, and a search box that needs the whole word is one you
// stop trusting. So the query is split into words, every word has to turn up somewhere, and each
// one is scored by the best way it turned up: whole in the title beats scattered in the title,
// which beats whole in the notes, which beats scattered inside one word of the notes.
//
// Pure: no DOM, no clock. What comes out depends on what goes in and nothing else.

const BOUNDARY = /[\s\-_./:,;()[\]'"`]/

const words = (query) => String(query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)

/** A number, with or without its K: `42`, `k42`, `K42`, and the `K~3` keys of local stories. */
const KEY = /^k?(~?)(\d+)$/i

/**
 * Where `w` is in `text` as a piece in one go, with the start of a word worth more. `null` if it
 * is not there.
 */
function whole(text, w) {
  const low = text.toLowerCase()
  let best = null
  for (let i = low.indexOf(w); i !== -1; i = low.indexOf(w, i + 1)) {
    const start = i === 0 || BOUNDARY.test(text[i - 1])
    const s = start ? 3 : 2
    if (!best || s > best.s) best = { s, at: range(i, w.length) }
    if (start) break
  }
  return best
}

/**
 * The letters of `w`, in order, scattered through `text` — the `fuzzy.js` walk, on the whole text.
 * The score is between 0 and 1: letters that sit together and at the start of words make it high,
 * letters strewn across the title make it low. `null` if the letters are not all there.
 */
function scattered(text, w) {
  const low = text.toLowerCase()
  const at = []
  let from = 0
  let last = -2
  let points = 0
  for (const ch of w) {
    const hit = low.indexOf(ch, from)
    if (hit === -1) return null
    let p = 1
    if (hit === last + 1) p += 4
    if (hit === 0 || BOUNDARY.test(text[hit - 1])) p += 3
    points += p
    at.push(hit)
    last = hit
    from = hit + 1
  }
  return { s: points / (w.length * 8), at }
}

/** The same letters, but only inside one word of `text`: the notes are long, and a walk across a
 * whole paragraph finds any three letters you like. */
function inOneWord(text, w) {
  let best = null
  for (const m of text.matchAll(/[^\s]+/g)) {
    if (m[0].length < w.length) continue
    const hit = scattered(m[0], w)
    if (hit && (!best || hit.s > best.s)) best = hit
  }
  return best
}

const range = (from, n) => Array.from({ length: n }, (_, i) => from + i)

/**
 * How one word of the query matches a story. Higher is better; `null` means it is not there at all.
 * `at` is only ever positions in the title, because the title is what the row underlines.
 */
function wordOnStory(story, w) {
  const title = story.title ?? ''
  const notes = story.description ?? ''
  const t = whole(title, w)
  if (t) return { s: 10 + t.s, at: t.at, notes: false }
  const ts = w.length > 1 ? scattered(title, w) : null
  if (ts && ts.s >= 0.4) return { s: 6 + ts.s, at: ts.at, notes: false }
  if (whole(notes, w)) return { s: 5, at: [], notes: true }
  const ns = w.length > 2 ? inOneWord(notes, w) : null
  if (ns && ns.s >= 0.5) return { s: 2 + ns.s, at: [], notes: true }
  if (ts) return { s: 1 + ts.s, at: ts.at, notes: false }
  return null
}

/** The key part of the score: an exact number is the strongest thing you can type. */
function keyScore(story, q) {
  const m = KEY.exec(q)
  if (!m) return 0
  const key = String(story.key ?? '').toLowerCase()
  const want = `k${m[1]}${m[2]}`
  if (key === want) return 100
  if (key.startsWith(want)) return 50 - key.length * 0.1
  return 0
}

const isDone = (s) => !!s.completed_at
const touched = (s) => Date.parse(s.updated_at ?? s.status_since ?? s.created_at ?? '') || 0

/**
 * A line of the notes that holds the first word that matched there, cut down to fit a row. Shown
 * under the title so a result found in the notes says why it is in the list.
 */
export function snippet(notes, query, size = 90) {
  const text = String(notes ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  const low = text.toLowerCase()
  let at = -1
  for (const w of words(query)) {
    at = low.indexOf(w)
    if (at !== -1) break
  }
  if (at === -1 || text.length <= size) return text.length <= size ? text : `${text.slice(0, size - 1)}…`
  const from = Math.max(0, at - Math.floor(size / 3))
  const cut = text.slice(from, from + size)
  return `${from > 0 ? '…' : ''}${cut}${from + size < text.length ? '…' : ''}`
}

/**
 * Everything that matches `query`, best first: `{ kind, item, s, at, notes }`.
 *
 * `kind` is `story` or `repo`. Open stories come first, then repositories, then the stories that
 * are done — at any relevance: a finished story is the one you are least likely to be looking
 * for, and the one most likely to share words with the one you are.
 *
 * With nothing typed it is the open stories, most recently touched first, so ⌘K and Enter is the
 * last thing you were on.
 */
export function rank({ stories = [], columns = [] } = {}, query = '', limit = 50) {
  const ws = words(query)
  if (!ws.length) {
    return stories
      .filter((s) => !isDone(s))
      .sort((a, b) => touched(b) - touched(a))
      .slice(0, limit)
      .map((item) => ({ kind: 'story', item, s: 0, at: [], notes: false }))
  }

  const found = []
  for (const item of stories) {
    const k = ws.length === 1 ? keyScore(item, ws[0]) : 0
    let s = k
    let at = []
    let notes = false
    if (!k) {
      for (const w of ws) {
        const hit = wordOnStory(item, w)
        if (!hit) {
          s = -1
          break
        }
        s += hit.s
        at = at.concat(hit.at)
        notes ||= hit.notes
      }
      if (s < 0) continue
      s /= ws.length
    }
    found.push({ kind: 'story', item, s, at: [...new Set(at)].sort((a, b) => a - b), notes })
  }

  for (const item of columns) {
    let s = 0
    let at = []
    for (const w of ws) {
      const name = item.name ?? ''
      const hit = whole(name, w) ?? (w.length > 1 ? scattered(name, w) : null)
      if (!hit || hit.s < 0.4) {
        s = -1
        break
      }
      s += hit.s >= 2 ? 10 + hit.s : 6 + hit.s
      at = at.concat(hit.at)
    }
    if (s < 0) continue
    found.push({ kind: 'repo', item, s: s / ws.length, at: [...new Set(at)].sort((a, b) => a - b), notes: false })
  }

  // Exact numbers jump every queue, done or not: you typed K42, you meant K42.
  const band = (r) => (r.s >= 100 ? 0 : r.kind === 'repo' ? 2 : isDone(r.item) ? 3 : 1)
  found.sort((a, b) => band(a) - band(b) || b.s - a.s || touched(b.item) - touched(a.item))
  return found.slice(0, limit)
}
