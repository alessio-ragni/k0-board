import os from 'node:os'
import { psJson } from './powershell.js'

/**
 * Process and memory figures on Windows, out of CIM.
 *
 * There is no `ps`, so the shape the rest of k0 expects is built here instead of parsed. The
 * fields line up one for one: WorkingSetSize is resident memory, and KernelModeTime plus
 * UserModeTime is CPU time — in 100-nanosecond ticks, which is where the division comes from.
 */

export async function processes() {
  const rows = await psJson(
    `@(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, WorkingSetSize, KernelModeTime, UserModeTime, CommandLine, Name)`,
    []
  )
  const procs = new Map()
  for (const row of Array.isArray(rows) ? rows : [rows].filter(Boolean)) {
    const pid = Number(row.ProcessId)
    if (!pid) continue
    procs.set(pid, {
      ppid: Number(row.ParentProcessId) || 0,
      rss: Number(row.WorkingSetSize) || 0,
      cpu: (Number(row.KernelModeTime || 0) + Number(row.UserModeTime || 0)) / 1e7,
      cmd: row.CommandLine || row.Name || '',
    })
  }
  return procs
}

/**
 * Windows has no equivalent of macOS's wired/compressed split, so those come back zero and
 * the whole of "used" is attributed to applications. `cached` is the standby list, which is
 * the closest thing to file-backed pages — memory nobody is short of.
 */
export async function memory() {
  const info = await psJson(
    `Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize, FreePhysicalMemory`,
    null
  )
  const total = info ? Number(info.TotalVisibleMemorySize) * 1024 : os.totalmem()
  const free = info ? Number(info.FreePhysicalMemory) * 1024 : os.freemem()
  const used = Math.max(0, total - free)
  return { total, used, app: used, wired: 0, compressed: 0, cached: 0 }
}

/** The page file is Windows's swap. A machine with none reports zeroes, which is correct. */
export async function swap() {
  const page = await psJson(
    `Get-CimInstance Win32_PageFileUsage | Select-Object AllocatedBaseSize, CurrentUsage`,
    null
  )
  if (!page) return { total: 0, used: 0 }
  const rows = Array.isArray(page) ? page : [page]
  return {
    total: rows.reduce((n, r) => n + Number(r.AllocatedBaseSize || 0) * 1024 * 1024, 0),
    used: rows.reduce((n, r) => n + Number(r.CurrentUsage || 0) * 1024 * 1024, 0),
  }
}

/** Windows publishes no pressure verdict, so the board judges by how full memory is. */
export async function pressureLevel() {
  return 1
}

export const capabilities = () => ({ pressure: false, swap: true })

export const notes = {
  'metrics.pressure':
    'Windows does not publish a memory-pressure verdict the way macOS and Linux do, so k0 ' +
    'judges by how full memory is instead.',
}
