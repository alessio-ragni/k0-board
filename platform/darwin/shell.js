import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run, runSyncQuiet, which } from '../shared/run.js'

const OPEN = () => which('open', ['/usr/bin/open'])

export const revealInFileManager = (abs) => run(OPEN(), ['-R', abs], { timeout: 4000 })

/** Without `-R` the Finder opens the directory instead of picking it out in the one above. */
export const openInFileManager = (abs) => run(OPEN(), [abs], { timeout: 4000 })

export const openBrowser = (url) => run(OPEN(), [url], { timeout: 4000 })

/**
 * A Chromium-family browser that can print, or nothing.
 *
 * Absolute paths first, as everywhere else: the server runs from a LaunchAgent with a thin
 * PATH. When there is no browser at all the module says so and the rest keeps working —
 * printing and downloading the file as it is do not come through here.
 */
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]

export const findChrome = () => CHROME_CANDIDATES.find((p) => fs.existsSync(p)) || null

/**
 * Directories under $HOME that are never projects. These are macOS's own, and they are in
 * English on disk whatever language the Finder shows them in.
 */
export const homeSkipList = () =>
  new Set([
    'Library', 'Applications', 'Desktop', 'Documents', 'Downloads',
    'Movies', 'Music', 'Pictures', 'Public', 'Sites',
  ])

let claudeBin = null

/**
 * Where Claude Code is. The known install locations first, then a login shell — which is
 * what finds it when it came from a version manager whose PATH only exists inside a shell.
 */
export function findClaude() {
  if (claudeBin) return claudeBin
  const candidates = [
    path.join(os.homedir(), '.local/bin/claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ]
  for (const c of candidates) if (fs.existsSync(c)) return (claudeBin = c)
  const shell = process.env.SHELL || '/bin/zsh'
  const fromShell = runSyncQuiet(shell, ['-lc', 'command -v claude']).trim()
  claudeBin = fromShell || which('claude') || 'claude'
  return claudeBin
}

export const capabilities = { revealInFileManager: true, openInFileManager: true }
