---
title: Is it saved? Is it up?
card: A mark on every note and column says what is not committed or not pushed; a globe says whether the dev site is running.
summary: On the k0 board for Claude Code, a git mark shows what is uncommitted or unpushed in each repository, and a globe starts, stops and shows the dev server.
kicker: safe, and running
order: 160
updated: 2026-11-02
related: worktree, changelog, files
---

## The git mark

Next to every repository name — on each story and above each column — one symbol says whether
the work is safe:

| Mark | Means |
|---|---|
| a **dot** with a number | that many files are changed and nowhere yet |
| an **up arrow** with a number | that many commits are made but not pushed |
| a faded **tick** | everything is saved |

Hover it to read it in full — branch, files, commits, and how many of those commits belong to that
session. **Click it and the files open.**

A story in an [isolated worktree](/features/worktree/) has a working tree of its own, so its mark
is really its own. A story working in the base repository shares the working tree with everybody:
there the dot belongs to the repository, and what belongs to the session is the commits made since
it started.

## The globe

Last on a column's heading, a small **globe** says whether that repository's dev server is
running. **Grey** is off, **green** is up, it **breathes** while it is coming up, and **red** means
it was started and did not come up — hover it for the reason and the log.

When it is green the repository's name gets a green dashed underline and becomes a link to the
site, on the port it is really listening on.

## Why it matters

With several Claude Code sessions in several repositories, the two questions you keep asking are
*did that get committed* and *is the site running*. Both used to mean opening a terminal. Now they
are answered from across the board.

And a dev server started inside a session belongs to that session and dies with it. k0 starts the
server detached and owned by nobody: close every session, restart k0 itself, and the globe stays
green.

## How to use it

1. Nothing to set up. A repository gets a globe when its `package.json` has a `dev` script, or
   failing that a `serve` one.
2. **One click** on the globe switches the server on or off. **Two** restart it.
3. Click the repository name, once it is underlined, to open the site in another tab.
4. Click the git mark to see the files that are not saved yet.

## Small print

k0 **never runs `git fetch`**: it reads what your git already knows, which is exact for your own
pushes and blind to somebody else's until you fetch. It **never opens a socket to your server**
either — "up" means the process is alive and the operating system says it holds a port. A server
you started by hand in a terminal is recognised within a few seconds, except on Windows, where k0
says so rather than showing it as off.
