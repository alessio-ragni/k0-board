---
title: Where your week went
card: What every session consumed, by model, effort, repository and account — and how full your limits were, from your statusline.
summary: See what your Claude Code sessions consumed this week — by model, effort, repository and account — and how full your limits were, read from your own disk.
kicker: where did the week go
order: 100
since: 0.5.0
updated: 2026-11-02
related: changelog, idle-close, modes
---

## The question Claude Code leaves you to guess at

You switch between models, between efforts, between one agent and a whole workflow, and between
accounts — and the only thing you ever see is a limit arriving. The icon with three bars in k0's top
bar opens a page that answers **where did the week go?**, a week at a time, Monday to Sunday, with
the arrows to go back.

## What it shows

- **What each day would have cost at the API price list**, stacked by model. With a subscription you
  do not pay this — it is the one scale on which two models can be put side by side.
- **How full each account's weekly limit was**, a line per account, and the five-hour limit as it
  was last seen.
- The week split **by model and effort** (fast mode is a row of its own), by **who did the work** —
  the conversation itself, its subagents, or a workflow's agents — by **repository** and by
  **account**.
- Every **session**, the most expensive first: model and effort, how long Claude actually worked on
  your turns, tokens, cost, estimated share of the weekly limit, and how many times a limit stopped
  it. A session that belongs to a story links to it.

## Why it costs nothing to find out

No model is asked and nothing goes over the network. Claude Code already writes every reply's token
counts, model and effort into the transcripts on your disk, and k0 reads them as they grow — the
history first, a few megabytes at a time so the board never stalls, and after that once a minute.

## How to use it

- Click the three bars in the top bar. The first time, the page says how much history is still
  left to read.
- For the limits, add the few lines from the k0 README to your statusline command. Claude Code tells
  only the statusline how full the limits are, so the snippet writes it down in
  `~/.k0/usage/limits.jsonl` when a number changes, and never breaks the bar if anything fails.
- Without the snippet the page works the same, with the limits chart empty and a note saying why.

## Small print

The limits reach the statusline only on a subscription, and only after a session's first reply.
Which account a reply came from is not in the transcripts: k0 records every change of account from
the moment it runs, and anything before that stays **Unknown account** — it is not guessed. A
session's share of the weekly limit is an estimate, marked `≈`. The prices are Anthropic's
published API rates; a model k0 has no price for is counted in tokens and shown as `?` in dollars —
never as free.
