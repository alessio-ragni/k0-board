import { spawn } from 'node:child_process'
import { run, runQuiet, which } from './run.js'

/**
 * A terminal, backed by tmux.
 *
 * This is the choice that makes everything else possible outside macOS. k0 does not just
 * need to *start* a terminal — it needs to rename it, read back what is on its screen to
 * know when Claude Code's interface is ready, and put a prompt in front of you without
 * sending it. On macOS, AppleScript does all three. On Linux there is no equivalent: every
 * terminal emulator is its own island, and most of them cannot be addressed at all once
 * they are running.
 *
 * tmux can. It creates a session, renames it, captures the pane, sends literal keys without
 * a newline, and kills it cleanly — and it does all of that identically on every emulator,
 * because the emulator is reduced to a window that happens to be attached. Which also means
 * a session survives its window being closed: you can reattach with `tmux attach -t <name>`
 * and find your work exactly where you left it.
 *
 * What tmux cannot do is move, resize or restyle the window around it. That belongs to the
 * window manager, and it is why `windows` and `font` are probed rather than assumed.
 */

const TMUX = () => which('tmux')

/** Terminal emulators, in the order they are tried, and how each runs a command. */
const EMULATORS = [
  { bin: 'gnome-terminal', args: (cmd) => ['--', ...cmd] },
  { bin: 'konsole', args: (cmd) => ['-e', ...cmd] },
  { bin: 'kitty', args: (cmd) => [...cmd] },
  { bin: 'alacritty', args: (cmd) => ['-e', ...cmd] },
  { bin: 'wezterm', args: (cmd) => ['start', '--', ...cmd] },
  { bin: 'xfce4-terminal', args: (cmd) => ['-x', ...cmd] },
  { bin: 'tilix', args: (cmd) => ['-e', ...cmd] },
  { bin: 'x-terminal-emulator', args: (cmd) => ['-e', ...cmd] },
  { bin: 'xterm', args: (cmd) => ['-e', ...cmd] },
]

/**
 * Which emulator to open. `K0_TERMINAL` wins, because no list of ours will ever cover every
 * terminal anybody uses, and being wrong about it should not mean being stuck with it.
 */
export function findEmulator() {
  const forced = process.env.K0_TERMINAL
  if (forced) {
    const bin = which(forced)
    if (bin) return { bin, args: (cmd) => ['-e', ...cmd], name: forced }
  }
  for (const e of EMULATORS) {
    const bin = which(e.bin)
    if (bin) return { ...e, bin, name: e.bin }
  }
  return null
}

const XDOTOOL = () => which('xdotool')
const WMCTRL = () => which('wmctrl')

/**
 * Wayland deliberately does not let one application move another's windows, so there is no
 * xdotool equivalent and there is not going to be. Under Wayland k0 says window placement is
 * unavailable rather than silently doing nothing.
 */
export const isWayland = () =>
  (process.env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland' || !!process.env.WAYLAND_DISPLAY

export const canPlaceWindows = () => !isWayland() && (!!XDOTOOL() || !!WMCTRL())

let counter = 0
const sessionName = () => `k0-${process.pid}-${++counter}`

const exists = async (session) => {
  const out = await runQuiet(TMUX(), ['has-session', '-t', `=${session}`]).catch(() => '')
  // `has-session` says what it thinks through the exit code, and runQuiet swallows that, so
  // ask for the list instead and look for the name.
  const list = await runQuiet(TMUX(), ['list-sessions', '-F', '#{session_name}'])
  return String(list).split('\n').includes(session) || !!out
}

export async function open({ command, title }) {
  const tmux = TMUX()
  if (!tmux) throw new Error('k0 needs tmux to drive terminals on this platform. Install it and try again.')
  const session = sessionName()

  // The session runs the command directly rather than a shell that then runs it: when Claude
  // Code exits, the session ends, which is what makes a finished card's terminal disappear
  // instead of leaving an idle shell behind.
  await run(tmux, ['new-session', '-d', '-s', session, '-n', title || session, command])
  // Off by default, and worth turning on: it is what puts the card's name in the window's
  // title bar rather than "tmux".
  await runQuiet(tmux, ['set-option', '-t', session, 'set-titles', 'on'])
  await runQuiet(tmux, ['set-option', '-t', session, 'set-titles-string', title || session])

  const emulator = findEmulator()
  if (emulator) {
    const child = spawn(emulator.bin, emulator.args([tmux, 'attach', '-t', session]), {
      stdio: 'ignore',
      detached: true,
    })
    child.unref()
  }
  return session
}

export async function setTitle(handle, title) {
  if (!handle) return false
  const tmux = TMUX()
  if (!tmux) return false
  const ok = await runQuiet(tmux, ['rename-window', '-t', `${handle}:0`, title])
  await runQuiet(tmux, ['set-option', '-t', handle, 'set-titles-string', title])
  return ok !== null
}

export async function readScreen(handle) {
  if (!handle) return null
  const tmux = TMUX()
  if (!tmux) return null
  try {
    return await run(tmux, ['capture-pane', '-p', '-t', handle])
  } catch {
    return null // session gone
  }
}

/**
 * `send-keys -l` sends the text literally and adds nothing: no newline, no key interpretation.
 * It is the closest thing to a paste there is, and unlike a real paste it needs no clipboard,
 * no focus and no accessibility permission — which makes it more reliable here than the macOS
 * path it replaces.
 */
export async function paste(text, handle) {
  const tmux = TMUX()
  if (!tmux || !handle) return { pasted: false, error: 'no terminal session' }
  try {
    await run(tmux, ['send-keys', '-t', handle, '-l', text])
    return { pasted: true }
  } catch (err) {
    return { pasted: false, error: String(err.stderr || err.message).trim() }
  }
}

export async function type(text, handle) {
  const tmux = TMUX()
  if (!tmux || !handle) return { written: false }
  try {
    await run(tmux, ['send-keys', '-t', handle, '-l', text])
    await run(tmux, ['send-keys', '-t', handle, 'Enter'])
    return { written: true }
  } catch (err) {
    return { written: false, error: String(err.stderr || err.message).trim() }
  }
}

export async function close({ handle, pid }) {
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM')
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 100))
        try {
          process.kill(pid, 0)
        } catch {
          break
        }
      }
    } catch {
      /* already dead, or not ours */
    }
  }
  if (!handle) return { closed: false }
  const tmux = TMUX()
  if (!tmux) return { closed: false }
  const before = await exists(handle)
  await runQuiet(tmux, ['kill-session', '-t', handle])
  return { closed: before }
}

/** The window showing this session, found by the title tmux set on it. */
async function windowId(handle) {
  const xdotool = XDOTOOL()
  if (!xdotool) return null
  const out = await runQuiet(xdotool, ['search', '--name', handle])
  return String(out).trim().split('\n').filter(Boolean).pop() || null
}

export async function focus(handle) {
  if (!handle) return { ok: false, error: 'This card has no terminal of its own' }
  if (!canPlaceWindows()) return { ok: false, error: 'k0 cannot raise windows on this desktop' }
  const id = await windowId(handle)
  if (!id) return { ok: false, error: 'That window is gone' }
  await runQuiet(XDOTOOL(), ['windowactivate', id])
  return { ok: true }
}

/**
 * Geometry, best effort. There is no NSScreen here to ask for the usable area net of panels
 * and docks, so the work area comes from the window manager's own `_NET_WORKAREA` by way of
 * xdotool, and the same 86% margin as everywhere else is applied to it.
 */
export async function relayout(handles) {
  if (!canPlaceWindows()) return { touched: 0 }
  const xdotool = XDOTOOL()
  const geom = await runQuiet(xdotool, ['getdisplaygeometry'])
  const [sw, sh] = String(geom).trim().split(/\s+/).map(Number)
  if (!sw || !sh) return { touched: 0 }
  const w = Math.round(sw * 0.86)
  const h = Math.round(sh * 0.86)
  const x = Math.round((sw - w) / 2)
  const y = Math.round((sh - h) / 2)
  let touched = 0
  for (const handle of handles || []) {
    const id = await windowId(handle)
    if (!id) continue
    await runQuiet(xdotool, ['windowmove', id, String(x), String(y)])
    await runQuiet(xdotool, ['windowsize', id, String(w), String(h)])
    touched++
  }
  return { touched }
}

/**
 * Font size belongs to the emulator, and every emulator spells it differently — some only in
 * a config file that is read at startup. There is no honest generic answer, so k0 says it
 * cannot and driving mode changes only the board's own text.
 */
export async function setFont() {
  return { touched: 0 }
}

export async function defaultFontSize() {
  return 12
}

export const capabilities = () => ({
  windows: canPlaceWindows(),
  font: false,
  readScreen: !!TMUX(),
  pasteWithoutSending: !!TMUX(),
  title: !!TMUX(),
})

export { posixCommand as buildCommand } from './command.js'
