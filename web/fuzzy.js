// ── Searching the names ───────────────────────────────────────────────────────
// It does not look for the exact word: it looks for the letters you typed, in the order you
// typed them, scattered through the path. So `audrep` finds `docs/audit-report.md` and `bapl`
// finds `docs/backlog/plans/`.
//
// The score exists to put what you actually meant at the top. Worth more: a letter next to the
// previous one, a letter at the start of a word, and anything in the file's name rather than in
// the directory — because you usually reach a file through its name, not through where it is.

const BOUNDARY = new Set(['/', '-', '_', '.', ' '])

/**
 * How much `text` looks like `query`: the higher, the more alike. `-1` when the letters simply
 * are not there. With an empty search it is 0 for everybody, and the caller decides the order.
 */
export function score(text, query) {
  const q = String(query ?? '').trim().toLowerCase().replace(/\s+/g, '')
  if (!q) return 0
  const s = String(text ?? '')
  const low = s.toLowerCase()

  // Where the file name starts: from there on every hit is worth more.
  const nameAt = s.lastIndexOf('/') + 1

  let total = 0
  let at = 0
  let last = -2
  for (const ch of q) {
    const hit = low.indexOf(ch, at)
    if (hit === -1) return -1

    let point = 1
    if (hit === last + 1) point += 4 // next to the previous one
    if (hit === 0 || BOUNDARY.has(s[hit - 1])) point += 3 // the start of a word
    else if (s[hit] >= 'A' && s[hit] <= 'Z') point += 2 // the start of a word in camelCase
    if (hit >= nameAt) point += 2 // in the file name, not the directory

    total += point
    last = hit
    at = hit + 1
  }

  // On equal hits the shorter name wins: there is less around what you were looking for.
  return total - s.length * 0.01
}

/** The rows that match, most alike first. `key` says where to look. */
export function search(items, query, key = (x) => x, limit = 200) {
  if (!String(query ?? '').trim()) return items.slice(0, limit)
  const hits = []
  for (const item of items) {
    const s = score(key(item), query)
    if (s >= 0) hits.push({ item, s })
  }
  hits.sort((a, b) => b.s - a.s)
  return hits.slice(0, limit).map((h) => h.item)
}
