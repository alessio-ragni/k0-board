---
name: k0-epic
description: The long way in. The user talks for ten minutes about something big — a feature, a rewrite, a whole area of the product — and this turns it into an epic on the k0 board: rounds of questions until nothing is left that would change the work, a decision written down for each thing settled, and only then a tree of stories proposed for approval and created. Use this skill when the user says "/k0-epic", "new epic", "let me tell you about something big", "I want to think this through with you", "break this down for me", or in Italian "nuovo epic", "ti racconto una cosa grossa", "ragioniamo su questa feature", "spacchettiamo questo lavoro". Do not use it for one thing he already knows he wants — that is /k0-story — nor to discuss, split or plan a story that already exists: those are /k0-discuss, /k0-split and /k0-plan.
---

# /k0-epic

Somebody is about to describe something too big to be one post-it. The work here is in this
order and no other: **understand, record, propose, then write.** Thirty stories created before
he has agreed to them is thirty things he now has to delete.

## Before anything

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
- `{"enabled": false}` → say in one line that the backlog is switched off in k0's settings and
  **stop**.
- `REPO` empty → this is not a git repository. Ask once which repository this belongs to and
  take the path he gives.

That one answer also holds the repository's existing epics and stories. Read it before you open
your mouth: half of what he is about to describe may already be on the board, and saying so is
worth more than a good question.

## 1. Let him finish

He is dictating, probably out loud, probably jumping about. Do not interrupt with round one
while he is still going. When he stops, say back in three or four lines what you understood the
thing to be — not a summary of his words, the shape of the work — and let him correct it.

## 2. Create the epic straight away

As soon as there is a title and a why, before the first question:

```bash
curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/epic" \
  -H 'content-type: application/json' -d @"$SCRATCH/k0-epic.json" -o "$SCRATCH/k0-epic-new.json"
```

with `{ "project_path": "…", "title": "…", "body": "…", "lang": "it" }`. The `body` is why this
epic exists, in his words and his language. The answer carries the `key`, the `alias` and the
`id`; use those from now on and never work them out yourself.

An epic with no stories yet costs nothing and means the next ten minutes survive a dead terminal.

## 3. Run the rounds

The rules for this are in one place and this skill does not repeat them:

**`../k0-discuss/references/rounds.md` — read it now and follow it.** The path is relative to
the folder this skill was loaded from; the two skills are siblings wherever k0 is installed. If
you cannot find the file, say so and **stop** — those rules are the method, and an epic
discussed without them is the long pleasant conversation nobody ever checks.

How many rounds and how to announce them, when to stop, the ceiling, how to ask, what to do when
two answers collide, how to write a decision, and what never to ask: all of it is there and all
of it applies here unchanged.

One thing is particular to an epic: the rounds and the decisions belong to the **epic itself**,
not to a story, and not to its body.

**Write every round on the epic, before the next question.** An epic has rows of its own for
exactly this — there is no need to keep the transcript anywhere, and no reason to.

```bash
curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/epic/$EPIC_ID/round" \
  -H 'content-type: application/json' -d @"$SCRATCH/round.json"
```

`{ "n": 3, "estimated_total": 8, "question": "…", "answer": "…" }`, in his language. Writing the
same `n` twice replaces that round, so the question can go down when you ask it and the answer
when it arrives — that is one round, not two.

**Write every decision on the epic as it is taken.**

```bash
curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/epic/$EPIC_ID/decision" \
  -H 'content-type: application/json' -d '{"text":"…","source":"discussion"}'
```

It comes back with `id` and `n`. Keep the `id`: superseding takes a row id and never a number.

**`body` is the Why and nothing else.** Never grow it into a transcript. A decision written into
prose cannot be counter-checked one at a time, which is the one thing this whole feature is for,
and it cannot be superseded either — the strikethrough is a mark on a paragraph, not a change to
anything `/k0-verify` reads.

**The collision check reads the epic's decisions.** §4 of `rounds.md` says to fetch what is
already recorded before every round rather than trusting your memory of the conversation. Here
that is the epic:

```bash
curl -sS --max-time 30 "http://127.0.0.1:$PORT/api/backlog/epic/$EPIC_ID" -o "$SCRATCH/epic.json"
```

`decisions` is the list, each with `id`, `n`, `text` and `superseded_by`. Everything else in §4
holds: stop mid-round, put both sentences in front of him, say which you think should win and
why, wait. The loser is superseded by the winner's row id:

```bash
curl -sS --max-time 30 -X PATCH "http://127.0.0.1:$PORT/api/backlog/decision/$OLD_ID" \
  -H 'content-type: application/json' -d "{\"superseded_by\":$NEW_ID}"
```

A superseded decision is never deleted — the record of a reversal is worth more than a tidy list
— and every story of this epic sees the reversal at once, which is the reason it lives here.

Resuming after a dead terminal is the same as anywhere: re-fetch the epic, read its rounds and
decisions, carry on at the next number, and say where you are picking up from.

## 4. Propose the tree, and wait

Only when the rounds have stopped. One message, in his language:

- the epic, one line;
- the stories, in the order they would be done — **title, then one line saying what it is**;
- under each, the dependency when there is one: *needs the first one done*;
- what you have deliberately left out, if anything, one line.

No numbering scheme of your own — k0 gives every story a key and an alias the moment it exists,
and inventing a second one now only makes two things to reconcile.

Then ask for the tree as a whole, with `AskUserQuestion` under the rules in §3 of `rounds.md`:
approve it, change it, or cut something. Expect him to move things. Rework the list and ask
again; two passes here are cheap and thirty wrong stories are not.

**If the tree comes out longer than about twelve stories, say so before asking.** An epic that
big is usually two epics, and he decides which.

**Nothing is written until he has said yes.**

## 5. Write it

In this order:

1. **The stories.** One `POST /api/backlog/story` each, with `project_path`, `title`, `body`,
   `lang`, `epic_key` — the epic's key from step 2 — and a **`prompt`**: the sentence a session
   opening on that story starts from. Two lines is enough, in his language, and it always says
   the same two things: what this story is, and that the plan and the standing decisions are on
   the story, so `/k0-plan K42` or `/k0-work K42` is where to begin. Without it a session started
   from the board's button opens cold, and ten minutes of discussion reach the terminal by luck.
   Send each one with `-d @file`.
2. **The decisions: nothing to do.** They were written on the epic in step 3, as they were taken,
   and every story carrying `epic_key` inherits them. `GET /api/backlog/story/:id` returns them
   in the same `decisions` array as the story's own, marked `"owner": "epic"` and labelled
   `K7·D3`, and `/k0-verify` counter-checks them one by one like any other.

   **Do not copy them down onto the stories.** It is the one thing that looks helpful here and is
   not: the copy is a second row saying the same sentence, and the day he reverses `K7·D3` on the
   epic only the epic's changes. The copies stand, and `/k0-verify` goes on holding finished work
   up against a rule he took back.

   A story only gets a decision of its own when something was settled about *that story* and
   about no other — usually nothing was, at this point.
3. **The dependencies.** `POST /api/backlog/dependency` with `{ "story_id": …, "depends_on": … }`,
   using the ids that came back from step 1.

The epic keeps the record: its `body` is the why, its rounds are the discussion, its decisions are
the rules. That is what a later `/k0-discuss` on any story in this epic already has in front of
it, without going looking.

If anything fails, stop and say what got written and what did not. Do not retry blindly and do
not carry on as if the tree were complete.

## 6. Close it

Short, in his language: the epic's key and title, how many stories, and the one to start with —
which you get from `/api/backlog/next` — asked the same way as the listing above, with
`--get --data-urlencode "repo=$REPO"` — and not from your own reading of the list.

## Rules

- **Never write a story before he has agreed to the tree.** This is the rule the skill exists
  for.
- **Everything he says is stored in the language he said it in.** Titles, bodies, decisions.
  The interface stays English; his words do not get translated.
- **Never ask for what the API already knows** — keys, aliases, positions, an epic's progress,
  what is blocked. `rounds.md` §7 has the table.
- **Decisions are written the way `rounds.md` §5 says**, and at the ceiling the discussion stops
  the way §2 says. Neither rule is repeated here, and neither is yours to soften.
- **No files outside the scratch directory**, and never a `git` command that changes anything.
