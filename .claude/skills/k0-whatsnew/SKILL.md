---
name: k0-whatsnew
description: Writes the What's New page — what changed between the version of k0 somebody had and the one they are running now — from the CHANGELOG entries k0 hands over on standard input, in the language and at the level of detail they asked for. k0 calls it by itself when somebody opens the What's New page after a version jump. Use this skill when the user types "/k0-whatsnew", or asks "what changed in this version", "what's new since the version I had", "cosa è cambiato nell'ultima versione". Do not use it to look the facts up: they arrive on standard input already, and this skill never reads CHANGELOG.md, never runs git, and never calls the API.
---

# /k0-whatsnew

You are handed, on standard input, the CHANGELOG entries between two versions of k0, plus the
language to write in and how technical to be. Write the page somebody reads once, after k0
told them it had moved on while they were not looking.

Your entire reply is the page. It is printed as it is, so there is no room for a preamble, no
"here is what changed", no closing offer of further help, and no code fence around the whole
thing. Markdown, starting at the first word that belongs to the page.

## What arrives

```json
{
  "from": "0.3.1",
  "to": "0.4.0",
  "lang": "it",
  "level": "normal",
  "entries": [
    {
      "version": "0.4.0",
      "date": "2026-09-02",
      "sections": {
        "Added":   ["the file viewer opens the file the session touched last"],
        "Fixed":   ["the search underlines the letters in the name, and leaves the path alone"],
        "Changed": ["…"]
      }
    }
  ]
}
```

`entries` are the versions between `from` and `to`, newest first, in the Keep a Changelog
shape the repository already uses. `lang` is a language tag — write everything in it. `level`
is one of `plain`, `normal`, `nerd`.

## The three levels

The facts are the same at all three. What changes is who is being told.

- **`plain`** — for somebody who uses k0 and never thinks about how it is built. No file names,
  no module names, no flags, no words of the trade beyond the ones on the buttons. Say what
  they will notice: what is on the screen now that was not, what stopped getting in the way.
- **`normal`** — the default. Name the parts of k0 the way the interface names them: the board,
  the post-it, the ChangeLog page, the tray icon. Still no paths, still no function names.
- **`nerd`** — for the person who would read the diff. Name the modules, the settings, the
  flags, and say *why* a thing was done when the entry makes it clear. Never guess at a reason
  the entries do not give.

## The shape of the page

```markdown
## What is new in 0.4.0

<one paragraph, no heading above it — two or three sentences saying what is
different now, and one line on how far back this reaches when it is more than
one version>

### The file viewer opens where you left off
<two or three sentences, or a couple of bullets>

### The search stops wandering into the path
<…>
```

**Group by what changed for the person, not by the section it came from.** `Added`, `Fixed` and
`Changed` are how the changelog is filed, not how anybody reads it: two lines from two different
sections about the same thing belong under one heading.

The headings say **what is different now**, not what was modified. Not "the search algorithm was
narrowed" but "the search stops wandering into the path". Drop a heading that has only one short
line under it and let the line live in the paragraph instead.

## Rules

- **Write in `lang`.** All of it: the title, the headings, the paragraphs. Do not translate the
  words of the trade — *commit*, *changelog*, *post-it*, *branch* are what these things are
  called in every language, and they do not decline. Version numbers stay numerals.
- **Do not invent.** If an entry does not say what it did, say what it says and stop. A page
  that guesses is worse than a page that is short.
- **Leave out what has nothing in it for the reader.** A version whose only entry is that
  nothing visible changed gets half a line, or no line at all — not a heading of its own.
- **No emoji, no exclamation marks, no thanking anybody for updating.** Nothing is exciting;
  things changed.
- **Never print commit hashes, version tags as links, or an upgrade command.** k0 already knows
  how it got here, and the page is read after the fact, not before.
- **If `entries` is empty**, write one line saying nothing changed between the two versions and
  stop. Do not pad it out.
- **Only what is in front of you.** No reading of files, no git, no API calls, no network. The
  facts arrive on standard input and that is all there is.
