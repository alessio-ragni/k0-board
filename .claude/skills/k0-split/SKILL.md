---
name: k0-split
description: Breaks a k0 story that will not close — too big, or open for weeks — into tasks that inherit the parent's decisions and context, so nothing has to be explained a second time. Reads what the story already holds, says plainly what it based the split on, proposes the tasks and creates them under the parent once the user agrees. Use this skill when the user types "/k0-split", or says "split K42", "this story is too big", "it has been open for weeks", "break it into pieces", "spezza K42", "questa storia è troppo grande", "dividila in task", "non si chiude mai". Do not use it to create unrelated stories (that is /k0-story), to discuss a story that is merely vague (/k0-discuss), or to decide what to work on next (/k0-next).
---

# /k0-split [key]

A story that has been in `Working` for three weeks is not a story any more. This cuts it into
tasks that live under it, each one small enough to finish, and each one carrying the decisions
that already apply to it — so the first thing a task does is not re-explain the story.

`[key]` is `K42`, or nothing — with nothing, work out which story from what the user just said.

## Procedure

1. **Find the story, and check the feature is on.**

   ```bash
   PORT="${K0_PORT:-4319}"
   REPO="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; REPO="${REPO%/.git}"
   [ -d "$REPO" ] || REPO="$(git rev-parse --show-toplevel 2>/dev/null)"
   curl -sS --max-time 30 --get --data-urlencode "repo=$REPO" \
     "http://127.0.0.1:$PORT/api/backlog" -o "$SCRATCH/k0-backlog.json"
   ```

   `127.0.0.1`, not `k0.localhost`: `curl` does not resolve that name. `--get --data-urlencode`,
   not `?repo=$REPO`: a repository path with a space in it makes `curl` refuse the address
   outright, and one with a `#` in it quietly sends half. `$SCRATCH` is the session's
   scratch directory; nothing is written outside it. `REPO` is the repository the stories are
   filed under — the main one, even when this session sits in a subdirectory of it or inside a
   worktree, which is why it is not `$PWD`.

   - `curl` cannot connect → the server is not running. Say so (`k0-board start`, or the tray
     icon → *Restart*) and **stop**.
   - `{"enabled": false}` → say in one line that the backlog is switched off in k0's settings and
     **stop**.
   - `REPO` empty → this is not a git repository. Ask once which repository this belongs to.
   - A listing with no stories in it → say so and stop; there is nothing here to split.

   Match the key the user gave, or the title he described. If two stories match, ask which one.
   A story that already has tasks can still be split further; a task itself cannot be split
   again. If the user points at one, say so and offer its parent instead.

2. **Read everything the story holds.**

   ```bash
   curl -sS --max-time 30 "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID" -o "$SCRATCH/k0-story.json"
   ```

   `$STORY_ID` is the `id` of the story you matched in step 1, not its key — which is why this
   call comes after that one and not beside it. Rounds, decisions, plan, checks, log.

3. **Say what you are splitting on, before you propose anything.** Four lines at most, and every
   one of them a fact from the two files you just read — not an impression:

   > K42 · Fix the invoicing API — `Working` since 12 August, 9 decisions, 2 of them superseded,
   > a plan from 20 August, and a log whose last entry says the export is done and the retries
   > are not.

   If there are no decisions and no plan, say that too: *the split is based on the story's Why
   and its log, nothing else has been recorded.* The user needs to know how thin the ground is
   before he agrees to stand on it.

4. **Propose the tasks.** Two to five. More than five and you are not splitting the story, you
   are rewriting the epic — say that instead and stop. For each one:

   - a title of a handful of words, in his language;
   - one line saying what it finishes — a piece that can reach `Done` on its own;
   - **the decisions it inherits, by label**: `D1, D4, D7`. A superseded decision is never
     inherited; the one that superseded it is.

   Only the story's **own** decisions are shared out this way — the ones whose `owner` is
   `story`. The epic's, labelled `K7·D3`, go to every task automatically because every task
   carries the parent's `epic_key`: do not list them here and do not divide them up. Say in one
   line that they carry over, and leave them alone.

   Every decision of the story's own that is still standing must land on at least one task. If one
   lands on none, either you missed a task or the decision was about something already finished:
   say which, out loud, rather than letting it fall on the floor.

5. **Ask once.** `AskUserQuestion`, under the rules in §3 of
   `../k0-discuss/references/rounds.md` — the path is relative to the folder this skill was
   loaded from, and the two skills are siblings wherever k0 is installed. Read that file rather
   than working from memory, and if you cannot find it, say so and **stop**. Ask whether the cut
   is right, with the alternative cuts you considered as the other options. If the answer opens
   genuine unknowns, run rounds on them the way that file describes — do not invent your own
   rules. Usually one question is enough.

6. **Create the tasks.** One `POST` each, `parent_key` set to the parent's key, `epic_key` and
   `lang` copied from the parent:

   ```bash
   curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/story" \
     -H 'content-type: application/json' -d @"$SCRATCH/k0-task-1.json"
   ```

   `body` is the context the task inherits, in the user's language: why the parent exists,
   condensed to what this task needs, and the sentence that says which slice it owns. It is
   written so that somebody opening the task alone, six weeks from now, does not have to open
   the parent to understand it.

   Then copy each of the **parent's own** decisions that this task inherits onto it, **verbatim**,
   one call each. Never an epic decision: the task already has those, through `epic_key`, as the
   same rows the parent has. Copying one makes a second row saying the same sentence, and the day
   the user reverses it on the epic only the epic's changes — `/k0-verify` goes on checking the
   task against a rule he took back. A decision copied is a decision that forks.

   ```bash
   curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/story/$TASK_ID/decision" \
     -H 'content-type: application/json' -d @"$SCRATCH/k0-decision.json" \
     -o "$SCRATCH/k0-new-decision.json"
   ```

   Copied verbatim means copied: same sentence, same language, same wording. Rewording an
   inherited decision to fit the task is how a decision quietly changes meaning, and `/k0-verify`
   would then be checking the work against something the user never said.

   **Numbering starts again at 1 on the task, so write down where each one came from.** The
   parent's `D4` may well be the task's `D2`, and the user approved a list that said `D1, D4, D7`.
   Each `POST` answers with the new decision's `n`: put the correspondence at the end of the
   task's `body`, one line, in his language —

   > Decisions inherited from K42: D1 here is K42's D1, D2 is K42's D4, D3 is K42's D7.

   — and repeat it in the parent's log in step 8. Without it, `/k0-verify` reports on `D1, D2, D3`
   and the man reviewing his own decisions has nothing to tie them back to.

7. **Order them if the order matters.** When one task genuinely cannot start before another
   finishes, record it and say so in the same breath:

   ```bash
   curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/dependency" \
     -H 'content-type: application/json' -d '{"story_id": 91, "depends_on": 90}'
   ```

   A dependency is a note, not a lock: it marks the task and never stops anybody starting it.
   Do not invent an order to look tidy — two tasks that could be done in either order get no
   dependency.

8. **Write the split into the parent's log**, one line, in his language, then say what you did.

   ```bash
   curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID/log" \
     -H 'content-type: application/json' -d @"$SCRATCH/k0-log.json"
   ```

   The account is short: the keys and titles of the tasks that were born, and which of the
   parent's decisions each one carries, by the parent's numbers. Then stop. Do not start working
   on the first one.

## Rules

- **The parent survives.** It is not deleted, its decisions are not moved, its state is not
  changed, and its rounds stay where they are. It becomes the place the tasks came from, and it
  closes when they are done — by the user pressing `Done`, as always.
- **A copied decision lives in two places, and both have to move together.** That is the cost of
  the copy, and it is why only the parent's own decisions are ever copied: when one is later
  reversed, the copy on the task is superseded too — §4 of `rounds.md` says how. An epic's
  decision is never copied and so never has this problem: it is one row, reversed once.
- **Nothing is decided that was not decided.** A split redistributes what is already recorded.
  If a task needs an answer nobody has given, it is an open question you name in step 4, not a
  decision you write on the user's behalf.
- **Say what you based it on, always.** Step 3 is not a courtesy. A split proposed without
  showing its ground is a guess wearing a plan's clothes, and the user has no way to tell.
- **Talk in the language the user speaks, and store what he says in that language.**
- **Never ask what the API can tell you** — the state, the age, the decisions, the plan, the log,
  the epic, the dependencies are all in the two calls in steps 1 and 2. See §7 of `rounds.md`.
- **No files outside the scratch directory**, and never write into `.k0/` by hand: the server
  mirrors the tasks there on its own.
