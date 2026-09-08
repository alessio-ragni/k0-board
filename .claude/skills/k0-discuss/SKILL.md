---
name: k0-discuss
description: Takes a story that is already on the k0 board and still too vague to build, and discusses it in rounds of questions until the decisions behind it are written down one by one. Appends to the rounds and decisions the story already has instead of starting the conversation again. Use this skill when the user types "/k0-discuss", or says "discuss K42", "this story is too vague", "let's talk it through before I start", "pick up the discussion on K19", "parliamo di K42", "questa storia è troppo vaga", "riprendiamo la discussione su K19", "discutiamo prima di partire". Do not use it to create a story from nothing (that is /k0-story or /k0-epic), to break up a story that will not close (/k0-split), or to plan one whose decisions are already recorded (/k0-plan).
---

# /k0-discuss [key]

A story on the board says what it is called and not much else. This turns it into something
buildable: rounds of questions, and a row of decisions somebody can hold the finished work up
against six months from now.

`[key]` is `K42`, or nothing — with nothing, work out which story from what the user just said.

## The rules of a round live in one file

Read `references/rounds.md` — it sits in this skill's own folder — and follow it. How many rounds
and how to say it, when to stop, the fifteen-round ceiling, how to ask, what to do when two
answers collide, how to write a decision, and why every round is written to the API before the
next question is asked: all of that is there and none of it is repeated here.

**If you cannot read that file, say so and stop.** Those rules are the method. Running the
discussion without them produces exactly the pleasant, unchecked conversation the whole feature
exists to prevent.

What follows is only what is particular to discussing a story that already exists.

## Procedure

1. **Find the story, and check the feature is on.**

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
     **stop**. Do not run the discussion anyway and do not offer to turn it on.
   - `REPO` empty → this is not a git repository. Ask once which repository this belongs to and
     take the path he gives.

   The listing carries every key, title and state. Match the key the user gave, or the
   title he described. If two stories match, ask which one; never pick one and hope. If the
   listing has no stories at all, say so — an empty board is not the same as a story you failed
   to find, and it usually means the work has never been written down here.

2. **Read everything already recorded.**

   ```bash
   curl -sS --max-time 30 "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID" -o "$SCRATCH/k0-story.json"
   ```

   `$STORY_ID` is the `id` of the story you matched in step 1, not the key. Rounds, decisions,
   plan, checks, log. This is the whole point of the skill: a second discussion that ignores the
   first one is worse than no second discussion, because it spends the user's evening asking him
   things he has already answered.

3. **Say where you are picking up from**, in one line, before the first question:

   > K42 already has four rounds and six decisions from 3 September. Round 5 of about 7.

   On a story with no rounds yet, say that instead and start at round 1.

4. **Run the rounds** exactly as `references/rounds.md` describes. Every round POSTed before the
   next question leaves your mouth, every decision POSTed the moment it is settled.

5. **Close the account.** The new decisions, by number, in his words — a short list, not a
   retelling of the conversation. Then, unless the story is already `Planned`, `Working`,
   `Review` or `Done`, move it on:

   ```bash
   curl -sS -X PATCH "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID" \
     -H 'content-type: application/json' -d '{"state": "Discussed"}'
   ```

   Then one line saying what comes next — `/k0-plan K42` — and stop there. Do not start planning.

## Rules

- **Append, never replace.** New decisions get new numbers. One that contradicts an older one
  goes through the collision rule in §4 of `references/rounds.md`: the old sentence is marked
  superseded by the new one's `id`, never edited and never deleted. Nothing in this skill sends
  a `DELETE`.
- **The body is his, not yours.** If the discussion changes what the story is fundamentally
  about, `PATCH` the `body` — but with his sentences, in his language, and say that you did.
- **A story mid-flight is still discussable.** `Working` or `Review` is not a reason to refuse.
  It is a reason to read the log first, and to say out loud that work has already started, so
  that a new decision contradicting what is built is recognised as the rework it is.
- **Talk in the language the user speaks, and store what he says in that language.** The story
  carries a `lang`: if it is empty, set it from the language of the discussion.
- **Never ask what the API can tell you** — the key, the epic, the dependencies, what
  is open, how far the epic has got. It is in the two calls above. See §7 of `references/rounds.md`.
- **No files outside the scratch directory**, and never write into `.k0/` by hand: the server
  mirrors the story there on its own.
