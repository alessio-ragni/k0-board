# k0

**A board of sticky notes that drives your Claude Code sessions.** One column per project, one
story per piece of work. From a story you open a real terminal, and on the story you see at a
glance whether the session is working, has finished, is asking you something, or has a plan
waiting for your approval.

It exists because of one specific moment: four terminals open, and no way to tell which one is
waiting for you without clicking through all four.

If you have used a kanban board, an infinite canvas like Miro, and a wall of paper sticky notes,
you have already seen the three pieces k0 is made of: stories standing in columns, a board that pans
and zooms instead of scrolling, and notes that sit at their own slightly crooked angle. What is
different is what those things are underneath. **A column is a repository, not a stage** — the
stories reorder themselves by who is waiting for you, rather than being pushed along a pipeline.
(One switch in the top bar lays the same stories out as a list instead, for the days you are
planning rather than working.)
**A story drives real Claude Code sessions** — it opens a terminal, it knows what that session
is doing, and it goes on saying so while you are looking somewhere else. A story may have had
several over its life, one at a time, and it keeps all of them.

![Four columns of paper sticky notes — yellow, blue, amber and green — pinned on a dark wall, each note tilted at its own angle, with a row of small coloured status pills along the top bar.](https://raw.githubusercontent.com/alessio-ragni/k0-board/main/docs/board.jpg)

[![Tests](https://github.com/alessio-ragni/k0-board/actions/workflows/ci.yml/badge.svg)](https://github.com/alessio-ragni/k0-board/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/k0-board)](https://www.npmjs.com/package/k0-board)
[![License: MIT](https://img.shields.io/badge/License-MIT-informational)](LICENSE)

**Contents** · [Install](#install) · [How it is used](#how-it-is-used) ·
[The backlog](#the-backlog) · [The ChangeLog](#the-changelog) · [What's New](#whats-new) ·
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
- **git**, for the mark on each story that says whether your work is safe.
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
| Rename a running session when its title changes | ✅ needs Accessibility | ❌ when it ends | ❌ when it ends |
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
| Your board, settings, logs and cache | `~/.k0/` | `%LOCALAPPDATA%\k0` on Windows |
| A service that starts at login | LaunchAgents · systemd user unit · Task Scheduler | so k0 is simply there |
| **macOS only** — one administrator rule | `/etc/sudoers.d/k0-pmset` | to keep the Mac awake with the lid closed. Asks for your password once, and grants exactly two command lines |
| **macOS only** — one key binding | your Terminal profile (backed up first) | so Shift+Enter starts a new line |
| **macOS only** — Accessibility for `node` | you grant it by hand, in System Settings | so k0 can place a prompt without sending it |
| The commands, if you want them | `~/.claude/skills/` | Claude Code looks there and in the repository you have open, and nowhere else. Asked once; installing again brings the copies up to date without asking |

That last one deserves a sentence of its own: a process with the Accessibility permission can
send keystrokes to any application, and here it is granted to your `node`, not to a signed k0
app. Skipping it breaks nothing — the prompt gets typed and the session starts by itself.

k0 makes **exactly one network request**, and you can switch it off. Once a day it asks the public
npm registry what the newest version of `k0-board` is, so the board can mention that there is one.
The package name is in the address and nothing else is in the request: not the version you are
running, not your repositories, not your commits, not your board, not an identifier of any kind.
Nothing is downloaded and nothing is run — k0 cannot update itself. Set `"updateCheck": false` in `~/.k0/config.json` and and no
socket is opened, ever. Everything else stays as it was: no fonts fetched, no telemetry, no
`git fetch`.

---

## How it is used

### The board

- **+** — at the left, next to k0, and next to every repository name on the board: that one opens
  a story with the repository already chosen. Two fields and no more: the repository and a title.
  Nothing is asked about what the story is for, because both ways out of the dialog open a terminal
  and you say it there. (With a backlog behind the board the `+` at the left is a menu of two — a
  story typed here, or an epic told to a terminal — the dialog gains a field for the story's epic,
  and the two buttons are *Discuss* and *Quick Start*. Editing a story that exists adds a list of
  **notes**, which sit on the post-it for you to read and are never sent to Claude Code. It is
  written out [below](#the-two-views).)

  The repository has to be **picked from the list** (searchable, most used at the top; arrow keys
  to move, Enter takes the highlighted row): a name typed by hand does not count. On leaving the
  field, if what you typed identifies exactly one repository it takes that one; otherwise the
  field empties — either you select one or there is nothing.

  At the bottom there are **Save** and **Start**: Start saves and launches the session
  immediately. The **X** at the top closes without saving.

  The title normalises as you type: a capital at the start of every word, dashes instead of
  spaces, and the capitals you typed stay where you put them — `fix api` becomes `Fix-Api`, while
  `Fix API` stays `Fix-API`. What you see in the field is exactly the name the session will have.

- **the pencil** (top right of a story) — the only way to open the editor: clicking the story
  itself does nothing. On a story that is already finished, where there is nothing left to edit,
  the **bin** takes its place.

  Changing the title — only the title; the prompt has nothing to do with it — renames the session
  too, in three places at three moments. The window's title bar, **immediately**, session running
  or not. The session itself, if it is still running, **the first time you look at it**: when that
  window is the one in front of you and Claude Code is sitting idle with nothing under the cursor,
  k0 types `/rename` with the new name into it and presses Enter — you will see the command go by.
  It never brings the window up to do that: the keyboard is yours, and a terminal jumping up while
  you type somewhere else would take your next words. And the list of sessions you can resume,
  **when the session ends** — while the process is alive the transcript already has an owner, and
  it would write the old name back over ours. On Linux and Windows the second of the three is
  missing, and `k0-board doctor` says so: there the name catches up when the session ends. The
  same happens when a skill changes the title through the API.

- **Start** — opens a new terminal window, runs `claude` in the right repository under the story's
  name, and puts the prompt in it. You press Enter.

  The session is **born in plan mode**, always. On the board the story turns **Planning** as soon
  as it gets to work, and amber **Needs approval** when the plan is ready. If you need something
  else, shift+tab as usual. **Resume** forces nothing: that session already had a mode, and it
  comes back as it was.

  In exchange, **once the plan is approved it asks for confirmations**: starting inside a plan and
  never asking anything are two things Claude Code does not do together — the why is
  [further down](#the-traps).

  Every session, new or resumed, is also born **with Claude Code's task list switched on**. On a
  newer model Claude Code leaves it off unless it is told otherwise, and the commands that plan,
  work and check keep a task per step — so without it they would be asking for a tool that is not
  there.

  The window is born **centred on the screen you are using**, at 86% of the free space: the same
  margin on all four sides, never under a menu bar or a dock. Open more than one and they stack
  in the middle — double click brings the one underneath back.

  **If the screen changes** — you plug a monitor in or out, or change resolution — the windows put
  themselves back: all of them centred on the main screen, at their usual size, without asking and
  **without bringing the terminal to the front**.

- **double click** — brings that session's terminal back to the front, even if you had minimised
  it. It is what stops you losing track of which window is which.

- **Resume** — appears once the terminal has been closed, by you or by k0 after a long silence: it
  reopens the same conversation exactly where it was. The story's prompt is **not** put back in —
  that conversation answered it hours ago, and typing it in again would be at best something stale
  in the way.

- **Done** — closes the work **and its terminal**, with no questions: undo it with **Reopen**, and
  pick the conversation up again with **Resume**. On a story that has never been started there is
  no terminal to close, and the button is there anyway as long as there is a backlog behind the
  board — a story planned here and then worked on in a terminal you opened yourself has to be
  closable, and `Done` is the only thing in k0 that closes one. With the backlog switched off it
  is not drawn on those stories at all.

  The session is stopped first and only then is the window closed. Closing a window with `claude`
  still inside it makes macOS put up the "terminate running processes" dialog, and the window does
  not close at all.

- **Close** — a link at the end of the row, quieter than the buttons because it is the one you
  reach for least: it closes the terminal and **not the work**. The session is stopped, its window
  goes, and the machine gets the memory back; the story stays exactly where it is, with the colour
  it had — the one asking you something stays red, the one holding a plan up stays amber, the one
  at your turn stays yellow — and **Resume** takes it from there. It is what a dozen windows open
  and a computer running out of air are answered with.

  It is **not there while the session is working**: stopping one mid-thought is not memory saved,
  it is work lost. Wait for it to come back to you, and then close it.

The only thing that asks for confirmation is throwing a story away.

Stories reorder themselves inside a column: first the ones waiting for you, then the ones grinding
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
the story is still exactly where you left it. And **nothing folds while you are looking at it**: within one visit the set of columns can only grow, and the board tidies itself
on the next reload, so a column never disappears out from under your hands.

**The last two columns on the right are `Old` and `Others`**, and they are the same list twice
over: a `+`, a name and the git mark, in alphabetical order. `Old` is the repositories that have
work on the board, just not lately; `Others` is the ones that have no column because they have no
stories at all. **Click a row in `Old` and the column comes back** at full width for the rest of the
visit — with everything that was in it, which is why the row itself says nothing about how much
that is or how long it has been there. Both columns are also there for the same two things:
getting into the files of a directory you are not working on, and giving birth to the first story
there with the `+`.

Next to a column's `+` there is one more button, which **puts that column away now** instead of
waiting for it to go quiet on its own — for when you are finished with a repository for the day
and would rather not look at it. On a column with something going on in it the button goes faint
and refuses, and says why if you hover it — it does not disappear, because a column runs and goes
back to your turn every few seconds and it would spend the session blinking.
Unlike the automatic fold, this one is remembered across reloads, until you fetch the column back
or something in it wakes up. It **closes nothing**: no session is stopped and no terminal is
shut. It is the board that gets smaller, not the work — what closes a session is `Close` or `Done`
on a story.

### The git mark

On every story, next to the repository name, and next to every column name, one symbol says
whether the work is safe: a **dot** with how many files, if there is work that is nowhere yet; an
**up arrow** with how many commits, if it is committed but not pushed; a faded **tick**, if
everything is saved. Hover to read it in full — branch, files, commits, and how many of those
commits belong to that session. **Click it and the files open.**

A story running in an **isolated worktree** has a working tree of its own, so the mark is really
its own. A story working in the base repository shares the working tree with everybody — there the
dot belongs to the repository, and the only thing that belongs to the session is the commits made
since it started, which k0 counts by remembering where `HEAD` was at that moment.

k0 **never runs `git fetch`**. It only looks at what your git already knows about the remotes. For
"did I push this?" that is exact and instant, because pushing updates the remote reference by
itself; a push made by somebody else does not show until you fetch. On a repository with no
remote, pushing is not mentioned at all.

### The globe: is the site up

Last on a column's heading, after the git mark, a small **globe** says whether that repository's
dev server is running. **Grey** is off, **green** is up, and it **breathes** while it is coming
up. **Red** means it was started and did not come up — hover it for the reason and the log.

**One click switches it on or off. Two restart it.** And when it is green the repository's
**name is underlined with a green dashed line** and becomes a link: click it and the site opens
in another tab, on the port it is really listening on. The line is the same green as the globe
and stays for as long as the server does, so a repository that is up is one you can tell apart
at a glance, from across the board, without going near it. Hover the globe to read the rest — the port, the command it was
started with, and where its log is.

A repository gets a globe when its `package.json` has a **`dev`** script, or failing that a
**`serve`** one. Nothing to configure and nothing to fill in. `start` is deliberately not on that
list: by convention it runs what has been *built*, which is not what this is for.

Three things are worth knowing, because they are the point.

**The server outlives the session.** k0 starts it detached and owned by nobody. Close the session
that asked for it, close every session, restart k0 itself — the server stays up and the globe
stays green. This is the whole reason it exists: a dev server started inside a session belongs to
that session, and dies with it.

**k0 never asks the server whether it is up.** Nothing here opens a socket — the one request k0
makes goes to npm, and it is about versions, not about you. "Up" means the process is alive *and*
the operating system says it is holding a TCP port
open. That is stronger evidence than a reply would be, and it is where the port in the tooltip
comes from — k0 never guesses a port, it reads the one your server actually chose.

**A server you started yourself is recognised.** Start one by hand in a terminal and the globe
goes green on its own within a few seconds, with the right port, and switches it off if you ask
it to. A globe that only knew about its own servers would sit grey next to a site that is plainly
running, which is worse than no globe at all. On Windows this one part is missing — nothing there
can read another process's working directory — and k0 says so rather than showing those servers
as off.

---

## The backlog

A post-it used to be a name and a prompt. That is enough to start a session and nothing like
enough to remember why you started it: three weeks later the title says `Fix-Invoicing`, and the
half hour that decided what *fixed* meant has scrolled off the top of a terminal you have since
closed.

The backlog is the rest of it. Same board, same notes, same gestures — what is added is what the
work is *about*: what it belongs to, what was settled while you were talking about it, what has
to be true before it can be called finished, and a check that holds the finished thing up against
all of that before you are allowed to tick it off.

**The board is the menu; the commands are the engine.** Every story says what the one next thing
to do with it is — *Discuss*, *Plan*, *Work* — and pressing that opens a terminal with
the command already in it. The work happens there, in Claude Code, and you do not come back to the
board until it is finished. Almost nothing here is typed into a form.

If you want the argument rather than the manual — why a decision has to be an object, what a
round of questions is for, what the counter-check is really checking — it is in
[docs/method.md](docs/method.md), and it is a shorter read than this section.

### Before anything else: the commands have to be on your machine

Everything below runs on ten commands you type at Claude Code, and Claude Code looks for a
command in exactly two places: **the repository you have open**, and **your own
`~/.claude/skills/`**. Neither of those is where npm puts k0. So a command that was not copied out
is a command that does not exist, however carefully it was written — and every button on the board
that offers to run one leads nowhere.

Copying them out is **one question, asked by the installer**, right after it starts the service:

```
  /k0-epic    — an epic, discussed in rounds, then a tree of stories
  /k0-story   — one story, straight onto the board
  …
  Install 11 commands for Claude Code? (Y/n)
```

Say yes and they are there in every repository you ever open. It is worth saying plainly what
happens if you do not, because it is what happened to this feature the first time round: the
commands were written and they worked — inside a clone of k0, and nowhere else on the machine.
From any other repository the board offered *Discuss*, the terminal opened, and Claude Code had
never heard of `/k0-discuss`. The whole backlog was invisible for want of one copy step.

**If you are not sure you said yes, run `npx k0-board@latest` again.** It asks only about the ones
that are missing, so somebody who already has them is not asked at all, and somebody who said no
in a hurry gets the question back. `ls ~/.claude/skills` answers it too.

If you **cloned this repository** rather than installing the package, they are already in its
`.claude/skills/` and there is nothing to do — but only while you are working *in this clone*.
Copy them out anyway if you use them anywhere else.

### A day with it

**You open the board.** Every story that has something to do carries **one button, first in the
row, saying what that is**: **Discuss**, **Plan**, **Work** — in that order, because that is the
order the work goes in — or **Resume**, when a terminal was opened on it and then closed. Hover it
and it says why this and not something else: *It has been discussed and has no plan yet*. There is
one button and never a menu, and there are three words on the list and no more.

There is also a story that carries **no** button, and that is an answer too. A session that is
running needs nothing suggested about it — the terminal is where the work is, and a double click on
the note goes there. A story waiting for you to look it over is waiting for a person. A story that
is finished is finished. Filling any of those in with a command would be k0 inventing work.

k0 works that out and the page never does. It is the same reasoning `/k0-next` does, in the same
place, so the button on the note and the answer the command gives can never drift apart.

**You press it.** A terminal opens in that repository and `/k0-plan K42` — the line you would have
typed yourself — goes in with it, already sent: k0 wrote that line out of a button you pressed, so
there is nothing on it for you to read over first, and a prompt left sitting unsent under the
cursor is a window that did nothing.

**Or you take the short way in.** **Quick Start** is the other road out of a story and it is not
the same road: it opens a terminal on that repository with *nothing* in it and leaves the typing to
you. That is the whole of it — no discussion, no plan, no command. It sits at the end of the row as
a quiet link on a story that has a suggestion, and it is the plain button on one that has not.

Only `/k0-work` counts as the work having begun. Press *Discuss* or *Plan* and the story stays
where it was until the discussion or the plan moves it itself — otherwise walking away from a
discussion half way through would leave a story sitting in `Working` with nothing worked on.

**You work in the terminal, and only in the terminal.** The discussion asks its rounds and writes
each one down as it is answered; the plan comes back for your approval with the standing decisions
written into it as constraints; `/k0-work` opens a worktree, does the work, keeps the log, and
merges it back; `/k0-verify` walks the result past every decision one at a time. None of that
needs the board. You can leave the tab open and watch the rounds land — it follows a live
discussion once a second — but nothing asks you to.

**You come back, and the button has moved on.** A story you discussed now says *Plan*. One you
planned says *Work*. One whose terminal you closed says *Resume*, and picks the conversation up
where it was rather than starting a second one beside it.

**Double click the note to go where the work is.** Its terminal if one is running; the conversation
it left behind if the terminal was closed; a fresh session if there was never one. It is the same
gesture on every note, which is what makes it worth having — and if the window has been closed by
hand while the session is still thinking, k0 goes and looks for it by name before it tells you
anything, and offers to open it again when there is really nothing left to find.

**Done is yours and nothing else's.** No command sets it and no gesture sets it: when the work is
really finished you press **Done** on the note, and it closes the terminal with it. A story that
came through its counter-check clean is offered no command at all — there is nothing left for one
to do, and the only thing in front of it is you pressing Done. `/k0-verify` and `/k0-split` are
still there and still do what they always did: they are commands you type, on the days you want
them, rather than advice the board pushes at you.

**Things arrive during the day, and they do not interrupt this.** Something you already know you
want is `/k0-story` in whatever terminal you have open — you say it, it lands on the board with a
key of its own, and adding *and start it* opens the session in the same breath. Something big
enough that you do not yet know what it is made of is `/k0-epic`: ten minutes of questions in
rounds, everything settled written down as it is settled, and only at the end a tree of stories
proposed for your approval — it creates none of them until you have said yes. Both are on the
board's `+` as well, which is a small menu now: **Story** opens the dialog you know, with one
field added for its epic; **Epic** asks which repository and then opens a terminal running
`/k0-epic`, because an epic is told, not typed.

### The two views

The switch in the top bar, in among the filters, says **Kanban** or **List**. It changes the shape
of what you are looking at and never what you are looking at: the state pills, the repository and
the epic lane apply to both, so switching back and forth is free and nothing appears or vanishes
under you.

**Kanban is for working.** It is the board you already know — one column per repository, notes
that reorder themselves by who is waiting for you. With a backlog behind it a note grows four
marks and no more: its **key**; the **epic** it belongs to, as a small label in the epic's own
colour, worked out from the key so there is nothing to choose and nothing to keep in step; a
**flag** in the bottom corner; and a warning when something it **waits on** is not finished.

The flag is put on and taken off **from the note itself** — it is the mark and the target both,
and it mirrors the pencil at the other corner. It is invisible until the pointer is on the note,
because an outline sitting on every note all the time is a mark that is everywhere and therefore
marks nothing. Once it is on it stays on, and the note takes a border and its key and title take
the flag's colour with it: the point of flagging something is finding it again from across the
room, and a fifteen-pixel glyph cannot be seen from there.

**Click an epic's label and the board becomes that epic.** A strip appears under the top bar with
its key, its title, its repository, a progress bar and `4 of 11 done`, and the way back out. Inside
the lane the label is not drawn on the notes — everything in here belongs to the same epic, and
saying so eleven times says nothing. The lane survives a reload: going into an epic is a decision
about where you are working, and a page that forgets it every time you press F5 is a page you stop
going into. The progress is counted over the epic's stories, not over the notes a filter left on
screen, and it is not weighted: eleven stories with one done is 1 of 11, however big the one was.
Anything else is an estimate, and an estimate here is a lie with a progress bar drawn round it.

**List is for planning.** The same stories as rows, three levels deep and every repository at
once: a thin heading per repository, an epic that opens and closes with its progress bar — and,
while a discussion is running on it, which round that is on — and under it its stories, with tasks
indented beneath the story they were cut from. Stories belonging to no epic are grouped at the
end. A row carries key, title, state, flag, how many decisions are still standing, how much of
the checklist has passed, and the same next-step button. Which epics you left open is remembered.

**Click a row and the story opens beside it**, not underneath: the counter-check first, then why
it exists, the rounds with their questions and answers, the decisions with the verdict each one
got, the plan, the checklist and the log — with a line under the title saying both what it waits
for and what is waiting for it, each key a way into that story. Beside rather than below, because
the point of a list is to run down it, and a panel that pushes the rows off the bottom of the page
loses the thing you were comparing against. Click an epic and the epic opens the same way — the
rounds it was argued out in, and the decisions every story under it is held to. That is the only
place that conversation can be watched, because it happens before a single story of it exists.

Two things in this view write rather than read, and they are the two you do while *looking* at a
backlog rather than while working on one: **the next step, started from the end of a row**, and **a
checklist line you have just watched work with your own eyes** — ticked in the panel, and recorded
as yours rather than the model's, which is the difference the checklist exists to keep.

**Dragging a row moves it.** Up and down to change the order, onto another epic's heading to move
it there, onto `No epic` to take it out of one. That is the whole of it: **dragging never changes
state.** A state is a road the work walks, and walking it by dropping a piece of paper somewhere
was always the wrong gesture — states move from the terminal, and from the Done button.

### The ten commands

Ten you type, and the installer offers eleven — these ten plus
[`/k0-import`](#filling-the-board-with-what-you-have-already-done). `/k0-whatsnew` and
`/k0-changelog` are deliberately not on that list: k0 runs those two itself, out of its own
directory, and you never type them.

| | |
|---|---|
| `/k0-story` | one story, straight onto the board — the fast door |
| `/k0-epic` | the long way in: rounds, decisions, then a tree of stories you approve |
| `/k0-discuss` | the same rounds against a story that already exists |
| `/k0-split` | a story that will not close, cut into tasks that inherit its decisions |
| `/k0-plan` | plan mode, with the standing decisions written into the plan as constraints |
| `/k0-work` | the worktree, the work, the log as it goes, and the merge back |
| `/k0-ultracode` | a whole epic, or one story, run by a manager with agents under it |
| `/k0-verify` | the counter-check |
| `/k0-next` | what to pick up now, and why |
| `/k0-order` | priority and dependencies, dictated: *K51 to the top, K42 waits on K37, flag K19* |

These ten are also the only ten a button on the board may start. They are written out by name in
the server and checked against that list before anything reaches a command line — and it is a list
and not a directory listing on purpose: a folder arriving in your skills directory, from a clone or
a package or an installer, must not thereby become something a web page can ask k0 to run.

`/k0-next` is worth one sentence of its own, because the answer is not the model's. k0 works out
what to pick up — a live session first, then something in `Review` and the one that has been
sitting there longest, then what is not waiting on unfinished work, then the flag, then how far
along it is, then the order you put the board in — and hands over the story with the sentence that
says why. Ask twice and you get the same answer, which is not true of anything a model reasons out
each time.

**Dependencies are a note, not a lock.** Nothing refuses to start a story that is waiting on
another one: the note is marked, the button that starts the work asks you once and then goes
ahead, and the story sinks down `/k0-next`. A backlog that will not let you work on what you want
is a backlog you stop using.

### An epic, a story, a task

**A story is one post-it**, and it is the thing you work on. Everything the board already does it
still does: a story opens a terminal, drives the session in it, and says what that session is
doing.

**An epic is a reason** with several stories under it — an area, a feature, a rewrite. It lives in
exactly one repository, because a piece of work that spans two of them is two pieces of work with
a wish in the middle.

**A task is a story that was cut out of another one.** It is not a different kind of thing: same
table, same rules, same key — a story that turned out too big to close gets split, not turned into
another species. A task takes its parent's epic unless you give it one of its own, because a task
planned outside the epic its parent sits in would be planned blind to every decision that shaped
the whole thing.

### The key, and where it sits

Every epic, story and task gets a **key**: `K` plus a number, `K42`. It is counted per repository,
shared between epics and stories, and it is **never reused and never reassigned** — not when the
story moves under another epic, not when you delete it, not when the repository is renamed. Two
repositories can both have a `K42`, and that is intended: a key means something inside its
repository and nowhere else. Move a story to another repository and it is given a key from *that*
repository, rather than carrying a number into a place that already has one.

Beside it there is a **position**: `1.12.1`. The first epic, its twelfth story, that story's first
task. The position is worked out fresh every time it is shown and never stored, so it cannot
disagree with the tree it describes — move a story and its position moves with it.

The key is the name you say out loud; the position is where the thing is sitting today. When you
say `K42` to a command it knows what you mean, whatever the board has been rearranged into since.

### Why a story is not a session

This is the one change underneath everything else, and it is worth a paragraph.

A card used to *be* a session: one note, one conversation, and ticking the note off ended both. So
a piece of work you came back to twice was two notes, and the first one was a note about a
conversation nobody could remember.

Now a story keeps **every session it has had**, one at a time, over as long as it takes. And it
carries two different clocks, which used to be one column fighting itself:

- **the story's state** — `Backlog` · `Discussed` · `Planned` · `Working` · `Review` · `Done` —
  which is where the *work* is;
- **the session's status** — working, planning, holding a plan up, asking you something, your turn
  — which is what a *terminal* is doing this second.

No transition is required. Any state may follow any other, and `Backlog` straight to `Done` is a
legal thing to do that nothing will warn you about — a backlog that argues with you about the road
is a backlog you route around. `Working` sets itself when a session goes live. `Review` is where
`/k0-verify` puts a story when it starts checking it. **`Done` is only ever yours**: nothing in k0
sets it, and the Done button on the note is still what confirms it.

The post-it itself still draws one word and one colour, exactly as before — the two clocks put
back together. Nothing about the board you know got louder.

### Rounds, and why they say how many are left

A round is one small group of questions — four at the most — with your answers written down before
the next one is asked.

Each round opens by saying where it is: **"Round 3 of about 8"**. The number comes from counting
the things where a different answer would produce different work, and it is recalculated after
every answer, because answers both close questions and open them. When it moves, it says so in the
same breath — *round 4 of about 6, two of the questions answered themselves* — and never drifts in
silence. A count that quietly becomes twelve after promising eight is a count you stop believing,
and once you stop believing it you start answering to get it over with.

It stops when no remaining question would change the work, which is stricter than it sounds and is
the only test being applied: a question worth asking is one whose two answers lead to two different
builds. There is a hard ceiling of **fifteen rounds**. At fifteen it stops wherever it is, shows
you the list of what it never got to in your own words, and says the story is recorded as it stands
and can be picked up whenever you like. A discussion that reaches fifteen is telling you the story
is really two, and it says that as well.

**Every round is written to k0 before the next question is asked.** Not at the end, not on a save.
A terminal that dies at round three does not take the first three with it, and neither does a
session that runs out of context in the middle — which is the one that actually happens, and the one
nobody thinks about until the second time.

### Decisions

What comes out of the rounds is not a summary. It is a row of **decisions**, one complete sentence
each, numbered — `D1`, `D2` — and written in your language, about behaviour rather than about
implementation. A decision that names a function is one you cannot check without opening the code,
and six months from now you will not open the code.

A decision is **never rewritten**. When you change your mind, the new decision *supersedes* the old
one and both stay, the old one crossed through and pointing at what replaced it. This is the whole
reason they are objects and not paragraphs: the point is to hold the work up against what was
actually said at the time, and prose you can edit afterwards proves nothing.

An epic's decisions belong to the epic, and every story under it **inherits** them rather than being
handed a copy. They are shown with the epic's key in front — `K7·D3` — so it is obvious a rule came
down from above and applies to everything in the lane. Inheriting rather than copying is what makes
changing your mind work: supersede `K7·D3` on the epic and it is superseded for all eleven stories
at once, where eleven copies would have forked the first time one of them was touched.

An epic is discussed and decided before a single story of it exists, which is why its decisions
have to be able to live on the epic. That is not a detail: it is the main way anybody uses this.

And when something you say now contradicts something you settled earlier, the discussion **stops
there and asks** — naming the decision it clashes with, saying which of the two it thinks should
stand, and why. Writing both down and carrying on is how you end up with two rules that disagree
and no way of knowing which one the work followed.

### The counter-check

Here is what this is for.

You explain a piece of work to a model, properly, for half an hour. It asks good questions — some
of the answers surprise you, because you did not know what you wanted until it asked. It says it
has understood, and it has: the summary it gives back is better than the one you would have
written. Then it builds something that quietly contradicts half of it. Not all of it, and not
obviously. One thing you settled at minute twenty is simply not there, and something you ruled out
is there instead. You notice three days later, and by then you cannot even prove you said it.

That half hour did not merely fail to help. It cost you the half hour and it bought a false
confidence that the thing was understood, which is worse than knowing it was not, because you
stopped watching.

`/k0-verify` is the thing that was missing. When the work is done it takes the decisions **one at a
time** — the story's own and the ones it inherited — and records a verdict for each: **kept**,
**violated**, or **not applicable**, with the evidence. A file and a line, or a sentence saying why
the decision does not apply here. Never a summary standing in for the row, because a summary is
where the one that was broken goes to hide.

Three rules make it worth something rather than a ceremony:

- **A run is the whole set or it is not a run.** One that answers nine decisions of ten is refused
  and told which one it passed over. `na` is a verdict; silence is not. A check that reports a
  clean sweep of whatever it happened to look at is worse than no check.
- **A run never overwrites the one before it.** Runs are numbered and they all stay, so you can see
  that something was broken, then fixed, rather than only that it is fine now.
- **A story cannot be marked `Done` while a decision a run found broken has not been answered
  since.** It is read decision by decision and not run by run: a later run that finds the same
  decision kept closes it, and a later run that says nothing about it, or says it does not apply,
  leaves it exactly where it was. This is the only refusal in the whole feature, and it applies to
  whatever is asking: the Done button on the note, the one at the end of a row in the list, a
  command. It comes back as a sentence saying which decision, from which run, and what to do about
  it.

There are exactly two ways to answer it, and both are honest: **put the work right and run the
counter-check again**, or **supersede the decision** if it turns out the decision was the thing that
was wrong. What you cannot do is talk past it: a story with a broken decision is drawn on the board
so that it cannot be scrolled past, and pressing Done on it comes back with the sentence rather than
the story closed.

There is also a **checklist** on the story — what has to be true for it to be finished. `/k0-verify`
does itself everything a machine can do, runs the project's tests, drives the browser when the thing
is a web application, and leaves you only the lines that genuinely need a person.

### `/k0-work` and the worktree

`/k0-work` gives the session a working copy of its own: a git worktree under
`<repo>/.claude/worktrees/`, on a branch named after the story, opened **from the branch you are
standing on** — not from `main`, not from `origin`. You keep working in the repository, the session
works next door, and at the end its branch comes back in as one merge commit and the copy is
destroyed. The folder is kept out of git's way through `.git/info/exclude`, never by writing in
your `.gitignore`.

Everything the board starts opens in the story's **own repository**, never in a worktree. `/k0-work`
makes one when it needs one, and it is the only command here that does: the others talk about the
story rather than change it, and a discussion held inside somebody else's working copy is a
discussion about a copy.

It will not open one over uncommitted work, and it says how much there is. And three things it
never does, each of which has already cost somebody a day:

- **It never pushes and never opens a pull request.** The merge stops on this machine. Publishing
  is a decision you make when you are ready to make it.
- **It never resolves a conflict.** There is no way for a program to tell a conflict it resolved
  correctly from one it resolved plausibly, and taking a side to make the command succeed throws
  away something somebody typed. A conflict stops everything and says which files.
- **It never runs tests, a build or a dev server in there.** A worktree copies the code but not the
  untracked files around it, so the `.env` somebody copies across carries the *base* repository's
  port — and a test runner that finds a server already listening on it uses that one, goes green,
  and tells you the new code passes when what it tested was the old checkout. Tests run on the base
  branch, after the merge.

That last rule has one honest edge. Merging commits whatever the session left pending, a commit
runs your repository's own hooks, and a `pre-commit` hook that runs the whole suite is normal. k0
does not step round it with `--no-verify` — a commit that only went through because k0 avoided your
hooks has not been checked at all — so the hook does run, next door, with the wrong `.env` beside
it. k0 says so when it happens rather than being quiet about it.

### `/k0-ultracode`: the same work, with a manager over it

On a note that is ready to be worked on, next to **Work**, there is a quieter word: **Ultracode**.
It is the same act at a larger size. One session becomes a **manager**: it cuts the story's plan
into **assignments**, gives each one to an **agent** working in a copy of the repository of its own,
brings the work back one piece at a time, and only then — on your branch, where the code on the disk
is the code that was merged — runs the tests, has the result read by an agent that wrote none of it,
and walks the story past every decision. It is offered on an epic too, from the epic's panel, and
that is what it is really for: story after story, each one finished before the next one starts.

Before it does anything it asks you two questions and never asks again. **How much rope** —
*interactive*, where every question an agent brings back reaches you while it is warm; *checkpoint*,
which stops at the cut, before the merge and on a red test run; or *autonomous*, which goes to the
end and comes back with the list of everything it decided on your behalf. And **how hard** — two,
three or five agents at a time, one repair attempt or two, one pair of fresh eyes or three. Both
answers go into the Log, so a terminal you closed halfway through is picked up again on the same
terms rather than on new ones.

What it does not do is the point of the shape. It never pushes. It never runs anything inside a
worktree, for the reason above. It never presses **Done** — the stories come back sitting in
`Review`, counter-checked, waiting for you. And it stops: the repair attempts are spent and then it
tells you what is still broken, having merged everything that works. A run that never ends is not
thoroughness, it is a run nobody can plan around.

### The `.k0/` folder

Each repository with a backlog grows a `.k0/` folder: a `README.md` explaining itself, one file per
epic under `epics/`, one per story or task under `stories/`. A story file opens with its header —
key, epic, state, flag, what it waits on, the sessions it has lived through — and then
**Why**, the **Prompt**, the **Discussion** round by round, the **Decisions**, the **Plan**, the
**Verification** run by run with its checklist, and the **Log**. An epic's file is the same header,
its own **Why**, **Discussion** and **Decisions**, and then the list of its stories with a line
saying how far it has got.

The database is the source of truth and these are printed from it — whole, every time the story
changes, never diffed cleverly — so a file cannot end up claiming something the board does not. But
they are files, so they diff, they review, and they go in the commit with the work they describe.
Write in them if you like: anything you put under a heading k0 does not print is left exactly where
you put it, and so is a line you add to the header at the top and a note you leave under the title.

**Commit the folder.** It is the only copy of this that outlives the database, and it is the way
back: open a repository k0 has no stories for and it reads the folder in and rebuilds them, keys
and all. That is the reason the files exist at all — the rest is a pleasant side effect.

The folder is written **only** inside `.k0/` — never your `.gitignore`, never a line anywhere else
in your repository — and a test walks the tree afterwards to prove nothing else appeared. The one
other thing that ever writes into a repository is `/k0-work`, which you have to ask for: it is
written out in full under [What it reads, and what it never
does](#what-it-reads-and-what-it-never-does).

One thing to expect: the git mark on that column will go from a tick to a dot the day the folder
first appears. That is honest — there is something there that is not committed yet — and committing
it puts the mark back.

### Switching it off

The whole feature is one line in `~/.k0/config.json`, the same file the idle timeout lives in:

```json
{ "backlog": false }
```

and the board is exactly the board it has always been: nothing extra on a note, no next-step
button, no Kanban/List switch in the bar, no lanes, **no `.k0/` folder created in any repository**,
and the commands say plainly that the backlog is switched off rather than reporting an empty one.
Telling somebody their backlog is empty when it is really turned off is the one answer worse than
no answer. The `+` goes back to being a plain `+` that opens the story dialog, with no menu behind
it and no epic on the form.

It is in that file and not in k0's database on purpose: a switch you would need `sqlite3` to reach
is not a switch. k0 re-reads the file whenever it changes, so nothing has to be restarted, and
deleting the line puts the default back. `"updateCheck": false` is its neighbour — [the one that
stops the npm question](#what-installing-it-changes).

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
saved, a story moved — before k0 will tell you what is still outstanding in it. And only **your**
commits are counted: k0 asks git which email you commit with in that repository and shows that
person's day, so a repository shared with other people still tells you about yours.

Below every block the facts are folded away, one line to open them: the commits themselves, each
marked green if it is online and amber if it is still only here. That is what to open when you do
not believe the paragraph above it.

### Who writes it

k0 does not. **Nothing about your work leaves this machine**, and that is worth more than a better
paragraph: a model of its own would mean a key to keep, an account to configure, and your commit
messages going out over a wire. The one request k0 makes is to the npm registry, asking after its
own version; it carries no commits, no repository names and no identifier.

It does not need one. If you are running k0 you already have Claude Code installed, signed in and
paid for — that is the whole point of the board — so the model is already here. k0 works out the
facts, hands them to Claude Code, and shows what comes back. No terminal opens, nothing appears
on the board, and there is nothing to set up: the skill that does the writing ships inside the
package, the same way `/k0-import` does.

It is written **in your language**, without a setting anywhere, because it is written out of your
own commit messages and story titles.

Nothing is saved. Every time you open the page it is written again, and changing the window
writes it again — which is why there is no stale summary to clear and no history to prune.
"Today" changes while you are reading it, so keeping a copy would be wrong more often than it
helped. If Claude Code is not on the machine the page still opens: you get the facts, and a line
saying why the rest is missing.

---

## What's New

k0 updates by having its files replaced under it. You restart, everything looks the same, and
whatever changed is in a file called `CHANGELOG.md` that nobody opens. So the version you are
running drifts away from the one you learned, and the new thing sits there unused because you
never found out it was there.

A small **mark appears next to `k0`** in the top bar for exactly two reasons: k0 moved on while you
were not looking, or npm says there is a version newer than the one installed here. Hover it and it
says which. **It never opens the page by itself** — it sits next to the name and waits, and it goes
out when you have read the page, not when you close the tab.

The page says which two versions it stands between — *you had k0 0.3.1, you are running 0.4.0 now,
two versions later* — and then says what that means in prose, written by your own Claude out of the
changelog entries in between. Two controls, and both of them change who it is being written for
rather than what is in it: **the language**, and **how technical** — `Plain`, `Normal` or `Nerd`.
Both are remembered, because coming back to find the page in a language you do not read is the
whole page wasted.

Underneath, folded open from the first moment, are the changelog entries themselves, exactly as
they were written. While the prose is being written they are what there is to read; afterwards they
are what you check it against.

It is the same machinery as the ChangeLog, and it has the same shape: nothing is stored, no model
of k0's own, no key and no account — the Claude Code you already pay for does the writing, on this
machine. Nothing is downloaded either. k0 cannot update itself; the most it can do is say a newer
version exists, and leave `npx k0-board@latest` to you.

---

## The files of a session

The git mark is also the door: clicking it opens a file viewer **in another tab**, and the board
stays where it is. Where there is no mark — a repository without git, or git that has not answered
yet — a **lens** takes its place, so every story and every column still leads in.

Files on the left, what they say on the right, and a divider in between that you can drag.

**Documents are what is listed** — markdown, html, text, PDF, Word: things you read and print. In
a real repository code is 95% of the files, and among two thousand `.tsx` files the document you
were after cannot be found. This closes nothing off: a code file reached by a link inside a
document still opens, and so do images — and the configuration is one switch away, below.

A **generated directory** — `out/`, `dist/`, `build/` — is walked into like any other, and the
documents in it are listed like any others: the PDFs, and the pages you open with a double click.
A document is a document wherever it was made, and it has to be findable by name. What stays out
is the configuration a build leaves lying there, and the directories that hold nothing anybody
reads — `node_modules` and its like — which are not walked into at all.

There is **one exception, and only one**: where git is in charge, git decides. k0 reads a
directory your `.gitignore` names only to go and fetch the finished documents from it — the PDFs,
the Word files — never the pages, because a real site's ignored `dist/` is four thousand pages and
not one of them is the file you went looking for. Where git names the directory itself, everything
in it comes through, pages included.

At the top come the **folders**, then the files, in three groups:

- **Changed** — what this session has touched: files still hanging in the working tree plus the
  ones inside commits made since it started.
- **Recent** — the thirty most recently modified. It is the only group you can have where there is
  no git.
- **All files** — everything else, in path order.

### Searching

The search at the top looks in two places and keeps them apart:

- **Names** — not the exact word, but the letters you type in the order you type them, **inside
  the file's own name**: `audrep` finds `docs/audit-report.md`. It filters as you type, asking the
  server nothing. The directory is never searched — it used to be, and `.env` would turn up a
  `v1.0-ROADMAP.md` that merely had those four letters scattered across its folder, three of them
  in a name nobody was reading. The letters that matched are **underlined**, so every row says why
  it is there: `aud`it-`rep`ort reads as the two words you meant.
- **In the text** — inside the documents, with the line the word appears on and the word
  highlighted in yellow. Because what you remember about a file is what was in it, not what it was
  called. Accents do not need typing — `cafe` finds `café`.

The two marks are different on purpose: a line under the letters means they are in the file's
name, yellow means the word was found inside the file.

There is no index. The documents are read every time: a few hundred files of a few KB, all
already in the operating system's cache. An index would cost more and go stale.

`/` puts the cursor in the search, arrows scroll, Enter opens, Esc clears.

### Going into a folder

Click a folder and the listing narrows to it: the folders inside it first, then its files. At the
top the path is written out one piece at a time, and **every piece is a way back up** — from
`docs/backlog/handover` you get to `docs` in one click, and to the whole repository by clicking
the repository's name. The path above an open document works the same way, so from a file you can
step into the folder it lives in.

The arrows walk folders like anything else and Enter goes in; Esc comes back out. A folder is a
real link, so ⌘/Ctrl-click opens it in another tab, and the address follows you: reload it and
you are still where you were.

Next to it is a button that hands the folder to your **file manager** — the Finder on a Mac,
Explorer on Windows, whatever your desktop uses on Linux. Every file has the same button in the
row above it, and there it points the file out inside its folder rather than opening it. On a
system where k0 has no way to do that, the button stays where it is, greyed out, with the reason
in its tooltip.

### The `config` switch, beside the search

The viewer lists documents. The one thing that was missing from that is **configuration**: an
`.env` you want to check a key in, the `package.json`, a workflow's YAML. They are not documents,
and in a repository of prose they would be noise — so they live behind a switch, the **`config`**
button to the right of the search box.

Switch it on and `.env` (and `.env.local`, and the rest of them), `.json`, `.yml`, `.yaml`,
`.toml` and `.ini` join the listing, the name search and the search inside the text. **Including
the ones git is told to ignore** — an `.env` is ignored by definition, and it is the file you came
for. Code does not join: `.js`, `.py`, `.css` stay out either way.

The switch is remembered, per browser. It is not a search, it is a way of working.

And if you forget it is off, the search says so: when a hidden configuration file would have come
**above** everything on screen — searching `.env` in a repository that has one — a line appears at
the top of the results saying how many, and clicking it turns the switch on. Only then: a hidden
file that merely matches somewhere does not raise it, or the line would be there on every search
and you would stop seeing it.

Each of them opens as the kind of thing it is:

- a **JSON** file becomes a tree that folds, coloured by type, with the first two levels open;
- an **.env** becomes a table of names and values, comments and all;
- **YAML, TOML and INI** keep their shape, with keys, values and comments told apart by colour.

A JSON tree has its **own search box**, and that is not a duplicate of the browser's: the
browser's find does not look inside a branch that is closed, so on a folded tree ⌘F says "not
found" for something three lines away. This one counts what it found and opens the branches
holding it.

### Editing a file

Configuration and notes can be changed from here: `.env` and the rest of the configuration above,
plus `.md` and `.txt`. Click the **pencil** in the row above the document and the file becomes a
text box as tall as the pane — not a small window over it, because a README does not fit in one.
**Save** (or ⌘/Ctrl+S) writes it; **Cancel** goes back to what is on disk.

Nothing else is editable: no code, no PDFs, no images, and no creating or deleting files. That is
what you opened the repository with Claude for.

If the file **changed on disk** while you were editing — a session wrote it, or you did, in
another window — the save stops and says so, and what you typed stays where it is. k0 will not
quietly write over somebody else's work.

### Pasting a chunk of chat

There is a way to reach files that does not go through searching for them. When a session ends,
the summary in the chat says what it touched and **names the files already**. Click the **lens** at
the top, paste that piece of conversation, press **Find the files**, and the list on the left
narrows to the files that text names.

It looks **only for the names written down**, not for the subject: no index and no waiting — the
file listing is already in the browser. The price is stated: a file the chat talks about without
ever naming does not come out, and for that there is the search above.

One question does go out, and only one: when the text writes a name **in full** and the listing has
no such file, the disk is asked about those names and no others. That is how a document under an
ignored directory comes out of a paste — the listing never saw it, but a text naming a file names
it whole.

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

Files the listing does **not** show open too. Where git rules, a directory your `.gitignore` names
gives the listing only its finished documents — so a page under an ignored `dist/` is not in it.
Named inside a document it still counts: the document said so, not the directory. Hidden
directories really do stay out: `.claude/` is configuration, not something to read.

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

On every story there is **what that session weighs**. Not the `claude` process: everything it has
dragged along — the MCP servers, the Chromes they open, a `tsc` started from a commit hook. That
is where the memory goes, and it is the thing no other tool can attribute to the right story.

Only one story is red, the heaviest, and only while the machine is struggling: if they were all
red they would say nothing.

Two things said plainly. The CPU is the CPU of **right now**, worked out from the difference in
CPU time between two readings — `ps`'s own `%cpu` would be the average since the process was born,
which on an old session says nothing about this minute. And summing the memory of a process tree
counts shared memory twice, so the total is a little generous: it is the usual approximation, and
it is the right one for the question that matters — which one do I close to feel better.

And once you have decided, **`Close` on that story is how you give the memory back**: the session
is stopped and its window goes, the work stays on the board as it was, and `Resume` picks the
conversation up where it left off. Nothing has to be declared finished to stop weighing.

Reading the process table costs little on a calm machine and a lot on a struggling one, which is
exactly when you look at it. So it is sampled every three seconds, and **only while the board is
open**.

### And what k0 costs

The chip measured everybody but itself, which is the one thing a program running under launchd for
weeks should be least able to hide. Hover it and the last line is **k0's own weight, its CPU, how
often it asks git anything, how many queries it is holding, and how hard the watching loop is
currently running**.

That loop is the whole of k0's cost, and it now runs at the pace the work deserves. With a session
open — or with you in front of the board — it goes round every two seconds. With neither, there is
nothing it could see change, so it drops to **once a minute** and k0 stops costing anything on a
machine nobody is using. Pressing anything wakes it at once, so nothing ever waits on it.

The git marks follow the same rule. Every repository on the board used to be asked `status` and
`rev-list` every five seconds, all night; now the full list is only asked while you are looking,
away from the board only the repositories a session is actually working in, and a reading is good
for half a minute. Nothing in a repository changes faster than that unless you make it.

### And the ones you forget, k0 closes for you

The paragraph above assumes you noticed. Most of the time nobody does: the window that is costing
you a gigabyte is the one you stopped thinking about yesterday. So **after twelve hours with
nothing happening, k0 does that `Close` itself** — the session is stopped, its window goes, and the
memory comes back.

Nothing is lost by it. The story stays exactly where it is with the status it had, and **Resume**
picks the conversation up where it was. That is the whole reason this is safe: a closed terminal
has never been a lost session.

**Only yellow is ever touched** — *Your turn*, the ball in your court and nothing happening. The
rest is left alone, and each for its own reason:

- **Working** and **Planning** are somebody mid-thought. Stopping one is not memory saved, it is
  work lost — the same rule the `Close` link has always followed.
- **Needs answer** and **Needs approval** would lose the very thing they were showing you. A
  question and a finished plan are drawn by the terminal and are not written to the transcript
  until they are answered, so closing that window throws the question away.
- A session sitting in a **shell** is left alone as well. That is a shell you dropped into, and
  there may be a command of yours running in it; k0 cannot see what it is, so k0 does not touch it.
  On the board it reads as yellow like any other, which is exactly why this one has to be said.

And a window you were using an hour ago is never closed, whatever the story's history says. k0 has
four clocks for a session — two of its own and two Claude Code keeps — and **the newest one wins**.
Being wrong in that direction leaves a window open until tomorrow; being wrong the other way closes
a terminal you were about to go back to.

A story k0 tidied away says so: where one you closed yourself reads *session closed*, this one reads
*closed automatically*. Same italic, same place, one word different.

And the memory chip at the end of the top bar says it is watching, and from when: **RAM 79% · CPU
19% · closes at 8h**, in lighter type than the numbers beside it. That is the whole announcement,
and it is on that chip rather than anywhere else because that is where the memory is already being
talked about — something that closes your windows for you should never be a surprise. Hover for
the sentence. Switched off, the chip says nothing at all rather than *0h*, which would read as
"closes immediately", and the hover is what tells you it is off.

Twelve hours is what it does if you never say otherwise. `closeIdleTerminalsAfterHours` in the
settings file changes it, and **`0` switches it off** — see below.

---

## Filling the board with what you have already done

An empty board is no help in getting your bearings. The installer offers to do this on the first
run; afterwards, `/k0-import` from a Claude Code session picks up the sessions that already
happened — including the ones opened by hand, outside k0 — and puts them on the board as stories:
the last 14 days, at most the 10 most recent per repository. `/k0-import 30 5` changes the two
numbers.

The difference between the two is the writing. The installer uses the name the session already
had, or the first few words of the first prompt. `/k0-import` has Claude read the conversation and
write a title and a description in the language it was held in. That description is the line in
italics under the title on the note, and importing is the only thing that writes one: a story you
write yourself has a title and a prompt, which is all it needs.

Imported stories are born yellow — *Your turn*: **Resume** reopens the conversation where it was,
**Done** clears it away. Being dead sessions they do not light the tray icon. Running it again
skips the ones already imported.

Automated runs stay out — `claude -p`, subagents, skills launched from a script. The tell is the
`{"type":"mode",…}` line, which only Claude Code's interface writes when it really starts. On one
real machine that separated 145 genuine sessions from 867 automated ones, and it is read from
64 KB at the head and 64 KB at the tail rather than the whole file.

---

## The statuses

A story **is** the colour of its status — there is nothing else to read. On the left is the code
k0 speaks internally — the API, the menu bar icon and the colours in `web/base.css` all say these
seven words — then how it reads on screen. None of the seven is a column in the database: `BACKLOG`
and `COMPLETED` are worked out from the story (no session, and closed), and the other five belong
to the live session, not to the story. See [`docs/database.md`](docs/database.md) for where each
half really lives.

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

| Icon | Mode | The machine | The screen | The text and the windows |
|---|---|---|---|---|
| two **z** | **Sleep** | sleeps as it normally would | goes off | normal |
| a **palm tree** | **Away** | does not sleep, not even with the lid closed | may sleep and lock | normal |
| a **nerd face** with glasses | **Nerd** | does not sleep | **stays on** | normal |
| a **car** | **Driving** | does not sleep | **stays on** | **large**: the text here and in the terminals, and the terminals fill the screen |

The four icons do not describe the machine: they describe **where you are**. Asleep, away, at the
desk, watching from across the room. That is where the order comes from, and it is why the second
one is a palm tree and not a technical symbol: the mode does not say "the machine is on", it says
"I am not here, but it keeps going".

The four buttons are at the end of the board's bar, or four ticked entries in the tray menu. They
are the same control: changed on one side, the other catches up within a couple of seconds.

**Nerd** and **Driving** do exactly the same things to the machine: the only difference is how big
everything is — the text, and the terminal windows it sits in. Nerd is "I am sitting here
programming", Driving is "I glance at it from across the room".

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

### Large text, and windows to match

In Driving the **text inside the terminals** goes from the profile's size to 22, the board's from
17 to 22 pixels, and the **things you click** grow too — the `+`, the git lens, the corner pencil
(which also stays visible instead of appearing only on hover), the zoom controls. They are in
pixels, so they would not grow with the rest.

The one thing that changes and is not a measurement is the **order of the columns**: in Driving
they reorder by urgency, reddest to the left. On a screen you glance at, two or three columns are
visible at a time and the most urgent one has to come to you. Full screen you have them all in
front of you already, and a board that reshuffles itself while you work only loses your place.

**The windows grow with the text.** In Driving a terminal takes the whole free screen; leave
Driving and it goes back to the usual 86% centred, with the text back at the profile's size. It is
one gesture and not two, and it lands on the terminals **already open**, not only on the ones you
open next.

It used to be the opposite, and the reason is worth keeping in mind: Terminal.app holds rows and
columns when the font changes and resizes the window to match — going from 12 to 22 turns a 700×500
window into 1378×856, measured — so k0 read each window's own bounds first and put them back, and
nothing moved. What that left behind was a window holding 22 point text in a box measured for 12.
Half a gesture is worse than none, so the size of the text and the size of the window now travel
together, and the price is said plainly: **a window you had dragged onto another screen comes back
to the middle of the main one.**

**All of them, every time.** k0 asks Terminal once for the windows it has open and changes those
that are its own, rather than asking after every window id it has ever written down. On a board
with two hundred stories almost every one of those ids names a window closed weeks ago, and asking
after them one at a time took seven seconds — long enough to be cut short halfway, which left half
the terminals large, half of them small, and nothing said about it anywhere. Walking the windows
that exist takes about a second and does not grow with the board.

k0 touches **only its own windows**, the ones born from a story.

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

- the story's prompt replaces whatever was on your clipboard (if the paste fails, the clipboard is
  put back);
- to paste, the terminal is brought to the front for an instant: if you happen to be **dictating**
  at that moment, the dictation lands in there and sticks to the prompt.

---

## Settings

There is no settings page on the board, and there is not going to be one. The board is for what
changes during a working day; a number you set once and then never look at again is the opposite of
that, and putting it on screen would cost the one page that has to stay readable in exchange for
nothing.

So the settings are a file, and **the file is the list**:

```
~/.k0/config.json                        macOS and Linux
%LOCALAPPDATA%\k0\config.json            Windows
```

k0 writes it on the first run with **every setting already in it at its default**, so opening it is
how you find out what there is to change. It sits beside the board rather than inside the app —
`npx` unpacks into a cache npm is free to wipe, and `k0-board install` overwrites the app
directory, so a setting kept in there would not survive an update. Change it and k0 picks it up by
itself on the next round: nothing to restart.

| | |
|---|---|
| `closeIdleTerminalsAfterHours` | How long a yellow story's terminal may sit there before k0 closes it and gives the memory back. `12` if you say nothing. **`0` switches it off.** Anything under an hour is treated as an hour — below that this stops being a tidy-up and starts closing windows while you are using them. |

Delete a line to go back to its default; a file k0 cannot read is ignored altogether and the
defaults hold, rather than k0 refusing to start over a stray comma.

**`k0-board doctor` prints the same list**, with the value actually in force and where the file is,
for the times you would rather ask than go and look.

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
  shared/        what more than one of them needs: tmux, running commands, reading a process
                 table, and reading who is holding which port
server/
  index.js       the http server, the API, and the watching loop — every two seconds while a
                 session is running or somebody is at the board, once a minute when neither, and
                 awake at once on anything you press
  guard.js       who is allowed to talk to this server at all: the Host and the Origin
  db.js          SQLite (node:sqlite): the only file that talks to it. epic, story, session,
                 decision, round, check_item, dependency, session_event and the rest —
                 docs/database.md
  backlog.js     the model: epics, stories, tasks, decisions, dependencies, the order, and
                 what to pick up next. Pure logic over db.js — no http, no disk
  mirror.js      writes and re-reads <repo>/.k0/, the readable copy of the backlog. It writes
                 nowhere else, ever, and a test proves it. No domain logic
  worktree.js    a session working copy of its own: open it from the branch you are on, merge
                 it back, destroy it. Never a push, never a pull request, never a conflict
                 resolved for you, and it never runs tests or a build in there
  update.js      the one request k0 makes — what npm says the newest version is — and the
                 version jump that puts the mark next to k0 in the top bar
  paths.js       where the board, the logs, the settings and the cache live
  settings.js    the few things you can change, and the file that is the list of them —
                 ~/.k0/config.json, written out with everything in it and re-read when it changes
  idle.js        which terminals have sat still long enough to be closed and given back. Only the
                 deciding: it kills nothing, so every rule in it can be proved without a machine
  watcher.js     reads Claude Code's own files and derives the statuses; also renames a session
  git.js         the only one that talks to git: what is committed, what is pushed, whose it is,
                 and — for the ChangeLog — what the commits actually said
  changelog.js   gathers what happened in a window, out of git and out of session_event. Decides
                 which repositories are worth mentioning at all, and stores nothing
  writer.js      hands those facts to the Claude Code already on this machine and gets the words
                 back. The only place k0 starts a model, and it never leaves the machine to do
                 it. Keyed by skill and by window, so the ChangeLog and the What is New page can
                 be writing at the same time without cancelling each other
  launcher.js    starts and resumes sessions, through the platform's terminal
  servers.js     the dev server of a repository: what starts it, whether it is up, and on what
                 port. The only thing k0 starts that is meant to outlive k0
  mode.js        the four modes: how awake to keep the machine, and whether text and windows go
                 large. How large is `launcher.js`, which is what talks to the terminal
  projects.js    the repositories, in the order you last used them — and which directories k0 is
                 allowed to open at all, which is one answer and not one per endpoint
  sessions.js    digs already-lived sessions out of the transcripts, to import as stories
  files.js       the only one that reads the projects' disk — and the only one that writes back
                 into it: what is there, what changed, what it says, and the one small write
  machine.js     the only one that looks at processes and memory: what it all costs, and who is
                 costing it — k0's own process included, which is the only honest way to publish
                 a number like that
  pdf.js         the document on paper, printed by a headless browser
web/             the four pages (html, css, js served exactly as they are)
  index.html     the board — board.js, board.css, view.js. A note is never taller than it is
                 wide: the title, the age and the buttons always show, the text in the middle is
                 what gets clipped
  list.js        the same stories as rows, list.css beside it: the other shape of the same page,
                 not a page of its own. Handed the stories the board is already showing, so the
                 filters cannot mean two things, and the story you open follows a live discussion
                 by asking .../live once a second, the cadence the rest of k0 already uses
  files.html     the file viewer — files.js, files.css
  changelog.html what you have been doing — changelog.js, changelog.css. Read top to bottom
                 instead of looked at, so it is one of the three pages that scroll
  whatsnew.html  what changed in k0 between the version you had and this one — whatsnew.js,
                 whatsnew.css. Reached from the mark next to k0, and never opened by itself
  base.css       colours, fonts and scale: the house variables, shared by all of them
  awake.js       the one place that repeats anything: a job that runs only while its tab is in
                 front of you, and takes a fresh reading the moment you come back to it. A page
                 nobody can see must not be asking the server anything — asking is also how the
                 server learns somebody is watching
  md.js          markdown laid out, written by hand because nothing here is compiled
  recency.js     which repositories are still warm, and which fold away into `Old`
  fuzzy.js       searching the names: the letters you type, in the order you type them — the
                 file viewer, the repository the new story goes in, and the repository menu on
                 the bar, which is drawn here rather than left to the system
  mentions.js    which of a repository's files a piece of text names
  refs.js        what a name written inside a document points at, and which of the nine READMEs
  json.js        a JSON file as a tree that folds, and the search that opens the right branches
  conf.js        an .env as the table it always was, and YAML/TOML/INI with their parts told apart
.claude/skills/
  k0-import/     the skill that fills the board with sessions you have already had
  k0-epic/       the long way in: rounds of questions, decisions, then a tree of stories
  k0-story/      one story, fast path, no ceremony
  k0-discuss/    an existing story, discussed in rounds until nothing more would change it
  k0-split/      a story too big to close, split into tasks that inherit its decisions
  k0-plan/       plan mode, with the standing decisions injected as constraints
  k0-work/       the worktree, the work, the Log as it goes, and the merge back
  k0-ultracode/  the manager: a plan cut into assignments, an agent and a worktree each, and every
                 story tested and counter-checked before the next one starts
  k0-verify/     the counter-check: every decision one by one, the checklist, the outcome
  k0-next/       what to pick up now, and why — the server decides, not the model
  k0-order/      priority and dependencies, dictated
  k0-whatsnew/   the What is New page, written from the changelog entries k0 hands it
  k0-changelog/  the one that turns the facts of a stretch of work into something readable. k0
                 calls it by itself when the ChangeLog is opened, so it is in the package too
  changelog/     the one that writes the changelog and the documentation when work is finished.
                 For whoever works on k0, not for whoever uses it: it is not in the package
  commit-push-deploy/
                 the road out: the documents, the tests, the commit, the push, and the tag that
                 publishes. Also for whoever works on k0, and also not in the package
docs/
  database.md    the shape of the database as it is now, table by table, column by column
  method.md      why a decision has to be an object, what a round of questions is for, and
                 what the counter-check is actually checking
  testing.md     how the tests are written, run and measured, and what is left untested on purpose
test/            npm test — Node's own runner, no framework. See docs/testing.md
  harness.mjs    check(label, got, want), and the sections the labels are grouped under
```

### What it reads, and what it never does

k0 reads your repositories. It writes into one in three places, and all three are named here
because a tool that writes where you did not expect it is a tool you stop leaving running.

The first is the pencil in the file viewer, on a configuration file or a note that is already
there. That write is deliberately narrow — no code, no new files, no deletions — it carries the
file's own permissions across, it lands as a rename so an interrupted save leaves the old file
whole, and it refuses outright if the file has changed on disk since the page read it.

The second is the `.k0/` folder, and only ever inside it: the readable copy of that repository's
backlog, rewritten whenever a story changes. Never your `.gitignore`, never a file beside it, and
a test walks the tree afterwards to prove nothing else appeared. With the backlog switched off the
folder is never made at all.

The third only happens when you ask for it, and it is `/k0-work` opening a worktree. That one is
the largest thing k0 does to a repository, so it is worth reading twice: it adds a worktree under
`.claude/worktrees/`, it writes two lines into `.git/info/exclude` so that directory does not show
up as something you forgot to commit, and at the end it commits inside the worktree and merges
that branch into the branch you were standing on. It never pushes, never opens a pull request, and
never resolves a conflict on your behalf — where it cannot merge cleanly it stops and says so.
None of it happens unless you run `/k0-work`.

k0 does not emulate a terminal and installs no hooks. It reads two things Claude Code already
writes for itself:

- `~/.claude/sessions/<pid>.json` — live status (`busy`, `idle`, `waiting` with the reason for the
  wait) and the session id;
- `~/.claude/projects/<project>/<session>.jsonl` — the transcript, read incrementally, which is
  where you can tell whether you are inside a plan.

Sessions are launched with `--session-id` (k0 chooses the id, so the story ↔ session link is
certain), `-n` for the name, `--resume` to pick one up, and `--permission-mode plan` on new ones.
Both kinds start with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` in their environment, set on the command
line the terminal is handed — `env` in front of `claude` on macOS and Linux, `$env:` before it on
Windows.

The ChangeLog and the What's New page run Claude Code a second way: `claude -p` on the skill that
writes them, with the facts on standard input and no terminal at all. Those are the only times k0
starts a model, and they still open no socket of k0's own — the request is Claude Code's, made
with your own account, from your own machine. Both pages can be writing at once without either
cancelling the other. Those runs cannot come back as stories: `sessions.js` drops `claude -p` when it looks for
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
- **On a newer model Claude Code starts with no task tools.** It offers `TaskCreate`, `TaskUpdate`
  and the rest only to a list of older models, or when `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` is in the
  environment, and Opus 5 is not on the list. Nothing says so up front: the model calls
  `TaskCreate`, is told it is disabled for the session, and carries on without. The variable is
  read once, when the process starts, so a session opened before k0 set it gets the tools only by
  being resumed.
- **While a dialog is open, the call that caused it is not yet in the transcript.** A plan to
  approve and a question are told apart by the `waitingFor` field of the session file:
  `permission prompt` is the plan, `input needed` is the question.
- **The transcript directory's name** is the path with **every** non-alphanumeric character
  replaced by `-`, truncated at 200 characters with a hash on the end. That is lossy: `my_project`
  and `my-project` become the same name, so the working directory is always read from inside the
  transcript, never by reversing the directory name.
- **A session's name lives in three places** — the process's own memory, the session file it
  rewrites (`name`, with `nameSource: "user"` when `-n` or `/rename` set it), and the end of the
  transcript, in `custom-title` and `agent-name` lines that Claude Code rewrites every turn.
  **The last one wins.** So renaming a closed session means appending another copy; a live one
  would have the old name written back over it, and the only way into a live one is its own
  `/rename` command — typed at the keyboard. Written into the terminal as one block (Terminal's
  `do script`, a paste) the same line reaches it as a message, and the model answers that it
  cannot rename the session. The session file is how k0 knows the command took.
- **The transcript is not always under the repository's slug.** A session that moves into a
  worktree writes under the worktree's slug from then on, and a story only knows the repository —
  so a rename looks in the work path, then the repository, then walks the projects directory.
- **The session file appears before the interface is ready to receive.** Writing at that moment
  loses the first characters and swallows the Enter. So k0 waits until it can see the input box —
  and where a platform cannot read a terminal's screen, it waits a fixed moment and says so.
- **A service's PATH is not a shell's PATH.** Under launchd it is barely more than
  `/usr/bin:/bin`, and `npm` and `node` usually arrive from a version manager whose PATH only
  exists inside a shell. So a dev server is started through a **login shell** — which is the same
  reason `findClaude` ends up asking one, and it is also what puts the project's own `.nvmrc` in
  force.
- **`npm run dev` is not the server, it is the thing that starts it.** SIGTERM to npm alone leaves
  `vite` holding the port, which is why the old per-repo skills all ended up reaching for
  `pkill -f`. k0 starts the server **detached**, so it leads a process group of its own, and
  stops the *group*. But only when the process it was told about really is that group's leader:
  a server somebody started by hand in a shell without job control can share its group with the
  **shell**, and signalling that would close the user's terminal to stop a dev server. Where the
  leader is somebody else, the processes are signalled one at a time instead.
- **A remembered pid is only a number, and the system hands numbers out again.** A row written
  before a reboot can point at a stranger's process — and that row is what a click on the globe
  would kill. So a remembered server is only believed while the process at that pid is still
  running the command it was started with, and `stop` reads the machine before it signals
  anything rather than trusting what it stored.
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
edit a story and on every status change of a live session. That is what brings the repository you
are working in right now to the top.

The list holds directories with a `.git`, directories you have already worked in even if they are
not repositories, directories with a story, directories with a document inside them — and **empty
ones**.

Empty ones belong because an empty directory under your home is one you just made, and it cannot
be anything other than a project about to start: make it, and on the first refresh it is already
in `Others` with its `+`. Anything starting with a dot does not make it full, or one glance from a
file manager would be enough to make it disappear again.

**A column lives as long as its directory does.** If that directory is gone — deleted, renamed, an
external disk unmounted — the column does not appear, and neither do its stories. **Hiding is not
deleting**: the stories stay in the database, and if the directory comes back so do they.

---

## Security

The server listens on loopback only, and refuses requests that arrive with a `Host` or `Origin`
it does not recognise — which is what stops a web page you happen to have open from talking to it.
HTML files from your repositories are shown in a sandbox with no permissions. There is no account
and no token: anything already running as you on this machine can reach the API, and that is worth
knowing rather than glossing over.

**One request leaves this machine, and it is about k0 rather than about you.** Once a day k0 asks
the public npm registry what the newest version of `k0-board` is, so the board can say there is
one. The package name is in the address and nothing else — nothing about you, your repositories,
your commits or your board — nothing is downloaded, and `"updateCheck": false` in `~/.k0/config.json` switches it off entirely.

The full picture, and how to report a problem privately, is in [SECURITY.md](SECURITY.md).

## What is not here yet

Ticking a line off on the post-it itself: a story's checklist is written by `/k0-verify`, and the
place to work through it is the story's panel in the list. Writing a decision, discussing one and
superseding one are still done by talking to Claude — the board says which of those to do next and
opens the terminal on it, but nothing on the page writes a decision.
In the viewer the listing is documents and configuration: code opens if
you arrive at it from a link, but it is not browsable and the text search does not look at it.
Only configuration and notes can be edited, one file at a time — nothing is diffed, no file is
created or deleted, and you cannot talk to them; for that you open the repository with Claude.
Sessions opened by hand outside k0 are picked up with `/k0-import`, on request: nothing notices
them by itself yet.

## Contributing

Yes please — especially if you are on Linux or Windows, where nobody has tried this yet. See
[CONTRIBUTING.md](CONTRIBUTING.md); the fastest useful thing you can send is the output of
`k0-board doctor`.

## Licence

[MIT](LICENSE) © Alessio Ragni · [alessioragni.com](https://alessioragni.com)
