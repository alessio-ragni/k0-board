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

/**
 * What is under the cursor: the text after the `❯` of the input box, as it reads on screen.
 *
 * The box is the last line with a `❯` on it — the sent messages above it are echoed with the
 * same mark, but they are above it. Null when there is no such line at all: a dialog, the trust
 * question, the interface still drawing. A menu with its `❯` on the chosen row reads as text,
 * which is the right answer, because a key pressed there picks something.
 */
export function promptText(screen) {
  if (!screen) return null
  const lines = screen.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\s*❯(.*)$/.exec(lines[i])
    if (m) return m[1].trim()
  }
  return null
}

/**
 * Free to write in: nothing after the `❯`, or only the hint Claude Code prints in grey on a box
 * that has never been typed in — `Try "how do I log an error?"` — which the next key replaces.
 */
export function promptIsEmpty(screen) {
  const text = promptText(screen)
  return text !== null && (text === '' || text.startsWith('Try "'))
}

/**
 * How long a session is left alone after a rename was typed into it: long enough for the name
 * in its session file to change, which is how the next round knows it took. After a refusal —
 * the window not in front, something under the cursor — it is looked at again sooner.
 */
export const RENAME_RETRY_MS = 60000
export const RENAME_REFUSED_MS = 5000
const attempted = new Map() // session id -> { name, until }

/**
 * Whether a live session is waiting to be renamed, and can be right now.
 *
 * Only a session that is sitting idle — the raw status from its session file: no turn running,
 * no dialog open — and only where the platform can type a command into it and read back what
 * it typed. A session file without a `name` is an older Claude Code: k0 could type the command
 * but never see whether it took, and it would go on typing it, so there the name catches up
 * when the session ends.
 */
export function renameDue(story, session, now = Date.now()) {
  if (!session || session.status !== 'idle' || !('name' in session)) return false
  if (!story.terminal_window_id || !capabilities.terminal.commands) return false
  const name = sessionName(story.title)
  if (session.name === name) return false
  const last = attempted.get(story.session_id)
  return !(last && last.name === name && last.until > now)
}

/**
 * Types `/rename` with the story's name into the session's window — if that window is the one in
 * front of you. The adapter never raises it: the keyboard belongs to whatever you are doing, so
 * the rename waits until you look at the session, and happens then.
 */
export async function renameLive(story) {
  const name = sessionName(story.title)
  const line = `/rename ${name}`
  // Written down before the keys go in, not after: the watching loop asks again a second later,
  // and typing takes longer than that — two rounds typing the same command into one box is a
  // box with the command in it twice.
  attempted.set(story.session_id, { name, until: Date.now() + RENAME_REFUSED_MS })
  const res = await terminal.command(line, story.terminal_window_id, {
    ready: promptIsEmpty,
    verify: (screen) => promptText(screen) === line,
  })
  attempted.set(story.session_id, { name, until: Date.now() + (res.sent ? RENAME_RETRY_MS : RENAME_REFUSED_MS) })
  return { ...res, name }
}

/** In driving mode the terminal has to be readable from across the room. */
const DRIVING_FONT_SIZE = 22

/** And a window worth glancing at from there takes the whole screen, not its usual share of it. */
const DRIVING_COVERAGE = 1

/** How big the text has to be right now: it depends only on the mode in force. */
const fontSize = () => (isDriving() ? Promise.resolve(DRIVING_FONT_SIZE) : terminal.defaultFontSize())

/** And how much screen the window takes. Undefined means "your usual share", whatever it is. */
const coverage = () => (isDriving() ? DRIVING_COVERAGE : undefined)

/**
 * Puts every window k0 owns the way the mode in force wants it, text and size in one gesture.
 * It runs on every mode change and once more at startup, which is what repairs the windows a
 * server restart left behind at the wrong size.
 */
export async function applyModeToWindows(handles) {
  return terminal.applyMode(handles, { fontSize: await fontSize(), coverage: coverage() })
}

export const relayoutWindows = (handles) => terminal.relayout(handles, { coverage: coverage() })
export const setWindowTitle = (handle, title) => terminal.setTitle(handle, title)
export const focusWindow = (handle, title) => terminal.focus(handle, title)
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
 * What every session is started with, new or resumed.
 *
 * Claude Code decides when it starts, model by model, whether a session gets its task tools —
 * TaskCreate, TaskUpdate and the rest — and a newer model such as Opus 5 does not get them unless
 * this is in the environment. The commands k0 ships keep a task per step of the work, so without
 * it a session is told to do something it has no tool for, and nothing warns: the call is refused
 * and the model carries on without. It is read at startup, which is why a resume carries it too.
 */
export const SESSION_ENV = { CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' }

/**
 * Starts (or resumes) a story's session.
 * mode: 'start' assigns a new session id, 'resume' reopens the existing one.
 *
 * `story` is the flat row `db.listStories()` hands over, session and all: `auto_send` lives on
 * the session now, and it is read from there through the same row rather than looked up again.
 */
export async function launch({ story, sessionId, mode = 'start' }) {
  const name = sessionName(story.title)
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
  const autoSend = mode === 'start' && story.auto_send && story.prompt?.trim()
  if (autoSend) args.push(story.prompt.trim())

  const command = terminal.buildCommand({ cwd: story.project_path, bin, args, env: SESSION_ENV })
  const winId = await terminal.open({ command, title: name, fontSize: await fontSize(), coverage: coverage() })
  const up = await waitForSession(sessionId)

  if (autoSend) return { name, up, winId, pasted: true, autoSent: true }
  // The prompt belongs to the beginning. Resuming picks up a conversation that answered it hours
  // ago, and putting it back under the cursor is at best a stale instruction in the way — at
  // worst it is sent, because where pasting is unavailable the fallback below types it. This
  // matters more now that k0 closes forgotten terminals by itself: a Resume is no longer rare.
  if (resume || !up || !story.prompt?.trim()) return { name, up, winId, pasted: false }

  await waitForPrompt(winId)

  if (capabilities.terminal.pasteWithoutSending) {
    const res = await terminal.paste(story.prompt.trim(), winId)
    if (res.pasted) return { name, up, winId, ...res }
  }

  // Pasting is unavailable or was refused — on macOS that means no Accessibility permission.
  // We type it instead, which sends it.
  const fallback = await terminal.type(story.prompt.trim(), winId)
  return { name, up, winId, pasted: false, autoSent: fallback.written, ...fallback }
}
