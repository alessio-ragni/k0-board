import * as terminal from './terminal.js'
import * as power from './power.js'
import * as metrics from './metrics.js'
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
  service: service.capabilities,
  tray: true,
  revealInFileManager: true,
}

/** Nothing is missing here, so there is nothing to explain. */
export const notes = {}

export { terminal, power, metrics, shell, service, extras }
