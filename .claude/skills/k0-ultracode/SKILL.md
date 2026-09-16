---
name: k0-ultracode
description: Runs a whole epic — or one story — as a manager with agents under it: it takes what the board already knows, cuts the plan into assignments, hands each one to an agent working in an isolated copy of the repository, brings the work back one piece at a time, and closes every story with the tests, a fresh pair of eyes and the counter-check before moving to the next. Use this skill when the user types "/k0-ultracode" or "/k0-ultracode K7", or says "run the whole epic", "take this and go", "do it with agents", "hand it to the manager", "fallo tutto tu", "porta avanti l'epica", "usa gli agenti", "vai fino in fondo". Do not use it to talk a story through (that is /k0-discuss), to write a plan and stop (/k0-plan), to do one story by hand in one session (/k0-work), or to push, tag or release anything (/commit-push-deploy).
---

# /k0-ultracode [key]

One manager, several agents, and a board that says at every moment where the work is.

`[key]` is an epic such as `K7` or a story such as `K42`. With no argument, the story is the one
this session is attached to. With something that is not a key — a sentence, a file — there is
nothing on the board yet, and §2 puts it there before anything else happens.

Three words are used here and nowhere else in k0. The **manager** is you, this session. An
**assignment** is one slice of a plan. An **agent** is a subagent that carries out exactly one
assignment in a copy of the repository of its own. Agents never speak to the user: everything the
user hears comes from the manager.

## 1. Find what you were pointed at

```bash
PORT="${K0_PORT:-4319}"
REPO="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; REPO="${REPO%/.git}"
[ -d "$REPO" ] || REPO="$(git rev-parse --show-toplevel 2>/dev/null)"
curl -sS --max-time 30 --get --data-urlencode "repo=$REPO" \
  "http://127.0.0.1:$PORT/api/backlog" -o "$SCRATCH/k0-backlog.json"
```

`127.0.0.1`, not `k0.localhost`: browsers resolve that name by themselves, `curl` does not.
`--get --data-urlencode`, not `?repo=$REPO`: a repository path with a space in it makes `curl`
refuse the address outright, and one with a `#` in it quietly sends half. `$SCRATCH` is the
session's scratch directory, and nothing is written outside it and the worktrees of §6.

- `curl` cannot connect → the k0 server is not running. Say so (`k0-board start`, or the tray
  icon → *Restart*) and **stop**.
- `{"enabled": false}` → say in one line that the k0 backlog is switched off and **stop**.
- `REPO` empty → this is not a git repository. Ask once which repository this belongs to and take
  the path he gives.

An epic key gives the epic and the stories under it, in the order the board already has them and
with the dependencies it already knows. A story key gives one story. If two things could be meant,
ask once, showing both.

## 2. Nothing on the board yet

A sentence said out loud, a document, an idea: it goes onto the board first, because everything
after this reads the board and nothing else.

- Something big — a feature, an area of the product → `/k0-epic`: its rounds, its decisions, its
  tree of stories, approved before a line is written.
- One thing he already knows he wants → `/k0-story`, and carry on here.

Follow those skills rather than paraphrasing them. When they are done there is a key, and §3 starts
on it.

## 3. Ask once: how much rope, and how hard

One `AskUserQuestion`, two questions, and **never a `preview` on an option** — the free-text box
disappears when there is one, and this is the moment he is most likely to want it.

**How much rope** — `interactive`, `checkpoint` or `autonomous`. **How hard** — `light`, `medium`
(the default) or `hard`. What each one means, how many agents it allows at once, how many repair
attempts it buys and where it stops is in `references/modes.md`. Read it now and hold it for the
whole run; the path is relative to the folder this skill was loaded from.

Say the answer back in one line — "autonomous, medium: three agents at a time, two repair
attempts, and I come back when the epic is done or when something is genuinely stuck" — and write
that same line into the Log of the epic, or of the story when there is no epic. That line is the
contract, and §9 reads it back after a crash.

## 4. One story at a time

Stories are taken in the board's order, and a story whose dependencies are not `Done` waits for
them. A story is finished — merged, tested, counter-checked — before the next one starts. On an
epic that is the whole point: a mistake caught in the first story is a mistake the other six never
inherit.

For each story, §5 to §8, then a Log entry saying it is closed, then the next one.

## 5. Decisions, a plan, and the cut

```bash
curl -sS --max-time 30 "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID" -o "$SCRATCH/k0-story.json"
```

`$STORY_ID` is the `id` of the story, not its key.

- **No decisions** → the rounds of `../k0-discuss/references/rounds.md`, which is also where the
  shape of a decision and the collision rule live. In `autonomous` only the questions that would
  change the work get asked; the rest you settle yourself and write down as assumptions (§8), never
  as decisions.
- **No plan** → write one in the shape `/k0-plan` gives it: `## What you get`, then
  `## Constraints — already decided` listing every standing decision verbatim **by `label`**, then
  steps that each end with the labels they serve. Store it and move the story on:

  ```bash
  curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID/plan" \
    -H 'content-type: application/json' -d @"$SCRATCH/k0-plan.json"      # {"text": "…"}
  curl -sS --max-time 30 -X PATCH "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID" \
    -H 'content-type: application/json' -d '{"state": "Planned"}'
  ```

- **The decisions that are still standing** are the constraints every agent works under. Leave out
  any with `superseded_by` set, and call each one by its `label` and never by its number: an
  inherited one is `K7·D3`, and the story may have a `D3` of its own saying something else entirely.

Then cut the plan into **assignments**, and cut it by file:

- two assignments that would write the same file are one assignment, or they are done one after the
  other — never at the same time;
- an assignment that cannot be described without naming another one is not ready to be cut;
- where the repository's own `CLAUDE.md` asks for documentation with every change — k0's does — the
  last assignment of every story is the documentation and the changelog line.

One `TaskCreate` per assignment, in order, plus one for the merge and one for the counter-check;
exactly one `in_progress` at a time. If `TaskCreate` is not among your tools, say so in one line and
carry on with the Log alone — never call it again to see whether it has come back.

Write the cut into the Log before an agent is spawned: what each assignment is, which files it
owns, which of them run together. In `interactive` and `checkpoint`, show it and wait.

## 6. The worktrees

Every agent writes in a copy of the repository of its own, and the manager owns all of them.

```
<the branch you are on>
└─ k0u-K42                the story's own branch      → $SCRATCH/k0u/K42
   ├─ k0u-K42-a1          assignment 1                → $SCRATCH/k0u/K42-a1
   └─ k0u-K42-a2          assignment 2                → $SCRATCH/k0u/K42-a2
```

```bash
git -C "$REPO" worktree add -b "k0u-$KEY" "$SCRATCH/k0u/$KEY" HEAD
git -C "$REPO" worktree add -b "k0u-$KEY-a1" "$SCRATCH/k0u/$KEY-a1" "k0u-$KEY"
```

From the branch you are on — not `main`, not `origin`. No `git pull`, no `git fetch`, no checking
out anything else first: if the user is on a feature branch, that is the branch this work belongs
to and the branch the merge goes back into.

They live in the session's scratch directory rather than in `.claude/worktrees/`, which belongs to
k0 and is swept by the server. They have no `.env` and no `node_modules`, and that is not an
oversight: it is the physical reason an agent cannot start a server or run a suite even if it
forgets it was told not to.

k0's own `POST /api/backlog/worktree` is not used here. It records one worktree against one
session, and `POST /api/backlog/story/:id/start` opens a real terminal window — on an epic of eight
stories that would be eight windows. The board stays honest all the same, because the state and the
Log are written by the manager.

## 7. The agents

One agent per assignment, `general-purpose`, on the model this session is already running. How many
run at once is the number `references/modes.md` gave you in §3 and no more: a fourth agent waits for
a free slot rather than starting.

What an agent is handed and what it owes back is `references/agent-brief.md` — the assignment, the
standing decisions verbatim by label, the path of its worktree as the only place on disk it may
write, and the shape of its report. Read it before spawning the first one.

An agent cannot ask the user anything. It comes back with its questions written down, and they are
the manager's to answer: in `interactive` they go to the user as they arrive; in `checkpoint` they
are held to the next stop; in `autonomous` you answer them yourself unless the answer would
contradict a standing decision — that one always comes back to the user — and each answer becomes
an assumption in the Log.

An agent that comes back empty, or that says it could not do the assignment, is not retried on the
spot. That is a repair, and repairs are counted and spent in §8.

## 8. Back together, then the only things that are ever run

The agents' branches come into the story's branch one at a time, in the order the assignments were
cut:

```bash
git -C "$SCRATCH/k0u/$KEY" merge --no-ff "k0u-$KEY-a1"
```

A conflict here means the cut was wrong. In `interactive` and `checkpoint`: stop, show which files,
let the user decide. In `autonomous`: resolve it only where the conflict is inside the files that
assignment owned and a standing decision says which side wins; otherwise leave that assignment out,
say so plainly, and carry on with the rest — the good work still goes in.

Then the story goes into the branch the run started on:

```bash
git -C "$SCRATCH/k0u/$KEY" add -A && git -C "$SCRATCH/k0u/$KEY" commit -m "…"   # if anything is pending
git -C "$REPO" merge --no-ff "k0u-$KEY"
```

One line, Conventional Commits, English, written from the diff, saying what changed for the person
using this project rather than which function moved. The base repository must be clean first: if it
is not, stop and say so rather than committing somebody else's work.

**Never `git push`. Never a pull request.** Not with a flag, not because the branch tracks a remote,
not to be helpful. What leaves this machine leaves it through `/commit-push-deploy`, and only when
the user asks.

Then, in the base repository and nowhere else:

1. **The tests.** `npm test` in k0, and whatever the repository says its gate is anywhere else.
   This is the only thing this skill ever runs, and it runs here because here the code on the disk
   is the code that was merged. Inside a worktree it would be a green run against the wrong code.
2. **A fresh pair of eyes.** An agent that wrote none of it reads this story's diff against the plan
   and the standing decisions and tries to knock it down. On `hard`, two of them with a lens each —
   one on the decisions, one on correctness — and a third asking what the plan forgot.
3. **The repairs.** Red tests, or a finding worth acting on: one agent, in the base repository,
   committing `fix: …`. Two attempts on `medium` and `hard`, one on `light`. After the last one,
   stop. Say in one line what is still broken and leave everything else merged — work that passes
   is not held hostage by work that does not.
4. **The counter-check.** `/k0-verify` on this story: the state goes to `Review`, every standing
   decision gets `kept`, `violated` or `na` with its evidence, and the run goes in one call. Do not
   set `Done`: `Done` is the button the user presses, and nothing else may press it.

Last, put the worktrees away — whatever happened, including after a failure:

```bash
git -C "$REPO" worktree remove --force "$SCRATCH/k0u/$KEY-a1"
git -C "$REPO" branch -D "k0u-$KEY-a1"
```

A run that ends with a `k0u-*` branch still standing is a run that lied about being finished.

## 9. Picking it up cold

The Log is the state of this run and there is no second copy of it. Each of these gets an entry the
moment it happens — on the story, and on the epic when a story closes:

- the line from §3 saying which mode and how hard;
- the cut into assignments, before any agent starts;
- each assignment as it lands, with the files it touched;
- each assumption taken alone;
- the merge, the tests, the counter-check, and anything left out.

So a session that runs out of context, or a terminal somebody closed, costs nothing but the
assignment that was in flight. Running `/k0-ultracode` again on the same key reads the Log, says in
one line where the last run got to, and starts from the first assignment that never landed. Nothing
the Log records as merged is ever done twice.

## 10. Close

To the user, in his language, and nothing after it:

**Cosa ho fatto** — what is different now, story by story: whether the tests were green, what the
fresh pair of eyes said, how the counter-check came out.

**Cosa resta a te** — the assumptions taken alone, so he can overturn any of them with
`/k0-discuss`; the assignments left out and what they needed; whatever the repairs did not fix; and
that the stories are sitting in `Review` waiting for him to press `Done`, which is his and nobody
else's.
