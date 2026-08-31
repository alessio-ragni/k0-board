import { psJson, psQuiet, POWERSHELL } from './powershell.js'
import { which, runQuiet } from '../shared/run.js'

/**
 * Dev servers on Windows.
 *
 * Listening sockets come from `Get-NetTCPConnection`, which has carried an owning process id
 * since Windows 8 and needs nothing installed. Stopping goes through `taskkill /T`, which walks
 * the tree itself — Windows has no process groups to signal, and killing `npm` alone would
 * leave the server holding the port exactly as it does everywhere else.
 *
 * What Windows will not answer is where another process is working from. There is no /proc and
 * no lsof; getting it means opening the process and reading its PEB, which is a native module,
 * and k0 has no dependencies. So adoption is off here and the interface SAYS so — a server
 * somebody started by hand is reported as unknown rather than drawn as off. See the note in
 * index.js, which is the sentence the board shows.
 */
const hasPowerShell = () => !!POWERSHELL()

export const capabilities = () => ({
  run: true,
  ports: hasPowerShell(),
  adopt: false,
})

export async function listeners() {
  if (!hasPowerShell()) return new Map()
  const rows = await psJson(
    '@(Get-NetTCPConnection -State Listen | Select-Object LocalPort, OwningProcess)',
    []
  )
  const ports = new Map()
  for (const row of Array.isArray(rows) ? rows : [rows].filter(Boolean)) {
    const pid = Number(row.OwningProcess)
    const port = Number(row.LocalPort)
    if (!pid || port <= 0 || port >= 65536) continue
    if (!ports.has(pid)) ports.set(pid, new Set())
    ports.get(pid).add(port)
  }
  return ports
}

/** Windows cannot say. An empty map is the honest answer, and `capabilities.adopt` explains it. */
export async function cwds() {
  return new Map()
}

/**
 * `/T` takes the children with it and `/F` does not ask twice. There is no gentle signal on
 * Windows worth sending first: a console application gets CTRL_BREAK or nothing, and nothing
 * is what a detached one gets.
 */
export async function stop(root) {
  if (!root) return false
  const taskkill = which('taskkill', ['C:\\Windows\\System32\\taskkill.exe'])
  if (taskkill) {
    await runQuiet(taskkill, ['/PID', String(root), '/T', '/F'], { timeout: 8000 })
    return true
  }
  if (!hasPowerShell()) return false
  await psQuiet(`Stop-Process -Id ${Number(root)} -Force -ErrorAction SilentlyContinue`)
  return true
}

/**
 * Windows has no login shell whose PATH is worth inheriting, and `npm` is a `.cmd` that only
 * the command processor knows how to run. `/d` skips whatever AutoRun command the registry
 * would otherwise inject ahead of it.
 */
export const shell = (command) => ({
  file: process.env.COMSPEC || 'cmd.exe',
  args: ['/d', '/s', '/c', command],
})
