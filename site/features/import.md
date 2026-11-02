---
title: Start with the work you already did
card: /k0-import puts the Claude Code sessions you already had on the board, each with a title and a line saying what it was about.
summary: /k0-import fills the k0 board with the Claude Code sessions you already had — the ones opened by hand included — each titled and described in the language it was held in.
kicker: never an empty board
order: 150
since: 0.1.0
updated: 2026-11-02
related: statuses, backlog, terminal
---

## What it is

An empty board is no help in getting your bearings. You have been using Claude Code for weeks;
the conversations are already on your machine. `/k0-import` picks them up — including the ones
you opened by hand, outside k0 — and puts each one on the board as a story: the **last 14 days**,
at most the **10 most recent per repository**.

It does more than copy a name across. Claude reads each conversation and writes a **title and a
description in the language it was held in**. That description is the line in italics under the
title on the note, and importing is the only thing that writes one — a story you write yourself
has a title and a prompt, which is all it needs.

## Why it matters

A session you closed last Tuesday is still a piece of work: half finished, or finished and never
looked at again. Imported, it sits in its repository's column next to everything else, and one
press takes you back into it rather than leaving you to dig through a list of transcripts by date.

## How to use it

1. Say yes when the installer offers to fill the board on the first run. That pass uses the name
   the session already had, or the first few words of its first prompt.
2. Later, from any Claude Code session, type `/k0-import` for the fuller version, with titles and
   descriptions written by Claude.
3. `/k0-import 30 5` changes the two numbers: the last 30 days, at most 5 per repository.
4. On each imported note, **Resume** reopens the conversation where it was, and **Done** clears it
   away.

Running it again skips the ones already imported, so it is safe to repeat.

## Small print

Imported stories are born yellow — **Your turn** — but being dead sessions they do not light the
menu bar icon.

Automated runs stay out: `claude -p`, subagents, skills launched from a script. The tell is a line
that only Claude Code's own interface writes when it really starts. On one real machine that
separated 145 genuine sessions from 867 automated ones — and k0 reads 64 KB at the head and 64 KB
at the tail of each file to find it, rather than the whole thing.
