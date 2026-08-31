import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { servers as os, capabilities } from '../platform/index.js'
import { alive } from '../platform/shared/run.js'
import { LOG_DIR, ensureDirs } from './paths.js'
import * as db from './db.js'
import { tree, subtree } from './machine.js'

export { parseListeners, parseCwds, parseSs, parseNetTcp, portOf } from '../platform/shared/listeners.js'

// ── The dev server a project runs while you work on it ────────────────────────
// The globe in a column heading. It answers one question — is this repository's server up, and
// on what — and takes one instruction: turn it on, turn it off, turn it over.
//
// Three things make it different from everything else k0 starts.
//
// It OUTLIVES THE SESSION. The old way round was a skill in each repository that ran `npm run
// dev` as a background task inside a Claude Code session, and a background task belongs to its
// session: close the session and the server goes with it. Here the process is detached, owned by
// nobody, and it survives k0 restarting as readily as it survives a session closing. That is the
// whole point of the feature, and it is why this module is deliberately absent from the shutdown
// handlers in index.js.
//
// It is NEVER ASKED whether it is up. k0 makes no network requests — the rule is in CLAUDE.md and
// it is not negotiable — so "up" is not a 200 to a request nobody should be making. It is: the
// process is alive AND the operating system says it is holding a TCP port open. That is stronger
// evidence anyway. A server that has bound its port but is still compiling answers a request with
// an error and this test with the truth.
//
// And it is HONEST ABOUT WHAT IT DID NOT START. A server somebody started by hand in a terminal
// is recognised, shown green and governed like the rest, because a globe that only knew about its
// own servers would be grey next to a site that is plainly running. Where a platform cannot tell
// whose repository an outside process belongs to — Windows — the interface says so rather than
// drawing it as off.

/** How long a server gets to open a port before k0 stops calling it "starting". */
const GRACE = 90_000

/** Ports the kernel hands out for outgoing connections: never what a dev server was asked for. */
const EPHEMERAL = 49152

/** How long a reading of the machine's sockets stays good for. The globe is not a stopwatch. */
const TTL = 4000

/** How long a glance at the board counts for before the sampling goes quiet again. */
const ATTENTION = 15000

/** How far up a process's ancestry to look for the top of a dev server. */
const MAX_DEPTH = 12

// ── Deciding whether a repository has a server at all ─────────────────────────

/**
 * Which script starts this project, out of its package.json.
 *
 * `start` is deliberately not in the list. By convention it runs what has been BUILT, which is
 * not what a globe on a working board means — and there is a concrete trap behind the
 * convention: k0's own package.json has only `start`, so accepting it would put a globe on k0
 * that tried to launch a second k0 on a port the first one is already holding.
 *
 * The command is always `npm run <script>` and never the script's own text. Scripts chain
 * (`velite && node scripts/build-posts-index.mjs && vite`) and rely on node_modules/.bin being
 * on PATH, which is something only `npm run` arranges.
 */
export function detectCommand(pkg) {
  const scripts = pkg && typeof pkg === 'object' ? pkg.scripts : null
  if (!scripts || typeof scripts !== 'object') return null
  for (const script of ['dev', 'serve']) {
    if (typeof scripts[script] === 'string' && scripts[script].trim()) {
      return { script, command: `npm run ${script}` }
    }
  }
  return null
}

// Reading a package.json is cheap, but board() asks about every repository every second and
// there is no reason to pay for it that often. A repository that grows a `dev` script waits at
// most this long for its globe.
const DETECT_TTL = 30_000
const detected = new Map() // path -> { at, command }

export function commandFor(repo) {
  const hit = detected.get(repo)
  if (hit && Date.now() - hit.at < DETECT_TTL) return hit.command
  let command = null
  try {
    command = detectCommand(JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')))
  } catch {
    // No package.json, or one that is being written to right now. Either way: no globe, and
    // the next glance will ask again.
  }
  detected.set(repo, { at: Date.now(), command })
  return command
}

// ── The pure decisions ───────────────────────────────────────────────────────

/**
 * Which port to show, out of everything a server's processes hold open. The lowest wins: a
 * framework that opens a second socket opens it above the one it was asked for. Ports the
 * kernel handed out for outgoing connections are not offers and are dropped.
 */
export function pickPort(ports) {
  const usable = [...(ports ?? [])].filter((p) => p > 0 && p < EPHEMERAL).sort((a, b) => a - b)
  return usable[0] ?? null
}

export const urlFor = (port) => (port ? `http://localhost:${port}` : null)

/**
 * The four states, from facts only.
 *
 *   off       nothing is running, and nothing tried
 *   starting  a process is alive but has not opened a port yet, and is still within its grace
 *   up        a process is alive and holding a port
 *   failed    it was started and it is not up: either the process is gone, or the grace ran out
 *
 * The row in the database is what separates "we stopped it" from "it died": stopping deletes
 * the row, so a row whose process is gone is a server that fell over.
 */
export function phaseOf({ running, port, startedAt, now = Date.now(), sampled = true }) {
  if (!running) return 'off'
  if (port) return 'up'
  // Nothing has been read off the machine yet — the first glance after k0 itself restarted, say,
  // with a dev server that has been up for hours. "We do not know" wears the same face as
  // "coming up", because a red globe on no evidence at all is an accusation, not a report.
  if (!sampled) return 'starting'
  return now - (startedAt ?? now) > GRACE ? 'failed' : 'starting'
}

/** Where a repository's output goes. Two repositories never share a file, whatever they are called. */
export function logPathFor(repo) {
  const short = crypto.createHash('sha1').update(String(repo)).digest('hex').slice(0, 8)
  const name = path.basename(String(repo)).replace(/[^a-zA-Z0-9._-]/g, '-') || 'repo'
  return path.join(LOG_DIR, `dev-${name}-${short}.log`)
}

/** Is `dir` the repository, or inside it? Compared as paths, so `/a/bc` is not inside `/a/b`. */
export function isInside(dir, repo) {
  if (!dir || !repo) return false
  if (dir === repo) return true
  return dir.startsWith(repo.endsWith(path.sep) ? repo : repo + path.sep)
}

/** The last thing the log has to say, which is what a failure owes the person looking at it. */
export function lastLine(text, limit = 200) {
  const lines = String(text ?? '')
    .split('\n')
    .map((l) => l.replace(/\[[0-9;]*m/g, '').trim()) // colour codes say nothing in a tooltip
    .filter(Boolean)
  const line = lines[lines.length - 1] ?? ''
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

/** The tail of a log file without reading the whole thing: a dev server writes a lot. */
function logTail(file, bytes = 4096) {
  try {
    const { size } = fs.statSync(file)
    const from = Math.max(0, size - bytes)
    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(Math.min(bytes, size - from))
      fs.readSync(fd, buf, 0, buf.length, from)
      return buf.toString('utf8')
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return ''
  }
}

// ── Reading the machine ──────────────────────────────────────────────────────
// The same discipline machine.js already lives by, and for the same reason: asking the whole
// system who is listening costs real time on a busy laptop, and a board nobody is looking at
// has nothing to ask for.

let watching = 0
let watched = [] // the repositories currently on the board
let snap = null // { at, byRepo: Map<path, {root, pids, port}> }
// The reading in flight, if there is one. A second asker WAITS for it rather than skipping: the
// obvious version of this — a boolean, and return early if it is set — would let `stop` sail past
// a reading that had not finished and go on to signal whatever the last one happened to say.
let sampling = null

/** Somebody is looking at the board, and at these repositories. */
export function touch(repos = []) {
  watching = Date.now()
  watched = repos
  if (!snap) cycle()
}

/**
 * Every process between `pid` and the top, itself included. It stops at k0's own process for
 * the same reason it stops at init: whatever is above there is not part of a dev server.
 */
function ancestry(procs, pid) {
  const chain = []
  let cur = pid
  for (let i = 0; i < MAX_DEPTH && cur > 1 && cur !== process.pid; i++) {
    chain.push(cur)
    const parent = procs.get(cur)?.ppid
    if (!parent || parent === cur) break
    cur = parent
  }
  return chain
}

/** The reading itself, with no regard for whether anybody asked. `cycle` is the polite one. */
function sample() {
  if (!sampling) {
    sampling = read().finally(() => {
      sampling = null
    })
  }
  return sampling
}

async function read() {
  try {
    const ports = capabilities.servers.ports ? await os.listeners() : new Map()
    const t = tree()
    const procs = t?.procs ?? new Map()
    const kids = t?.kids ?? new Map()

    // k0 itself listens on a port and works from a directory that may well be a repository on
    // this board. It is not a dev server and it is certainly not one to offer to kill.
    const mine = procs.size ? subtree(kids, process.pid) : new Set([process.pid])

    const byRepo = new Map()

    // Servers k0 started: the root is known, so the only question is which of its children got
    // the port.
    //
    // Except that a remembered pid is only a number, and the operating system hands numbers out
    // again. A row written before a reboot can point at somebody else's process entirely — and
    // this is the map that `stop` later kills by, so guessing here would be a way to kill the
    // wrong thing. Where the process table can be read, the command it was started with has to
    // still be the command it is running.
    for (const row of db.listDevServers()) {
      if (!alive(row.pid)) continue
      if (procs.size && !(procs.get(row.pid)?.cmd ?? '').includes(row.command)) continue
      const pids = procs.has(row.pid) ? [...subtree(kids, row.pid)] : [row.pid]
      const held = new Set()
      for (const pid of pids) for (const port of ports.get(pid) ?? []) held.add(port)
      byRepo.set(row.project_path, { root: row.pid, pids, port: pickPort(held), adopted: false })
    }

    // And the ones somebody started by hand. The listening process's own working directory is
    // what ties it to a repository — `vite` and `next` both inherit it from the `npm run` that
    // started them — and the top of the server is the highest ancestor still working from
    // inside that same repository.
    const strays = [...ports.keys()].filter((pid) => !mine.has(pid))
    const unclaimed = watched.filter((repo) => !byRepo.has(repo))
    if (capabilities.servers.adopt && strays.length && unclaimed.length) {
      const chains = new Map(strays.map((pid) => [pid, ancestry(procs, pid)]))
      const cwds = await os.cwds([...new Set([...chains.values()].flat())])
      for (const repo of unclaimed) {
        let best = null
        for (const pid of strays) {
          if (!isInside(cwds.get(pid), repo)) continue
          const port = pickPort(ports.get(pid))
          if (port === null) continue
          if (best && best.port <= port) continue
          const chain = chains.get(pid) ?? [pid]
          // The highest ancestor still inside the repository is the `npm run` that was typed,
          // and stopping that is what stops the whole thing.
          const root = [...chain].reverse().find((p) => isInside(cwds.get(p), repo)) ?? pid
          best = { root, pids: procs.size ? [...subtree(kids, root)] : chain, port, adopted: true }
        }
        if (best) byRepo.set(repo, best)
      }
    }

    snap = { at: Date.now(), byRepo }
  } catch {
    /* one bad reading does not throw away what was already known */
  }
}

/** A reading, but only while somebody is looking. See machine.js, which lives by the same rule. */
async function cycle() {
  if (Date.now() - watching > ATTENTION) return
  await sample()
}

setInterval(cycle, TTL).unref()

// ── What the board is told ───────────────────────────────────────────────────

/**
 * Everything the globe needs for one repository, or null when this repository has no way to
 * start a server and should not have a globe at all.
 */
export function stateOf(repo) {
  const command = commandFor(repo)
  if (!command) return null

  const found = snap?.byRepo.get(repo) ?? null
  const row = db.getDevServer(repo)
  // A row whose process is gone is a server that fell over: stopping it would have removed the
  // row. Without a row and without a sighting there is simply nothing running.
  const up = !!found || (!!row && alive(row.pid))
  const port = found?.port ?? null
  const phase = phaseOf({ running: up, port, startedAt: row?.started_at, sampled: !!snap })

  const state = {
    state: phase,
    port,
    url: urlFor(port),
    command: row?.command ?? command.command,
    script: command.script,
    adopted: !!found?.adopted,
    pid: found?.root ?? row?.pid ?? null,
    log: logPathFor(repo),
    error: null,
    // What this machine can do about it, so the interface greys out rather than pretends.
    can: { run: capabilities.servers.run, ports: capabilities.servers.ports, adopt: capabilities.servers.adopt },
  }
  if (phase === 'failed') state.error = lastLine(logTail(state.log))
  return state
}

// ── Turning it on and off ────────────────────────────────────────────────────

/**
 * Start the project's dev server, detached.
 *
 * `detached` is what gives the process a group of its own, which is both how it survives k0 and
 * how stopping it can take its children with it. `unref` is what lets k0 exit while it runs. The
 * output goes to a file rather than to a pipe nobody is reading: a pipe with a full buffer and
 * no reader stops the writer, which would hang the server the moment it got chatty.
 */
export async function start(repo) {
  if (!capabilities.servers.run) throw new Error('k0 cannot start dev servers on this machine.')
  const command = commandFor(repo)
  if (!command) throw new Error('This repository has no `dev` or `serve` script to run.')
  if (!fs.existsSync(repo)) throw new Error('That directory is not there any more.')

  const existing = stateOf(repo)
  if (existing && (existing.state === 'up' || existing.state === 'starting')) return existing

  ensureDirs()
  const log = logPathFor(repo)
  // Truncated, not appended: what matters is why THIS run failed, not the ten before it.
  const fd = fs.openSync(log, 'w')
  try {
    fs.writeSync(fd, `$ ${command.command}\n  in ${repo}\n  at ${new Date().toISOString()}\n\n`)
    const { file, args } = os.shell(command.command)
    const child = spawn(file, args, {
      cwd: repo,
      detached: true,
      stdio: ['ignore', fd, fd],
      windowsHide: true,
    })
    child.unref()
    // A spawn that fails does so asynchronously, and there is no one left to hear it: the log
    // is where the reason goes, and `stateOf` reads it back out when the globe turns red.
    child.on('error', (err) => {
      try {
        fs.appendFileSync(log, `\nk0 could not start it: ${err.message}\n`)
      } catch {
        /* the log is a courtesy, not a contract */
      }
    })
    db.setDevServer(repo, { pid: child.pid, command: command.command, startedAt: Date.now() })
  } finally {
    fs.closeSync(fd)
  }
  // The next reading will find the port; until then the globe spins, which is the truth.
  snap = null
  touch(watched.includes(repo) ? watched : [...watched, repo])
  return stateOf(repo)
}

/**
 * Stop it, and everything it started. SIGTERM first — a dev server given the chance will clean
 * up after itself — then SIGKILL for whatever is still standing, on the same three-second
 * patience `terminal.close` already uses.
 */
export async function stop(repo) {
  // Read the machine FIRST, and kill only what that reading found. The stored pid on its own is
  // not enough to act on: it is a number the operating system is free to hand out again, and
  // acting on a stale one would mean killing whatever now happens to wear it. The sample checks
  // that the process is still running the command it was started with — see the guard in
  // `sample` — so by the time anything is signalled here, it has been identified twice.
  watching = Date.now()
  if (!watched.includes(repo)) watched = [...watched, repo]
  await sample()
  const found = snap?.byRepo.get(repo) ?? null

  // The row goes unconditionally: it is what says "k0 started this and it is meant to be
  // running", and leaving it behind would turn a stop into a failure the next time anybody
  // looked at the globe.
  db.clearDevServer(repo)
  if (!found) {
    snap = null
    return stateOf(repo)
  }

  await os.stop(found.root, found.pids, 'SIGTERM')
  // The same three seconds of patience `terminal.close` gives a session: long enough for a dev
  // server to put its own things away, short enough that nobody thinks the click was missed.
  const deadline = Date.now() + 3000
  while (Date.now() < deadline && alive(found.root)) await new Promise((r) => setTimeout(r, 150))
  if (alive(found.root)) await os.stop(found.root, found.pids, 'SIGKILL')
  snap = null
  await sample()
  return stateOf(repo)
}

/** Off, then on. There is no third way to restart a process that does not know it can be. */
export async function restart(repo) {
  await stop(repo)
  return start(repo)
}

/** For the tests, which must not inherit a previous file's sampling. */
export function forget() {
  snap = null
  watching = 0
  watched = []
  detected.clear()
}
