/**
 * Dev servers, the parts that are the same on macOS and Linux.
 *
 * Both have `lsof`, both have a `ps` that knows about process groups, and both signal a whole
 * group by signalling a negative pid. What they do not share is how to ask where a process is
 * working from — macOS goes through lsof, Linux reads a symlink — so that one stays with each
 * adapter and only the rest is here.
 */

import { runQuiet, which, alive } from './run.js'
import { parseListeners, parseCwds, parseSs } from './listeners.js'

export const LSOF = () => which('lsof', ['/usr/sbin/lsof', '/usr/bin/lsof'])
const SS = () => which('ss', ['/usr/sbin/ss', '/usr/bin/ss', '/sbin/ss'])
const PS = () => which('ps', ['/bin/ps', '/usr/bin/ps'])

// Asking the whole machine who is listening is not free — measured in the hundreds of
// milliseconds on a busy laptop — so the caller is expected to do it rarely. See the sampling
// discipline in server/servers.js, which is the one machine.js already lives by.
const TIMEOUT = 8000

/**
 * How to run a project's own command. A LOGIN shell, so that a version manager's PATH and the
 * project's own `.nvmrc` are in force — under a launch agent the inherited PATH is barely more
 * than /usr/bin:/bin, and `npm` would simply not be found. It is the same reason `findClaude`
 * ends up asking a shell.
 */
export const shell = (command) => ({
  file: process.env.SHELL || '/bin/sh',
  args: ['-lc', command],
})

/** Everything holding a TCP port open, from lsof. */
export async function lsofListeners() {
  const bin = LSOF()
  if (!bin) return new Map()
  return parseListeners(await runQuiet(bin, ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn'], { timeout: TIMEOUT }))
}

/** The same, from iproute2 — which a minimal Linux has when it has no lsof. */
export async function ssListeners() {
  const bin = SS()
  if (!bin) return new Map()
  return parseSs(await runQuiet(bin, ['-H', '-l', '-t', '-n', '-p'], { timeout: TIMEOUT }))
}

/** Where each of these processes is working from, from lsof. */
export async function lsofCwds(pids) {
  const bin = LSOF()
  if (!bin || !pids.length) return new Map()
  return parseCwds(await runQuiet(bin, ['-a', '-d', 'cwd', '-p', pids.join(','), '-F', 'n'], { timeout: TIMEOUT }))
}

/**
 * The process group a pid belongs to. Empty when the process is already gone, which is not an
 * error: it is the answer.
 */
export async function pgidOf(pid) {
  const bin = PS()
  if (!bin || !pid) return null
  const pgid = Number(String(await runQuiet(bin, ['-o', 'pgid=', '-p', String(pid)])).trim())
  return Number.isInteger(pgid) && pgid > 1 ? pgid : null
}

/**
 * Stop a dev server and everything it started.
 *
 * Signalling the group rather than the process is the whole point. `npm run dev` is a shell
 * that spawns `vite`, and a SIGTERM to npm alone leaves vite holding the port — which is
 * precisely what the old per-repo skill was working around with `pkill -f "astro dev"`.
 *
 * But the group is only signalled when `root` is the group's LEADER, and that restraint is not
 * pedantry. A server k0 started is `detached`, so it leads its own group and the fast path is
 * always taken. A server somebody started by hand is a different matter: under job control its
 * group leader is the npm it was typed as, but in a script, or under a shell with job control
 * off, the group can be the SHELL's — and signalling that would close the user's terminal to
 * stop a dev server. So when `root` does not lead the group, the pids are signalled one by one
 * instead, children before parents, which is slower and cannot take anything with it that the
 * caller did not name.
 *
 * @param {number} root  the topmost process of the server
 * @param {number[]} pids  every process under it, `root` included — see `subtree` in machine.js
 * @param {'SIGTERM'|'SIGKILL'} signal
 */
export async function stop(root, pids, signal = 'SIGTERM') {
  if (!root) return false
  const pgid = await pgidOf(root)
  if (pgid === root) {
    try {
      process.kill(-pgid, signal)
      return true
    } catch {
      // Already gone between the question and the signal. Fall through: the loop below is
      // harmless on a dead process and is what answers honestly.
    }
  }
  let touched = false
  // Youngest first — a higher pid is a later process, which in a tree grown in one go is the
  // child. It is a tendency and not a guarantee, but the order only decides who sees its parent
  // disappear first, and SIGTERM reaches all of them either way.
  for (const pid of [...new Set([...pids, root])].sort((a, b) => b - a)) {
    if (!alive(pid)) continue
    try {
      process.kill(pid, signal)
      touched = true
    } catch {
      /* it went on its own between the check and the signal */
    }
  }
  return touched
}
