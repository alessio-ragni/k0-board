# What an agent is told, and what it owes back

One agent, one assignment, one worktree. The brief is written by the manager and sent with the
`Agent` tool; the agent type is `general-purpose` and the model is the one the session is already
running. Nothing below is optional: a brief missing the decisions is a brief that produces work
somebody has to throw away.

## The brief

```
You are one of several agents working on <KEY> — <story title>.

Your assignment
  <what this assignment finishes, in two or three lines, from the plan step it came from>

Write only here
  <the worktree path>
  Every path you touch is absolute and under it. Nothing is written in the base repository —
  not a file, not a note, not a scratch script. The repository has no .env and no node_modules
  on purpose.

The files that are yours
  <the files this assignment owns>
  Another agent owns the rest right now. Needing a file that is not on this list is a question,
  not a decision: report it and stop touching it.

The constraints — already decided
  D2 — <the decision, verbatim>
  K7·D3 — <the decision, verbatim>
  These are not advice. Work that contradicts one of them is wrong work, however well written.
  If the assignment cannot be done without breaking one, stop and report it.

Never
  no tests, no build, no dev server, no npm run of any kind;
  no git commit, no git merge, no branch, no push, no pull request;
  no call to the k0 API and nothing written to .k0/;
  no work outside your worktree.

When you are done, your final message is the report below and nothing else — no preamble, no
summary for a human. It is read by a program.
```

## The report

The last message is JSON and nothing else:

```json
{
  "done": "what is now true that was not true before, in two or three lines",
  "files": ["path/one.js", "path/two.js"],
  "assumptions": ["a choice taken because nothing decided it, one per line"],
  "questions": ["a question only the user can answer, one per line"],
  "blocked": null
}
```

- `done` is written for whoever reads the Log, not for the user: names of files are welcome.
- `assumptions` is the list the manager turns into Log entries and, at the end, into the things the
  user is told he can overturn. An agent that took no choices returns an empty list — never a
  reassuring sentence.
- `questions` is what the agent could not settle by itself. Where it went ahead anyway it says so
  in `assumptions` as well, so the manager knows which questions have code behind them already.
- `blocked` is a sentence when the assignment could not be finished, and `null` when it could. An
  agent that half-finished says so here rather than in `done`.

## What the manager does with it

The report is not committed and not shown raw to the user. It becomes: a Log entry, an assumption
list, the questions of §7, and — when `blocked` is set — one of the repair attempts of §8. An agent
is never asked to try again on the spot: the budget is counted in one place, and that place is the
manager.
