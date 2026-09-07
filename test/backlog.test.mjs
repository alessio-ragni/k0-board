import { check, section, after } from './harness.mjs'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// `db.js` opens the database the moment it is imported, and `backlog.js` imports it. `K0_DB` and
// `HOME` first, the imports after — with a plain `import` at the top it would already be too late.
// `K0_CONFIG` goes with them: the switch that turns the backlog off lives in the settings file,
// and a run that forgot would read — and later write over — the settings of the machine it ran on.
const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-home-'))
process.env.HOME = FAKE_HOME
process.env.USERPROFILE = FAKE_HOME
process.env.K0_DB = path.join(os.tmpdir(), `k0-backlog-test-${process.pid}.db`)
process.env.K0_CONFIG = path.join(FAKE_HOME, 'config.json')

const db = await import('../server/db.js')
const backlog = await import('../server/backlog.js')

// The model, without HTTP and without a disk. What is checked here is the arithmetic nobody should
// ever have to do twice: the key that is a name for good, the alias that is only a position, what
// is blocking what, and the one sentence that says what to pick up. A skill asked to work any of
// this out for itself is a skill that gets it wrong once in twenty and never says so.

const alias = (id) => backlog.storyAlias(db.getStory(id))

// The settings file is only re-read when its mtime moves, so two writes inside the same
// millisecond would leave the second one unread and the test reading the switch it had before.
// The stamp is put on by hand rather than left to the clock, which is the one thing here that
// could go green or red depending on how fast the machine is.
let stamped = Date.now()
const backlogSwitch = (on) => {
  fs.writeFileSync(process.env.K0_CONFIG, JSON.stringify({ backlog: on }))
  stamped += 1000
  fs.utimesSync(process.env.K0_CONFIG, new Date(stamped), new Date(stamped))
}

// The board's own rules refuse most of the shapes below, and `.k0/` is still a folder people hand
// edit — so a second handle on the same file is how a database older than a guard gets built.
const byHand = (sql, ...args) => {
  const handle = new DatabaseSync(process.env.K0_DB, { enableForeignKeyConstraints: false })
  handle.prepare(sql).run(...args)
  handle.close()
}

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
  const smaller = db.createStory({
    project_path: REPO,
    title: 'A piece of the piece',
    epic_id: invoicing.id,
    parent_story_id: piece.id,
  })

  check('a task counts from the story it came out of', alias(piece.id), '1.2.1')
  check('and a task of that task counts from it in turn', alias(smaller.id), '1.2.1.1')
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
  backlogSwitch(false)
  check('the listing says the feature is off', backlog.listing(REPO).enabled, false)
  check('and hands back no stories at all', backlog.listing(REPO).stories.length, 0)
  // Not one lane either. An epic drawn on a board somebody switched the backlog off on is the
  // one thing the switch promises will not happen.
  check('nor a single epic', backlog.listing(REPO).epics.length, 0)
  check('what to do next says the same thing', backlog.next(REPO).enabled, false)
  check('in words, and not as an empty board', backlog.next(REPO).why.includes('switched off'), true)
  check('and it names no story to pick up', backlog.next(REPO).story, null)
  backlogSwitch(true)
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
  // Which is where the page starts polling: `/k0-epic` opens the epic and asks its first question
  // afterwards, so the cheap answer has to hold up before there is anything at all to report.
  check('the poll behind the page finds no round either', backlog.epicLive(epic.id).round, null)

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

// ── A key names one thing in one repository ──────────────────────────────────
// The one place a key turns into an id. Everything a skill says out loud arrives here first, so
// what it refuses matters as much as what it finds: a key resolved to the wrong story is a branch
// cut on the wrong post-it and a plan written against work nobody asked for.
section('A key names one thing in one repository')
{
  const REPO = '/tmp/k0-backlog-bykey'
  const OTHER = '/tmp/k0-backlog-bykey-other'
  const epic = db.createEpic({ project_path: REPO, title: 'Invoicing' })
  const story = db.createStory({ project_path: REPO, title: 'The totals' })
  db.createStory({ project_path: OTHER, title: 'Somewhere else' })

  check('the key a user says out loud finds the story', backlog.storyByKey(REPO, 'K2').id, story.id)
  check('and the bare number finds the same one', backlog.storyByKey(REPO, '2').id, story.id)
  check('spaces round it are somebody typing and not part of the name',
    backlog.storyByKey(REPO, ' K2 ').id, story.id)
  check('a title is not a key and names nothing', backlog.storyByKey(REPO, 'The totals'), null)
  check('nor is half of one', backlog.storyByKey(REPO, 'K'), null)
  check('and neither is nothing at all', backlog.storyByKey(REPO, null), null)
  check('a number nobody has been given yet names nothing', backlog.storyByKey(REPO, 'K99'), null)

  // Epics and stories are numbered out of one sequence, so exactly one of them answers each key
  // and the other has to say no rather than reach for the number it does have.
  check('an epic answers to the same kind of key', backlog.epicByKey(REPO, 'K1').id, epic.id)
  check('and refuses a word that is not one just as flatly', backlog.epicByKey(REPO, 'Invoicing'), null)
  check('asking for an epic by a story\'s key finds no epic', backlog.epicByKey(REPO, 'K2'), null)
  check('and asking for a story by an epic\'s key finds no story', backlog.storyByKey(REPO, 'K1'), null)
  check('the same key in another repository is another thing entirely',
    backlog.storyByKey(OTHER, 'K1').title, 'Somewhere else')
}

// ── The listing one board is drawn from ──────────────────────────────────────
section('The listing one board is drawn from')
{
  const REPO = '/tmp/k0-backlog-listing'
  const invoicing = db.createEpic({ project_path: REPO, title: 'Invoicing' })
  const search = db.createEpic({ project_path: REPO, title: 'Search' })
  db.createStory({ project_path: REPO, title: 'Number them', epic_id: invoicing.id })
  db.createStory({ project_path: REPO, title: 'Fuzzy match', epic_id: search.id })
  db.createStory({ project_path: REPO, title: 'On its own' })

  const whole = backlog.listing(REPO)
  check('the whole board is every story in the repository', whole.stories.length, 3)
  check('with both lanes beside them', whole.epics.length, 2)
  check('and no lane singled out', whole.epic, null)

  const lane = backlog.listing(REPO, invoicing.key)
  check('asking for one epic narrows it to that epic\'s stories',
    lane.stories.map((s) => s.title).join(','), 'Number them')
  check('and says which epic was asked for', lane.epic.key, invoicing.key)
  check('while the lanes beside it are still all there', lane.epics.length, 2)

  // The one that has to come back empty rather than whole: a key naming no epic must not fall
  // back to the board, or a skill filtering on a typo is handed every story there is instead.
  const typo = backlog.listing(REPO, 'K99')
  check('a key that names no epic narrows it to nothing', typo.stories.length, 0)
  check('rather than quietly back to the whole board', typo.epic, null)

  // The dashboard asks before it knows which repository it is looking at.
  check('with no repository there is nothing to draw', backlog.listing(null).stories.length, 0)
  check('and it says so rather than picking one', backlog.listing(null).repo, null)
  check('while the feature itself is still on', backlog.listing(null).enabled, true)
}

// ── The alias when the tree underneath it is broken ──────────────────────────
// `.k0/` is a folder people hand-edit and a database can be older than the guard that would have
// refused the shape. None of these is a wrong alias if it goes wrong: it is a stack overflow, or a
// crash, thrown out of the middle of a request nothing above it expects to be able to fail.
section('The alias when the tree underneath it is broken')
{
  const REPO = '/tmp/k0-backlog-broken'
  const first = db.createStory({ project_path: REPO, title: 'One half' })
  const second = db.createStory({ project_path: REPO, title: 'The other half' })
  const orphan = db.createStory({ project_path: REPO, title: 'A task of nothing' })
  const stray = db.createStory({ project_path: REPO, title: 'Filed under nothing' })

  check('the board refuses to make a story its own parent',
    db.patchStory(first.id, { parent_story_id: first.id }).parent_story_id, null)

  byHand('UPDATE story SET parent_story_id = ? WHERE id = ?', second.id, first.id)
  byHand('UPDATE story SET parent_story_id = ? WHERE id = ?', first.id, second.id)
  byHand('UPDATE story SET parent_story_id = 999999 WHERE id = ?', orphan.id)
  byHand('UPDATE story SET epic_id = 999999 WHERE id = ?', stray.id)

  // The value is nonsense, and it is meant to be: what is being proved is that there is a value
  // at all. A throw would happen while the argument was being worked out, before `check` was ever
  // entered, and would take the whole file down instead of failing one line of it.
  const answered = (id) => {
    try {
      return alias(id)
    } catch (e) {
      return `threw ${e.name}`
    }
  }
  check('two stories each named as the other\'s parent still answer', answered(first.id), '.1.1')
  check('and so does the one on the other side of it', answered(second.id), '.1.1')
  check('a task whose story is gone has nothing to count from', answered(orphan.id), '')
  check('and neither has a story filed under an epic that is gone', answered(stray.id), '')
}

// ── When everything is waiting on something ──────────────────────────────────
section('When everything is waiting on something')
{
  const REPO = '/tmp/k0-backlog-all-blocked'
  const api = db.createStory({ project_path: REPO, title: 'The API', state: 'Planned' })
  const page = db.createStory({ project_path: REPO, title: 'The page', state: 'Planned' })
  db.addDependency(api.id, page.id)
  db.addDependency(page.id, api.id)

  // Two stories waiting on each other is the shape that has no unblocked answer at all. It still
  // has to hand one back: a board that says "nothing" while two post-its are open is a board the
  // user goes round by hand, which is the whole thing this was written to stop.
  const answer = backlog.next(REPO)
  check('two stories waiting on each other still get an answer', answer.story.id, api.id)
  check('and the sentence admits everything here is blocked',
    answer.why.includes('Everything open here is waiting on something'), true)
  check('naming what the one it picked is waiting for', answer.why.includes(page.key), true)
  check('which is spelled out beside the answer as well', answer.waiting_for[0].key, page.key)
  check('with both of them listed as blocked', answer.blocked.length, 2)
}

// ── A dependency on a story that is gone ─────────────────────────────────────
section('A dependency on a story that is gone')
{
  const REPO = '/tmp/k0-backlog-deleted-dep'
  const query = db.createStory({ project_path: REPO, title: 'The query' })
  const report = db.createStory({ project_path: REPO, title: 'The report' })
  db.addDependency(report.id, query.id)
  check('while it is there the story waits for it', backlog.publicStory(db.getStory(report.id)).blocked, true)

  // Throwing the post-it away has to take the waiting with it. A dependency left pointing at
  // nothing would mark the report blocked for ever, with nothing on screen to say by what.
  db.deleteStory(query.id)
  check('deleting it takes the wait away with it', backlog.publicStory(db.getStory(report.id)).deps.length, 0)
  check('rather than leaving the story blocked by nothing',
    backlog.publicStory(db.getStory(report.id)).blocked, false)
  check('and what to do now hands it straight back', backlog.next(REPO).story.id, report.id)
}

// ── How far an epic has got ──────────────────────────────────────────────────
section('How far an epic has got')
{
  const REPO = '/tmp/k0-backlog-progress'
  const empty = db.createEpic({ project_path: REPO, title: 'Nothing under it yet' })
  const finished = db.createEpic({ project_path: REPO, title: 'All of it done' })
  check('an epic nobody has broken up yet is nought of nought',
    backlog.publicEpic(db.getEpic(empty.id)).progress.total, 0)
  check('and none of that nothing is done', backlog.publicEpic(db.getEpic(empty.id)).progress.done, 0)

  const one = db.createStory({ project_path: REPO, title: 'The first half', epic_id: finished.id })
  const two = db.createStory({ project_path: REPO, title: 'The second half', epic_id: finished.id })
  db.setState(one.id, 'Done')
  db.setState(two.id, 'Done')
  const bar = backlog.publicEpic(db.getEpic(finished.id))
  check('an epic whose stories are all finished counts every one of them', bar.progress.done, 2)
  check('out of exactly the same number', bar.progress.total, 2)

  // Everything here is finished, which is not the same board as an empty one and reads the same.
  check('and with nothing left open there is nothing to pick up', backlog.next(REPO).story, null)
  check('said in words rather than as an answer of none', backlog.next(REPO).why.includes('nothing open'), true)
}

// ── Why this one and not another ─────────────────────────────────────────────
// The sentence is the server's and not the model's, so the same board gives the same answer twice.
// Every branch of it is a rule somebody would otherwise argue about out loud.
section('Why this one and not another')
{
  const REPO = '/tmp/k0-backlog-why'
  const story = db.createStory({ project_path: REPO, title: 'The one thing here', state: 'Planned' })
  check('a planned story is said to be ready to be started',
    backlog.next(REPO).why.includes('planned and unblocked'), true)
  db.setState(story.id, 'Discussed')
  check('a discussed one is said to be waiting for a plan',
    backlog.next(REPO).why.includes('waiting for a plan'), true)
  db.setState(story.id, 'Working')
  check('and one that is neither is simply next in the order',
    backlog.next(REPO).why.includes('next in the order you put the board in'), true)

  // Review is where work goes to be forgotten, and the sentence says how long it has been there.
  // The only way to prove that is to put the day it arrived back where it would really be.
  db.setState(story.id, 'Review')
  const arrived = (daysAgo) =>
    byHand("UPDATE session_event SET at = ? WHERE story_id = ? AND kind = 'state'",
      Date.now() - daysAgo * 86400000 - 1000, story.id)
  arrived(3)
  check('a story left in Review says how long it has been sitting there',
    backlog.next(REPO).why.includes('has been for 3 days'), true)
  arrived(1)
  check('and counts one of them as a day rather than as days',
    backlog.next(REPO).why.includes('has been for 1 day'), true)
}

// ── What a story is holding up ───────────────────────────────────────────────
section('What a story is holding up')
{
  const REPO = '/tmp/k0-backlog-view'
  const epic = db.createEpic({ project_path: REPO, title: 'Reporting' })
  const query = db.createStory({ project_path: REPO, title: 'The query', epic_id: epic.id })
  const report = db.createStory({ project_path: REPO, title: 'The report' })
  const index = db.createStory({ project_path: REPO, title: 'The index', parent_story_id: query.id })
  db.addDependency(report.id, query.id)
  db.setPlan(query.id, 'Read the table once and hold on to it.')
  db.addLogEntry(query.id, { text: 'Started on the index.' })

  // The other half of `deps`, and the half nothing else shows: the post-it says what a story waits
  // FOR, and the reason to finish one before another is usually what is waiting for IT.
  const view = backlog.storyView(query.id)
  check('a story says what is waiting for it and not only what it waits for', view.blocks[0].key, report.key)
  check('the plan is there for the work to follow', view.plan, 'Read the table once and hold on to it.')
  check('and the diary of what has been done to it', view.log[0].text, 'Started on the index.')
  check('a story in no epic borrows none of an epic\'s discussion',
    backlog.storyView(report.id).epic_rounds.length, 0)
  check('and has no lane to show at all', backlog.storyView(report.id).epic, null)

  const waiting = backlog.publicStory(db.getStory(report.id))
  check('the post-it carries the key of what it waits for', waiting.deps[0].key, query.key)
  check('and the id, because taking the wait off again is done by id', waiting.deps[0].id, query.id)
  check('a task names the story it came out of', backlog.publicStory(db.getStory(index.id)).parent_key, query.key)
  check('a story in an epic names the lane it is in',
    backlog.publicStory(db.getStory(query.id)).epic_title, 'Reporting')

  // The one field the model does not work out: it is read off a repository by the server above
  // and handed through untouched, so a story nobody looked up says nothing rather than guessing.
  check('the state of the branch is handed through as it arrived',
    backlog.publicStory(db.getStory(query.id), { git: { branch: 'wt-K3' } }).git.branch, 'wt-K3')
  check('and is nothing when nobody went and looked', backlog.publicStory(db.getStory(query.id)).git, null)

  // Armed before it has ever run: auto-send is set on the post-it while the story is still in the
  // backlog, so there is a session to draw and nothing has started it. Every field the terminal
  // would fill in is still empty, and the post-it has to be able to say so.
  db.setAutoSend(report.id, true)
  const armed = backlog.publicStory(db.getStory(report.id)).session
  check('a story armed before it has ever run has a session on it', armed.auto_send, true)
  check('with no session of its own yet', armed.session_id, null)
  check('nothing alive in it', armed.alive, false)
  check('and sitting idle, which is what an empty slot reads as', armed.status, 'IDLE')

  db.attachSession(query.id, 'a-live-session')
  const live = backlog.liveView(query.id)
  check('the poll behind an open page names the session running', live.session.session_id, 'a-live-session')
  check('and says it is alive', live.session.alive, true)

  // A page left open on a post-it somebody has since thrown away.
  check('a story that is gone answers nothing at all', backlog.storyView(999999), null)
  check('nor does the poll on one', backlog.liveView(999999), null)
  check('nor the view of an epic that is gone', backlog.epicView(999999), null)
}

// ── An epic's discussion comes down to its stories ───────────────────────────
section('An epic\'s discussion comes down to its stories')
{
  const REPO = '/tmp/k0-backlog-inherited'
  const epic = db.createEpic({ project_path: REPO, title: 'Invoicing' })
  const story = db.createStory({ project_path: REPO, title: 'The numbering', epic_id: epic.id })
  db.addEpicRound(epic.id, { n: 1, estimated_total: 4, question: 'Who reads an invoice?', answer: 'The accountant.' })
  db.addEpicDecision(epic.id, { text: 'Every amount carries its currency.' })
  db.addEpicDecision(epic.id, { text: 'An invoice is never edited once it has been sent.' })
  const forEver = db.addEpicDecision(epic.id, { text: 'Invoices are numbered in one sequence for ever.' })
  const yearly = db.addEpicDecision(epic.id, { text: 'The sequence starts again every year.' })
  db.supersedeDecision(forEver.id, yearly.id)
  const own = db.addDecision(story.id, { text: 'The year is printed in front of the number.' })

  const view = backlog.epicView(epic.id)
  check('a round is read back with the question that was asked', view.rounds[0].question, 'Who reads an invoice?')
  check('and the answer that settled it', view.rounds[0].answer, 'The accountant.')
  check('an epic keeps all four of its decisions, the overtaken one included', view.decisions.length, 4)
  check('with that one pointing at the decision that beat it', view.decisions[2].superseded_by, yearly.id)
  check('while the one that beat it stands on its own', view.decisions[3].superseded_by, null)

  // What the work is actually held to: the epic's rules and the story's own, D3 among them and
  // shown as beaten rather than quietly dropped. A plan written against half the set is a plan
  // that fails its counter-check over a rule it was never shown.
  const held = backlog.storyView(story.id)
  check('a story is held to the epic\'s four rules and to its own', held.decisions.length, 5)
  check('the epic\'s first, under the epic\'s name', held.decisions[2].label, `${epic.key}·D3`)
  check('the beaten one still there, and still marked beaten', held.decisions[2].superseded_by, yearly.id)
  check('and the story\'s own last, under a name of its own', held.decisions[4].label, `D${own.n}`)
  check('the poll counts only the four that are standing', backlog.liveView(story.id).decisions, 4)
  check('and the epic\'s argument comes down with its conclusions', held.epic_rounds[0].question,
    'Who reads an invoice?')
}

// ── More than one decision broken at once ────────────────────────────────────
section('More than one decision broken at once')
{
  const REPO = '/tmp/k0-backlog-violations'
  const story = db.createStory({ project_path: REPO, title: 'The importer' })
  const kept = db.addDecision(story.id, { text: 'A file that fails to import is left where it was.' })
  const twice = db.addDecision(story.id, { text: 'Nothing is imported twice.' })
  db.recordRunChecks(story.id, 1, [
    { decision_id: kept.id, verdict: 'violated', evidence: 'server/import.js:31 — it deletes it either way' },
    { decision_id: twice.id, verdict: 'violated', evidence: 'server/import.js:60 — there is no key to match on' },
  ])

  const refused = backlog.mayFinish(story.id)
  check('the refusal counts them rather than naming one of them',
    refused.why.includes('found 2 decisions broken'), true)
  check('and hands both back to be put right', refused.violations.length, 2)
  check('the dense page reads the same two off the story', backlog.storyView(story.id).violations.length, 2)
  check('each with the sentence that was agreed', backlog.storyView(story.id).violations[0].text,
    'A file that fails to import is left where it was.')
  check('and the evidence the run wrote against it', backlog.storyView(story.id).violations[0].evidence,
    'server/import.js:31 — it deletes it either way')
  check('while the post-it counts them without being asked twice',
    backlog.publicStory(db.getStory(story.id)).violations_open, 2)
}

after(() => {
  db.close()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.K0_DB + suffix, { force: true })
  fs.rmSync(FAKE_HOME, { recursive: true, force: true })
})
