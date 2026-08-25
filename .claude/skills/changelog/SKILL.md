---
name: changelog
description: Writes the CHANGELOG.md entry for the work just done, in the voice of somebody telling a k0 user what they will notice — and brings README.md, docs/database.md and docs/testing.md up to date in the same pass. Use this skill whenever the user says they want to commit, push or release, in whatever words and whatever language they say it — "commit this", "push it", "cut a release", "committa", "pusha", "fai una release". It also closes [Unreleased] into a numbered version, bumps package.json and tags, stopping to ask once before the push that publishes. Do not use it when the user is only asking what changed, when the change touches nothing but .claude/, or when it is a repair to the changelog itself.
---

# The changelog

`CHANGELOG.md` is the only place a person who does not read code finds out what happened to k0.
It is not a list of commits and it is not for the person who wrote them. Somebody who installed
k0 last month opens it to answer one question: **what is different for me now?**

Everything below exists to keep that answer readable.

This skill is not something the user invokes. It runs because they said they wanted to commit,
push or release, and it runs *before* that, so the entry is part of the same commit as the work.

## When it does not run

- The user is asking what changed, or reading a diff. Nothing is imminent.
- The change touches only `.claude/` — tooling for whoever is working on k0, not k0.
- It is a repair to the changelog itself.
- The work is half finished. An entry describes something that is done.

## What to do, in this order

**1 · Look at the work, not at the commit messages.**

```
git status --porcelain
git diff --stat
git log origin/main..HEAD --oneline --no-merges
git branch --show-current
date +%F
```

Then read enough of the actual diff to be able to answer the question at the top of this file. A
commit message says `fix: guard the path join`; that is not an answer.

**2 · Bring the documentation up to date first, in the same change.**

The entry is written last because writing it is what proves the work is finished, and the
documentation is part of the work:

- `README.md` — anything a user can see belongs in the manual, and anything that changed the shape
  of the project belongs in *How it is put together*.
- `docs/database.md` — if the database changed. It describes the shape as it is now; there is no
  history to append to.
- `docs/testing.md` — if the way tests are written, run or measured changed.

If none of them needed touching, say so in one line when you report back. Silence there reads as
having forgotten.

**3 · Write the entry under `## [Unreleased]`.**

Keep a Changelog sections, in this order where more than one is used: **Added**, **Changed**,
**Deprecated**, **Removed**, **Fixed**, **Security**. Create only the ones you need.

If a bullet about the same thing is already there from an earlier commit, **make that bullet
better rather than adding a second one**. The reader wants one account of one change, not the
sequence of attempts it took.

**4 · Run the tests.**

`npm test`. Never `--no-verify`, never a skipped test, never a weakened assertion and never a
lowered coverage floor to get a run green. A red build is information; a green one bought that way
is a lie that outlives the commit.

**5 · Show what you wrote, then ask.**

Print the diff of `CHANGELOG.md` and stop. The user commits, or tells you to. **Never push.**

## How an entry reads

The bullet opens with the claim in bold and then earns it:

```markdown
- **Clicking a notification opens that session's terminal**, on all three platforms. On macOS it
  used to open Script Editor with a file dialog — no card, no click, wrong application.
```

- **English, complete sentences.** The rest of the repository is English regardless of the
  language the conversation happens in, and this file most of all: it is what the public sees.
- **Say what the reader will notice.** If nothing is different for them, say that plainly — see
  below.
- **No file names, no function names, no module names, no table names, no paths.** Not one.
- **No jargon in disguise** either: *endpoint*, *schema*, *query*, *cache*, *refactor*, *hook*,
  *deploy*, *migration* do not appear in an entry. If a sentence cannot be written without one,
  the sentence is about the code and not about k0.
- **Never copy the commit message.** That is written in the imperative, about code, for whoever
  reviews it. This is prose, about k0, for whoever uses it.
- **Tried is not the same as written.** If something was verified on a real machine, say how; if
  it was not, say it was not. There is no silent middle.
- **What was removed or switched off is stated as plainly as what was added.**
- **No emoji, no superlatives, no selling.** The register is somebody reporting.
- **Past entries are never rewritten**, not even wrong ones. A correction is a new entry that says
  what it corrects.

### Work nobody can see

Every commit leaves a line, including the ones that change nothing visible — a tidier arrangement,
faster startup, tests where there were none. That line is **short**, it says openly that nothing
changes for the reader, and it says why it was worth doing anyway. The 0.1.1 entry is the
precedent: *"Documentation, and how a release is made. Nothing about k0 itself changed."*

What such a line must not do is dress internal work up as a benefit. "Improved architecture" tells
the reader nothing and costs them the time it took to read.

## Making a release

When the user asks for a release, everything below happens without further questions — except the
last step.

1. Decide the number from what is in `[Unreleased]`: something removed or a behaviour that no
   longer works is a minor while k0 is at `0.x`; new behaviour is a minor; fixes alone are a
   patch. Say which and why in one line.
2. Bump `version` in `package.json`.
3. Turn `## [Unreleased]` into `## [x.y.z]`, leave a fresh empty `## [Unreleased]` above it, and
   write the opening paragraph — two or three sentences saying what this version is about, in the
   same voice as the entries. The 0.1.2 entry shows the shape.
4. Run `npm test`.
5. Commit the lot: `chore: release x.y.z`.
6. Tag it: `git tag -a vx.y.z -m …`. The tag and `package.json` must agree — the release workflow
   refuses them if they do not.
7. **Stop here.** Say what is about to be published and ask. `git push origin vx.y.z` is what
   starts the publish to npm, and a published version cannot be taken back — a mistake is fixed
   by another version, in public, forever.

## Reporting back

Three lines, no more: what the entry says, which documents you touched, and whether the tests
passed. If you decided something did not deserve an entry, that is the line instead — with the
reason.
