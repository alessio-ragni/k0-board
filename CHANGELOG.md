# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

**The board tells you what to do next, and starts it.** Every story carries one button saying the
one thing to do with it — *Discuss*, *Plan*, *Work*, or *Resume* on a terminal that was closed —
and pressing it opens a terminal with the command already sent. Beside it, **Quick Start** opens an
empty one and leaves the typing to you: the long way round and the short way in, and nothing else.
You work there and come back when it is done. That is the whole shape of it: the board is the menu,
the commands are the engine, and you no longer have to know nine commands by heart to find the way
in.

Underneath that, the board learns what the work is *about*. A post-it is now a **story** with a
stable key of its own — `K42`, and it keeps it for life — and stories can sit under an **epic**, be
split into tasks, wait on each other, and carry the **decisions** that were taken while they were
discussed. A `.k0/` folder in each repository keeps a readable copy that survives a lost database,
and a **counter-check** holds the finished work up against every decision, one by one, before
anybody presses Done. None of it changes the board you already know: switch the backlog off and it
is exactly the board it was.

### Added

- **A button on every story saying what to do with it next, which opens the terminal on it.**
  *Discuss* on something nothing has been decided about, *Plan* once it has been discussed, *Work*
  once there is a plan, and *Resume* on a story whose terminal was closed — three words in the
  order the work goes in, and a fourth that is not a command at all. Hover it and it says why this
  and not something else. Pressing it opens a terminal with `/k0-plan K42` already in it and
  already sent, rather than left sitting under the cursor. A story with a session running carries
  no button, because the terminal is where the work is and a double click on the note goes there;
  so does one waiting to be looked over, and one that is done. k0 works out which, and it is the
  same reasoning `/k0-next` does — so the note, the row in the list and the command can never give
  you three different answers. Only `/k0-work` counts as the work having begun: pressing *Discuss*
  leaves the story where it was until the discussion moves it.
- **Quick Start, the short way in.** It opens a terminal on the story with nothing in it and lets
  you type there. It is the plain button on a story with no suggestion and a quiet link beside the
  suggestion on one that has, and it is what the `+` offers next to *Discuss* when you write a new
  story down.
- **Notes on a story, which are yours and go nowhere.** Editing a story gives you a list to jot
  things into; they sit on the post-it where you can read them and are never sent to Claude Code.
  A story being written for the first time is not asked for them: at that moment there is nothing
  to note down yet.
- **The flag is put on from the note, in passing.** It was a checkbox in the pencil dialog, which
  meant opening the dialog, ticking a box and saving for a mark you change your mind about twice a
  day. It is now the glyph at the bottom corner of the post-it: invisible until the pointer is on
  the note, one click on, one click off. A flagged note keeps it lit, takes its border, and its key
  and title take the same colour — so you can tell a flagged one from across the room and not only
  by a hairline.
- **The repository menu is k0's own, with a search in it.** It was the system's dropdown, which on
  macOS opens a panel from another application in the middle of a board made of paper and cannot
  hold a search at all. It is now the same picker the new-story dialog has: type three letters,
  press Enter.
- **Epics, stories and tasks.** One post-it is one story. A story can belong to an epic, and a
  story that turned out too big to close is split into tasks that inherit its context. Every one
  of them gets a key — `K42` — that is never reused and never reassigned. That key is the only
  name a story has: where it sits is the tree itself, which can be read.
- **Decisions you can hold work against.** What was settled while a story was discussed is
  written down one sentence at a time, numbered, and never rewritten — a decision that changes is
  *superseded* by the one that replaced it, and both stay. An epic's decisions are inherited by
  every story under it rather than copied into them, so reversing one reverses it everywhere at
  once.
- **The counter-check.** `/k0-verify` walks the finished work against every decision the story is
  held to and records a verdict for each, with the evidence. It answers all of them or the run
  does not count, and it never writes over the run before it. A story cannot be marked Done while
  a decision the counter-check found broken has not been answered since — k0 names it, says which
  run found it and what to do about it, instead of quietly letting it through.
- **Nine commands you type.** `/k0-epic`, `/k0-story`, `/k0-discuss`, `/k0-split`, `/k0-plan`,
  `/k0-work`, `/k0-verify`, `/k0-next`, `/k0-order`. **The installer offers to copy them into your
  own `~/.claude/skills/` in one question**, together with `/k0-import` — and that question is the
  whole setup, because Claude Code looks for a command in the repository you have open and in your
  own skills folder and nowhere else. A command that was never copied out is a command that does
  not exist, and the buttons on the board that offer to run one lead nowhere. If you are not sure
  you said yes, run `npx k0-board@latest` again: it asks only about the ones that are missing.
  They ask their questions in rounds, say how many rounds are left, stop when nothing more would
  change the work, and write every round down before asking the next one — so a terminal that dies
  at round three does not take the first three with it. Everything you say is stored in the
  language you said it in.
- **A flag, and what waits on what.** A story can be flagged — from the pencil, with the rest of
  what you decide about a story — and it is drawn in the corner of the note with a border round
  the note in the same colour, so a flagged story can be picked out from across the room. A story
  can also be told to wait on another one. Waiting is a note and not a lock: nothing refuses to
  start a story that is waiting, the note is simply marked and it sinks down the running order.
  Opened in the list, a story says both directions: what it is waiting for, and what is waiting for
  it — which is usually the real reason to finish one thing before another.
- **Something that says what to pick up next.** `/k0-next` answers in one sentence, and the
  answer is k0's rather than the model's — a live session first, then whatever has been sitting
  in Review longest, then what is not waiting on unfinished work, then the flag. Ask twice and
  you get the same answer.
- **Two views of the same stories: Kanban and List.** The switch is in among the filters, because
  it is the same kind of question — the state pills, the repository and the epic apply to both, so
  changing shape never changes what is in scope. **Kanban** is the board you know, for working: one
  column per repository, and a note now carrying its key, its epic as a coloured label, its flag
  and what it waits on. **List** is for planning: the same stories as rows, three levels deep and
  every repository at once, with a thin heading per repository and epics that open and close with
  their progress bar and, while a discussion is running, which round it is on. Drag a row to
  reorder it, or onto another epic to move it there — those are the two things the interface could
  never do. Dragging never changes state.
- **The whole of a story, beside the row rather than under it.** Click a row and it opens to the
  side: the counter-check first, then why it exists, the rounds with their questions and answers,
  the decisions with the verdict each one got, the plan, the checklist and the log, and a line
  saying both what it waits for and what is waiting for it. Beside, so the rows you were comparing
  it against do not scroll away. Click an epic and the epic opens the same way — the rounds it was
  argued out in and the decisions every story under it is held to, which is the only place that
  conversation can be watched, because it happens before a single story exists. It follows a
  discussion while the discussion is happening, an epic's as well as a story's.
- **The `+` makes an epic as well as a story.** It is a small menu now: **Story** is the dialog you
  know, with one field added for the epic it belongs to — pick one this repository already has, or
  type a name and it is made on the spot. **Epic** asks which repository and then opens a terminal
  running `/k0-epic`, because an epic is what a discussion leaves behind and naming one before that
  discussion has happened names something nobody has decided the shape of yet.
- **A `.k0/` folder in each repository.** One file per epic and one per story, rewritten whenever
  the story changes: the whole backlog in Markdown, readable in a diff and committable. A story's
  file carries the decisions it inherited from its epic as well as its own, under the names the
  counter-check uses — so a file that says `K7·D3` was broken also says, further up, what `K7·D3`
  was. It is also the way back — k0 can rebuild a lost database from those files. Nothing of the
  backlog is written anywhere else in your repository, and never in your `.gitignore`; the one
  other thing that writes into a repository at all is the worktree below, and you have to ask
  for it.
- **Worktrees, from the board.** `/k0-work` opens a worktree for a session from the branch you
  are standing on, works there, and brings its branch back as a single merge commit before
  removing it. Never a push, never a pull request, and never a conflict resolved on your behalf.
  It also never runs your tests in there, and says why.
- **A What's New page.** After an update, a discreet dot appears next to `k0` in the top bar and
  leads to a page that says what changed between the version you had and the one running now —
  written by your own Claude, in your language, at the level of detail you ask for. It never
  opens by itself, and the dot goes out when you have read it.
- **k0 now makes one network request.** Once a day it asks the public npm registry whether there
  is a newer `k0-board`, so the board can mention it. The package name is in the address and
  nothing else: nothing about you, your repositories or your commits leaves the machine, nothing
  is downloaded, and `"updateCheck": false` stops it opening a socket at all.
- **All of it can be switched off**, from `~/.k0/config.json` — the file the idle timeout already
  lives in, not the database, because a switch you would need `sqlite3` to reach is not a switch.
  `"backlog": false` and the board is the board it always was: nothing extra on a note, no
  next-step button, no Kanban/List switch in the bar, a `+` with no menu behind it, no `.k0/`
  folder created anywhere, and every command says the backlog is turned off rather than reporting
  an empty one — "there is nothing here" and "you turned this off" read the same, and only one of
  them is worth acting on.
  k0 re-reads the file when it changes, so nothing has to be restarted.

### Changed

- **A card is now a story, everywhere.** The word changed on the board, in the commands k0 ships
  and in what k0 stores. Your board comes back exactly as you left it — same post-its, same
  colours, same ages, same order — but what a post-it stands for now has room for what the work
  is about.
- **A story's state and its session's status are two different things.** Backlog · Discussed ·
  Planned · Working · Review · Done is where the *work* is; Working · Planning · Planned · Ask ·
  Idle is what the *session* is doing this second. They used to be one column fighting itself,
  which is why ticking something off used to lose what the terminal was in the middle of.
- **A story keeps every session it has had**, rather than only the last one. Starting a new
  conversation on old work no longer throws away the record of what was tried before.
- The ChangeLog page and its writer say *story* where they said *card*.
- **The top bar is one row again.** Two views, a repository filter and seven state pills had pushed
  it onto a second line: the four mode buttons at the end now stand two by two, and the memory chip
  puts RAM, CPU and the closing time one under the other instead of writing them across.
- **Driving mode resizes the terminals, not just their text.** A terminal you glance at from across
  the room now takes the whole free screen while Driving is lit, and goes back to its usual size and
  its usual text the moment you leave it — one gesture instead of large text left sitting in a small
  window. The price, which used to be the other way round: a window you had dragged onto a second
  screen comes back to the middle of the main one.

- **The age at the bottom of a post-it stopped lying.** Starting a session used to leave the line
  blank and the tooltip reading "Your turn for "; a story that had been started before inherited
  the previous session's age and claimed five days the moment you pressed Start; a job you
  reopened said "4 days" instead of "now"; and a backlog post-it jumped to "now" when something
  moved it between two states that look identical on the board. All four were one line reading
  the wrong entry in the story's history.
- **A board that lost power while it was being brought forward opens again.** The first time this
  version runs, it moves your board to the shape described above. That used to be one long step
  with a single test in front of it: a machine that went down in the middle left a board that
  would never open again, and a second attempt would have given every story a duplicate of every
  session it had lived through. The move is now done in pieces that each stand on their own, and
  k0 writes down that it has been done, so it cannot happen twice.
- **A story moved to another repository is given a key from that repository**, instead of
  carrying its old number into a repository that already has one.
- **A story that had somehow been made its own parent can be thrown away again.** The board will
  not make that shape now, and a board that already had one no longer refuses to delete it.
- **Notes written under the title of a `.k0/` file stay there.** The folder's own README promises
  that whatever you add above the first heading is left alone, and it was not: every rewrite ate
  one more paragraph of it, and the rewrite after that ate the next, until there was nothing left
  and nothing anywhere saying there ever had been. An epic lost them fastest, because an epic has
  no post-it line of its own for k0 to have been aiming at.

### Fixed

- **Sessions opened by k0 have Claude Code's task list again.** On a newer model such as Opus 5,
  Claude Code starts without its task tools unless it is told otherwise, so a session asked to keep
  a task per step was refused every time it tried. Every session k0 starts, new or resumed, now has
  them, and `/k0-plan`, `/k0-work` and `/k0-verify` keep one task per phase, per step and per
  decision. A session that was already open gets them by being resumed.
- **Installing again brings your copies of the commands up to date.** They were copied into
  `~/.claude/skills/` once and never again, so a command fixed in a later version kept running its
  old text. Copies that differ from the ones in the package are now replaced, and the installer
  names them.
- **Double-clicking a post-it does something on every note, not on half of them.** It brought the
  terminal to the front on a story that had one running and did nothing at all on any other, so it
  was a gesture you could not rely on. It now goes where the work is: the terminal if one is
  running, the conversation the closed terminal left behind, and a fresh session on a story that
  never had one.
- **"That window is gone" stopped being said about a session that is still running.** Closing a
  Terminal window by hand leaves `claude` thinking inside it, and k0 went on holding a window id
  that no longer answered — so a double click reported the session lost while it was working. k0
  now looks the window up by the name it put on it, brings that one up and writes the id down; when
  there is really nothing left to find, it says the window was closed and the session is still
  running, and offers to open it again.
- **The buttons on a post-it no longer break a word over two lines.** A label that did not fit the
  268 pixels of a note was wrapped mid-phrase, which read as two buttons and made that note stand a
  row taller than the ones beside it.
- **A note written under a story's title is no longer eaten.** The `.k0/` copy dropped the first
  paragraph above the first heading every time it rewrote a file, taking it for the standfirst k0
  prints itself. An epic prints no standfirst, and neither does a story with an empty description
  — so for those, what was quietly deleted was something a person had written. One paragraph per
  rewrite, in the folder whose own README promises that what you add under the title is left alone.
- **A `.k0/` folder no longer appears in a repository that has no backlog.** The sweep wrote the
  README explaining the folder before asking whether there was anything to put in it, which on a
  machine with eighteen checkouts meant eighteen folders nobody had asked for. It appears with the
  first story now, and not before.
- **git taking too long says so.** A command that ran out of time came back carrying git's own
  command line instead of a sentence, because the timeout was recognised by a code that only the
  synchronous calls set. It is the slowest and most confusing failure there is — a commit hook can
  run for fifteen minutes — and it had the least readable answer.
- **A story moved to another repository is numbered from one, not from three.** It was given its
  key in its new home after it had already arrived there, so it counted itself.
- **Changing mode no longer gives up halfway through, in silence.** k0 asked Terminal after every
  window id it had ever recorded, one at a time; on a board of two hundred stories nearly all of
  them named a window closed weeks ago, and the wait for those answers pushed the whole thing past
  its own time limit. It was cut off mid-way: some terminals changed, the rest kept the size they
  had, and the failure was read as "Terminal is not running" and never mentioned. k0 now asks once
  for the windows that are open, which takes about a second whatever the board has been through —
  and a pass that does fail says so in the log.

## [0.4.0]

The file viewer stops being read-only, and stops being just a pile of documents. It now shows the
folders a repository is built from, and behind a switch it shows the configuration too — an
`.env`, a `package.json`, a workflow's YAML — laid out as the kind of thing each one is, and
editable in place with a Save button. The name search, meanwhile, turns out to have been quietly
wrong the whole time: it matched letters scattered across a whole path rather than the file you
meant, and it now looks only at the name and shows you why a row is there at all.

### Added

- **Folders, at last.** The file viewer's listing starts with the folders, and clicking one takes
  you inside it: the folders it holds first, then its files. The path is written across the top
  one piece at a time and **every piece is a way back up** — from `docs/backlog/handover` you
  reach `docs` in one click, and the whole repository by clicking its name. The path above an open
  document does the same, so from a file you can step out into the folder it lives in. Arrow keys
  walk folders, Enter goes in, Esc comes out, ⌘-click opens one in another tab, and the address
  follows you so a reload puts you back where you were.
- **Open in Finder.** A button on a folder opens that folder in your file manager, and the same
  button in the row above a file points the file out inside its own folder. It works on macOS,
  Windows and Linux; where a system gives k0 no way to do it, the button stays where it is, greyed
  out, with the reason in its tooltip rather than quietly doing nothing.
- **The `config` button beside the search shows the configuration.** The viewer lists
  documents, which is right until the day you want to check a key in an `.env`. Switch it on and
  `.env` (and `.env.local`, and the rest), `.json`, `.yml`, `.yaml`, `.toml` and `.ini` join the
  listing, the name search and the search inside the text — **including the ones git is told to
  ignore**, because an `.env` is ignored by definition and it is the file you came for. Code stays
  out either way. The switch is remembered, per browser.
- **Configuration opens as the kind of thing it is.** A **JSON** file becomes a tree that folds,
  coloured by type, with the first two levels open — and with **its own search box**, because the
  browser's find does not look inside a closed branch: on a folded tree ⌘F says "not found" for
  something three lines away. This one counts what it found and opens the branches holding it. An
  **.env** becomes a table of names and values, comments kept. **YAML, TOML and INI** keep their
  shape, with keys, values and comments told apart by colour.
- **Configuration and notes can be edited here, with a Save button.** The pencil in the row above
  a document turns it into a text box as tall as the pane — not a small window over it, because a
  README does not fit in one. ⌘S saves, Cancel goes back to what is on disk. Only `.env` and the
  other configuration, `.md` and `.txt`: no code, no PDFs, no images, and no creating or deleting
  files. If the file **changed on disk while you were editing it** — a session wrote it, or you
  did, in another window — the save stops and says so, and what you typed stays exactly where it
  is. k0 will not write over somebody else's work without telling you.
- **A search whose best answer is switched off says so.** Looking for `.env` with the switch off
  used to give eighty files that merely contain those four letters somewhere in their path, and no
  hint that the one you wanted was a click away. Now a line appears above the results — *3
  configuration files also match — show them* — and it is the button: clicking it turns the switch
  on. It appears only when a hidden file would have come **above** everything on screen, so it is
  not there on the searches where it would only be noise.
- **The name search looks only inside the file's own name, and underlines what it found.** The
  directory used to be searched too, scattered letters and all, which is how `.env` once turned up
  `v1.0-ROADMAP.md` — three of its four letters came from `.planning/milestones/`, a folder nobody
  was reading, with no way to see that from the row. Now the directory is never searched, and the
  letters that matched are underlined right in the name: `aud`it-`rep`ort reads as the two words
  you meant. Neighbouring letters are underlined as one stretch, not one by one. The mark is a
  line and not the yellow used for the text search, so the two answers stay apart: yellow means
  the word is inside the file, a line means it is in the name.

### Changed

- **On a card, the git mark sits against the right edge** instead of hanging off the end of the
  repository's name, where it landed in a different place on every note. It is now the same shape
  as the heading of a column, so a row of cards has a line you can read down. A long repository
  name is cut with an ellipsis rather than pushing the mark about.
- Nothing a user can see: the coverage floor moves up to 87% of lines and 85% of branches, which
  is where the two new modules leave it.

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
