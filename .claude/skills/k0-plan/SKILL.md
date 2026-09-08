---
name: k0-plan
description: Plans one k0 story in plan mode, with the decisions already taken written into the plan as constraints the plan has to satisfy out loud, then stores the approved plan on the story and moves it to Planned. Use this skill when the user types "/k0-plan" or "/k0-plan K42", or says "plan this story", "let's plan K42", "make the plan before we start", "pianifica questa storia", "facciamo il piano di K42", "prepara il piano". Do not use it to discuss a story that has never been discussed (that is /k0-discuss), to break a story into tasks (/k0-split), or to write any code: this skill plans and never edits a file.
---

# /k0-plan [key]

A plan that quietly contradicts what was already decided is the failure this whole feature
exists to prevent. So the plan carries the decisions in it, in writing, and every step says
which one it serves.

`[key]` is a story key such as `K42`. With no argument, the story is the one this session is
attached to.

## 1. Find the story, and read it

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
- **A listing with no stories in it** → say that plainly. It means this repository has nothing
  on the board, not that you failed to find the story; do not fall back to asking the user for a
  key, a state or a plan the board would have given you.

With a key, take that story. With no key, take the story whose `session` is alive in this
repository; if more than one is, that is the only thing worth asking about — ask which.

```bash
curl -sS --max-time 30 "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID" -o "$SCRATCH/k0-story.json"
```

`$STORY_ID` is the `id` of the story you just matched, not its key. That file holds the body, the
rounds, the decisions, the checks, any plan already stored and the log. Everything else — the
epic, the dependencies, what is blocked — is in the first call. Do not ask the user
for any of it, and do not work it out yourself.

- **No decisions at all** → the story was never discussed. Say so, offer `/k0-discuss`, and go on
  only if the user tells you to plan it as it stands.
- **A plan already stored** → say it exists, in one line say what it plans, and ask whether to
  replace it. A new plan overwrites the old one.
- **A dependency that is not Done** → say which, before planning. The user decides whether to
  carry on.

## 2. Plan mode

Enter plan mode and stay in it. Read the code, follow the story, ask what you must — nothing on
disk changes until the plan is approved, and this skill never changes anything on disk at all.

For questions, `AskUserQuestion`, and the rules that govern them are the ones in
`../k0-discuss/references/rounds.md` — how many rounds and how to say the count, when to stop,
how to ask, and what never to ask. The path is relative to the folder this skill was loaded from;
the two skills are siblings wherever k0 is installed. Read that file; it is not restated here,
and if you cannot find it, say so and **stop**. Planning is usually two or three rounds, not
eight: most of the unknowns were closed by the discussion.

## 3. The constraints go in the plan, in writing

The plan opens with two blocks, above anything technical:

```markdown
## What you get
<one or two sentences, in the user's language: what is different once this is done>

## Constraints — already decided
- **D1** <the decision, word for word as it is recorded>
- **K7·D3** <one inherited from the epic, under the label the story shows it with>
```

Then the plan itself. Rules that make it worth reading:

- **Every decision that is still standing appears.** Copy the sentence as recorded, in the
  language it was written in; do not summarise it, do not translate it, do not tidy it up.
- **Use each decision's `label`, exactly as the story gives it.** The list is the effective set:
  the story's own, labelled `D1`, `D2`, and its epic's, labelled `K7·D3` — decided before this
  story existed and binding on every story under that epic. The epic's key in front is what says
  so, and it matters because the story usually has a `D3` of its own that says something else. A
  plan with two lines both called `D3` is a plan whose constraints cannot be checked, and
  `/k0-verify` will name them the other way round.
- **Leave out the superseded ones.** A decision with `superseded_by` set lost; the one that beat
  it is already in the list.
- **Every step of the plan names the decisions it serves** — by label, `(D2, K7·D3)` at the end of
  the line. A step that serves none is either scaffolding or something nobody asked for; say which.
- **A decision the plan cannot satisfy stops the plan.** Do not plan around it and do not
  reinterpret it. Put it in front of the user, say what it collides with, say which you think
  should win and why, and wait — the collision rules are §4 of `rounds.md`.
- The rest of the plan is a plan: what gets touched, in what order, what could go wrong. Keep it
  short enough to be read in one sitting.

Anything settled while planning is a **new decision**, written the moment it is settled, in the
user's language, one sentence about behaviour and not implementation (§5 of `rounds.md`):

```bash
curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID/decision" \
  -H 'content-type: application/json' -d @"$SCRATCH/k0-decision.json"   # {"text": "…", "source": "plan"}
```

## 4. When the user approves it

Two calls, in this order:

```bash
curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID/plan" \
  -H 'content-type: application/json' -d @"$SCRATCH/k0-plan.json"        # {"text": "<the whole plan>"}

curl -sS --max-time 30 -X PATCH "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID" \
  -H 'content-type: application/json' -d '{"state": "Planned"}'
```

Store the plan **as it was approved**, in the user's language, the constraints block included —
it is what `/k0-work` reads and what `/k0-verify` holds the finished work up against. Write the
JSON to a file under `$SCRATCH` and send it with `-d @file`: a plan pasted inline dies on its
first quote or newline.

Then one more call, **only if the story has no checklist yet**. Write one from the plan — a
handful of lines, each something the user could look at and tell whether it is true:

```bash
curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID/check" \
  -H 'content-type: application/json' -d @"$SCRATCH/k0-checks.json"      # {"items": [{"text": "…"}]}
```

**Leave a checklist that already exists alone.** This call replaces the whole list, so on a story
that already has one it does not add lines, it destroys the ones somebody wrote by hand. When
there is already a checklist, this third call does not happen at all.

## 5. Close

Two lines: the story is `Planned`, and `/k0-work` is what does it. Do not start the work, do not
open a worktree, do not touch a file. That is the next skill's job, and the separation is the
point: a plan that begins implementing itself was never a plan.
