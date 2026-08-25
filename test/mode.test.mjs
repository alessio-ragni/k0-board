import { check, section, after } from './harness.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// `mode.js` drags in `db.js`, which opens the database the moment it is imported: `K0_DB` is
// moved first, and only then is it loaded. A plain `import` at the top would open the real one —
// imports all resolve before the first line of code.
process.env.K0_DB = path.join(os.tmpdir(), `k0-mode-test-${process.pid}.db`)
const mode = await import('../server/mode.js')
const store = await import('../server/db.js')
const { parseSleepDisabled, parseBattery } = await import('../platform/darwin/power.js')
const { lidWanted, normalise, MODES, ORDER, THRESHOLD } = mode

// ── The four modes ───────────────────────────────────────────────────────────
section('The four modes')
// The scale, and the fact that each step includes the one before it: that is what makes it a
// scale rather than a list of independent switches.
check('there are four of them, in order', ORDER.join(' '), 'sleep away nerd driving')
check('in sleep nothing is switched on', MODES.sleep.inhibit, null)
check('and the machine is free to sleep', MODES.sleep.lid, false)
// 'system' stops idle sleep, 'display' also keeps the screen on: that word is the whole
// difference between "the machine stays awake" and "the screen stays on too".
check('away lets the screen sleep', MODES.away.inhibit, 'system')
check('nerd does not, you are sitting there', MODES.nerd.inhibit, 'display')
check('and neither does driving', MODES.driving.inhibit, 'display')
check('large type belongs to driving alone', ORDER.filter((m) => MODES[m].driving).join(), 'driving')
check('from away up the lid is covered', ORDER.filter((m) => MODES[m].lid).join(), 'away,nerd,driving')
// The only difference between the last two is the size of the text: if they ever diverged on
// anything else, this is where somebody should notice.
check(
  'nerd and driving do the same things to the machine',
  MODES.nerd.inhibit === MODES.driving.inhibit && MODES.nerd.lid === MODES.driving.lid,
  true
)

// A word that is not a mode must not blow anything up: it arrives from outside, and from
// outside anything can arrive.
check('an invented word falls back to away', normalise('turbo'), 'away')
check('and so does nothing at all', normalise(undefined), 'away')
check('a good one stays as it is', normalise('driving'), 'driving')
// The names an older k0 wrote are still understood, so an upgrade does not reset the mode.
check('the old Italian name for sleep is understood', normalise('sonno'), 'sleep')
check('and the old name for away', normalise('caffe'), 'away')

// ── The ban on sleeping ──────────────────────────────────────────────────────
section('The ban on sleeping')
// It is the only thing that holds with the lid closed, and it is read rather than remembered:
// if somebody else changed it, the truth is what the system says, not what we think.
const ON = `System-wide power settings:
Currently in use:
 standby              1
 SleepDisabled        1
 hibernatemode        3
 sleep                0 (sleep prevented by caffeinate)
 displaysleep         10`

const OFF = `System-wide power settings:
Currently in use:
 standby              1
 hibernatemode        3
 sleep                1 (sleep prevented by caffeinate, powerd)
 displaysleep         10`

check('the ban switched on is visible', parseSleepDisabled(ON), true)
// At zero the line can be missing altogether: "I did not find it" and "it is 0" are the same.
check('off is a line that is not there', parseSleepDisabled(OFF), false)
check('and if it were there, at zero, it would mean the same', parseSleepDisabled(' SleepDisabled        0'), false)
// The real command writes it with tabs, not spaces.
check('written with tabs too', parseSleepDisabled(' SleepDisabled\t\t1'), true)
check('nothing to read: no ban', parseSleepDisabled(''), false)
check('and nothing at all does not break it', parseSleepDisabled(undefined), false)
check('it is not confused by the other lines', parseSleepDisabled(' sleep 1\n displaysleep 10'), false)

// ── Where we are with the power ──────────────────────────────────────────────
section('Where we are with the power')
const MAINS = `Now drawing from 'AC Power'
 -InternalBattery-0 (id=22937699)\t66%; charging; 0:55 remaining present: true`

const BATTERY = `Now drawing from 'Battery Power'
 -InternalBattery-0 (id=22937699)\t66%; discharging; 3:12 remaining present: true`

const NEARLY_FLAT = `Now drawing from 'Battery Power'
 -InternalBattery-0 (id=22937699)\t7%; discharging; 0:14 remaining present: true`

// A desktop has no battery: the command only says where the power is coming from.
const DESKTOP = "Now drawing from 'AC Power'"

check('plugged in', parseBattery(MAINS).onAcPower, true)
check('and the charge is read all the same', parseBattery(MAINS).charge, 66)
check('unplugged', parseBattery(BATTERY).onAcPower, false)
check('with its charge', parseBattery(BATTERY).charge, 66)
check('nearly flat', parseBattery(NEARLY_FLAT).charge, 7)
check('a desktop is always on the mains', parseBattery(DESKTOP).onAcPower, true)
check('and has no charge to report', parseBattery(DESKTOP).charge, null)

// ── Who decides whether to cover the lid ─────────────────────────────────────
section('Who decides whether to cover the lid')
// The rule is written once, and this is it. The idle inhibitor has nothing to do with it: that
// follows the mode regardless, because it harms nobody.
//
// `supported` is passed explicitly so the rule can be checked on any platform, and not only on
// the one whose adapter happens to support the lid.
const wants = (o) => lidWanted({ supported: true, ...o })

check('in sleep the machine is free to sleep', wants({ mode: 'sleep', onAcPower: true, charge: 100 }), false)
check('and it stays free on a full battery', wants({ mode: 'sleep', onAcPower: false, charge: 90 }), false)
check('away on the mains: it is covered', wants({ mode: 'away', onAcPower: true, charge: 30 }), true)
check('nerd too', wants({ mode: 'nerd', onAcPower: true, charge: 30 }), true)
check('driving too', wants({ mode: 'driving', onAcPower: true, charge: 30 }), true)
check('on battery, but with charge to spare', wants({ mode: 'away', onAcPower: false, charge: 80 }), true)
// Below the threshold it lets go: a machine forbidden to sleep does not merely drain, it
// reaches zero and dies outright — which is worse than a session left waiting.
check('on a nearly flat battery: it lets go', wants({ mode: 'away', onAcPower: false, charge: 7 }), false)
check('and it lets go in driving as well', wants({ mode: 'driving', onAcPower: false, charge: 7 }), false)
check('the threshold is inclusive, it does not let go right there', wants({ mode: 'nerd', onAcPower: false, charge: THRESHOLD }), true)
check('one point below it does', wants({ mode: 'nerd', onAcPower: false, charge: THRESHOLD - 1 }), false)
// On a desktop there is no battery to save: the threshold must never fire.
check('with no battery no threshold holds', wants({ mode: 'away', onAcPower: false, charge: null }), true)
check('and an invented word follows away', wants({ mode: 'turbo', onAcPower: true, charge: 50 }), true)
// Where the platform cannot control the lid at all, the answer is no whatever the mode says.
check(
  'unsupported beats everything',
  lidWanted({ mode: 'driving', onAcPower: true, charge: 100, supported: false }),
  false
)

// ── Remembering it ───────────────────────────────────────────────────────────
section('Remembering it')
{
  check('never touched: it starts from away', store.getPref(mode.KEY, mode.DEFAULT), 'away')
  store.setPref(mode.KEY, 'driving')
  check('driving chosen, driving stays', store.getPref(mode.KEY, mode.DEFAULT), 'driving')
  store.setPref(mode.KEY, 'sleep')
  check('and changing it does not make duplicate rows', store.default.prepare('SELECT count(*) n FROM pref').get().n, 1)
  check('a key that is not there is worth the fallback', store.getPref('never-seen', 'nothing'), 'nothing')
  store.dropPref(mode.KEY)
  check('and one removed is gone', store.getPref(mode.KEY, null), null)
}

// The migration from the days when this was a single on/off switch: '1' or '0' under the old
// key, then a mode name under a differently-spelled key. Each is read once and retired, or the
// mode would start over from the default at every upgrade.
{
  const migrate = (key, old) => {
    for (const k of [mode.KEY, ...mode.LEGACY_KEYS]) store.dropPref(k)
    store.setPref(key, old)
    // The same rule as `start()`, without touching the system.
    for (const legacy of mode.LEGACY_KEYS) {
      const v = store.getPref(legacy, null)
      if (v === null) continue
      if (store.getPref(mode.KEY, null) === null) {
        store.setPref(mode.KEY, v === '0' ? 'sleep' : v === '1' ? 'away' : normalise(v))
      }
      store.dropPref(legacy)
    }
    return store.getPref(mode.KEY, null)
  }
  check('the old switch, on, becomes away', migrate('caffe', '1'), 'away')
  check('the old switch, off, becomes sleep', migrate('caffe', '0'), 'sleep')
  check('the old scale keeps its step', migrate('modo', 'nerd'), 'nerd')
  check("the old scale's Italian name is translated", migrate('modo', 'sonno'), 'sleep')
  check('and the old keys are retired', store.getPref('modo', null), null)
}

// Tidying up waits until the tests have run, which is what `after` is for. The handle has to go
// before the file does: on Windows a file that is still open cannot be deleted, and this line is
// the whole difference between a green build and a red one there.
after(async () => {
  ;(await import('../server/db.js')).close()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.K0_DB + suffix, { force: true })
})

