# The tests

```bash
npm test          # all of them, about a quarter of a second
npm run test:watch # again on every save, while you work on one thing
npm run coverage  # the same, plus how much of k0 they went through
```

There is nothing to install. The runner is the one built into Node — the same reasoning that gets
SQLite from `node:sqlite`: it is already there, so it costs no dependency, and it brings names,
filtering, a watch mode and a coverage report with it.

To run one test while you are fixing it, match its name:

```bash
node --test --test-name-pattern="the loopback address" "test/*.test.mjs"
```

The name of a section works too, because every test is named after the band it belongs to:
`--test-name-pattern="The path guard"` runs that band and nothing else.

## Writing one

Every test file is a plain script that says the same thing over and over: this label, this value,
that value.

```js
import { check, section } from './harness.mjs'
import { kindOf } from '../server/files.js'

// ── What kind of file is this ────────────────────────────────────────────────
section('What kind of file is this')
check('markdown gets laid out', kindOf('plan.md', Buffer.from('# x')), 'markdown')
check('a PDF gets its own frame', kindOf('invoice.pdf', Buffer.alloc(0)), 'pdf')
```

`check` is one named test and one strict comparison. `section` names the band that follows, so a
whole band can be run or read on its own; it mirrors the comment banners the files are already
divided by. Both come from `test/harness.mjs`, which is the only piece of machinery here.

The label is the point. It is read by somebody looking at a red line who has never seen the code,
so it says what should have happened — `'climbing out does not get through'` — not which function
was called. Values that are not strings get flattened by hand, usually with `.join(' ')`, because
the comparison is strict and a failed one should print something you can read.

Where a test needs more than one comparison, or has to wait for something, import `test` and
`assert` from `node:test` and `node:assert/strict` directly. `check` is the shorthand for the
common case, not a rule.

## The two rules that are not style

**Move `K0_DB` and `HOME` before the first import.** Imports all resolve before the first line of
code runs, so a plain `import` at the top of the file is already too late: `db.js` opens the
database the moment it is pulled in, however indirectly, and the real board would be the one it
opened. Set the variables, then `await import(...)`.

```js
process.env.K0_DB = path.join(os.tmpdir(), `k0-something-test-${process.pid}.db`)
const store = await import('../server/db.js')
```

This is not hypothetical: it happened, and it left five identical cards on a real board in a
column that did not exist. `db.js` now refuses to open the real database from a file whose name
ends in `.test.mjs`, but the error is a backstop, not the plan. The same goes for the home
directory — `os.homedir()` honours `$HOME` on POSIX and `%USERPROFILE%` on Windows, so both are
pointed at a temporary directory when a test reads or writes under the home.

**Tidy up in `after`, and close the database before deleting its file.** Teardown written at the
bottom of the file runs before the tests do. `after` is imported from the harness alongside
`check`:

```js
after(() => {
  store.close()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.K0_DB + suffix, { force: true })
})
```

The handle has to go before the file does. POSIX lets an open file be unlinked; Windows refuses,
and that one line is the whole difference between a green build and a red one there.

## What is not tested, and why

Everything that needs a real machine: opening a terminal, keeping a laptop awake, placing a
window, registering a service, printing a PDF through a headless browser. An adapter under
`platform/` is exercised only where it parses text — the output of `pmset`, of `ps`, of
`/proc/meminfo` — because that is the part that can be wrong quietly. The rest is left alone
rather than mocked into a shape that proves nothing.

The two big browser files, `web/board.js` and `web/files.js`, are not tested either: they are
written against the DOM, and testing them would mean either a browser or a fake one, and the fake
one is a dependency. What was worth extracting from them already has been — the markdown
renderer, the fuzzy search, the mentions and the references all live in files of their own and are
covered.

`server/index.js` is not loaded by any test. The piece of it that carries a promise — who is
allowed to talk to the server at all — was moved into `server/guard.js` so it could be read and
proved on its own, and it is.

## `test/clean.test.mjs`

The odd one out: not a unit test but a scan of every tracked file, looking for the personal data
k0 grew up with. It runs first, and it fails the build before any logic test gets a chance to
pass.

It is not decoration. The failure it guards against is quiet and one-way — a fixture pasted from a
real repository, a path copied out of a terminal — and once pushed it is public forever. Do not
disable it and do not shorten its list.

## Coverage

`npm run coverage` prints a line per file and a total. Two things about that number are worth
knowing before anyone quotes it:

**It counts only the files a test loads.** A module nothing imports does not appear at all, so it
cannot drag the number down. `server/index.js` and the two browser files are in that position.

**It is measured on `server/` and `web/` only.** `platform/` is left out, because which adapter
loads depends on the operating system and the number would move with it.

In CI the same measurement runs once, on Ubuntu, with a floor under it: below the floor the build
fails. The floor is a ratchet — raise it when the number clears it comfortably. Lowering it is a
decision somebody has to argue for, not a way of getting a build green, and neither is deleting an
assertion or skipping a test.
