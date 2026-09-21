import { check, section, after } from './harness.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The home and the database move out of the way before anything is imported: `usage.js` reads
// ~/.claude/projects and ~/.claude.json, and `db.js` opens the board the moment it is loaded.
const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-usage-home-'))
process.env.HOME = FAKE_HOME
process.env.USERPROFILE = FAKE_HOME
process.env.K0_DB = path.join(os.tmpdir(), `k0-usage-test-${process.pid}.db`)

const db = await import('../server/db.js')
const usage = await import('../server/usage.js')
const { cost, modelId, known } = await import('../server/prices.js')

const ROOT = path.join(FAKE_HOME, '.claude', 'projects')
const CLAUDE_JSON = path.join(FAKE_HOME, '.claude.json')
const LIMITS = path.join(FAKE_HOME, '.k0', 'usage', 'limits.jsonl')
const REPO = path.join(FAKE_HOME, 'shop')
fs.mkdirSync(path.join(REPO, '.git'), { recursive: true })

const HOUR = 3_600_000
const T0 = Date.UTC(2026, 8, 1, 10, 0, 0)
const FROM = T0 - 86_400_000
const TO = FROM + 7 * 86_400_000
const S1 = '11111111-1111-4111-8111-111111111111'
const S2 = '22222222-2222-4222-8222-222222222222'

const dir = path.join(ROOT, '-shop')
fs.mkdirSync(path.join(dir, S1, 'subagents'), { recursive: true })
const MAIN = path.join(dir, `${S1}.jsonl`)

const iso = (at) => new Date(at).toISOString()
const reply = (requestId, at, model, usage, extra = {}) => ({
  type: 'assistant',
  sessionId: S1,
  cwd: REPO,
  requestId,
  timestamp: iso(at),
  effort: 'high',
  message: { model, usage },
  ...extra,
})
const lines = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
const scan = () => usage.scan({ root: ROOT, limits: LIMITS, claudeJson: CLAUDE_JSON })
const week = (extra = {}) => usage.report({ from: FROM, to: TO, ...extra })

// ── The price list ───────────────────────────────────────────────────────────
section('prices')
check('a million input tokens on Opus 5', cost('claude-opus-5', { input: 1e6 }), 5)
check('a million output tokens on Opus 5', cost('claude-opus-5', { output: 1e6 }), 25)
check('cache reads are a tenth of input', cost('claude-opus-5', { cacheRead: 1e6 }), 0.5)
check('a five-minute cache write is 1.25× input', cost('claude-opus-5', { write5m: 1e6 }), 6.25)
check('an hour-long cache write is 2× input', cost('claude-opus-5', { write1h: 1e6 }), 10)
check('fast mode doubles the whole request', cost('claude-opus-5', { input: 1e6, output: 1e6 }, 'fast'), 60)
check('fast mode changes nothing where there is none', cost('claude-sonnet-5', { input: 1e6 }, 'fast'), 2)
check('Fable 5.1 reads its cache at a flat $0.25', cost('claude-fable-5-1', { cacheRead: 1e6 }), 0.25)
check('the snapshot date is not part of the name', modelId('claude-haiku-4-5-20251001'), 'claude-haiku-4-5')
check('a dated model still has a price', known('claude-haiku-4-5-20251001'), true)
check('a model not on the list has no price, not a zero one', cost('claude-opus-9', { input: 1e6 }), null)

// ── Reading the transcripts ──────────────────────────────────────────────────
// The account k0 sees signed in NOW: everything in the transcripts below happened before it was
// looking, so none of it may be put down to this account.
fs.writeFileSync(CLAUDE_JSON, JSON.stringify({ oauthAccount: { accountUuid: 'acc-1', emailAddress: 'one@example.com', organizationType: 'claude_max' } }))

const A = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200,
  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 200 }, output_tokens_details: { thinking_tokens: 40 } }
fs.writeFileSync(MAIN, lines([
  { type: 'custom-title', customTitle: 'fix-the-checkout', sessionId: S1 },
  { type: 'ai-title', aiTitle: 'checkout-redirect', sessionId: S1 },
  { type: 'user', sessionId: S1, cwd: REPO, timestamp: iso(T0), message: { role: 'user', content: 'fix the checkout' } },
  // One reply, written as two lines — one per block — with the same usage on both.
  reply('req-A', T0, 'claude-opus-5', A),
  reply('req-A', T0, 'claude-opus-5', A),
  reply('req-B', T0 + HOUR, 'claude-opus-5', { input_tokens: 1000, output_tokens: 0, speed: 'fast' }),
  { type: 'system', subtype: 'turn_duration', durationMs: 60_000, sessionId: S1, timestamp: iso(T0 + 2 * 60_000) },
  { type: 'assistant', sessionId: S1, timestamp: iso(T0 + 3 * 60_000), isApiErrorMessage: true, error: 'rate_limit',
    message: { model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } } },
]))

// Where Claude Code really puts a workflow's agents: two folders further down than a subagent.
const SUB = path.join(dir, S1, 'subagents', 'workflows', 'wf_0123abcd-456', 'agent-wf.jsonl')
fs.mkdirSync(path.dirname(SUB), { recursive: true })
fs.writeFileSync(SUB, lines([reply('req-C', T0, 'claude-sonnet-5', { input_tokens: 1_000_000, output_tokens: 0 })]))
const EXPLORE = path.join(dir, S1, 'subagents', 'agent-ex.jsonl')
fs.writeFileSync(EXPLORE, lines([reply('req-D', T0, 'claude-haiku-4-5-20251001', { input_tokens: 1_000_000, output_tokens: 0 })]))
fs.writeFileSync(EXPLORE.replace('.jsonl', '.meta.json'), JSON.stringify({ agentType: 'Explore' }))

scan()
let r = week()
section('reading')
check('a reply written over two lines is counted once', r.totals.requests, 4)
check('every token kind adds up', r.totals.tokens, 10 + 100 + 1000 + 200 + 1000 + 1_000_000 + 1_000_000)
check('the thinking tokens are kept apart', r.totals.thinking, 40)
check('the time Claude spent on the turn', r.totals.work_ms, 60_000)
check('the moment a limit stopped the session', r.totals.limits, 1)
check('a subagent and a workflow fold into the session that started them', r.totals.sessions, 1)
check('the session keeps the title it was given by hand', r.sessions[0].title, 'fix-the-checkout')
check('the session belongs to its repository', r.repos[0].project, 'shop')
const agents = Object.fromEntries(r.agents.map((a) => [a.agent, a.cost]))
check('the workflow agent is told apart', agents.workflow, 2)
check('the plain subagent is told apart', agents.sub, 1)
const opus = cost('claude-opus-5', { input: 10, output: 100, cacheRead: 1000, write1h: 200 }) +
  cost('claude-opus-5', { input: 1000 }, 'fast')
check('the conversation costs what its replies cost', Math.abs(agents.main - opus) < 1e-12, true)
check('fast mode is its own row', r.models.some((m) => m.speed === 'fast'), true)
check('the effort each reply ran at', r.models.find((m) => m.model === 'claude-opus-5').effort, 'high')
check('the synthetic error reply is not a model', r.models.some((m) => m.model === '<synthetic>'), false)
check('what happened before k0 was watching has no account', r.accounts.every((a) => a.uuid === ''), true)

section('as the files grow')
const before = r.totals.requests
fs.appendFileSync(MAIN, JSON.stringify(reply('req-E', T0 + 3 * HOUR, 'claude-opus-5', { input_tokens: 5, output_tokens: 5 })) + '\n')
// Half a line: Claude Code is still writing it.
const half = JSON.stringify(reply('req-F', T0 + 3 * HOUR, 'claude-opus-5', { input_tokens: 7, output_tokens: 7 }))
fs.appendFileSync(MAIN, half.slice(0, 40))
scan()
check('the new reply is read', week().totals.requests, before + 1)
fs.appendFileSync(MAIN, half.slice(40) + '\n')
scan()
check('the half-written one is read once it is whole', week().totals.requests, before + 2)
scan()
check('reading again adds nothing', week().totals.requests, before + 2)

// A transcript that got shorter has already been counted: reading it from the top would count
// every reply in it twice.
fs.writeFileSync(EXPLORE, lines([reply('req-D', T0, 'claude-haiku-4-5', { input_tokens: 1, output_tokens: 1 })]).slice(0, 30) + '\n')
scan()
check('a shorter transcript is not counted again', week().totals.requests, before + 2)

// ── Whose account, and how much of the week ─────────────────────────────────
section('accounts and limits')
const L1 = T0 + 5 * HOUR
fs.mkdirSync(path.dirname(LIMITS), { recursive: true })
fs.writeFileSync(LIMITS, lines([
  { at: L1, session_id: S1, account: { uuid: 'acc-2', email: 'two@example.com' }, five_hour: { pct: 3, resets_at: 1 }, seven_day: { pct: 10, resets_at: 9 } },
  { at: L1 + 10 * 60_000, session_id: S1, account: { uuid: 'acc-2', email: 'two@example.com' }, five_hour: { pct: 5, resets_at: 1 }, seven_day: { pct: 14, resets_at: 9 } },
]))
fs.appendFileSync(MAIN, JSON.stringify(reply('req-G', L1 + 5 * 60_000, 'claude-opus-5', { input_tokens: 1000, output_tokens: 1000 })) + '\n')
scan()
r = week()
const two = r.accounts.find((a) => a.uuid === 'acc-2')
check("the session's own statusline says whose reply it was", two?.email, 'two@example.com')
check('only that reply is put down to it', two?.requests, 1)
check('the rise in the week is put down to the session that ran', r.sessions[0].week_pct, 4)
check('the samples are there to draw', r.limits.find((l) => l.account === 'acc-2')?.samples.length, 2)
check('narrowed to one account, only its replies', week({ account: 'acc-2' }).totals.requests, 1)
check('narrowed to the unknown ones, the rest', week({ account: '' }).totals.requests, before + 2)

// A session the statusline never drew: the account signed in when it ran is the answer.
const LATER = Date.now() + 60_000
fs.writeFileSync(path.join(dir, `${S2}.jsonl`), lines([
  { ...reply('req-H', LATER, 'claude-opus-5', { input_tokens: 1, output_tokens: 1 }), sessionId: S2 },
]))
scan()
check('otherwise, whoever was signed in', usage.accountAt(S2, LATER), 'acc-1')
check('and nobody, before k0 first looked', usage.accountAt(S2, T0), '')

fs.writeFileSync(CLAUDE_JSON, JSON.stringify({ oauthAccount: { accountUuid: 'acc-3', emailAddress: 'three@example.com' } }))
const switched = usage.observeAccount(CLAUDE_JSON, LATER + HOUR)
check('a change of account is seen', switched, 'acc-3')
check('and dated from when it was seen', usage.accountAt(S2, LATER + 2 * HOUR), 'acc-3')
check('without rewriting what came before', usage.accountAt(S2, LATER), 'acc-1')

// ── The story a session belongs to ───────────────────────────────────────────
section('stories')
const story = db.importStory({ title: 'Fix the checkout', project_path: REPO, session_id: S1, started_at: T0, ended_at: T0 + HOUR })
r = week()
check('the session points at its story', r.sessions[0].story?.id, story.id)
check('by the key the board shows', r.sessions[0].story?.key, story.key)
check("and is called what the story is called", r.sessions[0].title, 'Fix the checkout')

after(() => {
  db.close()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.K0_DB + suffix, { force: true })
  fs.rmSync(FAKE_HOME, { recursive: true, force: true })
})
