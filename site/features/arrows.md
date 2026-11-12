---
title: Arrows between notes
card: Drag an arrow from one note to another, across repositories, to say this one waits on that one.
summary: Draw arrows between Claude Code sessions on the k0 board, across repositories, to show which story waits on which — then close or finish a whole chain at once.
kicker: this waits on that
order: 125
since: 0.10.0
updated: 2026-11-12
related: backlog, statuses, idle-close
---

## Work is joined up, and a board of separate notes does not say so

A handover that needs a fix in another repository first. A release that waits on three stories.
With a dozen sessions open, which of them belong together is something you carry in your head —
until you draw it. An arrow goes **from the note that waits to the note it waits on**, and it can
leave one repository's column and land in another's.

## Why it matters

The arrow is the same fact k0 already used for *waits on*: while the story at the far end is not
`Done`, the one that waits carries a small chain mark and asks once before it is started. It is a
note to yourself, never a lock. What is new is that you draw it with the pointer, you can see the
whole chain at a glance, and you can act on the chain as one thing.

## How to use it

- Put the pointer on a note: an **arrow mark** appears at the bottom right, left of the sun.
  **Press it and drag** onto another note, then let go. The board slides when you near an edge, so
  a note three columns away is reached by dragging towards it.
- **The story it waits on is not written yet?** Let go over the `+` at the head of a repository's
  column, or over its name, instead of a note. The new-story dialog opens on that repository and
  says which note will wait on it; start the story and the arrow is already there. Close the
  dialog and nothing is left behind.
- The board at rest shows **no arrows**. A note that has some keeps its mark lit, with the count.
  Put the pointer on it and its whole chain is drawn; click the mark and it stays until you click
  elsewhere.
- **Click an arrow** for two words: **Flip** turns it round, **Remove** takes it away.
- On the note the arrows leave, **Close** offers to close the sessions of the stories it waits
  on, and **Done** offers to mark them done too. *Only this one* is always the other answer.
- In a terminal, `/k0-arrows` tells Claude what the story of that session is joined to — in any
  repository, with where each one stands and what its log last said — and draws, removes or
  turns an arrow when you say so: *link this to K58*.

## Small print

- An arrow that would leave stories waiting on each other for ever is refused, and k0 says which
  stories: *K12 already waits on K7*.
- A finished story keeps its arrows, faded. An arrow shows only when both its notes are on the
  board, so with `Done` hidden those are gone. A deleted story takes its arrows with it.
- Closing or finishing a chain follows the arrows the way they point, never back up them, and
  leaves alone any session that is working.
- Arrows need the [backlog](/features/backlog/) switched on. The list view writes them as
  *waits on* in the panel beside a row instead of drawing them.
