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
// The backlog switch is a line in the settings file, and `settings.js` writes that file out: a run
// that forgot this would rewrite the settings of the machine it ran on.
process.env.K0_CONFIG = path.join(FAKE_HOME, 'config.json')

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

/**
 * The backlog switch, which is a line in the settings file and nothing else.
 *
 * Switching it back on removes the file rather than writing `true` into it: `settings.js` re-reads
 * only when the file's mtime moves, and two writes in the same millisecond are one mtime.
 */
const backlog = (on) => {
  if (on) fs.rmSync(process.env.K0_CONFIG, { force: true })
  else fs.writeFileSync(process.env.K0_CONFIG, JSON.stringify({ backlog: false }))
}

/** A directory outside any repository, which is where a rigged `.k0/` would try to write. */
function elsewhere() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'k0-outside-')))
  made.push(dir)
  return dir
}

/** A `.k0/` file written by hand, which is how every hostile case in here arrives. */
function handWritten(dir, folder, name, lines) {
  fs.mkdirSync(k0(dir, folder), { recursive: true })
  fs.writeFileSync(k0(dir, folder, name), lines.join('\n') + '\n')
}

const why = (report, file) => report.skipped.find((s) => s.file === file)?.why ?? 'not skipped'

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
  // Not the `.k0` and not a file in it, but the folder between them. A guard that looked at files
  // alone would walk straight through this one and write every story of the repository into it.
  const REPO = repo()
  const OUT = elsewhere()
  fs.mkdirSync(k0(REPO))
  fs.symlinkSync(OUT, k0(REPO, 'stories'))
  const story = db.createStory({ project_path: REPO, title: 'Straight through the link' })
  const refused = mirror.writeStory(story.id)
  check('a linked stories folder stops the write', refused.file, null)
  check('and says which link it followed', refused.error.includes('outside'), true)
  check('nothing was written through it', names(OUT).length, 0)
  // The sweep is the other way in, and it must refuse the same folder rather than find its own way.
  check('the whole-repository sweep refuses it too', mirror.syncRepo(REPO).error === null, false)
  check('and still wrote nothing through it', names(OUT).length, 0)
}
{
  // The README is the first thing written into a new `.k0/`, before any story is, so a link left
  // in its place is the earliest moment a write can be aimed out of the folder.
  const REPO = repo()
  const OUT = elsewhere()
  fs.mkdirSync(k0(REPO))
  fs.writeFileSync(path.join(OUT, 'notes.md'), 'mine\n')
  fs.symlinkSync(path.join(OUT, 'notes.md'), k0(REPO, 'README.md'))
  const story = db.createStory({ project_path: REPO, title: 'Anything at all' })
  check('a linked README stops the write before it starts', mirror.writeStory(story.id).file, null)
  check('and what it pointed at is what it was', read(path.join(OUT, 'notes.md')), 'mine\n')
  check('no story file was written either', names(k0(REPO, 'stories')).length, 0)
}
{
  // Reading is a way out of the folder as well, and a quieter one: a file linked at something
  // private would be read, imported, and then printed back into `.k0/` for anyone to see.
  const REPO = repo()
  const OUT = elsewhere()
  fs.mkdirSync(k0(REPO, 'stories'), { recursive: true })
  fs.writeFileSync(path.join(OUT, 'secret.md'), '---\nkey: K9\n---\n\n# K9 · Not yours\n')
  fs.symlinkSync(path.join(OUT, 'secret.md'), k0(REPO, 'stories', 'K9-not-yours.md'))
  const report = mirror.importRepo(REPO)
  check('an import will not read through a link either', report.stories, 0)
  check('it says so in a sentence', report.error.startsWith('The .k0/ copy could not be written:'), true)
  check('and nothing outside the folder became a story', db.storiesOfProject(REPO).length, 0)
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
  backlog(false)
  const story = db.createStory({ project_path: REPO, title: 'Switched off' })
  const epic = db.createEpic({ project_path: REPO, title: 'Switched off as well' })
  check('switched off, nothing is written', mirror.writeStory(story.id).file, null)
  check('nor is an epic', mirror.writeEpic(epic.id).file, null)
  // The whole-repository sweep is the other way a folder could appear — it is what runs when a
  // repository is opened, rather than when one story changes.
  check('and a sweep of the repository writes nothing either', mirror.syncRepo(REPO).stories, 0)
  check('no folder appears', fs.existsSync(k0(REPO)), false)
  check('not even the README that explains one', names(REPO).join(','), '.git')
  backlog(true)
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

// ── An epic on its own ───────────────────────────────────────────────────────
// An epic is written by `writeEpic` when it is the epic that changed, and rewritten by every
// story under it. Nothing above tests the first of those, and an epic with no stories yet — which
// is what every epic is for its first minute — has never been printed at all.
section('An epic on its own')
{
  const REPO = repo()
  const epic = db.createEpic({ project_path: REPO, title: 'Invoicing' })
  const { file, error } = mirror.writeEpic(epic.id)
  check('the file is named for the key and the title', path.basename(file), `${epic.key}-invoicing.md`)
  check('it is under .k0/epics', path.dirname(file), k0(REPO, 'epics'))
  check('and nothing went wrong', error, null)

  const text = read(file)
  check('an epic nobody has written a story for still says how many are done',
    text.includes('## Stories\n\n0/0 done'), true)
  check('and it is Open until somebody closes it', front(text).state, 'Open')
  check('an epic with no Why keeps the heading and nothing under it', text.includes('## Why\n\n## Stories'), true)

  db.patchEpic(epic.id, { title: 'Invoicing and dunning' })
  mirror.writeEpic(epic.id)
  check('a renamed epic moves its file rather than leaving two',
    names(k0(REPO, 'epics')).join(','), `${epic.key}-invoicing-and-dunning.md`)

  mirror.removeEpic(epic.key, REPO)
  check('and deleting it takes the file with it', names(k0(REPO, 'epics')).length, 0)
}
{
  // An epic that is finished, and one written in a language that is not English. Neither shows
  // anywhere in the body of the file, so a restore that dropped them would look successful.
  const REPO = repo()
  const epic = db.createEpic({ project_path: REPO, title: 'Fatturazione', body: 'Perche esiste.', lang: 'it' })
  db.patchEpic(epic.id, { state: 'Done' })
  mirror.writeEpic(epic.id)
  forget(REPO)

  check('a finished epic comes back', mirror.importRepo(REPO).epics, 1)
  const back = db.listEpics(REPO)[0]
  check('and comes back finished', back.state, 'Done')
  check('in the language it was written in', back.lang, 'it')
  check('with the Why it was written with', back.body, 'Perche esiste.')
}
{
  // An id nothing answers to. It arrives from a request like any other, and the answer is that
  // there was nothing to write — which is not the same as something having gone wrong.
  check('a story that is not there is not an error', mirror.writeStory(999999).error, null)
  check('and neither is an epic that is not there', mirror.writeEpic(999999).file, null)
}

// ── A sweep of the whole repository ──────────────────────────────────────────
// What runs when a repository is opened, rather than when one story changes.
section('A sweep of the whole repository')
{
  const REPO = repo()
  const epic = db.createEpic({ project_path: REPO, title: 'Invoicing' })
  const one = db.createStory({ project_path: REPO, title: 'One', epic_id: epic.id })
  db.createStory({ project_path: REPO, title: 'Two' })

  const swept = mirror.syncRepo(REPO)
  check('the sweep counts the epics it wrote', swept.epics, 1)
  check('and the stories', swept.stories, 2)
  check('with nothing gone wrong', swept.error, null)
  check('every story has a file', names(k0(REPO, 'stories')).length, 2)
  check('the folder explains itself here too', read(k0(REPO, 'README.md')).startsWith('# .k0'), true)

  const epicText = () => read(k0(REPO, 'epics', names(k0(REPO, 'epics'))[0]))
  check('the epic lists the story under it, by the name it is called and the state it is in',
    epicText().includes(`- **${one.key}** · One — Backlog`), true)
  check('and counts how many of them are done', epicText().includes('0/1 done'), true)

  // The epic's file carries that line and that count, so it is stale the moment a story under it
  // moves. Writing the story alone has to be enough to put it right.
  db.setState(one.id, 'Done')
  mirror.writeStory(one.id)
  check('finishing a story rewrites the epic that holds its line', epicText().includes('1/1 done'), true)
  check('and the line beside it says so', epicText().includes('· One — Done'), true)
}

// ── A repository with no .k0/ at all ─────────────────────────────────────────
// The state every repository is in before anything is written, and the one an import runs on when
// there is nothing to import. None of it is a failure and none of it creates the folder.
section('A repository with no .k0/ at all')
{
  const REPO = repo()
  const report = mirror.importRepo(REPO)
  check('importing a repository with nothing in it brings back nothing', report.stories, 0)
  check('and does not call that an error', report.error, null)
  check('nor does it make the folder while looking', fs.existsSync(k0(REPO)), false)

  check('deleting a story whose folder is not there is not a failure', mirror.removeStory('K9', REPO).gone, false)
  check('nor is deleting one whose key is not a key', mirror.removeStory('the API one', REPO).gone, false)

  const PLAIN = elsewhere()
  check('a folder that is not a repository has nothing to import', mirror.importRepo(PLAIN).stories, 0)
  check('and nothing to delete out of', mirror.removeStory('K1', PLAIN).gone, false)
  check('and is still empty afterwards', names(PLAIN).length, 0)
}
{
  // `project_path` arrives on a request, and a file is a path like any other.
  const FILE = path.join(elsewhere(), 'a-file')
  fs.writeFileSync(FILE, 'x')
  const story = db.createStory({ project_path: FILE, title: 'Not a directory' })
  check('a path that is a file is nowhere to write', mirror.writeStory(story.id).file, null)
  check('and the sweep says the same', mirror.syncRepo(FILE).stories, 0)
  check('the file is still the file', read(FILE), 'x')
}
{
  // A delete matches on the key and nothing else, and `K1` is the front of `K10`: a rule that
  // matched the beginning of the name would throw away a story nobody asked it to.
  const REPO = repo()
  for (let i = 1; i <= 10; i++) mirror.writeStory(db.createStory({ project_path: REPO, title: `Story ${i}` }).id)
  check('ten stories, ten files', names(k0(REPO, 'stories')).length, 10)
  check('deleting the first says it found something', mirror.removeStory('K1', REPO).gone, true)
  check('and the other nine are still there', names(k0(REPO, 'stories')).length, 9)
  check('the tenth among them, whose key only begins the same way',
    fs.existsSync(k0(REPO, 'stories', 'K10-story-10.md')), true)
}

// ── Titles that make no name ─────────────────────────────────────────────────
// A title is whatever the user typed, and some of them slug to nothing at all.
section('Titles that make no name')
{
  const REPO = repo()
  const story = db.createStory({ project_path: REPO, title: '!!! ???' })
  const file = mirror.writeStory(story.id).file
  check('a title with no letters in it leaves the key on its own', path.basename(file), `${story.key}.md`)

  db.patchStory(story.id, { title: 'A name at last' })
  mirror.writeStory(story.id)
  check('and giving it a name moves that file rather than adding one',
    names(k0(REPO, 'stories')).join(','), `${story.key}-a-name-at-last.md`)

  db.patchStory(story.id, { title: '???' })
  mirror.writeStory(story.id)
  check('taking the name away again moves it back', names(k0(REPO, 'stories')).join(','), `${story.key}.md`)

  db.patchStory(story.id, { title: 'The title it ends up with' })
  mirror.writeStory(story.id)
  check('a title changed over and over still leaves one file', names(k0(REPO, 'stories')).length, 1)
  check('and it is the last title', read(k0(REPO, 'stories', `${story.key}-the-title-it-ends-up-with.md`))
    .includes('The title it ends up with'), true)
}
{
  // Two stories called the same thing slug the same, and the key in front is the whole of what
  // keeps them apart.
  const REPO = repo()
  const a = db.createStory({ project_path: REPO, title: 'Fix the API' })
  const b = db.createStory({ project_path: REPO, title: 'Fix the API' })
  mirror.writeStory(a.id)
  mirror.writeStory(b.id)
  check('two stories with the same title get a file each',
    names(k0(REPO, 'stories')).join(','), `${a.key}-fix-the-api.md,${b.key}-fix-the-api.md`)
  forget(REPO)
  const report = mirror.importRepo(REPO)
  check('and both come back', report.stories, 2)
  check('neither claiming the other key', report.skipped.length, 0)
}

// ── Fenced code is not a section ─────────────────────────────────────────────
// A plan is markdown somebody wrote, and markdown people write has code in it. A `## ` inside a
// fence is a line of their example: cutting the file there takes their code block apart.
section('Fenced code is not a section')
{
  const REPO = repo()
  const story = db.createStory({ project_path: REPO, title: 'Fences' })
  const PLAN = ['```', '## Not a section', '~~~', 'still inside the first fence', '```', '', '## A real one', '',
    'text', '', '###### Six deep'].join('\n')
  db.patchStory(story.id, { plan: PLAN })
  const text = read(mirror.writeStory(story.id).file)
  check('a heading inside a fence is left exactly as it was written', text.includes('\n## Not a section\n'), true)
  check('and a second kind of fence inside the first does not close it',
    text.includes('\n~~~\nstill inside the first fence\n'), true)
  check('while a heading outside one goes a level deeper', text.includes('\n### A real one\n'), true)

  forget(REPO)
  mirror.importRepo(REPO)
  const back = db.getStory(db.storiesOfProject(REPO)[0].id)
  check('so the plan comes back the plan it was, fence and all',
    back.plan, PLAN.replace('###### Six deep', '##### Six deep'))
  // Said out loud rather than left as a surprise: a sixth-level heading has no seventh to go to,
  // and the only place it can come back is the fifth.
  check('the one thing that does not survive is six levels of heading',
    back.plan.includes('##### Six deep'), true)
}

// ── A story finished, and the rules that replaced each other ─────────────────
section('A story finished, and the rules that replaced each other')
{
  const REPO = repo()
  const story = db.createStory({ project_path: REPO, title: 'Done and dusted' })
  // A round nobody estimated the length of, which is what a discussion opened without a plan for
  // it looks like.
  db.addRound(story.id, { n: 1, question: 'How far does this go?', answer: 'All of it.' })
  const first = db.addDecision(story.id, { text: 'The first rule.' })
  const second = db.addDecision(story.id, { text: 'The rule that replaced it.' })
  db.supersedeDecision(first.id, second.id)
  // A verdict with nothing after it: `kept` needs no evidence, and the em dash must not turn up
  // with nothing behind it.
  db.recordRunChecks(story.id, 1, [{ decision_id: second.id, verdict: 'kept' }])
  db.setCheckItems(story.id, [{ text: 'it passes' }, { text: 'it fails' }, { text: 'it does not apply' }])
  const items = db.listCheckItems(story.id)
  db.patchCheckItem(items[0].id, { state: 'pass' })
  db.patchCheckItem(items[1].id, { state: 'fail' })
  db.patchCheckItem(items[2].id, { state: 'skip' })
  db.addLogEntry(story.id, { text: 'Nobody was in a session for this one.', at: Date.parse('2026-02-01T09:00:00Z') })
  db.setState(story.id, 'Done')

  const text = read(mirror.writeStory(story.id).file)
  check('a round with no estimate says the round and not the total', text.includes('### Round 1\n'), true)
  check('a superseded rule says what replaced it', text.includes('- **D1** The first rule. *(superseded by D2)*'), true)
  check('a verdict with no evidence stops at the verdict', text.includes('- **D2** kept\n'), true)
  check('the three marks a checklist uses are all there',
    text.includes('- [x] 1. it passes\n- [!] 2. it fails\n- [-] 3. it does not apply'), true)
  check('a log entry nobody was in a session for says the day and nothing else',
    text.includes('- 2026-02-01 — Nobody was in a session'), true)

  const was = db.getStory(story.id)
  check('and a finished story carries the minute it was finished',
    front(text).completed, new Date(was.completed_at).toISOString())
  forget(REPO)
  check('it all comes back', mirror.importRepo(REPO).stories, 1)
  const back = db.storiesOfProject(REPO)[0]
  check('the story is Done and not merely said to be', back.state, 'Done')
  check('with the very minute it was finished', db.getStory(back.id).completed_at, was.completed_at)
  const decisions = db.listDecisions(back.id)
  check('the superseded rule is still superseded', decisions[0].superseded_by, decisions[1].id)
  check('and by the rule that replaced it', decisions[1].text, 'The rule that replaced it.')
  check('the round is back without inventing a total', db.listRounds({ storyId: back.id })[0].estimated_total, 0)
  check('the checklist keeps every mark',
    db.listCheckItems(back.id).map((c) => c.state).join(' '), 'pass fail skip')
  check('the verdict is back and claims no evidence it never had',
    db.listDecisionChecks(back.id)[0].evidence, '')
  check('and the log entry has no session on it', db.listLog(back.id)[0].session_id, null)
}
{
  // A story taken out of its epic keeps the verdicts it wrote about the epic's rules, and it is no
  // longer held to any of them. Printed, the label would be the bare `D3` of a sentence the story
  // never had, and on the way back in the verdict would land on it.
  const REPO = repo()
  const epic = db.createEpic({ project_path: REPO, title: 'Invoicing' })
  const story = db.createStory({ project_path: REPO, title: 'Moved out', epic_id: epic.id })
  const rule = db.addEpicDecision(epic.id, { text: 'Every amount is shown with its currency.' })
  const own = db.addDecision(story.id, { text: 'The story has a first rule of its own.' })
  db.recordRunChecks(story.id, 1, [
    { decision_id: rule.id, verdict: 'violated', evidence: 'the totals have no currency' },
    { decision_id: own.id, verdict: 'kept' },
  ])
  db.patchStory(story.id, { epic_id: null })

  const text = read(mirror.writeStory(story.id).file)
  check('a verdict about a rule the story no longer inherits is not printed',
    text.includes('the totals have no currency'), false)
  check('and the rule it was about is not printed either', text.includes('Every amount is shown'), false)
  check('while the story\'s own verdict stays', text.includes('- **D1** kept'), true)
}

// ── Files somebody edited by hand ────────────────────────────────────────────
// `.k0/` is committed, so it is merged, renamed and edited. A file that cannot be understood is
// skipped and named, never thrown over: one bad file must not take the other two hundred with it.
section('Files somebody edited by hand')
{
  const REPO = repo()
  handWritten(REPO, 'stories', 'notes.md', ['Just some notes I dropped in the folder.'])
  handWritten(REPO, 'stories', 'K5.md', ['---', 'key: K5', '---', ''])
  handWritten(REPO, 'stories', 'K6-the-heading-is-gone.md', ['---', 'key: K6', 'state: Nonsense', '---', '',
    'A paragraph where the heading used to be.'])
  handWritten(REPO, 'stories', 'K7-orphan.md', ['---', 'key: K7', 'parent: K99', 'epic: K98', 'depends_on: [K97]',
    '---', '', '# K7 · An orphan'])

  const report = mirror.importRepo(REPO)
  check('a file with no key in its header is skipped', why(report, 'stories/notes.md'), 'the front matter has no key')
  check('and one with no title anywhere, not even in its name', why(report, 'stories/K5.md'), 'there is no title')
  check('the ones that can be read are read', report.stories, 2)
  check('and nothing went wrong', report.error, null)

  const six = db.getStoryByKey(REPO, 6)
  check('a deleted heading falls back to the name of the file', six.title, 'the heading is gone')
  check('and the paragraph under it is still the standfirst', six.description,
    'A paragraph where the heading used to be.')
  check('a state the board does not have is dropped rather than stored', six.state, 'Backlog')

  const seven = db.getStoryByKey(REPO, 7)
  check('a parent that is not in the folder leaves the story where it is', seven.parent_story_id, null)
  check('an epic that is not there either', seven.epic_id, null)
  check('and a dependency on nothing is not a dependency', db.dependenciesOf(seven.id).length, 0)
  check('none of which is worth skipping the file over', why(report, 'stories/K7-orphan.md'), 'not skipped')
}
{
  // The counter-check and the log, written by hand, with everything about them that is not the
  // shape this module prints.
  const REPO = repo()
  handWritten(REPO, 'stories', 'K3-odd.md', [
    '---', 'key: K3', 'ticket: ACME-9', '---', '',
    '# K3 · Odd', '',
    '## Decisions', '',
    '- **D1** The only rule.',
    '- not a decision at all', '',
    '## Verification', '',
    '### Run 2',
    '- **D1** violated — it was not kept.', '',
    '### Run 1',
    '- **D1** na', '',
    '- [x] ticked, and nobody numbered it',
    '- [!] failed, with a reason under it',
    '  server/db.js:1',
    '- [] no space between the brackets',
    'a line at the margin, which ends the item', '',
    '## Log', '',
    '- 2026-02-01 — the first thing',
    'a line at the margin, which is not part of it',
    '- 2026-02-02 · session zz — the second thing', '',
    '  and its second paragraph',
  ])

  check('a file this hand-edited is still a story', mirror.importRepo(REPO).stories, 1)
  const story = db.getStoryByKey(REPO, 3)
  check('a line in the decisions that is not one is ignored', db.listDecisions(story.id).length, 1)

  const boxes = db.listCheckItems(story.id)
  check('an unnumbered checklist item is still an item', boxes[0].text, 'ticked, and nobody numbered it')
  check('empty brackets are a box nobody has ticked', boxes[2].state, 'todo')
  check('what is indented under an item is that item\'s evidence', boxes[1].evidence, 'server/db.js:1')
  check('and a line back at the margin belongs to nobody', boxes.length, 3)

  const verdicts = db.listDecisionChecks(story.id)
  check('the runs come back oldest first whichever order they were written in',
    verdicts.map((v) => `${v.run}:${v.verdict}`).join(' '), '1:na 2:violated')

  const log = db.listLog(story.id)
  check('a line at the margin is not part of the entry above it', log[0].text, 'the first thing')
  check('while an indented one is, blank line and all', log[1].text, 'the second thing\n\nand its second paragraph')
  check('and the session it names comes with it', log[1].session_id, 'zz')

  const again = read(mirror.writeStory(story.id).file)
  check('a header key nobody printed survives being read and written back', again.includes('ticket: ACME-9'), true)
  check('and the numbers the checklist never had are put on it', again.includes('- [x] 1. ticked'), true)
}
{
  // The title cleared out of the heading, and a checkbox with a character in it that nothing uses.
  const REPO = repo()
  handWritten(REPO, 'stories', 'K8-the-name-is-all-that-is-left.md', ['---', 'key: K8', '---', '',
    '# K8 · ', '', '## Verification', '', '- [?] a box marked with something nobody uses'])

  check('a heading with nothing after the key is not a reason to skip the file',
    mirror.importRepo(REPO).stories, 1)
  const story = db.getStoryByKey(REPO, 8)
  check('the name of the file is the last thing left to call it by', story.title, 'the name is all that is left')
  check('and a mark nobody uses is a box nobody has ticked', db.listCheckItems(story.id)[0].state, 'todo')
}
{
  // A verdict naming an epic the folder does not hold. It is the shape a merge leaves behind when
  // the epic's file did not come with the story's.
  const REPO = repo()
  handWritten(REPO, 'stories', 'K1-a-story.md', ['---', 'key: K1', '---', '', '# K1 · A story', '',
    '## Decisions', '', '- **D1** Its own rule.', '',
    '## Verification', '', '### Run 1', '- **K99·D1** kept', '- **D1** violated — this one is about its own rule.'])
  check('it imports rather than throwing', mirror.importRepo(REPO).stories, 1)
  const story = db.getStoryByKey(REPO, 1)
  const verdicts = db.listDecisionChecks(story.id)
  check('a verdict about an epic that is not there is dropped', verdicts.length, 1)
  check('and the one about a rule that is there is kept', verdicts[0].evidence, 'this one is about its own rule.')
}

// ── A parent that would make a loop ──────────────────────────────────────────
// Two hand-edited files each naming the other, and one naming itself. A loop poisons every later
// write of either story rather than showing up here, so it is refused where it can still be said.
section('A parent that would make a loop')
{
  const REPO = repo()
  handWritten(REPO, 'stories', 'K1-one.md', ['---', 'key: K1', 'parent: K2', '---', '', '# K1 · One'])
  handWritten(REPO, 'stories', 'K2-two.md', ['---', 'key: K2', 'parent: K1', '---', '', '# K2 · Two'])
  handWritten(REPO, 'stories', 'K3-itself.md', ['---', 'key: K3', 'parent: K3', '---', '', '# K3 · Itself'])

  const report = mirror.importRepo(REPO)
  check('all three stories are imported', report.stories, 3)
  check('the one that would close the loop is refused', why(report, 'stories/K2'), 'its parent is one of its own tasks')
  check('and so is the one that is its own parent', why(report, 'stories/K3'), 'its parent is one of its own tasks')
  check('the first half of the pair keeps its parent', db.getStoryByKey(REPO, 1).parent_story_id,
    db.getStoryByKey(REPO, 2).id)
  check('the second is left at the top level', db.getStoryByKey(REPO, 2).parent_story_id, null)
  check('and so is the story that named itself', db.getStoryByKey(REPO, 3).parent_story_id, null)
}

// ── The order the files come back in ─────────────────────────────────────────
// `order` is what the board had, written down. A folder read in name order is not that order:
// `K10-…` sorts before `K2-…` in every directory listing there is.
section('The order the files come back in')
{
  const REPO = repo()
  handWritten(REPO, 'stories', 'K1-last.md', ['---', 'key: K1', 'order: 30', '---', '', '# K1 · Last'])
  handWritten(REPO, 'stories', 'K2-first.md', ['---', 'key: K2', 'order: 10', '---', '', '# K2 · First'])
  handWritten(REPO, 'stories', 'K3-middle.md', ['---', 'key: K3', 'order: 20', '---', '', '# K3 · Middle'])
  mirror.importRepo(REPO)
  check('the order decides, not the keys and not the names',
    db.storiesOfProject(REPO).map((s) => s.title).join(','), 'First,Middle,Last')
}
{
  const REPO = repo()
  handWritten(REPO, 'stories', 'K10-ten.md', ['---', 'key: K10', '---', '', '# K10 · Ten'])
  handWritten(REPO, 'stories', 'K2-two.md', ['---', 'key: K2', '---', '', '# K2 · Two'])
  mirror.importRepo(REPO)
  check('with no order to go on the key decides, and not the name the folder sorted by',
    db.storiesOfProject(REPO).map((s) => s.title).join(','), 'Two,Ten')
}
{
  // What the board is dragged into is what comes back. This is the whole reason the number is in
  // the file at all: without it a restore would hand back an order nobody chose.
  const REPO = repo()
  const a = db.createStory({ project_path: REPO, title: 'Second', sort_hint: 20 })
  const b = db.createStory({ project_path: REPO, title: 'First', sort_hint: 10 })
  mirror.writeStory(a.id)
  mirror.writeStory(b.id)
  db.deleteStory(a.id)
  db.deleteStory(b.id)
  mirror.importRepo(REPO)
  check('a story written out and read back keeps the place it had on the board',
    db.storiesOfProject(REPO).map((s) => s.title).join(','), 'First,Second')
}

// ── Notes under the title are not eaten ──────────────────────────────────────
// The README this module writes promises that anything added to the header or to the notes under
// the title is left alone. The standfirst is the one paragraph up there that k0 owns — and when
// there is no standfirst it owns none of them.
section('Notes under the title are not eaten')
{
  const REPO = repo()
  const epic = db.createEpic({ project_path: REPO, title: 'Invoicing', body: 'Why it exists.' })
  const file = mirror.writeEpic(epic.id).file
  fs.writeFileSync(file, read(file)
    .replace(`# ${epic.key} · Invoicing\n`, `# ${epic.key} · Invoicing\n\nFirst note.\n\nSecond note.\n`))

  db.patchEpic(epic.id, { body: 'Why it exists, said better.' })
  mirror.writeEpic(epic.id)
  db.patchEpic(epic.id, { body: 'Why it exists, said better again.' })
  const twice = read(mirror.writeEpic(epic.id).file)
  // An epic prints no standfirst at all, so dropping the first paragraph took one of somebody's
  // notes with it on every write, and the write after that took the next.
  check('an epic keeps both notes through two rewrites', twice.includes('First note.\n\nSecond note.'), true)
  check('and still rewrote what it owns', twice.includes('Why it exists, said better again.'), true)
}
{
  const REPO = repo()
  const story = db.createStory({ project_path: REPO, title: 'No standfirst', body: 'Because.' })
  const file = mirror.writeStory(story.id).file
  fs.writeFileSync(file, read(file)
    .replace(`# ${story.key} · No standfirst\n`, `# ${story.key} · No standfirst\n\nA note I left.\n`))

  db.patchStory(story.id, { body: 'Because it is broken.' })
  const again = read(mirror.writeStory(story.id).file)
  check('a story with no line on its post-it keeps the note under its title',
    again.includes('A note I left.'), true)

  // And once it has a standfirst, that one paragraph is k0's and the note stays under it.
  db.patchStory(story.id, { description: 'One sentence.' })
  const third = read(mirror.writeStory(story.id).file)
  check('a standfirst goes above it rather than instead of it',
    third.includes('One sentence.\n\nA note I left.'), true)
  check('and there is only ever one of it', third.split('One sentence.').length, 2)
}

after(() => {
  db.close()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.K0_DB + suffix, { force: true })
  for (const dir of [...made, FAKE_HOME]) fs.rmSync(dir, { recursive: true, force: true })
})
