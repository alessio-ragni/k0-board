/**
 * The line between k0 and the operating system.
 *
 * Everything above this file — the board, the watcher, the API — is the same on every
 * machine. Everything below it is not: opening a terminal window is AppleScript on macOS,
 * tmux on Linux and Windows Terminal on Windows, and none of those three agree on what a
 * "window" even is. Rather than sprinkle `process.platform` checks through the server, all
 * of it goes behind the small surface described here, and each platform fills it in.
 *
 * Two rules keep this honest.
 *
 * **An adapter never pretends.** If a platform cannot do something — read back what is on a
 * terminal's screen, stop the machine sleeping when the lid closes — it says so in
 * `capabilities` and the feature is visibly switched off in the interface. A button that
 * quietly does nothing is worse than a button that is greyed out with a reason next to it.
 *
 * **Capabilities are read at runtime, not guessed from the platform name.** Whether window
 * geometry works on Linux depends on X11 versus Wayland, not on "linux"; whether Windows can
 * read a terminal's contents depends on whether WSL is installed. Adapters probe.
 *
 * @typedef {object} Capabilities
 * @property {object} terminal
 * @property {boolean} terminal.windows              can place, size and focus windows
 * @property {boolean} terminal.font                 can change the font size of a live terminal
 * @property {boolean} terminal.readScreen           can read back what is on screen
 * @property {boolean} terminal.pasteWithoutSending  can leave a prompt sitting unsent
 * @property {boolean} terminal.title                can rename a window from outside
 * @property {object} power
 * @property {boolean} power.keepAwake               can stop idle sleep
 * @property {boolean} power.keepDisplayAwake        can stop the display sleeping
 * @property {boolean} power.lidSleep                can stop sleep-on-lid-close
 * @property {boolean} power.battery                 can read charge and power source
 * @property {object} metrics
 * @property {boolean} metrics.pressure              the kernel publishes a memory-pressure verdict
 * @property {boolean} metrics.swap                  swap usage is readable
 * @property {object} servers
 * @property {boolean} servers.run                   can start and stop a project's dev server
 * @property {boolean} servers.ports                 can tell which port a process is listening on
 * @property {boolean} servers.adopt                 can recognise a server started outside k0
 * @property {object} service
 * @property {boolean} service.autostart             can register a service that starts at login
 * @property {boolean} tray                          a menu bar / system tray icon is available
 * @property {boolean} revealInFileManager           can show a file selected in the file manager
 * @property {boolean} openInFileManager             can open a directory in the file manager
 */

/**
 * What an adapter that can do nothing would look like. Adapters spread this and override,
 * so a capability added here later defaults to "no" everywhere instead of crashing.
 */
export const NO_CAPABILITIES = {
  terminal: { windows: false, font: false, readScreen: false, pasteWithoutSending: false, title: false },
  power: { keepAwake: false, keepDisplayAwake: false, lidSleep: false, battery: false },
  metrics: { pressure: false, swap: false },
  servers: { run: false, ports: false, adopt: false },
  service: { autostart: false },
  tray: false,
  revealInFileManager: false,
  openInFileManager: false,
}

/**
 * The reason a capability is missing, in a sentence the board can show to the user.
 * Keys are dotted capability paths, e.g. `terminal.readScreen`.
 * @typedef {Record<string, string>} CapabilityNotes
 */

/**
 * @typedef {object} TerminalAdapter
 * @property {(opts: {command: string, title: string}) => Promise<string|null>} open
 *   Opens a terminal running `command` and returns an opaque handle, or null if the
 *   platform has no notion of a handle it can address later.
 * @property {(handle: string, title: string) => Promise<boolean>} setTitle
 * @property {(handles: string[]) => Promise<{touched: number}>} setFont
 *   Applies the font size the current mode asks for, leaving each window where it is.
 * @property {(handles: string[]) => Promise<{touched: number}>} relayout
 * @property {(handle: string) => Promise<{ok: boolean, error?: string}>} focus
 * @property {(opts: {handle: string, pid?: number}) => Promise<{closed: boolean}>} close
 * @property {(handle: string) => Promise<string|null>} readScreen
 *   What is on screen right now, or null when this platform cannot look.
 * @property {(text: string, handle: string) => Promise<{pasted: boolean, error?: string}>} paste
 *   Puts `text` in front of the user WITHOUT submitting it.
 * @property {(text: string, handle: string) => Promise<{written: boolean, error?: string}>} type
 *   Writes `text` and submits it. The fallback when `paste` is unavailable.
 * @property {() => Promise<number>} defaultFontSize
 */

/**
 * @typedef {object} PowerAdapter
 * @property {() => Promise<{onAcPower: boolean, charge: number|null}>} state
 * @property {(level: null|'system'|'display') => void} inhibit
 *   Keeps the machine awake. 'system' stops idle sleep, 'display' also keeps the screen on,
 *   null lets everything sleep normally. Idempotent: calling it with the level already in
 *   force does nothing.
 * @property {() => void} release
 * @property {(blocked: boolean) => Promise<void>} setLidSleepBlocked
 * @property {() => Promise<boolean>} lidSleepBlocked
 * @property {() => void} releaseSync
 *   The last gesture on the way out, from `process.on('exit')`, where nothing async can
 *   still start. This is what stops a machine being left awake forever.
 */

/**
 * @typedef {object} MetricsAdapter
 * @property {() => Promise<Map<number, {ppid: number, rss: number, cpu: number, cmd: string}>>} processes
 * @property {() => Promise<{total: number, used: number, app: number, wired: number, compressed: number, cached: number}>} memory
 * @property {() => Promise<{total: number, used: number}>} swap
 * @property {() => Promise<number>} pressureLevel  1 normal, 2 warning, 4 critical
 */

/**
 * The dev server a project runs while you are working on it — the one the globe in the column
 * heading switches on and off. k0 starts it detached, so it outlives both the session that
 * asked for it and k0 itself; what this adapter adds is the two things only the operating
 * system knows, and the one gesture Node cannot make portably.
 *
 * @typedef {object} ServersAdapter
 * @property {() => {run: boolean, ports: boolean, adopt: boolean}} capabilities
 * @property {() => Promise<Map<number, Set<number>>>} listeners
 *   Every process holding a TCP port open, and which ports. This is how k0 knows a server is
 *   up: not by asking it, which would be a network request, but by seeing it hold the socket.
 * @property {(pids: number[]) => Promise<Map<number, string>>} cwds
 *   Where each of those processes is working from, which is what ties one to a repository.
 *   An adapter that cannot say returns an empty map and reports `adopt: false`.
 * @property {(command: string) => {file: string, args: string[]}} shell
 *   How to run `command` inside a project. It goes through a LOGIN shell on Unix, and that is
 *   not a flourish: the server runs from a launch agent whose PATH is barely more than
 *   /usr/bin:/bin, while npm and node usually arrive from a version manager whose PATH only
 *   exists inside a shell. It is the same reason `findClaude` ends up in a shell.
 * @property {(root: number, pids: number[], signal?: string) => Promise<boolean>} stop
 *   Stops the server and everything it started. `pids` is the whole subtree, `root` included:
 *   killing the top process alone leaves the real server holding the port.
 */

/**
 * @typedef {object} ShellAdapter
 * @property {(absPath: string) => Promise<unknown>} revealInFileManager
 *   Shows the file in its own folder, selected. A folder handed to this gets selected in its
 *   parent, which is the neighbouring thing and not the same one.
 * @property {(absDir: string) => Promise<unknown>} openInFileManager
 *   Opens the directory itself, so you are looking at what is inside it.
 * @property {(url: string) => Promise<unknown>} openBrowser
 * @property {() => string|null} findChrome        a Chromium-family browser able to print
 * @property {() => Set<string>} homeSkipList      directories under $HOME that are never projects
 * @property {() => string} findClaude             the Claude Code binary
 */

/**
 * @typedef {object} ServiceAdapter
 * @property {(opts: {node: string, entry: string, port: number, logDir: string, tray?: string}) => Promise<void>} install
 * @property {() => Promise<void>} uninstall
 * @property {() => Promise<void>} restart
 * @property {() => Promise<{running: boolean}>} status
 * @property {() => {path: string, what: string}[]} describe
 *   Everything this adapter will write, for the consent screen the installer shows before
 *   it touches anything. If it is not in this list, the installer must not create it.
 */

/**
 * @typedef {object} PlatformAdapter
 * @property {string} name
 * @property {Capabilities} capabilities
 * @property {CapabilityNotes} notes
 * @property {TerminalAdapter} terminal
 * @property {PowerAdapter} power
 * @property {MetricsAdapter} metrics
 * @property {ServersAdapter} servers
 * @property {ShellAdapter} shell
 * @property {ServiceAdapter} service
 */
