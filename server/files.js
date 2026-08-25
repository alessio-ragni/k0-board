import fs from 'node:fs'
import path from 'node:path'
import { run, which } from '../platform/shared/run.js'
import { shell } from '../platform/index.js'

// ── A repository's files ──────────────────────────────────────────────────────
// The only place that reads the projects' disk, as git.js is the only one that talks to git.
// It answers two questions: what is in here, and what does this file say. No index and no
// search server: the listing is rebuilt every round and the browser does the searching, on
// the names.

const GIT = () => which('git', ['/usr/bin/git', '/usr/local/bin/git', 'C:\\Program Files\\Git\\cmd\\git.exe'])
const hasGit = () => !!GIT()

const OPTS = { timeout: 8000, maxBuffer: 1 << 24 }

const TTL = 5000 // how long a listing is worth before it is rebuilt
const MAX_FILES = 20000 // past that, the listing is cut and says so
const MAX_DEPTH = 12
const MAX_TEXT = 2 << 20 // 2 MB: above that it is no longer a document to read

// Directories that are nobody's work. Only needed where git is not: in a repository the
// listing comes from git, which already knows the .gitignore.
const SKIP = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', 'target', 'Pods', '__pycache__', 'venv',
])

// Only documents go in the listing: things you read and print. In a real repository code is
// 95% of the files, and among 2,499 `.tsx` files the document you were after is gone. This
// closes nothing off: a code file reached by a link inside a document still opens, and so do
// images — otherwise an `![](images/x.png)` would be a hole in the page.
const DOC_EXT = new Set([
  '.md', '.markdown', '.mdx', '.html', '.htm', '.txt', '.rtf',
  '.pdf', '.docx', '.doc', '.odt', '.pages',
])

export const isDoc = (p) => DOC_EXT.has(path.extname(p).toLowerCase())

// ── What kind of file is this ─────────────────────────────────────────────────
const MARKDOWN = new Set(['.md', '.markdown', '.mdx'])

const IMAGE = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
}

// A page is made to be looked at, not read as source: like a PDF, it opens inside the page in
// a frame of its own. You want to see the source when you read a `.js`; of an `.html` you want
// to see the page.
const WEB_PAGE = new Set(['.html', '.htm'])

const TEXT_EXT = new Set([
  '.txt', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.jsonl', '.css', '.scss', '.xml',
  '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.sh', '.zsh', '.bash', '.py', '.rb', '.go', '.rs',
  '.swift', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.sql', '.csv', '.tsv', '.env', '.log', '.gitignore',
])

// The ones already recognisable by name that are not worth tasting. Word and Excel documents
// belong here: they are zip files in disguise, and showing them would show mush.
const BINARY_EXT = new Set([
  '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.pages', '.numbers', '.key', '.zip', '.gz', '.tgz',
  '.tar', '.dmg', '.pkg', '.db', '.sqlite', '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.mov', '.mp3',
  '.wav', '.heic', '.psd', '.ai', '.eps',
])

/**
 * The type is decided by the extension, and only when the extension says nothing are the
 * first bytes tasted: a `Makefile` or a `Dockerfile` is text you read, and without the taste
 * test they would end up among the binaries.
 */
export function kindOf(file, head) {
  const ext = path.extname(file).toLowerCase()
  if (MARKDOWN.has(ext)) return 'markdown'
  if (IMAGE[ext]) return 'image'
  if (ext === '.pdf') return 'pdf'
  if (WEB_PAGE.has(ext)) return 'html'
  if (TEXT_EXT.has(ext)) return 'text'
  if (BINARY_EXT.has(ext)) return 'binary'
  return looksLikeText(head) ? 'text' : 'binary'
}

// What a page drags along with it: if the type is not right the browser does not apply the
// stylesheet and does not run anything, and the page comes out naked.
const ASSET = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

export function mimeOf(file) {
  const ext = path.extname(file).toLowerCase()
  if (IMAGE[ext]) return IMAGE[ext]
  if (ext === '.pdf') return 'application/pdf'
  if (ASSET[ext]) return ASSET[ext]
  return 'application/octet-stream'
}

/** A real page, one the browser would draw instead of showing its text. */
export const isPage = (file) => mimeOf(file).startsWith('text/html')

/**
 * The header that tells the browser "do not look at this, download it — and call it this".
 *
 * The name goes in twice, and that is not a mistake: the simple form for old browsers, which
 * only holds ASCII, and the `filename*` form for everything else, which carries accents
 * intact. Slashes never go in — a name with a path inside it would write the file somewhere
 * else — and neither do newlines, which would split the header in two.
 */
export function attachment(name) {
  const clean = String(name).replace(/[/\\]+/g, '-').replace(/[\r\n"]+/g, '').trim() || 'file'
  const plainName = clean.replace(/[^\x20-\x7e]+/g, '_')
  return `attachment; filename="${plainName}"; filename*=UTF-8''${encodeURIComponent(clean)}`
}

/** A zero byte does not belong in a text file, and neither does broken UTF-8. */
function looksLikeText(head) {
  if (!head?.length) return true // empty file: empty text, not a binary
  if (head.includes(0)) return false
  return !head.toString('utf8').includes('\uFFFD')
}

// ── The path guard ────────────────────────────────────────────────────────────
const realpath = (p) => {
  try {
    return fs.realpathSync(p)
  } catch {
    return null
  }
}

const inside = (base, p) => p === base || p.startsWith(base + path.sep)

/**
 * The real path of `rel` inside `root`, or null if it tries to get out.
 * It is checked twice: first the path as written — that is where `../../.ssh/id_rsa` lives —
 * and then where it really points, which is where the symbolic link planted to lead out
 * lives. That the root is one of the allowed ones is the caller's job: here it is assumed.
 */
export function safePath(root, rel) {
  if (typeof root !== 'string' || typeof rel !== 'string' || rel.includes('\0')) return null
  const base = realpath(root)
  if (!base) return null
  const target = path.resolve(base, rel)
  if (!inside(base, target)) return null
  const real = realpath(target)
  if (real && !inside(base, real)) return null
  return target
}

/**
 * Which of these paths really exist and are things the viewer can show.
 *
 * It exists for one thing: documents name files that are not in the listing. The `SKIP`
 * directories are there so the listing is not full of generated things, but in a directory of
 * documents `out/` holds the real PDFs, the ones you print. When it is a document naming them,
 * that file counts: the document said so, not the directory.
 *
 * It is not a shortcut for reading the disk: `safePath` keeps everything inside the
 * repository, `isDoc` keeps code out, and hidden paths do not pass — `.claude/` and friends
 * are configuration, not things to read.
 */
export function exist(root, paths) {
  const out = []
  for (const rel of Array.isArray(paths) ? paths.slice(0, MAX_ASK) : []) {
    if (typeof rel !== 'string' || !isDoc(rel)) continue
    if (rel.split('/').some((s) => s.startsWith('.'))) continue
    const abs = safePath(root, rel)
    if (!abs) continue
    try {
      if (fs.statSync(abs).isFile()) out.push(rel)
    } catch {
      /* not there: it simply does not come back */
    }
  }
  return out
}

/** How many paths are accepted in a single question. */
const MAX_ASK = 60

// ── The listing ───────────────────────────────────────────────────────────────
/** path → { at, value, promise } — same shape as the cache in git.js */
const cache = new Map()

/**
 * Every file in the repository, with when it was last touched.
 *
 * Where there is git, git provides the listing — `ls-files -co --exclude-standard` costs one
 * process and gives `.gitignore` support for free, which by hand would be a second
 * implementation to keep in step. Where there is no git we walk the disk skipping everything
 * that starts with a dot: one rule that in a single stroke removes `.git`, the caches, the
 * virtual environments and k0's own worktrees.
 */
async function scan(root) {
  const names = hasGit() && fs.existsSync(path.join(root, '.git')) ? await tracked(root) : null
  return { git: !!names, ...(names ? withStats(root, names) : walk(root)) }
}

const tracked = (root) =>
  run(GIT(), ['--no-optional-locks', '-C', root, 'ls-files', '-co', '--exclude-standard', '-z'], OPTS)
    .then((out) => out.split('\0').filter(Boolean))
    .catch(() => null) // broken repository: fall back to the walk

/** The names git gave, with a date and a size on them. Anything gone is dropped. */
function withStats(root, names) {
  const files = []
  let truncated = false
  for (const p of names) {
    if (!isDoc(p)) continue
    if (files.length >= MAX_FILES) {
      truncated = true
      break
    }
    try {
      const s = fs.statSync(path.join(root, p))
      if (s.isFile()) files.push({ p, m: Math.floor(s.mtimeMs), s: s.size })
    } catch {
      /* deleted between the listing and now */
    }
  }
  return { files, truncated }
}

function walk(root) {
  const files = []
  let truncated = false

  const rec = (dir, rel, depth) => {
    if (truncated || depth > MAX_DEPTH) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return // unreadable directory: carry on
    }
    for (const e of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true
        return
      }
      if (e.name.startsWith('.')) continue
      const child = path.join(dir, e.name)
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) rec(child, childRel, depth + 1)
        continue
      }
      // No symbolic links: a loop would send the walk round forever.
      if (!e.isFile() || !isDoc(e.name)) continue
      try {
        const s = fs.statSync(child)
        files.push({ p: childRel, m: Math.floor(s.mtimeMs), s: s.size })
      } catch {
        /* gone in the meantime */
      }
    }
  }

  rec(root, '', 0)
  return { files, truncated }
}

/**
 * This directory's listing. Whoever asks gets what is there while the re-read starts for the
 * next round, the way git.js does it. Only the first time is there a real wait: without it,
 * the page would open empty.
 */
export function list(root) {
  const e = cache.get(root) ?? { at: 0, value: null, promise: null }
  if (!e.promise && Date.now() - e.at >= TTL) {
    e.promise = scan(root)
      .catch(() => ({ git: false, files: [], truncated: false }))
      .then((value) => {
        cache.set(root, { at: Date.now(), value, promise: null })
        return value
      })
    cache.set(root, e)
  }
  return e.value ?? e.promise
}

// ── Is there anything to read in here? ────────────────────────────────────────
// Under your home there are also directories that are only installed software. They have no
// `.git`, Claude has never worked in them, and above all they contain not one document — while
// a directory of notes has dozens. That is the difference that matters: the repository list
// exists so you can open documents, so the directories that have some are the ones that belong
// in it.
//
// It looks at the surface and stops at the first hit: two levels, few entries, and the answer
// is kept for five minutes. A directory does not change its nature every second.
const PROBE_DEPTH = 2
const PROBE_MAX = 400
const PROBE_TTL = 300000

const probed = new Map() // path → { at, value }

export function hasDocs(dir) {
  const e = probed.get(dir)
  if (e && Date.now() - e.at < PROBE_TTL) return e.value
  const value = look(dir, 0, { seen: 0 })
  probed.set(dir, { at: Date.now(), value })
  return value
}

function look(dir, depth, budget) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  const sub = []
  for (const e of entries) {
    if (++budget.seen > PROBE_MAX) return false
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue
    if (e.isFile()) {
      if (isDoc(e.name)) return true
    } else if (e.isDirectory() && depth < PROBE_DEPTH) sub.push(e.name)
  }
  // Files before directories: a document at the surface settles the question immediately.
  for (const name of sub) if (look(path.join(dir, name), depth + 1, budget)) return true
  return false
}

// ── What has changed ──────────────────────────────────────────────────────────
/**
 * The paths from the lines of `status --porcelain=v2 -z`. The fields before the path are a
 * fixed number for each kind of line; with `-z` a rename takes two records, and the second is
 * the old name, which is no longer on disk.
 */
export function parseChanged(out) {
  const rec = String(out ?? '').split('\0')
  const paths = []
  for (let i = 0; i < rec.length; i++) {
    const r = rec[i]
    if (!r) continue
    if (r[0] === '1') paths.push(after(r, 8))
    else if (r[0] === '2') {
      paths.push(after(r, 9))
      i++ // the next record is the name it was renamed from: it no longer exists
    } else if (r[0] === 'u') paths.push(after(r, 10))
    else if (r[0] === '?') paths.push(after(r, 1))
  }
  return paths.filter(Boolean)
}

/** What comes after the nth space: the path can contain spaces of its own. */
function after(line, n) {
  let i = -1
  for (let k = 0; k < n; k++) {
    i = line.indexOf(' ', i + 1)
    if (i === -1) return ''
  }
  return line.slice(i + 1)
}

/**
 * The files this session has touched: the ones still hanging in the working tree, plus the
 * ones inside commits made since it started. The working tree belongs to everybody and not
 * only to it — the same limit the git mark on the card already has — but it remains the right
 * answer to the question "what has changed here, now".
 */
export async function changed(root, headAtStart) {
  if (!hasGit() || !fs.existsSync(path.join(root, '.git'))) return []
  const [now, mine] = await Promise.all([
    run(GIT(), ['--no-optional-locks', '-C', root, 'status', '--porcelain=v2', '-z'], OPTS)
      .then((out) => parseChanged(out))
      .catch(() => []),
    headAtStart
      ? run(GIT(), ['--no-optional-locks', '-C', root, 'diff', '--name-only', '-z', headAtStart, 'HEAD'], OPTS)
          .then((out) => out.split('\0').filter(Boolean))
          .catch(() => []) // the starting commit may not be there any more
      : [],
  ])
  // Documents only here too: a "Changed 40" made of `.tsx` files would say there are forty
  // things to read, when there is nothing to read at all.
  return [...new Set([...now, ...mine])].filter(isDoc)
}

// ── Searching inside the files ────────────────────────────────────────────────
// A document's name is almost never what makes you remember it. What stays with you about a
// letter is "the one where the strap broke", and the file is called `2026-07-28_reply.md`:
// searching the names does not find it, and it looks like it does not exist.
//
// No index: the documents are read and looked inside, every time. They are a few hundred files
// of a few KB, all already in the operating system's cache — it costs less than keeping an
// index up to date, and an index goes stale.
const TEXTY = new Set(['.md', '.markdown', '.mdx', '.txt', '.html', '.htm'])
const GREP_FILES = 80 // how many results are enough: past that nobody scrolls anyway
const GREP_BYTES = 1 << 20
const SNIPPET = 200

/**
 * Lower case and without accents, but **letter by letter**: `é` becomes `e` and stays a single
 * character. It matters because the positions found here also have to hold on the real text —
 * that is how the page knows what to highlight — and a normalisation that lengthened the
 * string would knock every one of them out of step.
 */
export const plain = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[\u00C0-\u024F]/g, (c) => c.normalize('NFD')[0])

/** The documents that contain all the words searched for, with the line they appear on. */
export async function grep(root, query) {
  const words = plain(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []

  const { files } = await list(root)
  const hits = []
  for (const f of files) {
    if (hits.length >= GREP_FILES) break
    if (!TEXTY.has(path.extname(f.p).toLowerCase()) || f.s > GREP_BYTES) continue
    let text
    try {
      text = fs.readFileSync(path.join(root, f.p), 'utf8')
    } catch {
      continue
    }
    // All the words in the file, not necessarily on the same line: "strap broke" has to find
    // the letter even if the two words are three paragraphs apart.
    const flat = plain(text)
    if (!words.every((w) => flat.includes(w))) continue
    hits.push({ p: f.p, m: f.m, s: f.s, ...quote(text, words[0]) })
  }
  return hits
}

/** The line the word appears on, cut to size, and where it sits inside that piece. */
function quote(text, word) {
  for (const row of text.split('\n')) {
    const i = plain(row).indexOf(word)
    if (i === -1) continue
    const from = Math.max(0, i - 60)
    const cut = row.slice(from, from + SNIPPET)
    const lead = cut.length - cut.trimStart().length
    return { line: cut.trim(), at: i - from - lead, len: word.length }
  }
  return { line: '', at: 0, len: 0 }
}

// ── Reading a file ────────────────────────────────────────────────────────────
/** The contents, or as much of them as can be shown. `abs` has already passed the guard. */
export function read(abs) {
  const s = fs.statSync(abs)
  if (!s.isFile()) throw new Error('Not a file')
  const meta = { size: s.size, mtime: Math.floor(s.mtimeMs) }

  const head = Buffer.alloc(Math.min(4096, s.size))
  if (head.length) {
    const fd = fs.openSync(abs, 'r')
    try {
      fs.readSync(fd, head, 0, head.length, 0)
    } finally {
      fs.closeSync(fd)
    }
  }

  const kind = kindOf(abs, head)
  if (kind !== 'markdown' && kind !== 'text') return { kind, ...meta }
  // Cut, not quietly truncated: the page says so.
  const truncated = s.size > MAX_TEXT
  const text = truncated ? fs.readFileSync(abs).subarray(0, MAX_TEXT).toString('utf8') : fs.readFileSync(abs, 'utf8')
  return { kind, ...meta, text, truncated }
}

/** Show it in the file manager: the only way to open what cannot be shown here. */
export const reveal = (abs) => shell.revealInFileManager(abs)
