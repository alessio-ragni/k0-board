import fs from 'node:fs'
import path from 'node:path'
import { HOME } from './paths.js'

/**
 * The few things about k0 you are allowed to change, and the file they live in.
 *
 * k0 has never had one of these, and this is deliberately not the first room of a settings
 * panel. The board shows what changes during a working day; a number you set once and then never
 * look at again is the opposite of that, and putting it on screen would cost the one page that
 * has to stay readable in exchange for nothing.
 *
 * So it is a file, and the file IS the list: k0 writes it out with every setting already in it at
 * its default, so that opening it is how you find out what there is to change. `k0-board doctor`
 * prints the same thing, for anyone who would rather ask than look.
 *
 * It lives beside the database and not inside the app, because the app directory is disposable —
 * `npx` unpacks into a cache npm may wipe, and `k0-board install` overwrites it — and a setting
 * an update throws away is not a setting. And it is read again whenever it changes, so editing
 * it takes effect on the next round rather than after a restart.
 */

/** `K0_CONFIG` is how the tests stay away from the real file, the way `K0_DB` does for the board. */
export const PATH = process.env.K0_CONFIG || path.join(HOME, 'config.json')

/**
 * Every setting there is, and what it is worth if you never touch the file. No default is written
 * down anywhere else: this object is the whole answer to "and if I leave it alone?".
 */
export const DEFAULTS = {
  closeIdleTerminalsAfterHours: 12,
}

/**
 * The shortest timeout that is still a timeout. The sweep goes round once a minute, and a
 * terminal you were typing into ten minutes ago is not one you have forgotten: below an hour this
 * stops being a tidy-up and becomes a machine closing windows while you are using them. A number
 * under it is raised rather than refused — the intent was clearly "be aggressive about it", and an
 * hour is as aggressive as this is willing to be.
 */
export const MIN_HOURS = 1

/** The line k0 leaves at the top of the file, since JSON has nowhere else to put a word. */
const NOTE =
  'k0 wrote this file and reads it again by itself whenever it changes — nothing to restart. ' +
  'Delete a line to go back to its default. Hours at 0 switch that closing off entirely. ' +
  'See Settings in the README.'

/**
 * How long a terminal may sit there. Anything that is not a number falls back to the default
 * rather than blowing up: this arrives from a file somebody edits by hand, and from there
 * anything can arrive. Zero and below mean off, which is how the whole thing is switched off
 * without a second switch to be kept in step with the first.
 */
export function idleHours(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULTS.closeIdleTerminalsAfterHours
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULTS.closeIdleTerminalsAfterHours
  if (n <= 0) return 0
  return Math.max(MIN_HOURS, n)
}

/** A file's worth of anything, turned into settings that can be trusted. Pure: the tests live here. */
export function normalise(raw) {
  const o = raw && typeof raw === 'object' ? raw : {}
  return { closeIdleTerminalsAfterHours: idleHours(o.closeIdleTerminalsAfterHours) }
}

let cached = null
let stamp = null // the mtime the cache was built from, or null for "there was no file"
let broken = false

/**
 * The settings in force. The file is only re-read when its mtime moves, so this can be called
 * from the watching loop without costing a read a second, and changing the file still lands
 * without a restart.
 */
export function read() {
  let mtime = null
  try {
    mtime = fs.statSync(PATH).mtimeMs
  } catch {
    /* no file: the defaults hold, and there is nothing to remember */
  }
  if (cached && stamp === mtime) return cached
  stamp = mtime
  if (mtime === null) broken = false // a file that is not there is not a file that is broken
  cached = normalise(mtime === null ? null : parse())
  return cached
}

function parse() {
  try {
    broken = false
    return JSON.parse(fs.readFileSync(PATH, 'utf8'))
  } catch {
    // Half-saved by an editor, or one comma too many. k0 goes on with the defaults rather than
    // refusing to start, and `doctor` is where you find out the file is being ignored — silence
    // would be the worst of both: a setting you believe is in force and is not.
    broken = true
    return null
  }
}

/**
 * Writes the file out, with everything in it, if it is not there yet. Called explicitly at
 * startup rather than from an import: a module that writes to your disk merely because somebody
 * mentioned it is a module nobody can reason about.
 */
export function ensure() {
  if (fs.existsSync(PATH)) return false
  fs.mkdirSync(path.dirname(PATH), { recursive: true })
  fs.writeFileSync(PATH, JSON.stringify({ '//': NOTE, ...DEFAULTS }, null, 2) + '\n')
  return true
}

/** What the doctor prints: where the file is, whether it could be read, and what is in force. */
export function status() {
  const values = read()
  return { path: PATH, exists: stamp !== null, broken, values }
}
