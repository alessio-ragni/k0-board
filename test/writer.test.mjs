import { check, section, after } from './harness.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ── Handing the facts to Claude Code ─────────────────────────────────────────
// The one piece of k0 that starts a model. It must never be able to reach the real Claude Code
// from a test — that would cost the person running `npm test` money and take a minute — so
// `K0_CLAUDE` points at a script that behaves like it and answers instantly.
//
// What is worth proving here is small and easy to get wrong: that the facts really arrive on
// standard input, that a run which fails says so instead of hanging, and that a window nobody
// asked about does not claim to be working on anything.

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-writer-'))
const script = (name, body) => {
  const file = path.join(DIR, name)
  fs.writeFileSync(file, body)
  fs.chmodSync(file, 0o755)
  return file
}

// A shell script cannot be spawned on Windows, and dressing one up as a `.cmd` proves nothing
// about the code under test. The rest of the file runs on the other two platforms, and the
// coverage floor is measured there.
const POSIX = process.platform !== 'win32'

const GOOD = POSIX ? script('claude-good', '#!/bin/sh\necho "GOT:$(cat)"\n') : null
const BAD = POSIX ? script('claude-bad', '#!/bin/sh\ncat > /dev/null\necho "no session" >&2\nexit 1\n') : null

process.env.K0_CLAUDE = GOOD || path.join(DIR, 'nothing-here')
const writer = await import('../server/writer.js')

/** Waits for a run to finish the way the page does: by asking again. */
const settle = async (key) => {
  for (let i = 0; i < 400; i++) {
    const s = writer.state(key)
    if (!s.running) return s
    await new Promise((r) => setTimeout(r, 25))
  }
  return writer.state(key)
}

// ── Before anything is asked ─────────────────────────────────────────────────
section('Before anything is asked')
{
  const idle = writer.state('a-window-nobody-mentioned')
  check('nothing is running', idle.running, false)
  check('there is nothing to show', idle.text, null)
  check('and nothing has gone wrong', idle.error, null)
}

// ── When Claude Code is there ────────────────────────────────────────────────
section('When Claude Code is there')
if (POSIX) {
  const can = writer.capability()
  check('the write-up can happen', can.can, true)
  check('so there is nothing to explain', can.why, null)

  writer.write('yesterday:1:2', 'THE-FACTS')
  check('it says it is working', writer.state('yesterday:1:2').running, true)

  const done = await settle('yesterday:1:2')
  check('the facts arrived on standard input', done.text, 'GOT:THE-FACTS')
  check('and it is no longer working', done.running, false)
  check('asking again gives the same answer, not another run', (await settle('yesterday:1:2')).text, 'GOT:THE-FACTS')
  check('a window it was never asked about stays empty', writer.state('today:9:9').text, null)
}

// ── When it goes wrong ───────────────────────────────────────────────────────
// A failed run must end, and say something a person can read. Left "running", the page would
// sit there with the bar sliding for ever.
section('When it goes wrong')
if (POSIX) {
  process.env.K0_CLAUDE = BAD
  writer.write('week:3:4', 'THE-FACTS')
  const done = await settle('week:3:4')
  check('it stops', done.running, false)
  check('there is nothing to show', done.text, null)
  check('and it says what happened', done.error, 'no session')
}

// ── When Claude Code is not there ────────────────────────────────────────────
// The page must still be worth opening: the facts are shown and the missing half is explained.
// An adapter never pretends, and neither does this.
section('When Claude Code is not there')
{
  process.env.K0_CLAUDE = path.join(DIR, 'not-a-real-thing')
  const can = writer.capability()
  check('it says it cannot', can.can, false)
  check('in a sentence meant for a person', can.why.includes('Claude Code is not on this machine'), true)

  const state = writer.write('month:5:6', 'THE-FACTS')
  check('asking for it anyway does not hang', state.running, false)
  check('it explains itself instead', state.error, can.why)
}

after(() => {
  writer.stop()
  delete process.env.K0_CLAUDE
  fs.rmSync(DIR, { recursive: true, force: true })
})
