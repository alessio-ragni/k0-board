import { spawn } from 'node:child_process'
import { run, runSyncQuiet, which } from '../shared/run.js'

/**
 * Keeping a Mac awake.
 *
 * There are two levers here, and `caffeinate` alone is not enough: its assertions are all
 * *idle* assertions. They stop sleep from inactivity but not the sleep that fires when the
 * lid closes, which is forced and goes straight past them. Only the system flag
 * `SleepDisabled` stops that one, and it wants root — see the installer, which grants that
 * one command and nothing else.
 */

const SUDO = () => which('sudo', ['/usr/bin/sudo'])
const PMSET = () => which('pmset', ['/usr/bin/pmset'])
const CAFFEINATE = () => which('caffeinate', ['/usr/bin/caffeinate'])

/** `-i` is idle sleep, `-m` the disk, `-d` the display. The `-d` is the whole difference. */
const FLAGS = { system: '-im', display: '-dim' }

let child = null // the `caffeinate` child, when there is one
let activeLevel = null // which level it was started with: changing mode means redoing it

/**
 * `SleepDisabled` inside the output of `pmset -g`. When it is zero the line can be missing
 * altogether, so "I did not find it" and "it is 0" are the same answer.
 */
export function parseSleepDisabled(out) {
  const m = /^\s*SleepDisabled\s+(\d+)/m.exec(String(out ?? ''))
  return !!m && m[1] !== '0'
}

/**
 * Where the power comes from and how much charge is left, from `pmset -g batt`. A desktop
 * has no battery: charge comes back `null`, and no threshold should fire for it.
 */
export function parseBattery(out) {
  const text = String(out ?? '')
  const charge = /(\d+)%/.exec(text)
  return {
    onAcPower: !/battery power/i.test(text),
    charge: charge ? Number(charge[1]) : null,
  }
}

export async function state() {
  try {
    const stdout = await run(PMSET(), ['-g', 'batt'])
    return parseBattery(stdout)
  } catch {
    // If we cannot ask, assume the case that does no harm: plugged in, no threshold to trip.
    return { onAcPower: true, charge: null }
  }
}

/**
 * The `caffeinate` for this level. Changing mode changes the flags, and a running process
 * cannot have its flags changed: it gets killed and remade. The `-w <our pid>` is the first
 * safety net — it stops by itself when the server dies, even if the server is killed
 * outright and never gets to switch anything off.
 */
export function inhibit(level) {
  if (child && activeLevel === level) return
  release()
  if (!level) return
  const flag = FLAGS[level]
  if (!flag) return
  const spawned = spawn(CAFFEINATE(), [flag, '-w', String(process.pid)], { stdio: 'ignore' })
  child = spawned
  activeLevel = level
  // Comparing against `spawned` is not pedantry: the `exit` of the KILLED process arrives
  // AFTER the new one has already started, and a handler that blindly cleared `child` would
  // wipe out the reference to the new one. On the next pass k0 would believe it had none and
  // start a second — measured: two live `caffeinate` processes, one of them with nobody left
  // who knows about it.
  const forget = () => {
    if (child !== spawned) return
    child = null
    activeLevel = null
  }
  spawned.on('error', forget)
  spawned.on('exit', forget)
  spawned.unref() // it is not its job to keep the server alive
}

export function release() {
  activeLevel = null
  if (!child) return
  try {
    child.kill()
  } catch {
    /* already gone on its own */
  }
  child = null
}

/**
 * `sudo -n`: the `-n` is the part that matters. Without the rule in /etc/sudoers.d the
 * command fails IMMEDIATELY instead of hanging waiting for a password nobody here can type —
 * the server runs under launchd, with no terminal in front of it.
 */
export async function setLidSleepBlocked(blocked) {
  try {
    await run(SUDO(), ['-n', PMSET(), '-a', 'disablesleep', blocked ? '1' : '0'])
  } catch {
    /* no sudo rule: carry on with caffeinate alone */
  }
}

export async function lidSleepBlocked() {
  try {
    return parseSleepDisabled(await run(PMSET(), ['-g']))
  } catch {
    return false
  }
}

/**
 * The last gesture on the way out. Synchronous on purpose: from `process.on('exit')` nothing
 * asynchronous gets to start any more, and this is the net that stops a Mac being left awake
 * forever because k0 went away while it was on.
 */
export function releaseSync() {
  release()
  runSyncQuiet(SUDO(), ['-n', PMSET(), '-a', 'disablesleep', '0'], { stdio: 'ignore', timeout: 4000 })
}

export const capabilities = {
  keepAwake: true,
  keepDisplayAwake: true,
  lidSleep: true,
  battery: true,
}
