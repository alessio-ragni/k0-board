import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runQuiet, runSyncQuiet, which } from '../shared/run.js'

const EXPLORER = () => which('explorer') || 'explorer.exe'

/** `explorer /select,` opens the folder with the file already highlighted. */
export const revealInFileManager = (abs) => runQuiet(EXPLORER(), [`/select,${path.normalize(abs)}`])

/** The same command without `/select,` opens the folder itself. */
export const openInFileManager = (abs) => runQuiet(EXPLORER(), [path.normalize(abs)])

export const openBrowser = (url) => runQuiet('cmd', ['/c', 'start', '', url])

const programFiles = [
  process.env['PROGRAMFILES'],
  process.env['PROGRAMFILES(X86)'],
  process.env.LOCALAPPDATA,
].filter(Boolean)

const CHROME_SUFFIXES = [
  ['Google', 'Chrome', 'Application', 'chrome.exe'],
  ['Chromium', 'Application', 'chrome.exe'],
  ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
  ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
]

export function findChrome() {
  for (const base of programFiles) {
    for (const suffix of CHROME_SUFFIXES) {
      const candidate = path.join(base, ...suffix)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return which('chrome') || which('msedge') || null
}

/**
 * Directories under the user's profile that are never projects. Windows keeps its own state
 * in the first three and the shell folders in the rest; unlike macOS these are not localised
 * on disk, whatever File Explorer chooses to display.
 */
export const homeSkipList = () =>
  new Set([
    'AppData', 'Application Data', 'Local Settings',
    'Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Videos',
    'Favorites', 'Links', 'Contacts', 'Searches', 'Saved Games', 'OneDrive',
  ])

let claudeBin = null

export function findClaude() {
  if (claudeBin) return claudeBin
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
    path.join(os.homedir(), '.local', 'bin', 'claude.cmd'),
    path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
  ]
  for (const c of candidates) if (c && fs.existsSync(c)) return (claudeBin = c)
  const fromPath = which('claude')
  if (fromPath) return (claudeBin = fromPath)
  claudeBin = runSyncQuiet('cmd', ['/c', 'where claude']).trim().split('\n')[0] || 'claude'
  return claudeBin
}

export const capabilities = () => ({ revealInFileManager: true, openInFileManager: true })
