import { check, section, after } from './harness.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// `db.js` opens the database the moment it is imported, and `backlog.js` imports it. `K0_DB` and
// `HOME` first, the imports after — with a plain `import` at the top it would already be too late.
const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-home-'))
process.env.HOME = FAKE_HOME
process.env.USERPROFILE = FAKE_HOME
process.env.K0_DB = path.join(os.tmpdir(), `k0-backlog-test-${process.pid}.db`)

const db = await import('../server/db.js')
const backlog = await import('../server/backlog.js')

// The model, without HTTP and without a disk. What is checked here is the arithmetic nobody should
// ever have to do twice: the key that is a name for good, the alias that is only a position, what
// is blocking what, and the one sentence that says what to pick up. A skill asked to work any of
// this out for itself is a skill that gets it wrong once in twenty and never says so.

const alias = (id) => backlog.storyAlias(db.getStory(id))

// ── A key is handed out once ─────────────────────────────────────────────────
section('A key is handed out once')
{
  const REPO = '/tmp/k0-backlog-keys'
  const OTHER = '/tmp/k0-backlog-keys-other'
  const epic = db.createEpic({ project_path: REPO, title: 'Invoicing' })
  const first = db.createStory({ project_path: REPO, title: 'One' })
  const second = db.createStory({ project_path: REPO, title: 'Two' })

  check('the epic takes the first number', epic.key, 'K1')
  check('and epics and stories count together', first.key, 'K2')
  check('one after the other', second.key, 'K3')

  db.deleteStory(second.id)
  check('a deleted story does not give its number back', db.createStory({ project_path: REPO, title: 'Three' }).key,
    'K4')

  // The number belongs to the repository, so a story that moves takes a new one — and leaves the
  // old one behind for nobody. Two skills resolving K2 in two repositories must not meet.
  db.patchStory(first.id, { project_path: OTHER })
  check('a story that changes repository is renumbered', db.getStory(first.id).key, 'K1')
  check('and the number it left is not handed out again',
    db.createStory({ project_path: REPO, title: 'Four' }).key, 'K5')
  check('so two repositories can both have a K1', db.getStoryByKey(OTHER, 1).id, first.id)
  check('and the other K1 is still the epic', db.getEpicByKey(REPO, 1).id, epic.id)

  // Filing a story under an epic is where it sits changing, not what it is called. The alias
  // moves — that is what an alias is for — and the key, which is the name a skill was told and
  // the name a branch is cut with, does not move with it.
  const filed = db.getStoryByKey(REPO, 4)
  db.patchStory(filed.id, { epic_id: epic.id })
  check('a story filed under an epic keeps its key', db.getStory(filed.id).key, 'K4')
  db.patchStory(filed.id, { epic_id: null })
  check('and keeps it on the way back out', db.getStory(filed.id).key, 'K4')
}

// ── The alias is a position and nothing else ─────────────────────────────────
section('The alias is a position and nothing else')
{
  const REPO = '/tmp/k0-backlog-alias'
  const invoicing = db.createEpic({ project_path: REPO, title: 'Invoicing' })
  const search = db.createEpic({ project_path: REPO, title: 'Search' })
  const one = db.createStory({ project_path: REPO, title: 'One', epic_id: invoicing.id })
  const two = db.createStory({ project_path: REPO, title: 'Two', epic_id: invoicing.id })
  const loose = db.createStory({ project_path: REPO, title: 'On its own' })
  const alsoLoose = db.createStory({ project_path: REPO, title: 'Also on its own' })
  const piece = db.createStory({
    project_path: REPO,
    title: 'A piece of Two',
    epic_id: invoicing.id,
    parent_story_id: two.id,
  })

  check('an epic is its place in the repository', backlog.epicAlias(invoicing), '1')
  check('and the next one is the next place', backlog.epicAlias(search), '2')
  check('a story in an epic counts from the epic', alias(one.id), '1.1')
  check('in the order the board is in', alias(two.id), '1.2')
  check('a story with no epic counts among the ones with none', alias(loose.id), '1')
  check('and only among those', alias(alsoLoose.id), '2')
  check('a task counts from the story it came out of', alias(piece.id), '1.2.1')
  check('and does not take a place among its epic\'s stories', alias(two.id), '1.2')

  // The alias is computed on every read, which is the whole reason it is not stored: this is one
  // patch and four numbers change with it.
  const keyBefore = db.getStory(one.id).key
  db.patchStory(one.id, { epic_id: search.id })
  check('moving a story to another epic moves its alias', alias(one.id), '2.1')
  check('and the one behind it takes its place', alias(two.id), '1.1')
  check('while the key it is called by does not move at all', db.getStory(one.id).key, keyBefore)
  db.patchStory(one.id, { epic_id: invoicing.id })

  const epic = backlog.publicEpic(db.getEpic(invoicing.id))
  check('an epic counts its stories and not their pieces', epic.progress.total, 2)
  check('and none of them is done yet', epic.progress.done, 0)
  db.setState(two.id, 'Done')
  check('until one is', backlog.publicEpic(db.getEpic(invoicing.id)).progress.done, 1)
  db.setState(two.id, 'Working')
}

// ── Any state may follow any other ───────────────────────────────────────────
section('Any state may follow any other')
{
  const REPO = '/tmp/k0-backlog-states'
  const story = db.createStory({ project_path: REPO, title: 'Straight to done' })
  check('a story starts in the backlog', story.state, 'Backlog')

  // Backlog to Done with nothing in between is legal and must not warn: k0 is a board somebody
  // uses, not a workflow that has to be satisfied.
  const done = db.setState(story.id, 'Done')
  check('backlog goes straight to done', done.state, 'Done')
  check('and that is the same fact as the date', done.completed_at > 0, true)

  const back = db.setState(story.id, 'Backlog')
  check('and straight back again', back.state, 'Backlog')
  check('with the date taken off', back.completed_at, null)

  for (const state of ['Discussed', 'Planned', 'Working', 'Review']) {
    check(`${state} is a state a story can be in`, db.setState(story.id, state).state, state)
  }
  check('a word that is not a state changes nothing', db.setState(story.id, 'Nearly').state, 'Review')

  const epic = db.createEpic({ project_path: REPO, title: 'Invoicing' })
  check('an epic opens', epic.state, 'Open')
  check('and closes', db.patchEpic(epic.id, { state: 'Done' }).state, 'Done')
  // The story side has always refused a state it does not know; the epic side used to store it.
  check('and is nothing else, whatever a request says', db.patchEpic(epic.id, { state: 'Working' }).state, 'Done')
  check('while what it is allowed to change still changes',
    db.patchEpic(epic.id, { title: 'Billing', state: 'Sideways' }).title, 'Billing')
}

// ── The order, the star, and what waits on what ──────────────────────────────
section('The order, the star, and what waits on what')
{
  const REPO = '/tmp/k0-backlog-order'
  const first = db.createStory({ project_path: REPO, title: 'First' })
  const second = db.createStory({ project_path: REPO, title: 'Second' })
  check('the order is the order they were made in',
    db.storiesOfProject(REPO).map((s) => s.title).join(','), 'First,Second')

  db.patchStory(second.id, { sort_hint: -1 })
  check('until somebody puts one in front',
    db.storiesOfProject(REPO).map((s) => s.title).join(','), 'Second,First')

  check('a story is not starred to begin with', backlog.publicStory(db.getStory(first.id)).starred, false)
  db.patchStory(first.id, { starred: true })
  check('and is once it is', backlog.publicStory(db.getStory(first.id)).starred, true)

  check('a story cannot wait for itself', db.addDependency(first.id, first.id), false)
  db.addDependency(first.id, second.id)
  check('it waits for the one it was told to', db.dependenciesOf(first.id)[0].key, db.getStory(second.id).key)
  check('and is marked blocked while that one is open', backlog.publicStory(db.getStory(first.id)).blocked, true)
  check('the other way round nothing is waiting', backlog.publicStory(db.getStory(second.id)).blocked, false)

  // A dependency is a note, and a note has no power of refusal. It marks the post-it and it
  // pushes the story down the answer to "what now"; it never stands between somebody and the
  // work they have decided to do. A backlog that says no is a backlog people stop opening.
  check('a blocked story can still be worked on', db.setState(first.id, 'Working').state, 'Working')
  check('and can still be finished', db.setState(first.id, 'Done').state, 'Done')
  check('with the mark still on it the whole way', backlog.publicStory(db.getStory(first.id)).blocked, true)
  db.setState(first.id, 'Backlog')

  db.setState(second.id, 'Done')
  check('finishing what it waited for unblocks it', backlog.publicStory(db.getStory(first.id)).blocked, false)
  check('and the dependency is still recorded', db.dependenciesOf(first.id).length, 1)
  db.removeDependency(first.id, second.id)
  check('until it is taken off', db.dependenciesOf(first.id).length, 0)
}

// ── What to pick up now ──────────────────────────────────────────────────────
section('What to pick up now')
{
  const REPO = '/tmp/k0-backlog-next'
  check('an empty repository is said to be empty', backlog.next(REPO).story, null)
  check('and says so in a sentence', backlog.next(REPO).why.includes('nothing open'), true)

  const groundwork = db.createStory({ project_path: REPO, title: 'Groundwork', state: 'Backlog' })
  const blocked = db.createStory({ project_path: REPO, title: 'Blocked', state: 'Planned' })
  db.addDependency(blocked.id, groundwork.id)
  check('what is blocked stands aside for what is not', backlog.next(REPO).story.id, groundwork.id)
  check('and the blocked one is named as blocked', backlog.next(REPO).blocked[0].key, blocked.key)

  db.setState(groundwork.id, 'Done')
  check('once it is done the blocked one is what is left', backlog.next(REPO).story.id, blocked.id)

  const starred = db.createStory({ project_path: REPO, title: 'Starred', state: 'Backlog' })
  db.patchStory(starred.id, { starred: true })
  check('the star beats how ready something is', backlog.next(REPO).story.id, starred.id)
  check('and the sentence says so', backlog.next(REPO).why.includes('starred'), true)

  const review = db.createStory({ project_path: REPO, title: 'In review', state: 'Review' })
  check('but Review beats the star: it is one check from done', backlog.next(REPO).story.id, review.id)
  check('and the sentence says that instead', backlog.next(REPO).why.includes('Review'), true)

  // And a session that is really running beats all of it. Two things half done is worse than one
  // thing done, and a live terminal is the strongest thing k0 knows about where the work is.
  const running = db.createStory({ project_path: REPO, title: 'Already open', state: 'Backlog' })
  db.attachSession(running.id, 'a-live-session')
  check('a session already running wins outright', backlog.next(REPO).story.id, running.id)
  check('and is told to be finished first', backlog.next(REPO).why.includes('has a session running'), true)
}

// ── A story that was split is not the work any more ──────────────────────────
section('A story that was split is not the work any more')
// Its own repository, so that nothing else can be the reason for the answer: the parent is the
// readier of the two and would win on every other line of the ranking.
{
  const REPO = '/tmp/k0-backlog-split'
  const parent = db.createStory({ project_path: REPO, title: 'Too big', state: 'Planned' })
  const piece = db.createStory({
    project_path: REPO,
    title: 'A piece of it',
    parent_story_id: parent.id,
    state: 'Backlog',
  })
  check('the parent stands aside for its own pieces', backlog.next(REPO).story.id, piece.id)
  db.setState(piece.id, 'Done')
  check('and comes back when they are all done', backlog.next(REPO).story.id, parent.id)
}

// ── Switched off is not empty ────────────────────────────────────────────────
section('Switched off is not empty')
{
  const REPO = '/tmp/k0-backlog-off'
  db.createStory({ project_path: REPO, title: 'Something' })
  db.createEpic({ project_path: REPO, title: 'A lane nobody asked for' })
  db.setPref('backlog.enabled', '0')
  check('the listing says the feature is off', backlog.listing(REPO).enabled, false)
  check('and hands back no stories at all', backlog.listing(REPO).stories.length, 0)
  // Not one lane either. An epic drawn on a board somebody switched the backlog off on is the
  // one thing the switch promises will not happen.
  check('nor a single epic', backlog.listing(REPO).epics.length, 0)
  check('what to do next says the same thing', backlog.next(REPO).enabled, false)
  check('in words, and not as an empty board', backlog.next(REPO).why.includes('switched off'), true)
  check('and it names no story to pick up', backlog.next(REPO).story, null)
  db.setPref('backlog.enabled', '1')
  check('and it all comes back when it is switched on', backlog.listing(REPO).stories.length, 1)
  check('lanes included', backlog.listing(REPO).epics.length, 1)
}

// ── An epic's own discussion is visible while it is happening ────────────────
// The whole of `/k0-epic` runs before a single story of the epic exists, so everything a page
// could show about it while it is running has to come off the epic itself.
section("An epic's own discussion is visible while it is happening")
{
  const REPO = '/tmp/k0-backlog-epic-live'
  const epic = db.createEpic({ project_path: REPO, title: 'Invoicing' })

  const quiet = backlog.publicEpic(db.getEpic(epic.id))
  check('an epic nobody has discussed is at no round', quiet.round, null)
  check('and has settled nothing', quiet.decisions_total, 0)

  db.addEpicRound(epic.id, { n: 1, estimated_total: 8, question: 'Who is it for?', answer: 'The accountant.' })
  db.addEpicRound(epic.id, { n: 2, estimated_total: 6, question: 'Which currencies?' })
  const first = db.addEpicDecision(epic.id, { text: 'Every invoice is numbered in one sequence.' })
  const better = db.addEpicDecision(epic.id, { text: 'The sequence restarts every year.' })
  db.supersedeDecision(first.id, better.id)

  const card = backlog.publicEpic(db.getEpic(epic.id))
  check('the card says which round it is on', card.round.n, 2)
  check('and what the estimate was at that round', card.round.estimated_total, 6)
  check('it counts what has been decided', card.decisions_total, 2)
  check('and what of that is still standing', card.decisions_open, 1)

  const live = backlog.epicLive(epic.id)
  check('the cheap answer is at the same round', live.round.n, 2)
  check('and counts the standing decisions', live.decisions, 1)
  check('and says how much is under the epic', live.stories, 0)
  check('and what state the epic is in', live.state, 'Open')

  db.createStory({ project_path: REPO, title: 'Number them', epic_id: epic.id })
  check('a story under it is counted the moment it exists', backlog.epicLive(epic.id).stories, 1)
  check('an epic that is not there answers nothing at all', backlog.epicLive(999999), null)
}

after(() => {
  db.close()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.K0_DB + suffix, { force: true })
  fs.rmSync(FAKE_HOME, { recursive: true, force: true })
})
