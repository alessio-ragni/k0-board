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

// ── A worktree, opened and merged back ───────────────────────────────────────
section('A worktree, opened and merged back')

const git = (args, cwd) =>
  spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } })

const REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'k0-wt-')))
const BARE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'k0-remote-')))
made.push(REPO, BARE)

const ready = git(['init', '-q', REPO]).status === 0 && git(['init', '-q', '--bare', BARE]).status === 0

if (ready) {
  git(['config', 'user.email', 'test@example.invalid'], REPO)
  git(['config', 'user.name', 'k0 test'], REPO)
  git(['config', 'commit.gpgsign', 'false'], REPO)
  // A hook belonging to whoever is running this must not decide whether the test passes.
  const HOOKS = path.join(REPO, '.empty-hooks')
  fs.mkdirSync(HOOKS)
  git(['config', 'core.hooksPath', HOOKS], REPO)
  fs.writeFileSync(path.join(REPO, 'README.md'), '# start\n')
  git(['add', '-A'], REPO)
  git(['commit', '-qm', 'chore: start'], REPO)
  git(['remote', 'add', 'origin', BARE], REPO)
  const base = git(['rev-parse', '--abbrev-ref', 'HEAD'], REPO).stdout.trim()

  const story = db.createStory({ project_path: REPO, title: 'Fix the invoicing API' })
  db.attachSession(story.id, 'session-one')
  let session = db.currentSession(story.id)

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

  session = db.currentSession(story.id)
  const twice = await wt.open(session, db.getStory(story.id))
  check('a second worktree for the same session is refused', twice.ok, false)
  check('and says where the first one is', twice.error.includes(opened.path), true)

  fs.writeFileSync(path.join(opened.path, 'answer.txt'), '42\n')

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
  check('and it says how much of it there is', dirty.error.includes('not committed'), true)
  git(['checkout', '--', 'README.md'], REPO)
}

// ── A session with no worktree ───────────────────────────────────────────────
section('A session with no worktree')
{
  const empty = await wt.state({ id: 1, work_path: null })
  check('has nothing to say about one', empty.exists, false)
  check('and no path either', empty.path, null)
  const gone = await wt.state({ id: 1, work_path: path.join(os.tmpdir(), 'k0-not-here') })
  check('a worktree removed by hand reads as gone, not as empty', gone.exists, false)
  check('while keeping the path it used to be at', gone.path.endsWith('k0-not-here'), true)
}

after(() => {
  db.close()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.K0_DB + suffix, { force: true })
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true })
})
