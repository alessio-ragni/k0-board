import { check, section } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// ── Nothing personal ─────────────────────────────────────────────────────────
section('Nothing personal')
// k0 grew up as one person's tool, and the functions that find files inside documents were built
// against real material: real people's names, real client names, real absolute paths. All of that
// was replaced before the project was opened. This test is what stops it coming back.
//
// It is not decoration. The failure it guards against is quiet and one-way: a fixture pasted from
// a real repository, a comment written from a real example, a path copied out of a terminal. Once
// pushed, it is public forever.
//
// The terms are base64 so that this file does not trip over itself — a denylist written in plain
// text would be the first thing its own scan found.

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/** Names and words that must never appear again, in any file. */
const WORDS = [
  'QXN0aWth', 'YXN0aWth', 'RG9taW52ZXN0', 'Q29Xb3Jr', 'YXJmaWQ=', 'YmltYmk=',
  'cml0YQ==', 'bmljaG9sYXM=', 'dGhvbWFz', 'ZWxlbmE=', 'cXVlc3Rpb25hcmlv',
  'ZGlmZmlkYQ==', 'c2VvX3NwaWRlcg==', 'c2NyZWFtaW5nLWZyb2c=',
].map((b) => Buffer.from(b, 'base64').toString('utf8'))

/** Paths and addresses, matched anywhere rather than as whole words. */
const STRINGS = ['L1VzZXJzL2FkbWlu', 'YWxlc3Npby5yYWduaUBnbWFpbC5jb20='].map((b) =>
  Buffer.from(b, 'base64').toString('utf8')
)

/** Directories that are not ours to police. `worktrees` holds working copies, not the project. */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'fonts', 'worktrees'])

/** Files whose bytes are not text, so there is nothing to read in them. */
const SKIP_EXT = new Set(['.woff2', '.woff', '.ttf', '.otf', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.db'])

/**
 * The files of the project, and only those.
 *
 * git is asked first, because it already knows the answer: `ls-files` returns exactly what is
 * tracked, which is exactly what will be published. Walking the directory instead would sweep up
 * the live database sitting next to the source — a file full of your real card titles, ignored by
 * git and rightly so, but a guaranteed false alarm here.
 *
 * The walk stays as a fallback for the one case with no git: an unpacked npm tarball, where
 * everything present is by definition something that was published.
 */
function* tracked() {
  try {
    const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8' })
    for (const rel of out.split('\0').filter(Boolean)) {
      if (SKIP_EXT.has(path.extname(rel).toLowerCase())) continue
      yield path.join(ROOT, rel)
    }
    return
  } catch {
    /* not a git checkout: fall back to the walk */
  }
  yield* walk(ROOT)
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    if (entry.isDirectory()) yield* walk(path.join(dir, entry.name))
    else if (entry.isFile()) {
      if (entry.name.startsWith('k0.db')) continue
      if (SKIP_EXT.has(path.extname(entry.name).toLowerCase())) continue
      yield path.join(dir, entry.name)
    }
  }
}

const wordRe = new RegExp(`\\b(${WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i')

const found = []
let scanned = 0
for (const file of tracked()) {
  const rel = path.relative(ROOT, file)
  if (rel === path.join('test', 'clean.test.mjs')) continue
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    continue
  }
  scanned++
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (wordRe.test(line) || STRINGS.some((s) => line.includes(s))) {
      found.push(`${rel}:${i + 1}`)
    }
  }
}

// The failure prints the first ten places, which is enough to see the shape of what came back;
// the count of the rest goes in the label so nobody reads ten and thinks that was all of it.
const rest = found.length > 10 ? ` (and ${found.length - 10} more)` : ''

check('there are files to scan at all', scanned > 20, true)
check(`no personal data in ${scanned} files${rest}`, found.slice(0, 10).join(' '), '')

