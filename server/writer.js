import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { which } from '../platform/shared/run.js'
import { ROOT } from './paths.js'

// ── Who writes the words ─────────────────────────────────────────────────────
// k0 can work out the facts on its own. It cannot write them up, and it must not learn how:
// that would mean a key to keep, an account to configure, and a request leaving this machine
// carrying your commit messages and the names of your repositories. k0 makes no network
// requests, and that promise is worth more than a better-written paragraph.
//
// It does not need to. Everybody running k0 already has Claude Code installed, signed in and
// paid for — that is the whole premise of the product — so the model is already here. k0 hands
// it the facts and gets prose back, the same arrangement `/k0-import` has always had, except
// this one is invisible: no terminal opens and nothing lands on the board. `sessions.js`
// already drops `claude -p` runs when it looks for sessions to import, so these cannot come
// back later as cards.

// `K0_CLAUDE` names the executable outright. It exists for two reasons: a test must never be
// able to reach the real Claude Code by accident, and an installation that keeps it somewhere
// nobody thought of should not be told it has no Claude Code at all. A path that is not there
// counts as not there, rather than as a promise that fails at the worst moment.
const CLAUDE = () => {
  const named = process.env.K0_CLAUDE
  if (named) return fs.existsSync(named) ? named : null
  return which('claude', [
    path.join(process.env.HOME || '', '.local/bin/claude'),
    path.join(process.env.HOME || '', '.claude/local/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ])
}

const SKILL = path.join(ROOT, '.claude', 'skills', 'k0-changelog', 'SKILL.md')
const TIMEOUT = 3 * 60 * 1000
const MAX_OUTPUT = 1 << 20

/**
 * Whether the write-up can happen at all and, if not, why — in a sentence meant for the page
 * rather than for a log. An adapter never pretends, and neither does this: the facts are shown
 * either way, with the missing half explained instead of quietly absent.
 */
export function capability() {
  if (!CLAUDE()) {
    return { can: false, why: 'Claude Code is not on this machine, so there is nobody here to write the summary.' }
  }
  if (!fs.existsSync(SKILL)) {
    return { can: false, why: 'The k0-changelog skill is missing from this copy of k0.' }
  }
  return { can: true, why: null }
}

// One at a time: a second window of the same page must not start a second model. Each run gets
// a number, and only the run that is still the current one is allowed to record anything —
// otherwise a run abandoned halfway would come back later and overwrite the answer somebody is
// already reading.
let job = null
let runs = 0

/** Starts the write-up for a window, unless that window is already running or already done. */
export function write(key, payload) {
  if (job && job.key === key && (job.running || job.text)) return state(key)

  const can = capability()
  if (!can.can) {
    job = { id: ++runs, key, running: false, text: null, error: can.why, child: null }
    return state(key)
  }

  if (job?.child) job.child.kill('SIGTERM')
  const id = ++runs
  const child = spawn(CLAUDE(), ['-p', '/k0-changelog', '--output-format', 'text'], {
    cwd: ROOT, // where the project skill lives, whether k0 runs installed or from a checkout
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  job = { id, key, running: true, text: null, error: null, child }

  /** Records the end of THIS run, once. A run that has already ended cannot end again. */
  const finish = (patch) => {
    if (job?.id !== id || !job.running) return
    job = { ...job, ...patch, running: false, child: null }
  }

  let out = ''
  let err = ''
  const timer = setTimeout(() => {
    child.kill('SIGTERM')
    finish({ error: 'The summary took too long to write and was given up on.' })
  }, TIMEOUT)

  child.stdout.on('data', (d) => {
    if (out.length < MAX_OUTPUT) out += d
  })
  child.stderr.on('data', (d) => {
    if (err.length < 4096) err += d
  })
  child.on('error', (e) => {
    clearTimeout(timer)
    finish({ error: `Claude Code would not start: ${e.message}` })
  })
  child.on('close', (code) => {
    clearTimeout(timer)
    const text = out.trim()
    if (code === 0 && text) finish({ text })
    else finish({ error: err.trim().split('\n').pop() || 'The summary came back empty.' })
  })

  // The facts go in on standard input rather than in the prompt: the skill then needs no tools,
  // no permissions and no file of its own, and a month of commits does not have to fit on a
  // command line. Claude Code waits for standard input, so it must always be closed.
  child.stdin.on('error', () => {})
  child.stdin.end(payload)

  return state(key)
}

/** What the page is waiting for. A window nobody has asked about is simply not running. */
export function state(key) {
  if (!job || job.key !== key) return { running: false, text: null, error: null }
  return { running: !!job.running, text: job.text ?? null, error: job.error ?? null }
}

/** Called on the way out, so a model left mid-sentence does not outlive the server. */
export function stop() {
  if (job?.child) job.child.kill('SIGTERM')
  job = null
}
