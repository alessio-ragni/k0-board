import { DatabaseSync } from 'node:sqlite'
import { DB_PATH, ensureDirs, migrateLegacyDatabase } from './paths.js'

export { DB_PATH }

// A test that forgets to point `K0_DB` somewhere harmless opens the real board and seeds it
// with fake cards that nobody notices. The trap is import order: every import resolves before
// the first line of test code runs, so `K0_DB` has to be set BEFORE anything that pulls this
// file in, however indirectly (see test/mode.test.mjs). Better a loud error right here.
if (!process.env.K0_DB && /\.test\.mjs$/.test(process.argv[1] || '')) {
  throw new Error('K0_DB is not set: a test must not open the real database. Set it before importing db.js.')
}

if (!process.env.K0_DB) {
  ensureDirs()
  migrateLegacyDatabase()
}

const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS card (
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
    updated_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session_event (
    id      INTEGER PRIMARY KEY,
    card_id INTEGER NOT NULL REFERENCES card(id) ON DELETE CASCADE,
    status  TEXT NOT NULL,
    at      INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_event_card ON session_event(card_id, at DESC);

  -- The switches that have to survive a server restart. Board preferences live in the
  -- browser's localStorage, where only the board can see them; what goes here is the
  -- little the server shares with the menu bar icon — today, the mode.
  CREATE TABLE IF NOT EXISTS pref (
    "key"   TEXT PRIMARY KEY,
    "value" TEXT NOT NULL
  );
`)

// Additive migrations: the column may be missing from a database created before it existed.
for (const [col, decl] of [
  ['terminal_window_id', 'TEXT'],
  ['description', 'TEXT'],
  ['imported_at', 'INTEGER'],
  ['work_path', 'TEXT'],
  ['head_at_start', 'TEXT'],
]) {
  const has = db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get('card', col)
  if (!has) db.exec(`ALTER TABLE card ADD COLUMN ${col} ${decl}`)
}

// Renaming migrations. The loop above only ever adds columns, so anything renamed when k0
// went from Italian to English needs its own step. These run once and then find nothing to
// do; skipping them would quietly reset a board that already exists.
renameLegacyPrefColumns()
db.exec(`UPDATE card SET color = 'yellow' WHERE color = 'giallo'`)

/**
 * `pref` used to be `(chiave, valore)`. SQLite can rename a column in place since 3.25, but
 * only if it is there to rename — hence the probe first. Card colours are a plain UPDATE
 * because the column name never changed, only one of its values.
 */
function renameLegacyPrefColumns() {
  const columns = db.prepare('SELECT name FROM pragma_table_info(?)').all('pref').map((r) => r.name)
  if (columns.includes('chiave')) db.exec('ALTER TABLE pref RENAME COLUMN chiave TO "key"')
  if (columns.includes('valore')) db.exec('ALTER TABLE pref RENAME COLUMN valore TO "value"')
}

const now = () => Date.now()

/** Columns the user can change through PATCH. */
const PATCHABLE = ['title', 'description', 'project_path', 'prompt', 'color', 'sort_hint', 'auto_send']

export function listCards() {
  return db.prepare(`
    SELECT c.*, (
      SELECT e.at FROM session_event e
      WHERE e.card_id = c.id AND e.status = c.status
      ORDER BY e.at DESC LIMIT 1
    ) AS status_since
    FROM card c ORDER BY c.sort_hint, c.id
  `).all()
}

export function getCard(id) {
  return db.prepare('SELECT * FROM card WHERE id = ?').get(id)
}

/**
 * The last time you touched each repository from inside k0. `updated_at` moves when you
 * create or edit a card and on every status change of a live session, which makes it the
 * freshest signal k0 has about where you are actually working.
 */
export function projectRecency() {
  return db.prepare('SELECT project_path, MAX(updated_at) AS at FROM card GROUP BY project_path').all()
}

export function createCard({ title, description = '', project_path, prompt = '', color = 'yellow', auto_send = false }) {
  const t = now()
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO card (title, description, project_path, prompt, color, auto_send, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'BACKLOG', ?, ?)
  `).run(title, description || '', project_path, prompt, color, Number(!!auto_send), t, t)
  recordEvent(Number(lastInsertRowid), 'BACKLOG')
  return getCard(Number(lastInsertRowid))
}

/** Session ids a card already claims: they keep the same session from being imported twice. */
export function sessionIds() {
  return db
    .prepare(`SELECT session_id FROM card WHERE session_id IS NOT NULL AND session_id <> ''`)
    .all()
    .map((r) => r.session_id)
}

/**
 * A session that already happened — outside k0, most likely — becomes a card.
 *
 * Unlike `createCard`, here the session exists already: the card is born IDLE, which means
 * "your move", with the session marked dead (`tick` revives it by itself if it turns out to
 * still be running) and dated to when it actually happened. That date is where the age shown
 * at the bottom of the card comes from: importing must not make everything look like today.
 */
export function importCard({ title, description = '', project_path, session_id, started_at, ended_at }) {
  const t = now()
  const born = Number(started_at) || t
  const last = Number(ended_at) || born
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO card (title, description, project_path, prompt, session_id, status, session_alive,
                      imported_at, created_at, updated_at)
    VALUES (?, ?, ?, '', ?, 'IDLE', 0, ?, ?, ?)
  `).run(title, description || '', project_path, session_id, t, born, last)
  const id = Number(lastInsertRowid)
  recordEvent(id, 'IDLE', last)
  return getCard(id)
}

export function patchCard(id, fields) {
  const entries = Object.entries(fields).filter(([k]) => PATCHABLE.includes(k))
  if (entries.length) {
    const set = entries.map(([k]) => `${k} = ?`).join(', ')
    db.prepare(`UPDATE card SET ${set}, updated_at = ? WHERE id = ?`)
      .run(...entries.map(([, v]) => (typeof v === 'boolean' ? Number(v) : v)), now(), id)
  }
  return getCard(id)
}

/** COMPLETED is the user's status: it overrides whatever the session says. */
export function setCompleted(id, completed) {
  db.prepare('UPDATE card SET completed_at = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(completed ? now() : null, completed ? 'COMPLETED' : 'BACKLOG', now(), id)
  const card = getCard(id)
  if (!completed) applyDerivedStatus(id, card.session_id ? 'IDLE' : 'BACKLOG', card.session_alive)
  else recordEvent(id, 'COMPLETED')
  return getCard(id)
}

/** Back out of a failed start: the previous session can be put back. */
export function detachSession(id, previousSessionId = null) {
  db.prepare('UPDATE card SET session_id = ?, session_alive = 0, status = ?, updated_at = ? WHERE id = ?')
    .run(previousSessionId, previousSessionId ? 'IDLE' : 'BACKLOG', now(), id)
  return getCard(id)
}

export function attachSession(id, sessionId) {
  db.prepare('UPDATE card SET session_id = ?, session_alive = 1, updated_at = ? WHERE id = ?')
    .run(sessionId, now(), id)
  return getCard(id)
}

/** The card's terminal window, so a double click can bring it back to the front. */
export function setTerminalWindow(id, windowId) {
  db.prepare('UPDATE card SET terminal_window_id = ? WHERE id = ?').run(windowId || null, id)
  return getCard(id)
}

/**
 * The directory the session actually works in. Usually that is the repository, but with an
 * isolated worktree it is somewhere else — and that worktree has a working tree of its own,
 * so that is where to look for uncommitted work belonging to THIS session.
 * Does not touch `updated_at`: this is not work on the card, only where it happens.
 */
export function setWorkPath(id, workPath) {
  db.prepare('UPDATE card SET work_path = ? WHERE id = ?').run(workPath || null, id)
  return getCard(id)
}

/** Where HEAD was when the session started: everything after it is this session's doing. */
export function setHeadAtStart(id, sha) {
  db.prepare('UPDATE card SET head_at_start = ? WHERE id = ?').run(sha || null, id)
  return getCard(id)
}

/** Writes the status only when it changed, and records an event when it does. */
export function applyDerivedStatus(id, status, alive) {
  const card = getCard(id)
  if (!card) return
  const aliveInt = alive ? 1 : 0
  if (card.status === status && card.session_alive === aliveInt) return
  db.prepare('UPDATE card SET status = ?, session_alive = ?, updated_at = ? WHERE id = ?')
    .run(status, aliveInt, now(), id)
  if (card.status !== status) recordEvent(id, status)
}

/** `at` is only passed when importing: there the event belongs to when it happened, not now. */
function recordEvent(cardId, status, at = now()) {
  db.prepare('INSERT INTO session_event (card_id, status, at) VALUES (?, ?, ?)')
    .run(cardId, status, at)
}

export function deleteCard(id) {
  db.prepare('DELETE FROM session_event WHERE card_id = ?').run(id)
  db.prepare('DELETE FROM card WHERE id = ?').run(id)
}

/**
 * The cards that moved inside a window, one row each, with where they got to.
 *
 * `session_event` has been keeping this diary since the beginning — a row every time a card
 * really changes status, and none when nothing happens — and until now the only thing anybody
 * ever asked it was how old the current status is. This is the first question that reads it as
 * what it is: a history.
 *
 * `touched` is when the card last moved inside the window, not when it moved last: a card
 * finished on Tuesday belongs to Tuesday even if it was reopened on Friday.
 */
export function eventsBetween(from, to) {
  return db.prepare(`
    SELECT c.id, c.title, c.description, c.project_path, c.status, c.completed_at,
           MAX(e.at) AS touched, COUNT(e.id) AS moves
    FROM session_event e JOIN card c ON c.id = e.card_id
    WHERE e.at >= ? AND e.at < ?
    GROUP BY c.id
    ORDER BY touched DESC
  `).all(from, to)
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
