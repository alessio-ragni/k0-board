# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **The installation ends on the board.** `npx k0-board` now opens it in your browser once
  everything is in place, after the cards have been imported, so the first thing you see is your
  own work and there is no address to copy out of the terminal. `--no-open` finishes without it,
  for installing over SSH. Where the name `k0.localhost` does not resolve, k0 falls back to
  `127.0.0.1` rather than leaving you on a blank page.

### Changed

- **Nothing here changes what you see using k0.** The work went underneath, and it was worth doing
  for two reasons. The tests now run on the machinery Node already ships with rather than on a loop
  written by hand, which turns seven pass-or-fail files into five hundred and twenty-one named
  checks — still a quarter of a second, still nothing to install, but a failure now names the one
  thing that broke instead of the file it was in. And two parts that had never been tested at all
  are: the one that decides whether a request reaching k0 may be answered, which is what stands
  between a web page you happen to have open and a program that opens terminals on your machine,
  and the one that keeps your cards, which is where a mistake loses work you cannot get back.
  Every build from now on refuses to go backwards on how much of k0 is covered.
- **The reasoning behind k0 is now written down where it can be found.** Two documents for whoever
  works on it: the shape of what k0 remembers, and how its tests are put together and what they
  deliberately leave alone. Neither is shipped with the package.

## [0.1.2]

Two things that were in the way every day: a field nobody needed, and a notification that opened
the wrong application.

### Fixed

- **Clicking a notification opens that session's terminal**, on all three platforms. On macOS it
  used to open **Script Editor** with a file dialog: when the Mac would not deliver k0's own
  notifications, k0 fell back to posting one through `osascript`, and a banner posted that way
  belongs to Script Editor rather than to k0 — no card, no click, wrong application. The fallback
  is gone. When macOS refuses the permission, k0 now says so in the menu bar and takes you to the
  Notifications pane — and switch it on there and the menu says so on the next pass, a couple of
  seconds later, instead of leaving you looking at a message that reads as stuck. It writes what
  the answer was in its log, and asks again rather than giving up on the first refusal. On Linux
  the notification carries an action, on Windows the balloon finally has a click.

### Changed

- **A new card asks for three things**: the repository, a title, and what Claude should do when it
  starts — which can be left empty and typed straight into Claude Code. The *Description* field is
  gone: it never went anywhere except onto the note. Imported sessions keep theirs, which is the
  one place it says something, and `/k0-import` still writes it.
- **A note is never taller than it is wide.** Long text used to push a card down the column until
  it stopped looking like a note. The repository, the title, the age and the buttons always show;
  the text in the middle is what gets clipped.

## [0.1.1]

Documentation, and how a release is made. Nothing about k0 itself changed.

### Changed

- The README says what the npm package is, how to keep it up to date, and what each command
  does.
- Releases are published by GitHub Actions through npm's **trusted publishing**, with a signed
  provenance statement and no publishing token kept anywhere — not in the repository secrets,
  not on a laptop. A token that can publish is a token that can be stolen.

## [0.1.0]

The first public release. k0 existed for a while as one person's tool before this; what changed
here is everything that had to change for it to be somebody else's tool as well.

### Added

- **Linux and Windows.** Everything that talks to the operating system now sits behind one small
  contract (`platform/contract.js`), with an adapter per platform. Linux drives terminals through
  tmux; Windows through PowerShell and Windows Terminal. Both are written but **untested by the
  author**, who has neither machine — see the README.
- **`k0-board`, one command to install.** It replaces a 400-line shell script, runs on all three
  platforms, and says everything it is about to change before it changes any of it.
- **`k0-board doctor`**, which prints what your machine can and cannot do, and why.
- **A capability report on the board.** Where a platform cannot do something — control the lid,
  resize a terminal's font, read what is on its screen — k0 says so instead of offering a button
  that quietly does nothing.
- **The first-run invitation to import.** The installer offers to fill the board from the Claude
  Code sessions already on the machine, so it does not open empty.
- MIT licence, contributing guide, code of conduct, security policy, issue templates and
  continuous integration on macOS, Linux and Windows.
- `CLAUDE.md`, the house rules: English everywhere, no dependencies, and what has to be written
  down before a piece of work counts as finished.

### Changed

- **Everything readable is in English**: the interface, the documentation, the messages, and the
  comments in the code.
- **The database moved out of the project directory** into `~/.k0/` (`%LOCALAPPDATA%\k0` on
  Windows), along with the logs and the cache. An existing database is moved there automatically
  the first time the new version starts.
- The mode is called `mode` rather than `modo` throughout — the endpoint, the JSON, the
  preference. An existing preference is migrated, so an upgraded k0 does not forget where it was.
- The handwriting font is bundled instead of being fetched from a font service on every load. k0
  now makes no network requests at all.

### Fixed

- **The API no longer answers web pages.** It used to send a wildcard CORS header on a route that
  serves files from your repositories, which let any site on the internet read them. The header is
  gone, and requests are now checked against the `Host` and `Origin` they arrive with.

### Removed

- The personal fixtures k0 grew up on. `test/clean.test.mjs` now fails the build if any of them
  come back.

[Unreleased]: https://github.com/alessio-ragni/k0-board/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/alessio-ragni/k0-board/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/alessio-ragni/k0-board/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/alessio-ragni/k0-board/releases/tag/v0.1.0
