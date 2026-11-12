---
title: Eight colours, one glance
card: Every session is a sticky note, and its colour says whose move it is — yours or Claude's.
summary: Every Claude Code session on the k0 board is a sticky note whose colour is its status — red when it asks you something, amber when a plan waits for your yes, blue while it works, green when it is done.
kicker: how it works
home: yes
order: 10
since: 0.1.0
updated: 2026-11-12
related: views, terminal, modes
---

## A note is its status

Each Claude Code session you start from k0 is a sticky note on the board, one column per
repository. There is nothing to read on it to know where it stands: **the note is the colour of
its status**, and the colour changes by itself while the session runs.

| Colour | Status | What it means |
|---|---|---|
| grey | **Backlog** | just an idea — the session has not been started |
| red | **Needs answer** | it is asking you something |
| amber | **Needs approval** | it has finished a plan and waits for your yes |
| yellow | **Your turn** | the terminal is idle, waiting for you to say something |
| blue | **Working** | it is working |
| light blue | **Planning** | it is working inside a plan |
| sky blue | **Working in the background** | its turn is over, but a command it started is still running |
| green | **Done** | you closed it |

The first four are your move; the three blues are Claude's.

**Working in the background** is the one that keeps yellow honest. A session that ends its turn
while a test run or a deploy check is still going will carry on by itself when that finishes — so
it is not your move, it is not counted among the notes waiting for you, and it sends no
notification.

## Why colours and not a row of tabs

With ten sessions open the question is never *what is each one doing* — it is **which one needs
me now**. A red note answers that from across the room. A question asked twenty minutes ago no
longer sits unseen behind three terminal windows.

## How to use it

- Install with `npx k0-board` and open the board.
- Press **+** next to a repository, give the story a title, and **Start**: a real Claude Code
  session opens in its own terminal, and its note appears.
- Work as you always do. When a note turns red or amber, double-click it and you are in that
  terminal.

The same colours light the menu bar icon, which always shows the most urgent one, and the web
board k0 Cloud keeps for your phone.
