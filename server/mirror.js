import fs from 'node:fs'
import path from 'node:path'
import * as db from './db.js'
import * as settings from './settings.js'
import { matter } from '../web/md.js'
import { storyAlias, epicAlias } from './backlog.js'

// ── The readable copy ────────────────────────────────────────────────────────
// The board's database is the source of truth. `.k0/` is the same backlog written down where a
// person — and git — can read it: one file per epic, one per story, rewritten whole whenever the
// item changes. No diffing, no merging of what changed: a section is printed from the database
// every time, so a file can never drift into saying something the board does not.
//
// The files are not a cache. They are the only copy of this work that survives a lost database,
// which is what `importRepo` is for, and it is why the format has to be parsable as well as
// readable: everything `writeStory` prints, `importRepo` puts back.
//
// Two consequences of "readable" run through the whole file and are worth knowing before reading
// any single function. The first is that people edit these files: whatever this module does not
// print, it does not touch, header keys included. The second is that what it does print is
// markdown somebody wrote, headings and all — see `shiftHeadings`.
//
// Nothing here throws at its caller. A story is renamed on the board, the row is written, and the
// copy on disk is a copy: a read-only mount or a full disk gives back a sentence, never an
// exception that marks the edit as failed after the database has already taken it.
//
// This module formats and it parses. What state a story is in, when it may go to `Done`, which
// story to pick up next — none of that is decided here.

const K0 = '.k0'

/** The sections this module knows how to print. Anything else in the file is somebody's, and stays. */
const STORY_SECTIONS = ['Why', 'Prompt', 'Discussion', 'Decisions', 'Plan', 'Verification', 'Log']
const EPIC_SECTIONS = ['Why', 'Discussion', 'Decisions', 'Stories']

// The header keys this module owns, lowercased the way `matter` hands them back. A key somebody
// added by hand — `owner:`, `ticket:` — is theirs and is printed back untouched, for the same
// reason a section they wrote is: a header that quietly loses a line is a header nobody writes in
// twice.
const STORY_KEYS = ['key', 'alias', 'epic', 'parent', 'state', 'color', 'starred', 'depends_on', 'sessions', 'lang',
  'created', 'updated', 'completed']
const EPIC_KEYS = ['key', 'alias', 'state', 'lang', 'created', 'updated']

// ── Where it may write ───────────────────────────────────────────────────────

const real = (p) => {
  try {
    return fs.realpathSync(p)
  } catch {
    return null
  }
}

/**
 * This repository's `.k0/`, or null when there is nowhere to write. Three separate refusals.
 *
 * A repository that has been moved or deleted is not an error: there is simply nowhere to write.
 *
 * A path that is not a git repository is one k0 was handed rather than one it found. A story's
 * `project_path` arrives on a request, and `POST /api/backlog/story { project_path: '/Users/me' }`
 * is a well-formed request: without this, a mistyped path is a `.k0/` folder appearing in a
 * directory nobody asked for. The promise this module makes is not "inside `<repo>/.k0/`" — that
 * is trivially true whatever `<repo>` says — it is "nowhere the user did not put a repository".
 *
 * And a `.k0` that is a symbolic link somewhere else is a repository that has been rigged. `.k0/`
 * is committed, so it travels with a clone; a `.k0` pointing at `..` would turn every write in
 * this file into a write into the working tree, and every delete into a delete out of it.
 */
function where(repoPath) {
  const base = real(repoPath)
  if (!base) return null
  try {
    if (!fs.statSync(base).isDirectory()) return null
    // A worktree's `.git` is a file holding a path rather than a directory, so this asks only
    // whether it is there.
    if (!fs.existsSync(path.join(base, '.git'))) return null
  } catch {
    return null
  }
  const dir = path.join(base, K0)
  const found = real(dir)
  return found && found !== dir ? null : dir
}

const there = (repoPath) => !!where(repoPath)

/**
 * Every path this module touches is resolved through here, and anything that lands outside
 * `<repo>/.k0/` throws instead of being written.
 *
 * A comment saying "only writes inside .k0/" would be worth nothing: the paths are built from
 * titles, and a title is whatever the user typed. So it is checked twice, the way `files.js`
 * checks the paths the viewer is asked for. First the path as written — that is where a `..` in a
 * slug lives. Then where it really points, because a lexical check reads a symbolic link as a
 * name: `.k0/stories/K42-old.md` linked at `~/.ssh/config` passes any amount of `startsWith` and
 * is then renamed by `place` and overwritten by `put`. A path that is not there yet has nowhere
 * else it could be pointing, and is allowed: that one is about to be created.
 */
function inside(repoPath, ...parts) {
  const dir = where(repoPath)
  if (!dir) throw new Error(`mirror.js has nowhere to write: ${repoPath} is not a repository it may put a ${K0}/ in`)
  const target = path.resolve(dir, ...parts)
  if (target !== dir && !target.startsWith(dir + path.sep)) {
    throw new Error(`mirror.js will not touch ${target}: it is outside ${dir}`)
  }
  const found = real(target)
  if (found && found !== target && !found.startsWith(dir + path.sep)) {
    throw new Error(`mirror.js will not touch ${target}: it leads to ${found}, outside ${dir}`)
  }
  return target
}

/**
 * With the backlog switched off k0 is the board it has always been, and a repository must come
 * out of that untouched — no folder appearing in a working tree the user did not ask for. The
 * switch is read here rather than trusted to every caller, because it only takes one that forgot.
 */
const enabled = () => settings.read().backlog

/** What went wrong, without the error class in front of it: this ends up on somebody's screen. */
const sentence = (err) => String(err?.message ?? err ?? '').replace(/^[A-Z]+:\s*/, '').trim()

/**
 * The one place a filesystem failure becomes a sentence.
 *
 * A repository on a read-only mount, a checkout whose permissions somebody tightened, a full
 * disk: the board has already taken the edit, and the request that made it must not come back
 * carrying `EACCES` as though the edit had not happened. `worktree.js` does the same thing with
 * git's words, for the same reason.
 */
function attempt(fallback, fn) {
  try {
    return { ...fallback, ...fn(), error: null }
  } catch (err) {
    return { ...fallback, error: `The ${K0}/ copy could not be written: ${sentence(err)}` }
  }
}

function put(repoPath, rel, text) {
  const file = inside(repoPath, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  return file
}

// ── Names ────────────────────────────────────────────────────────────────────

/**
 * The title, lowercased, everything that is not a letter or a digit collapsed to one dash,
 * trimmed, and cut at forty characters — a file name a person can read at a glance in a diff.
 *
 * It is deliberately not unique: two stories called "fix the API" slug the same. The key in
 * front of it is what keeps them apart, and the key is the only part of the name anything ever
 * matches on. `worktree.js` imports this rather than keeping a copy: a worktree directory and a
 * `.k0/` file are named for the same story, and two rules that were once the same rule drift.
 */
export function slug(title) {
  return String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
}

const fileName = (key, title) => {
  const s = slug(title)
  return s ? `${key}-${s}.md` : `${key}.md`
}

/**
 * Where this item's file goes, moving the one that is already there if the title has changed.
 *
 * Renaming rather than writing a second file is the whole point: two files claiming to be K42,
 * one of them stale, is exactly the disagreement `.k0/` exists to make impossible — and the
 * stale one is the one somebody would read.
 */
function place(repoPath, folder, key, title) {
  const want = fileName(key, title)
  const dir = inside(repoPath, folder)
  const mine = new RegExp(`^${key}(-.*)?\\.md$`)
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (name === want || !mine.test(name)) continue
      fs.renameSync(inside(repoPath, folder, name), inside(repoPath, folder, want))
    }
  }
  return `${folder}/${want}`
}

// ── The alias ────────────────────────────────────────────────────────────────
// A position, never a stored number, so it cannot disagree with the tree. It is written into the
// file for the person reading it and ignored on the way back in: on import the tree is rebuilt
// from the files, and the position falls out of it again.
//
// The rule itself lives in `backlog.js` and is imported rather than repeated: the alias in a
// `.k0/` file and the alias the API hands a skill have to be the same string, and two copies of
// one rule drift — after which the file names a position the board does not show.

const topLevel = (stories) => stories.filter((s) => !s.parent_story_id)

// ── Headings inside a section ────────────────────────────────────────────────
// The Why, a prompt, an approved plan and the answer to a round are all markdown somebody wrote,
// and markdown people write has headings in it — this repository's own plan format opens with
// `## TLDR`. Printed as it stands, that line is indistinguishable from `## Plan`: the parser cuts
// the file there, the plan comes back as the paragraph above its first heading, and the rest of
// it re-appears at the bottom as though a person had written it, in pieces, out of order.
//
// So a heading inside a section is printed one level deeper than it was written, which is also
// where it belongs: `## TLDR` under `## Plan` is a third-level heading of the document it is
// actually part of. Reading lifts it back. A first-level `#` is left where it is — it is not what
// cuts the file, and pushing it down is what would turn it into something that does.
//
// One thing does not survive: a sixth-level heading has no seventh level to go to and comes back
// as a fifth. A plan with six levels of heading has troubles this file cannot fix.
//
// Fenced code is never touched, here or in `split`. A `## ` inside a fence is a line of somebody's
// example, and cutting the file there would take their code block apart.

const FENCE = /^\s*(```+|~~~+)/
const HEADING = /^##\s+(.+?)\s*$/
const DEEPER = /^(#{2,6})(\s.*)$/
const H1 = /^#\s+\S/

/** Each line, with whether it is inside a fenced code block. Fence lines count as fenced. */
function* walk(text) {
  let fence = null
  for (const line of String(text ?? '').split('\n')) {
    const f = FENCE.exec(line)
    if (!f) {
      yield { line, fenced: fence !== null }
      continue
    }
    if (fence === null) fence = f[1][0]
    else if (f[1][0] === fence) fence = null
    yield { line, fenced: true }
  }
}

function shiftHeadings(text, by) {
  const out = []
  for (const { line, fenced } of walk(text)) {
    const h = fenced ? null : DEEPER.exec(line)
    out.push(h ? '#'.repeat(Math.min(6, Math.max(2, h[1].length + by))) + h[2] : line)
  }
  return out.join('\n')
}

const deepen = (text) => shiftHeadings(text, 1)
const lift = (text) => shiftHeadings(text, -1)

// ── Printing ─────────────────────────────────────────────────────────────────

/** Blocks separated by one blank line, one newline at the end, nothing empty in between. */
const page = (blocks) =>
  blocks
    .map((b) => (b == null ? '' : String(b).replace(/\s+$/, '')))
    .filter((b) => b !== '')
    .join('\n\n') + '\n'

const frontMatter = (pairs) =>
  ['---', ...pairs.filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k}: ${v}`), '---'].join('\n')

const section = (name, text) => {
  const body = String(text ?? '').trim()
  return body ? `## ${name}\n\n${body}` : null
}

/** A section whose content is markdown somebody wrote, so its own headings go one level down. */
const prose = (name, text) => section(name, deepen(String(text ?? '').trim()))

const at = (ms) => new Date(Number(ms) || 0).toISOString()
const day = (ms) => at(ms).slice(0, 10)
const stamp = (ms) => (Number(ms) ? at(ms) : null)

const roundsBlock = (rounds) =>
  rounds
    .map((r) => {
      const head = r.estimated_total ? `### Round ${r.n} of ${r.estimated_total}` : `### Round ${r.n}`
      const q = `**Q** ${deepen(r.question || '')}`.trimEnd()
      const a = `**A** ${deepen(r.answer || '')}`.trimEnd()
      return [head, q, a].join('\n')
    })
    .join('\n\n')

/**
 * The decisions this file is about, each under the name the counter-check calls it by.
 *
 * A story's list holds its epic's decisions as well as its own, because they are what the story
 * is actually held to and because the `## Verification` section below already prints verdicts
 * about them — `K7·D3 violated`. Without them here, the only plain-text record of the work names
 * a broken rule and never says anywhere what that rule was, and the reader has to know to go and
 * open the epic's file to find out.
 *
 * They are named and not copied. `n` numbers per owner, so a bare `D3` would be the story's own
 * third decision, and a file claiming the epic's rule as the story's is the fork that superseding
 * one of them would then have to be done twice to undo. `parseDecisions` reads `- **D<n>**` and
 * nothing else, so on the way back in these lines are skipped and the story is rebuilt with
 * exactly the decisions it owns.
 */
const decisionsBlock = (decisions, labelOf) =>
  decisions
    .map((d) => {
      const by = d.superseded_by ? labelOf(d.superseded_by) : null
      const from = d.from ? ` *(from ${d.from})*` : ''
      return `- **${d.label}** ${d.text}${from}${by ? ` *(superseded by ${by})*` : ''}`
    })
    .join('\n')

const MARK = { pass: 'x', fail: '!', skip: '-', todo: ' ' }

// The evidence goes on a line of its own, indented under the item, and not after a dash on the
// same line. A check is a sentence, the house writes sentences with em dashes in them, and there
// is no rule — cut at the first dash, cut at the last — that can tell a sentence's own dash from
// the one in front of the evidence. Underneath it there is nothing to tell apart.
const checksBlock = (items) =>
  items
    .map((c) => {
      const line = `- [${MARK[c.state] ?? ' '}] ${c.n}. ${String(c.text ?? '').replace(/\s*\n\s*/g, ' ').trim()}`
      const why = String(c.evidence ?? '').trim()
      return why ? `${line}\n  ${why.split('\n').join('\n  ')}` : line
    })
    .join('\n')

/**
 * The verdicts, run by run, then the checklist.
 *
 * The label comes from the effective set and never from the check row's number alone. A story
 * inherits its epic's decisions and is counter-checked against them one by one, so a verdict may
 * be about `K7·D3` — the epic's third decision — while the story has a D3 of its own saying
 * something else entirely. `D3` in the file would put that verdict on the wrong sentence on the
 * way back in, and the file would still look right.
 */
function verificationBlock(storyId, checks) {
  const label = new Map(db.effectiveDecisions(storyId).map((d) => [d.id, d.label]))
  const runs = new Map()
  for (const c of db.listDecisionChecks(storyId)) {
    // A decision deleted since the run was made has no sentence left to be a verdict about.
    if (!label.has(c.decision_id)) continue
    if (!runs.has(c.run)) runs.set(c.run, [])
    runs.get(c.run).push(c)
  }
  const blocks = [...runs.keys()]
    .sort((a, b) => a - b)
    .map((run) => {
      const lines = runs.get(run).map((c) => {
        // One verdict, one line. `parseVerification` reads these line by line and throws away
        // anything that is not indented under a checklist item, so a `violated` whose evidence
        // runs to a second sentence on a second line — which is what "the file and line, and one
        // sentence saying how" regularly arrives as — would come back cut off at the newline, and
        // the person rebuilding from `.k0/` would read half the reason his story was blocked.
        const why = String(c.evidence ?? '').replace(/\s*\n\s*/g, ' ').trim()
        return `- **${label.get(c.decision_id)}** ${c.verdict}${why ? ` — ${why}` : ''}`
      })
      return [`### Run ${run}`, ...lines].join('\n')
    })
  if (checks.length) blocks.push(checksBlock(checks))
  return blocks.join('\n\n')
}

// A log entry can be a paragraph. The continuation lines are indented so the entry stays one
// bullet to the eye and one entry to the parser, which would otherwise read every line after the
// first as an entry of its own with no date. A blank line inside an entry is printed blank rather
// than as two spaces: every editor strips trailing whitespace, so a paragraph break written that
// way is one the next save deletes.
const logBlock = (entries) =>
  entries
    .map((e) => {
      const who = e.session_id ? ` · session ${e.session_id}` : ''
      const [first, ...rest] = String(e.text ?? '').split('\n')
      const text = [first, ...rest.map((l) => (l.trim() ? `  ${l}` : ''))].join('\n')
      return `- ${day(e.at)}${who} — ${text}`
    })
    .join('\n')

/** What is already in the file, or an empty one when there is nothing there yet to keep. */
function existing(file) {
  try {
    return matter(fs.readFileSync(file, 'utf8'))
  } catch {
    return { data: {}, body: '' }
  }
}

/**
 * The parts of the file that are nobody's business but the person who wrote them.
 *
 * `.k0/` is committed, so it gets edited by hand: notes, links, a paragraph somebody wanted next
 * to the story, a `ticket:` line in the header. Rewriting the file from the database would take
 * those with it, and after the first time nobody would ever write anything there again. What this
 * module prints, it owns; everything else comes back, unread.
 */
const keptSections = (prev, known) =>
  split(prev.body)
    .sections.filter((s) => !known.includes(s.heading))
    .map((s) => [`## ${s.heading}`, ...s.lines].join('\n').replace(/\s+$/, ''))

const keptKeys = (prev, known) => Object.entries(prev.data).filter(([k]) => !known.includes(k))

/** Paragraphs, so the standfirst can be one sentence and the notes under it can be somebody's. */
const paragraphs = (linesIn) => linesIn.join('\n').trim().split(/\n\s*\n/).filter((p) => p.trim())

const afterHeading = (lead) => lead.slice(lead.findIndex((l) => H1.test(l)) + 1)

/**
 * Everything above the first heading except the standfirst, which is printed from the database.
 *
 * `printed` says whether there is a standfirst going out this time, and it is not always: an epic
 * has none at all, and a story whose description is empty prints none either. Dropping the first
 * paragraph regardless takes one paragraph of somebody's notes with it on every write, and the
 * write after that takes the next — a file left alone for a week comes back with the notes gone
 * and nothing anywhere saying they were ever there.
 */
const keptLead = (prev, printed) =>
  paragraphs(afterHeading(split(prev.body).lead))
    .slice(printed ? 1 : 0)
    .join('\n\n')

// ── Writing ──────────────────────────────────────────────────────────────────

/** One story or task, printed whole. `file` is null when there was nowhere to write. */
export function writeStory(storyId) {
  const story = db.getStory(storyId)
  if (!story || !enabled() || !there(story.project_path)) return { file: null, error: null }
  return attempt({ file: null }, () => {
    const file = storyFile(story)
    // The epic's file carries this story's line and its progress count, so it goes stale the moment
    // a story under it changes state or title. It is one small file: rewrite it rather than invent
    // a way of knowing whether it needed it.
    const epic = story.epic_id ? db.getEpic(story.epic_id) : null
    if (epic) epicFile(epic)
    return { file }
  })
}

function storyFile(story) {
  const repo = story.project_path
  ensureReadme(repo)
  const rel = place(repo, 'stories', story.key, story.title)
  const prev = existing(inside(repo, rel))
  const epic = story.epic_id ? db.getEpic(story.epic_id) : null
  const parent = story.parent_story_id ? db.getStory(story.parent_story_id) : null
  // The epic's first, because they were taken first and they shaped the ones under them — the
  // same order `db.effectiveDecisions` puts them in for the plan and for the counter-check.
  const inherited = epic ? db.epicDecisions(epic.id).map((d) => ({ ...d, from: epic.key })) : []
  const decisions = [...inherited, ...db.listDecisions(story.id).map((d) => ({ ...d, label: `D${d.n}` }))]
  const labelOf = (id) => decisions.find((d) => d.id === id)?.label ?? null
  const checks = db.listCheckItems(story.id)
  const sessions = db.listSessions(story.id).map((s) => s.session_id).filter(Boolean)

  const text = page([
    frontMatter([
      ['key', story.key],
      ['alias', storyAlias(story)],
      ['epic', epic ? epic.key : null],
      // Only a task has one, so a story's header stays exactly what the format says it is. It has
      // to be written: without it a restored task comes back as a top-level story and the work it
      // was split out of loses its pieces without a word.
      ['parent', parent ? parent.key : null],
      ['state', story.state],
      // The colour is the user's own grouping across a hundred post-its, and it is a column like
      // any other. Left out of the header it is not a smaller board after a rebuild, it is a board
      // where every post-it is yellow and nothing says the grouping ever existed.
      ['color', story.color || 'yellow'],
      ['starred', story.starred ? 'true' : 'false'],
      ['depends_on', `[${db.dependenciesOf(story.id).map((d) => d.key).join(', ')}]`],
      ['sessions', `[${sessions.join(', ')}]`],
      ['lang', story.lang || ''],
      // The dates are in the header because the board reads them: how old a story is decides the
      // warm columns and the `Old` fold. Restored without them, every story in a repository claims
      // to have been touched at the same instant and the ordering the user reads without thinking
      // is flat.
      ['created', stamp(story.created_at)],
      ['updated', stamp(story.updated_at)],
      ['completed', stamp(story.completed_at)],
      ...keptKeys(prev, STORY_KEYS),
    ]),
    `# ${story.key} · ${story.title}`,
    // The line the post-it shows, printed where a document puts its standfirst: no heading of its
    // own, because it is not a section — it is the story said in one sentence. Anything a person
    // wrote under it stays under it, and is not read back as part of that sentence.
    deepen(String(story.description ?? '').trim()),
    keptLead(prev),
    `## Why\n\n${deepen(String(story.body ?? '').trim())}`.trimEnd(),
    prose('Prompt', story.prompt),
    section('Discussion', roundsBlock(db.listRounds({ storyId: story.id }))),
    section('Decisions', decisionsBlock(decisions, labelOf)),
    prose('Plan', story.plan),
    section('Verification', verificationBlock(story.id, checks)),
    section('Log', logBlock(db.listLog(story.id))),
    ...keptSections(prev, STORY_SECTIONS),
  ])
  return put(repo, rel, text)
}

/** One epic: why it exists, the discussion it came from, its decisions, and what is under it. */
export function writeEpic(epicId) {
  const epic = db.getEpic(epicId)
  if (!epic || !enabled() || !there(epic.project_path)) return { file: null, error: null }
  return attempt({ file: null }, () => ({ file: epicFile(epic) }))
}

function epicFile(epic) {
  ensureReadme(epic.project_path)
  const rel = place(epic.project_path, 'epics', epic.key, epic.title)
  const prev = existing(inside(epic.project_path, rel))
  const stories = topLevel(db.storiesOfEpic(epic.id))
  const pos = epicAlias(epic)
  const done = stories.filter((s) => s.state === 'Done').length
  const decisions = db.listEpicDecisions(epic.id).map((d) => ({ ...d, label: `D${d.n}` }))
  const labelOf = (id) => decisions.find((d) => d.id === id)?.label ?? null

  const list = [
    `${done}/${stories.length} done`,
    '',
    ...stories.map((s, i) => `- **${s.key}** · ${pos}.${i + 1} · ${s.title} — ${s.state}`),
  ].join('\n')

  const text = page([
    frontMatter([
      ['key', epic.key],
      ['alias', pos],
      ['state', epic.state],
      ['lang', epic.lang || ''],
      ['created', stamp(epic.created_at)],
      ['updated', stamp(epic.updated_at)],
      ...keptKeys(prev, EPIC_KEYS),
    ]),
    `# ${epic.key} · ${epic.title}`,
    keptLead(prev),
    `## Why\n\n${deepen(String(epic.body ?? '').trim())}`.trimEnd(),
    // An epic is discussed and decided before a single story of it exists, and those decisions
    // apply to every story under it. They live here for the same reason: there is nowhere else
    // they could live without being copied, and a copied decision forks the first time it changes.
    section('Discussion', roundsBlock(db.listRounds({ epicId: epic.id }))),
    section('Decisions', decisionsBlock(decisions, labelOf)),
    section('Stories', list),
    ...keptSections(prev, EPIC_SECTIONS),
  ])
  return put(epic.project_path, rel, text)
}

const README = `# .k0

This folder is k0's readable copy of the backlog for this repository. The board's database is
the source of truth: every file here is printed from it whenever the epic or the story changes,
whole, so a file can never end up claiming something the board does not.

- \`epics/\` — one file per epic: why it exists, the rounds of questions it came out of, the
  decisions taken, and the stories under it.
- \`stories/\` — one file per story or task: why, the discussion, the decisions, the plan, the
  counter-check and the log of what happened.

Write in them if you like: anything under a heading k0 does not print is left exactly where you
put it, and so is anything you add to the header at the top or to the notes under the title.
Everything else is rewritten on the next change.

Commit the folder. It is the only copy of this work that outlives the database, and k0 reads it
back when it opens a repository it has no stories for.

That is also why the board's git mark went from a tick to a dot the day this folder appeared:
it is honest — there is something here that is not committed yet — and committing it puts the
mark back. If you would rather k0 never wrote any of this, switch the backlog off in its
settings: no folder is created in any repository after that.
`

/**
 * The folder explains itself the moment it appears, whoever made it appear. A `.k0/` turning up
 * in somebody's working tree with nothing in it but a file called `K42-fix-api.md` is a folder
 * they will delete. Written once and never again: it is the one file here that is nobody's copy
 * of anything, so an edit to it is an edit, not drift.
 */
function ensureReadme(repoPath) {
  if (!fs.existsSync(inside(repoPath, 'README.md'))) put(repoPath, 'README.md', README)
}

/**
 * Every epic and every story of a repository, and the README once.
 *
 * It never deletes a file whose story it cannot find. That sounds like tidiness and is in fact
 * the one thing that would destroy the backup: a database that has just been lost, or a k0
 * pointed at an empty one, would sync a repository and take the whole folder with it. Deleting
 * a story deletes its file, through `removeStory`, where there is something that actually says
 * the story is gone.
 */
export function syncRepo(repoPath) {
  const out = { epics: 0, stories: 0, error: null }
  if (!enabled() || !there(repoPath)) return out
  return attempt(out, () => {
    const epics = db.listEpics(repoPath)
    const stories = db.storiesOfProject(repoPath)
    // Nothing to write is not the same as nothing to do wrong. A sweep runs over every repository
    // k0 knows about, and writing the README first would put a `.k0/` into all eighteen of somebody's
    // checkouts the day they updated — folders explaining a backlog that none of those repositories
    // has. The folder appears when the first story does, and not before.
    if (!epics.length && !stories.length) return { epics: 0, stories: 0 }
    ensureReadme(repoPath)
    for (const epic of epics) epicFile(epic)
    for (const story of stories) storyFile(story)
    return { epics: epics.length, stories: stories.length }
  })
}

/**
 * The file of something that is gone. The key is what identifies it and not the name: the title
 * may well have changed between the last write and the delete, and a file left behind here comes
 * back as a story of its own the next time a lost database is rebuilt from the folder.
 */
function drop(folder, key, repoPath) {
  const out = { gone: false, error: null }
  if (!there(repoPath)) return out
  const k = /^K?(\d+)$/.exec(String(key ?? '').trim())
  if (!k) return out
  return attempt(out, () => {
    const dir = inside(repoPath, folder)
    if (!fs.existsSync(dir)) return { gone: false }
    const mine = new RegExp(`^K${k[1]}(-.*)?\\.md$`)
    let gone = false
    for (const name of fs.readdirSync(dir)) {
      if (!mine.test(name)) continue
      fs.rmSync(inside(repoPath, folder, name))
      gone = true
    }
    return { gone }
  })
}

export const removeStory = (key, repoPath) => drop('stories', key, repoPath)

export const removeEpic = (key, repoPath) => drop('epics', key, repoPath)

// ── Reading ──────────────────────────────────────────────────────────────────
// The way back. A file that has been edited into something this cannot understand is skipped and
// said so, never thrown over: an import runs on a repository the user has not looked at in a
// year, and one bad file must not take the other two hundred with it.

/** The body cut into its `##` sections, with whatever came before the first one kept apart. */
function split(body) {
  const lead = []
  const sections = []
  let cur = null
  for (const { line, fenced } of walk(body)) {
    const h = fenced ? null : HEADING.exec(line)
    if (h) {
      cur = { heading: h[1], lines: [] }
      sections.push(cur)
      continue
    }
    ;(cur ? cur.lines : lead).push(line)
  }
  return { lead, sections }
}

const textOf = (linesIn) => linesIn.join('\n').trim()

const sectionText = (sections, name) => {
  const s = sections.find((x) => x.heading === name)
  return s ? textOf(s.lines) : ''
}

/** A section this module printed: its headings were pushed down on the way out and come back up. */
const proseText = (sections, name) => lift(sectionText(sections, name))

const sectionLines = (sections, name) => sections.find((x) => x.heading === name)?.lines ?? []

const listValue = (v) =>
  String(v ?? '')
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

const keyNumber = (v) => {
  const m = /^K?(\d+)$/.exec(String(v ?? '').trim())
  return m ? Number(m[1]) : null
}

const moment = (v) => {
  const ms = Date.parse(String(v ?? '').trim())
  return Number.isFinite(ms) ? ms : null
}

function parseRounds(linesIn) {
  const rounds = []
  let cur = null
  let field = null
  for (const line of linesIn) {
    const head = /^###\s+Round\s+(\d+)(?:\s+of\s+(?:about\s+)?(\d+))?/.exec(line)
    if (head) {
      cur = { n: Number(head[1]), estimated_total: Number(head[2] || 0), question: [], answer: [] }
      rounds.push(cur)
      field = null
      continue
    }
    if (!cur) continue
    const q = /^\*\*Q\*\*\s?(.*)$/.exec(line)
    if (q) {
      field = 'question'
      cur.question.push(q[1])
      continue
    }
    const a = /^\*\*A\*\*\s?(.*)$/.exec(line)
    if (a) {
      field = 'answer'
      cur.answer.push(a[1])
      continue
    }
    if (field) cur[field].push(line)
  }
  return rounds.map((r) => ({ ...r, question: lift(textOf(r.question)), answer: lift(textOf(r.answer)) }))
}

function parseDecisions(linesIn) {
  const out = []
  for (const line of linesIn) {
    const m = /^-\s+\*\*D(\d+)\*\*\s+(.*?)(?:\s*\*\(superseded by D(\d+)\)\*)?\s*$/.exec(line)
    if (!m) continue
    out.push({ n: Number(m[1]), text: m[2].trim(), superseded_by_n: m[3] ? Number(m[3]) : null })
  }
  return out
}

const STATE_OF = { x: 'pass', X: 'pass', '!': 'fail', '-': 'skip', ' ': 'todo', '': 'todo' }

/**
 * The runs of verdicts and the checklist.
 *
 * A verdict carries the epic's key when it is about an inherited decision — `**K7·D3**` — and the
 * key is kept, not thrown away: the story has a D3 of its own, and the two are different
 * sentences. `importRepo` resolves each one against the decision it names before recording it.
 */
function parseVerification(linesIn) {
  const runs = new Map()
  const checks = []
  let run = null
  let item = null
  for (const line of linesIn) {
    const head = /^###\s+Run\s+(\d+)/.exec(line)
    if (head) {
      run = Number(head[1])
      item = null
      if (!runs.has(run)) runs.set(run, [])
      continue
    }
    const verdict = /^-\s+\*\*(?:(K\d+)·)?D(\d+)\*\*\s+(kept|violated|na)(?:\s+—\s+(.*))?\s*$/.exec(line)
    if (verdict && run) {
      item = null
      runs.get(run).push({
        epic_key: verdict[1] || null,
        decision_n: Number(verdict[2]),
        verdict: verdict[3],
        evidence: (verdict[4] || '').trim(),
      })
      continue
    }
    const box = /^-\s+\[(.?)\]\s+(?:(\d+)\.\s+)?(.*)$/.exec(line)
    if (box) {
      item = { text: box[3].trim(), evidence: '', state: STATE_OF[box[1]] ?? 'todo' }
      checks.push(item)
      continue
    }
    // Whatever is indented under an item is that item's evidence, however many dashes it has in it.
    if (item && /^\s{2,}\S/.test(line)) item.evidence = [item.evidence, line.trim()].filter(Boolean).join('\n')
    else if (line.trim()) item = null
  }
  return { runs: [...runs.entries()].sort((a, b) => a[0] - b[0]), checks }
}

/**
 * The log, dates and all.
 *
 * The date is in the file and is put back: a story whose log runs from January to September is the
 * account of what happened and when, and restored with every line stamped the day of the rebuild
 * it stops being one. A paragraph break inside an entry is a line with nothing on it — an editor
 * that strips trailing whitespace takes the indent off it — so blank lines are held rather than
 * appended, kept when another continuation line follows and dropped when the entry has ended.
 */
function parseLog(linesIn) {
  const out = []
  let blanks = 0
  for (const line of linesIn) {
    const m = /^-\s+(\d{4}-\d{2}-\d{2})(?:\s+·\s+session\s+(\S+))?\s+—\s+(.*)$/.exec(line)
    if (m) {
      out.push({ at: moment(`${m[1]}T00:00:00.000Z`), session_id: m[2] || null, text: m[3] })
      blanks = 0
      continue
    }
    if (!out.length) continue
    if (!line.trim()) {
      blanks++
      continue
    }
    if (!/^\s{2,}\S/.test(line)) {
      blanks = 0
      continue
    }
    out[out.length - 1].text += '\n'.repeat(blanks + 1) + line.trim()
    blanks = 0
  }
  return out
}

/** The title as written in the heading; the key in front of it is not part of it. */
const titleFrom = (lead, fallback) => {
  const line = lead.find((l) => H1.test(l))
  if (!line) return fallback
  return line.replace(/^#\s+/, '').replace(/^K\d+\s+·\s+/, '').trim() || fallback
}

/**
 * The standfirst: the first paragraph under the heading and only that one.
 *
 * The rest of what somebody wrote up there stays where they put it, and `keptLead` prints it back.
 * Taking the lot would put two paragraphs of notes on a post-it that shows one line, and `/api/backlog`
 * would return them as the story's summary.
 */
const descriptionFrom = (lead) => lift(paragraphs(afterHeading(lead))[0] ?? '')

/** The title a file name can still give back when somebody has deleted the heading. */
const titleFromName = (name) => name.replace(/^K\d+-?/, '').replace(/\.md$/, '').replace(/-/g, ' ').trim()

function parseFile(name, text) {
  const { data, body } = matter(text)
  const key = keyNumber(data.key)
  if (!key) return { why: 'the front matter has no key' }
  const { lead, sections } = split(body)
  const title = titleFrom(lead, titleFromName(name))
  if (!title) return { why: 'there is no title' }
  return { key, data, title, lead, sections }
}

const readFolder = (repoPath, folder) => {
  const dir = inside(repoPath, folder)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.md'))
    .sort()
    .map((name) => ({ name, text: fs.readFileSync(inside(repoPath, folder, name), 'utf8') }))
}

/**
 * The files of one folder, parsed, with the ones that cannot be used said out loud.
 *
 * Two files claiming the same key is the case worth the code. It happens for an ordinary reason —
 * somebody renames `K42-fix-api.md` by hand, so the next write does not recognise it and puts a
 * fresh `K42-fix-api.md` beside it, or a git merge leaves a copy — and the module's own promise is
 * that two stories carrying K42 is a board that can no longer say which one anything refers to.
 * Importing both makes exactly that board: every `parent` and every `depends_on` pointing at K42
 * would attach to whichever file happened to sort later. The first one wins, in the order the
 * folder reads, and the other is named in the report so the user can see what was left out.
 */
function usable(repoPath, folder, report) {
  const seen = new Map()
  const out = []
  for (const { name, text } of readFolder(repoPath, folder)) {
    const parsed = parseFile(name, text)
    if (parsed.why) {
      report.skipped.push({ file: `${folder}/${name}`, why: parsed.why })
      continue
    }
    const clash = seen.get(parsed.key)
    if (clash) {
      report.skipped.push({ file: `${folder}/${name}`, why: `K${parsed.key} is already claimed by ${clash}` })
      continue
    }
    seen.set(parsed.key, `${folder}/${name}`)
    out.push(parsed)
  }
  return out
}

/** Files in the order their alias puts them, which is the order the board had them in. */
const byAlias = (a, b) => {
  const A = String(a.data.alias ?? '').split('.').map(Number)
  const B = String(b.data.alias ?? '').split('.').map(Number)
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const d = (A[i] || 0) - (B[i] || 0)
    if (d) return d
  }
  return a.key - b.key
}

/**
 * The files back into the database.
 *
 * This is the backup path, and it runs exactly when the database is empty for this repository —
 * a new machine, a lost `~/.k0`, a board somebody deleted. It refuses to run on a repository
 * that already has work in it: importing twice does not merge, it duplicates, and two stories
 * carrying the key K42 is a board that can no longer say which one anything refers to.
 *
 * Everything `writeStory` and `writeEpic` print comes back. Three things are not printed and so
 * cannot: the minute of the day a decision was taken or a log entry written, whether a decision
 * came out of a discussion or a plan, and whether a check was ticked by the user or by Claude.
 * None of the three is worth a line of a file somebody has to read.
 */
export function importRepo(repoPath) {
  const report = { epics: 0, stories: 0, skipped: [], already: false, error: null }
  if (!there(repoPath)) return report
  return attempt(report, () => {
    if (!fs.existsSync(inside(repoPath))) return {}
    if (db.storiesOfProject(repoPath).length || db.listEpics(repoPath).length) return { already: true }
    return restore(repoPath, report)
  })
}

function restore(repoPath, report) {
  const epicIds = new Map()
  // Per epic, the file's D-numbers against the rows they became: a story's verdict may be about
  // its epic's D3, and only the epic knows which row that is.
  const epicDecisions = new Map()
  const epicFiles = usable(repoPath, 'epics', report).sort(byAlias)
  epicFiles.forEach((f, i) => {
    const epic = db.createEpic({
      project_path: repoPath,
      title: f.title,
      body: proseText(f.sections, 'Why'),
      lang: f.data.lang || '',
      sort_hint: i,
      key_num: f.key,
    })
    if (f.data.state === 'Done') db.patchEpic(epic.id, { state: 'Done' })
    for (const r of parseRounds(sectionLines(f.sections, 'Discussion'))) db.addEpicRound(epic.id, r)
    const rows = restoreDecisions(parseDecisions(sectionLines(f.sections, 'Decisions')), (d) =>
      db.addEpicDecision(epic.id, d)
    )
    epicIds.set(f.key, epic.id)
    epicDecisions.set(f.key, rows)
    report.epics++
  })

  const storyIds = new Map()
  const storyFiles = usable(repoPath, 'stories', report).sort(byAlias)
  storyFiles.forEach((f, i) => {
    const story = db.createStory({
      project_path: repoPath,
      title: f.title,
      description: descriptionFrom(f.lead),
      body: proseText(f.sections, 'Why'),
      prompt: proseText(f.sections, 'Prompt'),
      lang: f.data.lang || '',
      color: f.data.color || 'yellow',
      epic_id: epicIds.get(keyNumber(f.data.epic)) ?? null,
      sort_hint: i,
      key_num: f.key,
    })
    storyIds.set(f.key, story.id)
    report.stories++

    db.patchStory(story.id, { plan: proseText(f.sections, 'Plan'), starred: f.data.starred === 'true' })
    // Through `setState` and not as a column of the insert: `Done` is also `completed_at`, and a
    // story restored straight into the table would come back saying Done while the board, which
    // reads the date, went on drawing it as unfinished.
    if (db.STATES.includes(f.data.state) && f.data.state !== story.state) db.setState(story.id, f.data.state)

    for (const r of parseRounds(sectionLines(f.sections, 'Discussion'))) db.addRound(story.id, r)
    const own = restoreDecisions(parseDecisions(sectionLines(f.sections, 'Decisions')), (d) =>
      db.addDecision(story.id, d)
    )

    const { runs, checks } = parseVerification(sectionLines(f.sections, 'Verification'))
    db.setCheckItems(story.id, checks)
    // A verdict names the decision it is about — `D3`, or `K7·D3` when the story inherited it —
    // and is recorded against that row's id. Matching on the number alone would put a verdict
    // about the epic's third decision onto the story's third decision, which is another sentence.
    const inherited = (key) => epicDecisions.get(keyNumber(key)) ?? new Map()
    for (const [run, results] of runs) {
      const rows = []
      for (const r of results) {
        const row = (r.epic_key ? inherited(r.epic_key) : own).get(r.decision_n)
        if (row) rows.push({ decision_id: row.id, verdict: r.verdict, evidence: r.evidence })
      }
      db.recordRunChecks(story.id, run, rows)
    }
    for (const entry of parseLog(sectionLines(f.sections, 'Log'))) db.addLogEntry(story.id, entry)
    // Oldest first, each one closing the one before it, which is how the story kept its history
    // of attempts. They come back looking alive, because that is what attaching a session means;
    // the watcher is a second behind and marks dead whichever of them is not really running.
    for (const sid of listValue(f.data.sessions)) db.attachSession(story.id, sid)
  })

  // Second pass, and it has to be one: a story can depend on a story further down the folder, and
  // a task can be read before the story it was split out of exists.
  for (const f of storyFiles) {
    const id = storyIds.get(f.key)
    if (!id) continue
    const parent = storyIds.get(keyNumber(f.data.parent))
    // A hand-edited pair of files each naming the other as parent is a loop, and a loop poisons
    // every later write of either story rather than showing up here. It is refused where it can
    // still be said out loud.
    if (parent && parent !== id && !descends(parent, id)) db.patchStory(id, { parent_story_id: parent })
    else if (parent) report.skipped.push({ file: `stories/K${f.key}`, why: 'its parent is one of its own tasks' })
    for (const dep of listValue(f.data.depends_on)) {
      const on = storyIds.get(keyNumber(dep))
      if (on) db.addDependency(id, on)
    }
  }

  // Last of all, because everything above moves `updated_at` as it writes, and the point of the
  // dates is that they are the ones the board had.
  for (const f of epicFiles) restoreTimes('epic', epicIds.get(f.key), f.data)
  for (const f of storyFiles) restoreTimes('story', storyIds.get(f.key), f.data)

  // Handed back rather than left in `report` for the caller to read. `attempt` builds its answer
  // as `{ ...fallback, ...fn() }`, and the spread of `fallback` is evaluated BEFORE `fn()` runs —
  // so anything counted into `report` while restoring is copied at nought and thrown away. The
  // restore itself worked; it just reported that it had done nothing, which is worse than failing.
  return { epics: report.epics, stories: report.stories, skipped: report.skipped }
}

/** Whether `id` is somewhere above `candidate` in the tree, which would make a parent a loop. */
function descends(candidate, id) {
  const seen = new Set()
  let at = candidate
  while (at && !seen.has(at)) {
    if (at === id) return true
    seen.add(at)
    at = db.getStory(at)?.parent_story_id ?? null
  }
  return false
}

function restoreTimes(kind, id, data) {
  if (!id) return
  db.restoreTimes(kind, id, {
    created_at: moment(data.created),
    updated_at: moment(data.updated),
    completed_at: moment(data.completed),
  })
}

/**
 * Decisions in the order they were taken, then the supersedings.
 *
 * Two passes, because a decision is regularly replaced by one written after it: D2 superseded by
 * D7 cannot be recorded until D7 has a row and an id of its own. `add` hands back the row, and
 * the file's numbers are matched to those ids rather than trusted as ids themselves — which is
 * also what makes a gap survive. Somebody deletes the D3 line by hand; the file still says D4 and
 * D5, the verdicts written about them still say D4 and D5, and the map keeps those numbers
 * pointing at the right sentences whatever the database chose to call them. The number goes down
 * with the decision as well, because `n` is the decision's name and a renumbered one is a
 * counter-check about somebody else's rule.
 */
function restoreDecisions(parsed, add) {
  const rows = new Map()
  for (const d of [...parsed].sort((a, b) => a.n - b.n)) {
    rows.set(d.n, add({ n: d.n, text: d.text }))
  }
  for (const d of parsed) {
    const row = rows.get(d.n)
    const by = d.superseded_by_n == null ? null : rows.get(d.superseded_by_n)
    if (row && by) db.supersedeDecision(row.id, by.id)
  }
  return rows
}
