import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { which } from '../shared/run.js'

/**
 * Keeping a Linux machine awake.
 *
 * The equivalent of `caffeinate` is `systemd-inhibit`, which holds a lock for as long as the
 * command it runs is alive — so k0 runs a `sleep infinity` under it and kills that when the
 * mode changes. Same shape as macOS, different lever.
 *
 * What is NOT here is the lid. On macOS a single system flag covers it; on Linux the lid is
 * handled by logind, and changing it means editing /etc/systemd/logind.conf as root and
 * reloading the daemon — a machine-wide setting that outlives k0 and that k0 has no business
 * rewriting behind your back. So `lidSleep` is reported as unavailable, with a note that says
 * what to change if you want it. Better a switch that is visibly off than one that lies.
 */

const SYSTEMD_INHIBIT = () => which('systemd-inhibit')
const GNOME_INHIBIT = () => which('gnome-session-inhibit')

const SUPPLY = '/sys/class/power_supply'

let children = []
let activeLevel = null

/**
 * Power source and charge, straight from sysfs. `AC`/`ADP*` entries report whether the mains
 * are connected; `BAT*` entries report capacity. No battery at all means a desktop, and a
 * desktop should never trip a battery threshold — hence `charge: null` rather than 100.
 */
export function readPowerSupply(dir = SUPPLY) {
  let onAcPower = null
  let charge = null
  let entries = []
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return { onAcPower: true, charge: null }
  }
  for (const name of entries) {
    const read = (file) => {
      try {
        return fs.readFileSync(path.join(dir, name, file), 'utf8').trim()
      } catch {
        return ''
      }
    }
    const type = read('type')
    if (type === 'Mains') {
      if (read('online') === '1') onAcPower = true
      else if (onAcPower === null) onAcPower = false
    } else if (type === 'Battery') {
      const capacity = Number(read('capacity'))
      if (Number.isFinite(capacity) && read('capacity') !== '') charge = capacity
    }
  }
  return { onAcPower: onAcPower === null ? true : onAcPower, charge }
}

export async function state() {
  return readPowerSupply()
}

function startInhibitor(bin, args) {
  const child = spawn(bin, args, { stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
  children.push(child)
}

export function inhibit(level) {
  if (activeLevel === level) return
  release()
  if (!level) return
  activeLevel = level

  const systemd = SYSTEMD_INHIBIT()
  if (systemd) {
    startInhibitor(systemd, [
      '--what=idle:sleep',
      '--who=k0',
      '--why=A Claude Code session is running',
      '--mode=block',
      'sleep',
      'infinity',
    ])
  }
  // Stopping the *screen* from going dark is a desktop-environment matter, not a logind one.
  // gnome-session-inhibit covers GNOME, which is the common case; elsewhere the display may
  // still blank, and `capabilities` says so.
  if (level === 'display') {
    const gnome = GNOME_INHIBIT()
    if (gnome) startInhibitor(gnome, ['--inhibit', 'idle', '--reason', 'k0 driving mode', 'sleep', 'infinity'])
  }
}

export function release() {
  activeLevel = null
  for (const child of children) {
    try {
      child.kill()
    } catch {
      /* already gone */
    }
  }
  children = []
}

/** Not ours to change: see the note at the top of this file. */
export async function setLidSleepBlocked() {}

export async function lidSleepBlocked() {
  return false
}

export function releaseSync() {
  release()
}

export const capabilities = () => ({
  keepAwake: !!SYSTEMD_INHIBIT(),
  keepDisplayAwake: !!GNOME_INHIBIT(),
  lidSleep: false,
  battery: fs.existsSync(SUPPLY),
})

export const notes = {
  'power.lidSleep':
    'On Linux the lid is handled by logind. To keep working with the lid closed, set ' +
    'HandleLidSwitch=ignore in /etc/systemd/logind.conf and reload logind. k0 will not ' +
    'change a machine-wide setting for you.',
  'power.keepDisplayAwake':
    'Keeping the screen on needs a desktop-level inhibitor. k0 uses gnome-session-inhibit ' +
    'where it exists; on other desktops the display may still blank.',
}
