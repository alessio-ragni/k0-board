import { check, section, after } from './harness.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// `db.js` opens the database the moment it is imported, and `mirror.js` imports it. `K0_DB` and
// `HOME` first, the imports after — with a plain `import` at the top it would already be too late.
const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-home-'))
process.env.HOME = FAKE_HOME
process.env.USERPROFILE = FAKE_HOME
process.env.K0_DB = path.join(os.tmpdir(), `k0-mirror-test-${process.pid}.db`)

const db = await import('../server/db.js')
const mirror = await import('../server/mirror.js')

// A repository is a directory with a `.git` in it, and that is all mirror.js asks: the folder is
// never a real checkout here, because none of what is tested needs git to have an opinion.
const made = []
function repo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'k0-mirror-')))
  fs.mkdirSync(path.join(dir, '.git'))
  made.push(dir)
  return dir
}

const k0 = (dir, ...parts) => path.join(dir, '.k0', ...parts)
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')
const names = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [])

/**
 * Every path under a directory, relative to it, all the way down.
 *
 * One level was not enough to say what the README says it says: a line written into
 * `.git/info/exclude`, or a directory made under `.claude/`, is exactly the shape of write a
 * listing of the top would walk straight past. Git's own folder is named and not descended into —
 * the fixtures make it empty, and its insides are nobody's business here.
 */
function tree(dir, base = dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const here = path.join(dir, e.name)
    const rel = path.relative(base, here)
    return e.isDirectory() && e.name !== '.git' ? [rel, ...tree(here, base)] : [rel]
  })
}

/** What is in the repository that is not the backlog's own folder. */
const outside = (dir) => tree(dir).filter((p) => p !== '.k0' && !p.startsWith(`.k0${path.sep}`)).sort()
const front = (text) => Object.fromEntries(
  text.split('\n---')[0].split('\n').slice(1).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 2)])
)

/** Everything of a repository out of the database, so `importRepo` can put it back. */
function forget(dir) {
  for (const s of db.storiesOfProject(dir)) db.deleteStory(s.id)
  for (const e of db.listEpics(dir)) db.deleteEpic(e.id)
}

// ── One story, one file ──────────────────────────────────────────────────────
section('One story, one file')
{
  const REPO = repo()
  const story = db.createStory({ project_path: REPO, title: 'Fix the API', body: 'It answers 500.', color: 'blue' })
  const { file, error } = mirror.writeStory(story.id)

  check('the file is named for the key and the title', path.basename(file), `${story.key}-fix-the-api.md`)
  check('it is under .k0/stories', path.dirname(file), k0(REPO, 'stories'))
  check('and nothing went wrong', error, null)

  const text = read(file)
  const head = front(text)
  check('the header carries the key', head.key, story.key)
  check('and the state', head.state, 'Backlog')
  check('and the colour, which is a column like any other', head.color, 'blue')
  check('the heading is the key and the title', text.includes(`# ${story.key} · Fix the API`), true)
  check('and the Why is the body', text.includes('## Why\n\nIt answers 500.'), true)

  // Written once, and it is what stops somebody deleting a folder they did not recognise.
  check('the folder explains itself', read(k0(REPO, 'README.md')).startsWith('# .k0'), true)

  db.patchStory(story.id, { title: 'Fix the invoicing API' })
  const moved = mirror.writeStory(story.id).file
  check('a rename moves the file rather than leaving two', names(k0(REPO, 'stories')).join(','),
    `${story.key}-fix-the-invoicing-api.md`)
  check('and the old name is gone', fs.existsSync(file), false)
  check('the new one holds the new title', read(moved).includes('Fix the invoicing API'), true)

  mirror.removeStory(story.key, REPO)
  check('deleting the story deletes its file', names(k0(REPO, 'stories')).length, 0)
}

// ── Nothing is ever written outside .k0/ ─────────────────────────────────────
section('Nothing is ever written outside .k0/')
{
  const REPO = repo()
  const OUT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'k0-outside-')))
  made.push(OUT)

  // A title is whatever the user typed, and this one is trying to climb out of the folder.
  const climber = db.createStory({ project_path: REPO, title: '../../etc/passwd' })
  const climbed = mirror.writeStory(climber.id).file
  check('a title full of dots is a name, not a path', path.dirname(climbed), k0(REPO, 'stories'))
  check('and the repository grew nothing but .k0', names(REPO).join(','), '.git,.k0')
  // The whole tree and not the top of it: that is the sentence the README makes about this folder,
  // and one `readdirSync` of the root was never enough to be able to make it.
  check('nothing appeared anywhere else in the tree', outside(REPO).join(','), '.git')
  check('.gitignore is never touched', fs.existsSync(path.join(REPO, '.gitignore')), false)

  // One file inside `.k0/` is a link somewhere else. A lexical check reads it as a name and
  // writes straight through it; renaming it moves the link and the next write fills the target.
  fs.symlinkSync(path.join(OUT, 'stolen.md'), k0(REPO, 'stories', `${climber.key}-old.md`))
  fs.writeFileSync(path.join(OUT, 'stolen.md'), 'not k0\n')
  db.patchStory(climber.id, { title: 'now called something else' })
  const refused = mirror.writeStory(climber.id)
  check('a linked file stops the write', refused.file, null)
  check('and it says so in a sentence', refused.error.startsWith('The .k0/ copy could not be written:'), true)
  check('the file it pointed at is untouched', read(path.join(OUT, 'stolen.md')), 'not k0\n')
  fs.rmSync(k0(REPO, 'stories', `${climber.key}-old.md`))
}
{
  // `.k0` itself linked out of the repository. `.k0/` is committed, so a rigged one travels with
  // a clone, and every write in the module would land in the working tree.
  const REPO = repo()
  const OUT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'k0-outside-')))
  made.push(OUT)
  fs.symlinkSync(OUT, path.join(REPO, '.k0'))
  const story = db.createStory({ project_path: REPO, title: 'Anything at all' })
  check('a linked .k0 is nowhere to write', mirror.writeStory(story.id).file, null)
  check('and the link leads nowhere new', names(OUT).length, 0)
}
{
  // `project_path` arrives on a request. A path that is not a repository must not become one.
  const PLAIN = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'k0-plain-')))
  made.push(PLAIN)
  const story = db.createStory({ project_path: PLAIN, title: 'Somewhere nobody asked for' })
  check('a folder that is not a repository gets no .k0', mirror.writeStory(story.id).file, null)
  check('and stays empty', names(PLAIN).length, 0)
}
{
  // With the backlog switched off k0 is the board it always was, and repositories come out of it
  // untouched.
  const REPO = repo()
  db.setPref('backlog.enabled', '0')
  const story = db.createStory({ project_path: REPO, title: 'Switched off' })
  const epic = db.createEpic({ project_path: REPO, title: 'Switched off as well' })
  check('switched off, nothing is written', mirror.writeStory(story.id).file, null)
  check('nor is an epic', mirror.writeEpic(epic.id).file, null)
  // The whole-repository sweep is the other way a folder could appear — it is what runs when a
  // repository is opened, rather than when one story changes.
  check('and a sweep of the repository writes nothing either', mirror.syncRepo(REPO).stories, 0)
  check('no folder appears', fs.existsSync(k0(REPO)), false)
  check('not even the README that explains one', names(REPO).join(','), '.git')
  db.setPref('backlog.enabled', '1')
}

// ── The star, what it waits on, and the sessions it lived through ────────────
// The three things in the header that are not the story's own text. None of them is visible in
// the body of the file, so a restore that dropped one would look completely successful.
section('The star, what it waits on, and the sessions it lived through')
{
  const REPO = repo()
  const groundwork = db.createStory({ project_path: REPO, title: 'Groundwork' })
  const story = db.createStory({ project_path: REPO, title: 'The rest of it' })
  const task = db.createStory({ project_path: REPO, title: 'A piece of it', parent_story_id: story.id })
  db.patchStory(story.id, { starred: true })
  db.addDependency(story.id, groundwork.id)
  // Two sessions, one after the other, which is what a story that was picked up twice looks like.
  db.attachSession(story.id, 'first-session')
  db.attachSession(story.id, 'second-session')

  mirror.writeStory(groundwork.id)
  mirror.writeStory(task.id)
  const head = front(read(mirror.writeStory(story.id).file))
  check('the header says what it is waiting on', head.depends_on, `[${groundwork.key}]`)
  check('and every session it has lived through', head.sessions, '[first-session, second-session]')
  check('and that somebody starred it', head.starred, 'true')

  forget(REPO)
  const report = mirror.importRepo(REPO)
  check('all three files come back', report.stories, 3)
  check('with nothing gone wrong', report.error, null)

  const back = db.getStoryByKey(REPO, Number(story.key.slice(1)))
  check('the star is still on it', back.starred, 1)
  check('it still waits on the same story', db.dependenciesOf(back.id)[0].key, groundwork.key)
  check('on that one and nothing else', db.dependenciesOf(back.id).length, 1)
  check('both sessions are back, oldest first',
    db.listSessions(back.id).map((s) => s.session_id).join(' '), 'first-session second-session')
  check('and the task still knows whose piece it is',
    db.getStoryByKey(REPO, Number(task.key.slice(1))).parent_story_id, back.id)
}

// ── Everything printed comes back ────────────────────────────────────────────
section('Everything printed comes back')
{
  const REPO = repo()
  const epic = db.createEpic({ project_path: REPO, title: 'Invoicing', body: 'Why it exists.', lang: 'it' })
  db.addEpicRound(epic.id, { n: 1, estimated_total: 3, question: 'How far?', answer: 'All of it.' })
  const rule = db.addEpicDecision(epic.id, { text: 'Every amount is shown with its currency.' })

  const story = db.createStory({
    project_path: REPO,
    title: 'Fix the API',
    description: 'The export returns 500 on the second page.',
    body: 'It answers 500.',
    epic_id: epic.id,
    color: 'pink',
    lang: 'it',
  })

  // The approved plan is written in the repository's own plan format, which opens with `## TLDR`.
  // Printed as it stands, that line cuts the file where `## Plan` would.
  const PLAN = '## TLDR\n\nOne sentence.\n\n## Decisioni prese\n\n- The first one.\n\n## Context\n\nThe rest.'
  db.patchStory(story.id, { plan: PLAN })

  // A gap in the numbering: D3 was deleted by hand, and D4 and D5 keep their names.
  db.addDecision(story.id, { n: 1, text: 'The board never changes the branch you are standing on.' })
  db.addDecision(story.id, { n: 4, text: 'Nothing is written before the user has said yes.' })
  const five = db.addDecision(story.id, { n: 5, text: 'A run never overwrites the one before it.' })

  db.setCheckItems(story.id, [
    { text: 'the board stays pinned to the bar — even after a reload' },
    { text: 'the export finishes' },
  ])
  const items = db.listCheckItems(story.id)
  db.patchCheckItem(items[1].id, { state: 'pass', evidence: 'server/db.js:120' })

  db.recordRunChecks(story.id, 1, [
    { decision_id: rule.id, verdict: 'violated', evidence: 'the totals have no currency' },
    { decision_id: five.id, verdict: 'kept', evidence: 'server/db.js:944' },
  ])

  db.addLogEntry(story.id, {
    text: 'The export is done.\n\nThe retries are not.',
    session_id: 'abc123',
    at: Date.parse('2026-01-04T09:00:00.000Z'),
  })

  const file = mirror.writeStory(story.id).file
  const text = read(file)
  check('a heading inside the plan is printed one level deeper', text.includes('### TLDR'), true)
  check('so the section after it is still the file\'s next section', text.includes('\n## Verification\n'), true)
  check('an inherited verdict carries its epic', text.includes(`**${epic.key}·D1** violated`), true)
  // And the sentence that verdict is about is in the same file. Without this the only plain-text
  // record of the work names a rule as broken and never says anywhere what the rule was — the
  // reader would have to know to go and open the epic's file to find out.
  check('the rule the verdict is about is written down too',
    text.includes(`- **${epic.key}·D1** Every amount is shown with its currency. *(from ${epic.key})*`), true)
  check('and the story\'s own decisions keep their bare names', text.includes('- **D1** The board never'), true)
  check('the evidence of a check goes under it, not after a dash', text.includes('\n  server/db.js:120'), true)
  check('the log keeps the day it happened', text.includes('- 2026-01-04 · session abc123 —'), true)

  const before = {
    plan: db.getStory(story.id).plan,
    description: db.getStory(story.id).description,
    color: db.getStory(story.id).color,
    created_at: db.getStory(story.id).created_at,
  }

  forget(REPO)
  const report = mirror.importRepo(REPO)
  check('the epic comes back', report.epics, 1)
  check('and the story with it', report.stories, 1)
  // Not decoration. The last step of a restore is putting the dates back, and when that step threw
  // the whole thing still looked like it had worked: the stories were there, and the only sign was
  // this line, which nothing was reading.
  check('and nothing went wrong on the way', report.error, null)

  const back = db.storiesOfProject(REPO)[0]
  check('the plan is the plan, all four sections of it', db.getStory(back.id).plan, before.plan)
  check('the standfirst is one sentence and not the file', back.description, before.description)
  check('the colour survives', back.color, before.color)
  check('the key is the key it always was', back.key, story.key)
  // The age at the bottom of the post-it, the warm columns and the `Old` fold all read this: a
  // rebuilt repository where every story claims to have been touched at the same instant is a
  // board with its ordering flattened.
  check('and the story is as old as its file says', db.getStory(back.id).created_at, before.created_at)
  check('the epic is back under it', db.getEpic(back.epic_id).title, 'Invoicing')

  const decisions = db.listDecisions(back.id)
  check('the gap in the numbering is kept', decisions.map((d) => d.n).join(','), '1,4,5')

  const checks = db.listCheckItems(back.id)
  check('a sentence with a dash in it is still one sentence', checks[0].text,
    'the board stays pinned to the bar — even after a reload')
  check('and claims no evidence it never had', checks[0].evidence, '')
  check('while the one with evidence keeps it', checks[1].evidence, 'server/db.js:120')

  const log = db.listLog(back.id)
  check('the log entry keeps its paragraph break', log[0].text, 'The export is done.\n\nThe retries are not.')
  check('and its day', new Date(log[0].at).toISOString().slice(0, 10), '2026-01-04')

  // The verdict about the epic's rule has to come back on the epic's rule. The story has a D1 of
  // its own saying something else, and a number alone would put it there.
  const verdicts = db.listDecisionChecks(back.id)
  const inherited = verdicts.find((v) => v.verdict === 'violated')
  check('the inherited verdict lands on the epic decision', inherited.label, `${db.getEpic(back.epic_id).key}·D1`)
  check('and the story keeps its own D1 out of it',
    db.listDecisions(back.id)[0].text.startsWith('The board never'), true)

  check('a second import is refused rather than duplicated', mirror.importRepo(REPO).already, true)
}

// ── What a person wrote stays where they put it ──────────────────────────────
section('What a person wrote stays where they put it')
{
  const REPO = repo()
  const story = db.createStory({
    project_path: REPO,
    title: 'Fix the API',
    description: 'One sentence.',
    body: 'Because.',
  })
  const file = mirror.writeStory(story.id).file

  const edited = read(file)
    .replace('---\n\n#', 'ticket: ACME-42\n---\n\n#')
    .replace('One sentence.\n', 'One sentence.\n\nA note I left under the title.\n')
    .concat('\n## My notes\n\nSomething I wrote.\n')
  fs.writeFileSync(file, edited)

  db.patchStory(story.id, { body: 'Because it is broken.' })
  const again = read(mirror.writeStory(story.id).file)
  check('a header key nobody printed survives the rewrite', again.includes('ticket: ACME-42'), true)
  check('so does a section nobody printed', again.includes('## My notes\n\nSomething I wrote.'), true)
  check('and a paragraph left under the title', again.includes('A note I left under the title.'), true)
  check('the standfirst is still the standfirst', again.includes('One sentence.'), true)
  check('and what k0 owns was rewritten', again.includes('Because it is broken.'), true)

  forget(REPO)
  mirror.importRepo(REPO)
  const back = db.storiesOfProject(REPO)[0]
  check('only the first paragraph is the post-it line', back.description, 'One sentence.')
}

// ── Files that cannot be used are said out loud ──────────────────────────────
section('Files that cannot be used are said out loud')
{
  const REPO = repo()
  const story = db.createStory({ project_path: REPO, title: 'Fix the API' })
  const file = mirror.writeStory(story.id).file
  // Somebody renames the file by hand; the next write does not recognise the name and puts a
  // fresh one beside it. Both now say `key: K1`.
  fs.copyFileSync(file, k0(REPO, 'stories', 'api-notes.md'))
  forget(REPO)

  const report = mirror.importRepo(REPO)
  check('only one file may claim a key', report.stories, 1)
  check('and the other is named', report.skipped[0].file, 'stories/api-notes.md')
  check('with the reason', report.skipped[0].why.includes('already claimed by'), true)
}

// ── A tree that eats itself ──────────────────────────────────────────────────
section('A tree that eats itself')
// `parent_story_id` is patchable from a request and `.k0/` is hand-edited. A story that is its own
// parent used to come back as a stack overflow thrown out of the middle of a write.
{
  const REPO = repo()
  const one = db.createStory({ project_path: REPO, title: 'One' })
  const two = db.createStory({ project_path: REPO, title: 'Two' })
  db.patchStory(one.id, { parent_story_id: two.id })
  db.patchStory(two.id, { parent_story_id: one.id })
  const written = mirror.writeStory(one.id)
  check('a loop is written, not thrown', typeof written.file, 'string')
  check('and nothing came back as an error', written.error, null)
}

after(() => {
  db.close()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.K0_DB + suffix, { force: true })
  for (const dir of [...made, FAKE_HOME]) fs.rmSync(dir, { recursive: true, force: true })
})
