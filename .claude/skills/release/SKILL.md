---
name: release
description: The whole way out of a working tree — documentation, tests, one commit, the push to GitHub, and, when it is a release, the tag that publishes k0 to npm and puts k0-board.com online with its feature pages. Use this skill whenever the user asks for the work to be shipped, in whatever words and whatever language — "commit and push", "ship it", "cut a release", "publish", "committa e pusha", "manda in produzione", "fai una release", "/release", and "/commit-push-deploy", the name it had before. It calls the changelog skill rather than repeating it, runs the tests and the coverage floor before anything leaves the machine, watches the run on GitHub, merges a branch or worktree into main first, and — Alessio having asked for the confirmation to go away for good, see "Why there is no question here" — pushes the tag that publishes without stopping to ask. Do not use it to write a commit message on its own, to inspect what changed, or when the user only wants the changelog.
---

# Getting the work out

There is one road out of this repository and this is it: documentation, tests, one commit, a push
to `origin`, and — only when a release was asked for — a tag whose arrival on GitHub is what
publishes k0 to npm, followed by the site at `k0-board.com` with a page for every feature the
release brings. A release publishes everything; nothing is left for Alessio to put online by hand.

The point of writing it down is that the order matters and the last step is irreversible. A
version that reaches the registry cannot be taken back; it can only be followed by another one, in
public, for ever.

## What this skill does not do

- **It does not write the changelog or the documentation.** That is the `changelog` skill, and it
  owns `README.md`, `docs/database.md`, `docs/testing.md` and `CHANGELOG.md`, along with the rules
  about how an entry reads. Invoke it and follow it. Do not restate its rules here and do not
  second-guess them.
- **It never types `npm publish`.** Publishing is what the tag causes; see *The release*.
- **It never pushes to `private`.** See *The two remotes*.
- **It never installs anything.** k0 has no dependencies and no lockfile. There is no `npm ci`
  step, and adding one is a change to the project, not a step in a release.

## The stack it stands on

| What | Which |
|---|---|
| The commit and the tag | `git`, Conventional Commits, one line, imperative, English |
| The tests | `npm test` — Node's own test runner, no framework, no dependency |
| The coverage floor | `node --test --experimental-test-coverage`, the numbers living in `.github/workflows/ci.yml` |
| Watching the run | the `gh` CLI, already authenticated as `alessio-ragni` |
| On every push to `main` | `.github/workflows/ci.yml` — three operating systems × Node 24 and 26, plus the coverage job |
| On every tag `v*` | `.github/workflows/release.yml` — tests again, tag/version agreement, then publish |
| The publish itself | npm **trusted publishing** over OIDC, with a signed provenance statement |
| Credentials | none. There is no npm token, in the repository secrets or anywhere else |

That last row is the one to remember when a publish fails on authentication: the thing to look at
is the trusted publisher on the package's npm settings page. There is no token to rotate, because
there is no token.

## The two remotes

```
origin    https://github.com/alessio-ragni/k0-board.git   public — this is the one that releases
private   https://github.com/alessio-ragni/k0.git          the old history, and nothing else
```

Everything in this skill means `origin`. A tag pushed to `private` publishes nothing and starts no
workflow: it just sits there, silently, looking as though a release happened.

## Before anything

```bash
git rev-parse --git-dir; git rev-parse --git-common-dir   # differ → you are in a worktree
git branch --show-current
git status --porcelain
git log origin/main..HEAD --oneline
git remote -v
node -p "require('./package.json').version"
```

Releasing happens from `main`, so the way there is part of the job, not a reason to stop:

- **the two git directories differ** — this is a worktree. Releasing from one pushes a branch
  nobody is on. Close it into its base branch with `/worktree-close`, then carry on from there;
- **the branch is not `main`** — commit what is on it, `git switch main`, `git merge --no-ff
  <branch>`, and carry on from `main`. A conflict that is not obvious is the one thing to stop and
  ask about. Delete the branch only once the merge is in.

Stop and say so, rather than carrying on, when:

- **HEAD is detached**, or there is more than one branch it could mean;
- **there is nothing to do** — a clean tree with nothing ahead of `origin/main`. Say that plainly;
  it is an answer, not a failure.

## The way out

### 1 · Documentation and changelog

Invoke the `changelog` skill and follow it to the letter. It reads the diff, brings the manual and
the `docs/` files up to date, and writes the entry under `## [Unreleased]`.

One exception, which is its own rule: **when the change touches nothing but `.claude/`** — tooling
for whoever works on k0, not k0 — there is no entry and no documentation pass. Say that you
skipped it and why.

### 2 · The tests, and the floor

```bash
npm test
```

Then the coverage job, locally, exactly as CI runs it — because CI *will* run it, and finding out
from a red job after the push is a wasted round trip. Read the two numbers out of
`.github/workflows/ci.yml` rather than copying them here; the floor is a ratchet and this file
would go stale:

```bash
node --test --experimental-test-coverage \
  --test-coverage-exclude="platform/**" --test-coverage-exclude="test/**" \
  --test-coverage-lines=<lines> --test-coverage-branches=<branches> "test/*.test.mjs"
```

Never `--no-verify`. Never a skipped test, a weakened assertion or a lowered floor to get a run
green — a red build is information, and a green one bought that way is a lie that outlives the
commit. `test/clean.test.mjs` is not negotiable.

If the floor is the only thing red, the answer is a test, not a smaller number.

Then the site, which is part of the tree like anything else:

```bash
node site/build.mjs --check
```

It fails when a feature's Markdown in `site/features/` changed and its pages were not rebuilt.
The answer is `npm run site`, and the rebuilt pages go into the same commit.

### 3 · The commit

One line, Conventional Commits, imperative, English, saying what changed **for the person using
k0** — not which function moved.

```bash
git add -A
git commit -m "<type>: <what is different now>"
```

Never `--no-verify`. If several unrelated things are in the tree, say so and ask whether to split
them rather than burying them under one subject line.

### 4 · The push

```bash
git push origin main
```

This is authorised by the user having asked for the work to be shipped. It does not need a
separate question.

### 5 · Watch the run, and say what it did

```bash
gh run list --branch main --limit 2
gh run watch <id>            # or: gh run watch --exit-status
```

Report the verdict honestly. If it is red:

- **red because of this change** → fix it forward, on `main`, with another commit. Nothing has
  been published, so there is nothing to undo;
- **red for a reason that was already there** → say that, name it, and do not describe the push as
  green.

Stop here unless a release was asked for.

## The release

Only when the user asked for one. Steps 1–5 have already happened; what follows is on top of them.

1. **Decide the number and say why in one line.** Then go through *The site in a release* below —
   it is the only place a release may ask Alessio anything. While k0 is at `0.x`: something removed, or a
   behaviour that no longer works, is a minor; new behaviour is a minor; fixes alone are a patch.
2. **The `changelog` skill closes it.** It turns `## [Unreleased]` into `## [x.y.z]`, leaves a
   fresh empty `## [Unreleased]` above it, writes the two or three sentences that say what the
   version is about, and bumps `version` in `package.json`. The tag and `package.json` must agree
   or the workflow refuses the release.
3. **`npm test` again**, on the tree as it will be published.
4. **Commit it:** `chore: release x.y.z`.
5. **Push `main` first**, before the tag. The released commit has to be reachable on the branch;
   a tag pointing at a commit no branch contains is how a release becomes archaeology.
6. **Tag it:** `git tag -a vx.y.z -m "…"`.
7. **`git push origin vx.y.z`** — this, and nothing else, is what publishes. No question first;
   see *Why there is no question here* below.
8. **Watch it:**
   ```bash
   gh run list --workflow=Release --limit 1
   gh run watch <id> --exit-status
   ```
9. **Check the registry actually has it, and that it is provably ours:**
   ```bash
   npm view k0-board version
   npm view k0-board@x.y.z dist.attestations --json
   ```
   The second one has to come back with a `provenance` block and a `slsa.dev` predicate. If it
   does not, the tarball went out without the signed statement and that is worth saying out loud.
10. **Put the site online:**
    ```bash
    npm run site:deploy
    ```
    It refuses a site that was not rebuilt, uploads `site/` to Amplify, waits for the job, and asks
    the live site for every address in the sitemap; it ends with `k0-board.com is up to date` or
    names what did not answer. Only that line counts as the site being online.

### The site in a release

Every feature worth a page has one at `k0-board.com/features/<slug>/`, made from
`site/features/<slug>.md` by the `site-feature` skill while the work was being done. The release
is where that is checked, before the number is closed:

1. **List what the release brings:** the `### Added` and `### Changed` entries under
   `## [Unreleased]`, and the stories behind them (`git log <last tag>..HEAD`). For each one that
   is a feature a visitor would care about — a decision on its story saying it goes on the site,
   or, without one, anything new that a user can see — there must be a page that says so.
2. **Missing or out of date → write it now** with the `site-feature` skill.
3. **Set `since: x.y.z`** on every page that is new in this release, `updated:` to today on every
   page that changed, and run `npm run site`.
4. **Ask Alessio to look at them**, once, with the local addresses
   (`python3 -m http.server -d site 8080`, then `http://localhost:8080/features/<slug>/` for each):
   *these pages go online with the release — anything to change?* Changes are made and the pages
   rebuilt before going on. When no page is new or changed there is nothing to ask, and nothing is
   asked.

This question is not the one that went away (see below): that one asked again about a tag already
decided on. This one shows him public text he has not read yet, which is what he asked for on
2 November 2026, when the feature pages were made: the release asks him to look at the pages,
because then they go online.

### Why there is no question here

This skill used to stop once, right before step 7, and ask before the tag that publishes. On
5 September 2026, right after watching that question fire on an ordinary release he had already
asked for in as many words, Alessio asked for it to go away for good — so that it would never ask
again, not even once more. Asking again there was not caution; it was not believing him the first
time.

So nothing above is skipped **except that one question**. Everything else that made the question
safe to remove is still exactly as strict as it was: a release only starts because the user asked
for one (the line at the top of *The release*), the tests and the tag/version check still run
inside the workflow itself and can still fail it, and step 9 above still checks the registry
afterward rather than assuming. What is gone is the pause between a tag that has already been
decided on and the push that makes it real — the same trust step 4's push to `main` already
runs on without asking.

If this ever needs to be undone — the release stopped saying anything before it happened, and it
should say something again — that is a sentence to Alessio, not a thing to notice and fix quietly:
put the question back, and record here when and why.

## When it goes wrong

| What you see | What it is |
|---|---|
| `tag <t> does not match package.json <v>` | the bump and the tag disagree. Fix `package.json`, amend the release commit, move the tag |
| The workflow says the version is already published and stops | not a failure. The registry refuses a version twice; a re-pushed tag is an ordinary thing |
| The publish step fails on authentication | the trusted publisher on the package's npm settings page. **Not** a token — there is no token |
| The tag is on GitHub but no workflow ran | it went to `private`. Push it to `origin` |
| The coverage job is red and nothing else is | a test is missing. Write it. Do not lower the floor |

## Reporting back

Short, and honest:

- what the commit says, and where it went;
- what CI decided — the verdict, not the hope;
- for a release: the version, why that number, and whether the registry has it with provenance;
- for a release: which feature pages are new or changed, and whether `k0-board.com` answered for
  every one of them;
- if a branch or worktree was merged into `main` on the way, which one;
- anything you skipped, and why. Silence there reads as having forgotten.
