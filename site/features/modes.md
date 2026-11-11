---
title: Four modes, from asleep to across the room
card: Sleep, Away, Nerd, Driving: one click says how awake the machine stays while Claude Code works, lid closed included.
summary: Four modes set how awake the machine stays while Claude Code sessions work, even with the lid shut, and Driving makes everything big enough to read from across the room.
kicker: where you are
home: yes
order: 30
since: 0.1.0
updated: 2026-11-02
related: idle-close, always-on, statuses
---

## A scale, not four switches

How awake the machine has to stay while sessions are working. Each step includes the one before
it, and exactly **one** is always lit: you leave a mode by picking another. The icons describe
**where you are** — asleep, away, at the desk, watching from across the room.

| Mode | The machine | The screen | Text and windows |
|---|---|---|---|
| **Sleep** | sleeps as usual | goes off | normal |
| **Away** | does not sleep, lid closed or not | may sleep and lock | normal |
| **Nerd** | does not sleep | stays on | normal |
| **Driving** | does not sleep | stays on | large |

## Sleep

Nothing k0 does keeps the machine up. For when nothing needs to run.

## Away

The palm tree: *I am not here, but it keeps going.* A `caffeinate` left running only stops sleep
from inactivity; closing the lid is a forced sleep that goes straight past it. On macOS the only
thing that stops that one is a system flag that takes root, so the installer writes one line in
`/etc/sudoers.d/k0-pmset` granting that single command. Skip the password and the modes work with
the lid open only, and the lit button wears an **amber ring** to say so.

## Nerd

The machine stays awake and the screen stays on. *I am sitting here programming.*

## Driving

Nerd for the machine; the difference is size. Terminal text goes to 22 points, the board's to 22
pixels, and the things you click grow with it. The columns reorder by urgency, **reddest to the
left**, because on a screen you glance at only two or three are visible. The change lands on the
terminals already open, and a window you had dragged to another screen comes back to the main one.

## How to use it

- Click one of the four buttons at the end of the board's bar, or tick it in the menu bar icon.
- That is all. The mode is remembered and reapplied when k0 starts.

## Why the machine does not stay awake forever

A sleep block is system state: if k0 vanished while it was on, the machine would never sleep
again. So the block dies with the server, is released on exit, is repaired at startup after a bad
crash, and `k0-board uninstall` removes it before the permission. Below **15% on battery** k0 lets
go of the lid: a machine forbidden to sleep does not just drain, it dies outright.

On Linux and Windows the lid belongs to a machine-wide setting k0 does not rewrite; the switch says
it is unavailable and `k0-board doctor` says where to change it.
