---
name: k0-work
description: Carries out a planned k0 story inside its own git worktree — opens the worktree through k0 from the branch you are on, does the work there, writes to the story's Log as it goes so a session that runs out of context hands over cleanly, then merges back into that same branch and destroys the worktree. Never pushes and never opens a pull request. Use this skill when the user types "/k0-work" or "/k0-work K42", or says "start the work", "do it", "let's build K42", "carry on with this story", "fai il lavoro", "inizia a lavorare su K42", "mettiti al lavoro", "riprendi la storia". Do not use it on a story with no stored plan (that is /k0-plan), to check the finished work against the decisions (/k0-verify), or to push, tag or release anything (/commit-push-deploy).
---

# /k0-work [key]

The work of one story, from an empty worktree to a merge, with a Log that lets somebody else —
or this same session after a compaction — pick it up cold.

`[key]` is a story key such as `K42`. With no argument, the story is the one this session is
attached to.

## 1. Find the story

```bash
PORT="${K0_PORT:-4319}"
REPO="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; REPO="${REPO%/.git}"
[ -d "$REPO" ] || REPO="$(git rev-parse --show-toplevel 2>/dev/null)"
curl -sS --max-time 30 --get --data-urlencode "repo=$REPO" \
  "http://127.0.0.1:$PORT/api/backlog" -o "$SCRATCH/k0-backlog.json"
```

`127.0.0.1`, not `k0.localhost`: browsers resolve that name by themselves, `curl` does not.
`--get --data-urlencode`, not `?repo=$REPO`: a repository path with a space in it makes `curl`
refuse the address outright, and one with a `#` in it quietly sends half.
`$SCRATCH` is the session's scratch directory; nothing is written outside it. `REPO` is the
repository the stories are filed under — the main one, even when this session sits in a
subdirectory of it or inside a worktree, which is why it is not `$PWD`.

- `curl` cannot connect → the k0 server is not running. Say so (`k0-board start`, or the tray
  icon → *Restart*) and **stop**.
- `{"enabled": false}` → say in one line that the k0 backlog is switched off and **stop**.
- `REPO` empty → this is not a git repository. Ask once which repository this belongs to and
  take the path he gives.
- **A listing with no stories in it** → say that plainly and stop. An empty board is not a story
  you failed to find, and it is never a reason to ask the user for the plan the board would have
  handed you.

With a key, take that story; with none, the one whose `session` is alive here. If two could be
meant, ask once, showing both.

## 2. Read it, and earn the right to start

```bash
curl -sS --max-time 30 "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID" -o "$SCRATCH/k0-story.json"
```

`$STORY_ID` is the `id` of the story you matched in step 1, not its key — the call needs the id,
which is why it could not go in the same block as the listing that gives it to you.

Then read the story file and obey what is in it:

- **No plan** → stop. Say the story has never been planned and point at `/k0-plan`. A worktree is
  never opened before there is a plan: work that starts without one is work that gets thrown away.
- **No session** — `session` is `null` → start one, and say in one line that you did. A story
  planned on the board and then picked up in a terminal the user opened himself has no session
  row, and that is the ordinary case, not an error:

  ```bash
  curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID/start" \
    -H 'content-type: application/json' -d '{}'
  ```

  The answer carries the story with its new `session`. Use the `session.id` from it in step 3.
  Never open a worktree by hand and never invent a session id.
- **A Log with entries** → this is a handover, not a fresh start. Read it, say in one line where
  you are picking up, and carry on from there. Never redo what the last session recorded as done.
- **The decisions that are still standing** are the constraints you work under. Keep that list in
  front of you. **Leave out any decision with `superseded_by` set** — it was reversed, the one
  that beat it is already in the list, and honouring a reversed rule is both wrong work and,
  worse, a false alarm in step 3 that teaches the user to ignore the real ones.
- **Call each decision by its `label`, never by its number.** The list is the story's own
  decisions *and* its epic's: an inherited one is labelled `K7·D3` and binds every story under
  that epic, while the story may have a `D3` of its own saying something else entirely. Two
  different sentences both called "D3" is how the wrong rule gets honoured and the right one
  quietly dropped.
- The key, the epic, the dependencies, the checks and the session are all in those two
  files. Do not ask the user for anything they already say.

The server sets the story to `Working` by itself when the session goes live. If the API still
shows something else, set it once and move on:

```bash
curl -sS --max-time 30 -X PATCH "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID" \
  -H 'content-type: application/json' -d '{"state": "Working"}'
```

**Then turn the plan into tasks — every time, before the worktree.** One `TaskCreate` for each
step of the stored plan, in the plan's order: the subject is the step in a few words, the
description is the step in full with the labels of the decisions it serves. On a handover, only
the steps the Log does not record as done. The merge (§6) and the closing entry (§7) are tasks
too, the last two. From then on:

- exactly **one** task `in_progress` at a time, set with `TaskUpdate` when the step starts — not
  after it is over;
- `completed` the moment that step is really done, never in a batch at the end;
- a step the plan did not foresee becomes a new task the moment you find it, and a step that turns
  out to be unnecessary is deleted with one sentence saying why.

The tasks are for whoever is watching this terminal now; the Log is for whoever picks the story up
cold. Keep both — neither stands in for the other.

If `TaskCreate` is not among your tools, say so in one line — the session was not opened by k0, or
Claude Code is older than the commands; on newer models Claude Code only offers the task tools
when `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` is in the environment — and carry on with the Log alone.
Never call it again to see whether it has come back.

## 3. Open the worktree

```bash
curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/worktree" \
  -H 'content-type: application/json' -d "{\"session\": $SESSION_ID, \"action\": \"open\"}"
```

`$SESSION_ID` is `session.id` from the story you just fetched: the **row id, a number**. It is
not `session.session_id`, which is the Claude Code session's own long text id — the field is
called `session` and takes a number so the two cannot be confused.

The answer is `{"ok": true, "path": "…", "branch": "wt-K42", "base": "…"}`. **`path` is the
worktree**, and it is the only place you may write from here on; call it `$WORK`. If `ok` is
false, the answer says why in a sentence meant to be read out — say it and stop. Do not guess a
directory and do not fall back to the repository: that is the one thing this step exists to
prevent.

k0 branches **from the branch you are on** — not from `main`, not from `origin`. Do not check out
another branch first, do not `git pull`, do not `git fetch`. If the user is on a feature branch,
that is the branch this work belongs to, and the merge at the end goes back into that one.

From here every path you touch is absolute and under `$WORK`. Nothing is written in the base
repository — not a file, not a note, not a scratch script.

## 4. Do the work, and write the Log as you go

Follow the plan. Where the plan turns out to be wrong, say so and adjust; where the change
contradicts a decision that is still standing, **stop and ask** before writing the code — that
collision is §4 of `../k0-discuss/references/rounds.md`, and the same file says how a decision is
written. The path is relative to the folder this skill was loaded from; the two skills are
siblings wherever k0 is installed, and if you cannot find the file, say so rather than inventing
the rule. Anything newly settled goes to the API the moment it is settled:

```bash
curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID/decision" \
  -H 'content-type: application/json' -d @"$SCRATCH/k0-decision.json"   # {"text": "…", "source": "chat"}
```

**Append to the Log after every meaningful step** — not at the end, not in one lump. The same
moment is when that step's task goes to `completed` and the next one to `in_progress`:

```bash
curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID/log" \
  -H 'content-type: application/json' -d @"$SCRATCH/k0-log.json"
```

with `{"text": "…", "session_id": "<session.session_id>"}`. Write the JSON to a file under
`$SCRATCH` and send it with `-d @file`; pasted inline it dies on the first quote or newline.

A Log entry is two or three lines in the user's language and answers exactly two questions:
**what is now done**, and **what is left, and where it was left**. Names of files are welcome
here — this one is read by whoever continues, not by the user over a coffee. Write it as though
the session ends immediately after the call, because sometimes it does.

## 5. Never run anything in the worktree

No tests, no build, no dev server, no `npm run` of any kind, inside `$WORK`. The reason is
concrete: the `.env` that came across with the worktree carries the **base repository's port**, so
a runner that finds a live server there reuses it — and that server is serving the base
repository's code. The run goes green against code you did not write, which is worse than no run
at all, because it is believed.

The tests belong on the base branch after the merge, where the server serves the merged code.
Whether they run there is the repository's business, not this skill's.

## 6. Merge, and put the worktree away

```bash
curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/worktree" \
  -H 'content-type: application/json' -d "{\"session\": $SESSION_ID, \"action\": \"merge\"}"
```

The same `session` row id as in step 3. k0 commits whatever is pending in the worktree with a
message written from the diff — Conventional Commits, one line, English — merges it `--no-ff` into
the branch it came from, removes the worktree and deletes its branch.

The answer says `hooks: true` when a commit was made. That commit ran the repository's own
`pre-commit` hook, **inside the worktree** — so if that hook runs a test suite, the suite it ran
was the one next door, with the copied `.env`. Say so in one line when it happens: it is the same
trap as §5, arriving from the other direction, and the run that counts is the one after the merge.

**Never `git push`. Never a pull request.** Not with a flag, not because the user's branch tracks
a remote, not to be helpful. What leaves this machine leaves it through `/commit-push-deploy`, and
only when the user asks.

If the merge comes back with a conflict, **stop**. Say which files, leave the worktree standing,
and let the user decide. Do not guess a resolution and do not delete anything.

## 7. Close — and say that nothing has been checked yet

A last Log entry saying the work is merged and what is in it. Then, to the user, in his language:

1. one line: what is different now;
2. one line that does not get softened — **no decision has been checked against the finished work
   yet.** Read the story's `decisions` and say how many are standing and waiting. Pressing `Done`
   now closes a story nobody counter-checked, and the discussion that produced those decisions was
   then worth nothing.
3. offer to run the counter-check now. If he says yes, follow `/k0-verify` on this story before
   anything else. If he says no, leave it — but he has been told, and the story goes to the board
   knowing it.

Do not set the story to `Review` — `/k0-verify` does that when it starts a run. Do not set it to
`Done` under any circumstances: `Done` is the button the user presses, and nothing else may press
it.
