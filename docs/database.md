# The database

Everything k0 remembers between one run and the next: the stories, the sessions they are lived
through, what was decided about them, the history of both, the handful of switches the server
shares with the menu bar icon, and the dev servers it has started and is on the hook for. It is
SQLite, opened through `node:sqlite` — which is the reason Node 24 is the floor — and it is
written by `server/db.js`, the only file that talks to it.

**This is the shape the database has today.** It is not a history of how it got here: the
migrations that carry an older board forward live in the code and are of no interest to anyone
reading this. What follows is what you would find if you opened the file right now.

## Where the file is

| | |
|---|---|
| macOS and Linux | `~/.k0/k0.db` |
| Windows | `%LOCALAPPDATA%\k0\k0.db` |
| Anywhere, overridden | `K0_DB` |

`K0_DB` exists for the tests, and they are required to set it: `server/db.js` refuses to open the
real board from a file whose name ends in `.test.mjs`, because it once did, and five identical
stories appeared on a real board in a column that did not exist.

The journal is in WAL mode, so the file is usually joined by `k0.db-wal` and `k0.db-shm`. All
three belong together — copying only the first copies a board missing its most recent writes.

Foreign keys are on. `node:sqlite` switches them on for every connection it opens, unlike the
`sqlite3` command line, and `server/db.js` says so out loud as well; every `ON DELETE CASCADE`
below really does fire.

## The two axes

The thing to understand before reading any of the tables: **what the work is** and **what a
session is doing** are two different questions, and they live in two different places.

- A **story** has a `state`: `Backlog` · `Discussed` · `Planned` · `Working` · `Review` · `Done`.
  Any of them may follow any other — no transition is required, and `Backlog` straight to `Done`
  is a legal thing to do. `Done` is only ever set by you.
- A **session** has a `status`: `WORKING` · `PLANNING` · `PLANNED` (a plan is on screen waiting
  for you) · `ASK` (a question is on screen) · `IDLE` (your move). All five are derived once a
  second from what Claude Code writes about the live process.

The board still draws one word per post-it, and it is the two of them put back together in one
place — the `CASE` in `STORY_COLUMNS`, which every query that returns a story is built from:
`COMPLETED` if the story is done, `BACKLOG` if it has no session, otherwise the session's own
status. It reaches the outside through `listStories`, `getStory`, `getStoryByKey`,
`storiesOfProject`, `storiesOfEpic` and `childStories`, all six of which select through it, so
there is one rule and not six to keep in step. Those seven codes are what every screen, the menu
bar icon and the colours in `web/base.css` have always spoken, and they still are. None of them is
a column: `status` is computed on every read, and `SELECT status FROM story` has nothing to answer.

## `story`

One row per note on the board. Its position in the world is `project_path`, which is the
repository the story belongs to and therefore the column it is drawn in. A **task** is a story
with `parent_story_id` set: same table, same rules, because a story that turned out too big to
close is split, not turned into another species.

| Column | Type | What it holds |
|---|---|---|
| `id` | INTEGER | The story, and what everything else points at |
| `key_num` | INTEGER | The number in `K42`. Per repository, allocated on insert, never reused and never reassigned |
| `title` | TEXT | What the note says. Required |
| `project_path` | TEXT | The repository it belongs to — the column. Required |
| `epic_id` | INTEGER | The epic it sits under, or nothing. `ON DELETE SET NULL`: deleting an epic keeps its stories |
| `parent_story_id` | INTEGER | The story this one was split out of, or nothing. `ON DELETE CASCADE` |
| `prompt` | TEXT | What Claude Code is told when the session starts. May be empty |
| `description` | TEXT | Only imported stories have one; the new-story dialog no longer asks |
| `body` | TEXT | Why this story exists, in the user's own words — the *Why* section |
| `plan` | TEXT | The plan as it was approved |
| `state` | TEXT | Where the work is. See above. Defaults to `Backlog` |
| `starred` | INTEGER | `1` if you have marked it as one to do next |
| `lang` | TEXT | The language the user spoke about it, e.g. `it`. The interface stays in English |
| `completed_at` | INTEGER | When you ticked it off, or nothing. Written only alongside the state `Done` |
| `color` | TEXT | The colour of the note. Defaults to `yellow` |
| `sort_hint` | INTEGER | What you dragged: lower comes first, then `id` |
| `imported_at` | INTEGER | Set only on stories dug out of past transcripts |
| `created_at` | INTEGER | Milliseconds. On an imported story, when the session really started |
| `updated_at` | INTEGER | Milliseconds. Moves when you create or edit a story **and on every status change of its live session** — which is what brings a repository to the top of the list and what keeps the idle sweep from closing a terminal you are using |

Indexed by `(project_path, sort_hint, id)`.

**The key.** `K` + `key_num`, e.g. `K42`, counted per repository and shared between epics and
stories. Two repositories can both have a `K42`; that is intended, a key means something inside
its repository and nowhere else. The counter lives in `key_seq` rather than being a `MAX()`, so a
deleted `K42` is never handed out again. The **alias** — `1.12.1`, the position in the tree — is
computed on the way out and never stored, so it cannot disagree with the tree it describes.

**What may be edited from outside.** Only `title`, `description`, `project_path`, `prompt`,
`body`, `plan`, `starred`, `lang`, `color`, `sort_hint`, `epic_id` and `parent_story_id`. `state`
is accepted too but goes through `setState`, which is the only place `completed_at` is written.
A request that asks to claim a session, invent a key or tick a story off sideways is ignored
rather than obeyed.

## `session`

A real Claude Code session. A story may have had none, one, or several over its life — usually one
at a time — and the newest is "the session" everywhere else in k0.

| Column | Type | What it holds |
|---|---|---|
| `id` | INTEGER | The row |
| `story_id` | INTEGER | The story it belongs to. `ON DELETE CASCADE` |
| `session_id` | TEXT | Claude Code's own session id, or nothing yet |
| `alive` | INTEGER | `1` while that session's process is running |
| `status` | TEXT | What it is doing. One of the five. Defaults to `IDLE` |
| `terminal_window_id` | TEXT | The terminal window it opened, so a double click can raise it |
| `work_path` | TEXT | Where it really works, when that is not the repository — an isolated worktree has a working tree of its own |
| `head_at_start` | TEXT | Where the repository stood when it started: everything after it is this session's doing |
| `auto_send` | INTEGER | `1` if the prompt is sent without waiting for you to press Enter |
| `auto_closed` | INTEGER | `1` when it was k0 that shut the terminal after a long silence, rather than you. Only there to choose one word over another at the bottom of the note; cleared the moment there is a window again |
| `started_at` | INTEGER | Milliseconds |
| `ended_at` | INTEGER | When the process went, or nothing while it is running |

Indexed by `(story_id, started_at DESC)`, which is how the current session is found.

`session_id` is nullable on purpose. A row exists from the moment there is something to remember
about the session that has not started yet — whether it sends its prompt by itself — which is
before Claude Code has given it an id. The board reads a row with no session id as no session at
all, which is exactly what it is.

## `session_event`

The history, and it holds both axes: one row each time a story changes state, and one each time a
live session changes status. It is what the age at the bottom of a note is measured from, and it
is deliberately not written when nothing changed — the watching loop passes over every story every
second, and a row per second per story would be a file full of nothing.

| Column | Type | What it holds |
|---|---|---|
| `id` | INTEGER | The event |
| `story_id` | INTEGER | The story it belongs to. `ON DELETE CASCADE` |
| `kind` | TEXT | `state` or `session`: which of the two axes moved |
| `status` | TEXT | Where it moved to — a state in words, a session status in capitals |
| `at` | INTEGER | Milliseconds. On an imported story, when it really happened |

`kind` is what keeps the age honest. Without it, "how long has it been like this" would match a
story's state against rows written by a session and answer with whichever it found first. With it,
`BACKLOG` and `COMPLETED` — which are not things a session does — are measured from the last
change of state, and everything else from the last time the session went into that status.

Indexed by `(story_id, at DESC)`, which is how the board reads it: the age at the bottom of one
note, one story at a time. The ChangeLog reads it the other way round — everything that moved
between two moments — and that one is a scan, on purpose. The table only grows when something
really changes, so a year of it is thousands of rows and not millions.

Deleting a story deletes its events explicitly as well as by the cascade: an orphaned event keeps
the shape of a story you thought you had thrown away.

## `epic`

One repository's worth of work with a reason behind it. An epic never spans two repositories.

| Column | Type | What it holds |
|---|---|---|
| `id` | INTEGER | The epic |
| `key_num` | INTEGER | Its number, from the same counter the stories draw on |
| `project_path` | TEXT | The repository. Required |
| `title` | TEXT | Required |
| `body` | TEXT | Why this epic exists, in the user's words |
| `state` | TEXT | `Open` or `Done`. Nothing else |
| `lang` | TEXT | The language the user spoke |
| `sort_hint` | INTEGER | The order the epics are drawn in |
| `created_at`, `updated_at` | INTEGER | Milliseconds |

## `decision`

What was decided, one complete sentence per row, numbered per owner and never renumbered: `D3` in
the discussion, in the plan, in the `.k0/` file and in the counter-check has to be the same `D3` a
month later. A decision that changes is **superseded**, not rewritten — the point of the
counter-check is to hold the work against what was actually said at the time.

| Column | Type | What it holds |
|---|---|---|
| `id` | INTEGER | The decision |
| `story_id` | INTEGER | The story it belongs to, or nothing. `ON DELETE CASCADE` |
| `epic_id` | INTEGER | The epic it belongs to, or nothing. `ON DELETE CASCADE` |
| `n` | INTEGER | 1-based, per owner, never reused |
| `text` | TEXT | The decision, in the user's words |
| `source` | TEXT | `discussion`, `plan` or `chat` |
| `superseded_by` | INTEGER | The decision that replaced it, or nothing. `ON DELETE SET NULL` |
| `at` | INTEGER | Milliseconds |

`CHECK ((story_id IS NULL) <> (epic_id IS NULL))` — exactly one owner, never both and never
neither. The epic half is what makes the whole feature work: an epic is discussed and decided
**before a single story of it exists**, so with a NOT NULL story those decisions had nowhere to go
but prose in the epic's body, and prose cannot be counter-checked.

A story's **effective** decisions are its own plus its epic's, inherited and never copied down: a
copy forks the first time one of them is superseded, and then two stories of the same epic are
held to two different rules with the same number on them. An inherited one is shown with its
epic's key in front — `K7·D3` — so nobody reading a run wonders where a rule they never discussed
on this story came from.

Indexed by `(story_id, n)` and by `(epic_id, n)`.

## `decision_check`

One verdict per decision per verification run: the counter-check, written whole by `/k0-verify`.

| Column | Type | What it holds |
|---|---|---|
| `id` | INTEGER | The verdict |
| `story_id` | INTEGER | The story this run belongs to. `ON DELETE CASCADE` |
| `decision_id` | INTEGER | `ON DELETE CASCADE` |
| `run` | INTEGER | Which run, 1-based per story |
| `verdict` | TEXT | `kept`, `violated` or `na` |
| `evidence` | TEXT | `file:line`, or a sentence saying why |
| `at` | INTEGER | Milliseconds |

The story is named here and not left to be read off the decision. An epic's decision is inherited
by every story under it, and it can honestly be kept in one of them and violated in another —
without this column those two verdicts would be the same row twice with nothing to tell them
apart.

Only a whole run is ever written, and only from `/verify`: a request cannot set one verdict to
`kept` on its own. What stands between a story and `Done` is a `violated` verdict that has not been
answered since, and that is read **per decision, not per run**: the verdicts about one decision are
walked in run order and the last word about it is the one that counts. `violated` opens it, a later
`kept` closes it, and `na` does neither — a run that says a broken rule no longer applies is the
escape hatch `/k0-verify` is told not to take, and a run that passes over the decision altogether
says nothing about it at all. Reading only the latest run would let both of those clear a violation
nobody had done anything about.

## `check_item`

The checklist: what has to be true for the story to be finished.

| Column | Type | What it holds |
|---|---|---|
| `id` | INTEGER | The item |
| `story_id` | INTEGER | `ON DELETE CASCADE` |
| `n` | INTEGER | Its place in the list |
| `text` | TEXT | What is to be checked |
| `state` | TEXT | `todo`, `pass`, `fail` or `skip` |
| `evidence` | TEXT | What made it a pass or a fail |
| `by` | TEXT | `claude` or `user` |
| `at` | INTEGER | Milliseconds |

The list is replaced whole, never merged: half an old list and half a new one is neither.

## `dependency`

What waits on what. Two columns, both stories, both `ON DELETE CASCADE`, and together the primary
key. A story is *blocked* when any story it depends on is not `Done`.

## `round`

One round of a discussion — the question asked, the answer given, and how many rounds it looked
like there would be at the time.

| Column | Type | What it holds |
|---|---|---|
| `id` | INTEGER | The round |
| `story_id` | INTEGER | The story it belongs to, or nothing. `ON DELETE CASCADE` |
| `epic_id` | INTEGER | The epic it belongs to, or nothing. `ON DELETE CASCADE` |
| `n` | INTEGER | 1-based, per owner |
| `estimated_total` | INTEGER | "round 3 of about 8", recalculated each time |
| `question` | TEXT | |
| `answer` | TEXT | |
| `at` | INTEGER | Milliseconds |

Owned exactly the way a decision is, `CHECK` included and for the same reason: the rounds that
shape an epic happen before there is a story to hang them on.

Indexed by `(story_id, n)` and by `(epic_id, n)`. A round is written before the next question is asked, so a terminal
that dies at round three does not take the first three with it; writing the same `n` twice
replaces it, because the question going down when it is asked and the answer when it arrives is
one round, not two.

## `story_log`

What happened, in the words of whoever did it: one row per entry, appended and never rewritten.
`id`, `story_id` (`ON DELETE CASCADE`), `session_id`, `text`, `at`.

## `key_seq`

The next key to hand out in each repository: `project_path` (the primary key) and `next`. It is a
counter and not a `MAX()`, which is the whole point — deleting `K42` must not make the next story
`K42` again. A repository the counter has never seen starts above whatever keys are already there,
so a database rebuilt from the `.k0/` files cannot collide with the keys written in them.

## `pref`

Two columns, `key` and `value`, both text. The little the server has to share with the menu bar
icon and remember across a restart — the mode, whether the backlog is switched on, what npm last
said about the version. Everything the board alone cares about lives in the browser's
`localStorage`, where only the board can see it, and is not here.

A `schema.` key is a migration that has run. There is one, `schema.sessions-split`, and it exists
because that migration MOVES ROWS: it takes the session columns off each story and makes a
`session` row out of them. A migration guarded only by the shape of the database — "is the old
column still there?" — runs again the moment one of its steps is allowed to fail quietly, and
running this one twice gives every story two of every session and a `Resume` into a conversation
that never happened. So the shape decides whether there is work to do, this row decides whether it
has already been done, and the whole thing happens inside one transaction.

## `dev_server`

The dev server k0 started for a repository, and is therefore responsible for. One row per
repository, keyed by its path.

| column | | |
|---|---|---|
| `project_path` | TEXT | the repository, and the primary key |
| `pid` | INTEGER | the process k0 spawned — the shell, not the server underneath it |
| `command` | TEXT | what it was told to run, e.g. `npm run dev` |
| `started_at` | INTEGER | when, in milliseconds |

It is deliberately **not** a record of what is running. What is running is read off the machine
every few seconds — who holds which TCP port, and from which directory — and nothing written here
could keep up with that. This is a record of *intent*: a row means "k0 started this and it is
meant to be up". Stopping deletes the row, which is the whole mechanism behind the red globe — a
row whose process has gone was never stopped, so it fell over.

The `command` is also what stops a stale row from becoming dangerous. A pid outlives its process
and the system hands the number out again, so a row is only believed while the process at that pid
is still running the command it was started with.

Servers **you** started, outside k0, have no row at all: they are recognised from the machine each
time and forgotten between readings.

## Reading it by hand

```bash
sqlite3 ~/.k0/k0.db "SELECT 'K' || key_num, state, title FROM story ORDER BY sort_hint, id"
```

k0 holds the file open while it runs. Reading alongside it is fine; writing to it underneath a
running server is not, and the server will not notice.
