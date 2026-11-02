---
title: What you actually shipped
card: What you did across every repository — what is online, and what only looks finished — written up like a release note.
summary: A ChangeLog of all your repositories, written by Claude Code — what you committed, what is already online, and what is still sitting on this machine.
kicker: what did I do today
order: 70
since: 0.2.0
updated: 2026-11-02
related: whats-new, git-and-globe, usage
---

## A release note for your own day

The ChangeLog is not k0's changelog. It is yours: what you have been doing across every repository
on the board at once, written up by Claude Code. It is the list-shaped button next to the `+`, and
it opens in a page of its own.

It reads like a release note rather than a report. An opening paragraph saying how the day went,
then one block per repository: a line saying what is different now, a short paragraph, a few
points, and — the part that matters most — **what is done but not out yet**.

## Why it matters

From inside a terminal, *finished* and *shipped* look the same. A commit still sitting on your
machine, three changelog lines written but never closed into a version, four files never committed:
the whole page is built on that one distinction — what left here, and what only looks finished.

It also keeps quiet about what you did not touch: a repository that has been dirty since March is
not news. Something has to have happened in the window — a commit, a file saved, a story moved —
before k0 tells you what is outstanding there. And only **your** commits count: k0 asks git which
email you commit with in that repository, so one shared with other people still tells you about
your day.

## How to use it

- Click the list-shaped button next to the `+` on the board.
- Pick a window across the top: **Today**, **Yesterday**, **Week** or **Month**. It opens on none
  of them — it opens on the last day you actually worked, so on a Monday you get Friday instead of
  an empty page.
- When you do not believe a paragraph, open the facts folded under its block: the commits
  themselves, green if they are online, amber if they are still only here.

## Who writes it

Not k0: **no model of k0's own reads your work**, so there is no key to keep and no commit message
going out to somebody's model. You already have Claude Code signed in, so k0 gathers the facts on
this machine, hands them to it, and shows what comes back — no terminal opens, nothing appears on
the board. It is written in your language, because it is written out of your own commit messages
and story titles.

## Small print

Nothing is saved: every time you open the page or change the window, it is written again. k0 Cloud
keeps your board, not your commits or your diffs. Without Claude Code on the machine the page still
opens, with the facts and a line saying why the rest is missing.
