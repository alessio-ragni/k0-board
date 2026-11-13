import { check, section, after } from './harness.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// `/clear` and `/resume` inside a story's terminal: the conversation changes id, the process does
// not, and the story has to follow its terminal instead of taking it for dead.
//
// The home and the database are moved out of the way before anything is imported: `watcher.js`
// works out where the session files live from the home directory, and `db.js` opens the database
// the moment it is imported.
const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-clear-home-'))
process.env.HOME = FAKE_HOME
process.env.USERPROFILE = FAKE_HOME
process.env.K0_DB = path.join(os.tmpdir(), `k0-clear-test-${process.pid}.db`)

const store = await import('../server/db.js')
const { followTerminal, resumeFindsItRunning } = await import('../server/watcher.js')

const REPO = path.join(FAKE_HOME, 'repo')
const START = 'Wed Nov 11 09:25:27 2026'

/** A live session the way `readLiveSessions` hands them over: by conversation id. */
const liveOf = (...sessions) => new Map(sessions.map((s) => [s.sessionId, s]))
const nobody = () => null

// ── Recognising the terminal ─────────────────────────────────────────────────
section('following the terminal')

const story = {
  id: 1,
  session_id: 'before-clear',
  session_pid: 4242,
  session_proc_start: START,
}

check(
  'same process, new conversation: the story follows it',
  followTerminal(story, liveOf({ pid: 4242, procStart: START, sessionId: 'after-clear' }), nobody),
  'after-clear'
)
check(
  'the conversation it knows is still running: nothing to follow',
  followTerminal(story, liveOf({ pid: 4242, procStart: START, sessionId: 'before-clear' }), nobody),
  null
)
check(
  'the same pid handed to a process started later is a stranger',
  followTerminal(story, liveOf({ pid: 4242, procStart: 'Thu Nov 12 10:00:00 2026', sessionId: 'x' }), nobody),
  null
)
check(
  'without a start time there is no telling them apart',
  followTerminal({ ...story, session_proc_start: null }, liveOf({ pid: 4242, procStart: START, sessionId: 'x' }), nobody),
  null
)
check(
  'a session file that does not say when its process started is not followed either',
  followTerminal(story, liveOf({ pid: 4242, sessionId: 'x' }), nobody),
  null
)
check('a terminal that has really gone stays gone', followTerminal(story, liveOf(), nobody), null)
check(
  'a story that never saw its process has nothing to follow',
  followTerminal({ ...story, session_pid: null }, liveOf({ pid: 4242, procStart: START, sessionId: 'x' }), nobody),
  null
)
check(
  'a finished story does not pick up whatever runs in its old window',
  followTerminal({ ...story, completed_at: 1 }, liveOf({ pid: 4242, procStart: START, sessionId: 'x' }), nobody),
  null
)
check(
  'a conversation another story holds is left to that story',
  followTerminal(story, liveOf({ pid: 4242, procStart: START, sessionId: 'theirs' }), () => 7),
  null
)
check(
  '/resume back to one of its own earlier conversations is followed',
  followTerminal(story, liveOf({ pid: 4242, procStart: START, sessionId: 'mine' }), () => 1),
  'mine'
)
check(
  'other processes in the list are not mistaken for it',
  followTerminal(
    story,
    liveOf({ pid: 1, procStart: START, sessionId: 'a' }, { pid: 4242, procStart: START, sessionId: 'b' }),
    nobody
  ),
  'b'
)

// ── Moving the story onto the new conversation ───────────────────────────────
section('rebinding')

const made = store.createStory({ title: 'Clear the terminal', project_path: REPO })
store.attachSession(made.id, 'before-clear', 'k0-work')
store.setTerminalWindow(made.id, '29737')
store.setWorkPath(made.id, path.join(REPO, '.claude', 'worktrees', 'k1'))
store.setHeadAtStart(made.id, 'abc123')

const first = store.getStory(made.id)
store.setSessionProcess(first.session_row_id, 4242, START)
const known = store.getStory(made.id)
check('the process is kept on the session', known.session_pid, 4242)
check('and when it started', known.session_proc_start, START)

// Written only when it changed: an update on `session` queues the row for the cloud.
check('writing the same process again writes nothing', Number(store.setSessionProcess(first.session_row_id, 4242, START)), 0)
check('a new process is written', Number(store.setSessionProcess(first.session_row_id, 4243, START)), 1)
store.setSessionProcess(first.session_row_id, 4242, START)

store.rebindSession(known.session_row_id, 'after-clear')
const moved = store.getStory(made.id)
check('the story now holds the new conversation', moved.session_id, 'after-clear')
check('and it is alive', moved.session_alive, 1)
check('the window is still its window', moved.terminal_window_id, '29737')
check('the worktree is still its worktree', moved.work_path, path.join(REPO, '.claude', 'worktrees', 'k1'))
check('the commits since the start are still its commits', moved.head_at_start, 'abc123')
check('what it was opened to do carries over', moved.opened_with, 'k0-work')
check('the process carries over, so a second /clear is followed too', moved.session_pid, 4242)
check('a new row, not the old one written over', moved.session_row_id !== known.session_row_id, true)

const old = store.default.prepare('SELECT * FROM session WHERE id = ?').get(known.session_row_id)
check('the conversation before the clear is closed off', old.alive, 0)
check('with an end', old.ended_at != null, true)
check('and still the story’s, for the usage page and the import', store.storyOfSession('before-clear'), made.id)
check('the new one is the story’s too', store.storyOfSession('after-clear'), made.id)
check('a session nobody holds belongs to nobody', store.storyOfSession('nobody'), null)
check('a row that is not there is left alone', store.rebindSession(999999, 'x'), undefined)

// ── Resuming a story that is Done ────────────────────────────────────────────
// Resume on a finished story reopens it. When it was resumed once already and the terminal is still
// there, the window is brought up instead of a second `claude --resume` on the same conversation.
section('resuming a story that is done')

const finished = { id: 7, session_id: 'kept', completed_at: Date.now() }
const running = liveOf({ pid: 1, procStart: START, sessionId: 'kept' })

check(
  'done, resumed, its terminal still running: that terminal is brought up',
  resumeFindsItRunning(finished, running, true),
  true
)
check('done, resumed, nothing running: a terminal is opened', resumeFindsItRunning(finished, liveOf(), true), false)
check('a fresh start is never this', resumeFindsItRunning(finished, running, false), false)
check(
  'a story that is not done has no Resume over a live session',
  resumeFindsItRunning({ ...finished, completed_at: null }, running, true),
  false
)
check('no session, nothing to find', resumeFindsItRunning({ ...finished, session_id: null }, running, true), false)

after(() => {
  store.close()
  for (const f of [process.env.K0_DB, `${process.env.K0_DB}-wal`, `${process.env.K0_DB}-shm`]) fs.rmSync(f, { force: true })
  fs.rmSync(FAKE_HOME, { recursive: true, force: true })
})
