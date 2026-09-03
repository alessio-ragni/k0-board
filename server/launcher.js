import { readLiveSessions } from './watcher.js'
import { isDriving } from './mode.js'
import { titleCase } from '../web/title.js'
import { terminal, shell, capabilities } from '../platform/index.js'

/**
 * "fix now 2h" -> "Fix-Now-2h", which is the name you will see on the session.
 * Same rule as the title field on the dashboard: the session's name is exactly what you saw
 * yourself typing.
 */
export function sessionName(title) {
  return titleCase(title).replace(/-+$/, '') || 'Untitled'
}

export const findClaude = () => shell.findClaude()

/** In driving mode the terminal has to be readable from across the room. */
const DRIVING_FONT_SIZE = 22

/** How big the text has to be right now: it depends only on the mode in force. */
const fontSize = () => (isDriving() ? Promise.resolve(DRIVING_FONT_SIZE) : terminal.defaultFontSize())

export async function setTerminalFont(handles) {
  return terminal.setFont(handles, await fontSize())
}

export const relayoutWindows = (handles) => terminal.relayout(handles)
export const setWindowTitle = (handle, title) => terminal.setTitle(handle, title)
export const focusWindow = (handle) => terminal.focus(handle)
export const closeTerminal = ({ winId, pid }) => terminal.close({ handle: winId, pid })

/** Waits for Claude to really be up: the session shows up in ~/.claude/sessions. */
async function waitForSession(sessionId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (readLiveSessions().has(sessionId)) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

/**
 * The session file appears before the interface is ready to receive: writing at that moment
 * loses the first characters and swallows the Enter. So we wait until the input box is
 * actually visible in the window.
 *
 * Where the platform cannot read a terminal's screen — Windows — there is nothing to look at,
 * and the only honest thing left is to wait a fixed moment. It is a guess, and the interface
 * says so: `capabilities.terminal.readScreen` is false there, and the board explains what
 * that costs.
 */
async function waitForPrompt(handle, timeoutMs = 15000) {
  if (!capabilities.terminal.readScreen) {
    await new Promise((r) => setTimeout(r, 3500))
    return false
  }
  if (!handle) return false
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const screen = await terminal.readScreen(handle)
    if (screen === null) return false // window gone
    if (screen.includes('❯')) {
      await new Promise((r) => setTimeout(r, 400)) // a moment for the first paint
      return true
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

/**
 * Starts (or resumes) a card's session.
 * mode: 'start' assigns a new session id, 'resume' reopens the existing one.
 */
export async function launch({ card, sessionId, mode = 'start' }) {
  const name = sessionName(card.title)
  const bin = findClaude()
  const resume = mode === 'resume'
  const args = []
  if (resume) {
    // Resuming forces nothing: that session already had a mode, and it is not our place to
    // change it.
    args.push('--dangerously-skip-permissions', '--resume', sessionId)
  } else {
    // A new session is born in plan mode: that is how work happens here, and turning it on by
    // hand at every start was the one thing standing between you and beginning.
    //
    // The permissions flag has to change here, and it is not a preference: it is provable that
    // `--dangerously-skip-permissions` **switches off** plan mode — whatever order you write
    // them in, the session starts in `bypassPermissions` and there is no sign of a plan. The
    // two flags do not error together, and that is the trap: it looks like it works.
    // `--allow-dangerously-skip-permissions` instead keeps "stop asking me" within reach of
    // shift+tab without imposing it from the start, and it is the only way to really begin
    // inside a plan. The price is that once the plan is approved it asks for confirmations.
    args.push('--allow-dangerously-skip-permissions', '--permission-mode', 'plan', '--session-id', sessionId)
  }
  args.push('-n', name)
  // With "send it for me" the prompt goes straight to the CLI and starts without touching
  // anything.
  const autoSend = mode === 'start' && card.auto_send && card.prompt?.trim()
  if (autoSend) args.push(card.prompt.trim())

  const command = terminal.buildCommand({ cwd: card.project_path, bin, args })
  const winId = await terminal.open({ command, title: name, fontSize: await fontSize() })
  const up = await waitForSession(sessionId)

  if (autoSend) return { name, up, winId, pasted: true, autoSent: true }
  // The prompt belongs to the beginning. Resuming picks up a conversation that answered it hours
  // ago, and putting it back under the cursor is at best a stale instruction in the way — at
  // worst it is sent, because where pasting is unavailable the fallback below types it. This
  // matters more now that k0 closes forgotten terminals by itself: a Resume is no longer rare.
  if (resume || !up || !card.prompt?.trim()) return { name, up, winId, pasted: false }

  await waitForPrompt(winId)

  if (capabilities.terminal.pasteWithoutSending) {
    const res = await terminal.paste(card.prompt.trim(), winId)
    if (res.pasted) return { name, up, winId, ...res }
  }

  // Pasting is unavailable or was refused — on macOS that means no Accessibility permission.
  // We type it instead, which sends it.
  const fallback = await terminal.type(card.prompt.trim(), winId)
  return { name, up, winId, pasted: false, autoSent: fallback.written, ...fallback }
}
