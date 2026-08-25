import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run, runQuiet, which } from '../shared/run.js'

/**
 * Background services, systemd user-unit edition.
 *
 * User units, not system ones: k0 runs as you, needs your session's environment to find a
 * display and a terminal, and has no business existing when you are not logged in. The one
 * wrinkle is that a user unit normally stops when your last session ends — `loginctl
 * enable-linger` is what keeps it alive on a headless box, and the installer only mentions
 * it rather than turning it on, because it is a policy decision about your account.
 */

const SYSTEMCTL = () => which('systemctl')
const UNIT_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'systemd', 'user')

export const SERVER_UNIT = 'k0.service'
export const TRAY_UNIT = 'k0-tray.service'

const unitPath = (unit) => path.join(UNIT_DIR, unit)

function unitFile({ description, exec, port, logDir, workingDirectory }) {
  return `[Unit]
Description=${description}
After=graphical-session.target

[Service]
Type=simple
ExecStart=${exec}
Environment=K0_PORT=${port}
${workingDirectory ? `WorkingDirectory=${workingDirectory}\n` : ''}Restart=always
RestartSec=2
StandardOutput=append:${path.join(logDir, description.replace(/\s+/g, '-').toLowerCase())}.out.log
StandardError=append:${path.join(logDir, description.replace(/\s+/g, '-').toLowerCase())}.err.log

[Install]
WantedBy=default.target
`
}

const quote = (s) => (/[\s"']/.test(s) ? JSON.stringify(s) : s)

export async function install({ node, entry, port, logDir, tray, appDir }) {
  const systemctl = SYSTEMCTL()
  if (!systemctl) throw new Error('k0 needs systemd to install a background service on Linux.')
  fs.mkdirSync(UNIT_DIR, { recursive: true })
  fs.mkdirSync(logDir, { recursive: true })

  fs.writeFileSync(
    unitPath(SERVER_UNIT),
    unitFile({
      description: 'k0 server',
      exec: `${quote(node)} ${quote(entry)}`,
      port,
      logDir,
      workingDirectory: appDir,
    })
  )
  if (tray && fs.existsSync(tray)) {
    const python = which('python3')
    fs.writeFileSync(
      unitPath(TRAY_UNIT),
      unitFile({ description: 'k0 tray', exec: `${quote(python || 'python3')} ${quote(tray)}`, port, logDir })
    )
  }

  await run(systemctl, ['--user', 'daemon-reload'])
  await run(systemctl, ['--user', 'enable', '--now', SERVER_UNIT])
  if (tray && fs.existsSync(unitPath(TRAY_UNIT))) {
    await runQuiet(systemctl, ['--user', 'enable', '--now', TRAY_UNIT])
  }
}

export async function uninstall() {
  const systemctl = SYSTEMCTL()
  for (const unit of [SERVER_UNIT, TRAY_UNIT]) {
    if (systemctl) {
      await runQuiet(systemctl, ['--user', 'disable', '--now', unit])
    }
    try {
      fs.unlinkSync(unitPath(unit))
    } catch {
      /* never installed */
    }
  }
  if (systemctl) await runQuiet(systemctl, ['--user', 'daemon-reload'])
}

export async function restart() {
  await runQuiet(SYSTEMCTL(), ['--user', 'restart', SERVER_UNIT])
}

export async function status() {
  const out = await runQuiet(SYSTEMCTL(), ['--user', 'is-active', SERVER_UNIT])
  return { running: String(out).trim() === 'active' }
}

export const describe = () => [
  { path: unitPath(SERVER_UNIT), what: 'a user service that starts k0 when you log in' },
  { path: unitPath(TRAY_UNIT), what: 'a user service for the tray icon' },
]

export const capabilities = () => ({ autostart: !!SYSTEMCTL() })

export const notes = {
  'service.autostart':
    'systemd was not found, so k0 cannot register itself to start at login. Run it by hand ' +
    'with `k0-board start` or from your desktop’s own autostart configuration.',
}
