import { check, section, after } from './harness.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// `db.js` opens the database the moment it is imported, and `backlog.js` imports it. `K0_DB` and
// `HOME` first, the imports after — with a plain `import` at the top it would already be too late.
const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-home-'))
process.env.HOME = FAKE_HOME
process.env.USERPROFILE = FAKE_HOME
process.env.K0_DB = path.join(os.tmpdir(), `k0-decisions-test-${process.pid}.db`)

const db = await import('../server/db.js')
const backlog = await import('../server/backlog.js')

// The rule the whole feature exists for is in this file: a decision is written down, it is
// inherited, it is checked one at a time, and a story cannot be called finished while the last
// word about one of them is that it is broken. Every other part of k0 can be done again; a
// decision quietly dropped is a conversation the user sat through for nothing.

const REPO = '/tmp/k0-decisions-test'

// ── Numbered per owner, and never renumbered ─────────────────────────────────
section('Numbered per owner, and never renumbered')
{
  const epic = db.createEpic({ project_path: REPO, title: 'Invoicing' })
  const story = db.createStory({ project_path: REPO, title: 'The totals', epic_id: epic.id })
  const other = db.createStory({ project_path: REPO, title: 'Elsewhere' })

  const e1 = db.addEpicDecision(epic.id, { text: 'Every amount on the screen carries its currency.' })
  db.addEpicDecision(epic.id, { text: 'Nothing is written before the user has said yes.' })
  const s1 = db.addDecision(story.id, { text: 'The totals are counted in the currency of the invoice.' })

  check('the epic numbers its own from one', e1.n, 1)
  check('and the story numbers its own from one as well', s1.n, 1)
  check('a decision comes back with the row id every supersede is sent with', e1.id > 0, true)

  const effective = db.effectiveDecisions(story.id)
  check('a story is held to its epic\'s decisions and its own', effective.length, 3)
  check('the epic\'s come first, because they were taken first', effective[0].owner, 'epic')
  check('and are labelled with the epic in front', effective[0].label, `${epic.key}·D1`)
  check('while the story\'s own are labelled as its own', effective[2].label, 'D1')
  check('a story in no epic inherits nothing', db.effectiveDecisions(other.id).length, 0)

  // Two sentences both called D1 is the shape the label exists to keep apart.
  check('the two D1s are two different sentences', effective[0].text === effective[2].text, false)
}

// ── Superseding happens inside one discussion ────────────────────────────────
section('Superseding happens inside one discussion')
{
  const epic = db.createEpic({ project_path: REPO, title: 'Search' })
  const story = db.createStory({ project_path: REPO, title: 'The filter', epic_id: epic.id })
  const first = db.addDecision(story.id, { text: 'The filter remembers what you last chose.' })
  const second = db.addDecision(story.id, { text: 'The filter opens empty every time.' })
  const epicRule = db.addEpicDecision(epic.id, { text: 'Search never leaves the page.' })

  const after = db.supersedeDecision(first.id, second.id)
  check('a decision is replaced by the one that beat it', after.superseded_by, second.id)
  check('and the one that beat it stands', db.getDecision(second.id).superseded_by, null)
  check('what is still open is what is still standing', backlog.publicStory(db.getStory(story.id)).decisions_open, 2)
  check('while what was discussed is all of it', backlog.publicStory(db.getStory(story.id)).decisions_total, 3)

  // The number is not the id. In a young database both are small integers, so a `n` sent here
  // lands on somebody else's rule and nothing anywhere says so.
  check('a decision cannot be superseded by one of another owner', db.maySupersede(second.id, epicRule.id), false)
  check('and the write refuses it too', db.supersedeDecision(second.id, epicRule.id).superseded_by, null)
  check('nor by itself', db.maySupersede(second.id, second.id), false)
  check('nor by a row that is not a decision at all', db.maySupersede(second.id, 999999), false)
  check('one of the same story is allowed', db.maySupersede(second.id, first.id), true)

  db.supersedeDecision(first.id, null)
  check('and a supersession can be undone', db.getDecision(first.id).superseded_by, null)
}

// ── A run of the counter-check ───────────────────────────────────────────────
section('A run of the counter-check')
{
  const epic = db.createEpic({ project_path: REPO, title: 'Export' })
  const story = db.createStory({ project_path: REPO, title: 'The PDF', epic_id: epic.id })
  const inherited = db.addEpicDecision(epic.id, { text: 'Every amount carries its currency.' })
  const own = db.addDecision(story.id, { text: 'The export finishes without asking anything.' })

  check('nothing has been checked yet', db.latestRun(story.id), 0)

  const written = db.recordRunChecks(story.id, 1, [
    { decision_id: inherited.id, verdict: 'kept', evidence: 'server/pdf.js:44' },
    { decision_id: own.id, verdict: 'violated', evidence: 'server/pdf.js:88 — it asks for a folder' },
  ])
  check('both verdicts land', written, 2)
  check('and that is run 1', db.latestRun(story.id), 1)

  const verdicts = db.listDecisionChecks(story.id, 1)
  check('a verdict about an inherited decision says whose it was', verdicts[0].label, `${epic.key}·D1`)
  check('and the evidence is kept word for word', verdicts[0].evidence, 'server/pdf.js:44')

  check('a word that is not a verdict is not recorded',
    db.recordRunChecks(story.id, 2, [{ decision_id: own.id, verdict: 'probably' }]), 0)
  check('nor is a verdict about a decision of some other story',
    db.recordRunChecks(story.id, 2, [{ decision_id: 999999, verdict: 'kept' }]), 0)

  // A run is the whole set: what it says nothing about is what the endpoint refuses it for.
  const missing = db.unanswered(story.id, [{ decision_id: own.id, verdict: 'kept' }])
  check('a partial run is one decision short', missing.length, 1)
  check('and the one it left out is named', missing[0].label, `${epic.key}·D1`)
  check('a whole run leaves nothing unanswered',
    db.unanswered(story.id, [{ decision_id: own.id, verdict: 'kept' }, { label: `${epic.key}·D1`, verdict: 'na' }])
      .length, 0)

  // A run is what was true on a day, so the day after does not get to rewrite it. Everything that
  // reads a violation reads the runs in order, and a second run that had written over the first
  // would leave nothing anywhere saying the rule was ever broken.
  db.recordRunChecks(story.id, 2, [
    { decision_id: inherited.id, verdict: 'kept', evidence: 'server/pdf.js:44' },
    { decision_id: own.id, verdict: 'kept', evidence: 'server/pdf.js:88 — it asks nothing now' },
  ])
  check('run 1 still says what it said', db.listDecisionChecks(story.id, 1).map((c) => c.verdict).join(','),
    'kept,violated')
  check('and run 2 says the new thing beside it', db.listDecisionChecks(story.id, 2).map((c) => c.verdict).join(','),
    'kept,kept')
  check('both are on the record', backlog.storyView(story.id).runs.length, 2)
  check('newest first, so a page shows the latest word at the top', backlog.storyView(story.id).runs[0].run, 2)
  check('and the next one to write is the one after that', backlog.storyView(story.id).latest_run + 1, 3)
}

// ── An epic's decision changes for every story at once ───────────────────────
section('An epic\'s decision changes for every story at once')
// The reason a decision is inherited and not copied. A copy forks the first time it is superseded,
// and then two stories of the same epic are being held to two different rules with one name.
{
  const epic = db.createEpic({ project_path: REPO, title: 'Notifications' })
  const digest = db.createStory({ project_path: REPO, title: 'The digest', epic_id: epic.id })
  const alerts = db.createStory({ project_path: REPO, title: 'The alerts', epic_id: epic.id })
  const rule = db.addEpicDecision(epic.id, { text: 'Nothing is sent between ten at night and seven.' })

  check('both stories are held to the same row', db.effectiveDecisions(digest.id)[0].id,
    db.effectiveDecisions(alerts.id)[0].id)
  check('and read it under the same name', db.effectiveDecisions(alerts.id)[0].label, `${epic.key}·D1`)

  // The verdicts are the story's, the decision is the epic's, and neither fact bleeds into the
  // other: one rule honestly kept in one story and broken in the next is the case this is for.
  db.recordRunChecks(digest.id, 1, [{ decision_id: rule.id, verdict: 'kept', evidence: 'server/mail.js:20' }])
  db.recordRunChecks(alerts.id, 1, [{ decision_id: rule.id, verdict: 'violated', evidence: 'it sends at two' }])
  check('the story that kept it is free to finish', backlog.mayFinish(digest.id).ok, true)
  check('and the one that broke it is not', backlog.mayFinish(alerts.id).ok, false)
  check('while the story that kept it has nothing against it', backlog.mayFinish(digest.id).violations.length, 0)

  const better = db.addEpicDecision(epic.id, { text: 'Nothing is sent outside the hours the user chose.' })
  db.supersedeDecision(rule.id, better.id)
  check('superseding it on the epic settles it for one story', db.effectiveDecisions(digest.id)[0].superseded_by,
    better.id)
  check('and for the other in the same breath', db.effectiveDecisions(alerts.id)[0].superseded_by, better.id)
  check('which is the second way out of a broken decision', backlog.mayFinish(alerts.id).ok, true)
  check('leaving one rule standing over both', backlog.publicStory(db.getStory(alerts.id)).decisions_open, 1)
  check('and the same one over the other', backlog.publicStory(db.getStory(digest.id)).decisions_open, 1)
}

// ── A story cannot be finished over a broken decision ────────────────────────
section('A story cannot be finished over a broken decision')
{
  const story = db.createStory({ project_path: REPO, title: 'The retries' })
  const rule = db.addDecision(story.id, { text: 'A failed send is tried again three times.' })
  const other = db.addDecision(story.id, { text: 'The user is told when it gives up.' })

  check('with nothing checked, nothing is in the way', backlog.mayFinish(story.id).ok, true)

  db.recordRunChecks(story.id, 1, [
    { decision_id: rule.id, verdict: 'violated', evidence: 'server/mail.js:12 — it gives up at once' },
    { decision_id: other.id, verdict: 'kept', evidence: 'web/board.js:200' },
  ])
  const refused = backlog.mayFinish(story.id)
  check('a broken decision stands between the story and Done', refused.ok, false)
  check('and it is named rather than counted', refused.violations[0].label, 'D1')
  check('with the sentence the user agreed to', refused.violations[0].text, 'A failed send is tried again three times.')
  check('and the refusal says which run found it', refused.why.includes('Run 1'), true)

  // The failure this is written against: run 2 answers the other decision and passes over the
  // broken one. Nothing has been put right, so nothing may be cleared.
  db.recordRunChecks(story.id, 2, [{ decision_id: other.id, verdict: 'kept', evidence: 'web/board.js:200' }])
  check('a later run that says nothing about it does not clear it', backlog.mayFinish(story.id).ok, false)

  // Nor is `na` an answer to it: the rule was found broken, and "it does not apply any more" is
  // the escape hatch /k0-verify is written not to take.
  db.recordRunChecks(story.id, 3, [{ decision_id: rule.id, verdict: 'na', evidence: 'not really relevant' }])
  check('and calling it not applicable does not either', backlog.mayFinish(story.id).ok, false)

  db.recordRunChecks(story.id, 4, [{ decision_id: rule.id, verdict: 'kept', evidence: 'server/mail.js:12' }])
  check('putting it right and checking again is what clears it', backlog.mayFinish(story.id).ok, true)
  check('and every run is still there to read', db.latestRun(story.id), 4)
  check('four of them, none written over', backlog.storyView(story.id).runs.length, 4)

  // The other way out, and the only other one: the decision itself was wrong.
  const late = db.addDecision(story.id, { text: 'A failed send is reported and not retried.' })
  db.recordRunChecks(story.id, 5, [
    { decision_id: rule.id, verdict: 'violated', evidence: 'server/mail.js:12' },
    { decision_id: other.id, verdict: 'kept', evidence: 'web/board.js:200' },
    { decision_id: late.id, verdict: 'kept', evidence: 'server/mail.js:12' },
  ])
  check('a decision found broken again is in the way again', backlog.mayFinish(story.id).ok, false)
  db.supersedeDecision(rule.id, late.id)
  check('superseding it is the other answer', backlog.mayFinish(story.id).ok, true)
}

// ── The story as a skill reads it ────────────────────────────────────────────
section('The story as a skill reads it')
{
  const epic = db.createEpic({ project_path: REPO, title: 'Reporting' })
  const story = db.createStory({ project_path: REPO, title: 'The weekly figures', epic_id: epic.id })
  db.addEpicDecision(epic.id, { text: 'A week runs Monday to Sunday.' })
  db.addDecision(story.id, { text: 'The figures are counted once and cached.' })
  db.addRound(story.id, { n: 1, estimated_total: 3, question: 'Which day does a week start on?', answer: 'Monday.' })
  db.addEpicRound(epic.id, { n: 1, estimated_total: 2, question: 'Who reads this?', answer: 'The finance team.' })
  db.setCheckItems(story.id, [{ text: 'the figures add up' }, { text: 'the page opens in under a second' }])

  const view = backlog.storyView(story.id)
  check('the next run is the one after the last', view.latest_run, 0)
  check('the decisions are the effective set', view.decisions.length, 2)
  check('each carrying the label it will be checked under', view.decisions[0].label, `${epic.key}·D1`)
  check('and the row id a supersede is sent with', view.decisions[0].id > 0, true)
  check('the rounds of this story are its own', view.rounds.length, 1)
  check('and the epic\'s discussion comes with it', view.epic_rounds.length, 1)
  check('the checklist is there to be marked', view.checks.length, 2)
  check('with nothing proved yet', view.checks[0].state, 'todo')
  check('and no run to report', view.runs.length, 0)

  // And the cheap half of it, which is what the panel open beside a row asks for once a second
  // while a discussion is going on. It says the same things and reads none of the text.
  const live = backlog.liveView(story.id)
  check('the poll says which round the discussion is on', live.round.n, 1)
  check('out of how many it expects', live.round.estimated_total, 3)
  check('how many decisions are standing', live.decisions, 2)
  check('how much of the checklist has been proved', live.checks_passed, 0)
  check('that nothing has been counter-checked', live.latest_run, 0)
  check('and that nobody is working on it', live.session, null)

  const epicView = backlog.epicView(epic.id)
  check('the epic view labels its decisions the same way', epicView.decisions[0].label, `${epic.key}·D1`)
  check('and says whose they are', epicView.decisions[0].owner, 'epic')
  check('with the stories under it', epicView.stories.length, 1)
}

after(() => {
  db.close()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.K0_DB + suffix, { force: true })
  fs.rmSync(FAKE_HOME, { recursive: true, force: true })
})
