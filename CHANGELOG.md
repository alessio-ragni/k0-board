# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/alessio-ragni/k0-board/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/alessio-ragni/k0-board/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/alessio-ragni/k0-board/releases/tag/v0.1.0
