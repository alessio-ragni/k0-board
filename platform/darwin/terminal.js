import { execFileSync } from 'node:child_process'
import { run, runQuiet, which } from '../shared/run.js'

/**
 * Terminal.app, driven by AppleScript.
 *
 * This is the reference implementation of the terminal contract, and the only one where
 * every capability is available: macOS lets a script open a window, place it, resize it,
 * rename it, read back what is printed in it and paste into it. The other platforms each
 * give up something.
 */

const OSASCRIPT = () => which('osascript', ['/usr/bin/osascript'])
const PBCOPY = () => which('pbcopy', ['/usr/bin/pbcopy'])
const PBPASTE = () => which('pbpaste', ['/usr/bin/pbpaste'])

/** Escape for an AppleScript string literal. */
const asq = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')

/** How much of the free screen area a window takes: the rest is margin. */
const COVERAGE = 0.86

/** In driving mode the terminal has to be readable from across the room. */
export const DRIVING_FONT_SIZE = 22

/**
 * The profile's font size, asked once and then remembered. It is what we go back to when
 * driving mode is switched off; hard-coding a 12 here would be right today and wrong the
 * day you change your Terminal profile.
 */
let defaultFont = null
export async function defaultFontSize() {
  if (defaultFont) return defaultFont
  const out = await runQuiet(OSASCRIPT(), ['-e', 'tell application "Terminal" to get font size of default settings'])
  defaultFont = Number(String(out).trim()) || 12
  return defaultFont
}

/**
 * The piece of AppleScript that decides where a window goes and how big it is. It is written
 * once because two callers need it — the one that opens a new window and the one that puts
 * them back after the screen changes — and the rule has to be the same for both: otherwise
 * the first time a monitor is unplugged every window would change size for no reason.
 *
 * Leaves `x1`, `y1`, `w` and `h` behind, which is what `bounds` needs.
 */
const GEOMETRY = `
use framework "AppKit"
use scripting additions

-- visibleFrame is already net of the menu bar and the Dock, so the margin computed
-- below never ends up underneath either of them.
set scr to current application's NSScreen's mainScreen()
set frameH to item 2 of item 2 of (scr's frame() as list)
set {{vx, vy}, {vw, vh}} to (scr's visibleFrame() as list)
set w to round (vw * ${COVERAGE})
set h to round (vh * ${COVERAGE})
set x1 to round (vx + (vw - w) / 2)
-- NSScreen counts from the bottom, Terminal from the top: this converts between them.
set y1 to round (frameH - (vy + vh) + (vh - h) / 2)
`

/**
 * Opens a new Terminal.app window, centres it on screen, and only then runs the command in
 * it. Returns the window id, which is what lets us bring it back to the front later.
 *
 * The order is everything:
 * - the screen is read BEFORE `activate`, because `mainScreen` is whichever screen holds the
 *   focused window: before, that is the one you are working on; after, it would be whichever
 *   screen Terminal already had a window on;
 * - the font size is set BEFORE the bounds, because Terminal keeps rows and columns when the
 *   font changes and resizes the window to match — doing it afterwards would eat the size we
 *   had just set;
 * - the window is sized BEFORE the command runs, so Claude Code's interface is born at the
 *   right size instead of having to redraw itself halfway through starting up.
 */
export async function open({ command, title, fontSize }) {
  const font = fontSize ?? (await defaultFontSize())
  const script = `${GEOMETRY}
tell application "Terminal"
  activate
  do script ""
  set win to front window
  set font size of tab 1 of win to ${font}
  set bounds of win to {x1, y1, x1 + w, y1 + h}
  do script "${asq(command)}" in tab 1 of win
  -- The card's name in the title bar, not the command line with the session id in it.
  set custom title of tab 1 of win to "${asq(title)}"
  set winId to id of win
end tell
return winId as string`
  const stdout = await run(OSASCRIPT(), ['-e', script], { timeout: 30000 })
  return stdout.trim()
}

const ids = (handles) => [...new Set((handles || []).map(Number).filter(Boolean))]

/**
 * One `osascript` for every window, each in its own `try`.
 *
 * The per-window `try` is there so that one window closed by hand in the meantime does not
 * take all the others down with it. And there is deliberately **no `activate`**: opening a
 * window needs Terminal in front, touching one that is already open does not — otherwise
 * every time you switch driving mode on or plug in a monitor, Terminal would jump in front
 * of whatever you were doing.
 */
async function forEachWindow(preamble, body, list) {
  const blocks = list.map((id) => `\n  try${body(id)}\n  end try`).join('')
  try {
    await run(OSASCRIPT(), ['-e', `${preamble}\ntell application "Terminal"${blocks}\nend tell`])
    return { touched: list.length }
  } catch {
    return { touched: 0 } // Terminal is not running at all: there is nothing to touch
  }
}

/**
 * Changes the font size of windows that are already open — which is what happens when
 * driving mode goes on or off.
 *
 * **Every window stays exactly where and as it is.** That is worth saying because it is not
 * free: Terminal.app keeps rows and columns when the font changes and resizes the window
 * accordingly — going from 12 to 22 more than doubles it. So the bounds are read first, the
 * font is changed, and the bounds are put back: **its own** bounds, not the centred ones.
 * k0's windows have rarely stayed where they were born — you move them, widen them, drag one
 * to the other monitor — and turning on driving mode is not the moment to sweep them all
 * back to the middle of the screen without being asked.
 *
 * What genuinely changes is how much text fits: at 22 points, fewer rows.
 */
export async function setFont(handles, size) {
  const list = ids(handles)
  if (!list.length) return { touched: 0 }
  const font = size ?? (await defaultFontSize())
  return forEachWindow(
    '',
    (id) => `
    set b to bounds of window id ${id}
    set font size of tab 1 of window id ${id} to ${font}
    set bounds of window id ${id} to b`,
    list
  )
}

/**
 * Puts the windows back in the middle of the screen at their usual size: what is needed when
 * the screen changes underneath them — a monitor plugged in or unplugged, a different
 * resolution — and the windows stay where they were, out of place or off screen.
 *
 * Here gathering them back to the centre is the point: they all end up where they were born,
 * as they were on the first day. The geometry is computed once for all of them, so none ends
 * up on a different screen from its siblings.
 */
export async function relayout(handles) {
  const list = ids(handles)
  if (!list.length) return { touched: 0 }
  return forEachWindow(GEOMETRY, (id) => `\n    set bounds of window id ${id} to {x1, y1, x1 + w, y1 + h}`, list)
}

/**
 * Rewrites the name in the window's title bar. Works on a live session too: a title set from
 * outside takes precedence over the one Claude Code keeps writing for itself.
 *
 * It is the only way to make the name follow a live session immediately — inside Claude Code
 * the real name catches up when the session ends, which is when the transcript stops having
 * an owner.
 */
export async function setTitle(handle, title) {
  const id = Number(handle)
  if (!id) return false
  try {
    await run(OSASCRIPT(), [
      '-e',
      `tell application "Terminal" to set custom title of tab 1 of window id ${id} to "${asq(title)}"`,
    ])
    return true
  } catch {
    return false // window is closed: nothing to rename
  }
}

/**
 * Brings the card's window back to the front, un-minimising it if it was parked.
 * Keeps you from losing track of which terminal is which.
 */
export async function focus(handle) {
  const id = Number(handle)
  if (!id) return { ok: false, error: 'This card has no terminal window of its own' }
  const script = `
tell application "Terminal"
  activate
  set w to window id ${id}
  set miniaturized of w to false
  set index of w to 1
end tell`
  try {
    await run(OSASCRIPT(), ['-e', script])
    return { ok: true }
  } catch {
    return { ok: false, error: 'That window is gone' }
  }
}

/**
 * Closes a card's terminal: stops the session first, then closes the window.
 *
 * The order is not a detail. Closing a window that still has `claude` inside it makes macOS
 * put up the "terminate running processes" dialog and sit there waiting: the window does not
 * close and Terminal stops answering commands. With the process stopped first, the window
 * goes quietly.
 */
export async function close({ handle, pid }) {
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM')
      // A moment to leave gracefully, but not much of one.
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 100))
        try {
          process.kill(pid, 0)
        } catch {
          break // gone
        }
      }
    } catch {
      /* already dead, or not ours: carry on either way */
    }
  }
  const id = Number(handle)
  if (!id) return { closed: false }
  try {
    await run(OSASCRIPT(), [
      '-e',
      `tell application "Terminal" to close (every window whose id is ${id}) saving no`,
    ])
    return { closed: true }
  } catch {
    return { closed: false } // already closed by hand: perfectly fine
  }
}

/** What is printed in the window right now. This is how k0 knows the interface is ready. */
export async function readScreen(handle) {
  const id = Number(handle)
  if (!id) return null
  try {
    const stdout = await run(OSASCRIPT(), [
      '-e',
      `tell application "Terminal" to get contents of tab 1 of window id ${id}`,
    ])
    return stdout
  } catch {
    return null // window is gone
  }
}

/**
 * Writes the prompt into the window and leaves it there, unsent: you press Enter.
 *
 * It goes through the clipboard and a Cmd+V because inside the interface a typed newline
 * would send the message, while a paste stays one block. The simulated keystroke needs
 * macOS's Accessibility permission, though; without it the caller falls back to `type`.
 */
export async function paste(text, handle) {
  let previous = ''
  try {
    previous = execFileSync(PBPASTE(), { encoding: 'utf8' })
  } catch {
    /* clipboard unreadable: never mind, there is nothing to put back */
  }
  execFileSync(PBCOPY(), { input: text })
  const script = `
tell application "Terminal"
  activate
  try
    set index of window id ${Number(handle) || 1} to 1
  end try
end tell
delay 0.2
tell application "System Events" to keystroke "v" using command down`
  try {
    await run(OSASCRIPT(), ['-e', script])
    return { pasted: true }
  } catch (err) {
    // No Accessibility permission: put back the clipboard we borrowed.
    try {
      execFileSync(PBCOPY(), { input: previous })
    } catch {
      /* better not to insist */
    }
    return { pasted: false, error: String(err.stderr || err.message).trim() }
  }
}

/**
 * Writes the prompt into the terminal and sends it, with no simulated keystrokes and no
 * permissions: Terminal.app itself types it into the window. It always adds the Enter —
 * there is provably no way to hold it back and leave the text clean — so the session starts
 * here. This is the safety net when Accessibility has not been granted: better to start than
 * to stall.
 */
export async function type(text, handle) {
  const id = Number(handle)
  if (!id) return { written: false }
  try {
    await run(OSASCRIPT(), [
      '-e',
      `tell application "Terminal" to do script "${asq(text)}" in tab 1 of window id ${id}`,
    ])
    return { written: true }
  } catch (err) {
    return { written: false, error: String(err.stderr || err.message).trim() }
  }
}

export const capabilities = {
  windows: true,
  font: true,
  readScreen: true,
  pasteWithoutSending: true,
  title: true,
}

export { posixCommand as buildCommand } from '../shared/command.js'
