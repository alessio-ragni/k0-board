---
title: Your board, on every machine
card: Sign in with GitHub or Google and the board keeps a copy in k0 Cloud — your code never goes with it.
summary: k0 Cloud keeps a copy of your Claude Code board: sign in with GitHub or Google, see it on every machine and on your phone — while files, diffs and commits never leave yours.
kicker: a copy, not a move
order: 140
since: 0.6.0
updated: 2026-11-02
related: backlog, statuses, views
---

## What it is

Your board lives on your machine and keeps working with no network at all. **k0 Cloud holds a
copy of it**, so it survives a lost laptop, reaches your other machines, and can be read from a
browser at `k0-board.com/app/` — on your phone too.

Every few seconds, while you are signed in and let in, k0 sends what changed and fetches what your other
machines changed. The same repository checked out on two machines is one column, because the
cloud names it by its `origin` remote, cleaned of any password.

## What goes up, and what never leaves

| Goes up | Stays on this machine |
|---|---|
| epics, stories, tasks | your files, diffs and commits |
| decisions, rounds, checklists | the folder a session works in |
| dependencies and the Log | which terminal window it is in |
| the sessions a story has had, and their status | the commit a session started at |

Sessions go up but do not come down: a session is a terminal on the machine that opened it. The
cloud keeps its status so the web board can show it.

## Why a key needs the cloud

A key is one number for your whole account: `K150` is the same story in every repository and on
every machine. Two machines can only agree on what comes next in one place, so the number comes
from the cloud the moment you create a story.

When the cloud does not answer within two and a half seconds, the story is made anyway with a
**provisional key**, `K~3`. It works everywhere a key does, and as soon as the cloud is back it is
given its real number, oldest first.

## How to use it

1. Open the board and choose **GitHub** or **Google** on *Connect your account* — or run
   `k0-board login`. There is no password of k0's own.
2. k0 is in early access: until your account is approved the board says *You are on the list* and
   sends nothing. It notices the approval by itself.
3. If the board already had stories, it offers **Move your board to k0 Cloud** and shows every old
   key beside its new one before anything changes. A backup is written first.
4. Watch the chip at the end of the top bar: **green**, everything is up; **amber**, changes are
   waiting; **grey**, the cloud cannot be reached and the board carries on by itself.
5. Open `k0-board.com/app/` anywhere to read the board. It is read-only: the board is edited from
   k0 on your computer.

## Small print

**Sign out**, or `k0-board logout`, leaves the board exactly as it is and stops syncing.
`K0_CLOUD=off` switches the cloud off entirely.
