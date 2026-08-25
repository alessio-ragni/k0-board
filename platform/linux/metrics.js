import fs from 'node:fs'
import os from 'node:os'
import { runQuiet, which } from '../shared/run.js'
import { parsePs } from '../shared/ps.js'

const PS = () => which('ps', ['/bin/ps', '/usr/bin/ps'])

export async function processes() {
  // Same five fields in the same order as macOS, so one parser covers both. `args` is
  // Linux's name for what BSD calls `command`.
  return parsePs(await runQuiet(PS(), ['-eo', 'pid=,ppid=,rss=,time=,args='], { maxBuffer: 1 << 24 }))
}

const read = (file) => {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/**
 * /proc/meminfo, in kilobytes.
 *
 * "Used" is total minus MemAvailable, which is the kernel's own estimate of what a new
 * process could get hold of without swapping — a far better answer than total minus free,
 * which counts every cached file as memory somebody is short of.
 *
 * The macOS shape has fields Linux has no equivalent for. `wired` maps to the kernel's
 * unreclaimable slab, `compressed` to zswap where it is on, and both are simply zero when
 * the machine has nothing to put there.
 */
export function parseMeminfo(text) {
  const kb = (label) => Number(new RegExp(`^${label}:\\s+(\\d+) kB`, 'm').exec(String(text ?? ''))?.[1] || 0) * 1024
  const total = kb('MemTotal') || os.totalmem()
  const available = kb('MemAvailable')
  const cached = kb('Cached') + kb('Buffers')
  const wired = kb('SUnreclaim')
  const compressed = kb('Zswapped')
  const used = available ? Math.max(0, total - available) : Math.max(0, total - kb('MemFree') - cached)
  return { total, used, app: Math.max(0, used - wired - compressed), wired, compressed, cached }
}

export async function memory() {
  return parseMeminfo(read('/proc/meminfo'))
}

export function parseSwapFromMeminfo(text) {
  const kb = (label) => Number(new RegExp(`^${label}:\\s+(\\d+) kB`, 'm').exec(String(text ?? ''))?.[1] || 0) * 1024
  const total = kb('SwapTotal')
  return { total, used: Math.max(0, total - kb('SwapFree')) }
}

export async function swap() {
  return parseSwapFromMeminfo(read('/proc/meminfo'))
}

/**
 * Pressure Stall Information: the fraction of the last ten seconds in which at least one task
 * was stalled waiting for memory. It is the closest thing Linux has to the macOS kernel's
 * pressure verdict, and like it, it is a measurement rather than a guess — so the thresholds
 * are the only part k0 chooses.
 *
 * Not every kernel is built with PSI, and cgroup-less containers do not expose it either;
 * where the file is missing, `capabilities.pressure` says so and the board falls back to
 * judging by how full memory is.
 */
export function parsePressure(text) {
  const avg10 = Number(/some\s+avg10=([\d.]+)/.exec(String(text ?? ''))?.[1] || 0)
  if (avg10 >= 20) return 4
  if (avg10 >= 5) return 2
  return 1
}

export async function pressureLevel() {
  return parsePressure(read('/proc/pressure/memory'))
}

export const capabilities = () => ({
  pressure: fs.existsSync('/proc/pressure/memory'),
  swap: true,
})

export const notes = {
  'metrics.pressure':
    'This kernel does not expose /proc/pressure/memory, so k0 judges memory pressure by how ' +
    'full memory is rather than by how much it is actually stalling.',
}
