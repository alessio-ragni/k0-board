import { NO_CAPABILITIES } from './contract.js'

/**
 * Picks the adapter for the machine k0 is running on.
 *
 * The import is dynamic because the three adapters reach for things that only exist on their
 * own platform, and a static import would pull all three into every process. `await` at the
 * top level of a module is fine here: the server does nothing before this resolves anyway.
 *
 * An unknown platform is not an error, it is a diagnosis. k0 loads, the board comes up, and
 * every capability reads false with a note explaining that this system has no adapter — which
 * is a far more useful thing to hand somebody on FreeBSD than a stack trace.
 */
const adapters = {
  darwin: () => import('./darwin/index.js'),
  linux: () => import('./linux/index.js'),
  win32: () => import('./win32/index.js'),
}

const load = adapters[process.platform]

const unsupported = {
  name: process.platform,
  capabilities: NO_CAPABILITIES,
  notes: {
    platform:
      `k0 has no adapter for ${process.platform} yet. The board and the file viewer work, but ` +
      'k0 cannot open terminals, keep the machine awake, or install itself as a service here. ' +
      'Adding a platform means filling in one directory under platform/ — see CONTRIBUTING.md.',
  },
  terminal: {
    open: async () => {
      throw new Error(`k0 cannot open terminals on ${process.platform} yet.`)
    },
    setTitle: async () => false,
    setFont: async () => ({ touched: 0 }),
    relayout: async () => ({ touched: 0 }),
    focus: async () => ({ ok: false, error: `Not supported on ${process.platform}` }),
    close: async () => ({ closed: false }),
    readScreen: async () => null,
    paste: async () => ({ pasted: false }),
    type: async () => ({ written: false }),
    defaultFontSize: async () => 12,
  },
  power: {
    state: async () => ({ onAcPower: true, charge: null }),
    inhibit: () => {},
    release: () => {},
    setLidSleepBlocked: async () => {},
    lidSleepBlocked: async () => false,
    releaseSync: () => {},
  },
  metrics: {
    processes: async () => new Map(),
    memory: async () => ({ total: 0, used: 0, app: 0, wired: 0, compressed: 0, cached: 0 }),
    swap: async () => ({ total: 0, used: 0 }),
    pressureLevel: async () => 1,
  },
  shell: {
    revealInFileManager: async () => {},
    openBrowser: async () => {},
    findChrome: () => null,
    homeSkipList: () => new Set(),
    findClaude: () => 'claude',
  },
  service: {
    install: async () => {
      throw new Error(`k0 cannot install a background service on ${process.platform} yet.`)
    },
    uninstall: async () => {},
    restart: async () => {},
    status: async () => ({ running: false }),
    describe: () => [],
  },
  extras: [],
}

const platform = load ? { ...unsupported, ...(await load()) } : unsupported

export default platform
export const { name, capabilities, notes, terminal, power, metrics, shell, service, extras } = platform

/**
 * Is this capability available here? Takes a dotted path, so callers read as a question:
 * `can('terminal.readScreen')`.
 */
export const can = (dotted) =>
  dotted.split('.').reduce((node, key) => (node == null ? undefined : node[key]), capabilities) === true

/** Why it is not, in a sentence meant for the user. */
export const why = (dotted) => notes[dotted] || null

/**
 * Everything the board needs to grey out what this machine cannot do, and say why.
 * Sent with /api/board so the interface never has to guess.
 */
export const report = () => ({ name, capabilities, notes })
