import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'

const execFileAsync = promisify(execFile)

const DEFAULT_TIMEOUT = 5000

/**
 * Run a command and get its stdout back.
 *
 * Everything that talks to the operating system goes through here rather than through a
 * shell, so a directory name with a space or a quote in it stays a directory name instead
 * of turning into two arguments.
 */
export async function run(file, args = [], opts = {}) {
  const { stdout } = await execFileAsync(file, args, { timeout: DEFAULT_TIMEOUT, ...opts })
  return stdout
}

/** Same, but never throws: a command that is not there returns an empty string. */
export async function runQuiet(file, args = [], opts = {}) {
  try {
    return await run(file, args, opts)
  } catch {
    return ''
  }
}

export function runSync(file, args = [], opts = {}) {
  return execFileSync(file, args, { encoding: 'utf8', timeout: DEFAULT_TIMEOUT, ...opts })
}

export function runSyncQuiet(file, args = [], opts = {}) {
  try {
    return runSync(file, args, opts)
  } catch {
    return ''
  }
}

const found = new Map()

/**
 * Find an executable, preferring a known absolute path and falling back to PATH.
 *
 * The absolute path comes first for a reason that only shows up in production: the server
 * runs as a background service, and a login shell's PATH is not what it inherits. Under
 * launchd it is barely more than /usr/bin:/bin. Looking the binary up by name alone works
 * perfectly from a terminal and then fails the moment k0 is installed for real.
 *
 * The reverse fallback matters too — Homebrew, Nix and the various Linux distributions all
 * disagree about where things live — so this tries the known locations, then the PATH, and
 * only then gives up.
 *
 * @param {string} name  bare command name, e.g. 'git'
 * @param {string[]} candidates  absolute paths to try first
 * @returns {string|null}
 */
export function which(name, candidates = []) {
  if (found.has(name)) return found.get(name)
  const tried = [...candidates]
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    for (const ext of process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']) {
      tried.push(path.join(dir, name + ext))
    }
  }
  for (const candidate of tried) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      found.set(name, candidate)
      return candidate
    } catch {
      /* keep looking */
    }
  }
  found.set(name, null)
  return null
}

/** `which`, but it throws a sentence a user can act on instead of ENOENT. */
export function need(name, candidates = [], hint = '') {
  const bin = which(name, candidates)
  if (bin) return bin
  throw new Error(`k0 needs "${name}" but could not find it on this machine.${hint ? ` ${hint}` : ''}`)
}

/** Is this process still alive? Signal 0 asks without sending anything. */
export function alive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}
