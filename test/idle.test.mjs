import { check, section, after } from './harness.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// `settings.js` reads `HOME` out of `paths.js` to decide where the file goes, and that is decided
// at import time. So the home is moved somewhere harmless BEFORE the import — a plain `import` at
// the top would resolve first and k0 would write into the real `~/.k0`. Same trap, and the same
// answer, as in mode.test.mjs and servers.test.mjs. Nothing here opens the database.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-idle-test-'))
process.env.K0_HOME = TMP
process.env.K0_CONFIG = path.join(TMP, 'config.json')
const { dueForClose, lastSignOfLife } = await import('../server/idle.js')
const settings = await import('../server/settings.js')

// A round number to measure from, so the same input gives the same answer whenever it runs.
const NOW = 1_700_000_000_000
const HOUR = 3600000
const ago = (h) => NOW - h * HOUR

/**
 * A card as `db.listCards()` hands it over, and the session file entry that goes with it. The
 * default is the case that must be closed — yellow, alive, idle, untouched for a day — so every
 * check below is one word away from it and says what that word does.
 */
const card = (over = {}) => ({
  id: 1,
  title: 'A card',
  status: 'IDLE',
  session_id: 's1',
  session_alive: 1,
  completed_at: null,
  terminal_window_id: 'w1',
  updated_at: ago(24),
  status_since: ago(24),
  ...over,
})

const session = (over = {}) => ({ pid: 100, status: 'idle', updatedAt: ago(24), statusUpdatedAt: ago(24), ...over })

/** The ids k0 would close, as one string, because a failure has to print something readable. */
const swept = ({ cards, live = null, hours = 12 }) =>
  dueForClose({
    cards,
    live: live ?? new Map(cards.filter((c) => c.session_id).map((c) => [c.session_id, session()])),
    hours,
    now: NOW,
  })
    .map((c) => c.id)
    .join(',')

const one = (over, live) => swept({ cards: [card(over)], live })

// ── The window that gets closed ──────────────────────────────────────────────
section('The window that gets closed')
// The whole feature in one line: yellow, still alive, and nobody has been near it for a day.
check('a yellow one nobody has touched all day', one({}), '1')
check('and it is still closed at exactly the hour', one({ updated_at: ago(12), status_since: ago(12) }), '1')
// One millisecond the other side of the line is not the line. Being wrong here closes a terminal
// somebody was about to go back to, which is the expensive direction.
check('a millisecond short of it is not', one({ updated_at: ago(12) + 1, status_since: ago(12) + 1 }), '')
check('and something touched an hour ago certainly is not', one({ updated_at: ago(1), status_since: ago(1) }), '')

// ── What is left alone ───────────────────────────────────────────────────────
section('What is left alone')
// The two blues are somebody mid-thought: stopping one is not memory saved, it is work lost.
check('one that is working', one({ status: 'WORKING' }), '')
check('one that is working inside a plan', one({ status: 'PLANNING' }), '')
// These two are the ones that would actually destroy something. A question and a finished plan are
// drawn by the terminal and are not in the transcript yet, so closing the window throws away the
// very thing it was showing you. Neither counts as `busy`, so nothing else was going to stop it.
check('one with a question on screen', one({ status: 'ASK' }), '')
check('one with a plan waiting for a yes', one({ status: 'PLANNED' }), '')
check('one that never started', one({ status: 'BACKLOG', session_id: null }), '')
check('one already ticked off', one({ completed_at: ago(20) }), '')
// Nothing to close: this card's terminal went some time ago and the card is only waiting for a
// Resume. Closing it again would mark it as k0's doing for no reason.
check('one whose session is already gone', one({ session_alive: 0 }), '')
// A shell is a shell YOU dropped into, and there may well be a command of yours running in it.
// k0 cannot see what, so k0 does not touch it — even though it reads as yellow on the board.
check('one sitting in a shell', one({}, new Map([['s1', session({ status: 'shell' })]])), '')
// The status says the process is alive but the session files say otherwise: believe the files.
check('one whose process is not really there', one({}, new Map()), '')

// ── The most recent sign of life wins ────────────────────────────────────────
section('The most recent sign of life wins')
// Resuming leaves the status at IDLE, so no new event is written and `status_since` stays as old
// as it ever was. Without taking the maximum, k0 would close a terminal it had just opened.
check(
  'a card resumed a minute ago is not old, whatever its history says',
  one({ updated_at: ago(0.01) }, new Map([['s1', session({ updatedAt: ago(0.01), statusUpdatedAt: ago(0.01) })]])),
  ''
)
check(
  'and a card whose session file alone is fresh is spared too',
  one({}, new Map([['s1', session({ updatedAt: ago(0.5) })]])),
  ''
)
check(
  'the newest of the four clocks is the answer',
  lastSignOfLife({ updated_at: 10, status_since: 40 }, { updatedAt: 20, statusUpdatedAt: 30 }),
  40
)
check('and a clock that is simply missing does not win', lastSignOfLife({ updated_at: 10 }, {}), 10)

// ── Switched off ─────────────────────────────────────────────────────────────
section('Switched off')
// Zero hours is the off switch, and it has to be an outright refusal rather than a very short
// timeout: `now - 0` is now, and every idle card on the board would go at once.
check('at zero hours nothing is closed', swept({ cards: [card()], hours: 0 }), '')
check('and a negative number is not an invitation either', swept({ cards: [card()], hours: -5 }), '')

// ── More than one at a time ──────────────────────────────────────────────────
section('More than one at a time')
{
  const cards = [
    card({ id: 1 }),
    card({ id: 2, session_id: 's2', status: 'ASK' }),
    card({ id: 3, session_id: 's3' }),
    card({ id: 4, session_id: 's4', updated_at: ago(2), status_since: ago(2) }),
  ]
  const live = new Map(cards.map((c) => [c.session_id, session()]))
  live.set('s4', session({ updatedAt: ago(2), statusUpdatedAt: ago(2) }))
  check('only the forgotten ones, and all of them', swept({ cards, live }), '1,3')
}

// ── How long a terminal may sit there ────────────────────────────────────────
section('How long a terminal may sit there')
// It arrives from a file somebody edits by hand, and from there anything can arrive: whatever
// turns up, k0 has to go on running with a number it can defend.
check('nothing written down at all means the default', settings.idleHours(undefined), 12)
check('and so does a word', settings.idleHours('soon'), 12)
check('and so does an empty line', settings.idleHours(''), 12)
check('and so does something that is not a number at all', settings.idleHours({}), 12)
check('a number is taken as it is', settings.idleHours(8), 8)
check('written as text it still is one', settings.idleHours('8'), 8)
check('and an hour and a half stays an hour and a half', settings.idleHours(1.5), 1.5)
// Below an hour this would stop being a tidy-up and start closing windows while you use them.
check('under an hour is raised to an hour', settings.idleHours(0.2), settings.MIN_HOURS)
check('zero is off', settings.idleHours(0), 0)
check('and a negative number is off too, not an hour', settings.idleHours(-3), 0)
check('a broken file is the same as no file', settings.normalise(null).closeIdleTerminalsAfterHours, 12)
check('and so is a file holding a list', settings.normalise([1, 2]).closeIdleTerminalsAfterHours, 12)

// ── The file that is the list ────────────────────────────────────────────────
section('The file that is the list')
{
  check('with no file at all, the defaults are in force', settings.read().closeIdleTerminalsAfterHours, 12)
  check('and k0 says it has not written one', settings.status().exists, false)

  check('writing it out is something that happens once', settings.ensure(), true)
  check('and asking again changes nothing', settings.ensure(), false)

  const written = JSON.parse(fs.readFileSync(settings.PATH, 'utf8'))
  // The file IS the list: every setting has to be in it, or opening it would not tell you what
  // there is to change — which is the only reason it exists rather than a page on the board.
  const missing = Object.keys(settings.DEFAULTS).filter((k) => !(k in written))
  check('everything there is, is in it', missing.join(','), '')
  check('at its default', written.closeIdleTerminalsAfterHours, 12)
  check('with a line saying what the file is', typeof written['//'], 'string')

  // Editing it has to land without restarting the server, which is the whole reason `read` looks
  // at the mtime instead of remembering the first answer it ever gave.
  fs.writeFileSync(settings.PATH, JSON.stringify({ closeIdleTerminalsAfterHours: 8 }))
  fs.utimesSync(settings.PATH, new Date(), new Date(Date.now() + 1000))
  check('changing it is picked up without a restart', settings.read().closeIdleTerminalsAfterHours, 8)
  check('and now k0 knows there is a file', settings.status().exists, true)

  fs.writeFileSync(settings.PATH, '{ this is not json')
  fs.utimesSync(settings.PATH, new Date(), new Date(Date.now() + 2000))
  check('a file nobody can read falls back to the default', settings.read().closeIdleTerminalsAfterHours, 12)
  check('and says so, instead of pretending', settings.status().broken, true)
}

after(() => {
  fs.rmSync(TMP, { recursive: true, force: true })
})
