import os from 'node:os'
import { runQuiet, which } from '../shared/run.js'
import { parsePs } from '../shared/ps.js'

const OPTS = { maxBuffer: 1 << 24 }

const PS = () => which('ps', ['/bin/ps'])
const VM_STAT = () => which('vm_stat', ['/usr/bin/vm_stat'])
const SYSCTL = () => which('sysctl', ['/usr/sbin/sysctl'])

export async function processes() {
  return parsePs(await runQuiet(PS(), ['-axo', 'pid=,ppid=,rss=,time=,command='], OPTS))
}

/**
 * `vm_stat`, in pages. The entries that matter are the ones Activity Monitor uses to build
 * its "memory used": anonymous pages minus purgeable ones are the applications' memory, and
 * to those you add wired and compressed. The rest — files held in cache — is not memory
 * anybody is short of.
 */
export function parseVmStat(out) {
  const text = String(out ?? '')
  const page = Number(/page size of (\d+)/.exec(text)?.[1]) || 4096
  const of = (label) => Number(new RegExp(`^${label}:\\s+(\\d+)`, 'm').exec(text)?.[1] || 0) * page

  const wired = of('Pages wired down')
  const compressed = of('Pages occupied by compressor')
  const app = Math.max(0, of('Anonymous pages') - of('Pages purgeable'))
  return { used: app + wired + compressed, app, wired, compressed, cached: of('File-backed pages') }
}

export async function memory() {
  return { total: os.totalmem(), ...parseVmStat(await runQuiet(VM_STAT(), [], OPTS)) }
}

/** `vm.swapusage: total = 13312.00M  used = 12660.19M  free = 651.81M` */
export function parseSwap(out) {
  const grab = (k) => {
    const m = new RegExp(`${k} = ([\\d.]+)([KMG])`).exec(String(out ?? ''))
    if (!m) return 0
    return Number(m[1]) * { K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[m[2]]
  }
  return { total: grab('total'), used: grab('used') }
}

export async function swap() {
  return parseSwap(await runQuiet(SYSCTL(), ['vm.swapusage'], OPTS))
}

/**
 * Not our verdict to invent: `kern.memorystatus_vm_pressure_level` is the kernel's own
 * judgement — 1 normal, 2 warning, 4 critical.
 */
export async function pressureLevel() {
  const out = await runQuiet(SYSCTL(), ['-n', 'kern.memorystatus_vm_pressure_level'], OPTS)
  return Number(String(out).trim()) || 1
}

export const capabilities = { pressure: true, swap: true }
