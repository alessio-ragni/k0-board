import os from 'node:os'
import path from 'node:path'
import { run } from '../shared/run.js'
import { startDictate, stopDictate } from './service.js'

// k0 Dictate is a small Swift app of its own (dictate/), built on this Mac like the menu bar icon.
// It needs macOS 26: Apple's on-device speech engine, SpeechAnalyzer, arrived there. The Darwin
// kernel's major version is the cheapest honest way to know — 25 is macOS 26.

const darwinMajor = Number(String(os.release()).split('.')[0]) || 0

export const capabilities = { dictation: darwinMajor >= 25 }

export const notes = capabilities.dictation
  ? {}
  : {
      dictation:
        'Dictation needs macOS 26 or later: the speech engine it relies on is built into macOS ' +
        'from that version, and this Mac is older.',
    }

/**
 * Builds the app from `source` (the dictate/ folder of this copy of k0) into `out`, if its source
 * changed, and opens it. `out` is outside the copy of k0, so reinstalling k0 does not rebuild it.
 * The build takes a few seconds the first time and none afterwards; opening an app that is
 * already running does nothing.
 */
export async function launch({ source, out }) {
  const app = await build({ source, out })
  await run('/usr/bin/open', [app])
  return { app }
}

async function build({ source, out }) {
  await run('/bin/bash', [path.join(source, 'build.sh'), out], { timeout: 180_000 })
  return path.join(out, 'k0 Dictate.app')
}

/** Dictation switched on: built if it has to be, then started now and at every login. */
export async function enable({ source, out, port, logDir }) {
  const app = await build({ source, out })
  await startDictate({ binary: path.join(app, 'Contents', 'MacOS', 'k0-dictate'), port, logDir })
  return { app }
}

/** Switched off: the login agent goes, and with it the copy it started. */
export async function disable() {
  await stopDictate()
}
