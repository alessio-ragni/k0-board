---
title: Every file a session touched
card: Open a repository's documents in a tab — what the session changed, a search that finds them, and one click from Claude's reply.
summary: A file viewer for each Claude Code session — what it changed, a search by name and by text, light editing, clickable file names, and a clean PDF.
kicker: what did it touch
order: 110
since: 0.1.0
updated: 2026-11-02
related: git-and-globe, terminal, changelog
---

## The git mark is also a door

Click the git mark on a column or a story — or the **lens**, where there is no git — and a file
viewer opens **in another tab**, with the board left where it is. Files on the left, what they say
on the right, a divider you can drag.

## Documents, not code

What is listed is what you read and print: Markdown, HTML, text, PDF, Word. In a real repository
code is 95% of the files, and among two thousand `.tsx` files the document you were after cannot be
found. Nothing is closed off: a code file reached by a link still opens.

Folders come first, then the files in three groups: **Changed** — what this session touched, in the
working tree or in commits made since it started — **Recent**, the thirty most recently modified,
and **All files**. A folder narrows the listing to itself, and every piece of the path above is a
way back up.

## Finding the one you meant

- **By name**: the letters you type, in order, inside the file's own name — `audrep` finds
  `docs/audit-report.md`, with the matched letters underlined.
- **In the text**: the line the word appears on, highlighted in yellow. Accents need no typing.
- **From the chat**: click the lens, paste the summary a session ended with, press **Find the
  files**, and the list narrows to the files that text names, in the order it names them.

`/` puts the cursor in the search, Enter opens, Esc clears. There is no index: a few hundred
documents are read every time, straight from the operating system's cache.

## Configuration, behind a switch

The **`config`** button beside the search adds `.env`, `.json`, `.yml`, `.toml` and `.ini` —
including the ones git ignores, because an `.env` is ignored by definition and is the file you came
for. A JSON file opens as a tree that folds; an `.env` as a table.

The **pencil** edits configuration, `.md` and `.txt` in place; **Save** or ⌘/Ctrl+S writes it. If
the file changed on disk meanwhile, the save stops and says so.

## Links everywhere

File names written inside a document — in backticks, in a table — open the file in a new tab, as
long as the file exists and it is clear which one is meant.

With the `k0-links` mod and k0 running, everything Claude's last reply pointed at — addresses,
folders, documents, artifacts — sits in a row just above the prompt, one click away.

## On paper

The printer sends only the document: no listing, no bar, no path. The **PDF** button has a headless
Chrome print the page, so the file arrives laid out, without the date and address the print dialog
adds.
