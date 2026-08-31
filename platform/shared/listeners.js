/**
 * Who is listening on which port, and where a process is working from.
 *
 * These are the two questions behind the globe in the column headings: a dev server is up if
 * something it started holds a TCP port open, and a dev server somebody started by hand belongs
 * to a repository if it is working from inside it.
 *
 * macOS and Linux answer both with the same `lsof`, in its field format, so one parser serves
 * both — the same arrangement `ps.js` already has for the process table. Windows answers the
 * first with PowerShell and cannot answer the second at all, which is exactly why the shape and
 * not the command is what lives here.
 *
 * Nothing in this file opens a socket. It asks the operating system who is already holding one,
 * which is both stronger evidence than a reply to a request and the only reading of "is it up"
 * that k0 is allowed to take — see the rule about network requests in CLAUDE.md.
 */

/**
 * lsof's field format is a stream of sets: `p<pid>` opens a process and every line after it
 * belongs to that process until the next `p`. lsof emits `f<fd>` lines whether they were asked
 * for or not, so anything that is not the field being read is stepped over rather than parsed.
 *
 * @param {string} out
 * @param {string} field  the one-letter field to collect, `n` for both callers here
 * @param {(pid: number, value: string) => void} take
 */
function eachField(out, field, take) {
  let pid = null
  for (const line of String(out ?? '').split('\n')) {
    if (line[0] === 'p') {
      const n = Number(line.slice(1))
      pid = Number.isInteger(n) && n > 0 ? n : null
    } else if (line[0] === field && pid !== null) {
      take(pid, line.slice(1))
    }
  }
}

/**
 * The port out of an address as lsof writes it: `*:4321`, `127.0.0.1:4321`, `[::1]:4321`.
 * The last colon is the separator in all three, which is what makes IPv6 harmless here.
 */
export function portOf(address) {
  const at = String(address ?? '').lastIndexOf(':')
  if (at < 0) return null
  const tail = address.slice(at + 1)
  if (!/^\d+$/.test(tail)) return null
  const port = Number(tail)
  return port > 0 && port < 65536 ? port : null
}

/**
 * `lsof -nP -iTCP -sTCP:LISTEN -F pn` as a map of pid to the ports it holds open.
 * A process listening on both IPv4 and IPv6 shows the same port twice; the set folds them.
 */
export function parseListeners(out) {
  const ports = new Map()
  eachField(out, 'n', (pid, address) => {
    const port = portOf(address)
    if (port === null) return
    if (!ports.has(pid)) ports.set(pid, new Set())
    ports.get(pid).add(port)
  })
  return ports
}

/**
 * `lsof -a -d cwd -p 1,2,3 -F n` as a map of pid to the directory it is working from.
 * A process has exactly one, so the first answer for a pid is the answer.
 */
export function parseCwds(out) {
  const cwds = new Map()
  eachField(out, 'n', (pid, dir) => {
    if (!cwds.has(pid) && dir) cwds.set(pid, dir)
  })
  return cwds
}

/**
 * `ss -H -ltnp`, the answer on a Linux that has no lsof — which is most minimal ones, since
 * `ss` comes with iproute2 and lsof does not come with anything.
 *
 *     LISTEN 0 511 *:4321 *:* users:(("node",pid=1234,fd=20))
 *
 * The listening address is the fourth column and the pids are in the tail, one process per
 * `pid=`: a socket can be shared by a parent and its children, and then all of them own it.
 */
export function parseSs(out) {
  const ports = new Map()
  for (const line of String(out ?? '').split('\n')) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 4) continue
    const port = portOf(cols[3])
    if (port === null) continue
    for (const m of line.matchAll(/pid=(\d+)/g)) {
      const pid = Number(m[1])
      if (!pid) continue
      if (!ports.has(pid)) ports.set(pid, new Set())
      ports.get(pid).add(port)
    }
  }
  return ports
}

/**
 * `Get-NetTCPConnection -State Listen` piped through `ConvertTo-Csv`, which is how Windows
 * answers the same question. Two columns, `LocalPort` and `OwningProcess`, in that order.
 */
export function parseNetTcp(out) {
  const ports = new Map()
  for (const line of String(out ?? '').split('\n')) {
    const m = /^"?(\d+)"?\s*,\s*"?(\d+)"?\s*$/.exec(line.trim())
    if (!m) continue
    const port = Number(m[1])
    const pid = Number(m[2])
    if (!pid || port <= 0 || port >= 65536) continue
    if (!ports.has(pid)) ports.set(pid, new Set())
    ports.get(pid).add(port)
  }
  return ports
}
