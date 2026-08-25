import { check, section, after } from './harness.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// `db.js` opens the database the moment it is imported, so `K0_DB` is moved somewhere disposable
// first and the import comes after — a plain `import` at the top would already be too late,
// because imports all resolve before the first line of code runs. `db.js` stops by itself if a
// test forgets, but this is the right way round.
process.env.K0_DB = path.join(os.tmpdir(), `k0-db-test-${process.pid}.db`)
const store = await import('../server/db.js')
const db = store.default

// This is the only file where a card is created, read back, changed and deleted — the same
// journey a card makes on the board every day. Everything else k0 does can be done again; a card
// that goes missing, or comes back with the wrong session attached, is work you cannot recover.

/** The events written for a card, oldest first, as one line to compare. */
const events = (id) =>
  db
    .prepare('SELECT status FROM session_event WHERE card_id = ? ORDER BY at, id')
    .all(id)
    .map((r) => r.status)
    .join(' ')

/** Both timestamps come from `Date.now()`, and two of them in the same millisecond are equal. */
const tick = () => {
  const until = Date.now() + 2
  while (Date.now() < until);
}

const REPO = '/tmp/k0-db-test-repo'
const OTHER = '/tmp/k0-db-test-other'

// ── A card is born ───────────────────────────────────────────────────────────
section('A card is born')
const fresh = store.createCard({ title: 'Write the release notes', project_path: REPO, prompt: 'start here' })

check('it comes back with the title it was given', fresh.title, 'Write the release notes')
check('and the repository it belongs to', fresh.project_path, REPO)
check('and what Claude is to be told', fresh.prompt, 'start here')
// A new card has no session: it waits in the first column until you start it.
check('it starts in the backlog', fresh.status, 'BACKLOG')
check('with no session attached', fresh.session_id, null)
check('and nothing of it running', fresh.session_alive, 0)
check('the note is yellow unless asked otherwise', fresh.color, 'yellow')
check('it does not send by itself', fresh.auto_send, 0)
check('it is not completed', fresh.completed_at, null)
check('the description is empty rather than missing', fresh.description, '')
check('it was created just now', fresh.created_at > 0, true)
check('and touched at the same moment', fresh.updated_at, fresh.created_at)
// The first event is what the age at the bottom of the note is measured from.
check('and its first status is written down', events(fresh.id), 'BACKLOG')

check('a colour can be chosen at birth', store.createCard({ title: 'x', project_path: REPO, color: 'blue' }).color, 'blue')
check(
  'and so can sending by itself',
  store.createCard({ title: 'y', project_path: REPO, auto_send: true }).auto_send,
  1
)

// ── Reading it back ──────────────────────────────────────────────────────────
section('Reading it back')
check('by its number', store.getCard(fresh.id).title, 'Write the release notes')
check('a number that is nobody comes back as nothing', store.getCard(999999), undefined)

// The board draws the columns in this order, so the order is the feature.
{
  const first = store.createCard({ title: 'to the top', project_path: REPO })
  store.patchCard(first.id, { sort_hint: -1 })
  const ids = store.listCards().map((c) => c.id)
  check('the one dragged to the top comes first', ids[0], first.id)
  check('and the rest keep the order they were made in', ids.slice(1).join(' ') === [...ids.slice(1)].sort((a, b) => a - b).join(' '), true)
  check('every card is listed', ids.length, 4)
  store.deleteCard(first.id)
}

// ── Changing it ──────────────────────────────────────────────────────────────
section('Changing it')
{
  tick()
  const before = store.getCard(fresh.id)
  const patched = store.patchCard(fresh.id, { title: 'Write the notes', color: 'pink', auto_send: true })
  check('the title changes', patched.title, 'Write the notes')
  check('the colour changes', patched.color, 'pink')
  check('a yes becomes something the database can hold', patched.auto_send, 1)
  check('and the card counts as touched', patched.updated_at > before.updated_at, true)
}

// What the user may change is a short list, and everything else on the card is derived from the
// session rather than typed. A request that asks for more than the list has to be ignored, not
// obeyed: this is what stops the API being talked into rewriting a status or stealing a session.
{
  const patched = store.patchCard(fresh.id, { status: 'WORKING', session_id: 'nice-try', completed_at: 1 })
  check('a status cannot be typed in', patched.status, 'BACKLOG')
  check('nor can a session be claimed', patched.session_id, null)
  check('nor can a card be completed sideways', patched.completed_at, null)
}

check('a change with nothing in it changes nothing', store.patchCard(fresh.id, {}).title, 'Write the notes')

// ── The session on the card ──────────────────────────────────────────────────
section('The session on the card')
{
  const attached = store.attachSession(fresh.id, 'aaaa-1111')
  check('the session is on the card', attached.session_id, 'aaaa-1111')
  check('and it counts as running', attached.session_alive, 1)

  // Starting a session can fail after the card has already been marked. Backing out has to put
  // the card back where it was, not leave it pointing at something that never started.
  const backedOut = store.detachSession(fresh.id)
  check('backing out takes the session off', backedOut.session_id, null)
  check('nothing of it is running', backedOut.session_alive, 0)
  check('and the card returns to the backlog', backedOut.status, 'BACKLOG')

  const restored = store.detachSession(fresh.id, 'aaaa-1111')
  check('backing out onto the previous session puts it back', restored.session_id, 'aaaa-1111')
  check('and that card is your move again', restored.status, 'IDLE')
}

// The ids a card already claims are what stops the same session being imported twice.
{
  const claimed = store.sessionIds()
  check('a card with a session is counted', claimed.includes('aaaa-1111'), true)
  check('and the cards with none are not', claimed.length, 1)
}

// ── The statuses the board derives ───────────────────────────────────────────
section('The statuses the board derives')
// This runs once a second for every card on the board. Writing on every round would fill the
// history with nothing and move `updated_at` forever, so it writes only when something changed.
{
  store.applyDerivedStatus(fresh.id, 'WORKING', true)
  check('a new status is written', store.getCard(fresh.id).status, 'WORKING')
  check('and it goes into the history', events(fresh.id), 'BACKLOG WORKING')

  tick()
  const before = store.getCard(fresh.id)
  store.applyDerivedStatus(fresh.id, 'WORKING', true)
  check('the same status again writes nothing', store.getCard(fresh.id).updated_at, before.updated_at)
  check('and adds nothing to the history', events(fresh.id), 'BACKLOG WORKING')

  // The process going out is a change worth recording on the card, but it is not a new status:
  // the card still says WORKING, and the history should not say it twice.
  store.applyDerivedStatus(fresh.id, 'WORKING', false)
  check('the session going out is noticed', store.getCard(fresh.id).session_alive, 0)
  check('but it does not repeat the status', events(fresh.id), 'BACKLOG WORKING')

  check('a card that is not there is not a crash', store.applyDerivedStatus(999999, 'WORKING', true), undefined)
}

// ── Ticking it off ───────────────────────────────────────────────────────────
section('Ticking it off')
// COMPLETED is the one status you choose rather than one the session implies, which is why it
// overrides whatever the session is doing.
{
  const done = store.setCompleted(fresh.id, true)
  check('the card is completed', done.status, 'COMPLETED')
  check('and it remembers when', done.completed_at > 0, true)
  check('which is written down too', events(fresh.id), 'BACKLOG WORKING COMPLETED')

  // Unticking a card with a session hands it back as your move; one without goes to the backlog.
  const reopened = store.setCompleted(fresh.id, false)
  check('unticking clears the date', reopened.completed_at, null)
  check('and a card with a session is your move again', reopened.status, 'IDLE')
}
{
  const plain = store.createCard({ title: 'no session here', project_path: REPO })
  store.setCompleted(plain.id, true)
  check('a card with no session goes back to the backlog', store.setCompleted(plain.id, false).status, 'BACKLOG')
  store.deleteCard(plain.id)
}

// ── Where the work is really happening ───────────────────────────────────────
section('Where the work is really happening')
// These three follow the session around. None of them is work on the card, so none of them may
// move `updated_at`: that field is what tells k0 which repository you are working in today, and
// a live session would otherwise keep every card it touches permanently at the top.
{
  const before = store.getCard(fresh.id)
  tick()

  check('the terminal window is remembered', store.setTerminalWindow(fresh.id, 'w-42').terminal_window_id, 'w-42')
  check('the directory the session really works in', store.setWorkPath(fresh.id, '/tmp/a-worktree').work_path, '/tmp/a-worktree')
  check('and where the repository stood when it started', store.setHeadAtStart(fresh.id, 'abc1234').head_at_start, 'abc1234')
  check('none of that counts as touching the card', store.getCard(fresh.id).updated_at, before.updated_at)

  check('a window that is gone is cleared', store.setTerminalWindow(fresh.id, null).terminal_window_id, null)
  check('an empty directory is stored as nothing', store.setWorkPath(fresh.id, '').work_path, null)
  check('and so is an empty mark', store.setHeadAtStart(fresh.id, '').head_at_start, null)
}

// ── A session that already happened ──────────────────────────────────────────
section('A session that already happened')
// Importing must not make everything look like today: the age at the bottom of the note comes
// from these dates, and a board where fifty old sessions all say "now" says nothing.
{
  const born = Date.now() - 86400000 * 3
  const ended = Date.now() - 86400000 * 2
  const old = store.importCard({
    title: 'A session from Tuesday',
    project_path: OTHER,
    session_id: 'bbbb-2222',
    started_at: born,
    ended_at: ended,
  })
  check('it arrives as your move, not as a new card', old.status, 'IDLE')
  check('with its session on it', old.session_id, 'bbbb-2222')
  check('but nothing of it running', old.session_alive, 0)
  check('dated to when it really started', old.created_at, born)
  check('and last touched when it really ended', old.updated_at, ended)
  check('it is marked as imported', old.imported_at > 0, true)
  check('and its history is dated then, not now', db.prepare('SELECT at FROM session_event WHERE card_id = ?').get(old.id).at, ended)

  const undated = store.importCard({ title: 'No dates at all', project_path: OTHER, session_id: 'cccc-3333' })
  check('a session with no dates falls back to now', undated.created_at > 0, true)
  check('and does not end before it started', undated.updated_at, undated.created_at)
}

// ── Which repository you were last in ────────────────────────────────────────
section('Which repository you were last in')
// This is what brings the repository you are working in right now to the top of the list.
{
  const recency = Object.fromEntries(store.projectRecency().map((r) => [r.project_path, r.at]))
  check('both repositories are there', Object.keys(recency).length, 2)
  check(
    'and each one carries its freshest card',
    recency[OTHER],
    Math.max(...store.listCards().filter((c) => c.project_path === OTHER).map((c) => c.updated_at))
  )
}

// ── Throwing it away ─────────────────────────────────────────────────────────
section('Throwing it away')
{
  const doomed = store.createCard({ title: 'a mistake', project_path: REPO })
  store.applyDerivedStatus(doomed.id, 'WORKING', true)
  check('it had a history', events(doomed.id), 'BACKLOG WORKING')

  store.deleteCard(doomed.id)
  check('the card is gone', store.getCard(doomed.id), undefined)
  // The history has to go with it. Nothing reads an orphaned event, but it keeps a title you
  // deleted alive in a file you thought you had cleared.
  check('and its history with it', events(doomed.id), '')
  check('deleting it twice is not an error', store.deleteCard(doomed.id), undefined)
}

// Tidying up waits until the tests have run, which is what `after` is for. The handle has to go
// before the file does: on Windows a file that is still open cannot be deleted, and this line is
// the whole difference between a green build and a red one there.
after(() => {
  store.close()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.K0_DB + suffix, { force: true })
})
