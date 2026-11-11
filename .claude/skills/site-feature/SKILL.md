---
name: site-feature
description: Writes, rewrites or regenerates the page of one k0 feature on k0-board.com — the Markdown in site/features/<slug>.md, the drawing beside it, and the pages built from them. Use it when a story whose decisions say it goes on the site is being built or has just been finished, when the release finds a feature without its page, and whenever the user asks — "make the page for this feature", "regenerate the dictation page", "rewrite the modes page", "fai la pagina di questa feature", "rigenera la pagina della dettatura", "rifai la pagina". Do not use it to change the site's layout or the home page by hand, and never to deploy: putting the site online is the release's last step.
---

# The page of a feature

k0-board.com has one short page per feature at `/features/<slug>/`, an index at `/features/`, and
the same cards on the home page. All of it is built by `site/build.mjs` from one Markdown file per
feature in `site/features/`, so a feature's page is that file — this skill writes it, and the
build does the rest.

## When it runs

- **While the work is done.** Whether a story goes on the site is decided while it is discussed
  (see *The site* in `CLAUDE.md`). When that decision is yes, the page is written as soon as the
  behaviour exists — by the end of the work on the story at the latest — so it is never written
  from memory weeks later.
- **At the release**, for a feature that reached `[Unreleased]` without one.
- **When Alessio asks**, to write it, rewrite it, or regenerate it from scratch after the feature
  changed. Regenerating means reading the sources again, not polishing the old text.

## Where the facts come from

In this order, and nothing invented beyond them: the story's decisions and plan (in `.k0/` or on
the board), the section of `README.md` that describes the behaviour, the `CHANGELOG.md` entry, and
the code itself when those three disagree — in which case the code wins and the disagreement is
worth saying. A page promises things to strangers; a sentence nobody can point to a source for
does not go on it.

## The file

`site/features/<slug>.md`. The slug is short, lowercase, with dashes, and never changes once
published — it is an address people link to. The header is one `key: value` per line; lists are
comma-separated on the same line.

```markdown
---
title: Seven colours, one glance
card: Every session is a sticky note, and its colour says whose move it is — yours or Claude's.
summary: Every Claude Code session on the k0 board is a sticky note whose colour is its status …
kicker: how it works
order: 10
since: 0.1.0
updated: 2026-11-02
related: views, terminal, modes
---
```

| Key | What it is |
|---|---|
| `title` | the page's heading; plain and about the benefit |
| `card` | one sentence, at most 140 characters, for the cards |
| `summary` | one or two sentences, at most 200 characters — the search result. Say *Claude Code* where it is natural: that is what people type |
| `kicker` | two to four lowercase words, drawn by hand above the title |
| `order` | where it sits in the grid, in tens |
| `home` | `yes` to show the card on the home page too. At most eight do — two rows — so a new feature takes the place of one, or stays on `/features/` only |
| `status` | `coming` for a feature that does not exist yet: a card marked *coming soon*, no page |
| `since` | the version it arrived in; left empty until the release sets it |
| `updated` | the day the page last changed |
| `related` | two or three other slugs, offered at the bottom of the page |

The body is a small page, 250 to 450 words, in the shape every page has: what it is → why it
matters → how to use it (a short list, with the real keys, commands and addresses) → small print,
if there is any. English, in the manual's voice: plain, concrete, and saying *why*. Link other
features as `[text](/features/<slug>/)`. No HTML: the Markdown is escaped.

## The drawing

`site/features/<slug>.art.html`, optional, beside the Markdown. It is static HTML made only of the
pieces at the end of `site/site.css` — `.art-stage` around it, `.mini` notes in the seven status
colours, `.screen` windows, `.pill`, `.chip`. No pictures, no scripts, nothing fetched. Look at two
existing drawings before making a new one: they are meant to look like one set.

## Then

```bash
npm run site                                   # builds every page from the Markdown
npm run serve            # rebuilds, then http://localhost:8080/features/<slug>/ (or the globe on the k0 column)
```

Give Alessio that address. The rebuilt pages are committed with the work; `node site/build.mjs
--check` fails the release when they were not. The page goes online with the next release, and
only then.
