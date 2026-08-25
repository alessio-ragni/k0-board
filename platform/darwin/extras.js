import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run, runQuiet, runSyncQuiet, which } from '../shared/run.js'

/**
 * The optional system tweaks, each one opt-in.
 *
 * These are the parts of installing k0 that reach outside its own files and change something
 * about the machine. They are listed separately from the service because the installer shows
 * them one by one and asks before touching anything: a tool that quietly writes to
 * /etc/sudoers.d and rewrites your Terminal preferences has no business being installed with
 * a single unexplained "y".
 *
 * Every extra can say whether it applies here, whether it is already in place, how to put it
 * there, and how to take it away again.
 */

const SUDO = () => which('sudo', ['/usr/bin/sudo'])
const PMSET = () => which('pmset', ['/usr/bin/pmset'])
const VISUDO = () => which('visudo', ['/usr/sbin/visudo'])
const PLUTIL = () => which('plutil', ['/usr/bin/plutil'])
const DEFAULTS = () => which('defaults', ['/usr/bin/defaults'])
const KILLALL = () => which('killall', ['/usr/bin/killall'])
const SW_VERS = () => which('sw_vers', ['/usr/bin/sw_vers'])
const PS = () => which('ps', ['/bin/ps'])

// ── Staying awake with the lid closed ────────────────────────────────────────
// `caffeinate`, the thing you run by hand in a terminal, only sets *idle* assertions: they
// stop sleep from inactivity, not the sleep that fires when the lid closes, which is a forced
// sleep and goes straight past them. The only thing that stops that one too is the system
// flag `SleepDisabled`, and turning it on takes root.
//
// The server runs under launchd with no terminal in front of it, so nobody could type a
// password. Which is why permission is granted here, once, for that command and nothing
// else — no wildcards, the arguments spelled out, so the blast radius is exactly two command
// lines.

const SUDOERS = '/etc/sudoers.d/k0-pmset'

const sudoersRule = () =>
  `${os.userInfo().username} ALL=(root) NOPASSWD: /usr/bin/pmset -a disablesleep 1, /usr/bin/pmset -a disablesleep 0\n`

/** Runs a command with the terminal attached, so sudo can ask for a password. */
function interactive(file, args) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: 'inherit' })
    child.on('exit', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
  })
}

const lidSleep = {
  id: 'lid-sleep',
  title: 'Keep this Mac awake with the lid closed',
  detail:
    'Grants one administrator rule so k0 can toggle the system sleep flag. That is all it ' +
    'can ever do as root: that command, with those arguments. Asks for your password once.',
  target: SUDOERS,
  supported: () => true,

  /**
   * Already fine means the rule exists AND really does grant that command without a password.
   * The file itself cannot be read back (it is 0440 root, as it should be), but `sudo -l`
   * answers the question that actually matters — "will you let me do this without asking?" —
   * without running anything.
   */
  async installed() {
    if (!fs.existsSync(SUDOERS)) return false
    const out = await runQuiet(SUDO(), ['-n', '-l', PMSET(), '-a', 'disablesleep', '1'])
    return !!out
  },

  async install() {
    const tmp = path.join(os.tmpdir(), `k0-pmset-${process.pid}`)
    fs.writeFileSync(tmp, sudoersRule(), { mode: 0o600 })
    try {
      // A malformed file in /etc/sudoers.d makes `sudo` unusable on the whole machine: it is
      // validated BEFORE being put in place, and if it does not pass, nothing is installed.
      await run(VISUDO(), ['-c', '-f', tmp])
    } catch {
      fs.unlinkSync(tmp)
      return { ok: false, message: 'the rule did not pass visudo, so it was not installed' }
    }
    const ok = await interactive(SUDO(), ['install', '-m', '0440', '-o', 'root', '-g', 'wheel', tmp, SUDOERS])
    fs.unlinkSync(tmp)
    return ok
      ? { ok: true }
      : { ok: false, message: 'permission not granted — k0 will keep the Mac awake only with the lid open' }
  },

  async uninstall() {
    // Lift the ban on sleeping first, then remove the permission to lift it: the other order
    // would leave the Mac awake forever with no way left to fix itself.
    await runQuiet(SUDO(), ['-n', PMSET(), '-a', 'disablesleep', '0'])
    if (!fs.existsSync(SUDOERS)) return { ok: true }
    const ok = await interactive(SUDO(), ['rm', '-f', SUDOERS])
    return { ok }
  },
}

// ── Shift+Enter inserts a newline ────────────────────────────────────────────
// Terminal.app, up to macOS 26, does not tell Shift+Enter from Enter: the program receives
// the same single byte, so Claude Code sends the message instead of starting a new line. We
// teach the Terminal profile to send Esc+Enter when you press Shift+Enter: that is the
// sequence Claude Code reads as "new line" (the same one its own /terminal-setup installs for
// VS Code, Zed and Alacritty). From macOS 27 the Terminal does it by itself and nothing here
// is touched.
//
// The when matters as much as the what: Terminal reads key bindings ONLY at startup, and on
// quitting it rewrites its preferences from what it had in memory — erasing our entry. Writing
// it while Terminal is running is therefore useless at best and counterproductive at worst:
// the only moment the write survives is right after Terminal has died. The menu bar icon
// catches that moment and calls us back (see menubar/K0MenuBar.swift).

const PREFS = path.join(os.homedir(), 'Library', 'Preferences', 'com.apple.Terminal.plist')
const BACKUP = `${PREFS}.k0.bak`

/** How Terminal writes a key in a profile: modifiers first ($ = Shift), then the key code. */
const KEY = '$000D'
/** Esc followed by carriage return: the sequence Claude Code reads as "new line". */
const ESC_ENTER = '\x1b\r'

// plutil uses the dot as a path separator: dots inside a profile name have to be protected,
// or a profile called "My.Profile" would split the path in two.
const entryPath = (profile) => `Window Settings.${profile.replace(/\./g, '\\.')}.keyMapBoundKeys.${KEY}`
const dictPath = (profile) => `Window Settings.${profile.replace(/\./g, '\\.')}.keyMapBoundKeys`

/**
 * The profiles to touch: the default one and, if different, the one Terminal opens new
 * windows with. These are the same two reads Claude Code's /terminal-setup makes.
 */
async function profiles() {
  const fallback = (await runQuiet(DEFAULTS(), ['read', 'com.apple.Terminal', 'Default Window Settings'])).trim()
  const startup = (await runQuiet(DEFAULTS(), ['read', 'com.apple.Terminal', 'Startup Window Settings'])).trim()
  return [...new Set([fallback, startup].filter(Boolean))]
}

const hasBinding = (profile) => !!runSyncQuiet(PLUTIL(), ['-extract', entryPath(profile), 'raw', '-o', '-', PREFS])

/**
 * pgrep is no good here: it cannot see the Terminal process's command line, and
 * `pgrep -x Terminal` misses it because the name is the full path.
 */
async function terminalRunning() {
  const out = await runQuiet(PS(), ['-Ao', 'comm='])
  return /Terminal\.app\/Contents\/MacOS\/Terminal/.test(out)
}

async function majorVersion() {
  const out = await runQuiet(SW_VERS(), ['-productVersion'])
  return Number(String(out).trim().split('.')[0]) || 0
}

const shiftEnter = {
  id: 'shift-enter',
  title: 'Shift+Enter starts a new line in Terminal',
  detail:
    'Adds one key binding to your Terminal profiles, after backing the preferences up. ' +
    'Without it, Shift+Enter sends the message instead of starting a new line.',
  target: PREFS,
  async supported() {
    return (await majorVersion()) < 27
  },

  async installed() {
    if (!fs.existsSync(PREFS)) return false
    const list = await profiles()
    return list.length > 0 && list.every(hasBinding)
  },

  async install() {
    if ((await majorVersion()) >= 27) return { ok: true, message: 'macOS does this by itself now' }
    // Nothing is written while Terminal is running: it would not read the entry anyway, and on
    // quitting it would write its in-memory preferences over the top. The menu bar icon calls
    // us back the moment Terminal closes.
    if (await terminalRunning()) {
      return { ok: false, message: 'Terminal is open — k0 will add it as soon as you quit Terminal' }
    }
    if (!fs.existsSync(PREFS)) return { ok: false, message: 'Terminal preferences not found' }

    // Before writing, wake up cfprefsd, which caches preferences: if it is still holding
    // anything from a Terminal that just quit, it flushes it to disk NOW. Without this it
    // would flush after us, over the entry we just wrote — which is exactly the trap this
    // whole story started from. Terminal is already dead here, so nothing is taken from anybody.
    await runQuiet(KILLALL(), ['cfprefsd'])
    await new Promise((r) => setTimeout(r, 1000))

    const list = await profiles()
    let wrote = false
    const failed = []
    for (const profile of list) {
      if (hasBinding(profile)) continue
      // A backup before writing, and only the first time: making it now would save the
      // already-modified preferences, which is to say nothing.
      if (!fs.existsSync(BACKUP)) await runQuiet(DEFAULTS(), ['export', 'com.apple.Terminal', BACKUP])
      // The bindings dictionary has to be created if it is not there yet; if it is, this
      // -insert fails, and that is correct.
      await runQuiet(PLUTIL(), ['-insert', dictPath(profile), '-dictionary', PREFS])
      await runQuiet(PLUTIL(), ['-insert', entryPath(profile), '-string', ESC_ENTER, PREFS])
      if (hasBinding(profile)) wrote = true
      else failed.push(profile)
    }
    // cfprefsd caches preferences: without this, nobody sees what we wrote to the file.
    if (wrote) await runQuiet(KILLALL(), ['cfprefsd'])
    if (failed.length) {
      return {
        ok: false,
        message:
          `could not write it to ${failed.join(', ')}. By hand: Terminal → Settings → Profiles → ` +
          'Keyboard → "+", key Return, modifier Shift, action "Send Text" with Esc and Enter.',
      }
    }
    return { ok: true }
  },

  async uninstall() {
    if (!fs.existsSync(PREFS)) return { ok: true }
    let removed = false
    for (const profile of await profiles()) {
      if (!hasBinding(profile)) continue
      // ONLY this entry is deleted: the dictionary and any bindings added by hand stay.
      await runQuiet(PLUTIL(), ['-remove', entryPath(profile), PREFS])
      removed = true
    }
    if (removed) await runQuiet(KILLALL(), ['cfprefsd'])
    return { ok: true, message: removed ? 'reopen Terminal for it to take effect' : undefined }
  },
}

// ── Accessibility ────────────────────────────────────────────────────────────
// Not something an installer can grant: macOS only lets the user do it, by hand, in System
// Settings. It is listed anyway so the consent screen can say what is being asked for and,
// more to the point, what it means.

const accessibility = {
  id: 'accessibility',
  title: 'Accessibility permission, so k0 can leave a prompt unsent',
  detail:
    'k0 simulates a Cmd+V to place your prompt in the terminal without sending it. macOS ' +
    'only allows that for apps you approve in System Settings → Privacy & Security → ' +
    'Accessibility. Note that a process with this permission can send keystrokes to any ' +
    'app. Skipping it breaks nothing: the prompt gets typed and the session starts by itself.',
  target: 'System Settings → Privacy & Security → Accessibility',
  supported: () => true,
  manual: true,
  installed: async () => false,
  install: async () => ({ ok: false, message: 'grant this by hand in System Settings' }),
  uninstall: async () => ({ ok: true, message: 'revoke this by hand in System Settings' }),
}

export const extras = [lidSleep, shiftEnter, accessibility]
export { shiftEnter }
