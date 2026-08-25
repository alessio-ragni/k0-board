// ── The files a piece of text names ───────────────────────────────────────────
// When a session ends, the summary in the chat says what it touched and names the files:
// "from-the-call.md", "interviews/onboarding/journal.md", "the survey". To read them again you
// had to go and find them one by one, remembering what each was called.
//
// This does the opposite: it takes the text as it is and works out which of this repository's
// files it names. It does not look for the subject — only for the names written down — which
// is why it costs nothing and never goes near the server: the file listing is already in the
// browser.
//
// What is written out in full and what is merely guessed at stay separate, because they are
// two different degrees of certainty: mixing them would make a word that is only a hunch look
// like a fact.

/** The extension on the end of a name. It has to start with a letter: `1.5` is not a file. */
const EXT = /\.([A-Za-z][A-Za-z0-9]{0,5})$/
/** A piece of text that might be a name or a path. */
const TOKEN = /[A-Za-z0-9][A-Za-z0-9._/-]*/g
/** Under four characters a word is not the name of anything: it is a word. */
const MIN = 4

const low = (s) => String(s ?? '').toLowerCase()
const nameOf = (p) => p.slice(p.lastIndexOf('/') + 1)
const dirOf = (p) => p.slice(0, Math.max(0, p.lastIndexOf('/')))
const newest = (a, b) => b.m - a.m

/**
 * The indexes the search runs on, rebuilt on every call: they cost one pass over the listing,
 * and the caller already knows when the listing changes.
 *
 * `byDir` only knows a directory's **direct** files, not those of its subdirectories: opening
 * a directory means seeing what is in it, not the whole tree. Which is why a directory
 * containing only other directories does not appear here — it would have nothing to show.
 */
function index(files) {
  const byName = new Map()
  const byStem = new Map()
  const byDir = new Map()
  const dirTail = new Map() // last piece of a directory → the directories ending that way
  const exts = new Set()
  const push = (map, key, val) => {
    const a = map.get(key)
    if (a) a.push(val)
    else map.set(key, [val])
  }

  for (const f of files) {
    const p = low(f.p)
    const n = nameOf(p)
    push(byName, n, f)
    push(byStem, n.replace(EXT, ''), f)
    const ext = EXT.exec(n)
    if (ext) exts.add(ext[1])
    const d = dirOf(p)
    if (d) push(byDir, d, f)
  }
  for (const d of byDir.keys()) push(dirTail, nameOf(d), d)

  return { byName, byStem, byDir, dirTail, exts, stems: [...byStem.keys()] }
}

/** The pieces of text worth trying, lower case and in the order they appear. */
function tokens(text) {
  const out = []
  for (const m of String(text ?? '').matchAll(TOKEN)) {
    // Punctuation stuck on the end is not part of the name: "…it is in from-the-call.md."
    const t = low(m[0]).replace(/[._/-]+$/, '')
    if (t) out.push(t)
  }
  return out
}

/**
 * The files a token with an extension names, or `null`.
 *
 * The path can be written in full, only from the end, or with things in front that do not
 * count here (`research-notes/interviews/onboarding/journal.md`): they are all worth the same.
 * If the path as written matches nobody but the name does, the name wins — people writing from
 * memory get the directory wrong far more often than the name.
 */
function filesFor(token, ix) {
  const cands = ix.byName.get(nameOf(token))
  if (!cands) return null
  if (!token.includes('/')) return cands
  const exact = cands.filter((f) => {
    const p = low(f.p)
    return p === token || p.endsWith('/' + token) || token.endsWith('/' + p)
  })
  return exact.length ? exact : cands
}

/**
 * The directory a token names, or `null`. If one name matches several directories and there is
 * no path to tell them apart, it is left alone: a single row that opens the wrong directory is
 * worse than no row at all.
 */
function dirFor(token, ix) {
  if (ix.byDir.has(token)) return token
  const tails = ix.dirTail.get(nameOf(token)) || []
  const exact = tails.filter((d) => d.endsWith('/' + token) || token.endsWith('/' + d))
  return exact.length === 1 ? exact[0] : null
}

/**
 * This repository's files as named inside `text`.
 *
 * - `named` — what is written out in full: a name with its extension, or a directory path.
 *   There is nothing to guess.
 * - `maybe` — what is only guessed at: a word that is a file's name without the extension
 *   ("summary"), or the whole beginning of a name ("survey" for `survey-round-two.md`).
 * - `missing` — names written with a dot that do not exist in here. Only those with an
 *   extension the repository actually uses, otherwise `example.com` would look like a lost file.
 *
 * Every entry is `{ token, file, more }` for a file — `file` is the most recently touched one
 * when a name points at several, `more` are the rest — or `{ token, dir, files }` for a
 * directory. A file never appears twice, and what is certain takes precedence over what is
 * guessed.
 */
export function mentions(text, files) {
  const ix = index(files || [])
  const toks = tokens(text)
  const seen = new Set()
  const named = []
  const maybe = []
  const missing = []
  const missed = new Set()

  /** Drops the ones already listed and puts the most recent first. */
  const fresh = (hits) => (hits || []).filter((f) => !seen.has(f.p)).sort(newest)
  const keep = (out, entry, taken) => {
    for (const f of taken) seen.add(f.p)
    out.push(entry)
  }

  // First pass: what is written out in full.
  for (const t of toks) {
    if (EXT.test(t)) {
      const hits = filesFor(t, ix)
      if (!hits) {
        if (ix.exts.has(EXT.exec(t)[1]) && !missed.has(t)) {
          missed.add(t)
          missing.push(t)
        }
        continue
      }
      const f = fresh(hits)
      if (f.length) keep(named, { token: t, file: f[0], more: f.slice(1) }, f)
    } else if (t.includes('/')) {
      // A directory written as a path is not just any word: it is certain.
      const d = dirFor(t, ix)
      const f = d ? fresh(ix.byDir.get(d)) : []
      if (f.length) keep(named, { token: t, dir: d, files: f }, f)
    }
  }

  // Second pass: the names that are only guessed at. It comes after the first, so a file
  // already found by its full name does not turn up again down here as a hunch.
  const guess = (t) => t.length >= MIN && !EXT.test(t) && !t.includes('/')

  // File names first: the whole name without the dot, failing that the whole beginning of a
  // name cut at a dash — "survey" for `survey-round-two.md`.
  for (const t of toks) {
    if (!guess(t)) continue
    const hits =
      ix.byStem.get(t) ||
      ix.stems.filter((s) => s.startsWith(t + '-')).flatMap((s) => ix.byStem.get(s))
    const f = fresh(hits)
    if (f.length) keep(maybe, { token: t, file: f[0], more: f.slice(1) }, f)
  }

  // Then the directories named with a single word. They come last because they are the weakest
  // clue there is: "onboarding" in a text about onboarding is an ordinary word, and if it came
  // first it would carry off `interviews/onboarding/summary.md`, leaving "summary" to show the
  // summary of something else entirely.
  for (const t of toks) {
    if (!guess(t)) continue
    const d = dirFor(t, ix)
    const f = d ? fresh(ix.byDir.get(d)) : []
    if (f.length) keep(maybe, { token: t, dir: d, files: f }, f)
  }

  return { named, maybe, missing }
}

/** How many files a group of entries opens: a directory counts for what is inside it. */
export function countIn(entries) {
  return entries.reduce((n, e) => n + (e.files ? e.files.length : 1 + e.more.length), 0)
}
