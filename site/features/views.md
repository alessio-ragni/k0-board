---
title: Kanban to work, List to plan
card: The same stories two ways: a board of notes for the day's work, and rows of epics, stories and tasks for planning it.
summary: k0 shows your Claude Code stories two ways — Kanban, a column of notes per repository, and List, every epic, story and task as rows to plan with.
kicker: same stories, two shapes
home: yes
order: 20
since: 0.5.0
updated: 2026-11-14
related: backlog, statuses, always-on
---

## One switch, two shapes

The switch in the top bar, in among the filters, says **Kanban** or **List**. It changes the shape
of what you are looking at and never *what* you are looking at: the state pills, the repository
and the epic lane apply to both, so nothing appears or vanishes when you switch.

**Kanban is for working.** The board you already know — one column per repository, notes that
reorder themselves by who is waiting for you. A note at rest is small: its **key**, like `K42`, and
how long it has been in its state on the top line, the title, and one thin line under it. The
repository is not repeated on it — it is at the top of the column — so a column holds many more.
With a [backlog](/features/backlog/) behind it a note carries four marks and no more: the key; its
**epic**, as a small label in the epic's own colour; a **flag** in the bottom corner; and a warning
when something it **waits on** is not finished.

**List is for planning.** The same stories as rows, every repository at once: a heading per
repository, epics that open and close with their progress bar, stories under them, and tasks
indented beneath the story they were cut from. A row carries key, title, state, flag, how many
decisions are still standing and how much of the checklist has passed.

## Why two

Working and planning ask different questions. While working it is *which one needs me now*, and a
board of coloured notes answers that from across the room. While planning it is *what is left, and
in what order*, and that wants everything at once, in rows you can run your eye down.

## How to use it

- Stop the pointer on a note and it opens: its notes, its epic and its buttons come out, and the
  notes below move down. It stays open while the pointer is in that column; leave the column and
  they all close.
- Click **Kanban** or **List** in the top bar.
- Hover a note and click the flag in its bottom corner. Once on, the note takes a border in the
  flag's colour, so you can find it from across the room; click again to take it off.
- Click an epic's label and the board becomes that epic: a strip under the top bar shows a progress
  bar, `4 of 11 done`, and the way back out. It survives a reload.
- In List, click a row and the story opens **beside it** — its rounds, decisions, plan, checklist
  and log — so the rows you were comparing stay on screen.
- Drag a row to reorder it, or onto another epic to move it there.
- Open a story with the pencil to keep **notes** on it: they show on the post-it when it opens,
  and are never sent to Claude Code.

## Small print

Progress counts the epic's stories and is not weighted: eleven stories with one done is 1 of 11.
Dragging never changes state — states move from the terminal and the Done button. And the two views
come with the backlog: with `"backlog": false` in `~/.k0/config.json` the switch leaves the bar.
