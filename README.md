# k0

**A board of sticky notes that drives your Claude Code sessions.** One column per project, one
card per piece of work. From a card you open a real terminal, and on the card you see at a
glance whether the session is working, has finished, is asking you something, or has a plan
waiting for your approval.

It exists because of one specific moment: four terminals open, and no way to tell which one is
waiting for you without clicking through all four.

If you have used a kanban board, an infinite canvas like Miro, and a wall of paper sticky notes,
you have already seen the three pieces k0 is made of: cards standing in columns, a board that pans
and zooms instead of scrolling, and notes that sit at their own slightly crooked angle. What is
different is what those things are underneath. **A column is a repository, not a stage** — nothing
gets dragged from one to the next; the cards reorder themselves by who is waiting for you.
**A card is a real Claude Code session** — it opens a terminal, it knows what that session is
doing, and it goes on saying so while you are looking somewhere else.

![Four columns of paper sticky notes — yellow, blue, amber and green — pinned on a dark wall, each note tilted at its own angle, with a row of small coloured status pills along the top bar.](https://raw.githubusercontent.com/alessio-ragni/k0-board/main/docs/board.jpg)

[![Tests](https://github.com/alessio-ragni/k0-board/actions/workflows/ci.yml/badge.svg)](https://github.com/alessio-ragni/k0-board/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/k0-board)](https://www.npmjs.com/package/k0-board)
[![License: MIT](https://img.shields.io/badge/License-MIT-informational)](LICENSE)

**Contents** · [Install](#install) · [How it is used](#how-it-is-used) ·
[The files of a session](#the-files-of-a-session) · [What it costs](#what-it-costs) ·
[Filling the board with what you have already done](#filling-the-board-with-what-you-have-already-done) ·
[The statuses](#the-statuses) · [The four modes](#the-four-modes) ·
[Shift+Enter starts a new line](#shiftenter-starts-a-new-line) ·
[Pasting into the terminal](#pasting-into-the-terminal) ·
[How it is put together](#how-it-is-put-together) · [Security](#security) ·
[What is not here yet](#what-is-not-here-yet) · [Contributing](#contributing) · [Licence](#licence)

---

## Install

```bash
npx k0-board
```

That is the whole thing. It tells you everything it is about to change, asks, and only then does
it — and when it is finished it opens the board in your browser, so there is no address to write
down anywhere. `k0-board uninstall` undoes all of it.

k0 is published on npm as [`k0-board`](https://www.npmjs.com/package/k0-board): one package, no
dependencies, nothing to compile. `npx` fetches it, runs the installer once and leaves nothing
behind — what stays on the machine is the copy the installer puts in `~/.k0/app`, not an npx
cache that could be swept away under a running service. Installing it globally with
`npm install -g k0-board` works too, if you would rather have the command on your PATH.

**To update it**, run the installer again with `npx k0-board@latest`: it replaces the copy and
restarts the service. Your board is never in the way — it lives in `~/.k0/k0.db`, outside
everything the installer touches, and `uninstall` leaves it there as well.

Every release is published by GitHub Actions with a signed **provenance statement**: proof, which
`npm audit signatures` will check for you, that the tarball was built from a particular commit of
this repository rather than uploaded by somebody who happened to have a password. (0.1.0 predates
that and went out from a laptop.)

### The commands

| | |
|---|---|
| `k0-board install` | install and start it — this is what `npx k0-board` runs |
| `k0-board uninstall` | undo everything install did; your board stays |
| `k0-board start` | run the server in the foreground, installing nothing |
| `k0-board restart` | restart the service |
| `k0-board status` | is it running? exits 0 if it is, 1 if it is not |
| `k0-board doctor` | what this machine can and cannot do, and why |

`--yes` does not ask. `--from-source` points the service at the directory you are in instead of
copying it, which is what you want while working on k0 itself. `--no-open` finishes without
opening a browser, which is what you want over SSH. `--no-<name>` skips one optional change —
`--no-lid-sleep`, `--no-shift-enter`. `K0_PORT` moves the board off 4319.

From a clone, if you would rather look first:

```bash
git clone https://github.com/alessio-ragni/k0-board.git
cd k0-board
node bin/k0-board.js start
```

That runs the server in the foreground and opens the board. Nothing is installed and nothing
outside the directory is touched.

The board lives at <http://k0.localhost:4319>, which is the address both `install` and `start`
open for you. If that name does not resolve on your machine — which happens on Windows, because
only browsers are obliged to know that `.localhost` means this computer — k0 opens
<http://127.0.0.1:4319> instead, and says so.

### Requirements

- **Node 24 or newer.** k0 keeps the board in SQLite through `node:sqlite`, which is built into
  Node — there is nothing to install and there are no npm dependencies at all.
- **Claude Code**, obviously.
- **git**, for the mark on each card that says whether your work is safe.
- **macOS**: Xcode Command Line Tools, to build the menu bar icon. Nothing else.
- **Linux**: tmux, which is how k0 drives terminals there. Optionally `xdotool` for window
  placement, and `python3` with PyGObject for the tray icon.
- **Windows**: PowerShell, which is already there. Windows Terminal is recommended.

### Which platforms this really works on

| | macOS | Linux | Windows |
|---|---|---|---|
| Open a terminal and run Claude Code in it | ✅ | ✅ tmux | ✅ |
| Read the terminal to know when it is ready | ✅ | ✅ | ❌ waits a fixed moment instead |
| Leave your prompt in place, unsent | ✅ needs Accessibility | ✅ | ✅ |
| Place, resize and raise windows | ✅ | ✅ X11 only | ✅ |
| Large text in terminals for driving mode | ✅ | ❌ | ❌ |
| Keep the machine awake | ✅ | ✅ | ✅ |
| Keep working with the lid closed | ✅ | ❌ system setting | ❌ system setting |
| Tray icon and notifications | ✅ | ✅ GNOME/KDE | ✅ |
| Clicking a notification takes you to that terminal | ✅ needs the permission | ✅ if the desktop honours actions | ✅ |

**macOS is the only platform the author has.** Linux and Windows are written from the
documentation and reviewed carefully, and the logic they share with macOS is tested on all three
in CI — but nobody has yet sat in front of a Linux desktop or a Windows machine and watched k0
open a terminal on it. If you are the first, please
[say what happened](https://github.com/alessio-ragni/k0-board/issues), including the parts that
worked.

`k0-board doctor` prints this same table for your actual machine, with a sentence explaining
every ❌.

### What installing it changes

Nothing on this list happens before you have seen it and said yes. Everything on it is undone by
`k0-board uninstall`, and any single item can be skipped with `--no-<name>`.

| What | Where | Why |
|---|---|---|
| A copy of k0 | `~/.k0/app` | so the service does not point at a temporary npx cache |
| Your board, logs and cache | `~/.k0/` | `%LOCALAPPDATA%\k0` on Windows |
| A service that starts at login | LaunchAgents · systemd user unit · Task Scheduler | so k0 is simply there |
| **macOS only** — one administrator rule | `/etc/sudoers.d/k0-pmset` | to keep the Mac awake with the lid closed. Asks for your password once, and grants exactly two command lines |
| **macOS only** — one key binding | your Terminal profile (backed up first) | so Shift+Enter starts a new line |
| **macOS only** — Accessibility for `node` | you grant it by hand, in System Settings | so k0 can place a prompt without sending it |

That last one deserves a sentence of its own: a process with the Accessibility permission can
send keystrokes to any application, and here it is granted to your `node`, not to a signed k0
app. Skipping it breaks nothing — the prompt gets typed and the session starts by itself.

k0 makes **no network requests**. Not one, not even for a font.

---

## How it is used

### The board

- **+** — at the left, next to k0, and next to every repository name on the board: that one opens
  a card with the repository already chosen. Three fields and no more: the repository, a title,
  and what Claude should do when it starts. The prompt can be left empty — nothing stops you from
  starting the session and typing straight into Claude Code.

  The repository has to be **picked from the list** (searchable, most used at the top; arrow keys
  to move, Enter takes the highlighted row): a name typed by hand does not count. On leaving the
  field, if what you typed identifies exactly one repository it takes that one; otherwise the
  field empties — either you select one or there is nothing.

  At the bottom there are **Save** and **Start**: Start saves and launches the session
  immediately. The **X** at the top closes without saving.

  The title normalises as you type: a capital at the start of every word, dashes instead of
  spaces, and the capitals you typed stay where you put them — `fix api` becomes `Fix-Api`, while
  `Fix API` stays `Fix-API`. What you see in the field is exactly the name the session will have.

- **the pencil** (top right of a card) — the only way to open the editor: clicking the card
  itself does nothing. On a card that is already finished, where there is nothing left to edit,
  the **bin** takes its place.

  Changing the title — only the title; the prompt has nothing to do with it — **immediately**
  rewrites the name in the window's title bar, even while the session is running. Inside Claude
  Code the real name catches up when the session ends: while the process is alive the transcript
  already has an owner, and it would write the old name back over ours.

- **Start** — opens a new terminal window, runs `claude` in the right repository under the card's
  name, and puts the prompt in it. You press Enter.

  The session is **born in plan mode**, always. On the board the card turns **Planning** as soon
  as it gets to work, and amber **Needs approval** when the plan is ready. If you need something
  else, shift+tab as usual. **Resume** forces nothing: that session already had a mode, and it
  comes back as it was.

  In exchange, **once the plan is approved it asks for confirmations**: starting inside a plan and
  never asking anything are two things Claude Code does not do together — the why is
  [further down](#the-traps).

  The window is born **centred on the screen you are using**, at 86% of the free space: the same
  margin on all four sides, never under a menu bar or a dock. Open more than one and they stack
  in the middle — double click brings the one underneath back.

  **If the screen changes** — you plug a monitor in or out, or change resolution — the windows put
  themselves back: all of them centred on the main screen, at their usual size, without asking and
  **without bringing the terminal to the front**.

- **double click** — brings that session's terminal back to the front, even if you had minimised
  it. It is what stops you losing track of which window is which.

- **Resume** — appears once you have closed the terminal: it reopens the same conversation exactly
  where it was.

- **Done** — closes the work **and its terminal**, with no questions: undo it with **Reopen**, and
  pick the conversation up again with **Resume**. It is not on backlog cards: they never started.

  The session is stopped first and only then is the window closed. Closing a window with `claude`
  still inside it makes macOS put up the "terminate running processes" dialog, and the window does
  not close at all.

- **Close** — a link at the end of the row, quieter than the buttons because it is the one you
  reach for least: it closes the terminal and **not the work**. The session is stopped, its window
  goes, and the machine gets the memory back; the card stays exactly where it is, with the colour
  it had — the one asking you something stays red, the one holding a plan up stays amber, the one
  at your turn stays yellow — and **Resume** takes it from there. It is what a dozen windows open
  and a computer running out of air are answered with.

  It is **not there while the session is working**: stopping one mid-thought is not memory saved,
  it is work lost. Wait for it to come back to you, and then close it.

The only thing that asks for confirmation is throwing a card away.

Cards reorder themselves inside a column: first the ones waiting for you, then the ones grinding
away, backlog at the bottom, and among equals the most recent first.

### Moving around

**There are no scrollbars.** With a dozen repositories open the board is wider than the screen,
and to turn it you **bring the pointer near an edge**: from there it moves that way by itself —
right, left, up, down, and diagonally in the corners — faster the closer you are, and it stops
where the board ends. The thin shadow along one side says there is still something over there.
Holding a mouse button keeps the board still, so a click near the edge lands.

Bottom right there is the **zoom**: + and − move it ten per cent at a time — 90%, 80%, 70% and so
on, between 30% and 200% — and the percentage between them, clicked, goes back to 100%. The button
next to it shrinks just enough to fit the whole board on the screen. On a trackpad, two fingers
move the view and a pinch zooms to anything in between; the next click of + or − picks the nearest
step from there. Where you were is still there after a reload.

The pills at the top are both legend and filter: click one and that status leaves the board. They
stay as you left them.

**The board keeps itself down to what you are working on.** A repository you have not touched
since the day before your last piece of work folds away by itself: its column leaves the board
and its name appears in `Old`, over on the right. There is nothing to switch on and nothing to
tidy up — with a dozen repositories open, you arrive in the morning and the three or four you are
actually on are the ones standing there, side by side.

The day is counted back from **your last piece of work, not from the clock**, and that is what
makes it survive a weekend: on Monday the freshest thing on the board is Friday evening, so what
you find is Friday — not an empty board on the one morning you most need to see where you left
off. The moment you start something on Monday the line moves with you.

Two things never fold. **A column with something going on in it** — working, planning, asking you
something, holding a plan up for approval — stays where it is however old it is: hiding the one
that is waiting for you is the opposite of what the board is for. A terminal simply left open at
**Your turn** is not one of those: it is the resting state of every window you have not closed,
and a session you finished with three weeks ago would otherwise hold its column at full width for
ever. It folds like anything else — and folding closes nothing, so the terminal is still open and
the card is still exactly where you left it. And **nothing folds while you are looking at it**: within one visit the set of columns can only grow, and the board tidies itself
on the next reload, so a column never disappears out from under your hands.

**The last two columns on the right are `Old` and `Others`**, and they are the same list twice
over: a `+`, a name and the git mark, in alphabetical order. `Old` is the repositories that have
work on the board, just not lately; `Others` is the ones that have no column because they have no
cards at all. **Click a row in `Old` and the column comes back** at full width for the rest of the
visit — with everything that was in it, which is why the row itself says nothing about how much
that is or how long it has been there. Both columns are also there for the same two things:
getting into the files of a directory you are not working on, and giving birth to the first card
there with the `+`.

Next to a column's `+` there is one more button, which **puts that column away now** instead of
waiting for it to go quiet on its own — for when you are finished with a repository for the day
and would rather not look at it. On a column with something going on in it the button goes faint
and refuses, and says why if you hover it — it does not disappear, because a column runs and goes
back to your turn every few seconds and it would spend the session blinking.
Unlike the automatic fold, this one is remembered across reloads, until you fetch the column back
or something in it wakes up. It **closes nothing**: no session is stopped and no terminal is
shut. It is the board that gets smaller, not the work — what closes a session is `Close` or `Done`
on a card.

### The git mark

On every card, next to the repository name, and next to every column name, one symbol says
whether the work is safe: a **dot** with how many files, if there is work that is nowhere yet; an
**up arrow** with how many commits, if it is committed but not pushed; a faded **tick**, if
everything is saved. Hover to read it in full — branch, files, commits, and how many of those
commits belong to that session. **Click it and the files open.**

A card running in an **isolated worktree** has a working tree of its own, so the mark is really
its own. A card working in the base repository shares the working tree with everybody — there the
dot belongs to the repository, and the only thing that belongs to the session is the commits made
since it started, which k0 counts by remembering where `HEAD` was at that moment.

k0 **never runs `git fetch`**. It only looks at what your git already knows about the remotes. For
"did I push this?" that is exact and instant, because pushing updates the remote reference by
itself; a push made by somebody else does not show until you fetch. On a repository with no
remote, pushing is not mentioned at all.

---

## The ChangeLog

The git mark answers "is this safe" for one repository, right now. The **ChangeLog** answers a
different question — *what have I actually been doing* — across all of them at once. It is the
list-shaped button next to the `+`, and it opens in a page of its own.

It reads like a release note rather than a report. An opening paragraph saying how the day went,
then one block per repository: a line saying what is different now, a short paragraph, a few
points, and — the part that matters most — **what is done but not out yet**. A commit sitting on
your machine, three changelog lines written but not closed into a version, four files never
committed. That is the distinction the whole page is built on: what left here, and what only
looks finished.

Four windows across the top: **Today**, **Yesterday**, **Week**, **Month**. It opens on none of
them: it opens on **the last day you actually worked**. On a Monday that is Friday, because a
page that comes up empty after every weekend is a page you stop opening.

**Only what you touched in that window appears.** A repository that has been dirty since March
and that you have not opened since is not news, and a summary that repeats it every morning is
one nobody is still reading by Thursday. Something has to have happened there — a commit, a file
saved, a card moved — before k0 will tell you what is still outstanding in it. And only **your**
commits are counted: k0 asks git which email you commit with in that repository and shows that
person's day, so a repository shared with other people still tells you about yours.

Below every block the facts are folded away, one line to open them: the commits themselves, each
marked green if it is online and amber if it is still only here. That is what to open when you do
not believe the paragraph above it.

### Who writes it

k0 does not. **k0 makes no network requests**, and that is worth more than a better paragraph: a
model of its own would mean a key to keep, an account to configure, and your commit messages
leaving this machine.

It does not need one. If you are running k0 you already have Claude Code installed, signed in and
paid for — that is the whole point of the board — so the model is already here. k0 works out the
facts, hands them to Claude Code, and shows what comes back. No terminal opens, nothing appears
on the board, and there is nothing to set up: the skill that does the writing ships inside the
package, the same way `/k0-import` does.

It is written **in your language**, without a setting anywhere, because it is written out of your
own commit messages and card titles.

Nothing is saved. Every time you open the page it is written again, and changing the window
writes it again — which is why there is no stale summary to clear and no history to prune.
"Today" changes while you are reading it, so keeping a copy would be wrong more often than it
helped. If Claude Code is not on the machine the page still opens: you get the facts, and a line
saying why the rest is missing.

---

## The files of a session

The git mark is also the door: clicking it opens a file viewer **in another tab**, and the board
stays where it is. Where there is no mark — a repository without git, or git that has not answered
yet — a **lens** takes its place, so every card and every column still leads in.

Files on the left, what they say on the right, and a divider in between that you can drag.

**Only documents are listed** — markdown, html, text, PDF, Word: things you read and print. In a
real repository code is 95% of the files, and among two thousand `.tsx` files the document you
were after cannot be found. This closes nothing off: a code file reached by a link inside a
document still opens, and so do images.

The listing is flat, in three groups:

- **Changed** — what this session has touched: files still hanging in the working tree plus the
  ones inside commits made since it started.
- **Recent** — the thirty most recently modified. It is the only group you can have where there is
  no git.
- **All files** — everything else, in path order.

The search at the top looks in two places and keeps them apart:

- **Names** — not the exact word, but the letters you type in the order you type them: `audrep`
  finds `docs/audit-report.md`. It filters as you type, asking the server nothing.
- **In the text** — inside the documents, with the line the word appears on and the word
  highlighted. Because what you remember about a file is what was in it, not what it was called.
  Accents do not need typing — `cafe` finds `café`.

There is no index. The documents are read every time: a few hundred files of a few KB, all
already in the operating system's cache. An index would cost more and go stale.

`/` puts the cursor in the search, arrows scroll, Enter opens, Esc clears.

### Pasting a chunk of chat

There is a way to reach files that does not go through searching for them. When a session ends,
the summary in the chat says what it touched and **names the files already**. Click the **lens** at
the top, paste that piece of conversation, press **Find the files**, and the list on the left
narrows to the files that text names.

It looks **only for the names written down**, not for the subject: no index, no server, no
waiting — the file listing is already in the browser. The price is stated: a file the chat talks
about without ever naming does not come out, and for that there is the search above.

The results come in two groups, because they are two different degrees of certainty:

- **From your text** — what is written out in full: a name with its extension, or a directory
  path. The path can be complete, partial, or with things in front that do not count.
- **Maybe these** — what is only guessed at, and it arrives **closed** so as not to cover the
  other: a word that is a file's name without the extension, or the whole beginning of a name.
  In here file names come **before** directories: in a text about onboarding the word
  "onboarding" is an ordinary word before it is a directory, and arriving first it would carry
  off that directory's files.

Files come **in the order they appear in the text**, which is the order of the story, and the
first opens by itself on the right. A name that fits several files — eight `README.md` — shows
**one row**, the most recently touched, with "7 more" next to it.

### The file names inside a document are clickable

Documents point at each other constantly, but almost never with a markdown link: you write
`glossary.md` in backticks, you put `search/summary.md` in a table, you say "it produces
`out/report.pdf`". All those names **are clickable**, and open the file in a **new tab**.

There is one rule: **it has to exist**. There is no list of words to avoid, and none is needed —
in a README full of `TRUE`, `spacing`, `active: false` and `bold`, existence throws all of them
out by itself.

The hard part is not finding the names, it is choosing **which**. In a repository with nine
`README.md` files, the right one is the one in the directory you are reading in; failing that, one
directory up, and so on to the top. If it is still ambiguous, **it does not become a link**:
better nothing than sending you to the wrong README.

Files the listing does **not** show open too. `out/`, `dist/`, `node_modules/` stay out of the
listing — in a code repository they are generated — but in a directory of documents `out/` holds
the real PDFs. When it is a document naming them, that file counts. Hidden directories really do
stay out: `.claude/` is configuration, not something to read.

### On paper

At the end of the path row there are three buttons that change with the file: the **printer** (or
Ctrl/Cmd+P), the file **as it is on disk**, and the **PDF**.

The sheet gets **only the document**: no file listing, no bar, no divider, and not even the path
or the front matter. Code blocks, tables and images do not break across two pages.

The **PDF is not the print dialog**: the server opens a headless Chrome on the same page and has
it print, so the file arrives already laid out in your downloads. The difference shows — from
there the margins are ours and the date and address do not end up at the top, which the browser
puts there from the print dialog and CSS cannot remove. It needs Chrome or Chromium installed;
without one the button says so, and printing and downloading still work.

---

## What it costs

At the end of the top bar there is **how the computer is doing**: memory and CPU, with a green,
amber or red dot. The colour is not a threshold k0 invented — on macOS and Linux it is the
kernel's own verdict, plus one added rule: amber when memory in use goes over 90%. Hover to read
the whole picture, including **what is heavy and is not k0**: if the machine is struggling because
of Chrome it is fair to know that, instead of closing sessions for nothing.

On every card there is **what that session weighs**. Not the `claude` process: everything it has
dragged along — the MCP servers, the Chromes they open, a `tsc` started from a commit hook. That
is where the memory goes, and it is the thing no other tool can attribute to the right card.

Only one card is red, the heaviest, and only while the machine is struggling: if they were all
red they would say nothing.

Two things said plainly. The CPU is the CPU of **right now**, worked out from the difference in
CPU time between two readings — `ps`'s own `%cpu` would be the average since the process was born,
which on an old session says nothing about this minute. And summing the memory of a process tree
counts shared memory twice, so the total is a little generous: it is the usual approximation, and
it is the right one for the question that matters — which one do I close to feel better.

And once you have decided, **`Close` on that card is how you give the memory back**: the session
is stopped and its window goes, the work stays on the board as it was, and `Resume` picks the
conversation up where it left off. Nothing has to be declared finished to stop weighing.

Reading the process table costs little on a calm machine and a lot on a struggling one, which is
exactly when you look at it. So it is sampled every three seconds, and **only while the board is
open**.

---

## Filling the board with what you have already done

An empty board is no help in getting your bearings. The installer offers to do this on the first
run; afterwards, `/k0-import` from a Claude Code session picks up the sessions that already
happened — including the ones opened by hand, outside k0 — and puts them on the board as cards:
the last 14 days, at most the 10 most recent per repository. `/k0-import 30 5` changes the two
numbers.

The difference between the two is the writing. The installer uses the name the session already
had, or the first few words of the first prompt. `/k0-import` has Claude read the conversation and
write a title and a description in the language it was held in. That description is the line in
italics under the title on the note, and importing is the only thing that writes one: a card you
write yourself has a title and a prompt, which is all it needs.

Imported cards are born yellow — *Your turn*: **Resume** reopens the conversation where it was,
**Done** clears it away. Being dead sessions they do not light the tray icon. Running it again
skips the ones already imported.

Automated runs stay out — `claude -p`, subagents, skills launched from a script. The tell is the
`{"type":"mode",…}` line, which only Claude Code's interface writes when it really starts. On one
real machine that separated 145 genuine sessions from 867 automated ones, and it is read from
64 KB at the head and 64 KB at the tail rather than the whole file.

---

## The statuses

A card **is** the colour of its status — there is nothing else to read. On the left is the code in
the database, then how it reads on screen.

| | | | |
|---|---|---|---|
| `BACKLOG` | **Backlog** | grey | just an idea, the session has not been born |
| `ASK` | **Needs answer** | red | it is asking you something |
| `PLANNED` | **Needs approval** | amber | it has finished a plan and is waiting for your yes |
| `IDLE` | **Your turn** | yellow | the terminal is idle, waiting for you to say something |
| `WORKING` | **Working** | blue | it is working |
| `PLANNING` | **Planning** | light blue | it is working inside a plan |
| `COMPLETED` | **Done** | green | you closed it |

The first four are your move; the two blues are its move.

---

## The four modes

How awake the machine has to stay while sessions are working. It is a **scale of four steps**, not
four switches: each includes the one before it, and exactly **one** is always lit. Clicking the lit
one again does nothing — you leave a mode, you do not switch it off.

| Icon | Mode | The machine | The screen | The text |
|---|---|---|---|---|
| two **z** | **Sleep** | sleeps as it normally would | goes off | normal |
| a **palm tree** | **Away** | does not sleep, not even with the lid closed | may sleep and lock | normal |
| a **nerd face** with glasses | **Nerd** | does not sleep | **stays on** | normal |
| a **car** | **Driving** | does not sleep | **stays on** | **large**, here and in the terminals |

The four icons do not describe the machine: they describe **where you are**. Asleep, away, at the
desk, watching from across the room. That is where the order comes from, and it is why the second
one is a palm tree and not a technical symbol: the mode does not say "the machine is on", it says
"I am not here, but it keeps going".

The four buttons are at the end of the board's bar, or four ticked entries in the tray menu. They
are the same control: changed on one side, the other catches up within a couple of seconds.

**Nerd** and **Driving** do exactly the same things to the machine: the only difference is the size
of the text. Nerd is "I am sitting here programming", Driving is "I glance at it from across the
room".

### Why an idle inhibitor is not enough

The `caffeinate -dim` you leave running in a terminal sets three assertions, and they are all
*idle* assertions. They stop sleep **from inactivity**. The sleep that fires when you **close the
lid** is not that one: it is a forced sleep, and it goes straight past them. Anyone relying on
`caffeinate` to work with the lid shut is relying on a wrong idea of what that command does.

On macOS the only thing that stops that one too is the system flag **`SleepDisabled`**, which
takes root. So there are **two levers**: an inhibitor that follows the mode, and the system flag,
which is the one that can be missing.

The installer writes one line in `/etc/sudoers.d/k0-pmset` granting that command and nothing else,
after validating the file with `visudo -c` — a malformed file in there would make `sudo` unusable
on the whole machine. Skip the password and nothing breaks: the modes still work, but only with
the lid open, and the lit button takes an **amber ring** to say so rather than promising something
it does not do.

**On Linux and Windows the lid is not k0's to touch.** There it belongs to a machine-wide setting
— `HandleLidSwitch` in logind, the power plan in Control Panel — that outlives k0 and that k0 has
no business rewriting behind your back. The switch reports itself unavailable, and `k0-board
doctor` says where to change it yourself.

### Large text, and windows that do not move

In Driving the **text inside the terminals** goes from the profile's size to 22, the board's from
17 to 22 pixels, and the **things you click** grow too — the `+`, the git lens, the corner pencil
(which also stays visible instead of appearing only on hover), the zoom controls. They are in
pixels, so they would not grow with the rest.

The one thing that changes and is not a measurement is the **order of the columns**: in Driving
they reorder by urgency, reddest to the left. On a screen you glance at, two or three columns are
visible at a time and the most urgent one has to come to you. Full screen you have them all in
front of you already, and a board that reshuffles itself while you work only loses your place.

**The windows do not move.** New ones are born centred at 86% as always; ones already open do not
shift by a pixel — if you had dragged one to the other monitor, there it stays. Terminals already
open change size **immediately**, not only the ones you open next.

That the window does not move **is not free**, and it is the least obvious part of this whole
chapter: Terminal.app keeps rows and columns when the font changes and resizes the window to
match — going from 12 to 22 turns a 700×500 window into 1378×856, measured. So the bounds are read
first, the font is changed, and **its own** bounds are put back.

k0 touches **only its own windows**, the ones born from a card.

### What it remembers, and what it looks at

**The mode is remembered**, Driving included. A missing row means Away, which is the right way to
start. At startup the server reapplies it.

Reapplying rather than deducing is the point. The server restarts often — working on k0's own code
is enough — and the windows from before do not notice. Applying the saved mode **repairs** that
mismatch, while reading the state back off the windows would adopt it.

But memory is for **what you want**; for **how the machine actually is**, it looks. After every
command the system state is read back: if the flag is not on, the button does not claim it is.

### Why the machine does not stay awake forever

A sleep block is **system state**, not something held in memory: if k0 vanished while it was on,
the machine would never sleep again and nobody would know why. There are four nets:

1. the inhibitor is born tied to the server's process id, so it dies when the server dies, even
   when the server is killed outright;
2. the server has an **exit handler** on `exit`, `SIGTERM`, `SIGINT` and `SIGHUP` that releases
   the block;
3. **at startup it repairs**: if the saved mode is Sleep but the block was left on by a server
   that died badly, it is switched off;
4. **`k0-board uninstall`** removes the block and then the permission — in that order, because
   the other way round would leave the machine awake with no way left to fix it.

And one more guard, which is not a net but a courtesy: **below 15% on battery** it lets go of the
lid. A machine forbidden to sleep does not merely drain: it reaches zero and dies outright, which
is worse than a session left waiting. The idle inhibitor stays, and everything resumes as soon as
the power is back.

---

## Shift+Enter starts a new line

*(macOS only. On Linux tmux already does this; on Windows, Windows Terminal does.)*

Terminal.app, up to macOS 26, does not tell Shift+Enter from Enter: the program receives the same
single byte, so Claude Code has no way of noticing the Shift and sends the message. That is why
the documented way to start a new line was a backslash and then Enter.

k0 puts a key binding in the Terminal profile that sends **Esc+Enter** on Shift+Enter — the
sequence Claude Code reads as "new line", the same one its own `/terminal-setup` installs for
other editors. Before touching the preferences it backs them up.

The hard part is not writing it, it is **when** to write it: Terminal reads bindings **only at
startup**, and **on quitting it rewrites its preferences** from what it had in memory — erasing
whatever you put there while it was running. So writing it with Terminal open does nothing, and
the ⌘Q that ought to make it stick is precisely the moment it disappears.

The only good moment is **right after Terminal has quit**. The menu bar icon catches it: it is
always running and it sees applications leave. You never have to do anything.

Worth knowing:

- the binding lives in the **profile**, so it applies to **every** Terminal window with that
  profile, not only the ones k0 opens. That is deliberate;
- **the very first time, Terminal has to be quit completely (⌘Q) and reopened**, and there is no
  way around it;
- **backslash and Enter still work**: nothing is taken away;
- `k0-board uninstall` removes that one entry and leaves the rest of your bindings alone;
- from **macOS 27** none of this is needed: the Shift arrives distinct by itself, and k0 does not
  touch anything (the check is already in).

---

## Pasting into the terminal

**Cmd+V for everything**, text and images. But the two go by different roads:

- **text** is pasted by the terminal itself, as always;
- **images** are k0's doing. Outside an IDE, Cmd+V with an image on the clipboard does nothing:
  the terminal swallows the keystroke before Claude Code sees it, and an image would not go
  through a terminal anyway.

  k0 does not intercept the keystroke — that road wants the Accessibility permission and needs
  macOS to make it stick. It works on the clipboard instead, which asks for no permission:
  **while Terminal is in front**, an image on the clipboard is saved to `~/.k0/cache/images/` and
  its path is put in its place. Your Cmd+V pastes that path, and Claude Code recognises it and
  attaches it as `[Image #1]`. The moment you switch to another application, the image comes back.

  An honest side effect: if you copy an image, go into Terminal, and **from there** switch to
  another application and paste within a third of a second, you may paste the path instead of the
  image.

Two side effects of the Cmd+V k0 uses to write your prompt, worth knowing:

- the card's prompt replaces whatever was on your clipboard (if the paste fails, the clipboard is
  put back);
- to paste, the terminal is brought to the front for an instant: if you happen to be **dictating**
  at that moment, the dictation lands in there and sticks to the prompt.

---

## How it is put together

No dependencies, nothing to compile. Change a file, reload the page.

```
bin/
  k0-board.js    the command line: install, uninstall, start, doctor. Says what it will change,
                 asks, and only then does it
platform/
  contract.js    the line between k0 and the operating system, and what an adapter must fill in
  index.js       picks the adapter, and reports what this machine can and cannot do
  darwin/        AppleScript and Terminal.app, pmset and caffeinate, launchd, the Swift icon
                 (menubar/, which is also what posts the notifications and reads the permission)
  linux/         tmux and any emulator, systemd-inhibit, systemd user units, a GTK tray
  win32/         PowerShell and Windows Terminal, execution state, Task Scheduler, a WinForms tray
  shared/        what more than one of them needs: tmux, running commands, reading a process table
server/
  index.js       the http server, the API, and the watching loop that runs every second
  guard.js       who is allowed to talk to this server at all: the Host and the Origin
  db.js          SQLite (node:sqlite): the card, session_event and pref tables — docs/database.md
  paths.js       where the board, the logs and the cache live
  watcher.js     reads Claude Code's own files and derives the statuses; also renames a session
  git.js         the only one that talks to git: what is committed, what is pushed, whose it is,
                 and — for the ChangeLog — what the commits actually said
  changelog.js   gathers what happened in a window, out of git and out of session_event. Decides
                 which repositories are worth mentioning at all, and stores nothing
  writer.js      hands those facts to the Claude Code already on this machine and gets the words
                 back. The only place k0 starts a model, and it never leaves the machine to do it
  launcher.js    starts and resumes sessions, through the platform's terminal
  mode.js        the four modes: how awake to keep the machine, and whether the text goes large
  projects.js    the repositories, in the order you last used them
  sessions.js    digs already-lived sessions out of the transcripts, to import as cards
  files.js       the only one that reads the projects' disk: what is there, what changed, what it says
  machine.js     the only one that looks at processes and memory: what it all costs, and who is costing it
  pdf.js         the document on paper, printed by a headless browser
web/             the three pages (html, css, js served exactly as they are)
  index.html     the board — board.js, board.css, view.js. A note is never taller than it is
                 wide: the title, the age and the buttons always show, the text in the middle is
                 what gets clipped
  files.html     the file viewer — files.js, files.css
  changelog.html what you have been doing — changelog.js, changelog.css. The only page in k0 you
                 read top to bottom instead of looking at, so it is the only one that scrolls
  base.css       colours, fonts and scale: the house variables, shared by all three pages
  md.js          markdown laid out, written by hand because nothing here is compiled
  recency.js     which repositories are still warm, and which fold away into `Old`
  fuzzy.js       searching the names: the letters you type, in the order you type them
  mentions.js    which of a repository's files a piece of text names
  refs.js        what a name written inside a document points at, and which of the nine READMEs
.claude/skills/
  k0-import/     the skill that fills the board with sessions you have already had
  k0-changelog/  the one that turns the facts of a stretch of work into something readable. k0
                 calls it by itself when the ChangeLog is opened, so it is in the package too
  changelog/     the one that writes the changelog and the documentation when work is finished.
                 For whoever works on k0, not for whoever uses it: it is not in the package
  commit-push-deploy/
                 the road out: the documents, the tests, the commit, the push, and the tag that
                 publishes. Also for whoever works on k0, and also not in the package
docs/
  database.md    the shape of the database as it is now: the three tables, column by column
  testing.md     how the tests are written, run and measured, and what is left untested on purpose
test/            npm test — Node's own runner, no framework. See docs/testing.md
  harness.mjs    check(label, got, want), and the sections the labels are grouped under
```

### What it reads, and what it never does

k0 does not emulate a terminal and installs no hooks. It reads two things Claude Code already
writes for itself:

- `~/.claude/sessions/<pid>.json` — live status (`busy`, `idle`, `waiting` with the reason for the
  wait) and the session id;
- `~/.claude/projects/<project>/<session>.jsonl` — the transcript, read incrementally, which is
  where you can tell whether you are inside a plan.

Sessions are launched with `--session-id` (k0 chooses the id, so the card ↔ session link is
certain), `-n` for the name, `--resume` to pick one up, and `--permission-mode plan` on new ones.

The ChangeLog runs Claude Code a second way: `claude -p /k0-changelog`, with the facts on
standard input and no terminal at all. It is the one time k0 starts a model, and it still opens
no socket of its own — the request is Claude Code's, made with your own account, from your own
machine. Those runs cannot come back as cards: `sessions.js` drops `claude -p` when it looks for
sessions to import, which is also how it tells a hundred and forty real sessions from eight
hundred automated ones.

### The traps

Field notes the code takes for granted.

- **A notification posted by `osascript` belongs to Script Editor.** `display notification` is the
  one-line way to put a banner on screen from a script, and it works — but the banner is not
  yours: it carries nothing, it has no delegate, and clicking it opens Script Editor with its file
  dialog. It was in here as a fallback for when macOS would not deliver k0's own notifications,
  and every click on it went to the wrong application. There is now one way to notify, and where
  macOS refuses it the menu says so and takes you to the Notifications pane instead of pretending.
- **`--dangerously-skip-permissions` switches off plan mode.** No error, no warning, and the order
  of the two flags changes nothing — the session starts in `bypassPermissions` and there is no
  trace of a plan. It looks like it works, which is what makes it a trap. The only way to really
  start inside a plan is `--allow-dangerously-skip-permissions`.
- **While a dialog is open, the call that caused it is not yet in the transcript.** A plan to
  approve and a question are told apart by the `waitingFor` field of the session file:
  `permission prompt` is the plan, `input needed` is the question.
- **The transcript directory's name** is the path with **every** non-alphanumeric character
  replaced by `-`, truncated at 200 characters with a hash on the end. That is lossy: `my_project`
  and `my-project` become the same name, so the working directory is always read from inside the
  transcript, never by reversing the directory name.
- **A session's name lives in two places** — the session file, rewritten by the live process, and
  the end of the transcript, in `custom-title` and `agent-name` lines that Claude Code rewrites
  every turn. **The last one wins.** So renaming a closed session means appending another copy; a
  live one would have the old name written back over it.
- **The session file appears before the interface is ready to receive.** Writing at that moment
  loses the first characters and swallows the Enter. So k0 waits until it can see the input box —
  and where a platform cannot read a terminal's screen, it waits a fixed moment and says so.
- **`do script … in tab 1 of window id N`** writes into the interface with no simulated keystrokes
  and no permissions, but it **always adds the Enter**. You can hold the Enter back with a
  trailing backslash, but the backslash stays on screen and forces two presses: tried and rejected.
- **The font size is a property of the tab**, not only of the profile — which is what lets k0
  change its own windows without dragging along terminals that are not its own. But changing it
  makes Terminal keep rows and columns **and resize**: the font goes **before** the bounds, or the
  size you just set is eaten.
- **A key binding in Terminal's preferences** is an entry under `Window Settings → <profile> →
  keyMapBoundKeys`: the key is the modifiers (`$` = Shift) followed by the key code in four hex
  digits, and the value is the raw bytes to send (Esc is the byte `1b`, not the text `\033`). It
  is written with `plutil -insert`, not PlistBuddy: PlistBuddy converts the file from binary to
  XML, and with a `1b` byte inside, that XML is not even valid. And `killall cfprefsd` twice, not
  once: **before** writing, so the preferences daemon flushes what it still holds from the Terminal
  that just quit, and **after**, or nobody sees the change.

### Where the repository list comes from

The order is the fresher of two histories. The first is `~/.claude.json`, where Claude Code notes
when you opened each one — but `lastStartTime` is rewritten when the session *ends*, so on its own
it only tells you about the past. The second is k0's own database, which moves when you create or
edit a card and on every status change of a live session. That is what brings the repository you
are working in right now to the top.

The list holds directories with a `.git`, directories you have already worked in even if they are
not repositories, directories with a card, directories with a document inside them — and **empty
ones**.

Empty ones belong because an empty directory under your home is one you just made, and it cannot
be anything other than a project about to start: make it, and on the first refresh it is already
in `Others` with its `+`. Anything starting with a dot does not make it full, or one glance from a
file manager would be enough to make it disappear again.

**A column lives as long as its directory does.** If that directory is gone — deleted, renamed, an
external disk unmounted — the column does not appear, and neither do its cards. **Hiding is not
deleting**: the cards stay in the database, and if the directory comes back so do they.

---

## Security

The server listens on loopback only, and refuses requests that arrive with a `Host` or `Origin`
it does not recognise — which is what stops a web page you happen to have open from talking to it.
HTML files from your repositories are shown in a sandbox with no permissions. There is no account
and no token: anything already running as you on this machine can reach the API, and that is worth
knowing rather than glossing over.

The full picture, and how to report a problem privately, is in [SECURITY.md](SECURITY.md).

## What is not here yet

Checkboxes inside a card. In the viewer only documents are listed: code opens if you arrive at it
from a link, but it is not browsable and the text search does not look at it. Files are read only:
they are not edited, not diffed, and you cannot talk to them — for that you open the repository
with Claude. Sessions opened by hand outside k0 are picked up with `/k0-import`, on request:
nothing notices them by itself yet.

## Contributing

Yes please — especially if you are on Linux or Windows, where nobody has tried this yet. See
[CONTRIBUTING.md](CONTRIBUTING.md); the fastest useful thing you can send is the output of
`k0-board doctor`.

## Licence

[MIT](LICENSE) © Alessio Ragni · [alessioragni.com](https://alessioragni.com)
