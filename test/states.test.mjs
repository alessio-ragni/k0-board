import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Two things have to be moved out of the way BEFORE anything is imported, because imports all
// resolve before the first line of code runs.
//
// The home directory first. These tests read and write `~/.claude/projects`, and one of them
// needs a working directory under the home to check how a folder without a `.git` is
// attributed. Pointed at the real home, a test run leaves its scaffolding in your Claude Code
// history and its junk in your home. `os.homedir()` honours $HOME on POSIX and %USERPROFILE%
// on Windows, so setting both moves the whole test run somewhere disposable.
const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-home-'))
process.env.HOME = FAKE_HOME
process.env.USERPROFILE = FAKE_HOME

// And then the database. `launcher.js` drags in `mode.js`, which drags in `db.js`, which opens
// the database the moment it is imported. With a plain `import` at the top it would open the
// real one, and the cards written below would stay on the board forever, in a column that does
// not exist. It has happened: five identical cards in `k0-test-repo`, one per `npm test`.
// `db.js` now stops by itself if anybody tries again, but this is the right way round.
process.env.K0_DB = path.join(os.tmpdir(), `k0-test-${process.pid}.db`)

const { deriveStatus, transcriptPath, projectSlug, renameSession } = await import('../server/watcher.js')
const { sessionName } = await import('../server/launcher.js')
const { scanSessions } = await import('../server/sessions.js')

const CWD = '/tmp/k0-test-cwd'
const dir = path.join(FAKE_HOME, '.claude', 'projects', CWD.replace(/[/.]/g, '-'))
fs.mkdirSync(dir, { recursive: true })

let n = 0
const write = (lines) => {
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
  fs.writeFileSync(transcriptPath(CWD, id), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return id
}

const mode = (m) => ({ type: 'permission-mode', permissionMode: m })
const use = (name, id) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, id }] } })
const result = (id, content = '') => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, content }] },
})

const card = (sid, extra = {}) => ({
  id: 1,
  session_id: sid,
  project_path: CWD,
  status: 'IDLE',
  completed_at: null,
  ...extra,
})
const live = (sid, status, waitingFor) => new Map([[sid, { sessionId: sid, cwd: CWD, status, waitingFor }]])
// Exactly as Claude Code writes them: checked by opening both dialogs for real.
const PLAN_DIALOG = 'permission prompt'
const QUESTION_DIALOG = 'input needed'

const cases = []
const check = (label, got, want) => cases.push([label, got, want, got === want])

// The slug Claude Code names the transcript directory with: get this wrong and the board finds
// nothing at all, and every card sits still.
check('slug with an underscore', projectSlug('/home/you/My_Project'), '-home-you-My-Project')
check('slug with dashes', projectSlug('/home/you/client-site'), '-home-you-client-site')
check('slug with a dot', projectSlug('/home/you/example-site.com'), '-home-you-example-site-com')
check(
  'slug of a worktree',
  projectSlug('/home/you/data-import/.claude-worktrees/fix-parser'),
  '-home-you-data-import--claude-worktrees-fix-parser'
)
check(
  'a very long slug: truncated with a hash',
  projectSlug('/home/you/' + 'x'.repeat(300)).length,
  200 +
    1 +
    Math.abs(
      [...('/home/you/' + 'x'.repeat(300))].reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0)
    ).toString(36).length
)

// BACKLOG: no session at all
check('no session -> BACKLOG', deriveStatus(card(null), new Map()).status, 'BACKLOG')

// COMPLETED beats everything
{
  const s = write([])
  check('completed -> COMPLETED', deriveStatus(card(s, { completed_at: 1 }), live(s, 'busy')).status, 'COMPLETED')
}

// WORKING: busy outside plan mode
{
  const s = write([mode('bypassPermissions')])
  check('busy -> WORKING', deriveStatus(card(s), live(s, 'busy')).status, 'WORKING')
}

// PLANNING: busy inside plan mode
{
  const s = write([mode('plan')])
  check('busy in plan -> PLANNING', deriveStatus(card(s), live(s, 'busy')).status, 'PLANNING')
}

// PLANNING -> WORKING when the mode changes mid-session (the incremental read)
{
  const s = write([mode('plan')])
  check('PLANNING first', deriveStatus(card(s), live(s, 'busy')).status, 'PLANNING')
  fs.appendFileSync(transcriptPath(CWD, s), JSON.stringify(mode('bypassPermissions')) + '\n')
  check('then WORKING (the append was read)', deriveStatus(card(s), live(s, 'busy')).status, 'WORKING')
}

// PLANNED: the plan dialog is open and there is nothing in the transcript yet.
// This is the real case, the one that in the field was mistaken for a question.
{
  const s = write([mode('plan')])
  check(
    'plan on screen, transcript silent -> PLANNED',
    deriveStatus(card(s), live(s, 'waiting', PLAN_DIALOG)).status,
    'PLANNED'
  )
}

// PLANNED when the ExitPlanMode has already been written too
{
  const s = write([mode('plan'), use('ExitPlanMode', 'tu1')])
  check('a plan to approve -> PLANNED', deriveStatus(card(s), live(s, 'waiting', PLAN_DIALOG)).status, 'PLANNED')
  fs.appendFileSync(transcriptPath(CWD, s), JSON.stringify(result('tu1', 'User has approved your plan.')) + '\n')
  check('plan approved -> WORKING right away', deriveStatus(card(s), live(s, 'busy')).status, 'WORKING')
}

// Plan rejected: we stay in planning
{
  const s = write([mode('plan'), use('ExitPlanMode', 'tu4')])
  fs.appendFileSync(transcriptPath(CWD, s), JSON.stringify(result('tu4', "User doesn't want to proceed.")) + '\n')
  check('plan rejected -> PLANNING', deriveStatus(card(s), live(s, 'busy')).status, 'PLANNING')
}

// ASK: a question is still a question even in plan mode
{
  const s = write([use('AskUserQuestion', 'tu2')])
  check('question open -> ASK', deriveStatus(card(s), live(s, 'waiting', QUESTION_DIALOG)).status, 'ASK')
  fs.appendFileSync(transcriptPath(CWD, s), JSON.stringify(result('tu2')) + '\n')
  check('answer given -> IDLE', deriveStatus(card(s), live(s, 'idle')).status, 'IDLE')
}
{
  const s = write([mode('plan')])
  check(
    'a question inside a plan -> ASK, not PLANNED',
    deriveStatus(card(s), live(s, 'waiting', QUESTION_DIALOG)).status,
    'ASK'
  )
}

// Any other permission prompt outside plan mode is still a question
{
  const s = write([mode('bypassPermissions')])
  check('a permission to grant -> ASK', deriveStatus(card(s), live(s, 'waiting', PLAN_DIALOG)).status, 'ASK')
}

// IDLE
{
  const s = write([])
  check('idle -> IDLE', deriveStatus(card(s), live(s, 'idle')).status, 'IDLE')
  check('shell -> IDLE', deriveStatus(card(s), live(s, 'shell')).status, 'IDLE')
}

// Process dead: it keeps only the statuses that say something about you
{
  const s = write([])
  const d = deriveStatus(card(s, { status: 'PLANNED' }), new Map())
  check('closed with a plan sitting there: stays PLANNED', d.status, 'PLANNED')
  check('closed: not alive', d.alive, false)
  check('closed while working -> IDLE', deriveStatus(card(s, { status: 'WORKING' }), new Map()).status, 'IDLE')
  check('closed while planning -> IDLE', deriveStatus(card(s, { status: 'PLANNING' }), new Map()).status, 'IDLE')
  check('closed with a question open: stays ASK', deriveStatus(card(s, { status: 'ASK' }), new Map()).status, 'ASK')
}

// Transcript truncated or recreated: it must not get stuck
{
  const s = write([mode('plan'), use('ExitPlanMode', 'tu3')])
  check('PLANNED before the truncation', deriveStatus(card(s), live(s, 'waiting')).status, 'PLANNED')
  fs.writeFileSync(transcriptPath(CWD, s), JSON.stringify(mode('auto')) + '\n')
  check('WORKING after it', deriveStatus(card(s), live(s, 'busy')).status, 'WORKING')
}

// Renaming a card has to reach the name of the Claude Code session: two lines at the end of the
// transcript, in the same shape Claude Code writes there itself.
{
  const s = write([mode('normal')])
  const name = sessionName('rename test')
  check('the session name is what you see on the card', name, 'Rename-Test')
  check('rename done', renameSession(CWD, s, name), true)

  const rows = fs.readFileSync(transcriptPath(CWD, s), 'utf8').trim().split('\n').slice(-2).map(JSON.parse)
  check('second to last row: custom-title', rows[0].type, 'custom-title')
  check('with the new name', rows[0].customTitle, 'Rename-Test')
  check('and the right session', rows[0].sessionId, s)
  check('last row: agent-name', rows[1].type, 'agent-name')
  check('with the new name', rows[1].agentName, 'Rename-Test')

  // The extra rows must not confuse the reading of the statuses.
  check('the status is still readable', deriveStatus(card(s), live(s, 'busy')).status, 'WORKING')
}

// A session that was never born: there is no transcript to touch, and it must not blow up.
check(
  'a transcript that does not exist: does nothing',
  renameSession(CWD, '00000000-0000-4000-8000-999999999999', 'Whatever'),
  false
)

fs.rmSync(dir, { recursive: true, force: true })

// ── Importing sessions that already happened ─────────────────────────────────
// A fake ~/.claude/projects holding real sessions, automated runs and one session done in a
// worktree: the scan has to keep only the first kind and attribute all of them to the right
// repository.

const REPO = path.join(os.tmpdir(), 'k0-test-repo')
const WT = path.join(REPO, '.claude', 'worktrees', 'wt')
const TRANSCRIPTS = path.join(os.tmpdir(), 'k0-test-transcripts')

fs.mkdirSync(path.join(REPO, '.git'), { recursive: true })
fs.mkdirSync(WT, { recursive: true })
// In a worktree the `.git` is a file pointing at the real repository: that is the way back.
fs.writeFileSync(path.join(WT, '.git'), `gitdir: ${REPO}/.git/worktrees/wt\n`)
const boxA = path.join(TRANSCRIPTS, 'a')
const boxB = path.join(TRANSCRIPTS, 'b')
fs.mkdirSync(boxA, { recursive: true })
fs.mkdirSync(boxB, { recursive: true })

let m = 0
/** Writes a fake transcript and ages it by `minutes`, so we decide the order. */
const transcript = (box, lines, minutes = 0) => {
  const id = `00000000-0000-4000-9000-${String(++m).padStart(12, '0')}`
  const file = path.join(box, `${id}.jsonl`)
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  const t = new Date(Date.now() - minutes * 60000)
  fs.utimesSync(file, t, t)
  return id
}

const T0 = Date.parse('2026-08-01T10:00:00.000Z')
const T1 = Date.parse('2026-08-01T11:30:00.000Z')
const started = { type: 'mode', mode: 'normal' }
const said = (text, cwd = REPO, at = T0) => ({
  type: 'user',
  cwd,
  timestamp: new Date(at).toISOString(),
  message: { role: 'user', content: text },
})
const replied = (text, cwd = REPO, at = T1) => ({
  type: 'assistant',
  cwd,
  timestamp: new Date(at).toISOString(),
  message: { role: 'assistant', content: [{ type: 'text', text }] },
})

// A real session, with the title Claude Code has already written for itself.
const real = transcript(
  boxA,
  [
    started,
    said('fix the signup redirect, it drops the query string'),
    replied('Done: the redirect keeps the query string now.'),
    { type: 'ai-title', aiTitle: 'signup-redirect-query-string' },
  ],
  10
)

// One from two days ago: it exercises the per-repository cap and the day window.
const older = transcript(boxA, [started, said('let us revisit the detail page'), replied('ok')], 60 * 50)

// An automated run: it starts from `queue-operation` and has no `mode` line at all.
const automated = transcript(
  boxA,
  [
    { type: 'queue-operation', operation: 'enqueue', content: 'You are an expert copywriter...' },
    said('You are an expert copywriter...'),
    replied('# Furnished one-bedroom'),
  ],
  5
)

// A prompt pasted while Claude was still starting up: the transcript begins with the send queue
// and the `mode` arrives further down. These are real sessions and have to be picked up.
const pasted = transcript(
  boxA,
  [
    { type: 'queue-operation', operation: 'enqueue', content: 'look at this PDF' },
    said('look at this PDF and tell me whether the numbers add up'),
    replied('They do not: two entries are missing.'),
    started,
  ],
  15
)

// A session done inside a worktree: it belongs to the repository it came from.
const fromWorktree = transcript(boxB, [started, said('trying the change here', WT), replied('tried', WT)], 20)

// Scaffolding only, not one word of yours: there is nothing for a card to say.
const scaffolding = transcript(boxA, [started, said('<command-name>/clear</command-name>'), replied('ok')], 30)

{
  const found = scanSessions({ days: 14, perRepo: 10, root: TRANSCRIPTS })
  const ids = found.map((s) => s.session_id)
  check('the real session is picked up', ids.includes(real), true)
  check('the automated run stays out', ids.includes(automated), false)
  check('with no words of yours it is not imported', ids.includes(scaffolding), false)
  check('a `mode` at the end counts as much as one at the top', ids.includes(pasted), true)
  check('and nothing else gets in', found.length, 4)
  check('all attributed to the same repository', new Set(found.map((s) => s.project_path)).size, 1)
  check('and that repository is the real one', found[0].project_path, REPO)
  check(
    'the worktree session goes back to the base repository',
    found.find((s) => s.session_id === fromWorktree).project_path,
    REPO
  )

  const s = found.find((x) => x.session_id === real)
  check('the title Claude Code already had', s.title_hint, 'signup-redirect-query-string')
  check('the first thing you asked for', s.first_prompt.startsWith('fix the signup redirect'), true)
  check('the last thing Claude said', s.last_reply.startsWith('Done:'), true)
  check('one turn of yours counted', s.turns, 1)
  check('the real start of the session', s.started_at, T0)
  check('the real end of the session', s.ended_at, T1)
  check('most recent at the top', found[0].ended_at >= found.at(-1).ended_at, true)
}

// A working directory that is not a repository — a folder of notes, say — counts like the
// others: it lands on the board all the same, and its subdirectories do not open columns of
// their own.
{
  const noGit = path.join(os.homedir(), 'k0-test-nogit')
  const inside = path.join(noGit, 'dossier')
  fs.mkdirSync(inside, { recursive: true })
  const box = path.join(TRANSCRIPTS, 'c')
  fs.mkdirSync(box, { recursive: true })
  const s = transcript(box, [started, said('let us read the contract', inside), replied('read', inside)], 15)

  const found = scanSessions({ days: 14, perRepo: 10, root: TRANSCRIPTS }).find((x) => x.session_id === s)
  check('a directory with no .git counts just the same', !!found, true)
  check('and the column is the directory under the home', found?.project_path, noGit)

  fs.rmSync(box, { recursive: true, force: true })
  fs.rmSync(noGit, { recursive: true, force: true })
}

{
  const two = scanSessions({ days: 14, perRepo: 2, root: TRANSCRIPTS })
  check('the per-repository cap is respected', two.length, 2)
  check(
    'and it keeps the most recent',
    two.some((s) => s.session_id === older),
    false
  )
}

{
  const fewer = scanSessions({ days: 14, perRepo: 10, exclude: new Set([real]), root: TRANSCRIPTS })
  check(
    'a session already imported is skipped',
    fewer.some((s) => s.session_id === real),
    false
  )
}

{
  const yesterday = scanSessions({ days: 1, perRepo: 10, root: TRANSCRIPTS })
  check(
    'outside the window nothing is looked at',
    yesterday.some((s) => s.session_id === older),
    false
  )
}

// An imported card: born yellow, switched off, and dated to when it actually happened.
// `K0_DB` was moved at the top of this file: the database here is the disposable one.
const store = await import('../server/db.js')
{
  const c = store.importCard({
    title: 'Signup-Redirect-Query-String',
    description: 'Fixed the signup redirect dropping the query string.',
    project_path: REPO,
    session_id: real,
    started_at: T0,
    ended_at: T1,
  })
  check('imported as IDLE', c.status, 'IDLE')
  check('session off: tick revives it if it is still running', c.session_alive, 0)
  check('no prompt to paste into the terminal on Resume', c.prompt, '')
  check('born when the session was born', c.created_at, T0)
  const fromBoard = store.listCards().find((x) => x.id === c.id)
  check('the age is the real one, not the import time', fromBoard.status_since, T1)
  check('the session id counts as taken', store.sessionIds().includes(real), true)
  check('the description can be corrected from the pencil', store.patchCard(c.id, { description: 'other' }).description, 'other')
  // This is what keeps an imported card yellow without touching the state machine.
  check('session dead and IDLE: stays IDLE', deriveStatus({ ...c, status: 'IDLE' }, new Map()).status, 'IDLE')
}

// ── The git mark ──────────────────────────────────────────────────────────────
// The two parts that can be checked without a real repository: how the output of
// `status --porcelain=v2` is read, and how credit for commits is divided.
{
  const { parseStatus, sessionShare } = await import('../server/git.js')

  const dirty = [
    '# branch.oid 1111111111111111111111111111111111111111',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -0',
    '1 .M N... 100644 100644 100644 aaa bbb web/board.js',
    '1 M. N... 100644 100644 100644 ccc ddd server/git.js',
    '? web/new.js',
    'u UU N... 100644 100644 100644 100644 eee fff ggg web/clash.js',
    '',
  ].join('\n')
  const s = parseStatus(dirty)
  check('the branch is read from the branch.head line', s.branch, 'main')
  check('the # lines are not files', s.dirty, 4)

  check('clean tree: no files touched', parseStatus('# branch.head main\n').dirty, 0)
  check('and the branch is still there', parseStatus('# branch.head main\n').branch, 'main')
  check('a detached HEAD is not a branch name', parseStatus('# branch.head (detached)\n').branch, null)
  check('empty output breaks nothing', parseStatus('').dirty, 0)

  const shas = ['ccc', 'bbb', 'aaa']
  check('the commits since the start are the ones before it in the list', sessionShare(shas, 'aaa'), 2)
  check('started at the top: none of them are its own', sessionShare(shas, 'ccc'), 0)
  check('the start was already pushed: they are all its own', sessionShare(shas, 'zzz'), 3)
  check('nothing to push, nothing to divide', sessionShare([], 'aaa'), 0)
  check('with no starting mark there is no knowing', sessionShare(shas, null), null)
}

for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.K0_DB + suffix, { force: true })
fs.rmSync(TRANSCRIPTS, { recursive: true, force: true })
fs.rmSync(REPO, { recursive: true, force: true })
fs.rmSync(FAKE_HOME, { recursive: true, force: true })

let bad = 0
for (const [label, got, want, ok] of cases) {
  if (!ok) bad++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label} → ${got}${ok ? '' : ` (expected ${want})`}`)
}
console.log(`\n${cases.length - bad}/${cases.length} passed`)
process.exit(bad ? 1 : 0)
