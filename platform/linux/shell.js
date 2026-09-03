import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run, runQuiet, runSyncQuiet, which } from '../shared/run.js'

const XDG_OPEN = () => which('xdg-open')
const DBUS_SEND = () => which('dbus-send')

/**
 * "Show me this file in the file manager" has a proper freedesktop answer — the FileManager1
 * interface, which selects the file rather than just opening its folder — and a fallback for
 * desktops that do not implement it, which is to open the containing directory and let you
 * find it yourself.
 */
export async function revealInFileManager(abs) {
  const dbus = DBUS_SEND()
  if (dbus) {
    const uri = `file://${encodeURI(abs)}`
    const out = await runQuiet(dbus, [
      '--session',
      '--dest=org.freedesktop.FileManager1',
      '--type=method_call',
      '/org/freedesktop/FileManager1',
      'org.freedesktop.FileManager1.ShowItems',
      `array:string:${uri}`,
      'string:',
    ])
    if (out !== '') return
  }
  const open = XDG_OPEN()
  if (open) await runQuiet(open, [path.dirname(abs)])
}

/**
 * Opening a directory needs none of the dance above: every desktop that has a file manager at
 * all hands a directory to it through xdg-open.
 */
export async function openInFileManager(abs) {
  const open = XDG_OPEN()
  if (open) await runQuiet(open, [abs])
}

export const openBrowser = (url) => run(XDG_OPEN(), [url], { timeout: 4000 })

const CHROME_CANDIDATES = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'brave-browser',
  'microsoft-edge',
]

export function findChrome() {
  for (const name of CHROME_CANDIDATES) {
    const bin = which(name)
    if (bin) return bin
  }
  for (const p of ['/snap/bin/chromium', '/usr/lib/chromium/chromium']) {
    if (fs.existsSync(p)) return p
  }
  return null
}

/**
 * Directories under $HOME that are never projects.
 *
 * The XDG names are the ones the desktop creates, and unlike macOS they can be localised —
 * a French install has `Bureau` and `Téléchargements`. So the real list is read from
 * user-dirs.dirs when it is there, with the English names as a floor for machines that have
 * no desktop at all.
 */
export function homeSkipList() {
  const skip = new Set(['Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Public', 'Templates', 'Videos', 'snap'])
  const config = path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
    'user-dirs.dirs'
  )
  try {
    for (const line of fs.readFileSync(config, 'utf8').split('\n')) {
      const m = /^XDG_\w+_DIR="\$HOME\/(.+)"/.exec(line.trim())
      if (m) skip.add(m[1].replace(/\/$/, ''))
    }
  } catch {
    /* no desktop configuration: the defaults above are enough */
  }
  return skip
}

let claudeBin = null

export function findClaude() {
  if (claudeBin) return claudeBin
  const candidates = [
    path.join(os.homedir(), '.local/bin/claude'),
    '/usr/local/bin/claude',
    '/usr/bin/claude',
  ]
  for (const c of candidates) if (fs.existsSync(c)) return (claudeBin = c)
  const shell = process.env.SHELL || '/bin/bash'
  const fromShell = runSyncQuiet(shell, ['-lc', 'command -v claude']).trim()
  claudeBin = fromShell || which('claude') || 'claude'
  return claudeBin
}

export const capabilities = () => ({ revealInFileManager: !!XDG_OPEN(), openInFileManager: !!XDG_OPEN() })
