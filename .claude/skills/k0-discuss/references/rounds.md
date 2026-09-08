# The rounds engine

This is the one place the rules for discussing a story live. `k0-discuss` runs on them, and
`k0-epic`, `k0-split`, `k0-plan`, `k0-work` and `k0-verify` read this file instead of restating
it — they reach it as `../k0-discuss/references/rounds.md`, relative to the folder the skill
itself was loaded from, which is where it is whether k0 runs installed from npm or from a
checkout. If you find these rules written out somewhere else, that copy is wrong and this one
wins.

## Why any of this exists

The person you are talking to has already been through a long, pleasant discussion with a
model that asked good questions, understood the answers, agreed with everything — and then
built something that quietly contradicted half of it. Nothing checked. Nothing compared the
finished work against what had been decided, because nothing had written down what had been
decided in a form anybody could check.

So the discussion was worthless. Worse than worthless: it cost an hour and bought a false
sense that the thing was understood.

Everything below exists to stop that happening again. The questions are not the point. The
point is the row of decisions the questions leave behind, each one a sentence a person can
read six months later and hold the work up against. `/k0-verify` will do exactly that, one
decision at a time. Write them so it can.

---

## 1. How many rounds, and saying it out loud

Before the first question, list the **open unknowns**: the things where a different answer
would produce different work. Not the things you are curious about — the things that fork the
build. A question whose two answers lead to the same code is not an unknown.

Then:

- rounds still needed ≈ open unknowns ÷ 3, rounded up (three, not four: the fourth slot is
  for what an answer opens up);
- estimated total = rounds already run + that;
- say it in the first line of every round: **"Round 3 of about 8"**, in the user's language.

The word *about* is doing real work. It is an estimate and it is allowed to move.

**Recount after every answer**, because answers both close unknowns and create them. When the
number moves, say so in the same breath — one short clause, no apology:

> Round 4 of about 6 — two of the questions answered themselves.

> Round 5 of about 9 — invoicing turned out to have its own states.

**Never let the number drift in silence.** Announcing 8 and then quietly asking a twelfth
question is the thing that makes people stop trusting the count. If you cannot say why the
number moved, the number did not move: you miscounted, and you say that instead.

If the estimate ever climbs past about twelve, stop and say what you are seeing: a story that
needs twelve rounds is usually two stories. Offer `/k0-split`. The user decides.

Every round is written to the API with the estimate it was asked under, so the record shows
what you believed at the time — see §6.

## 2. When to stop

Stop when **no remaining question would change what gets built.** That is the whole test, and
it is stricter than it sounds. Apply it to each unknown still on your list:

- *Would a different answer change the work?* No → drop it, do not ask it.
- *Can it be decided during the work, and cheaply undone if it is wrong?* Then it is not a
  decision for now. Decide it yourself later, and say so in one line.
- *Is it a preference the user will notice the moment he sees it?* Ask.

Do not run a last round to be thorough. Thoroughness here means one more question the user has
to answer to get where he was already going.

**The ceiling is 15 rounds.** At 15 you stop, whatever state the discussion is in. Post the
last round, then show what is still open — a plain list of the unknowns you never got to,
in the user's words — and say the story is recorded as it stands and can be picked up again
whenever he wants. Do not ask a sixteenth question. Do not decide the open ones yourself to
make the list look finished. A discussion that hits 15 is telling you the story is too big;
say that too, and offer to split it.

## 3. How to ask

`AskUserQuestion`, **at most four questions per round**. Four is a ceiling, not a target: two
sharp questions beat four vague ones, and a round of one is fine.

**Never pass `preview` on an option.** With `preview` set on a single-select question the
interface switches to a side-by-side layout and the free-text box — *Type something.* —
disappears. That box is how this user actually answers. He picks one of your options perhaps
half the time; the rest of the time he types the answer you did not think of, and that answer
is usually the good one. Taking the box away to show a nicer layout is a bad trade every
single time. There is no exception.

For each question:

- **One unknown per question.** Two unknowns bundled into one question get one answer, and you
  will not know which one it settled.
- **Two to four options**, and put the **one you recommend first**. You have read the story;
  having no opinion is not neutrality, it is work handed back.
- **The description carries the trade-off**, never a restatement of the label. It says what you
  give up by choosing this. If you cannot name what is lost, you have not understood the
  choice well enough to ask about it.
- Short labels. The description is where the sentence goes.

Good:

> **The user presses Done** — nothing closes a story by itself. Safest, but a finished story
> can sit on the board for days looking unfinished.
>
> **The last check passing closes it** — no housekeeping, but a story can close while you are
> still looking at it.

Bad — the description says the label again:

> **The user presses Done** — the user has to press Done to finish the story.

Then **listen to the free text.** When the typed answer does not match any option, the typed
answer is the answer. Do not re-ask in the hope of getting a clean click.

## 4. When two answers collide

**Before every round**, fetch what has already been recorded and read it — do not trust your
memory of the conversation:

```bash
curl -sS --max-time 30 "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID" -o "$SCRATCH/k0-story.json"
```

Its `decisions` array is everything that binds this story: the decisions taken on it, and the
ones taken on its epic before it existed, which it inherits. Each carries an `owner` — `story` or
`epic` — and a `label`, `D3` or `K7·D3`. There is nowhere else to look: an epic's decisions are
rows on the epic, never prose in its `body`, and `body` is only the Why.

The inherited ones are the ones a later answer most often contradicts, because they were settled
weeks ago about the whole area and nobody in this conversation has said them out loud.

Compare the answer that just arrived against every decision in that list. A collision is when
the two **cannot both be true of the finished work**. A later answer that adds detail to an
earlier one is not a collision; do not cry conflict over a refinement, it teaches the user to
ignore you when it matters.

When they do collide, **stop in the middle of the round.** No next question, no smoothing it
over, no picking the newer one because it is newer.

Put both in front of him, quoted, by number:

> These two do not fit together.
>
> **D3** — A story can go straight from Backlog to Done, and nothing warns about it.
> **just now** — Nothing may leave Review until every check has passed.
>
> I think **D3** should win: you asked for no mandatory path twice, and the check rule only
> bites on stories that got as far as Review. But it is your call.

Say which one you think should win **and why**, in one sentence, and then wait. Do not continue
the discussion until he has chosen.

On the record, **the last answer wins**: the choice becomes a new decision with its own number,
and the loser is marked superseded — never edited, never deleted.

```bash
curl -sS -X POST "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID/decision" \
  -H 'content-type: application/json' -d @"$SCRATCH/k0-decision.json" \
  -o "$SCRATCH/k0-new-decision.json"                                  # → { "id": 148, "n": 9, … }

curl -sS -X PATCH "http://127.0.0.1:$PORT/api/backlog/decision/$OLD_ID" \
  -H 'content-type: application/json' -d '{"superseded_by": 148}'
```

**`superseded_by` takes the new decision's `id`, never its `n`.** They are different numbers and
they look alike: `id` is the row's own, unique across the whole database, and it is what the
answer to the POST carries next to `n`; `n` starts again at 1 on every story, so sending it
points the supersession at some other story's decision, or at nothing. Read the `id` out of the
answer. Never type a number you worked out yourself, and never reuse the one in the example.

**Supersede a decision where it lives, not where it is read.** An epic's decision is superseded on
the epic — one call, and every story under it sees the change at once. That is the whole reason it
belongs to the epic. The only copies that ever need chasing are the ones `/k0-split` made when it
cut a story into tasks, and those are the story's own, not the epic's: if this story has tasks
under it that carry a copy of the decision you are reversing, supersede each of those too, with
that task's own decision `id`. A copy left standing is a rule `/k0-verify` will go on holding the
finished work up against long after the user reversed it.

The old sentence stays readable with *(superseded by D9)* beside it. That is not bookkeeping:
six months on, knowing a decision was made and then reversed is worth more than a tidy list
that pretends it never happened.

## 5. How to write a decision

This is the part the whole feature stands on. A decision is what `/k0-verify` will hold the
finished work up against, one at a time. A decision nobody can check is a decision that was
not made.

- **One complete sentence.** Subject, verb, the thing that will be true. Not a fragment, not a
  heading, not a note to self.
- **Behaviour, not implementation.** What the user will see, do, or be spared. No file paths,
  no table names, no function names, no jargon. He does not read code and should not have to.
- **One decision per line.** Never merge two, however neatly they pair.
- **Never lose one.** Half-swallowed by voice dictation, said badly, said twice in different
  words, dropped into the middle of an answer about something else — it still counts. When a
  sentence came out garbled, read back what you think he meant and ask; do not quietly bin it
  and do not guess.
- **In the language he spoke.** The decisions are for him, not for the repository.
- Write it the moment it is settled, in the same breath as the round it came from (§6).

### Three that work

- Nothing marks a story finished on its own: the user presses Done.
- A story can go straight from Backlog to Done, and nothing warns about it.
- Every post-it shows the name of the epic it belongs to, in that epic's colour.

Each one is a sentence, describes something visible, and can be checked by looking at k0.

### Three that do not

- *Add `epic_id` to the story table and join it in `listStories()`.*
  Implementation, and the two things he would need in order to check it — a table and a
  function — are things he never looks at. Rewritten: *a story remembers which epic it belongs
  to, and keeps it when it is moved.*

- *Colours and states.*
  Not a sentence and not a decision. In six months nobody, including you, can say what was
  agreed. If this is all you have, you did not get an answer: ask again.

- *Use the epic's colour on the post-it, and allow Backlog → Done directly, and keep Done
  manual.*
  Three decisions on one line. When one of them is reversed there is no way to strike only
  that one, so the whole line goes stale and the other two rot with it.

## 6. Write it down before you ask the next thing

**Every round is POSTed before the following question leaves your mouth.** Not batched at the
end, not held in the conversation and written up when the discussion closes.

```bash
curl -sS -X POST "http://127.0.0.1:$PORT/api/backlog/story/$STORY_ID/round" \
  -H 'content-type: application/json' -d @"$SCRATCH/k0-round.json"
```

with `{ "n": 3, "estimated_total": 8, "question": "…", "answer": "…" }` — `n` is 1-based per
story, `estimated_total` is what you announced for *that* round. Decisions go the same way, the
instant they are settled, not when the discussion ends.

The reason is plain: terminals die. A crash at round three must not take the first three with
it, and it must not leave the user re-answering questions he has already answered — that is
exactly the moment people stop using a tool. Write the JSON to a file under `$SCRATCH` and send
it with `-d @file`; long answers with quotes and newlines in them do not survive being pasted
inline.

Resuming is then automatic: fetch `GET /api/backlog/story/:id`, read the rounds and decisions
already there, carry on at the highest `n` + 1, and say where you are picking up from. Never
start again at round 1 on a story that already has rounds.

If `curl` cannot connect, the k0 server is not running. Say so (`k0-board start`, or the tray
icon → *Restart*) and **stop**. Do not run the discussion anyway and promise to save it later:
that promise is the failure this file exists to prevent.

## 7. What you never ask

His time is the scarce thing here. Two kinds of question waste it.

**What the server already knows.** Fetch it; do not ask, and do not reason it out either.

| you want | where it comes from |
|---|---|
| the key, the title, the state | `GET /api/backlog?repo=<path>` |
| which epic, how far along it is | the same call — `progress: {done, total}` |
| what was decided while the epic was discussed | `GET /api/backlog/story/:id` — already merged into `decisions`, marked `owner: "epic"` |
| what is open, what is blocked, the dependencies | the same call — `state`, `blocked`, `deps` |
| the rounds, decisions, checks, plan and log so far | `GET /api/backlog/story/:id` |
| what to pick up next, and why | `GET /api/backlog/next?repo=<path>` |

Counting is not what a model is for. Understanding what he means and writing it down clearly
is. Asking him for a number the database is already holding makes him do the machine's job.

**Anything with an obvious default.** Decide it, and say what you decided in one line he can
push back on — *"I am taking the story's colour from its epic unless you say otherwise"* — and
carry on without waiting. A round spent confirming the obvious buys nothing and spends the
attention you will need for the question that actually matters.

Also never ask: something he has already answered in this session; the same unknown a second
time in different words; permission to continue; or a question whose answer you would ignore.
