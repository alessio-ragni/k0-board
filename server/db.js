import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DB_PATH, ROOT, ensureDirs, migrateLegacyDatabase } from './paths.js'

export { DB_PATH }

// ── Who may open the real board ──────────────────────────────────────────────
// Importing this file opens `~/.k0/k0.db` and runs every migration in it. That is right when
// the server does it and catastrophic when anything else does: on 7 September 2026 a copy of
// k0 under development imported this file with `K0_DB` unset, migrated the running board out
// from under the installed server, and took the board down with 323 notes on it. Nothing was
// lost, but nothing warned either — the migration did exactly what it was written to do, to
// the wrong database.
//
// The old guard here only caught files named `*.test.mjs`. That was the case that had already
// happened; it is not the shape of the problem. The shape of the problem is that ANY process
// that is not the server can open the real board by accident — a one-line `node -e`, a script
// somebody wrote to look at something, an agent poking about in a checkout.
//
// So the rule is stated the other way round, as a permission rather than a list of bans: the
// real board may be opened by k0's own two entry points, and by nothing else. Everything else
// says where it wants to write, with `K0_DB`, or it does not get in.
//
// The trap is import order: every import resolves before the first line of the importing file
// runs, so `K0_DB` has to be set BEFORE anything pulls this file in, however indirectly (see
// test/mode.test.mjs).
if (!process.env.K0_DB) {
  const entry = process.argv[1] || ''
  const ours = entry === path.join(ROOT, 'bin', 'k0-board.js') || entry === path.join(ROOT, 'server', 'index.js')
  // A worktree is a copy of k0 being worked on, and work in progress must never reach the board
  // somebody is using today — however it was started, and even from the right file name.
  const development = ROOT.includes(`${path.sep}.claude${path.sep}worktrees${path.sep}`)
  if (!ours || development) {
    throw new Error(
      `K0_DB is not set, and ${entry || 'this process'} is not the k0 server: it must not open the real board ` +
        `at ${DB_PATH}. Point K0_DB at a file of your own before importing db.js.`
    )
  }
}

if (!process.env.K0_DB) {
  ensureDirs()
  migrateLegacyDatabase()
}

const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')

const has = (table, column) => !!db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get(table, column)
const tableExists = (name) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)

// The rename comes before the schema below, and that order is the whole trick: `CREATE TABLE IF
// NOT EXISTS story` on a board that still calls it `card` would quietly make a second, empty
// table and every story you have would disappear from the board.
//
// The three steps are guarded one by one and not as a group, and that is the point. A board
// killed between the first and the second used to be unopenable for ever: `card` was gone, so
// the group's guard was false, and `session_event` kept a `card_id` nothing would ever rename
// again — the next start died on `no such column: story_id` and every start after it.
if (tableExists('card') && !tableExists('story')) db.exec('ALTER TABLE card RENAME TO story')
if (has('session_event', 'card_id')) db.exec('ALTER TABLE session_event RENAME COLUMN card_id TO story_id')
// The index came along with the rename and still carries the old name and the old column.
db.exec('DROP INDEX IF EXISTS idx_event_card')

// These two are named rather than written inline below because the migration that gave them an
// epic to belong to has to build them again from scratch — SQLite lifts neither a NOT NULL nor a
// CHECK in place. One definition, used by the schema and by the rebuild, so they cannot drift.
const DECISION_TABLE = `
  CREATE TABLE IF NOT EXISTS decision (
    id            INTEGER PRIMARY KEY,
    story_id      INTEGER REFERENCES story(id) ON DELETE CASCADE,
    epic_id       INTEGER REFERENCES epic(id) ON DELETE CASCADE,
    n             INTEGER NOT NULL,
    text          TEXT NOT NULL,
    source        TEXT NOT NULL DEFAULT 'discussion',
    superseded_by INTEGER REFERENCES decision(id) ON DELETE SET NULL,
    at            INTEGER NOT NULL,
    CHECK ((story_id IS NULL) <> (epic_id IS NULL))
  )
`

// One verdict, in one run, on one decision, under one story. The story is named here and not left
// to the decision: an epic's decision is inherited by every story under it, and it can honestly be
// kept in one of them and violated in another.
const DECISION_CHECK_TABLE = `
  CREATE TABLE IF NOT EXISTS decision_check (
    id          INTEGER PRIMARY KEY,
    story_id    INTEGER NOT NULL REFERENCES story(id) ON DELETE CASCADE,
    decision_id INTEGER NOT NULL REFERENCES decision(id) ON DELETE CASCADE,
    run         INTEGER NOT NULL,
    verdict     TEXT NOT NULL,
    evidence    TEXT NOT NULL DEFAULT '',
    at          INTEGER NOT NULL
  )
`

const ROUND_TABLE = `
  CREATE TABLE IF NOT EXISTS round (
    id              INTEGER PRIMARY KEY,
    story_id        INTEGER REFERENCES story(id) ON DELETE CASCADE,
    epic_id         INTEGER REFERENCES epic(id) ON DELETE CASCADE,
    n               INTEGER NOT NULL,
    estimated_total INTEGER NOT NULL DEFAULT 0,
    question        TEXT NOT NULL DEFAULT '',
    answer          TEXT NOT NULL DEFAULT '',
    at              INTEGER NOT NULL,
    CHECK ((story_id IS NULL) <> (epic_id IS NULL))
  )
`

db.exec(`
  -- One repository's worth of work with a reason behind it. An epic never spans two
  -- repositories: k0 knows where a thing is worked on, and half an epic somewhere else would
  -- have no board to appear on.
  CREATE TABLE IF NOT EXISTS epic (
    id           INTEGER PRIMARY KEY,
    key_num      INTEGER NOT NULL,
    project_path TEXT NOT NULL,
    title        TEXT NOT NULL,
    body         TEXT NOT NULL DEFAULT '',
    state        TEXT NOT NULL DEFAULT 'Open',
    lang         TEXT NOT NULL DEFAULT '',
    sort_hint    INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );

  -- One post-it. A task is a story with a parent: same columns, same rules, same everything —
  -- a story that turned out too big to close is split rather than turned into another species.
  CREATE TABLE IF NOT EXISTS story (
    id              INTEGER PRIMARY KEY,
    key_num         INTEGER NOT NULL DEFAULT 0,
    project_path    TEXT NOT NULL,
    epic_id         INTEGER REFERENCES epic(id) ON DELETE SET NULL,
    parent_story_id INTEGER REFERENCES story(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    description     TEXT,
    body            TEXT NOT NULL DEFAULT '',
    prompt          TEXT,
    plan            TEXT NOT NULL DEFAULT '',
    state           TEXT NOT NULL DEFAULT 'Backlog',
    starred         INTEGER NOT NULL DEFAULT 0,
    lang            TEXT NOT NULL DEFAULT '',
    color           TEXT NOT NULL DEFAULT 'yellow',
    sort_hint       INTEGER NOT NULL DEFAULT 0,
    completed_at    INTEGER,
    imported_at     INTEGER,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );

  -- A real Claude Code session. A story may have had several over its life, one at a time; the
  -- newest is "the session" everywhere else in k0. The session id is nullable on purpose: a row
  -- exists from the moment there is something to remember about the next session — whether it
  -- sends its prompt by itself — which is before Claude Code has given it an id.
  CREATE TABLE IF NOT EXISTS session (
    id                 INTEGER PRIMARY KEY,
    story_id           INTEGER NOT NULL REFERENCES story(id) ON DELETE CASCADE,
    session_id         TEXT,
    alive              INTEGER NOT NULL DEFAULT 0,
    status             TEXT NOT NULL DEFAULT 'IDLE',
    terminal_window_id TEXT,
    work_path          TEXT,
    head_at_start      TEXT,
    auto_send          INTEGER NOT NULL DEFAULT 0,
    auto_closed        INTEGER NOT NULL DEFAULT 0,
    started_at         INTEGER NOT NULL,
    ended_at           INTEGER
  );

  -- What was decided, one sentence per row, numbered per owner and never renumbered: a decision
  -- that changes is superseded by a new one rather than rewritten, because the point of the
  -- counter-check is to hold the work against what was actually said at the time.
  --
  -- A decision belongs to a story OR to an epic, never to both and never to neither — hence the
  -- CHECK. The epic half is not a nicety: an epic is discussed and decided before a single story
  -- of it exists, so with a NOT NULL story the main flow of the whole feature had nowhere to
  -- write and fell back to prose in the epic's body, which is exactly the thing that cannot be
  -- counter-checked. A story's effective decisions are its own plus its epic's; see
  -- effectiveDecisions().
  ${DECISION_TABLE};

  ${DECISION_CHECK_TABLE};

  CREATE TABLE IF NOT EXISTS check_item (
    id       INTEGER PRIMARY KEY,
    story_id INTEGER NOT NULL REFERENCES story(id) ON DELETE CASCADE,
    n        INTEGER NOT NULL,
    text     TEXT NOT NULL,
    state    TEXT NOT NULL DEFAULT 'todo',
    evidence TEXT NOT NULL DEFAULT '',
    by       TEXT NOT NULL DEFAULT 'claude',
    at       INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dependency (
    story_id   INTEGER NOT NULL REFERENCES story(id) ON DELETE CASCADE,
    depends_on INTEGER NOT NULL REFERENCES story(id) ON DELETE CASCADE,
    PRIMARY KEY (story_id, depends_on)
  );

  -- A round of the discussion, owned the same way a decision is and for the same reason: the
  -- rounds that shape an epic happen before there is a story to hang them on.
  ${ROUND_TABLE};

  -- What happened, in the words of whoever did it. The API appends to it and .k0/ prints it;
  -- nothing here is ever rewritten.
  CREATE TABLE IF NOT EXISTS story_log (
    id         INTEGER PRIMARY KEY,
    story_id   INTEGER NOT NULL REFERENCES story(id) ON DELETE CASCADE,
    session_id TEXT,
    text       TEXT NOT NULL,
    at         INTEGER NOT NULL
  );

  -- The next key to hand out in each repository. It is a counter and not a MAX(): a key is
  -- never reused, so deleting K42 must not make the next story K42 again.
  CREATE TABLE IF NOT EXISTS key_seq (
    project_path TEXT PRIMARY KEY,
    next         INTEGER NOT NULL
  );

  -- The diary. It holds BOTH axes — the story's state and the live session's status — which is
  -- why the kind column is there: without it "how long has it been like this" would match a story
  -- state against a session status and quietly answer with the wrong row.
  CREATE TABLE IF NOT EXISTS session_event (
    id       INTEGER PRIMARY KEY,
    story_id INTEGER NOT NULL REFERENCES story(id) ON DELETE CASCADE,
    kind     TEXT NOT NULL DEFAULT 'session',
    status   TEXT NOT NULL,
    at       INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_story_project ON story(project_path, sort_hint, id);
  CREATE INDEX IF NOT EXISTS idx_session_story ON session(story_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_event_story   ON session_event(story_id, at DESC);
  -- The indexes on decision and round are NOT here: they are made below, after the migration
  -- that rebuilds those two tables.

  -- The switches that have to survive a server restart. Board preferences live in the
  -- browser's localStorage, where only the board can see them; what goes here is the
  -- little the server shares with the menu bar icon — today, the mode.
  CREATE TABLE IF NOT EXISTS pref (
    "key"   TEXT PRIMARY KEY,
    "value" TEXT NOT NULL
  );

  -- The dev server k0 started for a repository, and is therefore responsible for. It is
  -- deliberately not a record of what is RUNNING — that is read from the machine every few
  -- seconds and nothing here could be trusted to keep up with it. It is a record of intent:
  -- a row means "k0 started this and it is meant to be up", which is what tells a server that
  -- fell over apart from one that was switched off. Stopping deletes the row.
  CREATE TABLE IF NOT EXISTS dev_server (
    project_path TEXT PRIMARY KEY,
    pid          INTEGER NOT NULL,
    command      TEXT NOT NULL,
    started_at   INTEGER NOT NULL
  );
`)

// Additive migrations: the column may be missing from a database created before it existed, and
// on a board that arrived here as `card` the whole right-hand half of `story` is missing.
addColumns('story', [
  ['key_num', 'INTEGER NOT NULL DEFAULT 0'],
  ['epic_id', 'INTEGER REFERENCES epic(id) ON DELETE SET NULL'],
  ['parent_story_id', 'INTEGER REFERENCES story(id) ON DELETE CASCADE'],
  ['description', 'TEXT'],
  ['body', "TEXT NOT NULL DEFAULT ''"],
  ['plan', "TEXT NOT NULL DEFAULT ''"],
  ['state', "TEXT NOT NULL DEFAULT 'Backlog'"],
  ['starred', 'INTEGER NOT NULL DEFAULT 0'],
  ['lang', "TEXT NOT NULL DEFAULT ''"],
  ['imported_at', 'INTEGER'],
])
addColumns('session_event', [['kind', "TEXT NOT NULL DEFAULT 'session'"]])
// Which command the interface opened this session with, when it opened it with one. NULL is the
// ordinary case and the one every session before this had: somebody pressed Start.
addColumns('session', [['opened_with', 'TEXT']])

// Renaming migrations. The loop above only ever adds columns, so anything renamed when k0
// went from Italian to English needs its own step. These run once and then find nothing to
// do; skipping them would quietly reset a board that already exists.
renameLegacyPrefColumns()
db.exec(`UPDATE story SET color = 'yellow' WHERE color = 'giallo'`)

giveDiscussionsToEpicsToo()

// The four indexes on the two tables a migration can rebuild, and they come after that migration
// for two separate reasons, each of which was a board that would not open or a query that quietly
// stopped using an index.
//
// `epic_id` does not exist yet on a database that predates the epics having a discussion of their
// own, and `CREATE INDEX` on a column that is not there is an error — thrown from the schema block
// at the top of this file, before any migration has had the chance to add it, which is the whole
// board refusing to start. And an index made before the rebuild is attached to the table that the
// rebuild drops, so it would go out with it and never come back.
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_decision_story ON decision(story_id, n);
  CREATE INDEX IF NOT EXISTS idx_decision_epic  ON decision(epic_id, n);
  CREATE INDEX IF NOT EXISTS idx_round_story    ON round(story_id, n);
  CREATE INDEX IF NOT EXISTS idx_round_epic     ON round(epic_id, n);
`)

splitSessionsOut()
allocateMissingKeys()

// Said out loud although `node:sqlite` already does it: unlike the sqlite3 command line, it opens
// every connection with foreign keys ON, which is the only reason the cascades declared above are
// worth the words. Written here so a future change of that default cannot quietly turn every
// `ON DELETE CASCADE` in this file into a comment. `deleteStory` still deletes its children by
// hand anyway — the database is also opened by other tools, and by the user with `sqlite3`.
db.exec('PRAGMA foreign_keys = ON')

function addColumns(table, columns) {
  if (!tableExists(table)) return
  for (const [col, decl] of columns) if (!has(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`)
}

/**
 * `pref` used to be `(chiave, valore)`. SQLite can rename a column in place since 3.25, but
 * only if it is there to rename — hence the probe first. Story colours are a plain UPDATE
 * because the column name never changed, only one of its values.
 */
function renameLegacyPrefColumns() {
  const columns = db.prepare('SELECT name FROM pragma_table_info(?)').all('pref').map((r) => r.name)
  if (columns.includes('chiave')) db.exec('ALTER TABLE pref RENAME COLUMN chiave TO "key"')
  if (columns.includes('valore')) db.exec('ALTER TABLE pref RENAME COLUMN valore TO "value"')
}

// ── Migrations that must happen exactly once ─────────────────────────────────
//
// A migration guarded by the shape of the database — "is the old column still there?" — is only
// re-entrant while every step of it is. The moment one step is allowed to fail quietly, or the
// last statement is the one that removes the evidence, the guard starts lying and the whole
// migration runs a second time on a database it has already moved. So the shape is what decides
// whether there is work to do, and this row is what decides whether it has been done.

// Function declarations and not arrows: the migrations that read them run at the top of this
// file, above where they are written, which a `const` would not survive.
function migrated(name) {
  return !!db.prepare('SELECT 1 FROM pref WHERE "key" = ?').get(`schema.${name}`)
}

function markMigrated(name) {
  db.prepare(`INSERT INTO pref ("key", "value") VALUES (?, '1') ON CONFLICT("key") DO NOTHING`).run(`schema.${name}`)
}

/** Everything or nothing. A migration half-applied is worse than one not started. */
function atomically(fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    fn()
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/**
 * Rebuilding a table beside itself, with the two switches SQLite's own procedure begins with.
 *
 * Foreign keys off, because `node:sqlite` opens every connection with them on and that turns
 * `DROP TABLE decision_old` into an implicit `DELETE FROM`: the `ON DELETE CASCADE` on
 * `decision_check` fires, and every verdict ever recorded leaves with the copy. In silence, and
 * inside a transaction that then commits happily — an upgrade whose counter-check comes out empty.
 *
 * `legacy_alter_table` on, because otherwise `RENAME TO` rewrites the REFERENCES clause of every
 * table that pointed at what was renamed: `decision_check` would come out of the rename pointing
 * at `decision_old`, which is about to be dropped.
 *
 * It wraps `atomically` rather than living inside it because `foreign_keys` set inside a
 * transaction is a no-op that reports success.
 */
function rebuildingTables(fn) {
  db.exec('PRAGMA foreign_keys = OFF')
  db.exec('PRAGMA legacy_alter_table = ON')
  try {
    atomically(fn)
  } finally {
    db.exec('PRAGMA legacy_alter_table = OFF')
    db.exec('PRAGMA foreign_keys = ON')
  }
}

/**
 * `decision` and `round` were born belonging to a story and nothing else. They belong to a story
 * OR to an epic now (see the CHECK on both tables), and neither `NOT NULL` nor a CHECK can be
 * lifted by `ALTER TABLE`: the table has to be built again beside the old one and the rows moved
 * across. That is SQLite's own documented procedure for exactly this, and it is safe here because
 * it happens inside one transaction, under the two pragmas that procedure opens with (see
 * `rebuildingTables`), and only on a database that predates the change.
 */
function giveDiscussionsToEpicsToo() {
  if (has('decision', 'epic_id') && has('round', 'epic_id') && has('decision_check', 'story_id')) return
  rebuildingTables(() => {
    for (const [table, create] of [
      ['decision', DECISION_TABLE],
      ['round', ROUND_TABLE],
    ]) {
      if (has(table, 'epic_id')) continue
      // Only the columns the old table had: `epic_id` has no value to bring across, and every row
      // there belongs to a story by definition.
      const columns = db
        .prepare('SELECT name FROM pragma_table_info(?)')
        .all(table)
        .map((r) => r.name)
        .join(', ')
      db.exec(`ALTER TABLE ${table} RENAME TO ${table}_old`)
      db.exec(create)
      db.exec(`INSERT INTO ${table} (${columns}) SELECT ${columns} FROM ${table}_old`)
      db.exec(`DROP TABLE ${table}_old`)
    }
    // A verdict used to be identified by its decision alone, which stopped working the moment a
    // decision could be inherited: one epic decision checked under three stories is three rows
    // that nothing could tell apart. It comes after the loop above, so `decision.story_id` is
    // there to read the answer out of. A row whose decision is gone is an orphan and does not
    // come across.
    if (!has('decision_check', 'story_id')) {
      db.exec('ALTER TABLE decision_check RENAME TO decision_check_old')
      db.exec(DECISION_CHECK_TABLE)
      db.exec(`
        INSERT INTO decision_check (id, story_id, decision_id, run, verdict, evidence, at)
        SELECT c.id, d.story_id, c.decision_id, c.run, c.verdict, c.evidence, c.at
        FROM decision_check_old c JOIN decision d ON d.id = c.decision_id
      `)
      db.exec('DROP TABLE decision_check_old')
    }
  })
}

/**
 * The one-way step from a board of cards to a board of stories.
 *
 * A card fused the two things that were never the same: what the work is (backlog, done) and
 * what the session is doing right now (working, planning, waiting for you). Here they come
 * apart — the state stays on the story, the session moves to a row of its own — and the board
 * must not notice: `listStories` puts them back together into the same `status` the board has
 * always drawn (see `STATUS`).
 *
 * It moves rows, and moving rows is the one kind of migration that must never happen twice: run
 * it again and every story has two of every session and the board offers you a `Resume` into a
 * conversation that never existed. So it happens inside one transaction — everything or nothing —
 * and the row it writes at the end is what says it has happened. The old `status` column is not
 * that record: it is dropped by the last statements here, and on a build whose SQLite refuses to
 * drop a column it survives, which would invite the whole function in again on the next start.
 */
function splitSessionsOut() {
  if (!has('story', 'status') || migrated('sessions-split')) return

  atomically(() => {
    // The additive loop that ran on `card` in older versions of k0 may never have got there: a
    // board created between two releases can be missing any of these, and the SELECT below reads
    // all of them. Adding them empty costs nothing — they are dropped again at the end.
    addColumns('story', [
      ['session_id', 'TEXT'],
      ['session_alive', 'INTEGER NOT NULL DEFAULT 0'],
      ['auto_send', 'INTEGER NOT NULL DEFAULT 0'],
      ['terminal_window_id', 'TEXT'],
      ['work_path', 'TEXT'],
      ['head_at_start', 'TEXT'],
      ['auto_closed', 'INTEGER NOT NULL DEFAULT 0'],
    ])

    // An orphaned event would fail the foreign key we are about to switch on. Nothing reads one:
    // `deleteStory` has always removed a story's events by hand, so any of these is a scar.
    db.exec('DELETE FROM session_event WHERE story_id NOT IN (SELECT id FROM story)')

    // BACKLOG and COMPLETED were never session statuses; everything else was, and a card carrying
    // one of them had work under way. Six states now, and the other four are only ever reached by
    // saying so — there is nothing in an old board to tell Discussed from Planned.
    db.exec(`
      UPDATE story SET state = CASE status
        WHEN 'BACKLOG'   THEN 'Backlog'
        WHEN 'COMPLETED' THEN 'Done'
        ELSE 'Working'
      END
    `)

    // One session row per card that had a session. `started_at` is the card's birthday: it is the
    // oldest true thing k0 knows about that session, and nothing on the board reads it.
    db.exec(`
      INSERT INTO session (story_id, session_id, alive, status, terminal_window_id, work_path,
                           head_at_start, auto_send, auto_closed, started_at, ended_at)
      SELECT id, session_id, session_alive,
             CASE WHEN status IN ('BACKLOG', 'COMPLETED') THEN 'IDLE' ELSE status END,
             terminal_window_id, work_path, head_at_start, auto_send, auto_closed,
             created_at, CASE WHEN session_alive = 1 THEN NULL ELSE updated_at END
      FROM story WHERE session_id IS NOT NULL AND session_id <> ''
    `)

    // A card with `auto_send` and no session had an instruction waiting for the session it has not
    // started yet. That instruction lives on the session now, so it needs a row to live on.
    db.exec(`
      INSERT INTO session (story_id, session_id, alive, status, auto_send, started_at)
      SELECT id, NULL, 0, 'IDLE', 1, created_at
      FROM story WHERE auto_send = 1 AND (session_id IS NULL OR session_id = '')
    `)

    // The diary is one table with two kinds of row in it now, and the old rows have to say which
    // they are or the age at the bottom of a post-it starts reading the wrong one.
    //
    // Nothing is added to it here, and that is deliberate. A story whose status predates the diary
    // has no row to measure its age from, and inventing one dated `updated_at` would have put a
    // card into a ChangeLog for a Tuesday that was already over — the one place where "the board
    // the day after is identical" would have stopped being true. `STATUS_SINCE` falls back to
    // `updated_at` on its own instead, which is the same answer without writing history.
    db.exec(`
      UPDATE session_event SET kind = 'state', status = CASE status WHEN 'BACKLOG' THEN 'Backlog' ELSE 'Done' END
      WHERE status IN ('BACKLOG', 'COMPLETED')
    `)

    markMigrated('sessions-split')
  })

  // Outside the transaction, and after the row that says the move is done, because this half is
  // allowed to fail. SQLite has dropped columns since 3.35 and Node 24 is well past that; if a
  // build refuses, the columns stay where they are and nobody reads them again — `STORY_COLUMNS`
  // names what it wants, so a leftover `status` can never come back up on a story by accident.
  for (const col of [
    'status',
    'session_id',
    'session_alive',
    'auto_send',
    'terminal_window_id',
    'work_path',
    'head_at_start',
    'auto_closed',
  ]) {
    try {
      db.exec(`ALTER TABLE story DROP COLUMN ${col}`)
    } catch {
      /* older SQLite: leave it, nothing reads it */
    }
  }
}

/**
 * Every story gets its key. In `created_at, id` order per repository, so the numbers run in the
 * order the work was thought of rather than in whatever order the rows happen to come back.
 */
function allocateMissingKeys() {
  const rows = db
    .prepare('SELECT id, project_path FROM story WHERE key_num = 0 ORDER BY project_path, created_at, id')
    .all()
  for (const row of rows) {
    db.prepare('UPDATE story SET key_num = ? WHERE id = ?').run(allocateKey(row.project_path), row.id)
  }
}

/**
 * The next number in this repository, and never one that has been handed out before — not after
 * a delete, not after a story moves under another epic. A repository k0 has not counted yet
 * starts above whatever is already there, so a database rebuilt from `.k0/` cannot collide with
 * the keys written in those files.
 */
// `except` is the story being moved into this repository, and it is already sitting in it by the
// time the number is asked for: without leaving it out it counts itself, and the first story to
// arrive in an empty repository is handed K3 instead of K1. Nothing is broken by the gap, but a
// key is something the user reads out loud, and one that starts at three has to be explained.
function allocateKey(projectPath, except = null) {
  const seq = db.prepare('SELECT next FROM key_seq WHERE project_path = ?').get(projectPath)
  const highest = db
    .prepare(
      `SELECT MAX(n) AS n FROM (
         SELECT MAX(key_num) AS n FROM story WHERE project_path = ? AND id IS NOT ?
         UNION ALL SELECT MAX(key_num) FROM epic WHERE project_path = ?
       )`
    )
    .get(projectPath, except)
  const next = Math.max(seq?.next ?? 1, (highest?.n ?? 0) + 1)
  db.prepare(
    `INSERT INTO key_seq (project_path, next) VALUES (?, ?)
     ON CONFLICT(project_path) DO UPDATE SET next = excluded.next`
  ).run(projectPath, next + 1)
  return next
}

/**
 * A key that came from outside — a `.k0/` file read back into an empty database — keeps the
 * number it was written with, and the counter is pushed past it so nothing is ever handed it
 * a second time.
 */
function reserveKey(projectPath, keyNum) {
  const n = Number(keyNum)
  if (!Number.isInteger(n) || n < 1) return allocateKey(projectPath)
  const seq = db.prepare('SELECT next FROM key_seq WHERE project_path = ?').get(projectPath)
  db.prepare(
    `INSERT INTO key_seq (project_path, next) VALUES (?, ?)
     ON CONFLICT(project_path) DO UPDATE SET next = excluded.next`
  ).run(projectPath, Math.max(seq?.next ?? 1, n + 1))
  return n
}

const now = () => Date.now()

// ── Stories ──────────────────────────────────────────────────────────────────

/**
 * Columns the user can change through PATCH, and nothing else. `state` and `auto_send` are not
 * here on purpose: neither is a column of `story` any more, and `patchStory` sends them on to
 * `setState` and `setAutoSend` rather than let them go quietly nowhere.
 */
const PATCHABLE = [
  'title',
  'description',
  'project_path',
  'prompt',
  'body',
  'plan',
  'starred',
  'lang',
  'color',
  'sort_hint',
  'epic_id',
  'parent_story_id',
]

/**
 * What a story is, flattened with the session it is living through right now.
 *
 * The join is what keeps the promise that the board is the same board as yesterday. Everything
 * that reads a story — the watcher, the idle sweep, the columns that fold away, the post-it
 * itself — was written against one flat row with `session_id` and `status` on it, and in
 * JavaScript a field that has moved to another table does not fail, it reads as `undefined`.
 * So the row still arrives flat, and `status` is still one of the seven codes the board draws:
 * the two axes are put back together here, in one place, and only here.
 */
const STORY_COLUMNS = `
  s.id, s.key_num, 'K' || s.key_num AS "key", s.project_path, s.epic_id, s.parent_story_id,
  s.title, s.description, s.body, s.prompt, s.plan, s.state, s.starred, s.lang, s.color,
  s.sort_hint, s.completed_at, s.imported_at, s.created_at, s.updated_at,
  v.id AS session_row_id, v.session_id, COALESCE(v.alive, 0) AS session_alive,
  v.status AS session_status, v.terminal_window_id, v.work_path, v.head_at_start,
  COALESCE(v.auto_send, 0) AS auto_send, COALESCE(v.auto_closed, 0) AS auto_closed,
  v.started_at AS session_started_at, v.ended_at AS session_ended_at,
  CASE
    WHEN s.completed_at IS NOT NULL THEN 'COMPLETED'
    WHEN v.session_id IS NULL OR v.session_id = '' THEN 'BACKLOG'
    ELSE v.status
  END AS status
`

// The newest session is the session. Ordering by `started_at` alone is not enough: two rows can
// be born in the same millisecond, and then "the current session" would depend on which of them
// SQLite felt like returning first.
const CURRENT_SESSION = `
  LEFT JOIN session v ON v.id = (
    SELECT id FROM session WHERE story_id = s.id ORDER BY started_at DESC, id DESC LIMIT 1
  )
`

/**
 * How long it has been like this, which is the line at the bottom of every post-it.
 *
 * BACKLOG and COMPLETED are not things a session does — they are what the board calls a story
 * with no session and a story you have ticked off — so their age is measured from the last time
 * the story entered the state it is in. Everything else is the live session's own status, and is
 * measured from the last time THIS session went into it.
 *
 * Three matches and not one, each of which was a wrong answer on the board:
 *
 * The state branch matches the state by name. Taking the newest state row whatever it said meant
 * a story ticked off and reopened showed the age of its `Done`, and a backlog post-it that a
 * skill quietly moved to Discussed jumped to "now" with nothing on screen to explain it.
 *
 * The session branch will not look back past `started_at`. A story that has had a session before
 * already has an `IDLE` row from that one, so a session started ten seconds ago inherited it and
 * the post-it claimed five days the moment you pressed Start.
 *
 * And both fall back rather than answer nothing. A status that predates the diary — an old board,
 * a session that has not moved since it opened — has no row of its own, and `updated_at` is the
 * truest thing k0 has about it. Answering NULL left the line blank and the tooltip reading
 * "Your turn for ".
 */
const STATUS_SINCE = `
  CASE WHEN x.status IN ('BACKLOG', 'COMPLETED') THEN COALESCE((
    SELECT e.at FROM session_event e
    WHERE e.story_id = x.id AND e.kind = 'state' AND e.status = x.state
    ORDER BY e.at DESC, e.id DESC LIMIT 1
  ), x.updated_at) ELSE COALESCE((
    SELECT e.at FROM session_event e
    WHERE e.story_id = x.id AND e.kind = 'session' AND e.status = x.status AND e.at >= x.session_started_at
    ORDER BY e.at DESC, e.id DESC LIMIT 1
  ), x.session_started_at, x.updated_at) END AS status_since
`

/**
 * How long the STATE has been what it is — which is not the same question as the one above, and
 * the difference is a whole fortnight wide.
 *
 * `status_since` answers about the live session for everything except a story with no session at
 * all, so a story whose session was abandoned two months ago and whose state moved yesterday
 * reads as two months old. That is right for the line on the post-it, which is about the terminal,
 * and wrong for anything asking whether a piece of work has stopped moving — see `nextStep` in
 * backlog.js, which offers to cut a story in two after fourteen days of it.
 *
 * Every state change writes a row here, `createStory` included, so the fallback to `updated_at`
 * is only ever reached by a story older than the diary.
 */
const STATE_SINCE = `
  COALESCE((
    SELECT e.at FROM session_event e
    WHERE e.story_id = x.id AND e.kind = 'state' AND e.status = x.state
    ORDER BY e.at DESC, e.id DESC LIMIT 1
  ), x.updated_at) AS state_since
`

const storyQuery = (where = '', order = 'ORDER BY x.sort_hint, x.id') => `
  SELECT x.*, ${STATUS_SINCE}, ${STATE_SINCE}
  FROM (SELECT ${STORY_COLUMNS} FROM story s ${CURRENT_SESSION} ${where}) x
  ${order}
`

export function listStories() {
  return db.prepare(storyQuery()).all()
}

export function getStory(id) {
  return db.prepare(storyQuery('WHERE s.id = ?')).get(id)
}

/** The stable name of a story inside its repository: `K42`, and it never changes. */
export function getStoryByKey(projectPath, keyNum) {
  return db.prepare(storyQuery('WHERE s.project_path = ? AND s.key_num = ?')).get(projectPath, Number(keyNum))
}

export function storiesOfProject(projectPath) {
  return db.prepare(storyQuery('WHERE s.project_path = ?')).all(projectPath)
}

export function storiesOfEpic(epicId) {
  return db.prepare(storyQuery('WHERE s.epic_id = ?')).all(epicId)
}

/** The tasks a story was split into, in the order they are to be done. */
export function childStories(storyId) {
  return db.prepare(storyQuery('WHERE s.parent_story_id = ?')).all(storyId)
}

/**
 * The last time you touched each repository from inside k0. `updated_at` moves when you
 * create or edit a story and on every status change of a live session, which makes it the
 * freshest signal k0 has about where you are actually working.
 */
export function projectRecency() {
  return db.prepare('SELECT project_path, MAX(updated_at) AS at FROM story GROUP BY project_path').all()
}

export function createStory({
  title,
  description = '',
  project_path,
  prompt = '',
  body = '',
  color = 'yellow',
  lang = '',
  state = 'Backlog',
  epic_id = null,
  parent_story_id = null,
  sort_hint = 0,
  key_num = null,
  auto_send = false,
}) {
  const t = now()
  const key = key_num == null ? allocateKey(project_path) : reserveKey(project_path, key_num)
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO story (key_num, title, description, project_path, epic_id, parent_story_id, prompt, body,
                       color, lang, state, sort_hint, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(key, title, description || '', project_path, epic_id, parent_story_id, prompt, body, color, lang, state,
    sort_hint, t, t)
  const id = Number(lastInsertRowid)
  recordEvent(id, 'state', state)
  if (auto_send) setAutoSend(id, true)
  return getStory(id)
}

/** Session ids a story already claims: they keep the same session from being imported twice. */
export function sessionIds() {
  return db
    .prepare(`SELECT session_id FROM session WHERE session_id IS NOT NULL AND session_id <> ''`)
    .all()
    .map((r) => r.session_id)
}

/**
 * A session that already happened — outside k0, most likely — becomes a story.
 *
 * Unlike `createStory`, here the session exists already: the story is born with a session that
 * is IDLE, which means "your move", marked dead (`tick` revives it by itself if it turns out to
 * still be running) and dated to when it actually happened. That date is where the age shown
 * at the bottom of the post-it comes from: importing must not make everything look like today.
 * The state is `Working` and not `Backlog` for the same reason: this is work that has started.
 */
export function importStory({ title, description = '', project_path, session_id, started_at, ended_at }) {
  const t = now()
  const born = Number(started_at) || t
  const last = Number(ended_at) || born
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO story (key_num, title, description, project_path, prompt, state, imported_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, '', 'Working', ?, ?, ?)
  `).run(allocateKey(project_path), title, description || '', project_path, t, born, last)
  const id = Number(lastInsertRowid)
  db.prepare(`
    INSERT INTO session (story_id, session_id, alive, status, started_at, ended_at) VALUES (?, ?, 0, 'IDLE', ?, ?)
  `).run(id, session_id, born, last)
  recordEvent(id, 'state', 'Working', last)
  recordEvent(id, 'session', 'IDLE', last)
  return getStory(id)
}

/**
 * A story cannot be its own ancestor. Without this, making a story its own parent is accepted by
 * the PATCH and then `deleteStory` recurses until the stack gives out — a post-it that can never
 * be thrown away, from the board or from the editor's bin.
 */
function wouldCycle(id, parentId) {
  let at = Number(parentId)
  const seen = new Set()
  while (at) {
    if (at === Number(id)) return true
    if (seen.has(at)) return true
    seen.add(at)
    at = Number(db.prepare('SELECT parent_story_id FROM story WHERE id = ?').get(at)?.parent_story_id ?? 0)
  }
  return false
}

export function patchStory(id, fields) {
  const wanted = { ...fields }
  if (wanted.parent_story_id != null && wouldCycle(id, wanted.parent_story_id)) delete wanted.parent_story_id

  const wasIn = db.prepare('SELECT project_path FROM story WHERE id = ?').get(id)?.project_path ?? null

  const entries = Object.entries(wanted).filter(([k]) => PATCHABLE.includes(k))
  if (entries.length) {
    const set = entries.map(([k]) => `${k} = ?`).join(', ')
    db.prepare(`UPDATE story SET ${set}, updated_at = ? WHERE id = ?`)
      .run(...entries.map(([, v]) => (typeof v === 'boolean' ? Number(v) : v)), now(), id)
  }

  // A key is a number inside one repository, so a story that moves to another repository cannot
  // keep it: the repository it lands in has a K3 of its own, and two of them make `getStoryByKey`
  // answer with whichever sorts first, while every skill that resolves a key addresses the wrong
  // story and `wt-K3` collides on the branch. It is given the next number where it now lives; the
  // one it left behind is not handed out again, because `allocateKey` only ever counts forwards.
  const nowIn = db.prepare('SELECT project_path FROM story WHERE id = ?').get(id)?.project_path ?? null
  if (nowIn && nowIn !== wasIn) {
    db.prepare('UPDATE story SET key_num = ? WHERE id = ?').run(allocateKey(nowIn, id), id)
  }

  // Two fields that are not columns of `story` any more, and must not silently go nowhere:
  // `state` writes a line in the diary, `auto_send` belongs to the session that will run next.
  if ('state' in fields) setState(id, fields.state)
  if ('auto_send' in fields) setAutoSend(id, fields.auto_send)
  return getStory(id)
}

/** The six states a story can be in. Any of them may follow any other: no transition is required. */
export const STATES = ['Backlog', 'Discussed', 'Planned', 'Working', 'Review', 'Done']

/**
 * Moving a story. `completed_at` is set here and nowhere else: it is the same fact as `Done`,
 * and two places writing it is two places for them to end up disagreeing.
 */
export function setState(id, state) {
  if (!STATES.includes(state)) return getStory(id)
  const story = getStory(id)
  if (!story || story.state === state) return story
  const done = state === 'Done'
  db.prepare('UPDATE story SET state = ?, completed_at = ?, updated_at = ? WHERE id = ?')
    .run(state, done ? story.completed_at || now() : null, now(), id)
  recordEvent(id, 'state', state)
  return getStory(id)
}

/** Done is the user's word, and it is the only thing that says a story is finished. */
export function setCompleted(id, completed) {
  const story = getStory(id)
  if (!story) return story
  if (completed) return setState(id, 'Done')
  setState(id, story.session_id ? 'Working' : 'Backlog')
  if (story.session_id) {
    // The clock at the bottom of the post-it starts again here. A session that was already IDLE
    // when you ticked the story off is still IDLE now, so `applyDerivedStatus` finds nothing
    // changed and writes nothing — and the age would then be read off the row from BEFORE Done,
    // so a job you have just reopened comes back saying "4 days" and sorts to the bottom.
    if (currentSession(id)?.status === 'IDLE') recordEvent(id, 'session', 'IDLE')
    // Back to your move. A session that is really still running is put right by the next round of
    // the watching loop, a second later; leaving WORKING on a story you have just reopened would
    // claim something is grinding away when the terminal was closed when you ticked it off.
    applyDerivedStatus(id, 'IDLE', story.session_alive)
  }
  return getStory(id)
}

export function deleteStory(id, seen = new Set()) {
  // A story that was made its own ancestor — or two that were made each other's — would send this
  // round for ever and the DELETE would answer 500 rather than throw the post-it away. `patchStory`
  // refuses to build that shape; this is what makes a database that already has one deletable.
  if (seen.has(Number(id))) return
  seen.add(Number(id))
  // A task cannot outlive the story it was split out of: it carries none of the context that
  // made it a task. The declared cascade would do this too — but only where foreign keys are on,
  // and this has to be true on every build k0 runs on.
  for (const child of db.prepare('SELECT id FROM story WHERE parent_story_id = ?').all(id)) {
    deleteStory(child.id, seen)
  }
  // Both ways round: a verdict this story wrote about an inherited decision belongs to this story
  // and goes with it, and so does one about a decision of its own.
  db.prepare('DELETE FROM decision_check WHERE story_id = ?').run(id)
  db.prepare('DELETE FROM decision_check WHERE decision_id IN (SELECT id FROM decision WHERE story_id = ?)').run(id)
  db.prepare('DELETE FROM decision WHERE story_id = ?').run(id)
  db.prepare('DELETE FROM check_item WHERE story_id = ?').run(id)
  db.prepare('DELETE FROM round WHERE story_id = ?').run(id)
  db.prepare('DELETE FROM story_log WHERE story_id = ?').run(id)
  db.prepare('DELETE FROM dependency WHERE story_id = ? OR depends_on = ?').run(id, id)
  db.prepare('DELETE FROM session WHERE story_id = ?').run(id)
  db.prepare('DELETE FROM session_event WHERE story_id = ?').run(id)
  db.prepare('DELETE FROM story WHERE id = ?').run(id)
}

// ── The session a story is living through ────────────────────────────────────

export function currentSession(storyId) {
  return db
    .prepare('SELECT * FROM session WHERE story_id = ? ORDER BY started_at DESC, id DESC LIMIT 1')
    .get(storyId) ?? null
}

/** Every session this story has had, oldest first: the story's own history of attempts. */
export function listSessions(storyId) {
  return db.prepare('SELECT * FROM session WHERE story_id = ? ORDER BY started_at, id').all(storyId)
}

/** From Claude Code's session id back to the row: the worktree endpoints arrive holding one. */
export function getSessionByClaudeId(sessionId) {
  return db.prepare('SELECT * FROM session WHERE session_id = ? ORDER BY started_at DESC, id DESC LIMIT 1')
    .get(sessionId) ?? null
}

/**
 * The row the next session will be. A story that has never been started has no session, but it
 * can already carry something the session will need — whether to send its prompt by itself — so
 * the row is made empty, with no session id, and the board goes on reading it as no session.
 */
function sessionSlot(storyId) {
  const cur = currentSession(storyId)
  if (cur) return cur
  const { lastInsertRowid } = db.prepare('INSERT INTO session (story_id, started_at) VALUES (?, ?)')
    .run(storyId, now())
  return db.prepare('SELECT * FROM session WHERE id = ?').get(Number(lastInsertRowid))
}

/**
 * The story is being started. `started_at` is not bookkeeping: it is where the age at the bottom
 * of the post-it is measured from until the session first moves (see `STATUS_SINCE`), which is
 * what keeps a story you have just started from inheriting the "5 days" of the session before it.
 *
 * `openedWith` is the command the interface said out loud — `k0-plan`, `k0-discuss` — or nothing
 * at all when somebody simply pressed Start. It is kept because a session has to be able to say
 * later what it was opened to do: see `applyDerivedStatus`, where the difference decides whether
 * the story is now being worked on or merely talked about.
 */
export function attachSession(storyId, sessionId, openedWith = null) {
  const slot = sessionSlot(storyId)
  if (slot.session_id) {
    // The story is starting a new conversation: the old one is closed off rather than written
    // over, so the story keeps the history of what has been tried on it.
    db.prepare('UPDATE session SET alive = 0, ended_at = COALESCE(ended_at, ?) WHERE id = ?').run(now(), slot.id)
    db.prepare(`
      INSERT INTO session (story_id, session_id, alive, status, auto_send, opened_with, started_at)
      VALUES (?, ?, 1, 'IDLE', ?, ?, ?)
    `).run(storyId, sessionId, slot.auto_send, openedWith, now())
  } else {
    db.prepare(`
      UPDATE session SET session_id = ?, alive = 1, ended_at = NULL, opened_with = ?, started_at = ? WHERE id = ?
    `).run(sessionId, openedWith, now(), slot.id)
  }
  db.prepare('UPDATE story SET updated_at = ? WHERE id = ?').run(now(), storyId)
  return getStory(storyId)
}

/**
 * Back out of a failed start. A session that never opened a terminal must leave no trace, or the
 * story would offer a `Resume` that cannot work — so the row goes, and the one before it, if
 * there is one, becomes the current session again exactly as it was.
 */
export function detachSession(storyId, previousSessionId = null) {
  const cur = currentSession(storyId)
  if (cur) {
    const earlier = previousSessionId
      ? db.prepare('SELECT * FROM session WHERE story_id = ? AND session_id = ? AND id <> ? ORDER BY id DESC LIMIT 1')
          .get(storyId, previousSessionId, cur.id)
      : null
    if (earlier) {
      db.prepare('DELETE FROM session WHERE id = ?').run(cur.id)
      db.prepare(`UPDATE session SET alive = 0, ended_at = NULL, status = 'IDLE' WHERE id = ?`).run(earlier.id)
    } else if (previousSessionId) {
      // There is no earlier row to go back to because the session that was there was written
      // over rather than replaced. It is put back where it was, which is what was asked.
      db.prepare(`
        UPDATE session SET session_id = ?, alive = 0, status = 'IDLE', ended_at = NULL WHERE id = ?
      `).run(previousSessionId, cur.id)
    } else {
      // Nothing to go back to: the row is emptied rather than deleted, because it is also where
      // `auto_send` is kept and that was set before any of this and is still true.
      db.prepare(`
        UPDATE session SET session_id = NULL, alive = 0, status = 'IDLE', head_at_start = NULL,
                           terminal_window_id = NULL, ended_at = NULL WHERE id = ?
      `).run(cur.id)
    }
  }
  db.prepare('UPDATE story SET updated_at = ? WHERE id = ?').run(now(), storyId)
  return getStory(storyId)
}

/** Whether the session sends the prompt by itself. It is set before the session exists, and kept. */
export function setAutoSend(storyId, on) {
  const cur = currentSession(storyId)
  // Switching it off on a story that has never been started is already true: no empty session
  // row is made just to write the default into it.
  if (!cur && !on) return getStory(storyId)
  db.prepare('UPDATE session SET auto_send = ? WHERE id = ?').run(on ? 1 : 0, (cur ?? sessionSlot(storyId)).id)
  return getStory(storyId)
}

/**
 * The four things k0 learns about a session while it runs. None of them is work on the story, so
 * none of them may move `updated_at`: that field is what tells k0 which repository you are
 * working in today, and a live session would otherwise keep every story it touches at the top.
 *
 * With no session there is nothing to write on and nothing to complain about either: the story
 * simply comes back unchanged.
 */
function setSessionColumn(storyId, column, value) {
  const cur = currentSession(storyId)
  if (cur) db.prepare(`UPDATE session SET ${column} = ? WHERE id = ?`).run(value, cur.id)
  return getStory(storyId)
}

/** The story's terminal window, so a double click can bring it back to the front. */
export function setTerminalWindow(storyId, windowId) {
  return setSessionColumn(storyId, 'terminal_window_id', windowId || null)
}

/**
 * The directory the session actually works in. Usually that is the repository, but with an
 * isolated worktree it is somewhere else — and that worktree has a working tree of its own,
 * so that is where to look for uncommitted work belonging to THIS session.
 */
export function setWorkPath(storyId, workPath) {
  return setSessionColumn(storyId, 'work_path', workPath || null)
}

/**
 * Who shut this session's terminal: you, or k0 tidying up after a long silence. The post-it says
 * so in one word, and the word has to be right — a window you closed yourself two minutes ago
 * must not claim k0 did it.
 */
export function setAutoClosed(storyId, on) {
  return setSessionColumn(storyId, 'auto_closed', on ? 1 : 0)
}

/** Where HEAD was when the session started: everything after it is this session's doing. */
export function setHeadAtStart(storyId, sha) {
  return setSessionColumn(storyId, 'head_at_start', sha || null)
}

/** What a caller outside db.js may change on a session row, and nothing else. */
const SESSION_PATCHABLE = ['terminal_window_id', 'work_path', 'head_at_start', 'auto_send', 'auto_closed']

export function patchSession(sessionRowId, fields) {
  const entries = Object.entries(fields).filter(([k]) => SESSION_PATCHABLE.includes(k))
  if (entries.length) {
    const set = entries.map(([k]) => `${k} = ?`).join(', ')
    db.prepare(`UPDATE session SET ${set} WHERE id = ?`)
      .run(...entries.map(([, v]) => (typeof v === 'boolean' ? Number(v) : v)), sessionRowId)
  }
  return db.prepare('SELECT * FROM session WHERE id = ?').get(sessionRowId) ?? null
}

// The states a live session takes a story out of. Review and Done are not among them on purpose:
// a session opened to check something over, or opened again on finished work, must not quietly
// undo the word you gave it.
const NOT_YET_STARTED = new Set(['Backlog', 'Discussed', 'Planned'])

/**
 * The commands that mean the work has begun. Everything else the interface can start only TALKS
 * about the story — it asks questions, it writes a plan, it cuts one story into two — and a
 * session doing that must not move the story to `Working`.
 *
 * Without this, pressing "Discuss" on a note nobody has decided anything about moved it to
 * `Working` before the first question was asked; close the terminal half way through and the
 * story sat there with a dead session, being offered a counter-check on work that never happened.
 *
 * A session with no command at all — somebody pressed Start — is work, as it has always been.
 */
const STARTS_THE_WORK = new Set(['k0-work'])

/**
 * Writes the live status only when it changed, and records an event when it does.
 *
 * This is the one write that moves the story's `updated_at` without anybody typing anything, and
 * it has to keep doing so: the idle sweep takes the newest of several clocks before it closes a
 * terminal, and the board folds away the repositories nothing has happened in. Take this away
 * and a terminal you are working in looks abandoned to both of them.
 */
export function applyDerivedStatus(storyId, status, alive) {
  const cur = currentSession(storyId)
  if (!cur) return
  const aliveInt = alive ? 1 : 0
  if (cur.status !== status || cur.alive !== aliveInt) {
    db.prepare('UPDATE session SET status = ?, alive = ?, ended_at = ? WHERE id = ?')
      .run(status, aliveInt, aliveInt ? null : cur.ended_at ?? now(), cur.id)
    db.prepare('UPDATE story SET updated_at = ? WHERE id = ?').run(now(), storyId)
    if (cur.status !== status) recordEvent(storyId, 'session', status)
  }
  // A session that is really running says the story is being worked on, and says it without being
  // asked: that is the one state change nobody has to make by hand.
  //
  // Outside the guard above, and that is the whole of this: a session is born IDLE and marked
  // alive, and a terminal sitting at its prompt reports IDLE too — so the first round after
  // `Start` has nothing to write on the session row and used to return here, leaving a story that
  // is plainly being worked on sitting in `Backlog` until the model happened to go busy.
  //
  // One column and not `getStory`: this now runs on every live session on every round of the
  // watching loop, and the flat row costs three subqueries to build. The state is all it asks for.
  if (aliveInt && (!cur.opened_with || STARTS_THE_WORK.has(cur.opened_with))) {
    const state = db.prepare('SELECT state FROM story WHERE id = ?').get(storyId)?.state
    if (state && NOT_YET_STARTED.has(state)) setState(storyId, 'Working')
  }
}

/** `at` is only passed when importing: there the event belongs to when it happened, not now. */
function recordEvent(storyId, kind, status, at = now()) {
  db.prepare('INSERT INTO session_event (story_id, kind, status, at) VALUES (?, ?, ?, ?)')
    .run(storyId, kind, status, at)
}

/**
 * The stories that moved inside a window, one row each, with where they got to.
 *
 * `session_event` has been keeping this diary since the beginning — a row every time something
 * really changes, and none when nothing happens — and until now the only thing anybody ever
 * asked it was how old the current status is. This is the first question that reads it as what
 * it is: a history.
 *
 * `touched` is when the story last moved inside the window, not when it moved last: work
 * finished on Tuesday belongs to Tuesday even if it was reopened on Friday.
 */
export function eventsBetween(from, to) {
  return db.prepare(`
    SELECT s.id, s.title, s.description, s.project_path, s.state, s.completed_at,
           CASE
             WHEN s.completed_at IS NOT NULL THEN 'COMPLETED'
             WHEN v.session_id IS NULL OR v.session_id = '' THEN 'BACKLOG'
             ELSE v.status
           END AS status,
           MAX(e.at) AS touched, COUNT(e.id) AS moves
    FROM session_event e JOIN story s ON s.id = e.story_id ${CURRENT_SESSION}
    WHERE e.at >= ? AND e.at < ?
    GROUP BY s.id
    ORDER BY touched DESC
  `).all(from, to)
}

// ── Epics ────────────────────────────────────────────────────────────────────

const EPIC_PATCHABLE = ['title', 'body', 'state', 'lang', 'sort_hint']

/** An epic is open or it is done. There is no third thing an epic can be. */
export const EPIC_STATES = ['Open', 'Done']

const epicRow = `SELECT id, key_num, 'K' || key_num AS "key", project_path, title, body, state, lang,
                        sort_hint, created_at, updated_at FROM epic`

export function listEpics(projectPath = null) {
  return projectPath
    ? db.prepare(`${epicRow} WHERE project_path = ? ORDER BY sort_hint, id`).all(projectPath)
    : db.prepare(`${epicRow} ORDER BY project_path, sort_hint, id`).all()
}

export function getEpic(id) {
  return db.prepare(`${epicRow} WHERE id = ?`).get(id)
}

export function getEpicByKey(projectPath, keyNum) {
  return db.prepare(`${epicRow} WHERE project_path = ? AND key_num = ?`).get(projectPath, Number(keyNum))
}

export function createEpic({ project_path, title, body = '', lang = '', sort_hint = 0, key_num = null }) {
  const t = now()
  const key = key_num == null ? allocateKey(project_path) : reserveKey(project_path, key_num)
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO epic (key_num, project_path, title, body, lang, sort_hint, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(key, project_path, title, body, lang, sort_hint, t, t)
  return getEpic(Number(lastInsertRowid))
}

export function patchEpic(id, fields) {
  // The same lock `setState` puts on a story, on the side that had none: `state` is a column like
  // any other here, so a request saying `Working` used to be stored word for word — and then the
  // epic is neither open nor done, on the board, in its `.k0/` front matter, and on the way back
  // in, where `mirror.js` reads anything that is not `Done` as open. A word that is not a state is
  // dropped rather than argued with, exactly as a story's is.
  const wanted = { ...fields }
  if ('state' in wanted && !EPIC_STATES.includes(wanted.state)) delete wanted.state
  const entries = Object.entries(wanted).filter(([k]) => EPIC_PATCHABLE.includes(k))
  if (entries.length) {
    const set = entries.map(([k]) => `${k} = ?`).join(', ')
    db.prepare(`UPDATE epic SET ${set}, updated_at = ? WHERE id = ?`)
      .run(...entries.map(([, v]) => (typeof v === 'boolean' ? Number(v) : v)), now(), id)
  }
  return getEpic(id)
}

/**
 * Deleting an epic is deleting the folder, not the work: the stories stay, without an epic.
 *
 * What does go is the epic's own discussion — its rounds, its decisions, and the verdicts its
 * stories wrote about those decisions. There is nothing left to inherit them, and a verdict about
 * a rule nobody can read any more is worse than no verdict.
 */
export function deleteEpic(id) {
  db.prepare('DELETE FROM decision_check WHERE decision_id IN (SELECT id FROM decision WHERE epic_id = ?)').run(id)
  db.prepare('DELETE FROM decision WHERE epic_id = ?').run(id)
  db.prepare('DELETE FROM round WHERE epic_id = ?').run(id)
  db.prepare('UPDATE story SET epic_id = NULL, updated_at = ? WHERE epic_id = ?').run(now(), id)
  db.prepare('DELETE FROM epic WHERE id = ?').run(id)
}

// ── The clocks a rebuild has to put back ─────────────────────────────────────

/**
 * The dates of a restored epic or story, set back to the ones its `.k0/` file records.
 *
 * It is the last thing `importRepo` does, and it has to be: every write above it — a decision, a
 * round, a state — moves `updated_at` to now, and the point of the dates is that they are the ones
 * the board had. Without this a rebuilt repository comes back with every post-it claiming to have
 * been touched at the same instant: the warm columns flat, the `Old` fold empty, and `next()`
 * unable to say what has been sitting in Review longest.
 *
 * It is not `patchStory`. These columns are not patchable from a request and must not become so —
 * this is the one caller, and it is putting back what it has just read, not accepting a date from
 * outside. A date the file does not carry is left alone rather than written as null: an older file
 * has no `completed:` line, and reading that as "never finished" would reopen work that was done.
 */
export function restoreTimes(kind, id, { created_at = null, updated_at = null, completed_at = null } = {}) {
  const table = kind === 'epic' || kind === 'story' ? kind : null
  if (!table || !id) return
  const set = [['created_at', created_at], ['updated_at', updated_at]]
    // `completed_at` is a column of `story` alone: an epic says it is finished with its state.
    .concat(table === 'story' ? [['completed_at', completed_at]] : [])
    .filter(([, v]) => Number.isFinite(v) && v > 0)
  if (!set.length) return
  db.prepare(`UPDATE ${table} SET ${set.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...set.map(([, v]) => v), id)
}

// ── Decisions ────────────────────────────────────────────────────────────────
// Numbered per owner and never renumbered: D3 in the discussion, in the plan, in the `.k0/` file
// and in the counter-check has to be the same D3 a month later.
//
// An owner is a story or an epic. An epic's decisions are inherited by every story under it, and
// inherited rather than copied on purpose: a copy forks the first time one of them is superseded,
// and then two stories of the same epic are being held to two different rules with the same
// number on them.

export function listDecisions(storyId) {
  return db.prepare('SELECT * FROM decision WHERE story_id = ? ORDER BY n').all(storyId)
}

export function listEpicDecisions(epicId) {
  return db.prepare('SELECT * FROM decision WHERE epic_id = ? ORDER BY n').all(epicId)
}

/**
 * The same, labelled the way every story under the epic will see them.
 *
 * The label is composed here and nowhere else. `K7·D3` is what the user reads in a plan, in a
 * verification run and in the `.k0/` file, and a name assembled in three places is a name that
 * ends up written three ways the day the separator changes.
 */
export function epicDecisions(epicId) {
  const epic = getEpic(epicId)
  if (!epic) return []
  return listEpicDecisions(epicId).map((d) => ({ ...d, owner: 'epic', label: `${epic.key}·D${d.n}` }))
}

/**
 * What this story is actually held to: its own decisions plus its epic's, the epic's first
 * because they were taken first and they shape the ones under them.
 *
 * `label` is what the counter-check prints. An inherited decision carries its epic's key in
 * front — `K7·D3` — so nobody reading a verification run has to wonder why a rule they never
 * discussed on this story is being checked against it.
 */
export function effectiveDecisions(storyId) {
  const story = getStory(storyId)
  if (!story) return []
  const epic = story.epic_id ? getEpic(story.epic_id) : null
  const inherited = epic ? epicDecisions(epic.id) : []
  const own = listDecisions(storyId).map((d) => ({ ...d, owner: 'story', label: `D${d.n}` }))
  return [...inherited, ...own]
}

/**
 * The stories something has already been decided about, all of them, in one statement.
 *
 * The same question `effectiveDecisions` answers for one story — its own decisions plus its
 * epic's, counting only what still stands — and the board asks it of every post-it it draws, once
 * a second. Asked one at a time it costs four queries a story, and a story with no decisions pays
 * exactly as much as one with nine; asked like this a board of two hundred costs one.
 *
 * `d.epic_id = s.epic_id` is safe on a story with no epic: in SQL nothing equals NULL.
 */
export function decidedStories() {
  return new Set(
    db
      .prepare(`
        SELECT s.id FROM story s WHERE EXISTS (
          SELECT 1 FROM decision d
          WHERE d.superseded_by IS NULL AND (d.story_id = s.id OR d.epic_id = s.epic_id)
        )
      `)
      .all()
      .map((r) => r.id)
  )
}

export function getDecision(id) {
  return db.prepare('SELECT * FROM decision WHERE id = ?').get(id)
}

const nextDecisionNumber = (column, ownerId) =>
  db.prepare(`SELECT COALESCE(MAX(n), 0) + 1 AS n FROM decision WHERE ${column} = ?`).get(ownerId).n

/**
 * `n` is normally the next one, and is only ever passed in from outside when a `.k0/` file is
 * being read back: the numbers written in that file are the numbers the decisions have been
 * called all along, gaps and all, and renumbering them on the way in would silently rewrite every
 * plan and every verification run that names one.
 */
function insertDecision(column, ownerId, { text, source = 'discussion', at = null, n = null }) {
  const given = Number(n)
  const number = Number.isInteger(given) && given > 0 ? given : nextDecisionNumber(column, ownerId)
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO decision (${column}, n, text, source, at) VALUES (?, ?, ?, ?, ?)
  `).run(ownerId, number, text, source, Number(at) || now())
  return getDecision(Number(lastInsertRowid))
}

export function addDecision(storyId, decision) {
  return insertDecision('story_id', storyId, decision)
}

/** Taken while the epic was being discussed, before any of its stories existed. */
export function addEpicDecision(epicId, decision) {
  return insertDecision('epic_id', epicId, decision)
}

/** Two decisions belong to the same discussion: the same story, or the same epic. */
const sameOwner = (a, b) =>
  !!a && !!b && (a.story_id ? a.story_id === b.story_id : a.epic_id === b.epic_id)

/**
 * A decision is never rewritten: the one that replaces it points back at what it replaced.
 *
 * The argument is a row id and never a per-owner `n` — D2 exists on the epic and on every story
 * under it, so a number here would point at four different decisions depending on who read it.
 * And in a young database the two are both small integers, so `3` meant as D3 lands on whatever
 * has row id 3: usually another story's rule, which the UPDATE would accept without a word.
 *
 * So the target is looked up and has to be a decision of the same owner, and not this row itself.
 * Anything else leaves the decision standing, because the damage is silent and one-way — a rule
 * marked superseded drops out of the plan, out of the constraints `/k0-work` holds itself to and
 * out of `openViolations`, and the `.k0/` file goes on printing it as though it were still in
 * force. `null` still goes through: taking a supersession back off is a real thing to want.
 */
export function supersedeDecision(id, bySomeDecisionId) {
  const decision = getDecision(id)
  if (!decision) return null
  if (bySomeDecisionId == null || bySomeDecisionId === '') {
    db.prepare('UPDATE decision SET superseded_by = NULL WHERE id = ?').run(id)
    return getDecision(id)
  }
  const by = getDecision(Number(bySomeDecisionId))
  if (!by || by.id === decision.id || !sameOwner(decision, by)) return decision
  db.prepare('UPDATE decision SET superseded_by = ? WHERE id = ?').run(by.id, id)
  return getDecision(id)
}

/** The same question asked before the write, so a request can be told no in a sentence. */
export function maySupersede(id, byId) {
  const decision = getDecision(id)
  const by = getDecision(Number(byId))
  return !!decision && !!by && by.id !== decision.id && sameOwner(decision, by)
}

// ── The counter-check ────────────────────────────────────────────────────────

/** The three answers a counter-check may give. A word that is not one of them is not a verdict. */
const VERDICTS = new Set(['kept', 'violated', 'na'])

/** The runs there have been on this story, newest number first. */
export function latestRun(storyId) {
  return db.prepare('SELECT COALESCE(MAX(run), 0) AS run FROM decision_check WHERE story_id = ?').get(storyId).run
}

/**
 * The three ways a caller can name a decision, in one place: what a run is recorded against and
 * what a run is checked for completeness against have to be the same reading, or the endpoint
 * would refuse a verdict the writer would have accepted.
 */
function naming(decisions) {
  return {
    byId: new Map(decisions.map((d) => [d.id, d])),
    byLabel: new Map(decisions.map((d) => [d.label, d])),
    byNumber: new Map(decisions.filter((d) => d.owner === 'story').map((d) => [d.n, d])),
  }
}

const named = (maps, r) =>
  maps.byId.get(Number(r.decision_id)) ??
  maps.byLabel.get(String(r.label ?? '')) ??
  maps.byNumber.get(Number(r.decision_n))

const verdictOf = (r) => String(r?.verdict ?? '').trim().toLowerCase().replace('n/a', 'na')

/**
 * One verification run, written whole.
 *
 * A verdict names the decision it is about in whichever way the caller has it: the row `id`, the
 * `label` the story was shown (`D2`, or `K7·D3` for one that came down from the epic), or the
 * plain number of one of the story's own. A number on its own cannot say which owner it means —
 * an epic has a D2 and so does every story under it — so it is read as the story's, and anything
 * that matches no decision of this story is dropped rather than invented.
 *
 * The verdict is held to the same standard. Something that is not `kept`, `violated` or `na` is
 * counted as neither by everything downstream, so storing it would leave a run claiming a decision
 * was judged when nothing judged it. The number of rows that landed comes back for exactly this:
 * fewer than were sent is the caller's sign that some of them said nothing.
 */
export function recordRunChecks(storyId, run, results) {
  const maps = naming(effectiveDecisions(storyId))
  const t = now()
  let written = 0
  for (const r of results || []) {
    const decision = named(maps, r)
    if (!decision) continue
    const verdict = verdictOf(r)
    if (!VERDICTS.has(verdict)) continue
    db.prepare(`
      INSERT INTO decision_check (story_id, decision_id, run, verdict, evidence, at) VALUES (?, ?, ?, ?, ?, ?)
    `).run(storyId, decision.id, Number(run), verdict, String(r.evidence || ''), t)
    written++
  }
  return written
}

/**
 * The standing decisions a proposed run says nothing about, read the same way the run itself will
 * be read so the two can never disagree about what was answered.
 *
 * A run is the whole set or it is not a run. Nine verdicts out of ten is the failure the whole
 * feature exists to prevent, and it used to be invisible from both ends: `recordRunChecks` drops
 * what it cannot match without a word, and the tenth decision simply kept whatever it was last
 * told. Asking this first is what lets the answer name the sentences that were left out — the one
 * thing the caller cannot work out from a count of what landed.
 *
 * Superseded decisions are not among them. They lost, the one that beat them is in the set, and
 * `/k0-verify` is right to pass over them.
 */
export function unanswered(storyId, results) {
  const decisions = effectiveDecisions(storyId)
  const maps = naming(decisions)
  const answered = new Set()
  for (const r of results || []) {
    const decision = named(maps, r)
    if (decision && VERDICTS.has(verdictOf(r))) answered.add(decision.id)
  }
  return decisions.filter((d) => !d.superseded_by && !answered.has(d.id))
}

export function listDecisionChecks(storyId, run = null) {
  const where = run == null ? '' : 'AND c.run = ?'
  const args = run == null ? [storyId] : [storyId, Number(run)]
  const labels = new Map(effectiveDecisions(storyId).map((d) => [d.id, d.label]))
  return db
    .prepare(`
      SELECT c.*, d.n AS decision_n, d.text AS decision_text, d.epic_id AS decision_epic_id
      FROM decision_check c JOIN decision d ON d.id = c.decision_id
      WHERE c.story_id = ? ${where}
      ORDER BY c.run, d.epic_id IS NULL, d.n
    `)
    .all(...args)
    .map((c) => ({ ...c, label: labels.get(c.decision_id) ?? `D${c.decision_n}` }))
}

/**
 * What stands between a story and `Done`: a decision a counter-check found broken that nothing
 * has answered since.
 *
 * Per DECISION and not per run, which is the whole of it. Reading the latest run alone made a run
 * that leaves a decision out — nine of ten checked, or one thing looked at again after a fix —
 * clear a violation nobody had done anything about: the story went to Done with the rule still
 * broken and no line anywhere saying so. Verdicts are ordered by run, so the last word about each
 * decision is the one that counts, whichever run said it.
 *
 * Exactly two things answer a violation. A later run that finds the decision `kept` — it was put
 * right — and superseding the decision, which is the user saying the rule itself was wrong; a
 * superseded decision is not in the standing set at all. `na` is neither, and does not clear one:
 * "it does not apply any more" about a rule that was found broken is the escape hatch
 * `/k0-verify` tells the model not to take, and this is the only place that can hold it to that.
 */
export function openViolations(storyId) {
  const standing = new Set(effectiveDecisions(storyId).filter((d) => !d.superseded_by).map((d) => d.id))
  const open = new Map()
  for (const c of listDecisionChecks(storyId)) {
    if (!standing.has(c.decision_id)) continue
    if (c.verdict === 'violated') open.set(c.decision_id, c)
    else if (c.verdict === 'kept') open.delete(c.decision_id)
  }
  return [...open.values()]
}

// ── The checklist ────────────────────────────────────────────────────────────

export function listCheckItems(storyId) {
  return db.prepare('SELECT * FROM check_item WHERE story_id = ? ORDER BY n').all(storyId)
}

/** The checklist is replaced whole, never merged: half an old list and half a new one is neither. */
export function setCheckItems(storyId, items) {
  db.prepare('DELETE FROM check_item WHERE story_id = ?').run(storyId)
  const t = now()
  let n = 0
  for (const item of items || []) {
    const text = String(item?.text ?? '').trim()
    if (!text) continue
    db.prepare('INSERT INTO check_item (story_id, n, text, state, evidence, by, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(storyId, ++n, text, item.state || 'todo', item.evidence || '', item.by || 'claude', t)
  }
  return listCheckItems(storyId)
}

const CHECK_PATCHABLE = ['state', 'evidence', 'by', 'text']

export function patchCheckItem(id, fields) {
  const entries = Object.entries(fields).filter(([k]) => CHECK_PATCHABLE.includes(k))
  if (entries.length) {
    const set = entries.map(([k]) => `${k} = ?`).join(', ')
    db.prepare(`UPDATE check_item SET ${set}, at = ? WHERE id = ?`)
      .run(...entries.map(([, v]) => v), now(), id)
  }
  return db.prepare('SELECT * FROM check_item WHERE id = ?').get(id)
}

// ── What waits on what ───────────────────────────────────────────────────────

/** The stories this one is waiting for, with enough of each to say so on the post-it. */
export function dependenciesOf(storyId) {
  return db.prepare(`
    SELECT s.id, s.key_num, 'K' || s.key_num AS "key", s.title, s.state
    FROM dependency d JOIN story s ON s.id = d.depends_on
    WHERE d.story_id = ? ORDER BY s.sort_hint, s.id
  `).all(storyId)
}

/** And the ones waiting for it, which is what makes finishing this one worth doing first. */
export function dependentsOf(storyId) {
  return db.prepare(`
    SELECT s.id, s.key_num, 'K' || s.key_num AS "key", s.title, s.state
    FROM dependency d JOIN story s ON s.id = d.story_id
    WHERE d.depends_on = ? ORDER BY s.sort_hint, s.id
  `).all(storyId)
}

export function addDependency(storyId, dependsOn) {
  // A story that waits for itself would be blocked for ever, and nothing would say why.
  if (Number(storyId) === Number(dependsOn)) return false
  db.prepare('INSERT OR IGNORE INTO dependency (story_id, depends_on) VALUES (?, ?)').run(storyId, dependsOn)
  return true
}

export function removeDependency(storyId, dependsOn) {
  db.prepare('DELETE FROM dependency WHERE story_id = ? AND depends_on = ?').run(storyId, dependsOn)
}

// ── The rounds of a discussion ───────────────────────────────────────────────
// Owned by a story or by an epic, the same way a decision is: an epic is discussed before any of
// its stories exist, and those rounds have to land somewhere that can be read back.

/** Takes the owner by name — `listRounds({ storyId })` or `listRounds({ epicId })` — never both. */
export function listRounds({ storyId = null, epicId = null } = {}) {
  const [column, id] = storyId ? ['story_id', storyId] : ['epic_id', epicId]
  if (!id) return []
  return db.prepare(`SELECT * FROM round WHERE ${column} = ? ORDER BY n`).all(id)
}

/**
 * A round is written before the next question is asked, so a terminal that dies at round three
 * does not take the first three with it. Writing the same round twice replaces it: the question
 * goes down when it is asked and the answer when it arrives, and that is one round, not two.
 */
function putRound(column, ownerId, { n, estimated_total = 0, question = '', answer = '' }) {
  db.prepare(`DELETE FROM round WHERE ${column} = ? AND n = ?`).run(ownerId, Number(n))
  db.prepare(`
    INSERT INTO round (${column}, n, estimated_total, question, answer, at) VALUES (?, ?, ?, ?, ?, ?)
  `).run(ownerId, Number(n), Number(estimated_total) || 0, question, answer, now())
  return db.prepare(`SELECT * FROM round WHERE ${column} = ? AND n = ?`).get(ownerId, Number(n))
}

export function addRound(storyId, round) {
  return putRound('story_id', storyId, round)
}

export function addEpicRound(epicId, round) {
  return putRound('epic_id', epicId, round)
}

// ── The plan and the log ─────────────────────────────────────────────────────

export function setPlan(storyId, text) {
  db.prepare('UPDATE story SET plan = ?, updated_at = ? WHERE id = ?').run(String(text ?? ''), now(), storyId)
  return getStory(storyId)
}

export function listLog(storyId) {
  return db.prepare('SELECT * FROM story_log WHERE story_id = ? ORDER BY at, id').all(storyId)
}

/** `at` is only passed when reading `.k0/` back: a log entry belongs to the day it was written. */
export function addLogEntry(storyId, { text, session_id = null, at = null }) {
  db.prepare('INSERT INTO story_log (story_id, session_id, text, at) VALUES (?, ?, ?, ?)')
    .run(storyId, session_id, String(text ?? ''), Number(at) || now())
  return listLog(storyId)
}

// ── The switches that remember ───────────────────────────────────────────────
/** The caller decides what a missing row means: this returns `fallback`. */
export function getPref(key, fallback = null) {
  const r = db.prepare('SELECT "value" FROM pref WHERE "key" = ?').get(key)
  return r ? r.value : fallback
}

export function setPref(key, value) {
  db.prepare(`
    INSERT INTO pref ("key", "value") VALUES (?, ?)
    ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"
  `).run(key, String(value))
}

/** For migrations: a key that no longer means anything gets retired. */
export function dropPref(key) {
  db.prepare('DELETE FROM pref WHERE "key" = ?').run(key)
}

// ── The dev servers k0 started ───────────────────────────────────────────────
// See the comment on the table: a row is intent, not observation.

export function listDevServers() {
  return db.prepare('SELECT project_path, pid, command, started_at FROM dev_server').all()
}

export function getDevServer(projectPath) {
  return db.prepare('SELECT project_path, pid, command, started_at FROM dev_server WHERE project_path = ?')
    .get(projectPath) ?? null
}

export function setDevServer(projectPath, { pid, command, startedAt }) {
  db.prepare(`
    INSERT INTO dev_server (project_path, pid, command, started_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(project_path) DO UPDATE SET
      pid = excluded.pid, command = excluded.command, started_at = excluded.started_at
  `).run(projectPath, pid, command, startedAt)
}

export function clearDevServer(projectPath) {
  db.prepare('DELETE FROM dev_server WHERE project_path = ?').run(projectPath)
}

/**
 * Letting go of the file. It matters in exactly one place — a test that wants to delete the
 * database it was pointed at — and it matters on exactly one platform: POSIX lets a file be
 * unlinked while it is still open, Windows refuses. Closing also takes the `-wal` and `-shm`
 * away with it.
 */
export function close() {
  db.close()
}

export default db
