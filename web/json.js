// ── A JSON file, laid out ─────────────────────────────────────────────────────
// A `package.json` shown as text is a wall you read with your finger. What you actually want to
// know is what is under `scripts`, and everything else can stay shut until you ask for it.
//
// So: a tree that folds. The folding is `<details>`, which the browser already knows how to do —
// no state to keep, nothing to wire up, and it works before any script has run.
//
// And with the folding comes the reason this file also does the searching. The browser's own find
// does not look inside a closed `<details>`: on a folded tree ⌘F says "not found" for something
// that is right there. So the search is done here, on the data, and the branches that hold a
// result are handed back already open.
//
// It knows nothing about the page: text in, a string of HTML out. That is what makes it testable.

/**
 * Written again rather than imported: this module is pulled in by the tests, which run in Node,
 * where the browser's absolute `/md.js` does not resolve. Four lines are cheaper than making
 * every pure module share a build.
 */
const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** How deep it arrives open. Two levels is the shape of the file; three is already its contents. */
const OPEN_DEPTH = 2

/**
 * Past this it is not a document any more, it is a dump — and the tree would be a megabyte of
 * HTML that no browser lays out quickly. The page falls back to showing the text as it is.
 */
const MAX_NODES = 20000

/**
 * The word found inside a piece of text, wrapped so it can be seen, and how many times it is
 * there. The count is what the page shows next to the box: without it a search that finds
 * nothing looks exactly like a search that has not run.
 */
export function mark(value, query) {
  const text = String(value ?? '')
  if (!query) return { html: esc(text), n: 0 }
  const hay = text.toLowerCase()
  const needle = query.toLowerCase()
  let out = ''
  let at = 0
  let n = 0
  for (let i = hay.indexOf(needle, at); i !== -1; i = hay.indexOf(needle, at)) {
    out += `${esc(text.slice(at, i))}<mark>${esc(text.slice(i, i + needle.length))}</mark>`
    at = i + needle.length
    n += 1
  }
  return { html: out + esc(text.slice(at)), n }
}

/** How a value is written, and what colour it is: the type is the colour. */
function leafValue(value) {
  if (value === null) return { text: 'null', cls: 'nil' }
  if (typeof value === 'string') return { text: value, cls: 'str' }
  if (typeof value === 'number') return { text: String(value), cls: 'num' }
  if (typeof value === 'boolean') return { text: String(value), cls: 'bool' }
  return { text: String(value), cls: 'str' }
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/**
 * One entry of the tree, and everything under it.
 *
 * The number of results comes back up from the leaves rather than being counted again at the
 * top, because it is the same walk: whoever found a result also knows which branch has to be
 * open for it to be visible.
 */
function node(key, value, depth, query, budget) {
  if (budget.left <= 0) return { html: '', n: 0 }
  budget.left -= 1

  const label = key === null ? null : mark(key, query)
  const name = label ? `<b class="key">${label.html}</b>` : ''

  if (value !== null && typeof value === 'object') {
    const entries = Array.isArray(value)
      ? value.map((v, i) => [String(i), v])
      : Object.entries(value)
    const brace = Array.isArray(value) ? ['[', ']'] : ['{', '}']
    const size = Array.isArray(value)
      ? plural(entries.length, 'item', 'items')
      : plural(entries.length, 'key', 'keys')

    // An empty object has nothing to open: a summary with no contents is a fold that lies.
    if (!entries.length) {
      return {
        html: `<div class="leaf">${name}<span class="v empty">${brace[0]}${brace[1]}</span></div>`,
        n: label?.n ?? 0,
      }
    }

    let inner = ''
    let n = label?.n ?? 0
    for (const [k, v] of entries) {
      const child = node(k, v, depth + 1, query, budget)
      inner += child.html
      n += child.n
    }
    // With something searched for, only the branches holding a result open — that is the whole
    // point of doing the search here. With nothing searched for, the first levels open, which is
    // the shape of the file without its contents.
    const open = query ? n > 0 : depth < OPEN_DEPTH
    return {
      html:
        `<details class="node"${open ? ' open' : ''}><summary>${name}` +
        `<span class="brace">${brace[0]}${brace[1]}</span><em>${size}</em></summary>` +
        `<div class="kids">${inner}</div></details>`,
      n,
    }
  }

  const { text, cls } = leafValue(value)
  const hit = mark(text, query)
  return {
    html: `<div class="leaf">${name}<span class="v ${cls}">${hit.html}</span></div>`,
    n: (label?.n ?? 0) + hit.n,
  }
}

/**
 * The whole file as a tree, with `query` picked out inside it.
 *
 * When it does not parse, nothing is invented: the reason comes back and the page shows the text
 * exactly as it is on disk, which is the only honest thing to show for a file that is broken —
 * and usually the reason you opened it.
 *
 * Returns `{ html, matches, error }`.
 */
export function tree(text, query = '') {
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    return { html: '', matches: 0, error: String(e.message || e) }
  }
  const budget = { left: MAX_NODES }
  const out = node(null, data, 0, String(query || '').trim(), budget)
  if (budget.left <= 0) {
    return { html: '', matches: 0, error: 'This file is too big to lay out as a tree.' }
  }
  return { html: `<div class="json">${out.html}</div>`, matches: out.n, error: null }
}
