# Working on k0

Notes for anyone — person or agent — writing code in this repository.

## Everything here is written in English

Code, comments, identifiers, UI strings, documentation, issue and PR text, and commit messages.
This holds **regardless of the language the conversation happens in**: talk in whatever language
suits you, commit in English. The only Italian left anywhere is in `server/db.js` and
`server/mode.js`, where old preference keys and values are migrated for boards that predate the
translation — that is compatibility, not language, and it stays.

## Commits

Conventional Commits, one line, imperative, English: `fix: the board stays pinned to the bar`.
Say what changed for the person using k0, not which function moved.

## Documenting the work

Every finished piece of work is written down before it is called done:

- **`README.md`** is the manual *and* the architecture document — the section *How it is put
  together* is where the design lives. New behaviour that a user can see belongs in the manual;
  new structure belongs in that section.
- **`docs/database.md`** describes the database as it is now. Change a table and it changes with
  it, in the same commit. It is not a history: there is nothing to append.
- **`docs/testing.md`** describes how tests are written, run and measured.
- **`CHANGELOG.md`**, under `[Unreleased]`, in the Keep a Changelog shape. Every commit leaves a
  line, including one that changes nothing a user can see — that one is short and says so.

Nobody should have to ask for this, and with Claude Code nobody has to: the `changelog` skill in
`.claude/skills/` does all of it whenever the work is about to be committed, and it is where the
rules about tone live. It ships with the repository, not with the package.

## The rules the code already follows

- **No dependencies.** There is no `dependencies` block and there will not be one. SQLite comes
  from `node:sqlite`, which is why Node 24 is the floor; the Markdown renderer, the fuzzy search
  and the PDF export are all written here. No bundler, no build step, no TypeScript.
- **`npm test` before every commit.** It runs on Node's own test runner — no framework, no
  dependency — and every file is a plain script saying `check(label, got, want)` over and over.
  They must never touch the real database or the real home directory: point `K0_DB` and `HOME` at
  a temporary directory *before* the first import. CI puts a floor under the coverage of `server/`
  and `web/`; never get a run green by weakening a test or lowering that floor.
- **`test/clean.test.mjs` is not negotiable.** It fails the build if the author's personal
  fixtures come back. Do not skip it, do not weaken its list.
- **Anything that talks to the operating system goes behind `platform/contract.js`**, with an
  adapter under `platform/<os>/`. An adapter never pretends: what it cannot do it reports as a
  missing capability, so the interface can grey the button out and say why.
- **k0 talks to three places only.** Its cloud (k0 Cloud, on Supabase), and only through
  `server/cloud.js`; the Whisper model on Hugging Face, through `server/dictate.js`, fetched once
  and only when somebody presses the button on the dictation trial page that shows the address —
  only the model comes in, nothing anybody says goes out; and the public npm registry, through
  `server/update.js`, once a day, asking what the newest version of `k0-board` is — the package
  name is in the address and nothing else is in the request, nothing is downloaded, and
  `"updateCheck": false` stops it opening a socket at all. Everywhere else the answer is still no: no telemetry, no fonts fetched, no `git fetch`.
  If a change would open a socket to a fourth destination, it is the wrong change.
- **No secrets in the repository.** Supabase keys live in `~/.config/k0-cloud/.env` for
  development; the only key that may appear in code is the publishable one.
- **The server answers only itself.** Loopback bind plus a `Host`/`Origin` allowlist. Do not add
  a CORS header to make something work.

## The site

`k0-board.com` has a short page for every feature, made from `site/features/<slug>.md` by
`site/build.mjs` (`site/README.md` says how). Whether a story deserves one is decided **while it
is discussed** — with `/k0-discuss`, `/k0-story`, `/k0-epic` or just in conversation, plan or no
plan: ask *does this go on the site, as a new page or as a change to an existing one?* and record
the answer as a decision on the story. When the answer is yes, the `site-feature` skill writes the
page as soon as the behaviour exists, and writes it again whenever Alessio asks for it to be
regenerated. This lives here and not in the `/k0-*` skills because those ship to everybody who
installs k0, and nobody else has this site.

## Releasing

With Claude Code none of this has to be done by hand: the `release` skill in
`.claude/skills/` is the whole road out — documentation, tests, the coverage floor, one commit,
the push, and the tag. It used to stop and ask once, before the tag that cannot be taken back;
Alessio asked for that question to go away for good, so it no longer does — see *Why there is no
question here* inside the skill itself for when and why. It ships with the repository, not with
the package. What follows is what it does.

A release publishes everything: from `main` (a branch or a worktree is merged in first), the
package to npm and then the site to Amplify with `npm run site:deploy`, after checking that every
feature it brings has its page and asking Alessio to look at the pages that are new or changed —
the one question a release still asks.

Bump the version in `package.json`, close the `[Unreleased]` section of `CHANGELOG.md` into a
numbered one, commit, then push a tag that matches: `git tag -a v0.2.0 -m … && git push origin
v0.2.0`. `.github/workflows/release.yml` does the rest — it runs the tests on all three
platforms, refuses a tag that disagrees with `package.json`, skips a version already on the
registry, and publishes with a signed provenance statement.

There is no npm token, in the repository secrets or anywhere else. npm trusts this repository
and this workflow directly (trusted publishing, OIDC), which is why nothing has to be kept
secret and nothing has to be rotated. If a release ever fails on authentication, the thing to
check is the trusted publisher on the package's npm settings page, not a token.

## Style

Two spaces, no semicolons, single quotes, 120 columns — `.editorconfig` has the rest. Comments
explain *why*, and are worth writing when the reason is not obvious from the code; the ones that
restate the line above are not.
