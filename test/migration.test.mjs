import { check, section, after } from './harness.mjs'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ── The board the day after ──────────────────────────────────────────────────
// A board of cards becomes a board of stories exactly once, on whatever database the user
// happens to have, and there is no second chance at it: the columns that carried the session
// are dropped at the end of the move. So this file builds a database in the OLD shape by hand —
// the schema k0 shipped for a year, additive columns and all — opens it through `db.js`, and
// checks that what comes out the other side is the board that went in.
//
// The old shape is written out in full rather than fetched from git on purpose: a test that
// reads its own fixture out of the repository's history stops being a test of anything the day
// somebody rewrites that history.

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-migration-'))
process.env.HOME = HOME
process.env.USERPROFILE = HOME
process.env.K0_DB = path.join(HOME, 'board.db')

const REPO_A = '/tmp/k0-migration-a'
const REPO_B = '/tmp/k0-migration-b'

// Round numbers, an hour apart, so every date below can be recognised on sight.
const T = 1_700_000_000_000
const HOUR = 3600000
const at = (h) => T + h * HOUR

// ── The old database ─────────────────────────────────────────────────────────
{
  // Foreign keys off, and only here: `node:sqlite` switches them on for every connection it
  // opens — unlike the sqlite3 command line — and one row below is deliberately an orphan.
  const old = new DatabaseSync(process.env.K0_DB, { enableForeignKeyConstraints: false })
  old.exec(`
    CREATE TABLE card (
      id            INTEGER PRIMARY KEY,
      title         TEXT NOT NULL,
      project_path  TEXT NOT NULL,
      prompt        TEXT,
      session_id    TEXT,
      status        TEXT NOT NULL DEFAULT 'BACKLOG',
      session_alive INTEGER NOT NULL DEFAULT 0,
      auto_send     INTEGER NOT NULL DEFAULT 0,
      completed_at  INTEGER,
      color         TEXT NOT NULL DEFAULT 'yellow',
      sort_hint     INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      terminal_window_id TEXT,
      description   TEXT,
      imported_at   INTEGER,
      work_path     TEXT,
      head_at_start TEXT,
      auto_closed   INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE session_event (
      id      INTEGER PRIMARY KEY,
      card_id INTEGER NOT NULL REFERENCES card(id) ON DELETE CASCADE,
      status  TEXT NOT NULL,
      at      INTEGER NOT NULL
    );
    CREATE INDEX idx_event_card ON session_event(card_id, at DESC);
    CREATE TABLE pref ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL);
  `)

  const card = (row) =>
    old
      .prepare(
        `INSERT INTO card (id, title, project_path, prompt, session_id, status, session_alive, auto_send,
                           completed_at, color, sort_hint, created_at, updated_at, terminal_window_id,
                           description, imported_at, work_path, head_at_start, auto_closed)
         VALUES (:id, :title, :project_path, :prompt, :session_id, :status, :session_alive, :auto_send,
                 :completed_at, :color, :sort_hint, :created_at, :updated_at, :terminal_window_id,
                 :description, :imported_at, :work_path, :head_at_start, :auto_closed)`
      )
      .run({
        prompt: '',
        session_id: null,
        status: 'BACKLOG',
        session_alive: 0,
        auto_send: 0,
        completed_at: null,
        color: 'yellow',
        sort_hint: 0,
        terminal_window_id: null,
        description: '',
        imported_at: null,
        work_path: null,
        head_at_start: null,
        auto_closed: 0,
        ...row,
      })

  const event = (cardId, status, when) =>
    old.prepare('INSERT INTO session_event (card_id, status, at) VALUES (?, ?, ?)').run(cardId, status, when)

  // 1 — never started. The plainest thing on a board, and the one whose age is easiest to break.
  card({ id: 1, title: 'In the backlog', project_path: REPO_A, prompt: 'do the thing', created_at: at(0), updated_at: at(0) })
  event(1, 'BACKLOG', at(0))

  // 2 — a session grinding away right now, in a worktree of its own, with everything a running
  // session carries: a window, a working directory, the mark HEAD was at, and "send it for me".
  card({
    id: 2,
    title: 'Working now',
    project_path: REPO_A,
    session_id: 'sess-working',
    status: 'WORKING',
    session_alive: 1,
    auto_send: 1,
    terminal_window_id: 'w-1',
    work_path: '/tmp/k0-migration-a-worktree',
    head_at_start: 'abc1234',
    created_at: at(1),
    updated_at: at(3),
  })
  event(2, 'BACKLOG', at(1))
  event(2, 'WORKING', at(3))

  // 3 — ticked off, its terminal closed by k0 rather than by you.
  card({
    id: 3,
    title: 'Finished',
    project_path: REPO_A,
    session_id: 'sess-done',
    status: 'COMPLETED',
    completed_at: at(5),
    auto_closed: 1,
    created_at: at(2),
    updated_at: at(5),
  })
  event(3, 'BACKLOG', at(2))
  event(3, 'WORKING', at(4))
  event(3, 'COMPLETED', at(5))

  // 4 — a question on screen in the other repository, so the keys have to start again at 1 there.
  card({
    id: 4,
    title: 'A question',
    project_path: REPO_B,
    session_id: 'sess-ask',
    status: 'ASK',
    session_alive: 1,
    sort_hint: -1,
    created_at: at(6),
    updated_at: at(7),
  })
  event(4, 'BACKLOG', at(6))
  event(4, 'ASK', at(7))

  // 5 — "send it for me" set on something that has never been started. That switch has no card
  // to live on any more, and losing it would silently stop sending prompts for whoever set it.
  card({ id: 5, title: 'Waiting to send', project_path: REPO_B, prompt: 'go', auto_send: 1, created_at: at(8), updated_at: at(8) })
  event(5, 'BACKLOG', at(8))

  // 6 — an imported session that never wrote an event. The migration writes it none either: an
  // invented row dated `updated_at` would have put this story into a past day's ChangeLog it was
  // never in. The age falls back to when the session started, which is true and costs no history.
  card({
    id: 6,
    title: 'Imported, never moved',
    project_path: REPO_B,
    session_id: 'sess-idle',
    status: 'IDLE',
    imported_at: at(9),
    created_at: at(9),
    updated_at: at(10),
  })

  // An event belonging to a card that is not there any more. Nothing reads one, but a foreign key
  // switched on over the top of it would refuse the very UPDATE that migrates the diary.
  event(99, 'BACKLOG', at(0))

  old.exec(`INSERT INTO pref ("key", "value") VALUES ('mode', 'driving')`)
  old.close()
}

// Only now: `db.js` migrates the moment it is imported.
const store = await import('../server/db.js')
const db = store.default

const stories = store.listStories()
const byId = new Map(stories.map((s) => [s.id, s]))
const one = (id) => byId.get(id)

// ── Nothing is lost ──────────────────────────────────────────────────────────
section('Nothing is lost')
check('every card came through as a story', stories.length, 6)
check('and the table it came from is gone', db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'card'`).get(), undefined)
check('ids are kept, so every bookmark and every window still points at the same work', one(3).title, 'Finished')
check('so are the prompts', one(1).prompt, 'do the thing')
check('and the order the board was dragged into', stories[0].id, 4)
check('the preferences are untouched', store.getPref('mode'), 'driving')

// ── The board is the same board ──────────────────────────────────────────────
section('The board is the same board')
// The one that matters: what the post-it says today is what it said yesterday. `status` is
// worked out from the two axes now, and it has to come out with the same seven words.
check('the one nobody started is still in the backlog', one(1).status, 'BACKLOG')
check('the one that is running is still working', one(2).status, 'WORKING')
check('the finished one is still finished', one(3).status, 'COMPLETED')
check('and remembers when', one(3).completed_at, at(5))
check('the question is still a question', one(4).status, 'ASK')
check('what has never been started shows nothing running', one(5).status, 'BACKLOG')
check('and the imported one is still your move', one(6).status, 'IDLE')

// And the age underneath it, which reads a different row for each of the two axes.
check('a backlog age is measured from the state it is in', one(1).status_since, at(0))
check('a live one from the moment the session got there', one(2).status_since, at(3))
check('a finished one from when it was ticked off', one(3).status_since, at(5))
check('a story that never wrote an event dates from when its session started', one(6).status_since, at(9))

// ── The two axes ─────────────────────────────────────────────────────────────
section('The two axes')
check('nothing started is in Backlog', one(1).state, 'Backlog')
check('anything that had a session is Working', one(2).state, 'Working')
check('what was ticked off is Done', one(3).state, 'Done')
check('a question is work under way', one(4).state, 'Working')
check('and BACKLOG never becomes a session status again', one(1).session_status, null)
check('while a live one keeps the status it had', one(2).session_status, 'WORKING')
// COMPLETED was never something a session did: the session under a finished story is idle.
check('a finished story has no session grinding away', one(3).session_status, 'IDLE')

// ── The session moved out ────────────────────────────────────────────────────
section('The session moved out')
check('the running session is on a row of its own', store.currentSession(2).session_id, 'sess-working')
check('and still counts as running', one(2).session_alive, 1)
check('its window came with it', one(2).terminal_window_id, 'w-1')
check('and where it is really working', one(2).work_path, '/tmp/k0-migration-a-worktree')
check('and where the repository stood when it started', one(2).head_at_start, 'abc1234')
check('and whether it sends the prompt by itself', one(2).auto_send, 1)
check('who closed the finished one is remembered', one(3).auto_closed, 1)
check('a story that never had a session has none now', store.currentSession(1), null)
check('every session that existed is claimed', store.sessionIds().sort().join(' '), 'sess-ask sess-done sess-idle sess-working')

// "Send it for me" with no session to hang it on: the row exists, empty, waiting for the start.
check('the instruction with no session is kept', one(5).auto_send, 1)
check('and the board still sees no session there', one(5).session_id, null)

// ── The keys ─────────────────────────────────────────────────────────────────
section('The keys')
// Per repository, in the order the work was thought of. Two repositories both having a K1 is
// intended: a key means something inside its own repository and nowhere else.
check('the first repository is numbered in order', [1, 2, 3].map((id) => one(id).key).join(' '), 'K1 K2 K3')
check('and the second one starts again at one', [4, 5, 6].map((id) => one(id).key).join(' '), 'K1 K2 K3')
check(
  'and the counter is left above what it handed out',
  db.prepare('SELECT next FROM key_seq WHERE project_path = ?').get(REPO_A).next,
  4
)
{
  const born = store.createStory({ title: 'after the migration', project_path: REPO_A })
  check('so the next story gets the next number', born.key, 'K4')
  store.deleteStory(born.id)
  const again = store.createStory({ title: 'and the one after that', project_path: REPO_A })
  check('and a deleted key is never handed out twice', again.key, 'K5')
  store.deleteStory(again.id)
}

// ── The diary ────────────────────────────────────────────────────────────────
section('The diary')
const events = (id) =>
  db
    .prepare('SELECT kind, status FROM session_event WHERE story_id = ? ORDER BY at, id')
    .all(id)
    .map((r) => `${r.kind}:${r.status}`)
    .join(' ')

check('the column was renamed under the events', events(1), 'state:Backlog')
check('a live session keeps its own line', events(2), 'state:Backlog session:WORKING')
check(
  'and each old row was told which axis it belongs to',
  events(3),
  'state:Backlog session:WORKING state:Done'
)
// Nothing invented, anywhere. The diary the user upgraded with is the diary they had: the
// ChangeLog for a Tuesday that is already over has to say the same thing today as it did
// yesterday, and a row the migration made up would have been in it.
check(
  'and not one row was invented',
  db.prepare('SELECT COUNT(*) AS n FROM session_event').get().n,
  9
)
check('an event belonging to nobody is swept up', db.prepare('SELECT COUNT(*) AS n FROM session_event WHERE story_id = 99').get().n, 0)

// ── No epics yet ─────────────────────────────────────────────────────────────
section('No epics yet')
// Nothing in an old board says anything about epics, and inventing one would be inventing work.
check('every story arrives without an epic', stories.filter((s) => s.epic_id !== null).length, 0)
check('and none of them is a task', stories.filter((s) => s.parent_story_id !== null).length, 0)
check('there are no epics at all', store.listEpics().length, 0)

// ── Opening it again ─────────────────────────────────────────────────────────
section('Opening it again')
// The migration has to be a one-way door: a second pass over an already-migrated board must find
// nothing to do. It cannot be re-imported in this process, so the probe it is guarded by is
// checked directly — the old `status` column is gone, and with it the way back in.
check(
  'the column the migration is guarded by is gone',
  db.prepare(`SELECT 1 FROM pragma_table_info('story') WHERE name = 'status'`).get(),
  undefined
)
// And a second lock on the same door, which is the one that actually holds. Dropping a column is
// allowed to fail — an older SQLite refuses — and then the shape alone would let the whole thing
// run again, insert every session a second time, and leave a `Resume` pointing at a conversation
// that never happened. This row is written inside the same transaction as the move.
check(
  'and the move is written down as done, whatever happened to the column',
  store.getPref('schema.sessions-split'),
  '1'
)
check('and no session was duplicated on the way', db.prepare('SELECT COUNT(*) AS n FROM session').get().n, 5)

after(() => {
  store.close()
  fs.rmSync(HOME, { recursive: true, force: true })
})
