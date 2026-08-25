import { run, runQuiet, which } from '../shared/run.js'

/**
 * PowerShell is how k0 talks to Windows.
 *
 * Everything Windows-specific here — window handles, process trees, execution state, the
 * tray icon — is reachable from PowerShell without installing anything, which is the whole
 * reason it is used rather than a native module. k0 has no dependencies and is not about to
 * grow one that needs a compiler on the user's machine.
 *
 * PowerShell 7 (`pwsh`) is preferred where it exists and Windows PowerShell 5.1 is the
 * fallback, because 5.1 is on every Windows install and the scripts here stay inside what
 * both understand.
 */

export const POWERSHELL = () => which('pwsh') || which('powershell')

const BASE_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']

export const ps = (script, opts = {}) => run(POWERSHELL(), [...BASE_ARGS, script], opts)

export const psQuiet = (script, opts = {}) => runQuiet(POWERSHELL(), [...BASE_ARGS, script], opts)

/**
 * Ask PowerShell for JSON and get an object back.
 *
 * `-Depth 4` is not decoration: ConvertTo-Json truncates at depth 2 by default and silently
 * turns anything deeper into the string "System.Object[]". `-AsArray`-less output also
 * collapses a one-element list into a bare object, so single results are wrapped by the
 * caller rather than trusted to arrive as a list.
 */
export async function psJson(script, fallback = null) {
  const out = await psQuiet(`${script} | ConvertTo-Json -Depth 4 -Compress`)
  const text = String(out).trim()
  if (!text) return fallback
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

/** Single-quote a string for a PowerShell literal. */
export const psq = (s) => `'${String(s).replace(/'/g, "''")}'`
