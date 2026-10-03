// ── Turning what Claude names into links ──────────────────────────────────────
// Claude's replies are full of files — "the plan is in docs/plan.md", "I wrote out/report.html" —
// and of artifacts it has just published, which it mentions by title. In the terminal all of it
// is dead text. This decides which pieces of a reply are worth asking k0 about, and rewrites the
// reply's markdown so the ones that turned out to be real become links.
//
// It is pure on purpose: the mod's environment has no Node, the test runner has no Claude Code,
// and this file has to run in both. Everything that needs the outside world is in register.js.
//
// Not imported from web/refs.js because the mod is copied into ~/.claude/skills/, where nothing
// of k0 is next to it. The extension list is the server's `DOC_EXT`, kept in step by a test.

/** The extensions the viewer can show. Same list as `DOC_EXT` in server/files.js. */
export const DOC = new Set([
  '.md', '.markdown', '.mdx', '.html', '.htm', '.txt', '.rtf',
  '.pdf', '.docx', '.doc', '.odt', '.pages',
])

/** At most this many names go to k0 per reply: the server reads no more than 60 either. */
const MAX_ASK = 60

const extOf = (p) => {
  const n = p.slice(p.lastIndexOf('/') + 1)
  const i = n.lastIndexOf('.')
  return i > 0 ? n.slice(i).toLowerCase() : ''
}

/** Fenced blocks are code being shown, not things being pointed at. */
const FENCE = /^\s*(```+|~~~+)[\s\S]*?^\s*\1\s*$/gm

/** A path as Claude writes one: relative, or absolute, with the extension that makes it a file. */
const TOKEN = /(?:~|\/)?[A-Za-z0-9_.][A-Za-z0-9._/~-]*/g

/** Punctuation stuck on the end is not part of the name: "…it is in docs/plan.md." */
const trim = (t) => t.replace(/[.\-~]+$/, '')

/**
 * The names in a reply worth asking k0 about, each as `{ written, rel }`: how the reply spells it,
 * and the path inside `root` that spelling means. An absolute path outside the repository, a
 * hidden one and a piece of code are left out before anybody is asked.
 */
export function candidates(text, root) {
  const clean = String(text ?? '').replace(FENCE, '')
  const seen = new Map()
  for (const m of clean.matchAll(TOKEN)) {
    const written = trim(m[0])
    if (seen.has(written) || !DOC.has(extOf(written))) continue
    const rel = relative(written, root)
    if (!rel || rel.split('/').some((s) => s.startsWith('.') || s === '')) continue
    seen.set(written, rel)
    if (seen.size >= MAX_ASK) break
  }
  return [...seen].map(([written, rel]) => ({ written, rel }))
}

/** `written` as a path inside `root`, or null when it points somewhere else. */
function relative(written, root) {
  if (written.startsWith('~')) return null
  if (!written.startsWith('/')) return written.replace(/^\.\//, '')
  const base = String(root || '').replace(/\/+$/, '')
  if (!base || !written.startsWith(base + '/')) return null
  return written.slice(base.length + 1)
}

/** The viewer's address for one file, the same shape the board's git mark opens. */
export const viewerUrl = (port, root, rel) =>
  `http://localhost:${port}/files.html?${new URLSearchParams({ repo: root, f: rel })}`

/** The address of an artifact, out of whatever the Artifact tool answered. */
export const artifactUrl = (text) =>
  String(text ?? '').match(/https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/)?.[0] ?? null

/** An artifact's title, out of its page: the `<title>` the page carries, when it carries one. */
export const titleOf = (html) => {
  const t = String(html ?? '').match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]
  return t ? t.replace(/\s+/g, ' ').trim() || null : null
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const label = (s) => s.replace(/([\\[\]])/g, '\\$1')

/**
 * The reply, with every name in `links` (spelling → address) turned into a markdown link.
 *
 * Fenced blocks, links that are already links and bare addresses are left exactly as they are;
 * a name inside backticks keeps its backticks inside the link. Names are matched longest first,
 * so `docs/plan.md` is never cut down to the `plan.md` inside it.
 */
export function linkify(text, links) {
  const src = String(text ?? '')
  const names = [...links.keys()].filter(Boolean).sort((a, b) => b.length - a.length)
  if (!names.length || !src) return src
  const edge = '[\\p{L}\\p{N}_/.~-]'
  const re = new RegExp(
    [
      '(\\[[^\\]\\n]*\\]\\([^)\\n]*\\))', // a link already
      '(`[^`\\n]+`)', // inline code
      '(https?:\\/\\/[^\\s)>\\]]+)', // a bare address
      `(?<!${edge})(${names.map(escapeRe).join('|')})(?!${edge.replace('.', '')})`,
    ].join('|'),
    'gu'
  )
  const swap = (chunk) =>
    chunk.replace(re, (whole, link, code, url, name) => {
      if (code) {
        const inner = code.slice(1, -1)
        return links.has(inner) ? `[${code}](${links.get(inner)})` : code
      }
      if (name) return `[${label(name)}](${links.get(name)})`
      return whole
    })
  // Walk the text keeping fenced blocks out of the rewrite, rather than removing them.
  let out = ''
  let last = 0
  for (const m of src.matchAll(FENCE)) {
    out += swap(src.slice(last, m.index)) + m[0]
    last = m.index + m[0].length
  }
  return out + swap(src.slice(last))
}

/**
 * What the last reply pointed at, in the order it said them: the files k0 confirmed, then the
 * artifacts whose title or address it mentions. One entry per address.
 */
export function referencesIn(text, files, artifacts) {
  const src = String(text ?? '')
  const out = new Map()
  const found = []
  for (const [written, url] of files) {
    const i = src.indexOf(written)
    if (i >= 0) found.push({ i, label: written, url })
  }
  for (const [title, url] of artifacts) {
    const i = Math.max(src.indexOf(title), src.indexOf(url))
    if (i >= 0) found.push({ i, label: title, url })
  }
  for (const r of found.sort((a, b) => a.i - b.i)) if (!out.has(r.url)) out.set(r.url, r)
  return [...out.values()].map(({ label, url }) => ({ label, url }))
}
