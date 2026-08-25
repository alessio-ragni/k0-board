# The database

Everything k0 remembers between one run and the next: the cards, the history of their statuses,
and the handful of switches the server shares with the menu bar icon. It is SQLite, opened through
`node:sqlite` — which is the reason Node 24 is the floor — and it is written by `server/db.js`,
the only file that talks to it.

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
cards appeared on a real board in a column that did not exist.

The journal is in WAL mode, so the file is usually joined by `k0.db-wal` and `k0.db-shm`. All
three belong together — copying only the first copies a board missing its most recent writes.

## `card`

One row per note on the board. Its position in the world is `project_path`, which is the
repository the card belongs to and therefore the column it is drawn in.

| Column | Type | What it holds |
|---|---|---|
| `id` | INTEGER | The card, and what everything else points at |
| `title` | TEXT | What the note says. Required |
| `project_path` | TEXT | The repository it belongs to — the column. Required |
| `prompt` | TEXT | What Claude Code is told when the session starts. May be empty |
| `description` | TEXT | Only imported cards have one; the new-card dialog no longer asks |
| `session_id` | TEXT | The Claude Code session this card owns, or nothing yet |
| `status` | TEXT | Where the card is. See below. Defaults to `BACKLOG` |
| `session_alive` | INTEGER | `1` while that session's process is running |
| `auto_send` | INTEGER | `1` if the prompt is sent without waiting for you to press Enter |
| `completed_at` | INTEGER | When you ticked it off, or nothing |
| `color` | TEXT | The colour of the note. Defaults to `yellow` |
| `sort_hint` | INTEGER | What you dragged: lower comes first, then `id` |
| `terminal_window_id` | TEXT | The terminal window it opened, so a double click can raise it |
| `work_path` | TEXT | Where the session really works, when that is not the repository — an isolated worktree has a working tree of its own |
| `head_at_start` | TEXT | Where the repository stood when the session started: everything after it is this session's doing |
| `imported_at` | INTEGER | Set only on cards dug out of past transcripts |
| `created_at` | INTEGER | Milliseconds. On an imported card, when the session really started |
| `updated_at` | INTEGER | Milliseconds. Moves when you create or edit a card and on every status change of a live session — which is what brings a repository to the top of the list |

**The statuses.** `BACKLOG` (no session yet) · `WORKING` · `PLANNING` · `PLANNED` (a plan is on
screen waiting for you) · `ASK` (a question is on screen) · `IDLE` (your move) · `COMPLETED`.
All of them except `COMPLETED` are derived once a second from what Claude Code writes about the
live session; `COMPLETED` is the one you choose, and it overrides the rest.

**What may be edited from outside.** Only `title`, `description`, `project_path`, `prompt`,
`color`, `sort_hint` and `auto_send`. A request that asks to set a status, claim a session or tick
a card off sideways is ignored rather than obeyed.

## `session_event`

The history: one row each time a card's status actually changes. It is what the age at the bottom
of a note is measured from, and it is deliberately not written when nothing changed — the watching
loop passes over every card every second, and a row per second per card would be a file full of
nothing.

| Column | Type | What it holds |
|---|---|---|
| `id` | INTEGER | The event |
| `card_id` | INTEGER | The card it belongs to. Declared `ON DELETE CASCADE` |
| `status` | TEXT | The status the card moved to |
| `at` | INTEGER | Milliseconds. On an imported card, when it really happened |

Indexed by `(card_id, at DESC)`, which is the only way it is ever read. Deleting a card deletes
its events explicitly as well as by the cascade: an orphaned event keeps the shape of a card you
thought you had thrown away.

## `pref`

Two columns, `key` and `value`, both text. The little the server has to share with the menu bar
icon and remember across a restart — today, the mode. Everything the board alone cares about lives
in the browser's `localStorage`, where only the board can see it, and is not here.

## Reading it by hand

```bash
sqlite3 ~/.k0/k0.db 'SELECT id, status, title FROM card ORDER BY sort_hint, id'
```

k0 holds the file open while it runs. Reading alongside it is fine; writing to it underneath a
running server is not, and the server will not notice.
