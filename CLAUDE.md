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
- **`CHANGELOG.md`**, under `[Unreleased]`, in the Keep a Changelog shape.

Nobody should have to ask for this.

## The rules the code already follows

- **No dependencies.** There is no `dependencies` block and there will not be one. SQLite comes
  from `node:sqlite`, which is why Node 24 is the floor; the Markdown renderer, the fuzzy search
  and the PDF export are all written here. No bundler, no build step, no TypeScript.
- **`npm test` before every commit.** The tests are plain scripts: each builds a list of
  `check(label, got, want)` and prints it. They must never touch the real database or the real
  home directory — point `K0_DB` and `HOME` at a temporary directory *before* the first import.
- **`test/clean.test.mjs` is not negotiable.** It fails the build if the author's personal
  fixtures come back. Do not skip it, do not weaken its list.
- **Anything that talks to the operating system goes behind `platform/contract.js`**, with an
  adapter under `platform/<os>/`. An adapter never pretends: what it cannot do it reports as a
  missing capability, so the interface can grey the button out and say why.
- **k0 makes no network requests.** Not for fonts, not for updates, not for telemetry. It never
  runs `git fetch`. If a change would open a socket to the outside, it is the wrong change.
- **The server answers only itself.** Loopback bind plus a `Host`/`Origin` allowlist. Do not add
  a CORS header to make something work.

## Releasing

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
