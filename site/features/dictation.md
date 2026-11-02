---
title: Dictation that stays on your Mac
card: Hold Control, speak, let go — the text lands where the cursor is. Offline, in place of Wispr Flow.
summary: Offline dictation on macOS 26 in place of Wispr Flow — hold Control, talk to Claude Code, let go. Nothing you say leaves the Mac.
kicker: hold control, speak
order: 90
since: 0.8.0
updated: 2026-11-02
related: terminal, always-on, statuses
---

## Hold Control, speak, let go

k0 has a dictation of its own, offline, to replace Wispr Flow. Hold Control, say a phrase, let go,
and the text is pasted wherever the cursor is — the terminal of a Claude Code session, a browser, a
note. It needs macOS 26; anywhere else the page says so and the switch stays grey.

## Why it matters

Talking to Claude Code is quicker than typing to it, and most dictation does it by sending your
voice to somebody else's server. This one does not. **Nothing you say leaves the Mac**: the
recording of a phrase is deleted once transcribed, and the last ten texts live in
`~/.k0/dictate/history.json` — never in the board's database, which is synced to k0 Cloud.

Nobody chooses a language either. Whisper hears which one you speak; Apple's engine listens in
Italian and English at once and keeps the surer of the two.

## Try it before you switch

Is an offline engine good enough, and which one? That is answered on your own Mac, with your own
voice. Open `http://k0.localhost:4319/dictate.html` and dictate with Wispr as you always do: at the
same moment k0 Dictate records the same microphone and gives it to both engines. Each phrase shows
the three texts side by side, with how long each took from the instant you let go.

| Engine | What it needs |
|---|---|
| Apple | nothing — macOS fetches its models by itself |
| Whisper | `brew install whisper-cpp`, then a model of about 1.6 GB, once |

macOS asks once for the **Microphone** and for **Accessibility** — the second is what lets k0
Dictate notice Control being held.

## How to use it

- On the trial page, press **Keep Apple** or **Keep Whisper**.
- **Quit Wispr Flow** — with both running, both paste.
- Press **Switch dictation on**. k0 Dictate starts now and at every login.
- Hold **Control** on its own for a phrase. **Control+Space**, or Control tapped twice, is
  hands-free; Control again finishes and pastes.

Control with any other key — Control+C, Control+A — is a shortcut, and nothing happens. **Escape**
drops the phrase.

## The pill

A small pill at the bottom of the screen says where things stand, coloured so it is never taken for
Wispr Flow's: **light blue** while it waits and listens, the bars moving with your voice; **orange**
while the words are worked out; **red** for a second only when a phrase could not be heard or could
not be pasted.

Right-click it for the last ten phrases, **Paste last transcript** for a paste that went nowhere, the
microphone, and **Reset dictation**. The text arrives all at once when you finish, through the
clipboard, and whatever was on the clipboard is put back a moment later.
