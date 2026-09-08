import { check, section } from './harness.mjs'

// The AppleScript k0 sends Terminal when a mode is clicked. The adapter is not imported for what
// it does — that needs a Mac with windows open — but for the script it writes, which is where the
// bug lived and where it can be caught without a Terminal to drive.
const { windowPass } = await import('../platform/darwin/terminal.js')

const body = (win) => `\n      set font size of tab 1 of ${win} to 22`
const script = (ids) => windowPass('GEOMETRY', body, ids)

// ── One walk over the windows, not one lookup per id ─────────────────────────
section('The pass over the windows')

// This is the whole fix. k0 hands over the window id of every story it has ever opened, and by
// the two hundredth story nearly all of them name a window closed weeks ago. Asking Terminal for
// each one by id cost an error per dead id — 7.4 seconds against a 5 second limit, so the script
// was killed halfway through and half the windows kept the size they had. Walking the windows
// that exist costs the same whether the list is three ids long or three hundred.
const many = Array.from({ length: 300 }, (_, i) => i + 1)
check('the script walks the open windows once', script(many).match(/repeat with win in windows/g).length, 1)
check('and never asks for a window by id', /window id/.test(script(many)), false)
check('so the body is written once, not once per handle', script(many).split('set font size').length - 1, 1)

// The ids are still needed — they are what says which windows are k0's — but as a list to match
// against, which costs nothing when an id matches nothing.
check('every handle is named in the list to match', /set wanted to \{1, 2, 3\}/.test(script([1, 2, 3])), true)

// `use framework "AppKit"` has to be the first thing in an AppleScript, so the geometry cannot be
// pushed down the file by anything: it leads, always.
check('the geometry comes first', script([1]).startsWith('GEOMETRY\n'), true)

// The count comes back from AppleScript rather than being assumed from the length of the list:
// windows that were closed since the board last looked must not be counted as touched.
check('the script hands back what it really touched', /return touched as string$/.test(script([1])), true)
check('counting as it goes', script([1]).includes('set touched to touched + 1'), true)
