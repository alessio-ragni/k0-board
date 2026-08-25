// ── The references inside a document ──────────────────────────────────────────
// Documents point at each other constantly — a table listing eight files, "the answers end up
// in observations/", "it produces out/report.pdf and out/report.html" — and until now that was
// all dead text: to open any of it you had to go back to the listing and hunt by hand.
//
// This decides, given the document you are reading and a piece of text, whether that piece is
// a reference to something real. There is one rule: **it has to exist**. There is no list of
// words to avoid, and none is needed: in a README full of `TRUE`, `spacing`, `active: false`
// and `bold`, existence throws all of them out by itself.
//
// The hard part is not finding the names, it is choosing **which** file. In a repository with
// nine `README.md` files, the right one is the one in the directory you are reading in — and
// failing that, the one in the directory above. Somebody writing `README.md` inside
// `interviews/` means the one in `interviews/`, not one picked at random.

/** The extensions the viewer can show. Same list as `DOC_EXT` on the server. */
const DOC = new Set([
  '.md', '.markdown', '.mdx', '.html', '.htm', '.txt', '.rtf',
  '.pdf', '.docx', '.doc', '.odt', '.pages',
])

/**
 * A piece of text that might be a name or a path. It is a string rather than a ready-made
 * regular expression because the code that walks the real document needs it too, and a global
 * regex carries around the position it last reached.
 */
export const TOKEN_SRC = '[A-Za-z0-9.][A-Za-z0-9._/~-]*'
const tokenRe = () => new RegExp(TOKEN_SRC, 'g')

/** Punctuation stuck on the end is not part of the name: "…it is in from-the-call.md." */
export const trim = (t) => t.replace(/[.\-~]+$/, '')

const nameOf = (p) => p.slice(p.lastIndexOf('/') + 1)
const dirOf = (p) => p.slice(0, Math.max(0, p.lastIndexOf('/')))
const extOf = (p) => {
  const n = nameOf(p)
  const i = n.lastIndexOf('.')
  return i > 0 ? n.slice(i).toLowerCase() : ''
}

/**
 * The path a reference written inside a document points at: `../x/y.md` read from `a/b/c.md`
 * makes `a/x/y.md`. It lives here and not in the viewer because it is the same operation
 * markdown links and names found in the text both need.
 */
export function resolveRel(from, target) {
  const clean = target.split('#')[0].split('?')[0]
  if (!clean) return null
  const parts = (clean.startsWith('/') ? [] : dirOf(from).split('/')).concat(clean.split('/'))
  const out = []
  for (const p of parts) {
    if (!p || p === '.') continue
    if (p === '..') out.pop()
    else out.push(p)
  }
  return out.join('/')
}

/**
 * A path that goes through a hidden directory. They stay out: `.claude/` and friends are
 * configuration, not things to read, and the listing has never shown them.
 */
const hidden = (p) => p.split('/').some((s) => s.startsWith('.') && s !== '.' && s !== '..')

/**
 * The indexes the search runs on. `dirs` holds every directory with at least one file in the
 * listing: a directory the viewer cannot list is not a place to send you.
 */
export function index(files) {
  const byPath = new Map()
  const byName = new Map()
  // Lower case → as it is written on disk. The comparison has to ignore case — somebody
  // writing "Onboarding" in a sentence means the `onboarding` directory — but what comes back
  // has to be the real path, otherwise the directory opens empty.
  const dirs = new Map()
  for (const f of files || []) {
    const p = f.p
    byPath.set(p.toLowerCase(), p)
    const n = nameOf(p).toLowerCase()
    const a = byName.get(n)
    if (a) a.push(p)
    else byName.set(n, [p])
    const parts = p.split('/')
    parts.pop()
    for (let i = 1; i <= parts.length; i++) {
      const d = parts.slice(0, i).join('/')
      if (!dirs.has(d.toLowerCase())) dirs.set(d.toLowerCase(), d)
    }
  }
  return { byPath, byName, dirs }
}

/**
 * Is this piece of text worth trying to resolve?
 *
 * In plain prose the signal is the extension or the slash: "README" written in a sentence is a
 * word, `README.md` is a file. Inside backticks the rule is looser — somebody who reached for
 * backticks was already pointing at something — and a single word gets through too, which may
 * turn out to be a directory.
 */
export function worth(t, fromCode = false) {
  if (!t || /\s/.test(t)) return false
  const ext = extOf(t)
  if (ext) return DOC.has(ext) // `.mjs`, `.js`: code, not something the viewer shows
  return fromCode || t.includes('/')
}

/** Every piece of text in a document that would be worth trying to resolve. */
export function candidates(text) {
  // Fenced blocks never become links — the renderer does not touch them — so there is no
  // point even asking what is inside them.
  const clean = String(text ?? '').replace(/^\s*(```+|~~~+)[\s\S]*?^\s*\1\s*$/gm, '')
  const out = new Set()
  for (const m of clean.matchAll(tokenRe())) {
    const t = trim(m[0])
    if (worth(t, true)) out.add(t)
  }
  return [...out]
}

/**
 * What `t` points at, read from inside `doc`. Returns:
 *
 * - `{ path }` — a file the viewer already has in its listing;
 * - `{ dir }` — a directory the viewer can list;
 * - `{ ask }` — not in the listing, but it might exist anyway: these are the paths to have the
 *   server check. It is the case of the PDFs inside `out/`, which the listing skips but which a
 *   document names on purpose;
 * - `null` — it is not a reference, or it is ambiguous and there is no way to choose.
 */
export function resolve(t, doc, ix, fromCode = false) {
  if (!worth(t, fromCode)) return null

  const folder = !extOf(t)
  const rooted = t.includes('/') || t.startsWith('.')

  // With the path written out there is nothing to guess: it is read relative to the document.
  // Without one, we climb — the directory you are reading in, then the one above, to the top.
  const tries = []
  if (rooted) {
    const abs = resolveRel(doc, t)
    if (abs) tries.push(abs)
    // And then from the repository root: `interviews/` written inside `interviews/README.md`
    // means that directory, not `interviews/interviews`. Somebody writing a path with slashes
    // in it usually writes the whole thing, not one relative to where they are.
    const bare = t.replace(/^(\.\.?\/)+/, '').replace(/\/$/, '')
    if (bare && !tries.includes(bare)) tries.push(bare)
  } else {
    for (let d = dirOf(doc); ; d = dirOf(d)) {
      tries.push(d ? `${d}/${t}` : t)
      if (!d) break
    }
  }

  for (const p of tries) {
    if (hidden(p)) continue
    const real = ix.byPath.get(p.toLowerCase())
    if (real) return { path: real }
    const dir = folder && ix.dirs.get(p.toLowerCase().replace(/\/$/, ''))
    if (dir) return { dir }
  }

  // Not in the listing. If the bare name exists in exactly one place, that is the one; if
  // there are several and climbing found nothing either, no link is better than sending you to
  // the wrong README.
  if (!rooted && !folder) {
    const same = (ix.byName.get(t.toLowerCase()) || []).filter((p) => !hidden(p))
    if (same.length === 1) return { path: same[0] }
    if (same.length > 1) return null
  }

  // That leaves the server's road: a directory the listing skips is not a file that does not
  // exist. The PDFs inside `out/` are there, and a document that names them knows it.
  const ask = tries.filter((p) => !hidden(p) && DOC.has(extOf(p)))
  return ask.length ? { ask } : null
}
