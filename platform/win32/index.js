import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as terminal from './terminal.js'
import * as power from './power.js'
import * as metrics from './metrics.js'
import * as servers from './servers.js'
import * as shell from './shell.js'
import * as service from './service.js'
import { NO_CAPABILITIES } from '../contract.js'
import { which } from '../shared/run.js'

export const name = 'Windows'

export const trayScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tray.ps1')

const hasPowerShell = () => !!(which('pwsh') || which('powershell'))

export const capabilities = {
  ...NO_CAPABILITIES,
  terminal: terminal.capabilities(),
  power: power.capabilities(),
  metrics: metrics.capabilities(),
  servers: servers.capabilities(),
  service: service.capabilities(),
  tray: hasPowerShell(),
  revealInFileManager: true,
}

export const notes = {
  ...power.notes,
  ...metrics.notes,
  'terminal.readScreen':
    'Windows gives no way to read what is printed inside another process’s console, so k0 ' +
    'cannot tell exactly when Claude Code has finished starting: it waits a fixed moment ' +
    'instead. On a slow machine the prompt can arrive early — press Escape, then paste it ' +
    'again from the card.',
  'terminal.title':
    'Windows Terminal owns its tab titles, so renaming a card does not rename a window that ' +
    'is already open. The new name shows up next time the session starts.',
  'terminal.font':
    'Font size lives in your terminal’s own profile, which k0 will not rewrite, so driving ' +
    'mode enlarges the board but not the terminals.',
  ...(hasPowerShell()
    ? {}
    : {
        'terminal.windows':
          'PowerShell was not found. k0 needs it to open, place and raise terminal windows on ' +
          'Windows.',
      }),
  'servers.adopt':
    'Windows does not let one process read another’s working directory, so k0 cannot tell ' +
    'which repository a dev server you started yourself belongs to. The globe switches on and ' +
    'off the servers k0 started, and says nothing about the others rather than showing them ' +
    'as off.',
  ...(hasPowerShell()
    ? {}
    : {
        'servers.ports':
          'PowerShell was not found, so k0 cannot see which port a dev server is listening on. ' +
          'It can still start and stop one, but the globe cannot open it for you.',
      }),
}

export { terminal, power, metrics, servers, shell, service }

/** Nothing on Windows reaches outside k0's own files, so there is nothing to consent to. */
export const extras = []
