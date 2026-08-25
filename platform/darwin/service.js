import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run, runQuiet, which } from '../shared/run.js'

/**
 * Background services, launchd edition.
 *
 * Two agents: the server, and the menu bar icon. Both run in the user's own session — never
 * as root — which is why the installer refuses to be run with sudo: as uid 0 the agents
 * would land in the `gui/0` domain, where menu bar apps do not exist at all.
 */

const LAUNCHCTL = () => which('launchctl', ['/bin/launchctl'])
const AGENTS = path.join(os.homedir(), 'Library', 'LaunchAgents')

export const SERVER_LABEL = 'com.k0.server'
export const TRAY_LABEL = 'com.k0.menubar'

const plistPath = (label) => path.join(AGENTS, `${label}.plist`)
const domain = () => `gui/${process.getuid()}`

const escapeXml = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c])

function plist({ label, argv, port, logDir, workingDirectory, env = {} }) {
  const args = argv.map((a) => `    <string>${escapeXml(a)}</string>`).join('\n')
  const wd = workingDirectory
    ? `  <key>WorkingDirectory</key>\n  <string>${escapeXml(workingDirectory)}</string>\n`
    : ''
  const extraEnv = Object.entries(env)
    .map(([k, v]) => `    <key>${escapeXml(k)}</key>\n    <string>${escapeXml(v)}</string>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>K0_PORT</key>
    <string>${escapeXml(String(port))}</string>
${extraEnv}
  </dict>
${wd}  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(path.join(logDir, label + '.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(path.join(logDir, label + '.err.log'))}</string>
</dict>
</plist>
`
}

/**
 * `bootout` fails when the service is not there, which here is normal rather than an error.
 * But it also returns IMMEDIATELY, while the service takes another moment to actually leave
 * the domain — the time for the process to die and launchd to reap it. A `bootstrap` fired
 * into that gap finds the label still occupied and fails with "Bootstrap failed: 5:
 * Input/output error", which explains nothing to anybody. So we wait for it to be really
 * gone. Measured: it happens within a tenth of a second.
 */
async function unload(label) {
  await runQuiet(LAUNCHCTL(), ['bootout', `${domain()}/${label}`])
  for (let i = 0; i < 50; i++) {
    const out = await runQuiet(LAUNCHCTL(), ['print', `${domain()}/${label}`])
    if (!out) return
    await new Promise((r) => setTimeout(r, 100))
  }
}

/** And even then launchd can still be halfway through: retry a few times before believing it. */
async function load(file) {
  for (let i = 0; i < 5; i++) {
    try {
      await run(LAUNCHCTL(), ['bootstrap', domain(), file])
      return
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  // Let the last attempt speak: if that one fails too, the reason needs reading.
  await run(LAUNCHCTL(), ['bootstrap', domain(), file])
}

export async function install({ node, entry, port, logDir, tray, appDir }) {
  fs.mkdirSync(AGENTS, { recursive: true })
  fs.mkdirSync(logDir, { recursive: true })

  // launchd does not get a login shell's PATH: absolute paths only.
  fs.writeFileSync(
    plistPath(SERVER_LABEL),
    plist({ label: SERVER_LABEL, argv: [node, entry], port, logDir, workingDirectory: appDir })
  )
  await unload(SERVER_LABEL)
  await load(plistPath(SERVER_LABEL))

  if (tray && fs.existsSync(tray)) {
    // The tray calls back into the command line when Terminal quits, and under launchd it would
    // never find a version-managed node on the PATH: the interpreter's real path is handed to it.
    fs.writeFileSync(
      plistPath(TRAY_LABEL),
      plist({ label: TRAY_LABEL, argv: [tray], port, logDir, env: { K0_NODE: node } })
    )
    await unload(TRAY_LABEL)
    await load(plistPath(TRAY_LABEL))
  }
}

export async function uninstall() {
  for (const label of [SERVER_LABEL, TRAY_LABEL]) {
    await unload(label)
    try {
      fs.unlinkSync(plistPath(label))
    } catch {
      /* never installed: nothing to remove */
    }
  }
}

export async function restart() {
  await runQuiet(LAUNCHCTL(), ['kickstart', '-k', `${domain()}/${SERVER_LABEL}`])
}

export async function status() {
  const out = await runQuiet(LAUNCHCTL(), ['print', `${domain()}/${SERVER_LABEL}`])
  return { running: /state = running/.test(out) }
}

export const describe = () => [
  { path: plistPath(SERVER_LABEL), what: 'a background service that starts k0 when you log in' },
  { path: plistPath(TRAY_LABEL), what: 'a background service for the menu bar icon' },
]

export const capabilities = { autostart: true }
