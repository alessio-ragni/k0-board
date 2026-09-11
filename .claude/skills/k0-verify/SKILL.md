---
name: k0-verify
description: The counter-check on a story whose work is finished — it takes every decision that was made about that story one at a time, not as a group, and records kept, violated or not applicable with the evidence, the file and the line or a sentence saying why it does not apply. Then it runs the checklist, doing itself everything a machine can do (the project's tests, and the browser through Chrome DevTools when the thing is a web application) and leaving the user only what genuinely needs a person. Use this skill when the user types "/k0-verify" or says "check it against what we decided", "verify this story", "did it do what we agreed", "controlla se ha rispettato le decisioni", "verifica la storia", "fai il controllo finale". Do not use it to review code in general, to run the tests on their own, or to mark a story Done: it proposes closing, it never closes.
---

# /k0-verify [story key]

A discussion is only worth what somebody later checks. This is the check. One decision, one
verdict, one piece of evidence — and no summary standing in for the row.

## Before anything

```bash
PORT="${K0_PORT:-4319}"
REPO="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; REPO="${REPO%/.git}"
[ -d "$REPO" ] || REPO="$(git rev-parse --show-toplevel 2>/dev/null)"
curl -sS --max-time 30 --get --data-urlencode "repo=$REPO" \
  "http://127.0.0.1:$PORT/api/backlog" -o "$SCRATCH/k0-board.json"
```

`127.0.0.1`, not `k0.localhost`: browsers resolve that name by themselves, `curl` does not.
`--get --data-urlencode`, not `?repo=$REPO`: a repository path with a space in it makes `curl`
refuse the address outright, and one with a `#` in it quietly sends half.
`$SCRATCH` is the session's scratch directory; nothing is written outside it. `REPO` is the
repository the stories are filed under — the main one, even when this session sits in a
subdirectory of it or inside a session's worktree. That last case is the reason it is not `$PWD`:
`/k0-verify` is typed exactly where `/k0-work` has just been working.

- `curl` cannot connect → the k0 server is not running. Say so (`k0-board start`, or the tray
  icon → *Restart*) and **stop**.
- `{"enabled": false}` → say in one line that the backlog is switched off in k0's settings and
  **stop**.
- `REPO` empty, or an answer with no `stories` in it at all → this is not a checkout, and the
  server said so rather than answering with a board. Say that, ask once which repository the
  story is in, and take the path he gives. It is not an empty backlog: reporting it as one sends
  him looking for stories that were never missing.
- **A listing with `stories: []`** → say that plainly and stop. There is nothing here to check
  against, and it is not a reason to ask the user for what the board would have told you.

That answer holds every story in this repository with its key, state and title, so work
out which story is meant from it — never ask the user for a key you can look up. With no
argument, take the story of the session you are in, or the one in `Working`; if two could be
meant, ask once, showing both.

Then fetch the story and read all of it — rounds, decisions, checks, plan, log:

```bash
curl -sS --max-time 30 "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID" -o "$SCRATCH/k0-story.json"
curl -sS --max-time 30 -X PATCH "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID" \
  -H 'content-type: application/json' -d '{"state": "Review"}'
```

A run of checks is what puts a story in `Review`.

**The run number comes out of that file, not out of your head.** It carries `latest_run`, and the
run you are about to write is **`latest_run + 1`** — `0` there means nothing has ever been checked
and this is run 1. `runs` beside it lists what each earlier run found. Do not count anything
yourself: a run that collides with an earlier one quietly rewrites what was checked last time.

**Put the whole run on tasks before looking at anything.** One task per standing decision, its
subject the label and a few words of the sentence; then one per checklist item — or a single
*write the checklist* when there is none — and a last one for the outcome. A decision's task goes
`in_progress` when you start looking and `completed` when its verdict is written down, with the
verdict and the evidence in its description. Nothing is marked completed on the strength of a
group: the tasks exist so that a skipped decision shows up as a task still open. If `TaskCreate`
is not among your tools, say so in one line and carry on; never call it again to see whether it
has come back.

## 1. Every decision, one at a time

Walk the decisions in the order the file has them. **Never in a group, never as a summary, never
"the rest were all respected".** A decision skipped is the whole failure this feature exists
to prevent.

Each one carries a `label` and an `owner`, and both matter:

- `owner: "story"` — labelled `D3`. Decided about this story.
- `owner: "epic"` — labelled `K7·D3`. Decided about the whole epic, before this story existed,
  and inherited by every story under it. It is checked here exactly like the story's own, and the
  verdict is about **this** story: the same epic decision can be kept in one story and violated in
  another, and that is right, not a contradiction to resolve.

Use the label when you talk about a decision, always. `D3` and `K7·D3` are two different
sentences and a story usually has both.

For each one, go and look. Read the code, the interface, the file it says will exist — do not
answer from what you remember writing.

| verdict | when | evidence |
|---|---|---|
| `kept` | the finished work does what the sentence says | `server/db.js:120` — the file and the line where it is true |
| `violated` | it does not, or it does something else | the file and line where it goes wrong, and one sentence saying how |
| `na` | the sentence cannot apply to this work | one sentence saying why, in the user's language |

`na` is for a decision about something that was never built in this story, and for one that was
**superseded**: the evidence is *superseded by* the label of whatever replaced it, and that one is
what gets checked.

`na` is not an escape hatch. If you cannot find where a decision landed, that is `violated`,
not `na` — "I could not find it" is a finding, not an exemption.

Post the whole run in one call, all decisions together, once you have looked at all of them:

```bash
curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID/verify" \
  -H 'content-type: application/json' -d @"$SCRATCH/k0-verify.json"
```

with `{ "run": 2, "results": [{ "decision_id": 41, "verdict": "kept", "evidence": "…" }, …] }`.
**Name each decision by its `id`**, the row id from the file — not by its number. A story's `D3`
and its epic's `K7·D3` are both "3", and a number would attach half the run to the wrong
sentences. Write the JSON to a file and send it with `-d @file`: evidence sentences carry quotes
and newlines and do not survive being pasted inline.

**A run is the whole set.** The server answers `409` and writes nothing if a decision that is
still standing has no verdict in it, and names the ones it did not find — look at those and send
the whole run again. Nothing is half-recorded, so there is no half-run to repair.

## 2. The checklist

The checklist is what somebody would do to convince themselves the story is finished. If the
story has one, use the items already in `$SCRATCH/k0-story.json` — each carries the `id` you will
mark it with.

If it has none, write one — one line per thing, plain language — post it, and then **fetch the
story again**, because posting replaces the whole checklist and the items you are about to mark
are new rows with ids that did not exist a moment ago:

```bash
curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID/check" \
  -H 'content-type: application/json' -d @"$SCRATCH/k0-checks.json"     # { "items": [{ "text": "…" }] }

curl -sS --max-time 30 "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID" -o "$SCRATCH/k0-story.json"
```

Never `PATCH` a check by an id you have not just read back. A stale id either fails or marks the
wrong line passed, and a checklist that says something was proved when it was not is worse than
no checklist.

**Do yourself everything a machine can do.** The user's time is the scarce thing here; leaving
him a checklist you could have run is handing back your own work.

- **The project's tests** — run them the way the repository runs them, on the branch that holds
  the merged work, never inside a session worktree: the worktree's copied `.env` carries the
  base repository's port, and a runner that reuses a live server goes green against the wrong
  code.
- **The browser, through Chrome DevTools MCP**, when the thing has an interface: open the page,
  do the gesture the decision describes, look at it. A screenshot is evidence; "it should work"
  is not.
- **Anything else with an exit code** — a build, a linter, a script the repository already has.

Record each one as you go, so a terminal that dies keeps what was already proved:

```bash
curl -sS --max-time 30 -X PATCH "http://127.0.0.1:$PORT/api/backlog/check/$CHECK_ID" \
  -H 'content-type: application/json' -d '{"state": "pass", "evidence": "npm test — 214/214", "by": "claude"}'
```

`$CHECK_ID` is the `id` of that item as it came back from the story. `state` is `pass`, `fail` or
`skip`; `by` is `claude` for what you ran.

**What is left for the user** is only what genuinely needs a person: a judgement about how
something feels, a device or an account you do not have, an action with a consequence outside
this machine. Leave those `todo`, list them as a short numbered list with what to look at and
what would count as passing, and mark them `pass` or `fail` with `"by": "user"` from what he
answers. Never mark them yourself.

## 3. The outcome

Present it in the user's language, in this order and nothing more:

1. one line: how many decisions, how many kept, how many violated, how many not applicable;
2. **every `violated` decision in full** — the sentence, quoted, and where it went wrong;
3. **the kept ones, one line each** — the number and the sentence, short. Not a count standing in
   for them: those sentences are the reason he sat through the discussion, and *"the other nine
   were fine"* is exactly the summary this skill exists to refuse. Say where the full record with
   the evidence lives, in one line: the story's page on the board, and the *Verification* section
   of `<repo>/.k0/stories/K42-….md`, which is a plain file he can open six months from now;
4. the checks that failed;
5. the checks still waiting on him.

Then, and only then, the proposal. **You never close anything.** `Done` is the button on the
board, pressed by the user, and nothing else may set it.

- Everything kept, every check passed → say the story looks finished and that pressing **Done**
  on the post-it is what closes it.
- **A `violated` verdict standing unacknowledged → do not propose closing at all.** Not softly,
  not with a caveat. Say what is broken and offer to fix it, or wait for him to say the verdict
  is wrong or that he accepts it — an acknowledged violation is one he has answered, and his
  answer becomes a decision of its own through `/k0-discuss`. Write it the way
  `../k0-discuss/references/rounds.md` says decisions are written — the path is relative to the
  folder this skill was loaded from, and the two skills are siblings wherever k0 is installed —
  and then verify again as a new run.
- Checks still waiting on him → say what you need from him and stop there.

Last, append what happened to the story's log:

```bash
curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID/log" \
  -H 'content-type: application/json' -d @"$SCRATCH/k0-log.json"        # { "text": "…", "session_id": "…" }
```

## Rules

- **Talk to the user in his language, and store what he says in his language.** The evidence
  strings that are file and line stay as they are; the sentences around them are his.
- **Never ask for what the API can tell you** — the key, the state, the decisions,
  what is blocked. It is all in the two calls at the top.
- **Do not invent evidence.** A line number you did not open is worse than no verdict.
- **Do not edit or delete a decision.** Verdicts are recorded against it; the sentence itself
  only ever changes by being superseded, and that is `/k0-discuss`'s job.
- **No files outside the scratch directory.**
- A second run never overwrites the first. Runs stack, and reading them in order is how
  somebody sees that the thing was actually fixed — which is why the run number is read off the
  story rather than assumed.
- **A violation is never cleared by silence, and never by `na`.** It stands until a later run
  finds that decision `kept`, or until the decision itself is superseded because it was the
  decision that was wrong. Those are the two answers, and the board holds you to them: a story
  cannot be marked Done while one is open, whatever any later run says about anything else.
