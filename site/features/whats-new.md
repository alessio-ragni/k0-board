---
title: What changed, in your words
card: After an update, a page says what changed since the version you had — in your language, as plain or as technical as you like.
summary: After you update k0, a What's New page says what changed since the version you had, written by Claude Code in your language, plain or technical.
kicker: after an update
order: 80
since: 0.5.0
updated: 2026-11-02
related: changelog, usage
---

## The version you run, and the one you learned

k0 updates by having its files replaced under it. You restart, everything looks the same, and
whatever changed is in a file called `CHANGELOG.md` that nobody opens. So the version you are
running drifts away from the one you learned, and the new thing sits there unused because you never
found out it was there. The What's New page closes that gap.

## How it shows up

A small **mark appears next to `k0`** in the top bar for exactly two reasons: k0 moved on while you
were not looking, or npm says there is a version newer than the one installed here. Hover it and it
says which.

**It never opens the page by itself.** It sits next to the name and waits, and it goes out when you
have read the page — not when you close the tab.

## What the page says

It names the two versions it stands between — *you had k0 0.3.1, you are running 0.4.0 now, two
versions later* — and then says what that means in prose, written by your own Claude Code out of the
changelog entries in between.

Two controls, and both change who it is written for rather than what is in it:

| Control | Choices |
|---|---|
| Language | whichever one you read |
| How technical | `Plain`, `Normal` or `Nerd` |

Both are remembered, because coming back to find the page in a language you do not read is the
whole page wasted.

Underneath, folded open from the first moment, are the changelog entries themselves, exactly as
they were written. While the prose is being written they are what there is to read; afterwards they
are what you check it against.

## How to use it

- When the mark appears next to `k0`, hover it to see why.
- Click it, and choose the language and the level of detail once.
- If it says a newer version exists, update with `npx k0-board@latest`. k0 cannot update itself;
  the most it can do is tell you.

## Small print

It is the same machinery as [the ChangeLog](/features/changelog/), and it has the same shape:
nothing is stored, and there is no model of k0's own and no key of its own — the Claude Code you
already pay for does the writing, on this machine. Nothing is downloaded either.

Knowing that a newer version exists takes one request a day to the public npm registry, asking what
the newest `k0-board` is. The package name is in the address and nothing else is in the request.
`"updateCheck": false` in `~/.k0/config.json` stops it opening a socket at all.
