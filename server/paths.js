import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Where k0 keeps the things that must outlive a reinstall.
 *
 * Until 0.1.0 the database sat next to the source, which was fine while k0 only ever ran
 * from a checkout. It stopped being fine the moment `npx k0-board` became the normal way
 * in: npx unpacks into a cache directory that npm is free to wipe, so anything written
 * there is on borrowed time. Data now lives in a directory owned by the user, and the
 * installed copy of the app is disposable.
 *
 *   ~/.k0/k0.db        the board
 *   ~/.k0/config.json  the settings, written out with everything in it on the first run
 *   ~/.k0/app/         the installed copy of k0 (written by `k0-board install`)
 *   ~/.k0/logs/        service stdout/stderr
 *   ~/.k0/cache/       pasted images, the Chrome profile used for PDF export
 *
 * On Windows the same tree goes under %LOCALAPPDATA%\k0, which is the local-only,
 * not-roamed location Windows expects for this kind of state.
 */
export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const DEFAULT_HOME =
  process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'k0')
    : path.join(os.homedir(), '.k0')

export const HOME = process.env.K0_HOME ? path.resolve(process.env.K0_HOME) : DEFAULT_HOME

export const APP_DIR = path.join(HOME, 'app')
export const LOG_DIR = path.join(HOME, 'logs')
export const CACHE_DIR = path.join(HOME, 'cache')

/** `K0_DB` is how the tests stay away from the real board. See the guard in db.js. */
export const DB_PATH = process.env.K0_DB || path.join(HOME, 'k0.db')

export function ensureDirs() {
  for (const dir of [HOME, LOG_DIR, CACHE_DIR]) fs.mkdirSync(dir, { recursive: true })
}

/**
 * Move a pre-0.1.0 database out of the checkout and into the home directory.
 *
 * Only ever runs once, and only when there is nothing to overwrite: if the new location
 * already holds a database, the old file is left alone rather than merged or clobbered.
 * The write-ahead log and shared-memory files come along, because leaving them behind
 * would silently drop whatever had not been checkpointed yet.
 *
 * And only ever into the DEFAULT home. Pointing `K0_HOME` somewhere else is how you run a
 * second k0 against a scratch directory, and a move is not undoable by the person watching it
 * happen: doing it there would drag the real board into a temporary folder while the real
 * server still had it open. Verified the hard way.
 */
export function migrateLegacyDatabase() {
  if (process.env.K0_DB) return false
  if (HOME !== DEFAULT_HOME) return false
  const legacy = path.join(ROOT, 'k0.db')
  if (!fs.existsSync(legacy) || fs.existsSync(DB_PATH)) return false
  ensureDirs()
  for (const suffix of ['', '-wal', '-shm']) {
    const from = legacy + suffix
    if (fs.existsSync(from)) fs.renameSync(from, DB_PATH + suffix)
  }
  return true
}
