---
name: k0-next
description: Answers "what do I do now" from what the k0 server already knows — the order the stories are in, the star, the dependencies that are not done yet, what is open, and what has been sitting in Review waiting for somebody to look at it. One call and a sentence, not a round of reasoning. Use this skill when the user types "/k0-next" or says "what should I do now", "what's next", "pick the next story", "what do I pick up", "cosa faccio adesso", "cosa mi conviene fare", "qual è la prossima storia", "da dove riparto". Do not use it to decide priority — that is /k0-order — to discuss a story, or to guess an order the server has not been told.
---

# /k0-next

One question, one answer: what to pick up in this repository right now.

```bash
PORT="${K0_PORT:-4319}"
REPO="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; REPO="${REPO%/.git}"
[ -d "$REPO" ] || REPO="$(git rev-parse --show-toplevel 2>/dev/null)"
curl -sS --max-time 30 --get --data-urlencode "repo=$REPO" \
  "http://127.0.0.1:$PORT/api/backlog/next"
```

`127.0.0.1`, not `k0.localhost`: browsers resolve that name by themselves, `curl` does not.
`--get --data-urlencode`, not `?repo=$REPO`: a repository path with a space in it makes `curl`
refuse the address outright, and one with a `#` in it quietly sends half.
`$SCRATCH` is the session's scratch directory; nothing is written outside it. `REPO` is the
repository the stories are filed under — the main one, even when this session sits in a
subdirectory of it or inside a worktree, which is why it is not `$PWD`.

If `curl` cannot connect, the k0 server is not running: say so (`k0-board start`, or the tray
icon → *Restart*) and **stop**. If the answer is `{"enabled": false}`, say in one line that the
backlog is switched off in k0's settings and **stop**. If `REPO` is empty — or the answer carries
an `error` and no story at all — this is not a checkout and the server refused the question: say
so, ask once which repository he means, and take the path he gives. That is not an empty backlog
and must never be reported as one.

**If the answer names no story at all**, do not report an empty backlog yet. Ask the board
itself, once, and let it say which of the two things is true:

```bash
curl -sS --max-time 30 --get --data-urlencode "repo=$REPO" \
  "http://127.0.0.1:$PORT/api/backlog" -o "$SCRATCH/k0-backlog.json"
```

`enabled` false → the feature is off, and that is what you say. An `error` and no `stories` key →
the repository was not recognised, which is the answer above and not an empty board. Stories
present but none ready → say what is blocking them. `stories: []` → say the board is empty for
this repository.
"Nothing to pick up" and "the backlog is switched off" look identical from `/next` alone, and
telling a man his backlog is empty when it is merely off is the one answer worse than no answer.

The answer is otherwise the story to pick up and **why** — the server has already weighed the
order, the star, the dependencies, how long something has been in `Review`. That reasoning is
done. Do not redo it, do not second-guess it, and do not fetch the whole board to check its work.

## What to say

Three lines at most, in the user's language:

> **K42 · 1.12 — Fix the API when the token expires.** Starred, nothing blocking it, and it is
> the first thing in the order.
>
> K37 has been in Review for four days.

The key, the title, the one sentence of why, and — only when the answer carries
one — the thing that has been waiting. **Then stop.** No question, no box, no "shall I start it".
He asked what to do next and he has been told; what he does with that is his next message.

If that next message says to start it, this is the call:

```bash
curl -sS --max-time 30 -X POST "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID/start" \
  -H 'content-type: application/json' -d '{"auto_send": false}'
```

That opens a Claude Code session on the story, the same way the board's button does.

## Rules

- **One call.** The second one happens only when `/next` came back empty, or when he asks for a
  shortlist rather than the next thing — and then show three rows, not the board.
- **Never ask a question here.** The answer to "what now" is an answer, not a discussion, and a
  question box on a read-only lookup is the beat this skill exists to skip.
- **Never invent an order.** If the server says nothing is ready — everything blocked, or the
  backlog empty — say that plainly and say what is blocking it. Do not pick something anyway.
- **Never start the session unasked**, and never move a state.
- Talk to the user in his language. The keys and the state names stay as they are.
