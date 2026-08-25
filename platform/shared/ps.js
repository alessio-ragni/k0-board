/**
 * Reading a process table, the parts that are the same everywhere.
 *
 * macOS and Linux both have a `ps` that can be asked for exactly the five fields k0 wants,
 * in exactly that order, so one parser serves both. Windows has no `ps`, but its adapter
 * builds the same shape out of CIM data, which is why the shape and not the command is what
 * lives here.
 */

/**
 * One `ps` line per process: pid, parent, resident memory in KB, CPU time consumed since it
 * was born, and the command — which contains spaces, so it takes everything that is left.
 */
export function parsePs(out) {
  const procs = new Map()
  for (const line of String(out ?? '').split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    if (!m) continue
    procs.set(Number(m[1]), {
      ppid: Number(m[2]),
      rss: Number(m[3]) * 1024,
      cpu: cpuSeconds(m[4]),
      cmd: m[5],
    })
  }
  return procs
}

/**
 * CPU time the way `ps` writes it: `MM:SS.ss` usually, `HH:MM:SS` when it adds up, with a
 * leading `DD-` for processes that have been up for days.
 */
export function cpuSeconds(s) {
  const m = /^(?:(\d+)-)?(\d+):(\d+)(?::(\d+))?(?:\.(\d+))?$/.exec(String(s ?? '').trim())
  if (!m) return 0
  const [, d, a, b, c, frac] = m
  // Three groups means hours:minutes:seconds, two means minutes:seconds.
  const base = c === undefined ? Number(a) * 60 + Number(b) : Number(a) * 3600 + Number(b) * 60 + Number(c)
  return Number(d || 0) * 86400 + base + Number(`0.${frac || 0}`)
}
