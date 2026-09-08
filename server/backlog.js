import fs from 'node:fs'
import path from 'node:path'
import * as db from './db.js'
import * as settings from './settings.js'
import { projectName } from './projects.js'

// ── The backlog ──────────────────────────────────────────────────────────────
// Epics, stories, tasks, decisions, dependencies, order. It is the model: pure logic over
// `db.js`, with no HTTP in it and nothing that touches a file. `server/index.js` turns requests
// into calls on this, `server/mirror.js` turns the same rows into readable files, and both of
// them can be wrong on their own without this being wrong too.
//
// The one thing worth saying about the shape of what comes out: everything a skill or a page
// could work out for itself is worked out HERE instead — the alias, whether a story is blocked,
// how far an epic has got, which story to pick up next. A model asked to count is a model
// spending tokens on arithmetic and getting it wrong once in twenty.

/**
 * The whole feature. Off, and the board is exactly the board it has always been.
 *
 * It is read from `~/.k0/config.json`, next to the other setting k0 has, and not from the
 * database: the database is what the server shares with the menu bar icon, and nothing a person
 * is expected to switch off belongs somewhere they would need `sqlite3` to reach. The file is
 * re-read whenever it changes, so this takes effect without a restart.
 */
export const enabled = () => settings.read().backlog

/**
 * The one answer every door gives when the backlog is switched off, so there is one wording and
 * not one per endpoint. It carries `why` because the failure this guards against is not an error
 * anybody sees: "there is nothing here" and "you turned this off" look the same to a skill and
 * read the same to a person, and only one of them is worth acting on.
 */
export const off = () => ({
  enabled: false,
  epics: [],
  stories: [],
  story: null,
  waiting_for: [],
  blocked: [],
  why: 'The k0 backlog is switched off. Delete the "backlog" line from ~/.k0/config.json to have it back.',
})

// ── The alias ────────────────────────────────────────────────────────────────
// A position in the tree, computed on every read and never stored, so it cannot disagree with the
// tree it describes. The key is the name that lasts; the alias is where the thing is sitting
// today, and moving a story under another epic changes it — which is the point.

const topLevel = (stories) => stories.filter((s) => !s.parent_story_id)

const positionOf = (rows, id) => rows.findIndex((r) => r.id === id) + 1

export function epicAlias(epic) {
  const at = positionOf(db.listEpics(epic.project_path), epic.id)
  return at ? String(at) : ''
}

/**
 * `seen` is not tidiness. A story cannot be made its own parent from the board, and `patchStory`
 * refuses to build the shape, but `.k0/` is a folder people hand-edit and a database can be older
 * than that guard — so two stories each naming the other as parent is a shape that arrives.
 * Without this that is not a wrong alias, it is a stack overflow thrown out of the middle of a
 * request that nothing above it expects to be able to fail.
 */
export function storyAlias(story, seen = new Set()) {
  if (!story || seen.has(story.id)) return ''
  seen.add(story.id)
  if (story.parent_story_id) {
    const parent = db.getStory(story.parent_story_id)
    if (!parent) return ''
    return `${storyAlias(parent, seen)}.${positionOf(db.childStories(parent.id), story.id)}`
  }
  if (story.epic_id) {
    const epic = db.getEpic(story.epic_id)
    if (!epic) return ''
    return `${epicAlias(epic)}.${positionOf(topLevel(db.storiesOfEpic(epic.id)), story.id)}`
  }
  const loose = topLevel(db.storiesOfProject(story.project_path)).filter((s) => !s.epic_id)
  return String(positionOf(loose, story.id))
}

// ── Keys in, ids out ─────────────────────────────────────────────────────────
// A skill holds keys, because a key is what the user says out loud. Everything below the surface
// holds ids. This is the one place that turns one into the other, and it refuses rather than
// guesses: a key that names nothing in this repository is an error the caller has to see.

const keyNumber = (key) => {
  const m = /^K?(\d+)$/.exec(String(key ?? '').trim())
  return m ? Number(m[1]) : null
}

export function epicByKey(repo, key) {
  const n = keyNumber(key)
  return n == null ? null : (db.getEpicByKey(repo, n) ?? null)
}

export function storyByKey(repo, key) {
  const n = keyNumber(key)
  return n == null ? null : (db.getStoryByKey(repo, n) ?? null)
}

/**
 * Which repository a request is talking about — the one guard every door into the backlog goes
 * through, and the only thing standing between a path somebody sent and a `.k0/` folder.
 *
 * "A repository k0 already knows" is too tight on its own: the very first story in a repository
 * is created by a skill running in one k0 has never had a story for, and refusing that would turn
 * somebody away at the exact moment they started using this. A directory that is a checkout is
 * enough, and it is not nothing: this path is what `mirror.js` writes a `.k0/` folder into, so
 * `/etc` still gets a no.
 *
 * `.git` is a folder in a clone and a FILE in a worktree — which is where `/k0-work` leaves the
 * user — so what is asked is whether the name is there at all, not what shape it has.
 *
 * "Already known" means k0 HAS WORK there, not that the project scan saw the folder. `rootOf`
 * would do the second, and it says yes to any directory under your home that looks like a
 * project — including one with no `.git` in it, which is a backlog `mirror.js` could never write
 * down, because `where()` refuses exactly that. A place an epic can be told in for the first time
 * has to be a place its story files can live.
 */
export function backlogRepo(raw) {
  const dir = typeof raw === 'string' ? raw : ''
  if (!dir || !path.isAbsolute(dir)) return null
  // Work already here outranks the disk. A repository on an unplugged drive, or one moved while
  // k0 was not looking, still owns the stories it owns; refusing it would hide them.
  if (db.storiesOfProject(dir).length || db.listEpics(dir).length) return dir
  try {
    return fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, '.git')) ? dir : null
  } catch {
    return null
  }
}

// ── What a story looks like from outside ─────────────────────────────────────

/**
 * A dependency is a note and not a lock: nothing here stops a blocked story being started. It
 * marks the post-it, it pushes the story down `next()`, and that is all it is allowed to do —
 * a backlog that refuses to let you work on what you want is a backlog you stop using.
 */
const blockedBy = (deps) => deps.filter((d) => d.state !== 'Done')

/** The session shown on the post-it: the newest one, flattened the way the board already reads it. */
function sessionOf(story) {
  if (!story.session_row_id) return null
  return {
    id: story.session_row_id,
    session_id: story.session_id ?? null,
    alive: !!story.session_alive,
    status: story.session_status ?? null,
    work_path: story.work_path ?? null,
    terminal_window_id: story.terminal_window_id ?? null,
    auto_send: !!story.auto_send,
    auto_closed: !!story.auto_closed,
    started_at: story.session_started_at ?? null,
    ended_at: story.session_ended_at ?? null,
  }
}

/**
 * One story as the API gives it out. `decisions_open` counts what is still standing — a decision
 * that has been superseded is history, and counting it would make every story look heavier than
 * it is the more it was discussed.
 */
export function publicStory(story, { git = null } = {}) {
  const epic = story.epic_id ? db.getEpic(story.epic_id) : null
  const parent = story.parent_story_id ? db.getStory(story.parent_story_id) : null
  const deps = db.dependenciesOf(story.id)
  const decisions = db.effectiveDecisions(story.id)
  const checks = db.listCheckItems(story.id)
  const violations = db.openViolations(story.id)
  const standing = decisions.filter((d) => !d.superseded_by).length
  return {
    id: story.id,
    key: story.key,
    alias: storyAlias(story),
    title: story.title,
    description: story.description ?? '',
    body: story.body ?? '',
    prompt: story.prompt ?? '',
    state: story.state,
    starred: !!story.starred,
    lang: story.lang ?? '',
    color: story.color,
    epic_key: epic?.key ?? null,
    epic_title: epic?.title ?? null,
    parent_key: parent?.key ?? null,
    project_path: story.project_path,
    project_name: projectName(story.project_path),
    // The id travels with the key because removing a dependency is done by id: a page that has
    // only the key would have to go and look the story up again to be able to undo what it drew.
    deps: deps.map((d) => ({ id: d.id, key: d.key, title: d.title, state: d.state })),
    blocked: blockedBy(deps).length > 0,
    decisions_total: decisions.length,
    decisions_open: standing,
    checks_total: checks.length,
    checks_passed: checks.filter((c) => c.state === 'pass').length,
    violations_open: violations.length,
    session: sessionOf(story),
    git,
    sort_hint: story.sort_hint,
    created_at: story.created_at,
    updated_at: story.updated_at,
    completed_at: story.completed_at ?? null,
    status_since: story.status_since ?? null,
    state_since: story.state_since ?? null,
    // The one thing to do with it next, decided here so that the post-it, the list row and the
    // skill all draw the same button and give the same reason for it — and handed the two counts
    // this function has just made, rather than letting it go and make them a second time.
    next_step: nextStep(story, { decided: standing > 0, broken: violations.length > 0 }),
  }
}

export function publicEpic(epic) {
  const stories = topLevel(db.storiesOfEpic(epic.id))
  const rounds = db.listRounds({ epicId: epic.id })
  const last = rounds[rounds.length - 1] ?? null
  const decisions = db.listEpicDecisions(epic.id)
  return {
    id: epic.id,
    key: epic.key,
    alias: epicAlias(epic),
    title: epic.title,
    body: epic.body ?? '',
    state: epic.state,
    lang: epic.lang ?? '',
    project_path: epic.project_path,
    project_name: projectName(epic.project_path),
    sort_hint: epic.sort_hint,
    // How far the discussion has got, and how much it has settled. The kanban draws neither; the
    // list does, on the epic's own row, and without them an epic being argued out in a terminal —
    // which is what `/k0-epic` is, and it happens before a single story exists — is a line that
    // says nothing is under it yet and never moves for as long as anybody is watching.
    round: last ? { n: last.n, estimated_total: last.estimated_total } : null,
    decisions_total: decisions.length,
    decisions_open: decisions.filter((d) => !d.superseded_by).length,
    // No weighting. A story is a story: eleven of them with one done is 1/11, however big the
    // one was, because anything else is an estimate and an estimate here is a lie with a
    // progress bar drawn round it.
    progress: { done: stories.filter((s) => s.state === 'Done').length, total: stories.length },
  }
}

/**
 * The listing one repository's board is drawn from, and the first call every skill makes.
 *
 * With the feature off it answers `{ enabled: false }` and nothing else — the skills read that
 * and say so, which is the difference between "your backlog is empty" and "your backlog is
 * switched off". Telling somebody the first when the second is true is the one answer worse
 * than no answer.
 */
export function listing(repo, epicKey = null) {
  if (!enabled()) return off()
  if (!repo) return { enabled: true, repo: null, epics: [], stories: [] }

  const epics = db.listEpics(repo).map(publicEpic)
  const wanted = epicKey ? epicByKey(repo, epicKey) : null
  const rows = epicKey ? db.storiesOfEpic(wanted?.id ?? -1) : db.storiesOfProject(repo)
  return {
    enabled: true,
    repo,
    repo_name: projectName(repo),
    epic: wanted ? publicEpic(wanted) : null,
    epics,
    stories: rows.map((s) => publicStory(s)),
  }
}

/** A round without the two columns that only say who owns it. The same shape for a story's and an epic's. */
const roundView = (r) => ({
  n: r.n,
  estimated_total: r.estimated_total,
  question: r.question,
  answer: r.answer,
  at: r.at,
})

/** And a decision, carrying the `owner` and `label` that say whether it came down from the epic. */
const decisionView = (d) => ({
  id: d.id,
  n: d.n,
  label: d.label,
  owner: d.owner,
  text: d.text,
  source: d.source,
  superseded_by: d.superseded_by ?? null,
  at: d.at,
})

/**
 * The runs there have been, newest first, each with its tally.
 *
 * The tally is counted by name against a fixed list rather than by `row[verdict]++`. `db.js`
 * refuses to store anything but the three verdicts, so this is the second lock on the same door —
 * and the door is worth two locks: the database is also opened by hand with `sqlite3`, and a row
 * saying `at` or `run` would otherwise write over the run's own number instead of being ignored.
 */
function runsOf(id) {
  const runs = []
  for (const c of db.listDecisionChecks(id)) {
    let row = runs.find((r) => r.run === c.run)
    if (!row) runs.push((row = { run: c.run, at: c.at, kept: 0, violated: 0, na: 0 }))
    if (c.verdict === 'kept' || c.verdict === 'violated' || c.verdict === 'na') row[c.verdict]++
    row.at = Math.max(row.at, c.at)
  }
  return runs.sort((a, b) => b.run - a.run)
}

/**
 * Everything about one story, which is what a discussion, a plan and a counter-check all read
 * before they do anything.
 *
 * `decisions` is the EFFECTIVE set — the story's own and its epic's — because that is the set the
 * work is actually held to, and a plan written against half of it is a plan that will fail its
 * counter-check for a rule it was never shown.
 *
 * `latest_run` and `runs` are here because `/k0-verify` has to know which run it is writing, and
 * a model asked to remember that across a compaction will eventually overwrite the run before it.
 * The next run is always `latest_run + 1`.
 */
export function storyView(id) {
  const story = db.getStory(id)
  if (!story) return null
  const epic = story.epic_id ? db.getEpic(story.epic_id) : null
  return {
    story: publicStory(story),
    epic: epic ? publicEpic(epic) : null,
    rounds: db.listRounds({ storyId: id }).map(roundView),
    decisions: db.effectiveDecisions(id).map(decisionView),
    // The epic's own discussion, which is where half the reasons for this story were settled —
    // before it existed. A plan written without it is a plan that has read the conclusions and
    // none of the argument.
    epic_rounds: epic ? db.listRounds({ epicId: epic.id }).map(roundView) : [],
    checks: db.listCheckItems(id),
    runs: runsOf(id),
    latest_run: db.latestRun(id),
    violations: db.openViolations(id).map((v) => ({
      decision_id: v.decision_id,
      label: v.label,
      text: v.decision_text,
      evidence: v.evidence,
    })),
    // What this story is holding up. It is the other half of `deps` and the half nothing else
    // shows: the post-it says what a story waits FOR, and the reason to finish one before another
    // is usually what is waiting for IT. Asked here, on one story, rather than on the listing,
    // where it would be a second query per row for something no post-it has room for.
    blocks: db.dependentsOf(id).map((d) => ({ id: d.id, key: d.key, title: d.title, state: d.state })),
    plan: story.plan ?? '',
    log: db.listLog(id).map((l) => ({ at: l.at, session_id: l.session_id, text: l.text })),
    sessions: db.listSessions(id),
    session: sessionOf(story),
  }
}

/**
 * The same for an epic: its discussion, its decisions, and the stories it turned into.
 *
 * `/k0-epic` re-reads this before every round rather than trusting its memory of a conversation it
 * may have been compacted out of. The decisions come back already labelled — `K7·D3` — from the one
 * place that composes that name, so what is read here is the same string the stories will be held
 * to and the same one their `.k0/` files print.
 */
export function epicView(id) {
  const epic = db.getEpic(id)
  if (!epic) return null
  return {
    epic: publicEpic(epic),
    rounds: db.listRounds({ epicId: id }).map(roundView),
    decisions: db.epicDecisions(id).map(decisionView),
    stories: db.storiesOfEpic(id).map((s) => publicStory(s)),
  }
}

/**
 * The cheap half of `epicView`, and the reason it exists: `/k0-epic` runs its rounds before a
 * single story of the epic exists, so this is the only thing moving on a page watching it. Asking
 * for the whole epic once a second would rebuild every story under it to draw one line of text.
 */
export function epicLive(id) {
  const epic = db.getEpic(id)
  if (!epic) return null
  const rounds = db.listRounds({ epicId: id })
  const last = rounds[rounds.length - 1] ?? null
  return {
    state: epic.state,
    round: last ? { n: last.n, estimated_total: last.estimated_total } : null,
    decisions: db.listEpicDecisions(id).filter((d) => !d.superseded_by).length,
    stories: db.storiesOfEpic(id).length,
    updated_at: epic.updated_at,
  }
}

/** The cheap half of the above: what a page polling once a second actually needs. */
export function liveView(id) {
  const story = db.getStory(id)
  if (!story) return null
  const rounds = db.listRounds({ storyId: id })
  const last = rounds[rounds.length - 1] ?? null
  return {
    state: story.state,
    round: last ? { n: last.n, estimated_total: last.estimated_total } : null,
    decisions: db.effectiveDecisions(id).filter((d) => !d.superseded_by).length,
    checks_passed: db.listCheckItems(id).filter((c) => c.state === 'pass').length,
    latest_run: db.latestRun(id),
    session: sessionOf(story),
    updated_at: story.updated_at,
  }
}

// ── What to do now ───────────────────────────────────────────────────────────
// Two questions with one answer between them: WHICH story to pick up — `next()`, which is what
// `/k0-next` asks — and, once somebody is looking at one, WHAT to do with it — `nextStep()`, which
// is the button on every post-it and every row. They meet where they should: `next()` hands its
// pick back through `publicStory`, so the sentence the skill reads and the button the page draws
// come out of the same place and cannot drift apart.

/**
 * How long a story may sit before the suggestion stops being "carry on" and becomes "cut it up".
 *
 * Fourteen days is a guess and nothing measured it. It is two weeks of a story not moving, which
 * is long enough that the reason is usually not effort but shape: what is written on the post-it
 * turned out to be two pieces of work, and no amount of doing it as one will close it.
 */
const STUCK_DAYS = 14

/**
 * The one thing to do with this story next, and the sentence saying why it is this and not
 * something else.
 *
 * It is worked out here and never in the browser. These are the same rules `/k0-next` reasons
 * over, and a second copy of them written in the page would be a second answer to one question
 * from the day somebody edited one of the two.
 *
 * `null` is an answer and not a hole: a finished story has nothing left to suggest, and one that
 * came through its counter-check clean is waiting for a person to press Done. Filling either of
 * those in with a command would be inventing work.
 *
 * The story is the flat row `db.listStories()` and `publicStory` both already hold. Two of the
 * rules below need a fact that is not on it — whether anything has been decided about the story,
 * and whether the counter-check left a decision broken — and both are HANDED IN by whoever already
 * counted them rather than asked for here. This is drawn on every row of a board that is asked for
 * once a second by every open tab, and one query written here is two hundred queries a second.
 *
 * Left out, each falls back to asking, because a caller holding one story is not a caller worth
 * making count first. That is why the fallback for `broken` sits inside the `Review` arm, where
 * few stories ever are, and why the board hands `decided` in: `Backlog` is where most of them sit.
 */
export function nextStep(story, known = {}) {
  // Whatever else is true, an open session is where the work is. Sending somebody off to start a
  // second one on the same story is how two half-done things happen.
  if (story.session_alive) {
    return { command: null, label: 'Go to the terminal', action: 'focus', why: 'A session is already open on it.' }
  }
  if (story.state === 'Done') return null

  // Ahead of the rest, because the rest can only see WHICH state a story is in and this is about
  // how long it has been true. `state_since` and not `status_since`: the second one is the live
  // session's clock, so a story whose terminal was abandoned in the spring and whose state moved
  // yesterday would be offered for splitting on the strength of a session nobody has touched.
  const still = daysSince(story.state_since ?? story.updated_at)
  if (still > STUCK_DAYS && (story.state === 'Working' || story.state === 'Planned')) {
    return { command: 'k0-split', label: 'Split it', why: `It has not moved in ${still} days.` }
  }

  if (story.state === 'Review') {
    // Asked only here, and so only of the few stories in Review: it is four queries per story and
    // the board wants an answer on every row it has, once a second.
    const broken = known.broken ?? db.openViolations(story.id).length > 0
    if (!broken) return null
    return { command: 'k0-work', label: 'Put it right', why: 'The last counter-check found a decision broken.' }
  }
  if (story.state === 'Working') {
    return { command: 'k0-verify', label: 'Check it', why: 'The work was left with no session running.' }
  }
  if (story.state === 'Planned') {
    return { command: 'k0-work', label: 'Work on it', why: 'It has a plan and nothing has started it.' }
  }
  if (story.state === 'Discussed') {
    return { command: 'k0-plan', label: 'Plan it', why: 'It has been discussed and has no plan yet.' }
  }
  if (story.state === 'Backlog') {
    // Its epic's decisions count as much as its own, because they are what it will be held to: a
    // story under an epic that has been argued out is not a story nobody has decided anything about.
    const decided = known.decided ?? db.effectiveDecisions(story.id).some((d) => !d.superseded_by)
    return decided
      ? { command: 'k0-plan', label: 'Plan it', why: 'Something has already been decided about it.' }
      : { command: 'k0-discuss', label: 'Discuss it', why: 'Nothing has been decided about it yet.' }
  }
  // A state nothing here knows — a row edited by hand, a database older than this list. Saying
  // nothing is the only honest answer left; guessing would put a command on a command line.
  return null
}

// ── The commands the interface may start ─────────────────────────────────────

/**
 * The nine commands, written out one by one.
 *
 * By name, and never by reading `.claude/skills/`. What leaves here goes onto a command line, and
 * a directory listing is a list other people can add to: a folder arriving in that directory —
 * from a clone, a package, an installer — would become something a request could ask k0 to run.
 * Nine strings in a file cannot grow on their own, and the day there is a tenth command somebody
 * has to come here and say so, which is the point.
 *
 * Every command `nextStep` hands back is on this list and has to stay on it: the button the page
 * draws sends back exactly what it was given.
 */
export const COMMANDS = [
  'k0-story',
  'k0-epic',
  'k0-discuss',
  'k0-split',
  'k0-plan',
  'k0-work',
  'k0-verify',
  'k0-next',
  'k0-order',
]

/**
 * What a session started on a command opens with: `/k0-plan K42`, the line the user would have
 * typed himself. A command with nothing to name — `/k0-epic`, which runs before there is an epic —
 * gets the command on its own.
 *
 * The refusal is a sentence and not a throw because there is a person at the end of it: whatever
 * sent this is something somebody pressed, and a "no" is only useful when it says which nine
 * words would have worked.
 */
export function commandPrompt(raw, key = null) {
  // A leading slash is how these are written everywhere else — in the README, in the skills, in
  // the user's own mouth — so it is taken and dropped rather than left to become a tenth spelling
  // of nine commands that would then be refused.
  const name = String(raw ?? '').trim().replace(/^\/+/, '')
  if (!COMMANDS.includes(name)) {
    const list = COMMANDS.map((c) => `/${c}`).join(', ')
    return { prompt: null, name: null, error: `k0 does not start "${name}". The commands it can start are ${list}.` }
  }
  // The name comes back beside the line it became, spelled the one way this file spells it. It is
  // kept against the session (see `attachSession`), and a session recorded as having been opened
  // with `/k0-plan ` — somebody's spacing — is a session nothing can ask a question about later.
  return { prompt: key ? `/${name} ${key}` : `/${name}`, name, error: null }
}

// Where a story is in its life, most nearly finished first. It is the first thing `next()` sorts
// on: something already planned is closer to being done than something not yet discussed, and
// finishing beats starting.
const READINESS = ['Planned', 'Discussed', 'Backlog']

/**
 * The story to pick up, with the sentence that says why — and it is the server that says it, not
 * the model, so the same board gives the same answer twice.
 *
 * The order, and every part of it is a rule somebody would otherwise argue about:
 *
 * A story already being worked on wins outright. Two things half done is worse than one thing
 * done, and a session that is still alive is the strongest possible signal about where the work
 * is. `Review` comes next for the same reason — it is one counter-check from finished — and among
 * those, the one that has been in Review longest.
 *
 * Then a story stands aside for its own pieces, and then what is not blocked, because starting
 * something that waits on unfinished work is starting it twice. Then the star, which is the user
 * saying so out loud and beats anything computed. Then how ready it is, then the order the board
 * is in, then age.
 */
export function next(repo) {
  // One shape whatever the answer is. A caller that has to find out whether `waiting_for` exists
  // before it can read it will one day forget, and the empty board is the case nobody tests.
  const nothing = { story: null, waiting_for: [], blocked: [] }
  if (!enabled()) return off()
  const all = db.storiesOfProject(repo).filter((s) => s.state !== 'Done')
  if (!all.length) return { enabled: true, ...nothing, why: `There is nothing open in ${projectName(repo)}.` }

  // A story that has been split is not the work any more: its tasks are. Handing back the parent
  // while one of them is still open sends the user to a post-it whose whole content is a list of
  // the others. It only ever pushes down — a parent whose tasks are all done is what closes it.
  const split = new Set(all.map((s) => s.parent_story_id).filter(Boolean))

  const scored = all.map((s) => {
    const deps = db.dependenciesOf(s.id)
    const waiting = blockedBy(deps)
    return { story: s, waiting, alive: !!s.session_alive, review: s.state === 'Review', pieces: split.has(s.id) }
  })

  const rank = (c) => [
    c.alive ? 0 : 1,
    c.review ? 0 : 1,
    // Among the ones in Review, the one that has been sitting there longest. Review is where work
    // goes to be forgotten: the oldest is the one nobody is going to come back to on their own.
    c.review ? (c.story.status_since ?? 0) : 0,
    c.pieces ? 1 : 0,
    c.waiting.length ? 1 : 0,
    c.story.starred ? 0 : 1,
    READINESS.indexOf(c.story.state) === -1 ? READINESS.length : READINESS.indexOf(c.story.state),
    c.story.sort_hint,
    c.story.id,
  ]
  scored.sort((a, b) => {
    const x = rank(a)
    const y = rank(b)
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
    return 0
  })

  const pick = scored[0]
  return {
    enabled: true,
    story: publicStory(pick.story),
    why: reasonFor(pick),
    // What it is waiting for, when it is the best there is anyway: the user has to be able to see
    // that everything is blocked rather than be handed a story with no explanation.
    waiting_for: pick.waiting.map((d) => ({ key: d.key, title: d.title, state: d.state })),
    blocked: scored.filter((c) => c.waiting.length).map((c) => ({ key: c.story.key, title: c.story.title })),
  }
}

/** Whole days, and only ever to put in a sentence: nobody wants a backlog answering "1.7 days". */
const daysSince = (at) => Math.floor((Date.now() - Number(at || 0)) / 86400000)

function reasonFor(c) {
  const key = c.story.key
  if (c.alive) return `${key} has a session running: finish that before starting anything else.`
  if (c.review) {
    const days = daysSince(c.story.status_since)
    const sitting = days >= 1 ? ` and has been for ${days} ${days === 1 ? 'day' : 'days'}` : ''
    return `${key} is in Review${sitting} — one counter-check from done.`
  }
  if (c.waiting.length) {
    const names = c.waiting.map((d) => d.key).join(', ')
    return `Everything open here is waiting on something. ${key} is the best of them, and it waits on ${names}.`
  }
  if (c.story.starred) return `${key} is starred, and nothing it depends on is outstanding.`
  if (c.story.state === 'Planned') return `${key} is planned and unblocked: it can be started now.`
  if (c.story.state === 'Discussed') return `${key} has been discussed and is waiting for a plan.`
  return `${key} is next in the order you put the board in, and nothing is blocking it.`
}

// ── Moving a story to Done ───────────────────────────────────────────────────

/**
 * Whether this story may be marked finished, and why not when it may not.
 *
 * The one rule the whole feature exists for: a decision the last counter-check found broken has
 * to be answered before the story can be called done. Answered means run the check again — not
 * argued with, and not quietly overwritten, which is why `/verify` writes a whole new run rather
 * than editing the one before it.
 *
 * It is a refusal with a reason and never a silent no, and it applies to whatever is asking:
 * the button on the post-it, the button on a list row, a skill.
 */
export function mayFinish(id) {
  const open = db.openViolations(id)
  if (!open.length) return { ok: true, why: null, violations: [] }
  // The run that found it, which is not always the last one there has been: a later run that
  // passed over this decision left the verdict standing without saying anything about it.
  const run = Math.max(...open.map((v) => v.run))
  return {
    ok: false,
    why:
      `Run ${run} found ${open.length === 1 ? 'a decision' : `${open.length} decisions`} broken, and ` +
      'nothing has answered it since. Put it right and run the counter-check again, or supersede the ' +
      'decision if it is the decision that was wrong.',
    violations: open.map((v) => ({ decision_id: v.decision_id, label: v.label, text: v.decision_text })),
  }
}
