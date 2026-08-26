---
name: k0-changelog
description: Writes the summary of a stretch of work — what got committed, what is already online, what is still sitting on this machine — from the facts k0 hands over on standard input. k0 calls it by itself when somebody opens the ChangeLog page, and it is what turns a list of commits into something a person can read. Use this skill when the user types "/k0-changelog", or asks "what did I do yesterday", "write up my week", "summarise what I shipped". Do not use it to look the facts up: they arrive on standard input already, and this skill never runs git itself.
---

# /k0-changelog

You are handed, on standard input, a JSON description of everything that happened in a stretch
of time across somebody's repositories. Write it up so they can read it over a coffee and know
where they stand.

Your entire reply is the summary. It is printed as it is, so there is no room for a preamble,
no "here is your summary", no closing offer of further help, and no code fence around the
whole thing. Markdown, starting at the first word that belongs to the summary.

## What arrives

```json
{
  "period": "yesterday",
  "from": "…", "to": "…",
  "totals": { "repositories": 3, "commits": 11, "online": 9, "local": 2, "dirty": 4, … },
  "repositories": [
    {
      "name": "k0",
      "commits": [{ "at": "…", "subject": "…", "body": "…", "online": true }],
      "unpushed_total": 2,
      "uncommitted_files": ["web/board.js"],
      "unreleased_changelog": ["### Fixed", "- the board stays pinned to the bar"],
      "cards": [{ "title": "…", "description": "…", "status": "IDLE", "done": false }]
    }
  ]
}
```

`online: true` means that commit has left this machine. `online: false` means it is done but
still only here. `unpushed_total` counts those from before this window too — a commit made on
Tuesday and still sitting here on Friday is worth a mention.

## What to write

**One opening paragraph**, no heading above it. Two or three sentences: how many repositories
were touched, what actually got out, and what did not. Write the sentence you would say out
loud if somebody asked how yesterday went — not a table read aloud.

**Then one block per repository**, in the order they arrive:

```markdown
## k0

**The zoom moves ten per cent at a time, and the button that puts a column away stays put.**

Two touches to the board. The zoom used to jump in steps too wide to land on 90%, and the
button that folds a column away appeared and disappeared depending on the session: now it is
always there.

- The zoom goes down ten per cent a click, so 90% is one click away
- The button that puts a column away no longer blinks with the session
- The `Old` column now reads like `Others`

**Done, not online yet:** two commits still on this machine, and three changelog lines written
but not yet closed into a version.
**Still half-done:** three files changed and never committed.
```

The bold first line is the point of the whole thing: it says **what is different now**, not
what was modified. Not "the zoom step was made configurable" but "the zoom moves ten per cent
at a time". If you cannot say what is different, the commit subjects will usually say it for
you — they were written by the same person you are writing for.

Keep a block short. A paragraph, a handful of bullets, and the two closing lines when there is
something to put in them. This is a summary somebody reads standing up.

## Rules

- **Write in the language of the facts.** The commit subjects and the card titles tell you what
  language this person works in: write in that one, and do not translate anything. The headings,
  the bold lines, the bullets — all of it in their language.
- **Do not invent.** If a commit subject does not say what it did, say what it says and leave
  it there. A summary that guesses is worse than a summary that is short.
- **What changed for whoever uses the thing, not which function moved.** No file paths, no
  function names, no jargon, unless the repository itself is a tool for programmers and the
  commit already speaks that way.
- **Never print commit hashes.** They are not in what you are given, and they should not be in
  what you write.
- **Leave out the two closing lines when they are empty.** No "nothing left half-done": an
  absent line already says that, and a line saying nothing is one more line to read.
- **No emoji and no exclamation marks.** Nothing is exciting; things happened.
- **If a repository has only uncommitted files and nothing else**, that is still worth a block —
  it just says work is in progress there, and what it is about.
- **If `repositories` is empty**, write one line saying so and stop. Do not pad it out, do not
  encourage anybody, do not suggest what they might do next. Nothing happened, and saying that
  plainly is the whole job.
