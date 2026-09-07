import fs from 'node:fs'
import path from 'node:path'
import { run } from '../platform/shared/run.js'
// One reading of `status --porcelain=v2` for the whole server, and one place that knows where git
// is. git.js already has both, and two of either would drift until the day they disagreed and
// nobody noticed.
import { parseStatus, gitPath } from './git.js'
// A worktree directory and a `.k0/` file are named for the same story by the same rule. Two
// spellings of "the same rule" is what the comment above is about: mirror.js trims the dashes off
// before it cuts at forty characters, and a copy that cut first was already a character out.
import { slug } from './mirror.js'
import { getStory, patchSession } from './db.js'

// ── The worktree ─────────────────────────────────────────────────────────────
// A session that is going to change code can have a working copy of its own: a git worktree
// under `<repo>/.claude/worktrees/`, on a branch of its own, opened from the branch you are
// standing on right now. You keep working in the repository; the session works next door; at the
// end its branch comes back in as one merge commit and the copy is destroyed.
//
// Three things this module will never do, each of which has already cost somebody a day:
//
// It never pushes, and never opens a pull request. The merge stops on this machine. Publishing
// is a decision you make when you are ready to make it, and a button that quietly made it for
// you would be the last time you trusted the button.
//
// It never runs tests, a build, or a dev server — not here, not as a favour on the way past. A
// worktree copies the code but not the untracked files around it, so the `.env` somebody copies
// across to make it run carries the BASE repository's port. A test runner that finds a server
// already listening there uses it, goes green, and reports that your new code passes when what
// it really tested was the old checkout. That is a silent false pass, which is why this is a
// rule and not a preference: tests run on the base branch, after the merge, where the server
// serves the code you just wrote.
//
// That rule is about what THIS module runs, and it has one edge worth being straight about,
// because the two rules of this file meet there and cannot both be comfortable. Merging commits
// whatever the session left pending, a commit runs the repository's own hooks, and a `pre-commit`
// hook that runs the whole suite is normal in the repositories k0 is used on — so on the ordinary
// merge path a test suite does run inside the copy, with the wrong `.env` next to it. Stepping
// round it with `--no-verify` is not the answer: the hooks are the repository's own opinion of
// what may be committed, and a commit that only went through because k0 avoided them has not been
// checked at all. So the hook runs, and the answer here is to say so rather than to be quiet
// about it: `merge` reports `hooks: true` whenever it made a commit, and whoever shows the result
// tells the user their pre-commit hook ran next door.
//
// It never resolves a conflict. There is no way for a program to tell a conflict it has resolved
// correctly from one it has resolved plausibly, and taking one side to make the command succeed
// throws away work that somebody typed. A conflict stops everything and says which files.

// Reading something git already knows: a status, a branch name, a count.
const OPTS = { timeout: 10000, maxBuffer: 1 << 20 }
// Moving files about: `worktree add`, `merge`, `worktree remove`. Slower, and worth waiting for.
const MOVE = { timeout: 120000, maxBuffer: 1 << 22 }
// A commit runs the repository's own hooks, and a pre-commit hook that runs the whole test suite
// is normal in the repositories k0 is used on. Cutting that off after a few seconds would leave a
// half-made commit and make it look like git's fault.
const COMMIT = { timeout: 15 * 60 * 1000, maxBuffer: 1 << 24 }

const git = (args, opts = OPTS) => run(gitPath(), args, opts)

const MAX_SUBJECT = 72
const MAX_DETAIL = 2000

// ── Failures ─────────────────────────────────────────────────────────────────
// Everything here answers with a sentence, never with git's own words alone. `fatal: 'wt-K42' is
// already checked out at …` tells you nothing about what k0 was trying to do or what to do next.
// What git said is kept, in `detail`, for the person who does want to read it.

function fail(error, detail = '') {
  return { ok: false, error, detail: String(detail).trim().slice(-MAX_DETAIL) }
}

/** What git actually said, out of a rejected child process. */
function words(err) {
  const said = `${err?.stderr ?? ''}\n${err?.stdout ?? ''}`.trim()
  if (said) return said.split('\n').filter(Boolean).slice(-12).join('\n')
  // execFile puts the whole command line in `message`, which is noise here: the caller already
  // knows what was being run, and the paths in it are long enough to hide the reason.
  return err?.code === 'ETIMEDOUT' ? 'git took too long and was given up on.' : String(err?.message ?? '')
}

// ── Names ────────────────────────────────────────────────────────────────────

/**
 * The title, made safe for a directory name — the rule mirror.js names `.k0/` files by, and the
 * same call, not the same idea written out twice. A title with nothing alphanumeric in it slugs to
 * nothing, and a directory has to be called something.
 */
export const dirName = (title) => slug(title) || 'story'

// ── Looking around ───────────────────────────────────────────────────────────

/**
 * The branch and how much is pending, in one process.
 *
 * `--untracked-files=no` is the interesting half. A worktree lives INSIDE the repository, so
 * counting untracked files would count the worktree itself, and every check here would refuse
 * for a directory k0 made. Untracked files are also the ones a merge cannot destroy. So safety
 * is judged on tracked changes; only "is there anything to commit in here" asks for `all`.
 */
async function statusOf(dir, untracked = 'no') {
  const out = await git([
    '--no-optional-locks',
    '-C',
    dir,
    'status',
    '--porcelain=v2',
    '--branch',
    `--untracked-files=${untracked}`,
  ])
  return parseStatus(out)
}

// A repository stopped halfway through something. Merging into it, or committing out of it,
// would finish somebody else's operation for them with the wrong content.
const HALFWAY = [
  ['MERGE_HEAD', 'a merge'],
  ['CHERRY_PICK_HEAD', 'a cherry-pick'],
  ['REVERT_HEAD', 'a revert'],
  ['rebase-merge', 'a rebase'],
  ['rebase-apply', 'a rebase'],
  ['BISECT_LOG', 'a bisect'],
]

/** The operation this directory is in the middle of, or null when it is idle. */
async function halfway(dir) {
  const where = await git(['-C', dir, 'rev-parse', '--git-dir'])
    .then((out) => path.resolve(dir, out.trim()))
    .catch(() => null)
  if (!where) return null
  for (const [marker, name] of HALFWAY) if (fs.existsSync(path.join(where, marker))) return name
  return null
}

/**
 * The repository a worktree belongs to. `--git-common-dir` is the shared `.git` of the whole
 * repository, which is the only thing that points home: the worktree's own `.git` is a file
 * holding a path, and its `project_path` on the story could have been renamed since.
 */
async function repoOf(worktree) {
  const [own, common] = await Promise.all([
    git(['-C', worktree, 'rev-parse', '--git-dir']).then((o) => path.resolve(worktree, o.trim())),
    git(['-C', worktree, 'rev-parse', '--git-common-dir']).then((o) => path.resolve(worktree, o.trim())),
  ]).catch(() => [null, null])
  if (!own || !common) return null
  if (own === common) return null // the repository itself, not a worktree of it
  if (path.basename(common) !== '.git') return null // a bare repository has no branch to merge into
  return path.dirname(common)
}

/**
 * Which branch a worktree branch came from.
 *
 * It is remembered as the branch's upstream, and that is not a trick: git already has one field
 * per branch for "where this belongs", it dies with the branch, and `git status` inside the
 * worktree reads it out loud — *ahead of 'feat/backlog' by 3 commits*. A note in a file of our
 * own would survive the branch it describes and be wrong the second time.
 */
async function baseOf(repo, branch) {
  const name = await git(['-C', repo, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{upstream}`])
    .then((out) => out.trim())
    .catch(() => '')
  if (!name) return null
  // It has to be a branch on this machine. An upstream on a remote would mean merging something
  // that is not here, and k0 does not go to the network for anything.
  const local = await git(['-C', repo, 'show-ref', '--verify', '--quiet', `refs/heads/${name}`]).then(
    () => true,
    () => false
  )
  return local ? name : null
}

/** How many commits the worktree has that its base branch has not. */
async function ahead(repo, base, branch) {
  const out = await git(['-C', repo, 'rev-list', '--count', `${base}..${branch}`]).catch(() => '0')
  return Number(out.trim()) || 0
}

const branchExists = (repo, branch) =>
  git(['-C', repo, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).then(
    () => true,
    () => false
  )

/**
 * Keep the worktrees folder out of the user's way.
 *
 * The worktree sits inside the repository, so without this every `git status` the user runs
 * grows an untracked directory they never made, and the board's own dirty count grows with it.
 * The line goes in `.git/info/exclude` and never in `.gitignore`: `.gitignore` is committed and
 * shared with the user's colleagues, and k0's private working copies are none of their business.
 */
async function keepOutOfSight(repo, dir) {
  // `check-ignore` exits 1 when the path is not ignored, which arrives here as a rejection.
  const already = await git(['-C', repo, 'check-ignore', '-q', dir]).then(
    () => true,
    () => false
  )
  if (already) return
  try {
    const common = await git(['-C', repo, 'rev-parse', '--git-common-dir']).then((o) => path.resolve(repo, o.trim()))
    const file = path.join(common, 'info', 'exclude')
    const line = '/.claude/worktrees/'
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    if (text.split('\n').some((l) => l.trim() === line)) return
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const gap = text && !text.endsWith('\n') ? '\n' : ''
    fs.appendFileSync(file, `${gap}# k0 keeps a session's working copy here.\n${line}\n`)
  } catch {
    // A repository that will not take the line still works; the folder just shows up as
    // untracked. Not worth refusing to open a worktree over.
  }
}

// ── Opening ──────────────────────────────────────────────────────────────────

/**
 * A working copy for this session, on a branch of its own.
 *
 * From the branch you are on, deliberately — not `main`, not `origin/main`. Work started on a
 * feature branch belongs on that feature branch, and a worktree that quietly branched off main
 * would come back at the end carrying every difference between the two.
 *
 * @param {object} session  the `session` row: `id`, `story_id`, `work_path`
 * @param {object} [story]  its story, when the caller already has it
 */
export async function open(session, story = null) {
  if (!gitPath()) return fail('k0 cannot find git on this machine, so it cannot open a worktree.')
  if (!session?.id) return fail('A worktree belongs to a session, and this request does not name one.')

  const s = story ?? (session.story_id ? getStory(session.story_id) : null)
  if (!s) return fail('That session no longer belongs to a story, so there is nothing to open a worktree for.')

  const repo = s.project_path
  if (!repo || !fs.existsSync(path.join(repo, '.git'))) {
    return fail(`${repo || 'That folder'} is not a git repository, so k0 cannot open a worktree in it.`)
  }
  if (session.work_path && fs.existsSync(session.work_path)) {
    return fail(`This session is already working in ${session.work_path}. Merge that back before opening another.`)
  }

  const key = `K${s.key_num}`
  const dir = path.join(repo, '.claude', 'worktrees', `${key}-${dirName(s.title)}`)
  const branch = `wt-${key}`
  if (fs.existsSync(dir)) {
    return fail(`There is already a folder at ${dir}. Move it out of the way, or remove it, and ask again.`)
  }
  if (await branchExists(repo, branch)) {
    return fail(`The branch ${branch} is still here from an earlier worktree for ${key}. Merge it or delete it first.`)
  }

  const here = await statusOf(repo).catch(() => null)
  if (!here) return fail(`git would not say what state ${repo} is in, so k0 stopped rather than guess.`)
  if (!here.branch) {
    return fail(`${repo} is not on a branch right now, so there is nothing for the worktree to branch off.`)
  }
  const busy = await halfway(repo)
  if (busy) {
    return fail(`${repo} is in the middle of ${busy}. Finish that first: a worktree opened now would inherit it.`)
  }
  if (here.dirty) {
    return fail(
      `There ${here.dirty === 1 ? 'is 1 change' : `are ${here.dirty} changes`} not committed in ${repo}. ` +
        'The worktree would start from the last commit and not see them, and they would be in the way of the ' +
        'merge at the end. Commit or stash them first.'
    )
  }

  const base = here.branch
  try {
    await git(['-C', repo, 'worktree', 'add', '-b', branch, dir, base], MOVE)
  } catch (err) {
    return fail(`git would not open a worktree at ${dir}.`, words(err))
  }

  // Where it came from, written down before anything else can happen to it. Without this the
  // merge at the end has nowhere to go, so a worktree that cannot record it is not left standing.
  try {
    await git(['-C', repo, 'branch', `--set-upstream-to=${base}`, branch])
  } catch (err) {
    await git(['-C', repo, 'worktree', 'remove', '--force', dir], MOVE).catch(() => {})
    await git(['-C', repo, 'branch', '-D', branch]).catch(() => {})
    return fail(
      `k0 could not record that ${branch} came from ${base}, so it undid the worktree rather than leave one ` +
        'it would not know how to merge back.',
      words(err)
    )
  }

  await keepOutOfSight(repo, dir)
  patchSession(session.id, { work_path: dir })
  return { ok: true, path: dir, branch, base, repo }
}

// ── The commit message ───────────────────────────────────────────────────────

/**
 * The files in the staged diff, out of `--name-status -z`.
 *
 * `-z` because git quotes and escapes paths that are not plain ASCII otherwise, and a rename
 * carries two paths where everything else carries one.
 */
export function parseNameStatus(out) {
  const parts = String(out ?? '').split('\0')
  const files = []
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i]
    if (!code) continue
    const letter = code[0]
    const renamed = letter === 'R' || letter === 'C'
    const p = parts[i + (renamed ? 2 : 1)]
    if (p) files.push({ status: letter, path: p })
    i += renamed ? 2 : 1
  }
  return files
}

const DOC = /\.(md|mdx|txt|adoc)$/i
const CHORE = /^(\.claude|\.github|\.vscode|\.editorconfig|\.gitignore|package(-lock)?\.json)/
const VERB = { A: 'add', D: 'remove', R: 'rename', C: 'copy' }

/**
 * Which Conventional Commits type this diff is.
 *
 * A guess, and it says so: only the person who wrote the code knows whether it fixed anything.
 * But the alternative is a commit with no type at all, and the shape of the diff is right often
 * enough — documentation is documentation, a new file is usually a feature — that the guess is
 * worth making. Nobody should be blocked from committing over a word.
 */
function commitType(files) {
  const paths = files.map((f) => f.path)
  if (!paths.length) return 'chore'
  if (paths.every((p) => DOC.test(p) || p.startsWith('docs/'))) return 'docs'
  if (paths.every((p) => p.startsWith('test/') || p.includes('.test.'))) return 'test'
  if (paths.every((p) => CHORE.test(p))) return 'chore'
  if (files.some((f) => f.status === 'A')) return 'feat'
  return 'fix'
}

/** The longest directory every one of these paths is under, with its trailing slash. */
function commonDir(paths) {
  const first = paths[0].split('/').slice(0, -1)
  let n = first.length
  for (const p of paths) {
    const parts = p.split('/').slice(0, -1)
    let i = 0
    while (i < n && i < parts.length && parts[i] === first[i]) i++
    n = i
  }
  return n ? `${first.slice(0, n).join('/')}/` : ''
}

/** What moved, when there is nothing better to say than what moved. */
function describe(files) {
  if (!files.length) return 'save the work in progress'
  if (files.length <= 3) return files.map((f) => `${VERB[f.status] ?? 'update'} ${f.path}`).join(', ')
  const dir = commonDir(files.map((f) => f.path))
  return dir ? `update ${files.length} files under ${dir}` : `update ${files.length} files`
}

/** A title as the first words of a sentence: no full stop, and not shouting unless it means to. */
function subjectOf(story) {
  const t = String(story?.title ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/, '')
  if (!t) return ''
  // `API` and `k0` are written the way they are on purpose; `Fix the parser` is just a heading.
  return /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t
}

function cut(text, n) {
  if (text.length <= n) return text
  const space = text.lastIndexOf(' ', n)
  return text.slice(0, space > 20 ? space : n).trim()
}

/**
 * One line, imperative, English — the message for whatever the session left uncommitted.
 *
 * The diff decides the type. The subject is the story's title, when there is a story: a list of
 * paths says what moved, not what changed, and `git log` is read by people. The title is the one
 * sentence in the whole database that a person wrote about this piece of work. Without a story
 * the diff has to speak for itself.
 */
export function commitMessage(files, story = null) {
  const type = commitType(files)
  const subject = subjectOf(story) || describe(files)
  return `${type}: ${cut(subject, MAX_SUBJECT - type.length - 2)}`
}

// ── Merging back ─────────────────────────────────────────────────────────────

/**
 * Commit whatever is pending in the worktree, merge the branch into the one it came from, and
 * destroy the copy. Local, always: no push, no pull request, no remote of any kind.
 *
 * @param {object} session  the `session` row, carrying `work_path`
 */
export async function merge(session) {
  if (!gitPath()) return fail('k0 cannot find git on this machine, so it cannot merge this worktree back.')
  if (!session?.id) return fail('A worktree belongs to a session, and this request does not name one.')
  const dir = session.work_path
  if (!dir) return fail('This session has no worktree, so there is nothing to merge back.')
  if (!fs.existsSync(path.join(dir, '.git'))) {
    return fail(`The worktree at ${dir} is not there any more, so there is nothing left to merge.`)
  }

  const repo = await repoOf(dir)
  if (!repo) return fail(`${dir} is not a worktree of a repository k0 can merge into, so it stopped.`)

  const here = await statusOf(dir, 'all').catch(() => null)
  if (!here) return fail(`git would not say what is in ${dir}, so k0 stopped rather than guess.`)
  if (!here.branch) return fail(`The worktree at ${dir} is not on a branch, so there is nothing to merge.`)
  const branch = here.branch
  const busy = await halfway(dir)
  if (busy) return fail(`The worktree is in the middle of ${busy}. Finish that inside it, then merge.`)

  const base = await baseOf(repo, branch)
  if (!base) {
    return fail(
      `k0 cannot tell which branch ${branch} came from, so it will not guess where to merge it. ` +
        'Merge it by hand, or delete it if the work is gone.'
    )
  }

  const story = session.story_id ? getStory(session.story_id) : null
  let message = null
  // Whether a commit was made in the copy, which is the same question as whether the repository's
  // hooks ran in the copy. See the header: the module does not run the suite, but a `pre-commit`
  // hook does, and the caller is told rather than left to wonder why the merge took four minutes.
  let hooks = false
  if (here.dirty) {
    try {
      await git(['-C', dir, 'add', '-A'], MOVE)
    } catch (err) {
      return fail(`Nothing in ${dir} could be staged, so there is nothing safe to commit.`, words(err))
    }
    const staged = await git(['-C', dir, 'diff', '--cached', '--name-status', '-z'], MOVE).catch(() => '')
    const files = parseNameStatus(staged)
    if (files.length) {
      message = commitMessage(files, story)
      hooks = true
      try {
        // No `--no-verify`, ever. The hooks are the repository's own opinion of what may be
        // committed, and a session that only passes because k0 stepped round them has not passed.
        // This is the line the header's third rule brushes against: the hook runs here, in the
        // copy, with the copied `.env` beside it. It is the repository's hook and its decision.
        await git(['-C', dir, 'commit', '-m', message], COMMIT)
      } catch (err) {
        return {
          ...fail(
            `The commit in ${dir} was refused, so the merge did not happen and nothing was lost. ` +
              'A commit hook usually says why below — and it ran inside the worktree, not in the ' +
              'repository, so a test it ran there tested the copy.',
            words(err)
          ),
          hooks,
          branch,
          base,
          path: dir,
        }
      }
    }
  }

  const commits = await ahead(repo, base, branch)

  const there = await statusOf(repo).catch(() => null)
  if (!there) return fail(`git would not say what state ${repo} is in, so k0 stopped rather than merge blind.`)
  if (there.branch !== base) {
    return fail(
      `${repo} is on ${there.branch ?? 'no branch'} now, and this work belongs on ${base}. ` +
        `Go back to ${base} and ask again — k0 does not change the branch you are standing on.`
    )
  }
  const alsoBusy = await halfway(repo)
  if (alsoBusy) return fail(`${repo} is in the middle of ${alsoBusy}. Finish that first, then merge.`)
  if (there.dirty) {
    return fail(
      `There ${there.dirty === 1 ? 'is 1 change' : `are ${there.dirty} changes`} not committed in ${repo}. ` +
        'A merge on top of them either refuses halfway or buries them. Commit or stash them first.'
    )
  }

  if (commits) {
    try {
      // `--no-ff` so the session stays one shape in the history: a merge commit naming the
      // branch, with its own commits underneath. `--no-edit` because nothing here can open an
      // editor and wait for somebody.
      await git(['-C', repo, 'merge', '--no-ff', '--no-edit', branch], MOVE)
    } catch (err) {
      // Read the conflicted files BEFORE backing out: the abort is what makes them disappear.
      const conflicts = await git(['-C', repo, 'diff', '--name-only', '--diff-filter=U'])
        .then((out) => out.split('\n').filter(Boolean))
        .catch(() => [])
      await git(['-C', repo, 'merge', '--abort'], MOVE).catch(() => {})
      if (conflicts.length) {
        return {
          ...fail(
            `${branch} and ${base} both changed ${conflicts.length === 1 ? 'a file' : `${conflicts.length} files`}, ` +
              'and k0 will not pick a side. The merge was backed out and everything is still where it was: ' +
              `the worktree at ${dir} is untouched. Merge it by hand.`
          ),
          conflicts,
          branch,
          base,
          path: dir,
        }
      }
      return fail(`The merge of ${branch} into ${base} would not go through, so it was backed out.`, words(err))
    }
  }

  // Plain `remove`, never `--force`: git refuses when there is anything in there it does not
  // know about, and a file k0 did not put there is a file k0 does not get to delete.
  try {
    await git(['-C', repo, 'worktree', 'remove', dir], MOVE)
  } catch (err) {
    return {
      ...fail(
        `The work is on ${base} — that part went through — but the copy at ${dir} could not be removed. ` +
          'There is probably something in it git does not know about. Remove it by hand when you have looked.',
        words(err)
      ),
      merged: true,
      commits,
      commit: message,
      branch,
      base,
      path: dir,
    }
  }

  // `-d`, not `-D`: it refuses to delete a branch whose commits are not merged anywhere, which
  // is the last check that the merge above really did what it said.
  const kept = await git(['-C', repo, 'branch', '-d', branch]).then(
    () => null,
    (err) => words(err)
  )
  await git(['-C', repo, 'worktree', 'prune']).catch(() => {})
  patchSession(session.id, { work_path: null })

  return {
    ok: true,
    merged: commits > 0,
    commits,
    commit: message,
    hooks,
    branch,
    base,
    path: dir,
    repo,
    note: kept ? `The worktree is gone, but the branch ${branch} is still here and had to be left alone.` : null,
  }
}

// ── Where it is ──────────────────────────────────────────────────────────────

/**
 * What this session's worktree is, right now: where it is, what is sitting in it, and whether it
 * is still on disk at all. A worktree removed by hand from a terminal has to read as gone rather
 * than as empty, or the board would offer to merge something that is not there.
 */
export async function state(session) {
  const dir = session?.work_path || null
  const empty = { path: null, repo: null, exists: false, branch: null, base: null, dirty: 0, commits: 0, error: null }
  if (!dir) return empty
  if (!gitPath()) return { ...empty, path: dir, error: 'k0 cannot find git on this machine, so it cannot look inside.' }
  if (!fs.existsSync(path.join(dir, '.git'))) return { ...empty, path: dir }

  const here = await statusOf(dir, 'all').catch(() => null)
  if (!here) return { ...empty, path: dir, exists: true, error: `git would not say what is in ${dir}.` }

  const repo = await repoOf(dir)
  const base = repo && here.branch ? await baseOf(repo, here.branch) : null
  return {
    path: dir,
    repo,
    exists: true,
    branch: here.branch,
    base,
    dirty: here.dirty,
    commits: repo && base && here.branch ? await ahead(repo, base, here.branch) : 0,
    error: null,
  }
}
