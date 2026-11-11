---
title: Keep one session always on
card: Mark a note always active and k0 never closes its terminal for sitting idle — for a session left watching a deploy.
summary: Mark a Claude Code session always active and k0 never closes it for sitting idle: the sun on its note lights up and the note takes a dashed border.
kicker: leave this one running
home: yes
order: 40
since: 0.8.0
updated: 2026-11-02
related: idle-close, views, modes
---

## The one note k0 leaves alone

k0 closes the terminals you forget: after twelve hours with nothing happening, a session waiting
at *Your turn* is stopped and its memory given back (the whole story is in
[the sessions you forget](/features/idle-close/)). Most of the time that is exactly right. Once in
a while it is not, and for that there is a mark.

At the bottom right of every note, next to the flag, sits a **sun**: always active. Turn it on and
k0 never closes that terminal for sitting idle, however long it sits there.

## Why it is needed

A session left watching something — a deploy, a queue, a mailbox — wakes every couple of hours,
does its turn and goes back to the prompt. Whatever it prints in between moves none of the clocks
k0 reads to decide what is idle. To k0 it looks exactly like a window you forgot; only you know it
is not. So you say so, once, on the note.

## How to use it

- Put the pointer on the note: the sun appears at the bottom right, beside the flag. Like the flag,
  it is invisible until then, because a mark drawn on every note all the time marks nothing.
- Click it. The sun is lit — its disc filled, because this is the session that never goes to rest —
  and the note takes a **dashed border**: blue, or the flag's colour, still dashed, when the note
  is flagged as well.
- Click it again to take it off.

## Small print

- The mark belongs to the story, not to the terminal: it holds through **Resume** and through a
  **Close**.
- It only stops k0 closing the window by itself. Your own **Close** and **Done** work exactly as
  before.
- It is on every note, whether or not you use the [backlog](/features/backlog/).
- If what you want is no automatic closing at all, there is a setting for that instead:
  `closeIdleTerminalsAfterHours` set to `0` in `~/.k0/config.json`.
