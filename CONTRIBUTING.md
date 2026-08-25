# Contributing

Thank you for looking. k0 is maintained by one person, so the most useful thing you can do is
tell the truth about what happened on your machine — especially if that machine is not a Mac.

## Running it from a clone

```bash
git clone https://github.com/alessio-ragni/k0-board.git
cd k0-board
node bin/k0-board.js start
```

That runs the server in the foreground and opens the board. Nothing is installed, no service is
registered and nothing outside the directory is touched. Stop it with Ctrl+C.

`node bin/k0-board.js install --from-source` installs it properly but points the service at your
checkout, which is what you want while you are working on k0 itself.

**Requirements**: Node 24 or newer (k0 uses the SQLite support built into Node), git, and Claude
Code. On Linux, also tmux. There are no npm dependencies and there is nothing to build — except
the macOS menu bar icon, which needs the Xcode Command Line Tools.

## Tests

```bash
npm test
```

They are plain scripts, not a framework: every file builds a list of `check(label, got, want)` and
prints them. There is nothing to install and nothing to configure, and a failing line tells you
what it expected.

They never touch your real board or your real home: each file points `K0_DB` and `$HOME` at a
temporary directory **before** importing anything, because imports resolve before the first line
of code runs. If you add a test that reaches the database or the home directory, do the same.

`test/clean.test.mjs` is the odd one out: it scans every file for the personal data k0 grew up
with and fails if any of it comes back. Do not disable it.

## Adding a platform

Everything that talks to the operating system lives under `platform/`, behind the contract
described in `platform/contract.js`. A new platform means one new directory with five files —
`terminal.js`, `power.js`, `metrics.js`, `shell.js`, `service.js` — and an `index.js` that
assembles them. Nothing above that line needs to change.

Two rules make the difference between a port that helps and one that misleads:

**Never pretend.** If your platform cannot do something, say so in `capabilities` and explain why
in `notes`. The board greys the feature out and shows your sentence. A button that quietly does
nothing is worse than one that is visibly off.

**Probe, do not assume.** Whether window placement works on Linux depends on X11 versus Wayland,
not on "linux". Whether Windows can paste depends on PowerShell being there. Compute capabilities
at runtime.

`node bin/k0-board.js doctor` prints what your adapter is claiming. It is the fastest way to see
whether a port is honest.

## Style

There is no linter and no formatter config, because there are no dependencies. Match what is
already there: no semicolons, single quotes, 120 columns, two-space indentation.

Comments carry the reasoning. k0 is heavily commented on purpose — not what the code does, but
why it does it that way, and what went wrong when it was done otherwise. If you fix something
subtle, the comment explaining the trap is worth more than the fix.

## Pull requests

- One thing per pull request.
- Say which platform you tested on. "Untested on Windows" is a perfectly good thing to write, and
  far better than silence.
- Run `npm test` first.
- Commit messages describe the change from the outside: what a user would notice.

## Reporting a bug

Open an issue and include the output of `k0-board doctor`. It says what your machine can and
cannot do and why, which is the first question anybody would ask.

For anything security-related, see [SECURITY.md](SECURITY.md) instead — please do not open a
public issue for it.
