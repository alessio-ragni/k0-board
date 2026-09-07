# The method

You have had this conversation. You explain a piece of work to a model, properly, for half an
hour. It asks good questions. You answer them, and some of the answers surprise you — you did not
know what you wanted until it asked. It says it has understood, and it has: the summary it gives
back is better than the one you would have written.

Then it builds something that quietly contradicts half of it.

Not all of it, and not obviously. One of the things you settled at minute twenty is simply not
there, and a thing you ruled out is there instead. You do not notice for three days, and when you
do, you cannot even prove you said it. The conversation has scrolled away. What is left is code
that looks finished and a vague feeling that you had agreed on something else.

That half hour did not just fail to help. It cost you the half hour, and it bought a false sense
that the thing was understood — which is worse than knowing it was not, because you stopped
watching.

Everything below is one attempt at fixing that. It is a method, not a feature, and it is made of
four pieces: decisions that are objects, questions that come in rounds, a counter-check that
happens after the work rather than before it, and two doors into the whole thing — a fast one and
a slow one.

## A decision is an object, not a sentence in a document

The usual place a decision goes is a document. A plan, a spec, a long comment in a ticket, the
transcript of the conversation itself. All of those are prose, and prose has one property that
ruins it for this job: **you cannot point at one piece of it and ask a question about only that
piece.**

Try it. Take a plan you wrote last month and ask *was this respected?* You cannot ask it about the
plan. You have to read the plan, decide what its claims were, and then check each one — and by the
time you have done that you have written the list you should have had in the first place. Nobody
does this. What actually happens is somebody skims the document, finds nothing that jumps out, and
says yes.

So in k0 a decision is a row, not a sentence in a paragraph. It has a number that never changes,
`D4`. It has a date. It can be superseded by another decision and it can never be edited or
deleted. And every time the work is checked, each decision gets its own verdict recorded against
it: kept, violated, or does not apply, with the file and the line where that is true.

It belongs to a story, or to an epic — and the difference matters more than it sounds. Most of
what you decide while discussing one piece of work is about that piece of work. But an epic is a
whole area, and the first three things you decide about an area are true of every story in it. So
an epic keeps decisions of its own, taken while you were still talking about the area and before a
single story of it existed, and every story under it **inherits** them. On a story they show up
with the epic's key in front — `K7·D3` — so it is obvious where the rule came from and how far it
reaches, and the counter-check goes through them one by one exactly like the story's own.

They are inherited, never copied. Copy `K7·D3` onto the four stories it applies to and you have
four decisions, and the day you take it back you take back one of them: the other three go on
holding finished work up against a rule you no longer hold. Supersede it on the epic and every
story sees it change in the same instant, which is the point of the epic owning it.

That sounds like bookkeeping. It buys three things that prose cannot:

**You can be asked about it one at a time.** A model checking twenty decisions in a document will
tell you they were all respected, because that is what a summary of twenty things sounds like. A
model checking `D1`, then `D2`, then `D3`, with a verdict and a line number to produce for each
one, cannot get to the end without having actually looked twenty times. The shape of the record
forces the shape of the check.

**A reversal stays visible.** You will change your mind — that is normal, and half the value of
the discussion is that it makes you change it early. When you do, the old decision is not
rewritten. It is marked superseded by the new one and stays exactly where it was. Six months
later, knowing that something was decided and then reversed is worth far more than a tidy list
pretending it was always this way. A document that gets edited loses that every time.

**It survives being read by somebody who was not there.** Which, in three months, includes you.

There is a rule about how a decision is written, and it is the part people get wrong: **a decision
describes behaviour, never implementation.** Not *add an `epic_id` column and join it in the
listing* but *a story remembers which epic it belongs to, and keeps it when it is moved.* One
complete sentence, one decision to a line, no file names, no function names, in whatever language
you were speaking. The test is simple: could you check it yourself, by looking at the thing, in
six months, without reading any code? If not, it is a note, not a decision, and nothing will ever
be able to verify it.

## A round of questions

The questions are not the point. The row of decisions they leave behind is the point. But the
questions have to be good, and left to itself a model asks them badly in two directions at once:
it asks far too many, and it asks the wrong ones.

So they come in rounds. A round is at most four questions, asked together, and every round opens
by saying where you are: **"round 3 of about 8"**. The number is an estimate, it is allowed to
move, and when it moves you are told why in the same breath — *round 4 of about 6, two of the
questions answered themselves.* The word *about* is doing real work there. What is not allowed is
the number drifting in silence: announcing eight and then quietly asking a twelfth is the thing
that makes anybody stop trusting a count.

The stopping rule is one sentence: **stop when no remaining question would change what gets
built.** It is stricter than it sounds, and it kills most of what a model wants to ask you.
Would a different answer produce different work? If not, do not ask. Can it be decided later and
undone cheaply if it is wrong? Then it is not a question for now — decide it during the work and
say so in one line. Is it a preference you will notice the second you see it? That one, ask.

There is a hard ceiling of fifteen rounds. At fifteen it stops wherever it is, shows you what is
still open in your own words, and says so: a discussion that needs fifteen rounds is telling you
the story is two stories.

Two more rules matter more than they look.

**Every round is written down before the next question is asked.** Not batched up and saved at the
end. Terminals die, laptops sleep, contexts run out; a crash at round three must not take the
first three with it, and it must certainly not make you answer them again. That is the moment
people abandon a tool for good.

**A conflict stops the conversation.** Before each round, what has already been recorded is read
back — not remembered, read. If the answer you just gave cannot both be true with something you
said at round two, everything halts right there. Both sentences are put in front of you, quoted,
by number, with an opinion about which should win and one sentence of why, and then it waits. Your
answer becomes a new decision and the loser is marked superseded. The one thing that never happens
is the newer answer quietly winning because it is newer.

## The counter-check

This is the part that makes the rest worth doing, and it is the part almost nothing else has.

When the work is finished, somebody has to hold it up against what was decided — and it cannot be
the same conversation that just built it, agreeing with itself. So it is a separate pass with a
single job: go through the decisions one at a time, in order, and for each one **go and look**. Not
remember. Look at the code, open the page, do the gesture the decision describes.

Each one gets a verdict and a piece of evidence:

- **kept** — the file and the line where the thing the sentence promised is true;
- **violated** — where it goes wrong, and one sentence saying how;
- **does not apply** — one sentence saying why, which is only ever because the story never touched
  that, or because the decision was superseded and the one that beat it is the one being checked.

*Does not apply* is not an escape hatch. If it cannot find where a decision landed, that is
**violated** — "I could not find it" is a finding, not an exemption.

Then the checklist, and the rule there is about your time: **anything a machine can do, the machine
does.** The tests, the build, the linter, the browser driven through the page and the screenshot
to prove it. What is left for you is only what genuinely needs a person — how something feels, an
account nobody else has, an action with a consequence out in the world. A checklist handed back
full of things it could have run itself is somebody else's work arriving as your work.

And then the outcome, which has a shape: how many decisions and how they came out, every violated
one in full, the kept ones one line each, then what failed and what is waiting on you. Never a
count standing in for the rows. *The other nine were fine* is exactly the sentence this whole
thing exists to refuse.

Two things it never does. It never closes anything: a story is finished when you press **Done**,
and nothing else may press it. And a run never overwrites the last one — runs stack, and reading
them in order is how you see that the thing you complained about actually got fixed.

What it saves you from is narrow and worth naming precisely. It does not make the work good. It
makes the work **checkable against what you said**, which is a different and much smaller claim:
the failure it removes is the one where you find out in March that in January you were ignored.

## The fast path and the slow path

Most of what you want to write down is not worth a discussion. *The export breaks on invoices with
no VAT number.* You know what you mean, you will know what you meant next week, and being asked
four questions about it is an insult dressed as diligence.

So there are two doors, and the difference between them is the only thing you have to decide.

**The fast path** is one command and one line back. You say the thing; it lands on the board as a
post-it with a key of its own, `K42`, in the language you said it in, and if you added *and start
it* a session opens on it in the same breath. No rounds, no questions, no confirmation, no summary
of what it understood. Two calls and a receipt. Speed is the whole feature, and a story is allowed
to be thin: half a thought, written down, is worth more than a thought you had to be interviewed
about.

**The slow path** is for the ten-minute thing — a feature, an area, a rewrite. You talk until you
are finished, without being interrupted; it says back the shape of the work, not a summary of your
words; and then the rounds start. At the end you get a tree of stories proposed for approval, and
**nothing is written until you have said yes** — thirty stories created before you agreed to them
is thirty things you now have to delete. What you decided along the way is already recorded, on
the epic, from the first round: the stories inherit it when they appear, and nothing is copied
down into them. A decision copied is a decision that forks the first time you change your mind.

You are not choosing between them once and for ever. A thin story that turns out to matter gets
discussed later, and gets its rounds then. One that will not close gets cut into pieces that carry
its decisions with them — and go on inheriting the epic's — so the first thing the next session
does is not explain the story again.
The path is a property of the moment, not of the work.

## Where all of this ends up

In a database, because that is what makes a decision an object. But also, next to your code, in a
plain folder of Markdown files — one per story, with the discussion, the decisions, the plan, the
verification runs and the log, in the language you were speaking. You can read them without k0
running, grep them, commit them if you want to, and if the database is ever lost they are what it
is rebuilt from.

That matters for one reason. A method that only exists inside a tool is a method you have to keep
the tool to keep. This one is a folder of text files that happen to have a board on top of them.
