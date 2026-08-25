---
name: commit-push-deploy
description: The whole way out of a working tree — documentation, tests, one commit, the push to GitHub, and, when it is a release, the tag that publishes k0 to npm. Use this skill whenever the user asks for the work to be shipped, in whatever words and whatever language — "commit and push", "ship it", "cut a release", "publish", "committa e pusha", "manda in produzione", "fai una release", "/commit-push-deploy". It calls the changelog skill rather than repeating it, runs the tests and the coverage floor before anything leaves the machine, watches the run on GitHub, and stops to ask exactly once, before the tag that cannot be taken back. Do not use it to write a commit message on its own, to inspect what changed, or when the user only wants the changelog.
---

# Getting the work out

There is one road out of this repository and this is it: documentation, tests, one commit, a push
to `origin`, and — only when a release was asked for — a tag whose arrival on GitHub is what
publishes k0 to npm.

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

Stop and say so, rather than carrying on, when:

- **the two git directories differ** — this is a worktree. Releasing from one pushes a branch
  nobody is on. Close it into the base branch first (`/worktree-close`), then come back;
- **HEAD is detached**, or the branch is not the one the user means;
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

1. **Decide the number and say why in one line.** While k0 is at `0.x`: something removed, or a
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
7. **Stop. Ask.** See below.
8. **`git push origin vx.y.z`** — this, and nothing else, is what publishes.
9. **Watch it:**
   ```bash
   gh run list --workflow=Release --limit 1
   gh run watch <id> --exit-status
   ```
10. **Check the registry actually has it, and that it is provably ours:**
    ```bash
    npm view k0-board version
    npm view k0-board@x.y.z dist.attestations --json
    ```
    The second one has to come back with a `provenance` block and a `slsa.dev` predicate. If it
    does not, the tarball went out without the signed statement and that is worth saying out loud.

### The one question

Everything above happens because the user asked for the work to be shipped. Pushing the tag is
different, and it is the only place this skill stops:

> About to publish **k0-board x.y.z** to npm. \<one line on what the version is about\>. This
> cannot be undone. Go ahead?

Ask it once, plainly, and wait. Do not ask it again later, and do not ask anything else along the
way — a second question teaches the user to wave questions through, which is exactly what must not
happen at this one.

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
- anything you skipped, and why. Silence there reads as having forgotten.
