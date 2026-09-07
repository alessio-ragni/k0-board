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
// back later as stories.

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

const skillFile = (skill) => path.join(ROOT, '.claude', 'skills', skill, 'SKILL.md')
const TIMEOUT = 3 * 60 * 1000
const MAX_OUTPUT = 1 << 20

// A skill name goes onto a command line as `/<name>`, so it is not allowed to be anything the
// caller feels like. Nothing here takes one from a request today, and the guard is what keeps that
// true after somebody adds an endpoint that does.
const NAMED = /^[a-z0-9][a-z0-9-]{0,63}$/

/**
 * Whether the write-up can happen at all and, if not, why — in a sentence meant for the page
 * rather than for a log. An adapter never pretends, and neither does this: the facts are shown
 * either way, with the missing half explained instead of quietly absent.
 */
export function capability(skill) {
  if (!NAMED.test(String(skill ?? ''))) return { can: false, why: `${skill} is not the name of a skill.` }
  if (!CLAUDE()) {
    return { can: false, why: 'Claude Code is not on this machine, so there is nobody here to write the summary.' }
  }
  if (!fs.existsSync(skillFile(skill))) {
    return { can: false, why: `The ${skill} skill is missing from this copy of k0.` }
  }
  return { can: true, why: null }
}

// One job per key, and the key is whatever the page that asked is waiting on: the ChangeLog's
// window, or What's New in one language at one level. Two pages can be writing at once — they
// were not able to before, and they have to be, because one of them opens on top of the other.
//
// Within a key it is still one at a time: a second window of the same page must not start a
// second model. Each run gets a number, and only the run that is still the current one for its
// key may record anything — otherwise a run abandoned halfway would come back later and
// overwrite the answer somebody is already reading.
const jobs = new Map()
let runs = 0

// A finished job holds its whole page in memory, and a key is a window or a language: leave them
// all in and a tab left open for a week keeps every summary it ever asked for. A Map hands them
// back in the order they were made, so the oldest finished one goes first; anything still running
// stays, whatever else has to.
const MAX_JOBS = 8

/** Room for the job about to be made — one more than is there, unless this key is already held. */
function makeRoom(incoming) {
  const ceiling = jobs.has(incoming) ? MAX_JOBS : MAX_JOBS - 1
  for (const [key, job] of jobs) {
    if (jobs.size <= ceiling) return
    if (!job.running) jobs.delete(key)
  }
}

// Three at a time, and the machine they think on is the user's own — the one they are also trying
// to work on. Two pages open at once is the real case; three is already generous.
const MAX_RUNNING = 3

const running = () => {
  let n = 0
  for (const job of jobs.values()) if (job.running) n++
  return n
}

/**
 * Room for one more model to think in: the oldest run still going gives up its place.
 *
 * Not a summary snatched away from somebody. Two pages write, and each of them watches one key at
 * a time — switching the period on the ChangeLog stops reading the run it started and asks for
 * another, in the same second. So a fourth run means three keys have already been walked away
 * from, and the oldest of them is the one nobody is waiting for.
 *
 * Refusing instead is what the page cannot do anything with, and it is what this used to do: click
 * through Today, Yesterday and Week and the fourth click printed "ask again when one of them is
 * done" to somebody who had only pressed a button. The job is dropped before the child is killed,
 * so its own `close` finds nothing under its key and writes no error over a key that has moved on.
 */
function retireOldest() {
  for (const [key, job] of jobs) {
    if (!job.running) continue
    jobs.delete(key)
    job.child?.kill('SIGTERM')
    return true
  }
  return false
}

// A run that never started, remembered under its key as though it had finished badly. The page
// asks once and then polls, so a refusal nobody wrote down would leave it waiting for ever.
const refuse = (key, why) => {
  jobs.set(key, { id: ++runs, key, running: false, text: null, error: why, child: null })
  return state(key)
}

/**
 * Starts `claude -p /<skill>` for a key, unless that key is already running or already done.
 * The payload goes in on standard input; what comes back is read with `state(key)`.
 *
 * A run belongs to its key and to nothing else: it never touches another key's job, so the
 * ChangeLog cannot cancel What's New by being asked for a second time.
 */
export function run(skill, key, payload) {
  const held = jobs.get(key)
  if (held && (held.running || held.text)) return state(key)
  makeRoom(key)

  const can = capability(skill)
  if (!can.can) return refuse(key, can.why)
  while (running() >= MAX_RUNNING) if (!retireOldest()) break

  const id = ++runs
  const child = spawn(CLAUDE(), ['-p', `/${skill}`, '--output-format', 'text'], {
    cwd: ROOT, // where the project skill lives, whether k0 runs installed or from a checkout
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  jobs.set(key, { id, key, running: true, text: null, error: null, child })

  /** Records the end of THIS run, once. A run that has already ended cannot end again. */
  const finish = (patch) => {
    const mine = jobs.get(key)
    if (mine?.id !== id || !mine.running) return
    jobs.set(key, { ...mine, ...patch, running: false, child: null })
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

/** What the page is waiting for. A key nobody has asked about is simply not running. */
export function state(key) {
  const job = jobs.get(key)
  if (!job) return { running: false, text: null, error: null }
  return { running: !!job.running, text: job.text ?? null, error: job.error ?? null }
}

/** Called on the way out, so a model left mid-sentence does not outlive the server. */
export function stop() {
  for (const job of jobs.values()) if (job.child) job.child.kill('SIGTERM')
  jobs.clear()
}
