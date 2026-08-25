import * as db from './db.js'
import { power, capabilities } from '../platform/index.js'

// ── The four modes ────────────────────────────────────────────────────────────
// How awake the machine has to stay while sessions are working. A four-step scale, not two
// switches: because the two things were never independent. In driving mode the display MUST
// stay on — there is no point watching the board from across the room on a screen that turns
// itself off — and sitting in front of it programming is a third case that two booleans had
// no way to express.
//
//   sleep    the machine sleeps as it normally would
//   away     it does not sleep any more, not even with the lid closed; the display still does
//   nerd     you are sitting there: the display stays on too
//   driving  like nerd, plus everything set large — board and terminals
//
// Each line includes the one above it: that is what makes the four buttons a scale rather
// than a list. The only difference between nerd and driving is the size of the text.
//
// There are two levers, and an idle inhibitor alone is not enough on macOS: its assertions
// are all *idle* assertions, which stop sleep from inactivity but not the sleep that fires
// when the lid closes. That one takes a system flag and root. On Linux and Windows the lid
// belongs to a machine-wide setting that k0 refuses to rewrite on your behalf — see the notes
// in the platform adapters — so there the lid switch reports itself unavailable rather than
// promising something it will not deliver.

/**
 * What each mode means, in one place: anyone who wants to know what a mode does reads it
 * from here, and nobody works it out again for themselves.
 *
 * `inhibit` is the level handed to the platform: 'system' stops idle sleep, 'display' also
 * keeps the screen on. The difference between away and nerd is exactly that word.
 */
export const MODES = {
  sleep: { inhibit: null, lid: false, driving: false },
  away: { inhibit: 'system', lid: true, driving: false },
  nerd: { inhibit: 'display', lid: true, driving: false },
  driving: { inhibit: 'display', lid: true, driving: true },
}

/** Sleepiest to most awake: this is the order of the buttons on the board. */
export const ORDER = ['sleep', 'away', 'nerd', 'driving']

/** The one to start from, and the one to fall back to when an unknown word arrives. */
export const DEFAULT = 'away'

/** The key in `pref`, and the two it grew out of as k0 changed its mind about names. */
export const KEY = 'mode'
export const LEGACY_KEYS = ['modo', 'caffe']

/** Values written by older versions, and what they mean now. */
const LEGACY_VALUES = { sonno: 'sleep', caffe: 'away', nerd: 'nerd', driving: 'driving' }

/**
 * Below this charge, and only on battery, k0 lets go of the lid. A machine forbidden to sleep
 * does not merely drain: it reaches zero and dies outright, which is worse than a session
 * left waiting. The idle inhibitor stays — that one is harmless — and everything resumes by
 * itself as soon as the power is back.
 */
export const THRESHOLD = 15

let mode = DEFAULT
let lidHeld = false // is the lid block really in force RIGHT NOW
let supply = { onAcPower: true, charge: null } // the power as it was last looked at
let stopped = false // the kettle is already off the hob (shutting down)

// ── Read, do not imagine ──────────────────────────────────────────────────────

/** A word that is not a mode must not blow anything up: it falls back to the default. */
export const normalise = (m) => {
  const s = String(m)
  if (Object.hasOwn(MODES, s)) return s
  if (Object.hasOwn(LEGACY_VALUES, s)) return LEGACY_VALUES[s]
  return DEFAULT
}

/**
 * Whether the lid block belongs on or off: the whole rule, in one place. The mode asks for it,
 * except on a nearly flat battery — and except where the platform cannot do it at all.
 *
 * `supported` defaults to what this machine can do and is passed explicitly by the tests, so the
 * rule can be checked on any platform rather than only on the one that happens to support it.
 */
export function lidWanted({ mode: m, onAcPower, charge, supported = capabilities.power.lidSleep }) {
  if (!supported) return false
  if (!MODES[normalise(m)].lid) return false
  if (onAcPower || charge === null) return true
  return charge >= THRESHOLD
}

// ── What the rest of the house knows ─────────────────────────────────────────

export const current = () => mode
export const lid = () => lidHeld

/**
 * Whether the text goes large. `launcher.js` asks for every window that is born, and it is
 * the only thing driving mode needs the outside world to know.
 */
export const isDriving = () => MODES[mode].driving

/**
 * Why we are in the state we are in. The board needs it to say so in words above the lit
 * button: a mode that promises the lid closed and cannot deliver has to be able to say so,
 * otherwise it is promising something it does not do.
 */
export function reason() {
  if (mode === 'sleep') return 'sleep'
  if (lidHeld) return 'full'
  if (!capabilities.power.lidSleep) return 'unsupported'
  if (!lidWanted({ mode, ...supply })) return 'battery'
  return 'no-permission'
}

/**
 * Brings the world into line with the mode. At the end it reads back how it actually turned
 * out instead of trusting the command it just gave: what matters is what the machine is
 * doing, not what we believed we had told it.
 */
export async function apply() {
  supply = await power.state()
  power.inhibit(MODES[mode].inhibit)
  await power.setLidSleepBlocked(lidWanted({ mode, ...supply }))
  lidHeld = await power.lidSleepBlocked()
}

export async function setMode(m) {
  mode = normalise(m)
  db.setPref(KEY, mode)
  await apply()
}

/**
 * At server startup. Puts the machine back the way you left it — driving included, which it
 * used not to remember — and repairs the awkward case: mode `sleep` but the lid block left at
 * 1 by a server that died badly. Putting it back to 0 is part of the job, otherwise the
 * machine never sleeps again and nobody knows why.
 */
export async function start() {
  migrateLegacyPref()
  mode = normalise(db.getPref(KEY, DEFAULT))
  await apply()
}

/**
 * k0 has renamed this preference twice: `caffe` when it was a single on/off switch, then
 * `modo` when it became a scale, and now `mode`. Each old key is read once and retired, so an
 * upgraded k0 does not start over from the default.
 */
function migrateLegacyPref() {
  for (const legacy of LEGACY_KEYS) {
    const value = db.getPref(legacy, null)
    if (value === null) continue
    if (db.getPref(KEY, null) === null) {
      // The oldest key held '1' or '0' rather than a mode name.
      db.setPref(KEY, value === '0' ? 'sleep' : value === '1' ? 'away' : normalise(value))
    }
    db.dropPref(legacy)
  }
}

/**
 * A check-up round, which the server's `tick` calls once a minute. It does two things: follow
 * the battery down (and the power coming back), and put the inhibitor back up if something
 * killed it from outside.
 */
export async function guard() {
  if (stopped) return
  await apply()
}

/**
 * The last gesture on the way out. Synchronous on purpose: from `process.on('exit')` nothing
 * asynchronous gets to start any more, and this is the net that stops a machine being left
 * awake forever because k0 went away while it was on. The preference is left alone: next
 * time, `start()` puts everything back.
 */
export function stopNow() {
  if (stopped) return
  stopped = true
  power.releaseSync()
  lidHeld = false
}
