// ── What a reply points at ────────────────────────────────────────────────────
// Claude's replies are full of places — "open localhost:4321/projects/furniture/", "the photos are
// in docs/projects/sideboard-140/", "it goes live on alessioragni.com/projects/furniture/" — and in
// the terminal all of it is dead text. This finds them in the reply, in the order they were said,
// so the mod can put them in a row above the prompt where one click opens each.
//
// It is pure on purpose: the mod's environment has no Node, the test runner has no Claude Code,
// and this file has to run in both. Whether a path is a folder, and whether k0 is listening, is
// for register.js to ask.
//
// Not imported from web/refs.js because the mod is copied into ~/.claude/skills/, where nothing
// of k0 is next to it. The extension list is the server's `DOC_EXT`, kept in step by a test.

/** The extensions the viewer can show. Same list as `DOC_EXT` in server/files.js. */
export const DOC = new Set([
  '.md', '.markdown', '.mdx', '.html', '.htm', '.txt', '.rtf',
  '.pdf', '.docx', '.doc', '.odt', '.pages',
])

/** A reply naming more than this is a listing, and a row of forty buttons is noise. */
export const MAX_REFS = 12

export const extOf = (p) => {
  const n = p.replace(/\/+$/, '').slice(p.replace(/\/+$/, '').lastIndexOf('/') + 1)
  const i = n.lastIndexOf('.')
  return i > 0 ? n.slice(i).toLowerCase() : ''
}

/** Fenced blocks are code being shown, not places being pointed at. */
const FENCE = /^\s*(```+|~~~+)[\s\S]*?^\s*\1\s*$/gm

const END = `[^\\s)>\\]\`'"<]`
/** Every way a reply writes an address: with a scheme, a local port, or a domain with a path. */
const WEB = new RegExp(
  [
    `https?:\\/\\/${END}+`,
    `(?:localhost|127\\.0\\.0\\.1|\\[::1\\]):\\d{2,5}(?:\\/${END}*)?`,
    `(?<![\\w./-])(?:[a-z0-9-]+\\.)+[a-z]{2,}\\/${END}*`,
  ].join('|'),
  'gi'
)
/** A path: something with a slash in it, relative, absolute or from home. */
const PATH = /(?<![\w.:/~-])(?:~\/|\/|\.{1,2}\/)?[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)*\/?/g

/** Punctuation stuck on the end is not part of the name: "…it is in docs/plan/." */
const trim = (t) => t.replace(/[.,;:!?]+$/, '')

/** The address a written one means: a scheme added where the reply left it out. */
export function webUrl(written) {
  if (/^https?:\/\//i.test(written)) return written
  if (/^(?:localhost|127\.0\.0\.1|\[::1\])[:/]/i.test(written)) return `http://${written}`
  return `https://${written}`
}

/**
 * The places a reply points at, in the order it says them, each as `{ kind, written }`:
 * `web` for an address, `path` for something on disk. Which paths are real, and what they are,
 * is not known here.
 */
export function references(text) {
  const clean = String(text ?? '').replace(FENCE, '')
  const found = []
  const taken = [] // the stretches already claimed by an address, so a path is not found inside one
  for (const m of clean.matchAll(WEB)) {
    const written = trim(m[0])
    found.push({ i: m.index, kind: 'web', written })
    taken.push([m.index, m.index + m[0].length])
  }
  for (const m of clean.matchAll(PATH)) {
    const written = trim(m[0])
    // A bare name counts only when it is a document: `README.md` is a place, `index` is a word.
    if (!written.includes('/') && !DOC.has(extOf(written))) continue
    if (taken.some(([a, b]) => m.index < b && m.index + m[0].length > a)) continue
    if (/^\/+$/.test(written)) continue
    found.push({ i: m.index, kind: 'path', written })
  }
  const seen = new Set()
  return found
    .sort((a, b) => a.i - b.i)
    .filter((r) => !seen.has(r.written) && seen.add(r.written))
    .map(({ kind, written }) => ({ kind, written }))
}

/** `written` as an absolute path, or null when it cannot be one. */
export function absolute(written, root, home) {
  const p = written.replace(/\/+$/, '')
  if (p.startsWith('~/')) return home ? `${home.replace(/\/+$/, '')}/${p.slice(2)}` : null
  if (p.startsWith('/')) return p
  if (!root) return null
  const parts = `${root.replace(/\/+$/, '')}/${p}`.split('/')
  const out = []
  for (const s of parts) {
    if (s === '..') out.pop()
    else if (s !== '.' && s !== '') out.push(s)
  }
  return '/' + out.join('/')
}

/** `abs` as a path inside `root`, or null when it is somewhere else. */
export function inside(abs, root) {
  const base = String(root || '').replace(/\/+$/, '')
  return base && abs.startsWith(base + '/') ? abs.slice(base.length + 1) : null
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

/** The artifacts a reply mentions, by title or by address, with where it mentions them. */
export function artifactsIn(text, artifacts) {
  const src = String(text ?? '')
  const out = []
  for (const [title, url] of artifacts) {
    const at = [src.indexOf(title), src.indexOf(url)].filter((i) => i >= 0)
    if (at.length) out.push({ i: Math.min(...at), title, url })
  }
  return out
}
