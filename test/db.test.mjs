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

// This is the only file where a story is created, read back, changed and deleted — the same
// journey a story makes on the board every day. Everything else k0 does can be done again; a story
// that goes missing, or comes back with the wrong session attached, is work you cannot recover.

/**
 * The events written for a story, oldest first, as one line to compare. Both kinds are in there:
 * the states the story went through, in words, and the statuses its session went through, in
 * capitals. Reading them together is the point — that is how the diary is written now.
 */
const events = (id) =>
  db
    .prepare('SELECT status FROM session_event WHERE story_id = ? ORDER BY at, id')
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

// ── A story is born ──────────────────────────────────────────────────────────
section('A story is born')
const fresh = store.createStory({ title: 'Write the release notes', project_path: REPO, prompt: 'start here' })

check('it comes back with the title it was given', fresh.title, 'Write the release notes')
check('and the repository it belongs to', fresh.project_path, REPO)
check('and what Claude is to be told', fresh.prompt, 'start here')
// A new story has no session: it waits in the first column until you start it.
check('it starts in the backlog', fresh.status, 'BACKLOG')
check('which is also where its state starts', fresh.state, 'Backlog')
check('and it is given a key of its own', fresh.key, 'K1')
check('with no session attached', fresh.session_id, null)
check('and nothing of it running', fresh.session_alive, 0)
check('the note is yellow unless asked otherwise', fresh.color, 'yellow')
check('it does not send by itself', fresh.auto_send, 0)
check('it is not completed', fresh.completed_at, null)
check('the description is empty rather than missing', fresh.description, '')
check('it was created just now', fresh.created_at > 0, true)
check('and touched at the same moment', fresh.updated_at, fresh.created_at)
// The first event is what the age at the bottom of the note is measured from.
check('and its first state is written down', events(fresh.id), 'Backlog')

check('a colour can be chosen at birth', store.createStory({ title: 'x', project_path: REPO, color: 'blue' }).color, 'blue')
check(
  'and so can sending by itself',
  store.createStory({ title: 'y', project_path: REPO, auto_send: true }).auto_send,
  1
)

// ── Reading it back ──────────────────────────────────────────────────────────
section('Reading it back')
check('by its number', store.getStory(fresh.id).title, 'Write the release notes')
check('a number that is nobody comes back as nothing', store.getStory(999999), undefined)

// The board draws the columns in this order, so the order is the feature.
{
  const first = store.createStory({ title: 'to the top', project_path: REPO })
  store.patchStory(first.id, { sort_hint: -1 })
  const ids = store.listStories().map((c) => c.id)
  check('the one dragged to the top comes first', ids[0], first.id)
  check('and the rest keep the order they were made in', ids.slice(1).join(' ') === [...ids.slice(1)].sort((a, b) => a - b).join(' '), true)
  check('every story is listed', ids.length, 4)
  store.deleteStory(first.id)
}

// ── Changing it ──────────────────────────────────────────────────────────────
section('Changing it')
{
  tick()
  const before = store.getStory(fresh.id)
  const patched = store.patchStory(fresh.id, { title: 'Write the notes', color: 'pink', auto_send: true })
  check('the title changes', patched.title, 'Write the notes')
  check('the colour changes', patched.color, 'pink')
  check('a yes becomes something the database can hold', patched.auto_send, 1)
  check('and the story counts as touched', patched.updated_at > before.updated_at, true)
}

// What the user may change is a short list, and everything else on the story is derived from the
// session rather than typed. A request that asks for more than the list has to be ignored, not
// obeyed: this is what stops the API being talked into rewriting a status or stealing a session.
{
  const patched = store.patchStory(fresh.id, { status: 'WORKING', session_id: 'nice-try', completed_at: 1 })
  check('a status cannot be typed in', patched.status, 'BACKLOG')
  check('nor can a session be claimed', patched.session_id, null)
  check('nor can a story be completed sideways', patched.completed_at, null)
  check('and the state it is in is untouched', patched.state, 'Backlog')
}

check('a change with nothing in it changes nothing', store.patchStory(fresh.id, {}).title, 'Write the notes')

// ── The session on the story ─────────────────────────────────────────────────
section('The session on the story')
{
  const attached = store.attachSession(fresh.id, 'aaaa-1111')
  check('the session is on the story', attached.session_id, 'aaaa-1111')
  check('and it counts as running', attached.session_alive, 1)

  // Starting a session can fail after the story has already been marked. Backing out has to put
  // the story back where it was, not leave it pointing at something that never started.
  const backedOut = store.detachSession(fresh.id)
  check('backing out takes the session off', backedOut.session_id, null)
  check('nothing of it is running', backedOut.session_alive, 0)
  check('and the story returns to the backlog', backedOut.status, 'BACKLOG')

  const restored = store.detachSession(fresh.id, 'aaaa-1111')
  check('backing out onto the previous session puts it back', restored.session_id, 'aaaa-1111')
  check('and that story is your move again', restored.status, 'IDLE')
}

// The ids a story already claims are what stops the same session being imported twice.
{
  const claimed = store.sessionIds()
  check('a story with a session is counted', claimed.includes('aaaa-1111'), true)
  check('and the stories with none are not', claimed.length, 1)
}

// ── The statuses the board derives ───────────────────────────────────────────
section('The statuses the board derives')
// This runs once a second for every story on the board. Writing on every round would fill the
// history with nothing and move `updated_at` forever, so it writes only when something changed.
{
  store.applyDerivedStatus(fresh.id, 'WORKING', true)
  check('a new status is written', store.getStory(fresh.id).status, 'WORKING')
  // A session that is really running says the story is being worked on, and says it by itself:
  // that is the one state change nobody has to make by hand.
  check('and the story counts as under way', store.getStory(fresh.id).state, 'Working')
  check('and both go into the history', events(fresh.id), 'Backlog WORKING Working')

  tick()
  const before = store.getStory(fresh.id)
  store.applyDerivedStatus(fresh.id, 'WORKING', true)
  check('the same status again writes nothing', store.getStory(fresh.id).updated_at, before.updated_at)
  check('and adds nothing to the history', events(fresh.id), 'Backlog WORKING Working')

  // The process going out is a change worth recording on the story, but it is not a new status:
  // the story still says WORKING, and the history should not say it twice.
  store.applyDerivedStatus(fresh.id, 'WORKING', false)
  check('the session going out is noticed', store.getStory(fresh.id).session_alive, 0)
  check('but it does not repeat the status', events(fresh.id), 'Backlog WORKING Working')

  check('a story that is not there is not a crash', store.applyDerivedStatus(999999, 'WORKING', true), undefined)
}

// A session opened to TALK about a story is not the work starting. Pressing "Discuss" on a
// note nobody has decided anything about used to move it to `Working` before the first question
// was asked — and closing that terminal half way through left a story sitting in `Working` being
// offered a counter-check on work that had never happened.
{
  const talked = store.createStory({ title: 'Too vague to build', project_path: REPO })
  store.attachSession(talked.id, 'cccc-3333', 'k0-discuss')
  store.applyDerivedStatus(talked.id, 'WORKING', true)
  check('a session opened to discuss it leaves the story where it was', store.getStory(talked.id).state, 'Backlog')
  check('though the session itself is running', store.getStory(talked.id).status, 'WORKING')

  const worked = store.createStory({ title: 'Ready to build', project_path: REPO, state: 'Planned' })
  store.attachSession(worked.id, 'dddd-4444', 'k0-work')
  store.applyDerivedStatus(worked.id, 'WORKING', true)
  check('and the one command that does the work still says so', store.getStory(worked.id).state, 'Working')

  // The manager is the other one. It discusses and plans where it has to, but what it is for is
  // building the thing — a story it is running on is a story being worked on.
  const managed = store.createStory({ title: 'A whole epic at once', project_path: REPO, state: 'Planned' })
  store.attachSession(managed.id, 'eeee-5555', 'k0-ultracode')
  store.applyDerivedStatus(managed.id, 'WORKING', true)
  check('and so does the one that hands it to agents', store.getStory(managed.id).state, 'Working')
}

// ── Ticking it off ───────────────────────────────────────────────────────────
section('Ticking it off')
// COMPLETED is the one status you choose rather than one the session implies, which is why it
// overrides whatever the session is doing.
{
  const done = store.setCompleted(fresh.id, true)
  check('the story is completed', done.status, 'COMPLETED')
  check('which is the state it is now in', done.state, 'Done')
  check('and it remembers when', done.completed_at > 0, true)
  check('which is written down too', events(fresh.id), 'Backlog WORKING Working Done')

  // Unticking a story with a session hands it back as your move; one without goes to the backlog.
  const reopened = store.setCompleted(fresh.id, false)
  check('unticking clears the date', reopened.completed_at, null)
  check('and a story with a session is your move again', reopened.status, 'IDLE')
}
{
  const plain = store.createStory({ title: 'no session here', project_path: REPO })
  store.setCompleted(plain.id, true)
  const back = store.setCompleted(plain.id, false)
  check('a story with no session goes back to the backlog', back.status, 'BACKLOG')
  check('and its state says the same thing', back.state, 'Backlog')
  store.deleteStory(plain.id)
}

// ── One story, several sessions ──────────────────────────────────────────────
section('One story, several sessions')
// A story keeps every session it has lived through, and "the session" is always the newest one.
// Getting this wrong is how a story ends up with two rows both claiming to be running.
{
  const long = store.createStory({ title: 'a long one', project_path: REPO })
  store.attachSession(long.id, 'first-session')
  store.attachSession(long.id, 'second-session')
  const sessions = store.listSessions(long.id)
  check('both sessions are kept', sessions.map((v) => v.session_id).join(' '), 'first-session second-session')
  check('the first one is closed off', sessions[0].alive, 0)
  check('and only one of them is running', sessions.filter((v) => v.alive).length, 1)
  check('the story wears the newest one', store.getStory(long.id).session_id, 'second-session')
  check('which is also what `currentSession` says', store.currentSession(long.id).session_id, 'second-session')

  // Backing out of the second start puts the first one back, exactly as it was.
  store.detachSession(long.id, 'first-session')
  check('backing out returns to the one before', store.getStory(long.id).session_id, 'first-session')
  check('and the failed one leaves no trace', store.listSessions(long.id).length, 1)
  store.deleteStory(long.id)
  check('deleting the story takes its sessions with it', store.listSessions(long.id).length, 0)
}

// ── Where the work is really happening ───────────────────────────────────────
section('Where the work is really happening')
// These three follow the session around and are written on the session's own row. None of them is
// work on the story, so none of them may move `updated_at`: that field is what tells k0 which
// repository you are working in today, and a live session would otherwise keep every story it
// touches permanently at the top.
{
  const before = store.getStory(fresh.id)
  tick()

  check('the terminal window is remembered', store.setTerminalWindow(fresh.id, 'w-42').terminal_window_id, 'w-42')
  check('the directory the session really works in', store.setWorkPath(fresh.id, '/tmp/a-worktree').work_path, '/tmp/a-worktree')
  check('and where the repository stood when it started', store.setHeadAtStart(fresh.id, 'abc1234').head_at_start, 'abc1234')
  check('none of that counts as touching the story', store.getStory(fresh.id).updated_at, before.updated_at)

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
  const old = store.importStory({
    title: 'A session from Tuesday',
    project_path: OTHER,
    session_id: 'bbbb-2222',
    started_at: born,
    ended_at: ended,
  })
  check('it arrives as your move, not as a new story', old.status, 'IDLE')
  check('with its session on it', old.session_id, 'bbbb-2222')
  check('but nothing of it running', old.session_alive, 0)
  check('dated to when it really started', old.created_at, born)
  check('and last touched when it really ended', old.updated_at, ended)
  check('it is marked as imported', old.imported_at > 0, true)
  check('and its history is dated then, not now', db.prepare('SELECT at FROM session_event WHERE story_id = ?').get(old.id).at, ended)

  const undated = store.importStory({ title: 'No dates at all', project_path: OTHER, session_id: 'cccc-3333' })
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
    'and each one carries its freshest story',
    recency[OTHER],
    Math.max(...store.listStories().filter((c) => c.project_path === OTHER).map((c) => c.updated_at))
  )
}

// ── Throwing it away ─────────────────────────────────────────────────────────
section('Throwing it away')
{
  const doomed = store.createStory({ title: 'a mistake', project_path: REPO })
  // With a session, because a derived status is written on the session row: a story that has never
  // been started has none, and there would be nothing here to throw away.
  store.attachSession(doomed.id, 'bbbb-2222')
  store.applyDerivedStatus(doomed.id, 'WORKING', true)
  check('it had a history', events(doomed.id), 'Backlog WORKING Working')

  store.deleteStory(doomed.id)
  check('the story is gone', store.getStory(doomed.id), undefined)
  // The history has to go with it. Nothing reads an orphaned event, but it keeps a title you
  // deleted alive in a file you thought you had cleared.
  check('and its history with it', events(doomed.id), '')
  check('deleting it twice is not an error', store.deleteStory(doomed.id), undefined)
}

// Tidying up waits until the tests have run, which is what `after` is for. The handle has to go
// before the file does: on Windows a file that is still open cannot be deleted, and this line is
// the whole difference between a green build and a red one there.
after(() => {
  store.close()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.K0_DB + suffix, { force: true })
})
