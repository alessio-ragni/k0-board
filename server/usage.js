import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as db from './db.js'
import { PROJECTS_DIR } from './watcher.js'
import { repoOf } from './sessions.js'
import { HOME } from './paths.js'
import { cost as priceOf, modelId } from './prices.js'

/**
 * What the sessions consumed: tokens, the model and effort they ran on, the time Claude spent
 * working, the moments a usage limit stopped them, and — where the statusline has been writing
 * it down — how much of each account's limits went.
 *
 * Nothing here asks anybody anything. Claude Code already writes all of it into the transcripts
 * under ~/.claude/projects, one line per reply with its `usage`; this reads those files as they
 * grow, the way `watcher.js` does for the statuses, and adds it up. No model is called and no
 * socket is opened: it costs no tokens to know what the tokens cost.
 *
 * Two things the transcripts do not say, and where they come from instead:
 *
 *   - which account was signed in. Only ~/.claude.json knows, and only for now; so k0 writes down
 *     every change it sees, and the statusline writes down the account of the session it is
 *     drawing. Anything that happened before either was watching stays "unknown", on purpose.
 *   - how much of the five-hour and weekly limits is used. Claude Code hands that to the
 *     statusline and keeps it nowhere; the statusline appends it to LIMITS_FILE. See README.
 */

export const LIMITS_FILE = path.join(HOME, 'usage', 'limits.jsonl')
const CLAUDE_JSON = () => path.join(os.homedir(), '.claude.json')

const HOUR = 3_600_000
const DAY = 86_400_000

/** How much is read per step. A step blocks the server while it parses, so it stays small. */
const STEP = 8 << 20
/** A line bigger than a step is still a line: the read grows until it has one whole. */
const MAX_LINE = 256 << 20
/** How many request ids a file remembers, to count each reply once. */
const RECENT = 64
/** A statusline sample this close to a request says whose request it was. */
const NEAR = 30 * 60_000

// ── Whose account ────────────────────────────────────────────────────────────
let sightings = null
let bySession = null

function loadSightings() {
  sightings = db.accountSightings()
  bySession = new Map()
  for (const s of sightings) {
    if (!s.session_id) continue
    if (!bySession.has(s.session_id)) bySession.set(s.session_id, [])
    bySession.get(s.session_id).push(s)
  }
}

/** Kept in time order: the statusline's file can hand over samples older than the last sighting. */
function sighted(s) {
  let i = sightings.length
  while (i > 0 && sightings[i - 1].at > s.at) i--
  sightings.splice(i, 0, s)
  if (!s.session_id) return
  if (!bySession.has(s.session_id)) bySession.set(s.session_id, [])
  bySession.get(s.session_id).push(s)
}

/**
 * The account a request at `at` in `sessionId` was made from, or '' when nobody was watching.
 *
 * The session's own statusline samples come first: they were written by that session, so they
 * cannot be somebody else's. Otherwise, the last account seen signed in before the request. There
 * is deliberately no guess backwards: a request older than the first sighting is unknown.
 */
export function accountAt(sessionId, at) {
  if (!sightings) loadSightings()
  let best = null
  for (const s of bySession.get(sessionId) ?? []) {
    const d = Math.abs(s.at - at)
    if (d <= NEAR && (!best || d < Math.abs(best.at - at))) best = s
  }
  if (best) return best.account_uuid
  let last = ''
  for (const s of sightings) {
    if (s.at > at) break
    last = s.account_uuid
  }
  return last
}

function accountOf(raw) {
  const a = raw?.oauthAccount ?? raw
  if (!a?.accountUuid && !a?.uuid) return null
  return {
    uuid: a.accountUuid ?? a.uuid,
    email: a.emailAddress ?? a.email ?? null,
    org_type: a.organizationType ?? a.org_type ?? null,
    tier: a.organizationRateLimitTier ?? a.tier ?? null,
  }
}

let claudeJsonMtime = 0
let signedIn = null

/** Writes down the account ~/.claude.json says is signed in, when it is not the last one written. */
export function observeAccount(file = CLAUDE_JSON(), at = Date.now()) {
  let st
  try {
    st = fs.statSync(file)
  } catch {
    return null
  }
  if (st.mtimeMs === claudeJsonMtime) return signedIn
  claudeJsonMtime = st.mtimeMs
  let account = null
  try {
    account = accountOf(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return signedIn // half-written by Claude Code: the next look will have it whole
  }
  if (!account) return signedIn
  if (!sightings) loadSightings()
  db.seeAccount(account, at)
  const last = sightings.filter((s) => !s.session_id).at(-1)
  if (last?.account_uuid !== account.uuid) {
    const row = { at, account_uuid: account.uuid, session_id: '' }
    db.addLimit(row)
    sighted(row)
  }
  signedIn = account.uuid
  return signedIn
}

// ── Reading files as they grow ───────────────────────────────────────────────
/**
 * The bytes from `from` up to the last whole line, reading no more than `want` unless one line
 * alone is longer than that. Returns the text and where the next read starts.
 */
function readWhole(file, from, size, want) {
  let len = Math.min(size - from, want)
  let fd
  try {
    fd = fs.openSync(file, 'r')
  } catch {
    return null
  }
  try {
    for (;;) {
      const buf = Buffer.alloc(len)
      const n = fs.readSync(fd, buf, 0, len, from)
      const cut = buf.subarray(0, n).lastIndexOf(0x0a)
      if (cut >= 0) return { text: buf.subarray(0, cut).toString('utf8'), next: from + cut + 1 }
      // No newline yet: either Claude Code is still writing this line, or it is a long one.
      if (from + n >= size || len >= MAX_LINE) return { text: '', next: from }
      len = Math.min(size - from, len * 4)
    }
  } finally {
    fs.closeSync(fd)
  }
}

/** Every transcript, the subagents' and the workflows' included, with who wrote it. */
function transcripts(root) {
  const out = []
  let projects = []
  try {
    projects = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const p of projects) {
    if (!p.isDirectory()) continue
    const dir = path.join(root, p.name)
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) out.push({ file: path.join(dir, e.name), agent: 'main' })
      if (!e.isDirectory()) continue
      const sub = path.join(dir, e.name, 'subagents')
      let agents = []
      try {
        agents = fs.readdirSync(sub)
      } catch {
        continue
      }
      for (const name of agents) if (name.endsWith('.jsonl')) out.push({ file: path.join(sub, name), agent: null })
    }
  }
  return out
}

/** A subagent file is a workflow's when its `.meta.json` says so; any other is a plain subagent. */
function agentKind(file) {
  try {
    const meta = JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8'))
    return meta.agentType === 'workflow-subagent' ? 'workflow' : 'sub'
  } catch {
    return 'sub'
  }
}

/** Adds one parsed transcript line to what this scan has gathered. */
function take(o, ctx, acc) {
  const sid = o.sessionId || o.session_id || ctx.session_id
  if (!sid) return
  ctx.session_id ??= sid
  const at = Date.parse(o.timestamp)
  const session = acc.session(sid)
  if (!session.cwd && o.cwd) session.cwd = o.cwd
  if (o.type === 'custom-title' && o.customTitle) session.custom = o.customTitle
  if (o.type === 'ai-title' && o.aiTitle) session.ai = o.aiTitle
  if (!Number.isFinite(at)) return

  if (o.isApiErrorMessage && o.error === 'rate_limit') {
    acc.events.push({ session_id: sid, at, kind: 'limit' })
    return
  }
  if (o.type === 'system' && o.subtype === 'turn_duration' && ctx.agent === 'main') {
    acc.events.push({ session_id: sid, at, kind: 'work', ms: Math.max(0, Math.round(o.durationMs || 0)) })
    session.first = Math.min(session.first ?? at, at)
    session.last = Math.max(session.last ?? at, at)
    return
  }
  const u = o.message?.usage
  if (o.type !== 'assistant' || !o.requestId || !u) return
  const model = modelId(o.message.model)
  if (!model || model === '<synthetic>') return
  if (ctx.recent.includes(o.requestId)) return
  ctx.recent.push(o.requestId)
  if (ctx.recent.length > RECENT) ctx.recent.shift()

  const cc = u.cache_creation
  const tokens = {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    write5m: cc ? cc.ephemeral_5m_input_tokens || 0 : u.cache_creation_input_tokens || 0,
    write1h: cc ? cc.ephemeral_1h_input_tokens || 0 : 0,
  }
  const speed = u.speed || 'standard'
  const row = acc.hour({
    session_id: sid,
    hour: Math.floor(at / HOUR) * HOUR,
    model,
    effort: o.effort || '',
    speed,
    agent: ctx.agent,
    account_uuid: accountAt(sid, at),
  })
  const dollars = priceOf(model, tokens, speed)
  row.requests++
  row.input += tokens.input
  row.output += tokens.output
  row.thinking += u.output_tokens_details?.thinking_tokens || 0
  row.cache_read += tokens.cacheRead
  row.write_5m += tokens.write5m
  row.write_1h += tokens.write1h
  row.web_search += u.server_tool_use?.web_search_requests || 0
  row.cost = dollars == null ? null : (row.cost ?? 0) + dollars
  session.first = Math.min(session.first ?? at, at)
  session.last = Math.max(session.last ?? at, at)
}

function gathering() {
  const hours = new Map()
  const sessions = new Map()
  return {
    events: [],
    hours,
    sessions,
    hour(key) {
      const k = [key.session_id, key.hour, key.model, key.effort, key.speed, key.agent, key.account_uuid].join('\u0000')
      let row = hours.get(k)
      if (!row) {
        row = { ...key, requests: 0, input: 0, output: 0, thinking: 0, cache_read: 0, write_5m: 0, write_1h: 0, web_search: 0, cost: 0 }
        hours.set(k, row)
      }
      return row
    },
    session(id) {
      let s = sessions.get(id)
      if (!s) sessions.set(id, (s = { session_id: id }))
      return s
    },
  }
}

/** The statusline's samples, read the same way the transcripts are: only what is new. */
function readLimits(file, known) {
  let size
  try {
    size = fs.statSync(file).size
  } catch {
    return 0
  }
  const state = known.get(file) ?? { offset: 0 }
  if (size < state.offset) state.offset = 0 // rotated by hand: a sample is only ever added once anyway
  if (size === state.offset) return 0
  const got = readWhole(file, state.offset, size, size - state.offset)
  if (!got) return 0
  if (!sightings) loadSightings()
  for (const line of got.text.split('\n')) {
    let o
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    const account = accountOf(o.account)
    const at = Number(o.at)
    if (!account || !Number.isFinite(at)) continue
    db.seeAccount(account, at)
    const row = {
      at,
      account_uuid: account.uuid,
      session_id: o.session_id || '',
      five_pct: o.five_hour?.pct ?? null,
      five_resets: o.five_hour?.resets_at ?? null,
      week_pct: o.seven_day?.pct ?? null,
      week_resets: o.seven_day?.resets_at ?? null,
    }
    db.addLimit(row)
    sighted(row)
  }
  db.saveUsageFile({ path: file, offset: got.next, size, agent: 'limits' })
  return got.next - state.offset
}

let backlog = { files: 0, bytes: 0 }

/**
 * One step: whatever has been added to the transcripts since the last one, up to `budget` bytes.
 * Returns how much it read and how much is still waiting, so the caller can come back sooner
 * while there is history to catch up on.
 *
 * A transcript that got shorter is not read again from the start: every reply in it has already
 * been counted, and reading it twice would count it twice. It is taken as it is now.
 */
export function scan({ root = PROJECTS_DIR, limits = LIMITS_FILE, claudeJson = CLAUDE_JSON(), budget = STEP } = {}) {
  observeAccount(claudeJson)
  const known = db.usageFiles()
  let read = readLimits(limits, known)
  const acc = gathering()
  const touched = []
  let waiting = 0
  let waitingFiles = 0

  // The least recently read first would be fairer, but the newest first is what matters: a live
  // session should show up on the page within the minute even while last year is being caught up.
  const files = transcripts(root)
    .map((t) => {
      try {
        const st = fs.statSync(t.file)
        return { ...t, size: st.size, mtime: st.mtimeMs }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)

  for (const t of files) {
    const state = known.get(t.file)
    const offset = state?.offset ?? 0
    if (t.size === offset) continue
    if (t.size < offset) {
      db.saveUsageFile({ ...state, path: t.file, offset: t.size, size: t.size })
      continue
    }
    if (read >= budget) {
      waiting += t.size - offset
      waitingFiles++
      continue
    }
    const got = readWhole(t.file, offset, t.size, budget - read)
    if (!got || got.next === offset) continue
    const ctx = {
      session_id: state?.session_id ?? null,
      agent: state?.agent ?? t.agent ?? agentKind(t.file),
      recent: state?.recent ?? [],
    }
    for (const line of got.text.split('\n')) {
      // Most lines are tool output and prompts. Only the ones that can matter are parsed.
      if (!line.includes('"usage"') && !line.includes('turn_duration') && !line.includes('title"') &&
        !line.includes('"rate_limit"')) continue
      let o
      try {
        o = JSON.parse(line)
      } catch {
        continue
      }
      take(o, ctx, acc)
    }
    read += got.next - offset
    touched.push({ path: t.file, offset: got.next, size: t.size, session_id: ctx.session_id, agent: ctx.agent, recent: ctx.recent })
    if (got.next < t.size) {
      waiting += t.size - got.next
      waitingFiles++
    }
  }

  const repos = new Map()
  db.addUsageHours([...acc.hours.values()])
  db.addUsageEvents(acc.events)
  for (const s of acc.sessions.values()) {
    db.touchUsageSession({
      session_id: s.session_id,
      cwd: s.cwd ?? null,
      project_path: s.cwd ? repoOf(s.cwd, repos) : null,
      first_at: s.first ?? null,
      last_at: s.last ?? null,
      custom: s.custom ?? null,
      ai: s.ai ?? null,
    })
  }
  // Last, so a crash in the middle reads the same bytes again rather than skipping them.
  for (const f of touched) db.saveUsageFile(f)

  backlog = { files: waitingFiles, bytes: waiting }
  return { read, waiting, files: files.length }
}

// ── Running by itself ────────────────────────────────────────────────────────
let timer = null

/**
 * A step now, and the next one soon while there is history left to read, once a minute after.
 * `unref` like every other sampler here: this must never be what keeps the server alive.
 */
export function start() {
  if (timer) return
  const step = () => {
    let wait = 60_000
    try {
      if (scan().waiting > 0) wait = 500
    } catch (err) {
      console.error(`k0 — reading what the sessions consumed stumbled: ${String(err?.message || err)}`)
    }
    timer = setTimeout(step, wait)
    timer.unref()
  }
  timer = setTimeout(step, 1000)
  timer.unref()
}

export const catchingUp = () => backlog

// ── The page ─────────────────────────────────────────────────────────────────
const tokensOf = (r) => r.input + r.output + r.cache_read + r.write_5m + r.write_1h

function bucket() {
  return { requests: 0, input: 0, output: 0, thinking: 0, cache_read: 0, write: 0, tokens: 0, cost: 0, unpriced: 0 }
}

function add(b, r) {
  b.requests += r.requests
  b.input += r.input
  b.output += r.output
  b.thinking += r.thinking
  b.cache_read += r.cache_read
  b.write += r.write_5m + r.write_1h
  b.tokens += tokensOf(r)
  if (r.cost == null) b.unpriced += tokensOf(r)
  else b.cost += r.cost
  return b
}

function grouped(rows, keyOf, extra = () => ({})) {
  const out = new Map()
  for (const r of rows) {
    const k = keyOf(r)
    if (!out.has(k)) out.set(k, { ...extra(r), ...bucket() })
    add(out.get(k), r)
  }
  return [...out.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
}

/**
 * How much of the weekly limit each session is likely to have used.
 *
 * The statusline says how full the week is, not who filled it. So every rise in an account's
 * weekly percentage is shared among the sessions that account ran in the same hour, in proportion
 * to what each would have cost at the API price. It is an estimate and the page calls it one: two
 * sessions running side by side in the same hour cannot be told apart any better than that.
 */
function weekShares(samples, hours) {
  const rises = new Map() // account + hour → percentage points
  const byAccount = new Map()
  for (const s of samples) {
    if (!byAccount.has(s.account_uuid)) byAccount.set(s.account_uuid, [])
    byAccount.get(s.account_uuid).push(s)
  }
  for (const [account, list] of byAccount) {
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1]
      const b = list[i]
      // A new window starts from nothing, so all of its percentage is new.
      const rise = b.week_resets !== a.week_resets ? b.week_pct : b.week_pct - a.week_pct
      if (!(rise > 0)) continue
      const k = `${account}\u0000${Math.floor(b.at / HOUR) * HOUR}`
      rises.set(k, (rises.get(k) ?? 0) + rise)
    }
  }
  const weights = new Map()
  for (const h of hours) {
    const k = `${h.account_uuid}\u0000${h.hour}`
    if (!rises.has(k)) continue
    if (!weights.has(k)) weights.set(k, new Map())
    const w = weights.get(k)
    w.set(h.session_id, (w.get(h.session_id) ?? 0) + (h.cost ?? 0))
  }
  const share = new Map()
  for (const [k, rise] of rises) {
    const w = weights.get(k)
    const total = w ? [...w.values()].reduce((x, y) => x + y, 0) : 0
    if (!total) continue
    for (const [sid, v] of w) share.set(sid, (share.get(sid) ?? 0) + (rise * v) / total)
  }
  return share
}

const nameOf = (p) => (p ? path.basename(p) : null)

/**
 * Everything the Usage page shows for one span of time. `account` narrows it to one account;
 * '' is the requests nobody could put a name to.
 */
export function report({ from, to, account = null }) {
  const accounts = db.usageAccounts()
  const emailOf = new Map(accounts.map((a) => [a.uuid, a.email]))
  const all = db.usageHours(from, to)
  const hours = account == null ? all : all.filter((h) => h.account_uuid === account)
  const sessionsById = new Map(db.usageSessions(from, to).map((s) => [s.session_id, s]))
  const ids = new Set(hours.map((h) => h.session_id))
  const events = db.usageEvents(from, to).filter((e) => ids.has(e.session_id))
  const samples = db.usageLimits(from, to)
  const shares = weekShares(samples.filter((s) => s.at >= from - DAY), all)

  const totals = hours.reduce(add, bucket())
  totals.sessions = ids.size
  totals.work_ms = events.filter((e) => e.kind === 'work').reduce((x, e) => x + e.ms, 0)
  totals.limits = events.filter((e) => e.kind === 'limit').length

  const days = []
  for (let at = from; at < to; at += DAY) days.push({ at, ...bucket(), models: {} })
  for (const h of hours) {
    const d = days[Math.floor((h.hour - from) / DAY)]
    if (!d) continue
    add(d, h)
    d.models[h.model] = (d.models[h.model] ?? 0) + (h.cost ?? 0)
  }

  const perSession = new Map()
  for (const h of hours) {
    let s = perSession.get(h.session_id)
    if (!s) {
      const meta = sessionsById.get(h.session_id) ?? {}
      s = {
        session_id: h.session_id,
        title: meta.story_title || meta.title || null,
        project: nameOf(meta.project_path),
        story: meta.story_id ? { id: meta.story_id, key: meta.story_key, title: meta.story_title } : null,
        first_at: meta.first_at ?? h.hour,
        last_at: meta.last_at ?? h.hour,
        models: {},
        agents: {},
        accounts: new Set(),
        work_ms: 0,
        limits: 0,
        week_pct: shares.get(h.session_id) ?? null,
        ...bucket(),
      }
      perSession.set(h.session_id, s)
    }
    add(s, h)
    const m = h.effort ? `${h.model} · ${h.effort}${h.speed === 'fast' ? ' · fast' : ''}` : h.model
    s.models[m] = (s.models[m] ?? 0) + tokensOf(h)
    s.agents[h.agent] = (s.agents[h.agent] ?? 0) + (h.cost ?? 0)
    s.accounts.add(emailOf.get(h.account_uuid) ?? (h.account_uuid ? h.account_uuid.slice(0, 8) : 'unknown'))
  }
  for (const e of events) {
    const s = perSession.get(e.session_id)
    if (!s) continue
    if (e.kind === 'work') s.work_ms += e.ms
    if (e.kind === 'limit') s.limits++
  }
  const sessions = [...perSession.values()]
    .map((s) => ({ ...s, accounts: [...s.accounts] }))
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)

  const limitSeries = new Map()
  for (const s of samples) {
    if (account != null && s.account_uuid !== account) continue
    if (!limitSeries.has(s.account_uuid)) {
      limitSeries.set(s.account_uuid, { account: s.account_uuid, email: emailOf.get(s.account_uuid) ?? null, samples: [] })
    }
    limitSeries.get(s.account_uuid).samples.push({ at: s.at, five: s.five_pct, week: s.week_pct, week_resets: s.week_resets })
  }

  let lastSample = null
  try {
    lastSample = fs.statSync(LIMITS_FILE).mtimeMs
  } catch {
    /* the statusline is not writing: the page says how to make it */
  }

  return {
    from,
    to,
    account,
    totals,
    days,
    models: grouped(hours, (h) => `${h.model}|${h.effort}|${h.speed}`, (h) => ({ model: h.model, effort: h.effort, speed: h.speed })),
    agents: grouped(hours, (h) => h.agent, (h) => ({ agent: h.agent })),
    repos: grouped(
      hours,
      (h) => sessionsById.get(h.session_id)?.project_path ?? '',
      (h) => ({ project: nameOf(sessionsById.get(h.session_id)?.project_path) })
    ),
    accounts: grouped(all, (h) => h.account_uuid, (h) => ({ uuid: h.account_uuid, email: emailOf.get(h.account_uuid) ?? null })),
    known: accounts,
    limits: [...limitSeries.values()],
    sessions,
    tracking: { statusline: lastSample, reading: backlog },
  }
}
