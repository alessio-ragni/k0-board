import { check, section, after } from './harness.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

// ── What you have been doing ─────────────────────────────────────────────────
// The ChangeLog page is mostly arithmetic over things git and the board already know, and the
// arithmetic is where it can quietly go wrong: a window off by an hour, a repository that has
// been dirty since March turning up every morning as if it were news.
//
// So everything decided here is decided by a pure function, and every one of them is below.
// Nothing in this file reads the clock, launches git or opens the real board: the same input
// gives the same answer whenever it happens to run.

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-changelog-'))
process.env.HOME = HOME
process.env.USERPROFILE = HOME
process.env.K0_DB = path.join(HOME, 'board.db')

const { windowFor, lastActiveDay, unreleasedSection, isActive, narrow, totals, facts, PERIODS } = await import(
  '../server/changelog.js'
)
const { parseLog, stripTrailers } = await import('../server/git.js')
const db = await import('../server/db.js')

const DAY = 24 * 60 * 60 * 1000
// A Wednesday afternoon. Every "now" below is this one, so "today" never moves under the test.
const NOW = new Date(2026, 7, 26, 15, 30, 0).getTime()
const TODAY = new Date(2026, 7, 26, 0, 0, 0).getTime()

const span = (w) => `${(w.from - TODAY) / DAY} ${(w.to - TODAY) / DAY}`

// ── The four windows ─────────────────────────────────────────────────────────
// Days are counted from midnight where the person is, not from midnight where the server
// thinks it is: a summary of "yesterday" that starts at 2am is a summary of the wrong day.
section('The four windows')
{
  check('today runs from this midnight to the next', span(windowFor('today', NOW)), '0 1')
  check('yesterday is the day before, and stops at midnight', span(windowFor('yesterday', NOW)), '-1 0')
  check('a week is seven days ending with today', span(windowFor('week', NOW)), '-6 1')
  check('a month is thirty days ending with today', span(windowFor('month', NOW)), '-29 1')
  check('the opening view is not one of them', windowFor('last', NOW), null)
  check('and neither is anything made up', windowFor('nonsense', NOW), null)
  check('the four are the four', PERIODS.join(' '), 'today yesterday week month')
}

// ── The last day that had anything in it ─────────────────────────────────────
// The page opens on the last day you actually worked, not on yesterday. On a Monday yesterday
// is Sunday, and a page that comes up empty after every weekend is a page you stop opening.
section('The last day that had anything in it')
{
  const friday = TODAY - 5 * DAY
  check('a quiet weekend still shows you friday', lastActiveDay([friday + 9 * 3600e3, friday + 60e3], NOW), friday)
  check('the newest one wins', lastActiveDay([TODAY - 3 * DAY, TODAY - DAY, TODAY - 9 * DAY], NOW), TODAY - DAY)
  check('a whole day is one day, however many things are in it', lastActiveDay([TODAY + 60e3, TODAY + 3600e3], NOW), TODAY)
  check('nothing at all has no answer', lastActiveDay([], NOW), null)
  // A file dated in the future — a clock put back, a copy off another machine — must not drag
  // the page to a day that has not happened.
  check('tomorrow is not the last day you worked', lastActiveDay([NOW + 5 * DAY], NOW), null)
  check('rubbish is skipped rather than believed', lastActiveDay([NaN, undefined, TODAY - DAY], NOW), TODAY - DAY)
}

// ── Written down, not released ───────────────────────────────────────────────
section('Written down, not released')
{
  const md = ['# Changelog', '', '## [Unreleased]', '### Fixed', '- the board stays pinned', '', '## [0.1.2] - 2026-08-01', '- old news'].join('\n')
  check('only what is above the last numbered version', (unreleasedSection(md) || []).join(' | '), '### Fixed | - the board stays pinned')
  check('a changelog with nothing waiting says nothing', unreleasedSection('# Changelog\n\n## [0.1.2]\n- old news'), null)
  check('an empty section is the same as no section', unreleasedSection('## [Unreleased]\n\n## [0.1.2]\n- old'), null)
  check('a file that is not a changelog at all', unreleasedSection('just some notes'), null)
  check('nothing to read is not an error', unreleasedSection(''), null)
  check('the heading may be written without brackets', (unreleasedSection('## Unreleased\n- a line') || []).join(''), '- a line')
}

// ── Which repositories are worth mentioning ──────────────────────────────────
// The rule the whole page rests on. A repository that has been dirty since March and that you
// have not opened since is not news, and a summary that repeats it every morning is a summary
// nobody reads by Thursday.
section('Which repositories are worth mentioning')

const repo = (name, { commits = [], dirty = [], cards = [] } = {}) => ({
  name,
  path: `/repo/${name}`,
  remote: true,
  unpushedTotal: commits.filter((c) => c.online === false).length,
  commits,
  dirty,
  dirtyTotal: dirty.length,
  unreleased: null,
  cards,
})
const commit = (subject, at, online = true) => ({ sha: 'abc1234', at: new Date(at).toISOString(), subject, body: '', online })
const names = (list) => list.map((r) => r.name).join(' ')

{
  check('a commit is enough', isActive(repo('a', { commits: [commit('x', NOW)] })), true)
  check('so is a file you saved', isActive(repo('b', { dirty: [{ path: 'x.js', at: NOW }] })), true)
  check('so is a card that moved', isActive(repo('c', { cards: [{ title: 'x', touched: NOW, done: false }] })), true)
  check('an untouched repository is not news', isActive(repo('d')), false)
}

// ── Narrowing to the day ─────────────────────────────────────────────────────
section('Narrowing to the day')
{
  const stale = repo('stale', { dirty: [{ path: 'left.js', at: TODAY - 200 * DAY }] })
  const today = repo('today', {
    commits: [commit('done today', TODAY + 3600e3), commit('done last week', TODAY - 6 * DAY)],
    dirty: [{ path: 'now.js', at: TODAY + 7200e3 }],
  })
  const kept = narrow([stale, today], TODAY, TODAY + DAY)
  check('the repository dirty since March stays out', names(kept), 'today')
  check('and only what happened that day comes with it', kept[0].commits.length, 1)
  check('the file saved today is kept', kept[0].dirty.length, 1)
  // The count of what is outstanding is NOT narrowed: a commit made on Tuesday and still
  // sitting here on Friday is exactly the thing you opened the page to be reminded of.
  check('what is still not pushed is counted whenever it happened', kept[0].unpushedTotal, 0)
  check('a window with nothing in it keeps nothing', narrow([stale, today], TODAY - 3 * DAY, TODAY - 2 * DAY).length, 0)
}

// ── The arithmetic ───────────────────────────────────────────────────────────
section('The arithmetic')
{
  const repos = [
    repo('one', {
      commits: [commit('out', NOW), commit('out too', NOW), commit('still here', NOW, false)],
      cards: [{ title: 'a', touched: NOW, done: true }, { title: 'b', touched: NOW, done: false }],
    }),
    repo('two', { dirty: [{ path: 'a.js', at: NOW }, { path: 'b.js', at: NOW }] }),
  ]
  const t = totals(repos)
  check('the repositories are counted', t.repositories, 2)
  check('the commits are counted', t.commits, 3)
  check('what got out is counted', t.online, 2)
  check('what did not is counted apart', t.local, 1)
  check('the files left hanging are counted', t.dirty, 2)
  check('a card that is finished is not a card still open', `${t.cardsDone} ${t.cardsOpen}`, '1 1')
  // A repository with no remote cannot have anything "waiting to be pushed": there is nowhere
  // for it to go. Counting it as outstanding would turn every local experiment into a chore.
  const nowhere = { ...repo('nowhere', { commits: [{ ...commit('local only', NOW), online: null }] }), remote: false }
  check('with no remote nothing is waiting to go out', `${totals([nowhere]).online} ${totals([nowhere]).local}`, '0 0')
}

// ── The commits, as git prints them ──────────────────────────────────────────
// One record per commit, fields separated by characters a commit message cannot contain. The
// point of that choice is the awkward message, so that is what is tested.
section('The commits, as git prints them')
{
  const F = '\x1f'
  const R = '\x1e'
  const out = [
    `a1b2c3d${F}2026-08-25T10:00:00+02:00${F}fix: the board stays pinned${F}${R}`,
    `e4f5a6b${F}2026-08-25T09:00:00+02:00${F}feat: a "quoted" subject, with a comma${F}And a body.${R}`,
  ].join('\n')
  const commits = parseLog(out)
  check('every commit comes back', commits.length, 2)
  check('the subject is whole', commits[0].subject, 'fix: the board stays pinned')
  check('an empty body is empty, not missing', commits[0].body, '')
  check('quotes and commas survive', commits[1].subject, 'feat: a "quoted" subject, with a comma')
  check('the body comes back too', commits[1].body, 'And a body.')
  check('a repository with no commits gives no commits', parseLog('').length, 0)
  check('and neither does one that failed', parseLog(null).length, 0)

  // On a machine where commits are written with help, there is a signature at the foot of
  // nearly every one of them. Left in, they would be most of what the summary is written from.
  const signed = `f00d${F}2026-08-25T10:00:00+02:00${F}fix: something${F}Why it was done.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_abc${R}`
  check('the signature at the foot is not part of the story', parseLog(signed)[0].body, 'Why it was done.')
  check('a commit that is only a signature has no body left', stripTrailers('Signed-off-by: Someone <a@b.c>'), '')
  check('a body that is all story is left alone', stripTrailers('One line.\nAnd another.'), 'One line.\nAnd another.')
  check('nothing to strip is not an error', stripTrailers(null), '')
}

// ── The cards that moved ─────────────────────────────────────────────────────
// `session_event` has been keeping this diary since the beginning; this is the first thing that
// ever read it as a history rather than as "how old is this status".
section('The cards that moved')
{
  const card = db.createCard({ title: 'Yesterday', project_path: '/repo/one' })
  const other = db.createCard({ title: 'Untouched', project_path: '/repo/two' })
  const now = Date.now()
  db.default.prepare('UPDATE session_event SET at = ? WHERE card_id = ?').run(now - 36 * 3600e3, card.id)
  db.default.prepare('UPDATE session_event SET at = ? WHERE card_id = ?').run(now - 400 * 24 * 3600e3, other.id)

  const moved = db.eventsBetween(now - 2 * DAY, now)
  check('the card that moved in the window is there', moved.map((c) => c.title).join(' '), 'Yesterday')
  check('the one that moved a year ago is not', moved.length, 1)
  check('it says which repository it belongs to', moved[0].project_path, '/repo/one')
  check('a window with nothing in it is empty, not an error', db.eventsBetween(now - 60e3, now).length, 0)
}

// ── Two real repositories on disk ────────────────────────────────────────────
// Everything above is arithmetic on made-up numbers. This is the other half: two repositories
// built for real under the fake home, with real commits made by real git, put through the same
// code the page calls. It is what proves the two promises the whole feature rests on — that a
// repository shared with somebody else still tells you about YOUR day, and that one you have
// not touched stays out of the way — and neither of those can be proved with a fixture.
section('Two real repositories on disk')

const MINE = 'mine@example.test'
const THEIRS = 'theirs@example.test'

/** A repository with one commit of mine, one of somebody else's, and a file left hanging. */
function build(name, when) {
  const dir = path.join(HOME, name)
  fs.mkdirSync(dir)
  const git = (args, who = MINE) =>
    execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Somebody',
        GIT_AUTHOR_EMAIL: who,
        GIT_COMMITTER_NAME: 'Somebody',
        GIT_COMMITTER_EMAIL: who,
        GIT_AUTHOR_DATE: when,
        GIT_COMMITTER_DATE: when,
      },
    })

  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.email', MINE])
  git(['config', 'user.name', 'Somebody'])
  git(['config', 'commit.gpgsign', 'false'])

  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n- the zoom lands on 90%\n')
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'fix: the zoom lands on ninety per cent'])

  fs.writeFileSync(path.join(dir, 'b.txt'), 'two\n')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'chore: something a colleague did'], THEIRS)

  fs.writeFileSync(path.join(dir, 'hanging.txt'), 'never committed\n')
  return dir
}

let repos = null
try {
  execFileSync('git', ['--version'], { encoding: 'utf8' })
  build('fresh', new Date().toISOString())
  const old = build('stale', new Date(Date.now() - 300 * DAY).toISOString())
  // A file saved ten months ago in a repository nobody has opened since. This is the exact
  // thing the page must not bring up every morning.
  const stamp = (Date.now() - 300 * DAY) / 1000
  for (const f of ['hanging.txt', 'a.txt', 'b.txt', 'CHANGELOG.md']) fs.utimesSync(path.join(old, f), stamp, stamp)
  repos = (await facts('today')).repos
} catch (err) {
  repos = err // git is not on this machine, or would not run: say so rather than pass quietly
}

if (Array.isArray(repos)) {
  const fresh = repos.find((r) => r.name === 'fresh')
  check('the repository worked on today is there', !!fresh, true)
  check('the one untouched since last year is not', repos.some((r) => r.name === 'stale'), false)

  check('only the commit that is mine is counted', fresh.commits.length, 1)
  check('and it is the one I wrote', fresh.commits[0].subject, 'fix: the zoom lands on ninety per cent')
  // Nowhere to push to, so nothing can be said about whether it got out — and saying "not
  // pushed" here would invent a chore out of a repository that never had a remote.
  check('with no remote there is no such thing as online', fresh.commits[0].online, null)
  check('and nothing is waiting to go out', fresh.unpushedTotal, 0)

  check('the file never committed is there', fresh.dirty.map((f) => f.path).join(' '), 'hanging.txt')
  check('what was written but not released is read', (fresh.unreleased || []).join(''), '- the zoom lands on 90%')
  check('the day it settled on is today', new Date(fresh.commits[0].at).toDateString(), new Date().toDateString())
} else {
  check('git ran', String(repos), 'git ran')
}

after(() => {
  db.close()
  fs.rmSync(HOME, { recursive: true, force: true })
})
