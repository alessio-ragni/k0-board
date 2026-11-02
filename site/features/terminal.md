---
title: The real terminal, one click away
card: Every note is a real Claude Code session in its own terminal window. Double-click the note and that window is in front.
summary: k0 runs each Claude Code session in a real terminal window: double-click its note to bring it back, Shift+Enter for a new line, Cmd+V for text and images.
kicker: double-click, you're there
order: 60
since: 0.1.0
updated: 2026-11-02
related: statuses, files, dictation
---

## Not a copy of a terminal

k0 does not draw a terminal of its own. **Start** on a note opens a new terminal window, runs
`claude` in the right repository under the story's name, and puts the prompt in — you press Enter.
Everything Claude Code does, it does there, as it always has.

The session is born in plan mode, with Claude Code's task list switched on. The window is centred
on the screen you are using at 90% of the free space, leaving a margin to click on whatever is
behind it. Plug a monitor in or out and the windows put themselves back, without jumping in front.

## Why one click matters

With ten sessions open the hard part is not the work, it is *which window is which*. The note tells
you which one needs you; a double click on it brings that terminal to the front, even minimised.

## How to use it

- Press **+** next to a repository, give it a title, **Start**.
- **Double-click** a note to bring its terminal back.
- **Shift+Enter** starts a new line instead of sending.
- **Cmd+V** pastes text and images alike.
- **Close** stops the session and gives the memory back while the story stays; **Resume** reopens
  the same conversation; **Done** closes the work and its terminal.

## Shift+Enter, on a Mac

Terminal.app, up to macOS 26, sends the same byte for Shift+Enter as for Enter, so Claude Code
cannot see the Shift. k0 adds a binding to the Terminal profile that sends **Esc+Enter** — what
Claude Code reads as a new line, the same sequence its own `/terminal-setup` installs elsewhere —
after backing the preferences up. Terminal reads bindings only at startup and rewrites its
preferences on quitting, so the menu bar icon writes it the moment Terminal quits.

- The very first time, quit Terminal completely (⌘Q) and reopen it.
- Backslash and Enter still work.
- It applies to every window with that profile, not only k0's.
- From macOS 27 none of it is needed; on Linux tmux already does it, on Windows Windows Terminal.

## Pasting images

Text is pasted by the terminal, as always. An image cannot go through a terminal, so k0 works on
the clipboard, which asks for no permission: **while Terminal is in front**, an image on the
clipboard is saved to `~/.k0/cache/images/` and its path put in its place. Cmd+V pastes the path
and Claude Code attaches it as `[Image #1]`. Switch to another application and the image is back.

The honest side effect: copy an image, go into Terminal, switch away and paste within a third of a
second, and you may paste the path instead.
