# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0]

k0 could already tell you what each session was costing you in memory, and `Close` on a card was
already how you gave it back. This version is k0 remembering to do that for you: a terminal left
untouched all day is shut by itself, and the card it belongs to stays exactly where it was, ready
to be picked up again. It is careful about which ones — never one that is working, never one with
a question on screen — and it is the first thing in k0 you can change without changing k0, in a
settings file that writes itself.

### Added

- **The terminals you have stopped using close themselves, and the work stays.** A session left
  open goes on costing memory whether or not anybody is looking at it — the `claude` process, the
  MCP servers it started, the browsers those opened — and `Close` on a card has always been the
  cure. Now k0 remembers to do it for you: **after twelve hours with nothing happening, a yellow
  card's terminal is shut and its memory given back**. Nothing is lost. The card stays exactly
  where it is with the status it had, and **Resume** picks the conversation up where it was, the
  same as it always did. Only yellow — *Your turn* — is ever touched: a card that is **working**
  is somebody mid-thought, and a card with a **question or a plan on screen** would lose the very
  thing it was showing you, because a dialog that is open has not been written to the transcript
  yet. A session sitting in a **shell** is left alone too — there may be a command of yours
  running in it, and k0 cannot see what. A window you were using an hour ago is never closed,
  whatever the card's history says: every clock k0 has for that session is consulted and the
  newest one wins.
- **A card says who closed it, and the top bar says the closing is on.** Where a card used to read
  *session closed* it now reads *closed automatically* if it was k0 that tidied it away — same
  italic, same place, one word different. And the memory chip at the end of the top bar carries the
  hours in lighter type: **RAM 79% · CPU 19% · closes at 8h**, with the whole sentence on hover.
  That is where it belongs, because that is where the memory is already being talked about, and
  something that closes your windows for you should never be a surprise. Switched off, the chip
  says nothing rather than *0h* — which would read as "closes immediately" — and the hover says so
  instead.
- **Settings, in a file that is the list of them.** `~/.k0/config.json` — on Windows
  `%LOCALAPPDATA%\k0\config.json` — written out on the first run with every setting already in it
  at its default, so opening it is how you find out what there is to change. It sits beside the
  board rather than inside the app, so an update cannot throw it away, and k0 picks up a change by
  itself without anything being restarted. `closeIdleTerminalsAfterHours` is the first entry:
  **set it to `0` and the closing above never happens**. There is no settings page on the board and
  there is not going to be one — the board is for what changes during a working day —
  so `k0-board doctor` prints the whole list too, with what is in force and where the file is.

### Fixed

- **Resuming a session no longer types the old prompt back in.** A card's prompt belongs to the
  moment the session starts; on **Resume** the conversation had already answered it hours ago, and
  putting it back under the cursor was at best something stale in the way — at worst it was sent,
  because where pasting is not available k0 types it instead. Start is unchanged.

## [0.2.0]

k0 could always tell you how the work stood. This version lets it tell you whether the work is
*running*: a globe in each column heading says whether that repository's site is up, and switches
it on or off from the board. The server it starts belongs to nobody and outlives everything —
the session that asked for it, the other sessions, and k0 itself — which is the one thing a dev
server started inside a session could never do.

### Added

- **A globe next to every repository: is the site up, and one click to change it.** Last on a
  column's heading, after the git mark. Grey is off, green is up, it breathes while it is coming
  up, and red means it was started and did not come up — with the reason and the log a hover
  away. **One click switches it, two restart it**, and while it is green the repository's **name
  is underlined with a green dashed line** and becomes a link that opens the site in another tab,
  on the port it is really listening on. The line is the same green as the globe and stays for as
  long as the server does, so a repository that is up can be told apart from across the board
  without going near it. A
  repository gets one when its `package.json` has a `dev` script, or failing that a `serve` one:
  nothing to configure, nothing to fill in. The point of it is where the server lives: k0 starts
  it **detached and owned by nobody**, so it survives the session that asked for it, every other
  session, and k0 restarting under it. A dev server started inside a session belongs to that
  session and dies with it, which is what made "is the site up" a question nobody could answer
  from the board. k0 also **never asks the server whether it is up** — it makes no network
  requests, here as everywhere else — so "up" means the process is alive and the system says it
  is holding a TCP port open, which is both stronger evidence and where the real port in the
  tooltip comes from. And a server **you** started by hand in a terminal turns the globe green on
  its own within a few seconds, and switches off from the board like any other: a globe that only
  knew about its own servers would sit grey next to a site that is plainly running. On Windows
  that last part is missing, because nothing there can read another process's working directory,
  and k0 says so instead of drawing those servers as off. Tried on a real board, against a
  repository that had a `server-restart` skill to compare with: the globe went green on port
  4321 — read off the running process, not off the port written in the skill — the name opened
  the site, a double click brought it back on a new process with nothing orphaned behind it, and
  a server started by hand in a terminal was picked up and then switched off from the board. And
  the one that matters: after `k0-board restart` the globe was still green and the site still
  answering on the same process.

### Changed

- **A column's heading is two groups now, and the count of post-its is gone.** What you press is
  on the left — the `+` and the fold — and what tells you how things stand is on the right: the
  git mark, and the globe after it. The number that used to follow the repository name has been
  taken out. It sat in the middle of the row taking up the room the name now uses, and it was
  never the answer to a question anybody had: the post-its are right there to be counted, and
  the number moved every time a filter did. Long repository names now give up characters to an
  ellipsis instead of pushing the marks off the end of the row.

### Fixed

- **A tab left open no longer shows you the old interface.** k0 sent its own pages and stylesheets
  with no instruction about keeping them, so the browser decided for itself — and a board left
  open all day went on using the stylesheet it loaded that morning. It showed up the first time
  the globe arrived: the servers switched on and off correctly and the board redrew every second,
  but the heading kept the shape it had before, because the page redraws itself and the stylesheet
  does not. After an update it is worse than confusing: the new k0 on disk, the old one on screen.
  They are a few kilobytes over a connection to your own machine, so nothing is kept now.

- **`Close` gives the memory back without closing the work.** A link at the end of a card's row,
  after `Done` and quieter than it: it stops the session and shuts its terminal — which is where
  the memory was going — and leaves the card exactly where it is, with the colour it had. The one
  asking you something stays red, the one holding a plan up stays amber, the one at your turn
  stays yellow, and `Resume` picks the conversation up where it left off. Until now the only way
  to give a machine its memory back was `Done`, which also declares the work finished, so a dozen
  windows open meant choosing between a struggling computer and a board that lies. It is not there
  while a session is working: stopping one mid-thought is not memory saved, it is work lost. Tried
  on a real board, on a session weighing 380 MB: the window and the process were gone in a second
  and a bit, the card stayed where it was, and `Resume` came back to the same conversation.
- **A ChangeLog page that tells you what you have been doing.** The list-shaped button next to
  the `+` opens a page of its own that reads like a release note: an opening paragraph on how the
  day went, then one block per repository saying what is different now — and, underneath it, what
  is **done but not out yet**. A commit still sitting on your machine, changelog lines written
  but never closed into a version, files never committed. Four windows across the top — Today,
  Yesterday, Week, Month — and it opens on none of them: it opens on the last day you actually
  worked, so on a Monday you get Friday instead of an empty page. Only repositories you touched
  in that window appear, so the one that has been dirty since March stops turning up every
  morning as if it were news, and only your own commits are counted, so a repository shared with
  other people still tells you about your day. The facts sit folded under each block, one line to
  open them, with every commit marked green if it is online and amber if it is still only here.
  The words are written by the Claude Code already on your machine — no key to paste, no account
  to configure, nothing leaving the machine — and they come out in the language you commit in,
  because they are written out of your own commit messages. Nothing is stored: the page is
  written again every time you open it. Without Claude Code it still opens, with the facts and a
  line saying why the rest is missing.
- **The board keeps itself down to what you are working on.** A repository you have not touched
  since the day before your last piece of work folds away by itself: its column leaves the board
  and its name appears in `Old`, the new column next to `Others` and built exactly like it — a
  `+`, a name and the git mark. Click that row and the column comes back at full width for the
  rest of the visit, with everything that was in it. There is nothing to switch on — with a dozen
  repositories open, you arrive in the morning and the three or four you are actually on are the
  ones standing there, side by side. The day is counted back from your last piece of work rather
  than from the clock, so on Monday you find Friday's work instead of an empty board. A column
  with something going on in it — working, planning, asking you something, holding a plan up for
  approval — never folds, whatever its age; a terminal simply left open at *Your turn* folds like
  anything else, and folding closes nothing. And nothing folds while you are looking at it: the
  board tidies itself on the next reload, never out from under your hands.
- **A column can be put away now.** Next to a column's `+`, a button that folds it immediately
  instead of waiting for it to go quiet — for a repository you are finished with for the day. It
  goes faint and refuses on a column with something going on in it, and says why if you hover it.
  It is remembered across reloads, until you fetch the column back or something in it wakes up.
  It closes nothing: no session is stopped and no terminal is shut. What closes a session is
  `Close` or `Done` on a card.
- **The installation ends on the board.** `npx k0-board` now opens it in your browser once
  everything is in place, after the cards have been imported, so the first thing you see is your
  own work and there is no address to copy out of the terminal. `--no-open` finishes without it,
  for installing over SSH. Where the name `k0.localhost` does not resolve, k0 falls back to
  `127.0.0.1` rather than leaving you on a blank page.

### Changed

- **The zoom goes ten per cent at a time.** `+` and `−` used to jump from 100% straight to 80%,
  or up to 125%: the steps in between simply did not exist, and the only way to a size like 90%
  was a pinch on the trackpad — if you knew to try it. Now every click is ten points — 90%, 80%,
  70% and so on, still stopping at 30% and 200% — so where the next one lands is something you
  can guess before you press it. The pinch still gets you to anything in between, and from there
  the next click picks the nearest step.
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
- **Nothing changes for you here either.** Putting out a new version of k0 — the documents brought
  up to date, the tests run, and the version that reaches the registry — is now one road written
  down rather than a sequence somebody has to remember, with a single stop to ask before the step
  that cannot be undone. Like the two documents above, it is for whoever works on k0 and is not in
  the package.

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

[Unreleased]: https://github.com/alessio-ragni/k0-board/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/alessio-ragni/k0-board/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/alessio-ragni/k0-board/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/alessio-ragni/k0-board/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/alessio-ragni/k0-board/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/alessio-ragni/k0-board/releases/tag/v0.1.0
