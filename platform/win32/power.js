import { spawn } from 'node:child_process'
import { psJson, POWERSHELL } from './powershell.js'

/**
 * Keeping a Windows machine awake.
 *
 * `SetThreadExecutionState` is the Windows equivalent of an idle assertion: a thread declares
 * that the system (and optionally the display) is needed, and the declaration lasts exactly
 * as long as that thread does. So k0 holds it in a small PowerShell process and kills that
 * process to let go — the same shape as `caffeinate` on macOS and `systemd-inhibit` on Linux.
 *
 * The lid is not here. On Windows lid behaviour is a power-plan setting changed with
 * `powercfg`, it applies to the whole machine, and it survives k0 being uninstalled. That is
 * not something a board of sticky notes should rewrite on your behalf, so the switch is
 * reported as unavailable with a note saying where to change it yourself.
 */

const ES_CONTINUOUS = 0x80000000
const ES_SYSTEM_REQUIRED = 0x00000001
const ES_DISPLAY_REQUIRED = 0x00000002

let child = null
let activeLevel = null

export async function state() {
  const battery = await psJson(
    `Get-CimInstance Win32_Battery | Select-Object -First 1 EstimatedChargeRemaining, BatteryStatus`,
    null
  )
  if (!battery) return { onAcPower: true, charge: null }
  // BatteryStatus 2 is "AC power"; 1 is "discharging". Anything else is a charging state,
  // which still means the mains are connected.
  return {
    onAcPower: Number(battery.BatteryStatus) !== 1,
    charge: Number.isFinite(Number(battery.EstimatedChargeRemaining))
      ? Number(battery.EstimatedChargeRemaining)
      : null,
  }
}

export function inhibit(level) {
  if (activeLevel === level) return
  release()
  if (!level) return
  const shell = POWERSHELL()
  if (!shell) return
  activeLevel = level

  const flags =
    ES_CONTINUOUS | ES_SYSTEM_REQUIRED | (level === 'display' ? ES_DISPLAY_REQUIRED : 0)

  // The state is held for the lifetime of this process and released the moment it exits,
  // including when it is killed outright — which is the safety net that stops a machine
  // being left awake because k0 went away badly.
  const script = `
Add-Type -Namespace K0 -Name Power -MemberDefinition @'
  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);
'@
[K0.Power]::SetThreadExecutionState(${flags >>> 0}) | Out-Null
while ($true) { Start-Sleep -Seconds 3600 }`

  const spawned = spawn(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    stdio: 'ignore',
  })
  child = spawned
  const forget = () => {
    if (child !== spawned) return
    child = null
    activeLevel = null
  }
  spawned.on('error', forget)
  spawned.on('exit', forget)
  spawned.unref()
}

export function release() {
  activeLevel = null
  if (!child) return
  try {
    child.kill()
  } catch {
    /* already gone */
  }
  child = null
}

export async function setLidSleepBlocked() {}

export async function lidSleepBlocked() {
  return false
}

export function releaseSync() {
  release()
}

export const capabilities = () => ({
  keepAwake: !!POWERSHELL(),
  keepDisplayAwake: !!POWERSHELL(),
  lidSleep: false,
  battery: !!POWERSHELL(),
})

export const notes = {
  'power.lidSleep':
    'On Windows the lid is a power-plan setting. To keep working with the lid closed, set ' +
    '"When I close the lid" to "Do nothing" in Control Panel → Power Options. k0 will not ' +
    'change a machine-wide power setting for you.',
}
