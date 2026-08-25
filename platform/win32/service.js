import fs from 'node:fs'
import path from 'node:path'
import { runQuiet, which } from '../shared/run.js'
import { ps, psq } from './powershell.js'

/**
 * Starting k0 at login on Windows.
 *
 * A scheduled task, not a Windows service. A service runs in session 0, isolated from every
 * desktop — which would leave k0 unable to open a terminal window or see one, the two things
 * it exists to do. A logon-triggered task runs as you, in your session, which is what is
 * wanted. It also needs no elevation to create.
 */

const SCHTASKS = () => which('schtasks')

export const SERVER_TASK = 'k0 server'
export const TRAY_TASK = 'k0 tray'

function taskXml({ command, args, port, workingDirectory }) {
  const escape = (s) =>
    String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c])
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>k0 — the board that drives your Claude Code sessions</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escape(command)}</Command>
      <Arguments>${escape(args)}</Arguments>
      <WorkingDirectory>${escape(workingDirectory)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`.replace('<Actions', `<!-- K0_PORT=${escape(String(port))} --><Actions`)
}

async function register(name, xml, tmpDir) {
  const file = path.join(tmpDir, `${name.replace(/\s+/g, '-')}.xml`)
  // Task Scheduler insists on UTF-16 for imported task files.
  fs.writeFileSync(file, xml, 'utf16le')
  await runQuiet(SCHTASKS(), ['/Delete', '/TN', name, '/F'])
  await runQuiet(SCHTASKS(), ['/Create', '/TN', name, '/XML', file])
  fs.unlinkSync(file)
}

export async function install({ node, entry, port, logDir, tray, appDir }) {
  if (!SCHTASKS()) throw new Error('k0 could not find schtasks.exe, which it needs to start at login.')
  fs.mkdirSync(logDir, { recursive: true })

  // K0_PORT reaches the task through the user environment rather than the task XML, which has
  // no way to carry environment variables of its own.
  await ps(`[Environment]::SetEnvironmentVariable('K0_PORT', ${psq(String(port))}, 'User')`)

  await register(
    SERVER_TASK,
    taskXml({ command: node, args: `"${entry}"`, port, workingDirectory: appDir }),
    logDir
  )
  await runQuiet(SCHTASKS(), ['/Run', '/TN', SERVER_TASK])

  if (tray && fs.existsSync(tray)) {
    const shell = which('pwsh') || which('powershell')
    await register(
      TRAY_TASK,
      taskXml({
        command: shell,
        args: `-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${tray}"`,
        port,
        workingDirectory: appDir,
      }),
      logDir
    )
    await runQuiet(SCHTASKS(), ['/Run', '/TN', TRAY_TASK])
  }
}

export async function uninstall() {
  for (const name of [SERVER_TASK, TRAY_TASK]) {
    await runQuiet(SCHTASKS(), ['/End', '/TN', name])
    await runQuiet(SCHTASKS(), ['/Delete', '/TN', name, '/F'])
  }
}

export async function restart() {
  await runQuiet(SCHTASKS(), ['/End', '/TN', SERVER_TASK])
  await runQuiet(SCHTASKS(), ['/Run', '/TN', SERVER_TASK])
}

export async function status() {
  const out = await runQuiet(SCHTASKS(), ['/Query', '/TN', SERVER_TASK, '/FO', 'LIST'])
  return { running: /Running/i.test(out) }
}

export const describe = () => [
  { path: `Task Scheduler → ${SERVER_TASK}`, what: 'a scheduled task that starts k0 when you log in' },
  { path: `Task Scheduler → ${TRAY_TASK}`, what: 'a scheduled task for the tray icon' },
  { path: 'User environment variable K0_PORT', what: 'the port k0 listens on' },
]

export const capabilities = () => ({ autostart: !!SCHTASKS() })
