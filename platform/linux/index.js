import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as tmux from '../shared/tmux.js'
import * as power from './power.js'
import * as metrics from './metrics.js'
import * as servers from './servers.js'
import * as shell from './shell.js'
import * as service from './service.js'
import { NO_CAPABILITIES } from '../contract.js'
import { which } from '../shared/run.js'

export const name = 'Linux'

export const terminal = tmux

export const trayScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tray.py')

export const capabilities = {
  ...NO_CAPABILITIES,
  terminal: tmux.capabilities(),
  power: power.capabilities(),
  metrics: metrics.capabilities(),
  servers: servers.capabilities(),
  service: service.capabilities(),
  tray: !!which('python3'),
  revealInFileManager: shell.capabilities().revealInFileManager,
}

export const notes = {
  ...power.notes,
  ...metrics.notes,
  ...service.notes,
  ...(capabilities.terminal.readScreen
    ? {}
    : {
        'terminal.readScreen':
          'tmux was not found. k0 drives terminals through tmux on Linux — without it, it ' +
          'cannot open a session, read when Claude Code is ready, or place your prompt. ' +
          'Install tmux and run `k0-board doctor` again.',
      }),
  ...(capabilities.terminal.windows
    ? {}
    : {
        'terminal.windows': tmux.isWayland()
          ? 'Wayland does not let one application move another’s windows, by design. k0 opens ' +
            'terminals but cannot place, resize or raise them; your compositor decides where ' +
            'they go.'
          : 'Install xdotool (or wmctrl) to let k0 place and raise terminal windows.',
      }),
  'terminal.font':
    'Font size belongs to your terminal emulator and every one of them spells it differently, ' +
    'so driving mode enlarges the board but not the terminals. Set a bigger font in your ' +
    'emulator’s own preferences if you want both.',
  ...(capabilities.tray
    ? {}
    : { tray: 'python3 with PyGObject is needed for a tray icon. The board works without it.' }),
  ...(capabilities.servers.ports
    ? {}
    : {
        'servers.ports':
          'Neither ss nor lsof was found, so k0 cannot see which port a dev server is listening ' +
          'on. Install iproute2 (for ss) and the globe will know where to send you.',
      }),
  ...(capabilities.servers.adopt
    ? {}
    : {
        'servers.adopt':
          'This system has no /proc, so k0 cannot tell which repository a dev server you ' +
          'started yourself belongs to. The globe switches on and off the servers k0 started, ' +
          'and says nothing about the others rather than showing them as off.',
      }),
}

export { power, metrics, servers, shell, service }

/** Nothing on Linux reaches outside k0's own files, so there is nothing to consent to. */
export const extras = []
