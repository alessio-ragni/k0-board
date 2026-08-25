import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { which } from '../shared/run.js'
import { ps, psJson, psq } from './powershell.js'

/**
 * Terminals on Windows.
 *
 * This is the adapter that gives something up, and it is worth being plain about what.
 *
 * Windows has no way for one process to read what is printed inside another's console. On
 * macOS `readScreen` is how k0 knows Claude Code's interface has finished drawing and is
 * ready to receive a prompt; here there is nothing to ask, so k0 waits a fixed moment
 * instead. That is a guess, and a slow machine can beat it — which is why the capability is
 * reported as missing rather than quietly approximated.
 *
 * Everything else survives. A prompt can be placed without being sent, because Windows lets
 * any process put text on the clipboard and send a Ctrl+V to the foreground window without
 * asking for a special permission — the thing macOS needs Accessibility for. Windows can be
 * moved, resized and raised through user32, found by the unique title k0 gives each one.
 *
 * If you run Claude Code inside WSL, run k0 inside WSL too: there it is simply the Linux
 * build, tmux and all, with nothing given up.
 */

const WT = () => which('wt')
const POWERSHELL_BIN = () => which('pwsh') || which('powershell')

/** The user32 declarations every window operation here needs, added once per PowerShell run. */
const USER32 = `
Add-Type -Namespace K0 -Name Win -MemberDefinition @'
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int t, bool r);
'@ -ErrorAction SilentlyContinue
`

/**
 * The handle k0 stores is the window title, because it is the only identifier that survives
 * the launch: `wt.exe` hands its arguments to an already-running Windows Terminal and exits,
 * so its own process id says nothing about the window that appeared.
 */
const handleFor = (title) => `k0-${randomUUID().slice(0, 8)} ${title}`.trim()

const findWindow = (handle) =>
  `Get-Process | Where-Object { $_.MainWindowTitle -like ${psq('*' + handle + '*')} } | Select-Object -First 1`

export async function open({ command, title }) {
  const handle = handleFor(title)
  const shell = POWERSHELL_BIN()
  if (!shell) throw new Error('k0 could not find PowerShell, which it needs to open terminals on Windows.')

  // The title is set from inside the session rather than passed to the terminal, because it
  // has to be there whichever terminal actually opens — Windows Terminal, the old console
  // host, or whatever the user has set as default.
  const inner = `$host.UI.RawUI.WindowTitle = ${psq(handle)}; ${command}`
  const wt = WT()
  const [file, args] = wt
    ? [wt, ['new-tab', '--title', handle, shell, '-NoProfile', '-NoLogo', '-NoExit', '-Command', inner]]
    : [shell, ['-NoProfile', '-NoLogo', '-NoExit', '-Command', inner]]

  const child = spawn(file, args, { stdio: 'ignore', detached: true, windowsHide: false })
  child.unref()
  return handle
}

/**
 * Windows Terminal owns its tab titles and does not take instructions about them from
 * outside, so a card renamed after its session started keeps the old name in the title bar
 * until the session is restarted. Reported as unavailable rather than failing silently.
 */
export async function setTitle() {
  return false
}

export async function focus(handle) {
  if (!handle) return { ok: false, error: 'This card has no terminal window of its own' }
  const found = await psJson(
    `${USER32}
     $p = ${findWindow(handle)}
     if ($p) { [K0.Win]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
               [K0.Win]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
               @{ ok = $true } } else { @{ ok = $false } }`,
    { ok: false }
  )
  return found?.ok ? { ok: true } : { ok: false, error: 'That window is gone' }
}

export async function relayout(handles) {
  let touched = 0
  for (const handle of handles || []) {
    const ok = await psJson(
      `${USER32}
       Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
       $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
       $w = [int]($area.Width * 0.86); $h = [int]($area.Height * 0.86)
       $x = $area.X + [int](($area.Width - $w) / 2); $y = $area.Y + [int](($area.Height - $h) / 2)
       $p = ${findWindow(handle)}
       if ($p) { [K0.Win]::MoveWindow($p.MainWindowHandle, $x, $y, $w, $h, $true) | Out-Null; @{ ok = $true } }
       else { @{ ok = $false } }`,
      { ok: false }
    )
    if (ok?.ok) touched++
  }
  return { touched }
}

/** Font size lives in the terminal's own profile, which k0 will not rewrite. */
export async function setFont() {
  return { touched: 0 }
}

export async function defaultFontSize() {
  return 12
}

/** Nothing to read: see the note at the top of this file. */
export async function readScreen() {
  return null
}

/**
 * Put the prompt in front of you without sending it: clipboard, then a Ctrl+V into the
 * window once it is in the foreground. SendKeys needs no elevation and no special permission
 * on Windows, which makes this the one place where Windows has an easier time than macOS.
 */
export async function paste(text, handle) {
  try {
    await ps(
      `${USER32}
       Add-Type -AssemblyName System.Windows.Forms
       $previous = ''
       try { $previous = Get-Clipboard -Raw } catch {}
       Set-Clipboard -Value ${psq(text)}
       $p = ${findWindow(handle)}
       if (-not $p) { throw 'window not found' }
       [K0.Win]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
       [K0.Win]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
       Start-Sleep -Milliseconds 250
       [System.Windows.Forms.SendKeys]::SendWait('^v')
       Start-Sleep -Milliseconds 250
       if ($previous) { Set-Clipboard -Value $previous }`,
      { timeout: 15000 }
    )
    return { pasted: true }
  } catch (err) {
    return { pasted: false, error: String(err.stderr || err.message).trim() }
  }
}

/**
 * The fallback: type the prompt and send it. Same trade as on macOS — the session starts on
 * its own instead of waiting for you — and used only when pasting failed.
 */
export async function type(text, handle) {
  try {
    await ps(
      `${USER32}
       Add-Type -AssemblyName System.Windows.Forms
       Set-Clipboard -Value ${psq(text)}
       $p = ${findWindow(handle)}
       if (-not $p) { throw 'window not found' }
       [K0.Win]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
       Start-Sleep -Milliseconds 250
       [System.Windows.Forms.SendKeys]::SendWait('^v')
       Start-Sleep -Milliseconds 250
       [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')`,
      { timeout: 15000 }
    )
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
      /* already gone */
    }
  }
  if (!handle) return { closed: false }
  const res = await psJson(
    `$p = ${findWindow(handle)}
     if ($p) { $p.CloseMainWindow() | Out-Null; @{ ok = $true } } else { @{ ok = $false } }`,
    { ok: false }
  )
  return { closed: !!res?.ok }
}

export const capabilities = () => ({
  windows: !!POWERSHELL_BIN(),
  font: false,
  readScreen: false,
  pasteWithoutSending: !!POWERSHELL_BIN(),
  title: false,
})

export { powershellCommand as buildCommand } from '../shared/command.js'
