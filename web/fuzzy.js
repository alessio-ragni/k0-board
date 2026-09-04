// ── Searching the names ───────────────────────────────────────────────────────
// It does not look for the exact word: it looks for the letters you typed, in the order you
// typed them, scattered through the file's **name**. So `audrep` finds `docs/audit-report.md`.
//
// The directory is never searched. It was, once: `.env` scattered its four letters across
// `.planning/milestones/` and turned up `v1.0-ROADMAP.md`, a file that has nothing to do with
// what was typed and gives no way to see why it is there — three of the four letters are in a
// folder name nobody is looking at. A path is not a sentence you meant to write; a file name is.
//
// The score exists to put what you actually meant at the top. Worth more: a letter next to the
// previous one, and a letter at the start of a word.

const BOUNDARY = new Set(['-', '_', '.', ' '])

/** What is really searched for: the spaces mean nothing here, and neither does the case. */
const wanted = (query) => String(query ?? '').trim().toLowerCase().replace(/\s+/g, '')

/**
 * The one walk through the file's name, which produces both numbers this file exists for: how
 * alike the two are, and **which letters** made it so.
 *
 * They come out of the same walk on purpose. Underlining letters that a second, separate pass had
 * chosen would sooner or later underline something the ranking had not used — and a row that says
 * "this is why I am here" has to be telling the truth.
 *
 * `at` comes back as positions inside the whole `text`, not just the name: the caller was handed
 * a path, and a position only means something next to the path it was taken from.
 *
 * Returns `null` when the letters are not there at all.
 */
function trace(text, q) {
  const s = String(text ?? '')
  // Where the file name starts. Everything before this is the directory, and it is not searched.
  const nameAt = s.lastIndexOf('/') + 1
  const name = s.slice(nameAt)
  const low = name.toLowerCase()

  const at = []
  let total = 0
  let from = 0
  let last = -2
  for (const ch of q) {
    const hit = low.indexOf(ch, from)
    if (hit === -1) return null

    let point = 1
    if (hit === last + 1) point += 4 // next to the previous one
    if (hit === 0 || BOUNDARY.has(name[hit - 1])) point += 3 // the start of a word
    else if (name[hit] >= 'A' && name[hit] <= 'Z') point += 2 // the start of a word in camelCase

    total += point
    at.push(hit + nameAt)
    last = hit
    from = hit + 1
  }

  // On equal hits the shorter name wins: there is less around what you were looking for.
  return { total: total - name.length * 0.01, at }
}

/**
 * How much `text` looks like `query`: the higher, the more alike. `-1` when the letters simply
 * are not there. With an empty search it is 0 for everybody, and the caller decides the order.
 */
export function score(text, query) {
  const q = wanted(query)
  if (!q) return 0
  return trace(text, q)?.total ?? -1
}

/**
 * Where in `text` the letters of `query` were found, in order — the positions the score was built
 * from, so a row can underline them and show why it matched. `null` when there was no match, or
 * nothing to search for.
 */
export function positions(text, query) {
  const q = wanted(query)
  if (!q) return null
  return trace(text, q)?.at ?? null
}

/**
 * The same positions gathered into stretches — `[[from, to], …]`, the end not included.
 *
 * Neighbouring letters belong together: `audrep` against `audit-report.md` found two pieces of
 * two words, and that is what it should look like. Marked one letter at a time it looks like six
 * separate coincidences, which is the opposite of what happened.
 */
export function runs(at) {
  const out = []
  for (const i of at ?? []) {
    const last = out[out.length - 1]
    if (last && last[1] === i) last[1] = i + 1
    else out.push([i, i + 1])
  }
  return out
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
