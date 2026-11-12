---
title: The sessions you forget, closed for you
card: k0 shows what each session weighs, and after twelve idle hours closes the forgotten ones. Resume picks them up again.
summary: k0 shows what each Claude Code session really weighs, and after twelve idle hours closes the forgotten ones to give the memory back. Resume picks them up where they were.
kicker: memory comes back
order: 50
since: 0.3.0
updated: 2026-11-02
related: always-on, statuses, modes
---

## What a session really costs

At the end of the top bar a chip says how the computer is doing: memory and CPU, with a green,
amber or red dot — the kernel's own verdict, plus amber when memory in use passes 90%. Hover it to
see what is heavy and **is not k0**: if Chrome is the problem, better to know before closing
sessions for nothing.

On every note there is what that session weighs. Not the `claude` process alone: everything it
dragged along — the MCP servers, the browsers they opened, a type check started from a commit hook.
Only the heaviest note turns red, and only while the machine is struggling.

## Why k0 closes the ones you forget

The window costing you a gigabyte is the one you stopped thinking about yesterday. So **after
twelve hours with nothing happening, k0 presses `Close` itself**: the session stops, its window
goes, the memory comes back. Nothing is lost — the note keeps its place and its status, and
**Resume** picks the conversation up where it was.

Only yellow — *Your turn* — is ever touched. The rest is left alone, each for a reason:

| Left alone | Why |
|---|---|
| Working, Planning | somebody mid-thought: stopping it is work lost |
| Needs answer, Needs approval | the question or plan is not saved until answered |
| a note marked [always active](/features/always-on/) | you said so |

A window you used an hour ago is never closed either: k0 keeps four clocks for a session and the
newest wins.

## How to use it

- Nothing to switch on. The chip says it is watching: `RAM 79% · CPU 19% · closes at 12h`.
- Want the memory back now? Press **Close** on the story — it is not offered while it is working.
- A note k0 closed reads *closed automatically*, where one you closed reads *session closed*.
- Change the hours with `closeIdleTerminalsAfterHours` in `~/.k0/config.json`. `0` switches it
  off; anything under an hour counts as an hour.

## And what k0 itself costs

Hover the chip and the last line is k0's own weight. Its watching loop goes round every two seconds
while a session is open or you are at the board, and once a minute otherwise. The board page asks
whether anything changed, and when nothing did the answer is a couple of hundred bytes — it used to
be the whole board every second, fifty-six gigabytes a day to redraw notes that had not moved.
