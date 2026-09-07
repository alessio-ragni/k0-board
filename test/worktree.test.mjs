import { check, section, after } from './harness.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// `worktree.js` reaches `db.js`, which opens the database the moment it is imported. `K0_DB` and
// `HOME` first, the imports after — with a plain `import` at the top it would already be too late.
const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-home-'))
process.env.HOME = FAKE_HOME
process.env.USERPROFILE = FAKE_HOME
process.env.K0_DB = path.join(os.tmpdir(), `k0-worktree-test-${process.pid}.db`)

const db = await import('../server/db.js')
const wt = await import('../server/worktree.js')

const made = [FAKE_HOME]

// ── The names and the message ────────────────────────────────────────────────
// No git needed for these, and they are the parts that decide what a commit is called.
section('The names and the message')
{
  check('a title becomes a directory name', wt.dirName('Fix the invoicing API'), 'fix-the-invoicing-api')
  check('the dashes are trimmed before it is cut, exactly as .k0/ does it',
    wt.dirName('  ' + 'a'.repeat(45)), 'a'.repeat(40))
  check('a title with nothing in it still names a directory', wt.dirName('!!!'), 'story')

  // `-z` because git quotes anything that is not plain ASCII otherwise, and a rename carries two
  // paths where everything else carries one.
  const renamed = wt.parseNameStatus('R100\0old/name.js\0new/name.js\0M\0server/db.js\0')
  check('a rename is one file, at its new path', renamed.map((f) => f.path).join(','), 'new/name.js,server/db.js')
  check('and keeps the letter git gave it', renamed[0].status, 'R')
  check('a copy is one file too, at the path it was copied to',
    wt.parseNameStatus('C75\0lib/one.js\0lib/two.js\0').map((f) => `${f.status} ${f.path}`).join(','), 'C lib/two.js')
  check('a letter git cut off before its path is not a file', wt.parseNameStatus('M\0').length, 0)
  check('and neither is nothing at all', wt.parseNameStatus(null).length, 0)

  const docs = ['a', 'b', 'c', 'd'].map((n) => ({ status: 'M', path: `docs/${n}.md` }))
  check('documentation is documentation', wt.commitMessage(docs), 'docs: update 4 files under docs/')
  check('the story title is what the message says when there is one',
    wt.commitMessage(docs, { title: 'Fix the invoicing API' }), 'docs: fix the invoicing API')
  check('a name written the way it is written is left alone',
    wt.commitMessage([{ status: 'A', path: 'server/x.js' }], { title: 'API returns 500' }),
    'feat: API returns 500')
  check('a test-only diff is a test', wt.commitMessage([{ status: 'M', path: 'test/db.test.mjs' }]),
    'test: update test/db.test.mjs')
}

// ── What the diff says it is ─────────────────────────────────────────────────
// The type is a guess made from the shape of the diff, and each of these is one of the shapes.
section('What the diff says it is')
{
  check('a README beside a file under docs/ is still documentation',
    wt.commitMessage([{ status: 'M', path: 'README.md' }, { status: 'M', path: 'docs/database.md' }]),
    'docs: update README.md, update docs/database.md')
  check('a test living next to the code it tests is a test too',
    wt.commitMessage([{ status: 'M', path: 'server/db.test.js' }]), 'test: update server/db.test.js')
  check('the furniture of the repository is a chore',
    wt.commitMessage([{ status: 'M', path: '.github/workflows/release.yml' }, { status: 'M', path: 'package.json' }]),
    'chore: update .github/workflows/release.yml, update package.json')
  check('a new file makes it a feature', wt.commitMessage([
    { status: 'A', path: 'server/new.js' },
    { status: 'M', path: 'server/db.js' },
  ]), 'feat: add server/new.js, update server/db.js')
  check('changing what was already there makes it a fix',
    wt.commitMessage([{ status: 'M', path: 'server/db.js' }]), 'fix: update server/db.js')
  check('a diff with no files in it is a chore with nothing to say',
    wt.commitMessage([]), 'chore: save the work in progress')
  check('every letter git uses has a word', wt.commitMessage([
    { status: 'A', path: 'a.js' },
    { status: 'D', path: 'b.js' },
    { status: 'R', path: 'c.js' },
  ]), 'feat: add a.js, remove b.js, rename c.js')
  check('a letter it does not have a word for still updates something',
    wt.commitMessage([{ status: 'T', path: 'link.js' }]), 'fix: update link.js')

  // Past three files the list stops being worth reading and the directory says more than the names.
  const twenty = Array.from({ length: 20 }, (_, i) => ({ status: 'M', path: `server/part-${i}.js` }))
  check('twenty files under one directory are counted, not listed',
    wt.commitMessage(twenty), 'fix: update 20 files under server/')
  check('files with no directory in common are just counted', wt.commitMessage([
    { status: 'M', path: 'server/a.js' },
    { status: 'M', path: 'web/b.js' },
    { status: 'M', path: 'index.js' },
    { status: 'M', path: 'other.js' },
  ]), 'fix: update 4 files')
}

// ── The subject line ─────────────────────────────────────────────────────────
// The story's title is the one sentence in the database a person wrote about this work, so it is
// what `git log` gets — as the first words of a sentence, and no longer than a subject may be.
section('The subject line')
{
  const one = [{ status: 'M', path: 'server/db.js' }]
  check('a heading becomes the first words of a sentence',
    wt.commitMessage(one, { title: 'Tidy   up the parser.  ' }), 'fix: tidy up the parser')
  check('a title with nothing left in it lets the diff speak instead',
    wt.commitMessage(one, { title: ' ... ' }), 'fix: update server/db.js')
  check('a long title is cut at a word, not through one',
    wt.commitMessage(one, { title: 'Rewrite the invoicing exporter so every column lines up with the ledger again' }),
    'fix: rewrite the invoicing exporter so every column lines up with the')
  check('and a long title with nowhere to cut is cut anyway',
    wt.commitMessage(one, { title: 'a'.repeat(80) }), `fix: ${'a'.repeat(67)}`)
  check('so the subject is never longer than a subject may be',
    wt.commitMessage(one, { title: 'a'.repeat(80) }).length <= 72, true)
}

// ── What git said ────────────────────────────────────────────────────────────
// The sentence a refusal carries under it. Everything here is a rejected child process, which is
// the one thing about git that cannot be arranged in a test that runs in a quarter of a second:
// waiting for a timeout costs ten seconds, and killing git by hand is what a timeout is.
section('What git said')
{
  check('what git wrote is what is kept', wt.words({ stderr: "fatal: 'wt-K42' is already checked out\n" }),
    "fatal: 'wt-K42' is already checked out")
  check('and only the tail of it, when it wrote an essay',
    wt.words({ stdout: Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n') }).split('\n').length, 12)
  // `execFile` gives up on a slow command by killing it, and the error it hands back carries no
  // code at all — so reading only `ETIMEDOUT` reported the command line back at the user instead.
  check('a git that had to be killed says it ran out of time',
    wt.words({ killed: true, signal: 'SIGTERM', code: null, message: 'Command failed: /usr/bin/git -C /a/b merge' }),
    'git took too long and was given up on.')
  check('and so does the spelling the synchronous calls use',
    wt.words({ code: 'ETIMEDOUT', message: 'Command failed: /usr/bin/git status' }),
    'git took too long and was given up on.')
  check('a failure with nothing to say at all says nothing', wt.words(null), '')
}

// ── A worktree, opened and merged back ───────────────────────────────────────
section('A worktree, opened and merged back')

const git = (args, cwd) =>
  spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } })

const tmp = (prefix) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  made.push(dir)
  return dir
}

const REPO = tmp('k0-wt-')
const BARE = tmp('k0-remote-')

const ready = git(['init', '-q', REPO]).status === 0 && git(['init', '-q', '--bare', BARE]).status === 0

/**
 * Nothing on the machine running the tests gets to decide the result: no system config, an author
 * of its own, no signing, and an empty hooks folder in place of whoever's is installed.
 *
 * The settings are appended to `.git/config` rather than set with four `git config` runs, because
 * this happens for every repository in the file and a spawned process is most of what they cost.
 * Backslashes are an escape in that file, so the hooks path goes in with forward slashes.
 */
function settle(repo) {
  const hooks = path.join(repo, '.empty-hooks')
  fs.mkdirSync(hooks, { recursive: true })
  fs.appendFileSync(
    path.join(repo, '.git', 'config'),
    '[user]\n\temail = test@example.invalid\n\tname = k0 test\n' +
      '[commit]\n\tgpgsign = false\n' +
      `[core]\n\thooksPath = ${hooks.split(path.sep).join('/')}\n`
  )
  fs.writeFileSync(path.join(repo, 'README.md'), '# start\n')
  git(['add', '-A'], repo)
  git(['commit', '-qm', 'chore: start'], repo)
  return repo
}

/** A repository of its own, so one refusal cannot leave the next test standing in its mess. */
function freshRepo() {
  const repo = tmp('k0-wt-')
  git(['init', '-q', repo])
  return settle(repo)
}

/** A story in that repository with a session already on it, which is what a worktree hangs off. */
function storyIn(repo, title) {
  const story = db.createStory({ project_path: repo, title })
  db.attachSession(story.id, `session-${story.id}`)
  return story
}

const live = (story) => db.currentSession(story.id)

/** Two commits that touch the same lines of the same files, left mid-merge and conflicted. */
function conflictIn(repo, files) {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], repo).stdout.trim()
  git(['checkout', '-q', '-b', 'other'], repo)
  for (const f of files) fs.writeFileSync(path.join(repo, f), 'theirs\n')
  git(['add', '-A'], repo)
  git(['commit', '-qm', 'chore: theirs'], repo)
  git(['checkout', '-q', branch], repo)
  for (const f of files) fs.writeFileSync(path.join(repo, f), 'ours\n')
  git(['add', '-A'], repo)
  git(['commit', '-qm', 'chore: ours'], repo)
  git(['merge', 'other'], repo)
}

if (ready) {
  settle(REPO)
  git(['remote', 'add', 'origin', BARE], REPO)
  const base = git(['rev-parse', '--abbrev-ref', 'HEAD'], REPO).stdout.trim()

  const story = storyIn(REPO, 'Fix the invoicing API')
  let session = live(story)

  const opened = await wt.open(session, db.getStory(story.id))
  check('it opens', opened.ok, true)
  check('on a branch named for the story', opened.branch, `wt-${story.key}`)
  check('from the branch you were standing on, not main', opened.base, base)
  check('under .claude/worktrees', path.dirname(opened.path), path.join(REPO, '.claude', 'worktrees'))
  check('and the directory is really there', fs.existsSync(path.join(opened.path, '.git')), true)
  check('the session remembers where it is working', db.currentSession(story.id).work_path, opened.path)

  // The worktree lives inside the repository, so without this every `git status` the user runs
  // grows a directory they never made. The line goes in `.git/info/exclude`, never in `.gitignore`.
  check('the folder is kept out of the way', git(['check-ignore', '-q', opened.path], REPO).status, 0)
  check('and .gitignore was not the place it was done', fs.existsSync(path.join(REPO, '.gitignore')), false)

  session = live(story)
  const twice = await wt.open(session, db.getStory(story.id))
  check('a second worktree for the same session is refused', twice.ok, false)
  check('and says where the first one is', twice.error.includes(opened.path), true)

  // What the board asks for while a session is running: where the copy is and what is in it.
  fs.writeFileSync(path.join(opened.path, 'answer.txt'), '42\n')
  const seen = await wt.state(live(story))
  check('the board can see the copy while it is open', seen.exists, true)
  check('on the branch it was opened on', seen.branch, `wt-${story.key}`)
  check('knowing the branch it will go home to', seen.base, base)
  check('and counting what is sitting in it', seen.dirty, 1)
  check('with nothing committed there yet', seen.commits, 0)

  const merged = await wt.merge(db.currentSession(story.id))
  check('it merges', merged.ok, true)
  check('having committed what was left pending', merged.commit, 'feat: fix the invoicing API')
  check('and says the repository hooks ran in the copy', merged.hooks, true)
  check('one commit came across', merged.commits > 0, true)
  check('the work is in the repository', fs.existsSync(path.join(REPO, 'answer.txt')), true)
  check('the copy is gone', fs.existsSync(opened.path), false)
  check('so is its branch', git(['show-ref', '--verify', '--quiet', `refs/heads/wt-${story.key}`], REPO).status !== 0,
    true)
  check('and the session has nowhere it is working any more', db.currentSession(story.id).work_path, null)

  // The rule the module exists to keep. A merge is a local thing; publishing is a decision the
  // user makes when they are ready to make it.
  check('nothing was pushed', git(['for-each-ref'], BARE).stdout.trim(), '')

  check('merging again has nothing to merge', (await wt.merge(db.currentSession(story.id))).ok, false)

  // A repository with work in it that nobody has committed: a merge on top of it either refuses
  // halfway or buries it.
  const second = db.createStory({ project_path: REPO, title: 'Something else' })
  db.attachSession(second.id, 'session-two')
  fs.writeFileSync(path.join(REPO, 'README.md'), '# changed by hand\n')
  const dirty = await wt.open(db.currentSession(second.id), db.getStory(second.id))
  check('a worktree is not opened over uncommitted work', dirty.ok, false)
  check('and it says how much of it there is', dirty.error.includes('is 1 change not committed'), true)
  git(['checkout', '--', 'README.md'], REPO)
}

// ── A worktree that does nothing ─────────────────────────────────────────────
// The session was started and nothing came of it. There is nothing to merge, and the copy still
// has to be cleared away rather than left standing for the next one to trip over.
section('A worktree that does nothing')
if (ready) {
  const repo = freshRepo()
  const story = storyIn(repo, 'Have a think about it')
  const opened = await wt.open(live(story), db.getStory(story.id))
  const merged = await wt.merge(live(story))
  check('a merge with nothing in it is not a failure', merged.ok, true)
  check('but nothing is reported as merged', merged.merged, false)
  check('no commits behind it', merged.commits, 0)
  check('no commit message invented for it', merged.commit, null)
  check('and no claim that any hook ran', merged.hooks, false)
  check('the copy is cleared away all the same', fs.existsSync(opened.path), false)
  check('and so is the branch', git(['show-ref', '--verify', '--quiet', `refs/heads/${opened.branch}`], repo).status,
    1)
}

// ── Opening: what it refuses ─────────────────────────────────────────────────
// Every one of these leaves the repository exactly as it found it. A worktree opened over any of
// them comes back at the end carrying something nobody asked for.
section('Opening: what it refuses')
{
  check('a request that names no session is refused', (await wt.open({})).ok, false)
  check('a session that never had a story has nothing to open',
    (await wt.open({ id: 1, story_id: null })).error.includes('no longer belongs to a story'), true)
  check('and neither has one whose story has been deleted',
    (await wt.open({ id: 1, story_id: 987654 })).error.includes('no longer belongs to a story'), true)
  check('a story with no folder at all is refused by name',
    (await wt.open({ id: 1 }, { key_num: 1, title: 'nowhere', project_path: '' })).error.startsWith('That folder'),
    true)

  const plain = tmp('k0-plain-')
  check('a folder that is not a repository is refused',
    (await wt.open({ id: 1 }, { key_num: 1, title: 'nowhere', project_path: plain })).error.includes(plain), true)
}

if (ready) {
  const repo = freshRepo()
  const story = storyIn(repo, 'Add the ledger export')
  const dir = path.join(repo, '.claude', 'worktrees', `${story.key}-${wt.dirName(story.title)}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'left-behind.txt'), 'mine\n')
  const taken = await wt.open(live(story), db.getStory(story.id))
  check('a folder already standing where the copy would go is not written over', taken.ok, false)
  check('and the folder is left where it is', fs.existsSync(path.join(dir, 'left-behind.txt')), true)
  fs.rmSync(dir, { recursive: true, force: true })

  // A copy deleted from a terminal leaves its branch behind, and that branch is somebody's work.
  const again = await wt.open(live(story), db.getStory(story.id))
  check('with the folder gone it opens', again.ok, true)
  fs.rmSync(again.path, { recursive: true, force: true })
  const third = await wt.open(live(story), db.getStory(story.id))
  check('the folder being gone is not what refuses the next one', third.error.includes(again.branch), true)
  check('the branch it left behind is, rather than that be written over', third.ok, false)
}

if (ready) {
  const detached = freshRepo()
  git(['checkout', '-q', '--detach'], detached)
  const story = storyIn(detached, 'Work on nothing in particular')
  const off = await wt.open(live(story), db.getStory(story.id))
  check('a repository on no branch has nothing to branch off', off.ok, false)
  check('and says so rather than reaching for main', off.error.includes('not on a branch'), true)
}

if (ready) {
  const busy = freshRepo()
  conflictIn(busy, ['README.md'])
  const story = storyIn(busy, 'Start something new')
  const stopped = await wt.open(live(story), db.getStory(story.id))
  check('a repository stopped halfway through a merge is left alone', stopped.ok, false)
  check('and it says which operation that is', stopped.error.includes('in the middle of a merge'), true)
  git(['merge', '--abort'], busy)
}

if (ready) {
  const many = freshRepo()
  fs.writeFileSync(path.join(many, 'one.txt'), 'one\n')
  fs.writeFileSync(path.join(many, 'two.txt'), 'two\n')
  git(['add', '-A'], many)
  git(['commit', '-qm', 'chore: two files'], many)
  fs.writeFileSync(path.join(many, 'one.txt'), 'changed\n')
  fs.writeFileSync(path.join(many, 'two.txt'), 'changed\n')
  const story = storyIn(many, 'Tidy the exporter')
  const refused = await wt.open(live(story), db.getStory(story.id))
  check('uncommitted work is counted, not just noticed',
    refused.error.includes('are 2 changes not committed'), true)
}

if (ready) {
  const broken = tmp('k0-broken-')
  // A folder left behind after the repository it belonged to was deleted: it has a `.git`, and git
  // will not say a word about what is in it.
  fs.writeFileSync(path.join(broken, '.git'), 'gitdir: /nowhere-at-all\n')
  const story = storyIn(broken, 'Pick up the pieces')
  const lost = await wt.open(live(story), db.getStory(story.id))
  check('a repository git will not talk about is not guessed at', lost.ok, false)
  check('and the refusal says that is what happened', lost.error.includes('would not say what state'), true)
}

if (ready) {
  const blocked = freshRepo()
  // Nothing can be created under `.claude/worktrees/` when `.claude` is a file.
  fs.writeFileSync(path.join(blocked, '.claude'), 'not a folder\n')
  const story = storyIn(blocked, 'Try it anyway')
  const failed = await wt.open(live(story), db.getStory(story.id))
  check('git refusing to make the copy is reported as that', failed.ok, false)
  check('and what git said is kept for whoever wants to read it', failed.detail.length > 0, true)
  check('the session is not left thinking it has a copy', live(story).work_path, null)
}

if (ready) {
  const nowrite = freshRepo()
  // A stale lock is what a repository looks like after a git that was killed: the worktree can
  // still be made, but the branch cannot be told where it came from.
  fs.writeFileSync(path.join(nowrite, '.git', 'config.lock'), '')
  const story = storyIn(nowrite, 'Rename the ledger columns')
  const undone = await wt.open(live(story), db.getStory(story.id))
  fs.rmSync(path.join(nowrite, '.git', 'config.lock'), { force: true })
  const would = path.join(nowrite, '.claude', 'worktrees', `${story.key}-${wt.dirName(story.title)}`)
  check('a copy whose origin cannot be written down is not left standing', undone.ok, false)
  check('the folder was taken back out', fs.existsSync(would), false)
  check('and so was the branch',
    git(['show-ref', '--verify', '--quiet', `refs/heads/wt-${story.key}`], nowrite).status, 1)
}

if (ready) {
  const stubborn = freshRepo()
  const exclude = path.join(stubborn, '.git', 'info', 'exclude')
  fs.mkdirSync(path.dirname(exclude), { recursive: true })
  fs.writeFileSync(exclude, '# nothing here\n')
  fs.chmodSync(exclude, 0o444)
  const story = storyIn(stubborn, 'Keep going regardless')
  const opened = await wt.open(live(story), db.getStory(story.id))
  fs.chmodSync(exclude, 0o644)
  check('a repository that will not take the exclude line still gets its worktree', opened.ok, true)
  check('and the copy is there', fs.existsSync(path.join(opened.path, '.git')), true)
}

// ── Merging back: what it refuses ────────────────────────────────────────────
// The dangerous half. Everything here stops and says why, because the alternative is a merge that
// went somewhere nobody meant it to go.
section('Merging back: what it refuses')
{
  check('a request that names no session is refused', (await wt.merge({})).ok, false)
  check('a session with no worktree has nothing to merge',
    (await wt.merge({ id: 1, work_path: null })).error.includes('no worktree'), true)
  check('a copy deleted by hand reads as gone, not as empty',
    (await wt.merge({ id: 1, work_path: path.join(os.tmpdir(), 'k0-not-here') })).error.includes('not there any more'),
    true)
}

if (ready) {
  check('the repository itself is not a worktree of anything',
    (await wt.merge({ id: 1, work_path: REPO })).error.includes('not a worktree of a repository'), true)

  // A bare repository has no branch to merge into, so a worktree of one has nowhere to go home to.
  const bare = tmp('k0-bare-')
  git(['clone', '-q', '--bare', REPO, bare])
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], bare).stdout.trim()
  const out = tmp('k0-bare-wt-')
  fs.rmSync(out, { recursive: true, force: true })
  git(['worktree', 'add', '-q', out, branch], bare)
  made.push(out)
  check('and neither is a worktree of a bare repository',
    (await wt.merge({ id: 1, work_path: out })).error.includes('not a worktree of a repository'), true)
}

if (ready) {
  const repo = freshRepo()
  const story = storyIn(repo, 'Look at it from a distance')
  const opened = await wt.open(live(story), db.getStory(story.id))
  git(['checkout', '-q', '--detach'], opened.path)
  const off = await wt.merge(live(story))
  check('a copy left on no branch has nothing to merge', off.ok, false)
  check('and says that plainly', off.error.includes('is not on a branch'), true)
  git(['checkout', '-q', opened.branch], opened.path)

  conflictIn(opened.path, ['README.md'])
  const stopped = await wt.merge(live(story))
  check('a copy stopped halfway through a merge of its own is left alone', stopped.ok, false)
  check('and it says which operation that is', stopped.error.includes('in the middle of a merge'), true)
  git(['merge', '--abort'], opened.path)
}

if (ready) {
  const repo = freshRepo()
  const story = storyIn(repo, 'Forget where it came from')
  const opened = await wt.open(live(story), db.getStory(story.id))
  git(['branch', '--unset-upstream', opened.branch], repo)
  const lost = await wt.merge(live(story))
  check('a branch with no record of where it came from is not guessed at', lost.ok, false)
  check('and the user is told to do it by hand', lost.error.includes('Merge it by hand'), true)

  // An upstream on a remote is not somewhere k0 can merge to: it never goes to the network.
  git(['update-ref', 'refs/remotes/origin/elsewhere', 'HEAD'], repo)
  git(['branch', `--set-upstream-to=origin/elsewhere`, opened.branch], repo)
  const remote = await wt.merge(live(story))
  check('an upstream that is not on this machine is no better', remote.ok, false)
}

if (ready) {
  const repo = freshRepo()
  const story = storyIn(repo, 'Write something down')
  const opened = await wt.open(live(story), db.getStory(story.id))
  fs.writeFileSync(path.join(opened.path, 'note.txt'), 'something\n')
  const lock = path.join(repo, '.git', 'worktrees', path.basename(opened.path), 'index.lock')
  fs.writeFileSync(lock, '')
  const stuck = await wt.merge(live(story))
  fs.rmSync(lock, { force: true })
  check('work that cannot be staged is not committed halfway', stuck.ok, false)
  check('and the refusal says nothing was safe to commit', stuck.error.includes('nothing safe to commit'), true)
  check('the copy is still standing with the work in it',
    fs.readFileSync(path.join(opened.path, 'note.txt'), 'utf8'), 'something\n')
}

if (ready) {
  const repo = freshRepo()
  // The rule this file exists to keep: the repository's own hooks decide what may be committed,
  // and k0 never reaches for --no-verify to get past one.
  const hooks = path.join(repo, '.refusing-hooks')
  fs.mkdirSync(hooks)
  fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho "the suite failed" >&2\nexit 1\n')
  fs.chmodSync(path.join(hooks, 'pre-commit'), 0o755)
  git(['config', 'core.hooksPath', hooks], repo)
  const story = storyIn(repo, 'Break the build')
  const opened = await wt.open(live(story), db.getStory(story.id))
  fs.writeFileSync(path.join(opened.path, 'broken.txt'), 'oops\n')
  const refused = await wt.merge(live(story))
  check('a commit hook that says no stops the merge', refused.ok, false)
  check('the hook was not stepped round', refused.detail.includes('the suite failed'), true)
  check('and the user is told it ran in the copy, not in the repository', refused.hooks, true)
  check('the branch it was working on is named', refused.branch, opened.branch)
  check('the copy is still there with the work in it', fs.existsSync(path.join(opened.path, 'broken.txt')), true)
  check('and nothing reached the repository', fs.existsSync(path.join(repo, 'broken.txt')), false)
  check('the session still knows where it is working', live(story).work_path, opened.path)
}

if (ready) {
  const repo = freshRepo()
  const story = storyIn(repo, 'Stand somewhere else')
  const opened = await wt.open(live(story), db.getStory(story.id))
  fs.writeFileSync(path.join(opened.path, 'work.txt'), 'done\n')
  git(['checkout', '-q', '-b', 'elsewhere'], repo)
  const elsewhere = await wt.merge(live(story))
  check('a repository standing on another branch is not moved back for you', elsewhere.ok, false)
  check('and is told which branch this work belongs on', elsewhere.error.includes(opened.base), true)

  git(['checkout', '-q', '--detach'], repo)
  const nowhere = await wt.merge(live(story))
  check('a repository on no branch at all is refused the same way',
    nowhere.error.includes('is on no branch now'), true)
  git(['checkout', '-q', opened.base], repo)

  fs.writeFileSync(path.join(repo, 'README.md'), '# changed by hand\n')
  const messy = await wt.merge(live(story))
  check('a merge is not laid on top of uncommitted work', messy.ok, false)
  check('and the one change is counted as one', messy.error.includes('is 1 change not committed'), true)
  git(['checkout', '--', 'README.md'], repo)

  const alsoBusy = { ...live(story) }
  conflictIn(repo, ['README.md'])
  const halfway = await wt.merge(alsoBusy)
  check('a repository stopped halfway through something is finished by its owner, not by k0',
    halfway.error.includes('in the middle of a merge'), true)
  git(['merge', '--abort'], repo)
}

if (ready) {
  const repo = freshRepo()
  fs.writeFileSync(path.join(repo, 'ledger.txt'), 'one\n')
  fs.writeFileSync(path.join(repo, 'totals.txt'), 'one\n')
  git(['add', '-A'], repo)
  git(['commit', '-qm', 'chore: the ledger'], repo)
  const story = storyIn(repo, 'Rewrite the ledger')
  const opened = await wt.open(live(story), db.getStory(story.id))
  for (const f of ['ledger.txt', 'totals.txt']) fs.writeFileSync(path.join(opened.path, f), 'the session\n')
  git(['add', '-A'], opened.path)
  git(['commit', '-qm', 'feat: the session'], opened.path)
  for (const f of ['ledger.txt', 'totals.txt']) fs.writeFileSync(path.join(repo, f), 'somebody else\n')
  git(['add', '-A'], repo)
  git(['commit', '-qm', 'feat: somebody else'], repo)

  const clash = await wt.merge(live(story))
  check('a merge that conflicts stops rather than picks a side', clash.ok, false)
  check('every conflicted file is named', clash.conflicts.join(','), 'ledger.txt,totals.txt')
  check('and counted in the sentence', clash.error.includes('both changed 2 files'), true)
  check('the merge was backed out of the repository', fs.existsSync(path.join(repo, '.git', 'MERGE_HEAD')), false)
  check('what was in the repository is still what is in it',
    fs.readFileSync(path.join(repo, 'ledger.txt'), 'utf8'), 'somebody else\n')
  check('the copy is untouched', fs.readFileSync(path.join(opened.path, 'ledger.txt'), 'utf8'), 'the session\n')
  check('and the session still has it', live(story).work_path, opened.path)
}

if (ready) {
  const repo = freshRepo()
  const story = storyIn(repo, 'Fall foul of the message hook')
  const opened = await wt.open(live(story), db.getStory(story.id))
  fs.writeFileSync(path.join(opened.path, 'work.txt'), 'done\n')
  git(['add', '-A'], opened.path)
  git(['commit', '-qm', 'feat: done'], opened.path)
  // A repository that has an opinion about commit messages has one about the merge commit too,
  // and a merge stopped by a hook leaves no conflicted files to name — only a half-made merge.
  const hooks = path.join(repo, '.empty-hooks')
  fs.writeFileSync(path.join(hooks, 'commit-msg'), '#!/bin/sh\necho "that message will not do" >&2\nexit 1\n')
  fs.chmodSync(path.join(hooks, 'commit-msg'), 0o755)
  const beaten = await wt.merge(live(story))
  fs.rmSync(path.join(hooks, 'commit-msg'), { force: true })
  check('a merge the repository refuses is reported as that, not as a conflict', beaten.ok, false)
  check('with what the hook said kept underneath', beaten.detail.includes('that message will not do'), true)
  check('nothing is left half merged', fs.existsSync(path.join(repo, '.git', 'MERGE_HEAD')), false)
  check('and the copy is still standing', fs.existsSync(path.join(opened.path, 'work.txt')), true)
}

if (ready) {
  const repo = freshRepo()
  const story = storyIn(repo, 'Leave the copy locked')
  const opened = await wt.open(live(story), db.getStory(story.id))
  fs.writeFileSync(path.join(opened.path, 'work.txt'), 'done\n')
  // Plain `remove`, never `--force`: a copy git will not give up is a copy k0 does not delete.
  git(['worktree', 'lock', opened.path], repo)
  const kept = await wt.merge(live(story))
  git(['worktree', 'unlock', opened.path], repo)
  check('a copy that will not be removed does not undo the merge', kept.merged, true)
  check('but it is not reported as a clean finish either', kept.ok, false)
  check('the work did reach the repository', fs.readFileSync(path.join(repo, 'work.txt'), 'utf8'), 'done\n')
  check('and the user is told which folder to look at', kept.error.includes(opened.path), true)
}

// ── Where it is ──────────────────────────────────────────────────────────────
section('Where it is')
{
  const empty = await wt.state({ id: 1, work_path: null })
  check('has nothing to say about one', empty.exists, false)
  check('and no path either', empty.path, null)
  const gone = await wt.state({ id: 1, work_path: path.join(os.tmpdir(), 'k0-not-here') })
  check('a worktree removed by hand reads as gone, not as empty', gone.exists, false)
  check('while keeping the path it used to be at', gone.path.endsWith('k0-not-here'), true)
}

if (ready) {
  const repo = freshRepo()
  const story = storyIn(repo, 'Commit as you go')
  const opened = await wt.open(live(story), db.getStory(story.id))
  fs.writeFileSync(path.join(opened.path, 'work.txt'), 'done\n')
  git(['add', '-A'], opened.path)
  git(['commit', '-qm', 'feat: done'], opened.path)
  const seen = await wt.state(live(story))
  check('a commit made in the copy is counted as waiting to come home', seen.commits, 1)
  check('with nothing left sitting in the copy', seen.dirty, 0)
  check('and the repository it belongs to named', seen.repo, repo)

  // A repository is not a worktree of itself, so there is no branch it is waiting to go home to.
  const itself = await wt.state({ id: 1, work_path: repo })
  check('the repository looked at as a worktree belongs nowhere', itself.repo, null)
  check('so nothing is waiting to come home from it', itself.commits, 0)
  check('though it is plainly there', itself.exists, true)
}

after(() => {
  db.close()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.K0_DB + suffix, { force: true })
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true })
})
