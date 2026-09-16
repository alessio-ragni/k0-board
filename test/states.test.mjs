import { check, section, after } from './harness.mjs'
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
// real one, and the stories written below would stay on the board forever, in a column that does
// not exist. It has happened: five identical stories in `k0-test-repo`, one per `npm test`.
// `db.js` now stops by itself if anybody tries again, but this is the right way round.
process.env.K0_DB = path.join(os.tmpdir(), `k0-test-${process.pid}.db`)

const { deriveStatus, transcriptPath, projectSlug, renameSession, findTranscript, busy } =
  await import('../server/watcher.js')
const { sessionName, promptText, promptIsEmpty, renameDue, RENAME_RETRY_MS } = await import('../server/launcher.js')
const { capabilities } = await import('../platform/index.js')
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

// A story exactly as `db.listStories()` hands it over: flat, with the current session's own
// status on it as `session_status`. That field is the one `deriveStatus` reads — the board's
// `status`, which can also say BACKLOG or COMPLETED, is worked out from the two axes together
// and is not this function's business any more.
const story = (sid, extra = {}) => ({
  id: 1,
  session_id: sid,
  project_path: CWD,
  session_status: 'IDLE',
  completed_at: null,
  ...extra,
})
const live = (sid, status, waitingFor) => new Map([[sid, { sessionId: sid, cwd: CWD, status, waitingFor }]])
// Exactly as Claude Code writes them: checked by opening both dialogs for real.
const PLAN_DIALOG = 'permission prompt'
const QUESTION_DIALOG = 'input needed'

// The slug Claude Code names the transcript directory with: get this wrong and the board finds
// nothing at all, and every story sits still.
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

// No session at all: there is no live status to derive and nothing is running. What the board
// draws for a story in this state — BACKLOG — is the story's business, not the watcher's.
{
  const d = deriveStatus(story(null), new Map())
  check('no session: nothing is alive', d.alive, false)
  check('and no session status is invented', d.status, 'IDLE')
}

// Ticked off: Done closed the terminal, so whatever the process still says, the post-it stops
// breathing. COMPLETED is drawn over the top of all of it by the board.
{
  const s = write([])
  const d = deriveStatus(story(s, { completed_at: 1 }), live(s, 'busy'))
  check('done: not alive, whatever the process is doing', d.alive, false)
  // COMPLETED is not a session status any more, so this axis answers with the one the session
  // was last in rather than inventing a word for "finished" that belongs to the other axis.
  check('and the session keeps the status it had', d.status, 'IDLE')
}

// WORKING: busy outside plan mode
{
  const s = write([mode('bypassPermissions')])
  check('busy -> WORKING', deriveStatus(story(s), live(s, 'busy')).status, 'WORKING')
}

// PLANNING: busy inside plan mode
{
  const s = write([mode('plan')])
  check('busy in plan -> PLANNING', deriveStatus(story(s), live(s, 'busy')).status, 'PLANNING')
}

// PLANNING -> WORKING when the mode changes mid-session (the incremental read)
{
  const s = write([mode('plan')])
  check('PLANNING first', deriveStatus(story(s), live(s, 'busy')).status, 'PLANNING')
  fs.appendFileSync(transcriptPath(CWD, s), JSON.stringify(mode('bypassPermissions')) + '\n')
  check('then WORKING (the append was read)', deriveStatus(story(s), live(s, 'busy')).status, 'WORKING')
}

// PLANNED: the plan dialog is open and there is nothing in the transcript yet.
// This is the real case, the one that in the field was mistaken for a question.
{
  const s = write([mode('plan')])
  check(
    'plan on screen, transcript silent -> PLANNED',
    deriveStatus(story(s), live(s, 'waiting', PLAN_DIALOG)).status,
    'PLANNED'
  )
}

// PLANNED when the ExitPlanMode has already been written too
{
  const s = write([mode('plan'), use('ExitPlanMode', 'tu1')])
  check('a plan to approve -> PLANNED', deriveStatus(story(s), live(s, 'waiting', PLAN_DIALOG)).status, 'PLANNED')
  fs.appendFileSync(transcriptPath(CWD, s), JSON.stringify(result('tu1', 'User has approved your plan.')) + '\n')
  check('plan approved -> WORKING right away', deriveStatus(story(s), live(s, 'busy')).status, 'WORKING')
}

// Plan rejected: we stay in planning
{
  const s = write([mode('plan'), use('ExitPlanMode', 'tu4')])
  fs.appendFileSync(transcriptPath(CWD, s), JSON.stringify(result('tu4', "User doesn't want to proceed.")) + '\n')
  check('plan rejected -> PLANNING', deriveStatus(story(s), live(s, 'busy')).status, 'PLANNING')
}

// ASK: a question is still a question even in plan mode
{
  const s = write([use('AskUserQuestion', 'tu2')])
  check('question open -> ASK', deriveStatus(story(s), live(s, 'waiting', QUESTION_DIALOG)).status, 'ASK')
  fs.appendFileSync(transcriptPath(CWD, s), JSON.stringify(result('tu2')) + '\n')
  check('answer given -> IDLE', deriveStatus(story(s), live(s, 'idle')).status, 'IDLE')
}
{
  const s = write([mode('plan')])
  check(
    'a question inside a plan -> ASK, not PLANNED',
    deriveStatus(story(s), live(s, 'waiting', QUESTION_DIALOG)).status,
    'ASK'
  )
}

// Any other permission prompt outside plan mode is still a question
{
  const s = write([mode('bypassPermissions')])
  check('a permission to grant -> ASK', deriveStatus(story(s), live(s, 'waiting', PLAN_DIALOG)).status, 'ASK')
}

// IDLE
{
  const s = write([])
  check('idle -> IDLE', deriveStatus(story(s), live(s, 'idle')).status, 'IDLE')
  check('shell -> IDLE', deriveStatus(story(s), live(s, 'shell')).status, 'IDLE')
}

// Process dead: it keeps only the statuses that say something about you
{
  const s = write([])
  const d = deriveStatus(story(s, { session_status: 'PLANNED' }), new Map())
  check('closed with a plan sitting there: stays PLANNED', d.status, 'PLANNED')
  check('closed: not alive', d.alive, false)
  const dead = (was) => deriveStatus(story(s, { session_status: was }), new Map()).status
  check('closed while working -> IDLE', dead('WORKING'), 'IDLE')
  check('closed while planning -> IDLE', dead('PLANNING'), 'IDLE')
  check('closed with a question open: stays ASK', dead('ASK'), 'ASK')
  check('closed at your turn: stays IDLE', dead('IDLE'), 'IDLE')
}

// Which sessions Close is offered on. It is the same rule the board draws the button by: a
// session that is grinding away is not one to close, and everything else keeps its colour when
// the terminal goes.
{
  check('working is not to be closed', busy('WORKING'), true)
  check('planning is not to be closed', busy('PLANNING'), true)
  check('your turn can be closed', busy('IDLE'), false)
  check('a question waiting can be closed', busy('ASK'), false)
  check('a plan waiting can be closed', busy('PLANNED'), false)
  check('a story with nothing running has nothing to close', busy('BACKLOG'), false)
}

// Transcript truncated or recreated: it must not get stuck
{
  const s = write([mode('plan'), use('ExitPlanMode', 'tu3')])
  check('PLANNED before the truncation', deriveStatus(story(s), live(s, 'waiting')).status, 'PLANNED')
  fs.writeFileSync(transcriptPath(CWD, s), JSON.stringify(mode('auto')) + '\n')
  check('WORKING after it', deriveStatus(story(s), live(s, 'busy')).status, 'WORKING')
}

// Renaming a story has to reach the name of the Claude Code session: two lines at the end of the
// transcript, in the same shape Claude Code writes there itself.
{
  const s = write([mode('normal')])
  const name = sessionName('rename test')
  check('the session name is what you see on the story', name, 'Rename-Test')
  check('rename done', renameSession(story(s), name), true)

  const rows = fs.readFileSync(transcriptPath(CWD, s), 'utf8').trim().split('\n').slice(-2).map(JSON.parse)
  check('second to last row: custom-title', rows[0].type, 'custom-title')
  check('with the new name', rows[0].customTitle, 'Rename-Test')
  check('and the right session', rows[0].sessionId, s)
  check('last row: agent-name', rows[1].type, 'agent-name')
  check('with the new name', rows[1].agentName, 'Rename-Test')

  // The extra rows must not confuse the reading of the statuses.
  check('the status is still readable', deriveStatus(story(s), live(s, 'busy')).status, 'WORKING')
}

// A session that was never born: there is no transcript to touch, and it must not blow up.
check(
  'a transcript that does not exist: does nothing',
  renameSession(story('00000000-0000-4000-8000-999999999999'), 'Whatever'),
  false
)

// A session that moved into a worktree writes its transcript under the worktree's slug, and the
// story only knows the repository. Seen: a rename lost that way, the transcript looked for under
// the repository and never found. So it is looked for where it is.
{
  const WORK = `${CWD}/.claude/worktrees/fix-parser`
  const workDir = path.join(FAKE_HOME, '.claude', 'projects', projectSlug(WORK))
  fs.mkdirSync(workDir, { recursive: true })
  const s = '00000000-0000-4000-8000-00000000wt01'
  fs.writeFileSync(transcriptPath(WORK, s), JSON.stringify(mode('normal')) + '\n')

  check('found from the story’s work path', findTranscript(s, WORK, CWD), transcriptPath(WORK, s))
  check('found with no hint at all, by walking the projects', findTranscript(s), transcriptPath(WORK, s))
  check('a hint that is not there is skipped', findTranscript(s, null, '/nowhere', WORK), transcriptPath(WORK, s))
  check('nothing anywhere: null', findTranscript('00000000-0000-4000-8000-00000000wt99', CWD), null)

  check('the rename reaches the worktree’s transcript', renameSession(story(s, { work_path: WORK }), 'Moved'), true)
  const rows = fs.readFileSync(transcriptPath(WORK, s), 'utf8').trim().split('\n').slice(-2).map(JSON.parse)
  check('with the name', rows[0].customTitle, 'Moved')
  check(
    'and so does one from a story that forgot its work path',
    renameSession(story(s), 'Moved-Again'),
    true
  )
  fs.rmSync(workDir, { recursive: true, force: true })
}

fs.rmSync(dir, { recursive: true, force: true })

// ── Renaming a session that is still running ─────────────────────────────────
section('Renaming a session that is still running')

// The input box as Terminal reads it back, captured on real windows. The last `❯` is the box;
// the ones above it are messages already sent.
const BOX = (line) =>
  ['❯ /rename Old-Name', '  ⎿  Session renamed to: Old-Name', '───── Old-Name ─', line, '─────', '  Opus 5 │ repo'].join(
    '\n'
  )
check('an empty box', promptText(BOX('❯')), '')
check('an empty box, with the spaces Terminal pads the line with', promptText(BOX('❯      ')), '')
check('the hint on a box never typed in reads as text', promptText(BOX('❯ Try "how do I log an error?"')), 'Try "how do I log an error?"')
check('a draft', promptText(BOX('❯ fix the bug')), 'fix the bug')
check('the command, once typed', promptText(BOX('❯ /rename New-Name')), '/rename New-Name')
check('no box at all: a dialog is open', promptText('Do you trust the files in this folder?\n  Yes\n  No'), null)
check('no screen at all', promptText(null), null)

check('free: nothing under the cursor', promptIsEmpty(BOX('❯')), true)
check('free: only the hint', promptIsEmpty(BOX('❯ Try "how do I log an error?"')), true)
check('not free: a draft', promptIsEmpty(BOX('❯ fix the bug')), false)
// A menu puts its `❯` on the chosen row, and a key pressed there picks something.
check('not free: a menu', promptIsEmpty('Security guide\n ❯ No, exit\n   Yes, I trust this folder'), false)
check('not free: no box', promptIsEmpty(null), false)

// Whether the loop should type at all. Every "no" holds on every platform; the "yes" only where
// the adapter can type into a live session, which the test asks rather than assumes.
{
  const row = { session_id: 'live-1', title: 'New Name', terminal_window_id: '42' }
  const session = (extra) => ({ sessionId: 'live-1', status: 'idle', name: 'Old-Name', ...extra })
  check('not with the session gone', renameDue(row, undefined), false)
  check('not while a turn is running', renameDue(row, session({ status: 'busy' })), false)
  check('not with a dialog open', renameDue(row, session({ status: 'waiting' })), false)
  check('not when the name is already right', renameDue(row, session({ name: 'New-Name' })), false)
  check('not for a Claude Code that does not say its name', renameDue(row, { sessionId: 'live-1', status: 'idle' }), false)
  check('not without a window', renameDue({ ...row, terminal_window_id: null }, session()), false)
  check(
    'yes, idle under the old name — where the platform can',
    renameDue(row, session()),
    capabilities.terminal.commands
  )
  check('the timeout after a try is a minute', RENAME_RETRY_MS, 60000)
}

// ── Importing sessions that already happened ─────────────────────────────────
section('Importing sessions that already happened')
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

// Scaffolding only, not one word of yours: there is nothing for a story to say.
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

// An imported story: born yellow, switched off, and dated to when it actually happened.
// `K0_DB` was moved at the top of this file: the database here is the disposable one.
const store = await import('../server/db.js')
{
  const c = store.importStory({
    title: 'Signup-Redirect-Query-String',
    description: 'Fixed the signup redirect dropping the query string.',
    project_path: REPO,
    session_id: real,
    started_at: T0,
    ended_at: T1,
  })
  check('imported as IDLE', c.status, 'IDLE')
  check('and the work counts as started', c.state, 'Working')
  check('session off: tick revives it if it is still running', c.session_alive, 0)
  check('no prompt to paste into the terminal on Resume', c.prompt, '')
  check('born when the session was born', c.created_at, T0)
  const fromBoard = store.listStories().find((x) => x.id === c.id)
  check('the age is the real one, not the import time', fromBoard.status_since, T1)
  check('the session id counts as taken', store.sessionIds().includes(real), true)
  check('the description can be corrected from the pencil', store.patchStory(c.id, { description: 'other' }).description, 'other')
  // This is what keeps an imported story yellow without touching the state machine.
  check('session dead and IDLE: stays IDLE', deriveStatus(fromBoard, new Map()).status, 'IDLE')
}

// ── The git mark ──────────────────────────────────────────────────────────────
section('The git mark')
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

// Tidying up waits until the tests have run, which is what `after` is for. The handle has to go
// before the file does: on Windows a file that is still open cannot be deleted, and this line is
// the whole difference between a green build and a red one there.
after(async () => {
  ;(await import('../server/db.js')).close()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.K0_DB + suffix, { force: true })
  fs.rmSync(TRANSCRIPTS, { recursive: true, force: true })
  fs.rmSync(REPO, { recursive: true, force: true })
  fs.rmSync(FAKE_HOME, { recursive: true, force: true })
})

