import fs from 'node:fs'
import { lsofListeners, ssListeners, LSOF, stop, shell } from '../shared/servers.js'
import { which } from '../shared/run.js'

/**
 * Dev servers on Linux.
 *
 * Two differences from macOS. Listening sockets can come from `ss` as well as from `lsof`, and
 * `ss` is the one a minimal system is likelier to have — it arrives with iproute2, where lsof
 * arrives with nothing. And the working directory of a process is a symlink in /proc, which is
 * both cheaper than lsof and always there, so adoption works even where neither tool is.
 */
const hasSs = () => !!which('ss', ['/usr/sbin/ss', '/usr/bin/ss', '/sbin/ss'])

export const capabilities = () => ({
  run: true,
  ports: !!LSOF() || hasSs(),
  // /proc is what makes this true, and it is what a container without it makes false.
  adopt: fs.existsSync('/proc/self/cwd'),
})

/** lsof first when it is there — it answers both questions in the same shape as macOS. */
export async function listeners() {
  if (LSOF()) return lsofListeners()
  return ssListeners()
}

/** One readlink each. A process that ends mid-loop is skipped, not an error. */
export async function cwds(pids) {
  const out = new Map()
  for (const pid of pids) {
    try {
      out.set(pid, fs.readlinkSync(`/proc/${pid}/cwd`))
    } catch {
      /* gone, or not ours to look at */
    }
  }
  return out
}

export { stop, shell }
