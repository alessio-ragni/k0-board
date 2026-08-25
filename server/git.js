import fs from 'node:fs'
import path from 'node:path'
import { run, which } from '../platform/shared/run.js'

// ── Git ───────────────────────────────────────────────────────────────────────
// The only place that talks to git. It exists to answer one question: is what is in here
// safe, or is it still hanging somewhere?
//
// k0 does NOT fetch. It only looks at what the local git already knows about the remotes: for
// "did I push it?" that is exact and instant — pushing updates the remote reference by itself
// — and in exchange it never touches the network, your credentials, or your patience.

const GIT = () => which('git', ['/usr/bin/git', '/usr/local/bin/git', 'C:\\Program Files\\Git\\cmd\\git.exe'])
const available = () => !!GIT()

const OPTS = { timeout: 4000, maxBuffer: 1 << 20 }

const TTL = 5000 // how long a reading is worth before it is taken again
// The last column of the board lists every repository, which is dozens of them and none of
// them working: those are looked at rarely and a few at a time. At five seconds it would be
// eighty git processes every round, on a machine that is already struggling.
const SLOW_TTL = 60000
const SLOW_BATCH = 4
const MAX_UNPUSHED = 200 // past that there is no point knowing: the big number is the alarm

/** path → { at, running, value } */
const cache = new Map()
/** Remotes never change: read once per directory and kept. */
const remotes = new Map()

// ── Reading ───────────────────────────────────────────────────────────────────
/**
 * The branch and how many files are touched, from `status --porcelain=v2 --branch`.
 * Lines starting with `#` are branch information; everything else — `1`, `2`, `u`, `?` — is a
 * file: modified, conflicted, or never seen before.
 */
export function parseStatus(out) {
  let branch = null
  let dirty = 0
  for (const line of String(out ?? '').split('\n')) {
    if (!line) continue
    if (line[0] === '#') {
      const m = /^# branch\.head (.+)$/.exec(line)
      if (m && m[1] !== '(detached)') branch = m[1]
      continue
    }
    dirty++
  }
  return { branch, dirty }
}

/**
 * How many of those unpushed commits arrived AFTER the session started. The list is
 * newest-first, so they are the ones before `headAtStart`. If `headAtStart` is not in the list
 * it was already pushed, and all of them are the session's. Returns null when it cannot be
 * known, and then the card says nothing about it.
 */
export function sessionShare(shas, headAtStart) {
  if (!Array.isArray(shas) || !shas.length) return 0
  if (!headAtStart) return null
  const i = shas.indexOf(headAtStart)
  return i === -1 ? shas.length : i
}

async function hasRemote(dir) {
  if (remotes.has(dir)) return remotes.get(dir)
  const yes = await run(GIT(), ['-C', dir, 'remote'], OPTS)
    .then((out) => !!out.trim())
    .catch(() => false)
  remotes.set(dir, yes)
  return yes
}

async function read(dir) {
  // No `.git` here: either it is not a repository, or it is a worktree that has been
  // destroyed. Costs nothing and saves launching git for nothing every five seconds.
  if (!fs.existsSync(path.join(dir, '.git'))) return null

  // The three in parallel: two processes in a queue would double the wait for nothing. After
  // the first round `hasRemote` answers from memory and it is back to two processes.
  const [st, list, remote] = await Promise.all([
    run(GIT(), ['--no-optional-locks', '-C', dir, 'status', '--porcelain=v2', '--branch'], OPTS).catch(() => null),
    run(
      GIT(),
      ['--no-optional-locks', '-C', dir, 'rev-list', `--max-count=${MAX_UNPUSHED}`, 'HEAD', '--not', '--remotes'],
      OPTS
    )
      .then((out) => out.split('\n').filter(Boolean))
      .catch(() => []), // a repository without a single commit
    hasRemote(dir),
  ])
  if (!st) return null

  // With no remote configured `--not --remotes` returns the whole history: that count means
  // nothing, and there is no question of pushing at all.
  const shas = remote ? list : []
  return { ...parseStatus(st), remote, unpushed: remote ? shas.length : null, shas }
}

// ── Cache ─────────────────────────────────────────────────────────────────────
function schedule(dir) {
  const e = cache.get(dir) ?? { at: 0, running: false, value: null }
  e.running = true
  cache.set(dir, e)
  read(dir)
    .then(
      (value) => (e.value = value),
      () => (e.value = null)
    )
    .finally(() => {
      e.at = Date.now()
      e.running = false
    })
}

/**
 * The directories that matter right now. Refreshes the stale ones and forgets the ones no
 * longer needed — a destroyed worktree disappears by itself. Waits for nothing: whoever asks
 * for the state gets what is there, and the board never stalls on git.
 */
export function watch(dirs, slow = []) {
  if (!available()) return
  const hot = new Set(dirs.filter(Boolean))
  const cold = new Set(slow.filter(Boolean).filter((d) => !hot.has(d)))
  const wanted = new Set([...hot, ...cold])
  for (const dir of [...cache.keys()]) if (!wanted.has(dir)) cache.delete(dir)

  for (const dir of hot) due(dir, TTL)
  // The repositories that are only in the list: a few per round, so within ten seconds they
  // are all done and then it stays quiet for a minute.
  let budget = SLOW_BATCH
  for (const dir of cold) {
    if (budget <= 0) break
    if (due(dir, SLOW_TTL)) budget--
  }
}

/** Reads again if it is time. Returns whether it really started something, to count the budget. */
function due(dir, ttl) {
  const e = cache.get(dir)
  if (e?.running || (e && Date.now() - e.at < ttl)) return false
  schedule(dir)
  return true
}

/** What is known about this directory right now, or null if nothing is known yet. */
export function stateOf(dir) {
  return (dir && cache.get(dir)?.value) || null
}

/** Where HEAD is at this moment. Needed once, when a session starts. */
export async function head(dir) {
  if (!available()) return null
  return run(GIT(), ['--no-optional-locks', '-C', dir, 'rev-parse', 'HEAD'], OPTS)
    .then((out) => out.trim() || null)
    .catch(() => null)
}
