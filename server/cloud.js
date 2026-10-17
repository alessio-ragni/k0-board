import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { HOME } from './paths.js'

// ── k0 Cloud ─────────────────────────────────────────────────────────────────
// The only file in k0 that talks to the cloud. Everything that leaves this machine for it —
// signing in, the next K number, the rows of the board — goes through the few functions below,
// so what k0 sends and where can be read in one place. The other door out is `update.js`, which
// asks npm once a day what the newest version is. There is no third.
//
// The cloud is Supabase: its own sign-in (GitHub or Google, nothing else) and its own database,
// reached over plain HTTPS with Node's `fetch`. No client library: k0 has no dependencies, and
// the handful of calls it needs are each a few lines.
//
// The address and the key below are public on purpose. The key is Supabase's "publishable" one:
// it identifies the project and grants nothing by itself; what a signed-in person may read or
// write is decided by the database's own row-level rules, and an account that has not been let in
// may read and write nothing at all. The secret keys never appear in this repository.

const DEFAULT_URL = 'https://pegjzrbsogextluajmjm.supabase.co'
const DEFAULT_KEY = 'sb_publishable_Q-kGvSLvbsxiFikQxO1UEA_QiDsCamH'

/** `K0_CLOUD=off` is for working on k0 itself, and for the tests: no cloud, no sign-in, no socket. */
export const enabled = () => process.env.K0_CLOUD !== 'off'
const base = () => (process.env.K0_CLOUD_URL || DEFAULT_URL).replace(/\/+$/, '')
const apiKey = () => process.env.K0_CLOUD_KEY || DEFAULT_KEY

/** Where the sign-in is kept: beside the database, readable by you and nobody else. */
export const FILE = process.env.K0_CLOUD_FILE || path.join(HOME, 'cloud.json')

/** The two ways in. A third is a decision, not a line of code. */
export const PROVIDERS = ['github', 'google']

const TIMEOUT = 8000
const KEY_TIMEOUT = 2500

// `fetch` is replaceable so a test can play the cloud without a socket — the same seam `update.js`
// has, for the same reason.
let fetcher = (...args) => globalThis.fetch(...args)
export function useFetch(f) {
  fetcher = f || ((...args) => globalThis.fetch(...args))
}

// ── What is kept on disk ─────────────────────────────────────────────────────

let saved = null

function load() {
  if (saved) return saved
  try {
    saved = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  } catch {
    saved = {}
  }
  if (!saved.machine) {
    saved.machine = crypto.randomUUID()
    store()
  }
  return saved
}

function store() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(saved, null, 2), { mode: 0o600 })
    // `mode` only applies when the file is created; one written before this line existed keeps
    // whatever it had, so it is said again.
    fs.chmodSync(FILE, 0o600)
  } catch {
    // A sign-in that cannot be written down is one that has to be done again next start. That is
    // an annoyance, not a reason for the board to stop.
  }
}

/** For the tests: forget what was read, so the next call reads the file again. */
export function reset() {
  saved = null
  online = null
  lastError = null
  pending = null
}

export const machine = () => load().machine

// ── Being online ─────────────────────────────────────────────────────────────

let online = null
let lastError = null

function heard(ok, error = null) {
  online = ok
  lastError = ok ? null : error
}

async function request(method, url, { body = null, token = null, timeout = TIMEOUT, prefer = null } = {}) {
  const headers = { apikey: apiKey(), accept: 'application/json' }
  if (body != null) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  if (prefer) headers.prefer = prefer
  let res
  try {
    res = await fetcher(url, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
    })
  } catch (err) {
    heard(false, 'k0 Cloud cannot be reached.')
    const e = new Error('offline')
    e.offline = true
    e.cause = err
    throw e
  }
  heard(true)
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const e = new Error((data && (data.message || data.msg || data.error_description || data.error)) || `HTTP ${res.status}`)
    e.status = res.status
    e.data = data
    throw e
  }
  return data
}

// ── Signing in ───────────────────────────────────────────────────────────────
// The browser does the signing in, on Supabase's page and then GitHub's or Google's; k0 never sees
// a password. What comes back to k0 is a one-time code on its own address, and k0 trades it for
// a session using the secret half of a pair it made before sending the browser off (PKCE): a code
// that leaked on the way back is worth nothing to anybody who does not also hold that half.

/** The sign-in started last, waiting for its code. One at a time; an older one is forgotten. */
let pending = null

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** The address to send the browser to. `redirect` is k0's own callback page on this machine. */
export function loginUrl(provider, redirect) {
  if (!PROVIDERS.includes(provider)) throw new Error(`Sign in with ${PROVIDERS.join(' or ')}.`)
  const verifier = b64url(crypto.randomBytes(48))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  pending = { verifier, at: Date.now() }
  const q = new URLSearchParams({
    provider,
    redirect_to: redirect,
    code_challenge: challenge,
    code_challenge_method: 's256',
  })
  return `${base()}/auth/v1/authorize?${q}`
}

/** The code came back. Trade it for a session, and find out who this is and whether they are in. */
export async function finishLogin(code) {
  if (!pending || Date.now() - pending.at > 15 * 60_000) throw new Error('This sign-in has expired. Start it again from the board.')
  const verifier = pending.verifier
  pending = null
  const data = await request('POST', `${base()}/auth/v1/token?grant_type=pkce`, {
    body: { auth_code: String(code), code_verifier: verifier },
  })
  keep(data)
  await refreshMe()
  return status()
}

function keep(data) {
  const s = load()
  s.session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Number(data.expires_at) || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
  }
  store()
}

/** A token good for at least another minute, refreshed first when it is about to run out. */
async function token() {
  const s = load()
  if (!s.session?.refresh_token) return null
  if (s.session.access_token && s.session.expires_at * 1000 - Date.now() > 60_000) return s.session.access_token
  try {
    const data = await request('POST', `${base()}/auth/v1/token?grant_type=refresh_token`, {
      body: { refresh_token: s.session.refresh_token },
    })
    keep(data)
    return data.access_token
  } catch (err) {
    // Offline is not signed out: the board carries on and asks again later. A refusal is — the
    // session was revoked or has expired for good, and the only way back is to sign in again.
    if (!err.offline && err.status >= 400 && err.status < 500) forget()
    throw err
  }
}

async function authed(method, pathname, opts = {}) {
  const t = await token()
  if (!t) {
    const e = new Error('Not signed in.')
    e.status = 401
    throw e
  }
  return request(method, `${base()}${pathname}`, { ...opts, token: t })
}

function forget() {
  const s = load()
  delete s.session
  delete s.me
  delete s.pulled
  store()
}

/** Who this is, whether they have been let in, and where their rows go. */
export async function refreshMe() {
  const me = await authed('POST', '/rest/v1/rpc/k0_me', { body: {} })
  const s = load()
  s.me = me || null
  store()
  return s.me
}

export async function logout() {
  const s = load()
  const t = s.session?.access_token
  forget()
  if (t) {
    try {
      await request('POST', `${base()}/auth/v1/logout`, { token: t, body: {} })
    } catch {
      // Signed out here is signed out. The cloud lets the token expire on its own.
    }
  }
  return status()
}

// ── What the board shows about it ────────────────────────────────────────────

export const linked = () => enabled() && !!load().session?.refresh_token
export const me = () => (linked() ? load().me || null : null)
export const approved = () => !!me()?.approved
export const workspace = () => me()?.workspace || null

export function status() {
  const m = me()
  return {
    enabled: enabled(),
    linked: linked(),
    email: m?.email ?? null,
    name: m?.name ?? null,
    avatar_url: m?.avatar_url ?? null,
    approved: !!m?.approved,
    is_admin: !!m?.is_admin,
    online,
    error: lastError,
  }
}

/** Which ways in are switched on in the cloud. Asked rarely: it changes when somebody sets one up. */
let providersSeen = null
export async function providers() {
  if (providersSeen && Date.now() - providersSeen.at < 10 * 60_000) return providersSeen.list
  try {
    const data = await request('GET', `${base()}/auth/v1/settings`)
    const list = PROVIDERS.filter((p) => data?.external?.[p])
    providersSeen = { list, at: Date.now() }
    return list
  } catch {
    return providersSeen?.list ?? null
  }
}

// ── The next number ──────────────────────────────────────────────────────────

/**
 * The next K number for this account, or null when it cannot be had right now — not signed in,
 * not let in, or no answer within a couple of seconds. Null is not an error: the story is made
 * with a provisional key and the sync gives it its real one later.
 */
export async function nextKey() {
  if (!linked() || !approved() || !workspace()) return null
  try {
    const n = await authed('POST', '/rest/v1/rpc/k0_next_key', { body: { ws: workspace() }, timeout: KEY_TIMEOUT })
    return Number.isInteger(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

/** Moves the cloud's counter past numbers this machine already holds. */
export async function reserveKeys(upto) {
  return authed('POST', '/rest/v1/rpc/k0_reserve_keys', { body: { ws: workspace(), upto } })
}

// ── Rows ─────────────────────────────────────────────────────────────────────

/** Sends rows. Each is `{ kind, uid, data, deleted, changed_at }`. */
export async function push(rows) {
  if (!rows.length) return 0
  const ws = workspace()
  const body = rows.map((r) => ({
    workspace_id: ws,
    kind: r.kind,
    uid: r.uid,
    data: r.data ?? {},
    deleted: !!r.deleted,
    changed_at: r.changed_at ?? Date.now(),
    machine: machine(),
  }))
  await authed('POST', '/rest/v1/records?on_conflict=workspace_id,kind,uid', {
    body,
    prefer: 'resolution=merge-duplicates,return=minimal',
  })
  return body.length
}

/** What other machines wrote since `since`, oldest first. */
export async function pull(since = 0, limit = 500) {
  const q = new URLSearchParams({
    select: 'kind,uid,data,deleted,changed_at,seq',
    workspace_id: `eq.${workspace()}`,
    seq: `gt.${Number(since) || 0}`,
    machine: `neq.${machine()}`,
    order: 'seq.asc',
    limit: String(limit),
  })
  return (await authed('GET', `/rest/v1/records?${q}`)) || []
}

/** How far this machine has read. Kept with the sign-in, because it means nothing without it. */
export const pulledTo = () => Number(load().pulled) || 0
export function setPulledTo(seq) {
  const s = load()
  s.pulled = Number(seq) || 0
  store()
}
