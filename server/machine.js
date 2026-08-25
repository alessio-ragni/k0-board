import os from 'node:os'
import { metrics } from '../platform/index.js'

export { parsePs, cpuSeconds } from '../platform/shared/ps.js'

// ── What all of this costs ────────────────────────────────────────────────────
// The only place that looks at the machine's processes and memory. It answers two questions:
// is the computer struggling, and who is making it struggle.
//
// The honest number for "what does this session cost" is not the `claude` process: it is its
// whole subtree. A 200 MB claude can have an MCP server under it with Chrome behind that, and
// a 200 MB `tsc` started from a commit hook. That is where the memory goes, and it is what no
// other tool can attribute to the right card — Activity Monitor has never heard of cards.
//
// Summing the resident memory of a subtree counts shared memory twice between parent and
// children, so the total is a little generous. It is the usual approximation, and it is the
// right one for the question that matters here: which one do I close to feel better.

const TTL = 3000 // how often the sample is retaken, while somebody is watching
const ATTENTION = 15000 // how long a glance counts for before it goes quiet again
const CORES = os.cpus().length

/**
 * Reading the process table costs little on a calm machine and a lot on a struggling one —
 * measured: 30 ms to 360 ms — and struggling is exactly when you look at it. So it does not
 * sit on the one-second loop, and it stops by itself as soon as nobody is looking.
 */
let watching = 0
export function touch() {
  watching = Date.now()
  // On the first glance there is nothing to say yet: read straight away rather than leave the
  // bar empty for the three seconds until the next round.
  if (!snap) cycle()
}

let snap = null // { at, procs, kids, share, cpu, mem, swap, pressure }
let prev = null // { at, cpu: Map<pid, seconds> } — the previous sample, for the differences
let running = false

/** Who descends from whom: the map needed to walk the subtrees. */
export function childrenOf(procs) {
  const kids = new Map()
  for (const [pid, p] of procs) {
    if (p.ppid === pid) continue // does not happen, but a loop here would spin forever
    if (!kids.has(p.ppid)) kids.set(p.ppid, [])
    kids.get(p.ppid).push(pid)
  }
  return kids
}

/** Every pid from `root` down, itself included. With the guard against cycles. */
export function subtree(kids, root, seen = new Set()) {
  if (seen.has(root)) return seen
  seen.add(root)
  for (const k of kids.get(root) ?? []) subtree(kids, k, seen)
  return seen
}

/**
 * The verdict is not ours to invent: on macOS and Linux the kernel publishes its own
 * judgement — 1 normal, 2 warning, 4 critical. One rule is added to it, memory nearly gone,
 * because that is the moment before the kernel notices. Swap deliberately does NOT enter the
 * verdict: on macOS the swap file grows by itself, so "how full is it" does not mean much.
 * How much is in use is read anyway and shown on hover: it is the number that explains the
 * stutters.
 *
 * Where the kernel publishes nothing — Windows — the level is always 1 and the memory rule is
 * the whole verdict.
 */
export function verdict(level, mem) {
  if (level >= 4) return 'bad'
  if (level >= 2 || (mem.total > 0 && mem.used / mem.total >= 0.9)) return 'warn'
  return 'ok'
}

// ── The round ─────────────────────────────────────────────────────────────────
async function cycle() {
  if (running || Date.now() - watching > ATTENTION) return
  running = true
  try {
    const [procs, mem, sw, level] = await Promise.all([
      metrics.processes(),
      metrics.memory(),
      metrics.swap(),
      metrics.pressureLevel(),
    ])
    const at = Date.now()

    // The CPU right now, not the average since the process was born: that second one is what
    // `ps` reports as `%cpu`, and on an old process it says nothing about this minute. Here we
    // look at how much CPU time passed between two samples.
    const seconds = prev ? (at - prev.at) / 1000 : 0
    const share = new Map()
    let busy = 0
    if (seconds > 0.2) {
      for (const [pid, p] of procs) {
        const was = prev.cpu.get(pid)
        if (was === undefined) continue // born after the last sample: it has no before
        const used = Math.max(0, p.cpu - was) / seconds
        share.set(pid, used)
        busy += used
      }
    }

    prev = { at, cpu: new Map([...procs].map(([pid, p]) => [pid, p.cpu])) }
    snap = {
      at,
      procs,
      kids: childrenOf(procs),
      share,
      // Without a previous sample the CPU is not known yet: better to say so than invent it.
      cpu: seconds > 0.2 ? Math.min(1, busy / CORES) : null,
      mem,
      swap: sw,
      pressure: verdict(level, mem),
    }
  } catch {
    /* one bad reading does not switch off what was already known */
  } finally {
    running = false
  }
}
setInterval(cycle, TTL).unref()

// ── What is known right now ───────────────────────────────────────────────────
/**
 * What a session weighs: its whole subtree. `top` is the three biggest processes inside it,
 * and that is the answer to "why is this terminal eating so much".
 */
export function loadOf(pid) {
  if (!snap || !pid || !snap.procs.has(pid)) return null
  const pids = subtree(snap.kids, pid)
  let rss = 0
  let cpu = 0
  // By name, not by process: Chrome opens ten of them and seeing them listed one by one says
  // nothing, while "Google Chrome 562 MB" says everything.
  const byName = new Map()
  for (const p of pids) {
    const proc = snap.procs.get(p)
    if (!proc) continue
    rss += proc.rss
    cpu += snap.share.get(p) ?? 0
    const name = shortName(proc.cmd)
    byName.set(name, (byName.get(name) ?? 0) + proc.rss)
  }
  return { rss, cpu: snap.cpu === null ? null : cpu / CORES, procs: pids.size, top: heaviest(byName) }
}

/**
 * How the machine is doing, and what is taking it up that is not a k0 session. `others` exists
 * so k0 does not take blame that belongs to Chrome: with swap full, the sessions on their own
 * often explain nothing.
 */
export function overview(sessionPids = []) {
  if (!snap) return null
  const mine = new Set()
  for (const pid of sessionPids) if (snap.procs.has(pid)) for (const p of subtree(snap.kids, pid)) mine.add(p)

  const byName = new Map()
  for (const [pid, proc] of snap.procs) {
    if (mine.has(pid)) continue
    const name = shortName(proc.cmd)
    byName.set(name, (byName.get(name) ?? 0) + proc.rss)
  }

  return {
    cpu: snap.cpu,
    mem: snap.mem,
    swap: snap.swap,
    pressure: snap.pressure,
    others: heaviest(byName),
    at: snap.at,
  }
}

/** The three heaviest names, biggest first. */
const heaviest = (byName) =>
  [...byName]
    .map(([name, rss]) => ({ name, rss }))
    .sort((a, b) => b.rss - a.rss)
    .slice(0, 3)

/**
 * A name worth showing, worked out from the command line. macOS applications first, which
 * carry their real name in the bundle path — and it is also the only way to get them right,
 * given that "Google Chrome" has a space in it. Then the interpreters, which on their own
 * would only ever say "node": there, the name is the script they are running.
 */
export function shortName(cmd) {
  const app = /\/([^/]+)\.app\//.exec(cmd)
  if (app) return app[1]

  const argv = String(cmd ?? '').trim().split(/\s+/)
  const base = (s) => (s || '').split(/[/\\]/).pop()
  const first = base(argv[0]).replace(/\.exe$/i, '')
  if (!RUNNERS.has(first)) return first || 'unknown'

  // `npm exec chrome-devtools-mcp@latest --flag` → chrome-devtools-mcp
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-') || VERBS.has(arg)) continue
    const name = base(arg).replace(/@[^@]*$/, '')
    // Only if it looks like a program name: behind `node -e` there is code, and a fragment of
    // code as a name would be worse than "node".
    return /^[\w.@-]+$/.test(name) ? name : first
  }
  return first
}

const RUNNERS = new Set([
  'node', 'npm', 'npx', 'python', 'python3', 'ruby', 'sh', 'bash', 'zsh', 'deno', 'bun',
  'powershell', 'pwsh', 'cmd',
])
const VERBS = new Set(['exec', 'run', 'run-script', '-c', 'start', 'test'])
