# How much rope, and how hard

Two questions, asked once, in §3 of `/k0-ultracode`. One `AskUserQuestion` with both of them in it,
and no `preview` on any option — a single-choice question with a preview loses the free-text box,
and this is the moment the user is most likely to want to type something of his own.

## How much rope

**`interactive`** — everything passes the user. Each assignment is shown as it lands, each question
an agent brings back is asked while it is still warm, each conflict is his to settle. The slowest,
and the one to offer when the work touches something he cares about.

**`checkpoint`** — three stops and no others: the cut into assignments before any agent starts,
the moment before the story goes into the branch, and a red test run. Questions from agents are
held and asked in a batch at the next stop.

**`autonomous`** — no stops. Assumptions are taken and written down, and the run comes back when
the epic is finished. It stops early for three things and nothing else:

- an answer that would contradict a decision that is still standing;
- a conflict that cannot be resolved inside the files one assignment owned;
- the tests still red after the last repair attempt.

Autonomous means autonomous. A mode that asks anyway is the mode the user did not choose, and the
question that could have waited for the final block should have waited for it.

## How hard

| | agents at once | repair attempts | the fresh pair of eyes |
|---|---|---|---|
| `light` | 2 | 1 | one agent |
| `medium` (default) | 3 | 2 | one agent |
| `hard` | 5 | 2 | two agents, a lens each — the decisions, correctness — and a third asking what the plan forgot |

The numbers are ceilings, not targets: three slots do not mean three assignments, and a plan that
cuts into two is done by two. A fourth agent waits for a slot rather than starting.

Nothing here loops until it runs out of things to find. The repair attempts are spent and then the
run says what is still broken — that is the difference between this and a run that never ends.

## Saying it back

One line to the user, and the same line into the Log, before anything starts:

> autonomous, medium: three agents at a time, two repair attempts, and I come back when the epic is
> done or when something is genuinely stuck.

A run picked up cold reads that line first and keeps the contract the user agreed to, rather than
choosing a new one on his behalf.
