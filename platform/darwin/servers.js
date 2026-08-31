import { lsofListeners, lsofCwds, LSOF, stop, shell } from '../shared/servers.js'

/**
 * Dev servers on macOS. Everything comes out of one `lsof`, which ships with the system, so
 * there is nothing to install and nothing that can be missing — but the capability is still
 * probed rather than declared, because a machine with a locked-down /usr/sbin is a machine
 * where the globe has to say so instead of showing every server as off.
 */
export const capabilities = () => {
  const has = !!LSOF()
  return { run: true, ports: has, adopt: has }
}

export const listeners = lsofListeners
export const cwds = lsofCwds
export { stop, shell }
