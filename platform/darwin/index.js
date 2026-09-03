import * as terminal from './terminal.js'
import * as power from './power.js'
import * as metrics from './metrics.js'
import * as servers from './servers.js'
import * as shell from './shell.js'
import * as service from './service.js'
import { extras } from './extras.js'
import { NO_CAPABILITIES } from '../contract.js'

export const name = 'macOS'

export const capabilities = {
  ...NO_CAPABILITIES,
  terminal: terminal.capabilities,
  power: power.capabilities,
  metrics: metrics.capabilities,
  servers: servers.capabilities(),
  service: service.capabilities,
  tray: true,
  revealInFileManager: true,
  openInFileManager: true,
}

/**
 * Nothing is missing here, so there is nothing to explain — with one exception that is not
 * about macOS but about a particular Mac: lsof ships with the system, and if it has been taken
 * away k0 says what it can no longer see rather than showing every dev server as off.
 */
export const notes = {
  ...(capabilities.servers.ports
    ? {}
    : {
        'servers.ports':
          'lsof was not found on this Mac. It ships with macOS, so something has removed or ' +
          'blocked it — without it k0 cannot see which port a dev server is listening on, or ' +
          'recognise one you started yourself.',
      }),
}

export { terminal, power, metrics, servers, shell, service, extras }
