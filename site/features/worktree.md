---
title: Work next door, merge back
card: /k0-work builds a planned story in its own git worktree, keeps a log as it goes, and merges back into the branch it came from.
summary: /k0-work runs a planned story in Claude Code inside its own git worktree, logs as it goes, and merges back into your branch. /k0-ultracode does it with a manager and agents.
kicker: a copy of its own
order: 130
since: 0.5.0
updated: 2026-11-02
related: backlog, git-and-globe, terminal
---

## A working copy of its own

`/k0-work` takes a story that has a plan and builds it in a **git worktree** under
`.claude/worktrees/`, on a branch named after the story, opened **from the branch you are standing
on** — not from `main`. You keep working in the repository; the Claude Code session works next
door, writing to the story's Log as it goes so a session that runs out of context hands over
cleanly. At the end its branch comes back as **one merge commit** and the copy is destroyed.

The folder is kept out of git's way through `.git/info/exclude`, never your `.gitignore`.

## Why it stops where it stops

It will not open a worktree over uncommitted work, and says how much there is. Three things it
never does, each of which has already cost somebody a day:

- **It never pushes and never opens a pull request.** Publishing is your decision.
- **It never resolves a conflict.** A program cannot tell a conflict it resolved correctly from one
  it resolved plausibly. A conflict stops everything and names the files.
- **It never runs tests, a build or a dev server in there.** A copied `.env` carries the base
  repository's port, and a test runner that finds a server already on it goes green against the old
  checkout. Tests run on your branch, after the merge.

## How to use it

1. Plan the story first: **Plan** on the note, or `/k0-plan K150`.
2. Press **Work**, or type `/k0-work K150`.
3. If the terminal closes, **Resume** picks the conversation up where it was.
4. Once it has merged, run your tests on your branch, then `/k0-verify K150`.

## The same work, with a manager over it

Next to **Work** sits a quieter word: **Ultracode**. `/k0-ultracode` makes one session a
**manager**: it cuts the plan into assignments, gives each to an agent in a copy of the repository
of its own, brings the work back one piece at a time, and then — on your branch — runs the tests,
has the result read by an agent that wrote none of it, and walks the story past every decision. On
an epic it goes story after story.

It asks two things, once: **how much rope** — *interactive*, *checkpoint* or *autonomous* — and
**how hard**: two, three or five agents at a time, one repair attempt or two. It never pushes,
never presses **Done**, and stops when the repairs are spent, saying what is still broken.

## Small print

Merging commits whatever the session left pending, and a commit runs your hooks. k0 does not skip
them with `--no-verify`, so a `pre-commit` hook that runs the suite does run next door — and k0
says so.
