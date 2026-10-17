import { execFileSync } from 'node:child_process'
import path from 'node:path'
import crypto from 'node:crypto'
import fs from 'node:fs'
import * as db from './db.js'
import { HOME } from './paths.js'
import * as cloud from './cloud.js'
import * as mirror from './mirror.js'
import { listProjects } from './projects.js'

// ── Keeping the cloud's copy of the board ────────────────────────────────────
// The board lives on this machine and keeps working with no network at all; the cloud holds a
// copy of every row so it survives a lost laptop, reaches a second machine and can be read from a
// browser. This file moves rows between the two. It never decides what the board means — that is
// all in `db.js` — it only carries rows across, which is why it can afford to be dull.
//
// Three things happen on every round, in this order:
//
//   1. stories made offline get their real K number, oldest first;
//   2. what changed here goes up (the `outbox` the triggers in `db.js` fill);
//   3. what other machines changed comes down.
//
// A row travels as a document. Its references to other rows go by uid, because an integer id is
// only meaningful in the database that handed it out.

/** Which columns point at another row, and at which table. They travel as `<column>_uid`. */
const REFS = {
  epic: {},
  story: { epic_id: 'epic', parent_story_id: 'story' },
  session: { story_id: 'story' },
  decision: { story_id: 'story', epic_id: 'epic', superseded_by: 'decision' },
  decision_check: { story_id: 'story', decision_id: 'decision' },
  round: { story_id: 'story', epic_id: 'epic' },
  check_item: { story_id: 'story' },
  dependency: { story_id: 'story', depends_on: 'story' },
  story_log: { story_id: 'story' },
}

/** What stays on this machine: which terminal window, which folder, which commit it started at. */
const LOCAL_ONLY = {
  session: ['terminal_window_id', 'work_path', 'head_at_start'],
}

/**
 * The order rows are written in on the way down, so that what a row points at is usually there
 * already. Sessions do not come down at all: a session is a terminal on the machine that opened
 * it, and the other machine has nothing to attach it to. Their status still goes up, for the web.
 */
const APPLY_ORDER = ['epic', 'story', 'decision', 'round', 'check_item', 'dependency', 'story_log', 'decision_check']

// ── Which project a row is in ────────────────────────────────────────────────
// A path means nothing on another machine. A project is named in the cloud by where its code
// lives — the `origin` remote — so the same repository checked out in two places is one project.

const projectIds = new Map()

/** A repository's `origin`, cleaned of credentials and of the difference between ssh and https. */
export function normaliseRemote(url) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  let host = ''
  let repo = ''
  const scp = /^[\w.-]+@([^:/]+):(.+)$/.exec(raw)
  if (scp) {
    host = scp[1]
    repo = scp[2]
  } else {
    try {
      const u = new URL(raw)
      host = u.hostname
      repo = u.pathname
    } catch {
      return raw.replace(/\.git$/, '')
    }
  }
  return `${host.toLowerCase()}/${repo.replace(/^\/+/, '').replace(/\.git$/, '').replace(/\/+$/, '')}`
}

function remoteOf(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

/** A uid that is the same on every machine for the same repository: derived, not stored. */
const derivedUid = (text) => {
  const h = crypto.createHash('sha256').update(text).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${'89ab'[parseInt(h[16], 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

export function projectOf(projectPath) {
  if (projectIds.has(projectPath)) return projectIds.get(projectPath)
  const remote = normaliseRemote(remoteOf(projectPath))
  // A repository with no remote is only ever on this machine, so its path is as good a name as any.
  const uid = derivedUid(remote ? `remote:${remote}` : `path:${cloud.machine()}:${projectPath}`)
  const p = { uid, remote, name: path.basename(projectPath || '') || projectPath }
  projectIds.set(projectPath, p)
  return p
}

// ── Up ───────────────────────────────────────────────────────────────────────

/** One outbox line as the document the cloud keeps. */
export function documentFor(entry) {
  const row = entry.op === 'delete' ? null : db.syncRow(entry.tbl, entry.row_id)
  if (!row) return { kind: entry.tbl, uid: entry.uid, deleted: true, data: {}, changed_at: entry.at }
  const data = {}
  const refs = REFS[entry.tbl] || {}
  const skip = new Set(['_rowid', 'id', 'uid', ...(LOCAL_ONLY[entry.tbl] || [])])
  for (const [k, v] of Object.entries(row)) {
    if (skip.has(k)) continue
    if (k in refs) data[`${k}_uid`] = db.uidOf(refs[k], v)
    else data[k] = v
  }
  if ('project_path' in row) {
    const p = projectOf(row.project_path)
    data.project_uid = p.uid
    data.project_name = p.name
    data.project_remote = p.remote
  }
  return { kind: entry.tbl, uid: row.uid, deleted: false, data, changed_at: entry.at }
}

// ── Down ─────────────────────────────────────────────────────────────────────

/** The local folder a project lives in here, if this machine has it; otherwise the path it came with. */
function localPath(data) {
  if (data.project_uid) {
    for (const [p, info] of projectIds) if (info.uid === data.project_uid) return p
  }
  return data.project_path
}

/** Writes what came down. Returns how many rows were applied and how many were left for later. */
export function apply(records) {
  const waiting = new Set(db.outboxBatch(100000).map((e) => e.uid))
  const order = (r) => {
    const i = APPLY_ORDER.indexOf(r.kind)
    return i < 0 ? APPLY_ORDER.length : i
  }
  const todo = records.filter((r) => r.kind in REFS && r.kind !== 'session').sort((a, b) => order(a) - order(b))
  let applied = 0
  let skipped = 0
  db.applyRemote((put, drop) => {
    for (const r of todo) {
      // A change made here and not delivered yet is newer than anything the cloud can send back
      // about the same row: it is what the person in front of this machine just did.
      if (waiting.has(r.uid)) {
        skipped++
        continue
      }
      if (r.deleted) {
        drop(r.kind, r.uid)
        applied++
        continue
      }
      const row = { uid: r.uid }
      const refs = REFS[r.kind]
      let missing = false
      for (const [k, v] of Object.entries(r.data || {})) {
        if (k.endsWith('_uid') && k.slice(0, -4) in refs) {
          const col = k.slice(0, -4)
          const id = db.idOfUid(refs[col], v)
          if (v && id == null) missing = true
          row[col] = id
        } else if (!k.startsWith('project_') || k === 'project_path') {
          row[k] = v
        }
      }
      if ('project_path' in row) row.project_path = localPath(r.data)
      // A row whose owner has not arrived is left for a later round rather than written pointing at
      // nothing; the ones whose reference may be empty (an epic, a parent) are written without it.
      const required = { session: 'story_id', decision_check: 'story_id', check_item: 'story_id', story_log: 'story_id', dependency: 'story_id' }
      if (missing && required[r.kind] && row[required[r.kind]] == null) {
        skipped++
        continue
      }
      put(r.kind, row)
      applied++
    }
  })
  return { applied, skipped }
}

// ── The round ────────────────────────────────────────────────────────────────

const state = { running: false, last: null, error: null, pushed: 0, pulled: 0 }

export function status() {
  return {
    ...cloud.status(),
    recording: db.syncRecording(),
    pending: db.outboxSize(),
    provisional: db.provisionalKeys().length,
    needs_move: needsMove(),
    last_sync: state.last,
    sync_error: state.error,
  }
}

// ── The first time ───────────────────────────────────────────────────────────
// A board that existed before its owner signed in has numbers counted on this machine — per
// repository, if it is older than k0 Cloud — and the cloud's counter starts somewhere else. Using
// the cloud's numbers straight away would give a new story a K1 that the old board already has.
// So nothing is recorded and no number comes from the cloud until the board has MOVED: renumbered
// once, in the order its stories were made, starting where the cloud says, with a copy of the
// database kept first. The person whose board it is sees every old number beside its new one and
// says yes before any of it happens.

const MOVED = 'cloud.moved'

/** Signed in, let in, and the board on this machine still has to be moved to the account. */
export function needsMove() {
  return cloud.linked() && cloud.approved() && db.getPref(MOVED, '') !== String(cloud.me()?.id || '') && !db.boardIsEmpty()
}

/** What the move would do: every story and epic, its old key and its new one. Writes nothing. */
export async function movePlan() {
  const start = await peekNext()
  return { start, rows: db.renumberAll({ start, apply: false }) }
}

/**
 * The cloud's next number without using it up. There is no such call in the cloud on purpose — a
 * number asked for is a number handed out — so this asks for one and the move then starts from
 * exactly it; the preview is computed from the same number, and the counter is pushed past the
 * whole board at the end.
 */
let peeked = null
async function peekNext() {
  if (peeked && Date.now() - peeked.at < 30 * 60_000 && peeked.who === cloud.me()?.id) return peeked.n
  const n = await cloud.nextKey()
  if (!n) throw new Error('k0 Cloud cannot be reached, so the board cannot be moved yet.')
  peeked = { n, at: Date.now(), who: cloud.me()?.id }
  return n
}

export const BACKUPS = path.join(HOME, 'backups')

/** The move itself. A copy first, then the numbers, then the `.k0/` files, then the first sync. */
export async function move() {
  if (!cloud.linked() || !cloud.approved()) throw new Error('Sign in, and be let in, before moving the board.')
  const start = await peekNext()
  fs.mkdirSync(BACKUPS, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = db.backupTo(path.join(BACKUPS, `k0-before-cloud-${stamp}.db`))
  const rows = db.renumberAll({ start, apply: true })
  const map = path.join(BACKUPS, `k0-before-cloud-${stamp}.keys.json`)
  fs.writeFileSync(map, JSON.stringify(rows.map((r) => ({ kind: r.kind, project: r.project_path, title: r.title, old: r.old, new: r.new })), null, 2))
  for (const r of rows) {
    if (r.old === r.new) continue
    try {
      mirror.renameKey(r.kind, r.id, r.old)
    } catch {
      // `.k0/` reports its own errors where it is written; the numbers are moved regardless.
    }
  }
  if (rows.length) await cloud.reserveKeys(start + rows.length - 1)
  peeked = null
  db.setPref(MOVED, String(cloud.me()?.id || ''))
  attach()
  await round()
  return { moved: rows.length, start, backup, map }
}

/** Links the board to the account that just signed in: keys from the cloud, changes recorded. */
export function attach() {
  if (!cloud.linked() || !cloud.approved()) return false
  if (db.boardIsEmpty() && db.getPref(MOVED, '') !== String(cloud.me()?.id || '')) db.setPref(MOVED, String(cloud.me()?.id || ''))
  if (needsMove()) return false
  db.useCloudKeys(true)
  if (!db.syncRecording()) db.setSyncRecording(true, { snapshot: true })
  return true
}

/** Signed out: keys are counted here again and nothing more is queued. */
export function detach() {
  db.useCloudKeys(false)
  db.setSyncRecording(false)
}

async function giveRealKeys() {
  for (const row of db.provisionalKeys()) {
    const n = await cloud.nextKey()
    if (!n) return
    const was = db.assignKey(row.kind, row.id, n)
    if (was) {
      try {
        mirror.renameKey(row.kind, row.id, was)
      } catch {
        // `.k0/` is a courtesy copy; its own errors are reported where it is written.
      }
    }
  }
}

async function sendUp() {
  for (let i = 0; i < 20; i++) {
    const batch = db.outboxBatch(200)
    if (!batch.length) return
    await cloud.push(batch.map(documentFor))
    db.outboxDone(batch)
    state.pushed += batch.length
  }
}

/** Every repository on this machine, named the way the cloud names it, once per run. */
let known = false
function learnProjects() {
  if (known) return
  known = true
  try {
    for (const p of listProjects()) projectOf(p.path)
  } catch {
    // Without the list a row from another machine keeps the path it came with: still on the
    // board, just not openable here until the repository is.
  }
}

async function bringDown() {
  learnProjects()
  for (let i = 0; i < 20; i++) {
    const rows = await cloud.pull(cloud.pulledTo())
    if (!rows.length) return
    apply(rows)
    cloud.setPulledTo(rows[rows.length - 1].seq)
    state.pulled += rows.length
    if (rows.length < 500) return
  }
}

/** One round. Never throws: a sync that failed says so in `status()` and tries again next time. */
export async function round() {
  if (state.running || !cloud.enabled() || !cloud.linked()) return status()
  state.running = true
  try {
    if (!cloud.me()) await cloud.refreshMe()
    if (!cloud.approved()) {
      // Signed in, waiting to be let in: ask again now and then, and do nothing else.
      await cloud.refreshMe()
      if (!cloud.approved()) return status()
    }
    if (!attach()) return status()
    await giveRealKeys()
    await sendUp()
    await bringDown()
    state.last = Date.now()
    state.error = null
  } catch (err) {
    state.error = err.offline ? 'Offline — the board carries on and catches up when k0 Cloud is back.' : String(err.message || err)
  } finally {
    state.running = false
  }
  return status()
}

let timer = null

/** Every few seconds while the server runs. Unref'd: the sync never keeps k0 alive by itself. */
export function start(every = 5000) {
  if (timer || !cloud.enabled()) return
  if (cloud.linked() && cloud.approved()) attach()
  timer = setInterval(() => round(), every)
  timer.unref()
  round()
}

export function stop() {
  if (timer) clearInterval(timer)
  timer = null
}
