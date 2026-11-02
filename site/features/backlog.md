---
title: Decide it, then check it
card: Epics, stories and tasks, discussed in rounds, every decision written down — and the finished work checked against each one.
summary: A backlog for Claude Code: stories discussed in rounds, every decision written down, and /k0-verify holding the finished work against each one before Done.
kicker: decided, then checked
order: 120
since: 0.5.0
updated: 2026-11-02
related: worktree, views, statuses
---

## The rest of a post-it

A post-it used to be a name and a prompt — enough to start a Claude Code session, not enough to
remember why. The backlog adds what the work is *about*, and a check against it.

**An epic** is a reason with several stories under it. **A story** is one post-it, the thing you
work on. **A task** is a story cut out of another one. Each gets a key, `K150`: one number for
your whole account, the same in every repository and on every machine, never reused.

## Why decisions, and why a counter-check

You explain a piece of work for half an hour, the model says it understood, and then it builds
something that quietly contradicts the one thing you settled at minute twenty. You notice three
days later, and by then you cannot prove you said it.

So the discussion happens in **rounds** of four questions at most, each saying where it is —
*Round 3 of about 8* — and each written to k0 before the next is asked. What comes out is a row of
**decisions**, `D1`, `D2`, one sentence each, about behaviour rather than code. A decision is never
rewritten: a new one supersedes it and both stay. Stories inherit their epic's, shown as `K7·D3`.

When the work is done, `/k0-verify` takes the decisions **one at a time** and records a verdict for
each — kept, violated or not applicable — with the evidence. A run that skips one is refused, and a
story with a broken decision cannot be marked Done until the work is put right or the decision is
superseded.

## How to use it

1. Say yes when the installer offers to copy the commands into `~/.claude/skills/`.
2. Press `+` on a repository: **Story** for something you already know you want, **Epic** for
   something big, which opens a terminal running `/k0-epic`.
3. Press the one button on the note — **Discuss**, **Plan** or **Work**. A terminal opens with the
   command already in it.
4. When it is built, `/k0-verify`, then **Done** — which only you can press.

| Command | What it does |
|---|---|
| `/k0-story` | one story, straight onto the board |
| `/k0-epic` | rounds, decisions, then stories you approve |
| `/k0-discuss` | the same rounds on a story that exists |
| `/k0-plan` | plan mode, with the decisions as constraints |
| `/k0-work` | the work, [in a worktree of its own](/features/worktree/) |
| `/k0-verify` | the counter-check |
| `/k0-next` | what to pick up now, and why |

## Small print

Each repository with a backlog grows a `.k0/` folder, one Markdown file per epic and story. Commit
it: it is how a board is rebuilt, keys and all, on a machine that has never seen it.
`"backlog": false` in `~/.k0/config.json` switches the feature off.
