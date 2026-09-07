import { check, section, after } from './harness.mjs'
import { mock } from 'node:test'
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
//
// And, since two pages can ask at once, the bookkeeping around that: a key holds one run and one
// run only, three keys may think at a time, the oldest of them steps aside for a fourth, and the
// answers already written are not kept for ever. All of it is a Map that is easy to get subtly
// wrong — an error written under a key that has moved on, an answer overwritten by a run that was
// abandoned — and none of it shows up until somebody has two windows open.

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
const MUTE = POSIX ? script('claude-mute', '#!/bin/sh\ncat > /dev/null\n') : null
const LOUD = POSIX ? script('claude-loud', '#!/bin/sh\ncat > /dev/null\nyes 0123456789 | head -c 3000000\n') : null
// `exec`, so the sleep IS the child rather than a grandchild of it. A SIGTERM sent to the shell
// leaves a grandchild holding the pipe open, and a run that was killed then looks, from out here,
// exactly like a run that is still going — which would make two of the checks below prove nothing.
const SLOW = POSIX ? script('claude-slow', '#!/bin/sh\ncat > /dev/null\nexec sleep 30\n') : null

// Executable to `existsSync`, not executable to `spawn`: this is what a half-installed Claude Code
// looks like from here, and the only way to reach the child's own `error` event.
const UNRUNNABLE = path.join(DIR, 'claude-unrunnable')
fs.writeFileSync(UNRUNNABLE, '#!/bin/sh\necho hi\n')

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

/** Long enough for a child that was killed to be reaped and its `close` to have been handled. */
const breathe = () => new Promise((r) => setTimeout(r, 150))

// `stop` is what the server calls on the way out, and it is also the only way back to an empty
// board of jobs — which the sections about the ceilings need, because they are counting.
const reset = (claude) => {
  writer.stop()
  process.env.K0_CLAUDE = claude
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
  const can = writer.capability('k0-changelog')
  check('the write-up can happen', can.can, true)
  check('so there is nothing to explain', can.why, null)

  writer.run('k0-changelog', 'yesterday:1:2', 'THE-FACTS')
  check('it says it is working', writer.state('yesterday:1:2').running, true)

  const done = await settle('yesterday:1:2')
  check('the facts arrived on standard input', done.text, 'GOT:THE-FACTS')
  check('and it is no longer working', done.running, false)
  check('asking again gives the same answer, not another run', (await settle('yesterday:1:2')).text, 'GOT:THE-FACTS')
  check('a window it was never asked about stays empty', writer.state('today:9:9').text, null)
}

// ── A second window on the same page ─────────────────────────────────────────
// Two windows of the ChangeLog showing the same period are one key, and one key is one model.
// The second window is told about the run already going instead of starting another one — and
// the payload proves it, because the answer that comes back is the one the first window asked
// for, not the second.
section('A second window on the same page')
if (POSIX) {
  writer.run('k0-changelog', 'twice:1:1', 'FIRST-FACTS')
  const again = writer.run('k0-changelog', 'twice:1:1', 'SECOND-FACTS')
  check('it is handed the run already going', again.running, true)

  const done = await settle('twice:1:1')
  check('and gets what that run was writing', done.text, 'GOT:FIRST-FACTS')
}

// ── Two pages at once ────────────────────────────────────────────────────────
// The ChangeLog and What's New can be open at the same time, and one must not cancel the other:
// the runner is keyed, and a key is a window or a language, not "the one job".
section('Two pages at once')
if (POSIX) {
  process.env.K0_CLAUDE = GOOD
  writer.run('k0-changelog', 'today:1:2', 'FACTS-A')
  writer.run('k0-whatsnew', 'whatsnew:it:normal', 'FACTS-B')

  const a = await settle('today:1:2')
  const b = await settle('whatsnew:it:normal')
  check('the ChangeLog got its own answer', a.text, 'GOT:FACTS-A')
  check('and the What is New page got its own', b.text, 'GOT:FACTS-B')

  const missing = writer.capability('k0-not-a-skill')
  check('a skill that is not installed says so', missing.can, false)
  check('and names it', missing.why.includes('k0-not-a-skill'), true)
  check('a name that is not a name is refused', writer.capability('../../etc/passwd').can, false)
  check('and so is no name at all', writer.capability().can, false)
}

// ── Three at a time, and no more ─────────────────────────────────────────────
// A fourth run means three keys have already been walked away from — clicking through Today,
// Yesterday and Week does exactly that — so the oldest of them steps aside rather than the fourth
// being refused. What matters is where the killed run's own ending goes: nowhere. It was dropped
// before it was killed, so its `close` finds nothing under its key and writes no error over a key
// the page has moved on from. And what steps aside is a run, never an answer: a summary already
// written is the oldest thing in the map and it is not the one to throw away.
section('Three at a time, and no more')
if (POSIX) {
  reset(GOOD)
  writer.run('k0-changelog', 'already-written', 'FACTS-0')
  const answered = await settle('already-written')

  process.env.K0_CLAUDE = SLOW
  for (const n of [1, 2, 3]) writer.run('k0-changelog', `busy:${n}`, `FACTS-${n}`)
  const three = [1, 2, 3].map((n) => writer.state(`busy:${n}`).running).join(' ')
  check('three keys think at once', three, 'true true true')

  writer.run('k0-changelog', 'busy:4', 'FACTS-4')
  check('a fourth still gets a model', writer.state('busy:4').running, true)
  check('the oldest gives up its place', writer.state('busy:1').running, false)
  check('the two after it carry on', [2, 3].map((n) => writer.state(`busy:${n}`).running).join(' '), 'true true')
  check('the key it left says nothing went wrong', writer.state('busy:1').error, null)
  check('and the answer written before any of them is still there', writer.state('already-written').text, answered.text)

  await breathe()
  check('and its child dying later writes nothing there either', writer.state('busy:1').error, null)
  check('the fourth is still thinking', writer.state('busy:4').running, true)
}

// ── How many answers are kept ────────────────────────────────────────────────
// A finished job holds a whole page of prose, and a key is a window or a language: a tab left open
// for a week would otherwise keep every summary it ever asked for. Eight is the number.
section('How many answers are kept')
if (POSIX) {
  reset(GOOD)
  for (let n = 1; n <= 9; n++) {
    writer.run('k0-changelog', `kept:${n}`, `FACTS-${n}`)
    await settle(`kept:${n}`)
  }
  check('the ninth answer pushes the first one out', writer.state('kept:1').text, null)
  check('the one after it is now the oldest kept', writer.state('kept:2').text, 'GOT:FACTS-2')
  check('and the newest is where it was left', writer.state('kept:9').text, 'GOT:FACTS-9')
}

// ── How much of one answer is kept ───────────────────────────────────────────
// The other end of the same worry. A summary is a page of prose, but nothing on the far side of
// that pipe promises to stop, and whatever arrives is held in memory until the tab is closed. A
// megabyte is already far more than a summary, and it is where the reading stops.
section('How much of one answer is kept')
if (POSIX) {
  reset(LOUD)
  writer.run('k0-changelog', 'loud:1:1', 'THE-FACTS')
  const done = await settle('loud:1:1')
  check('a model that will not stop talking is cut off', done.text.length < 2 * (1 << 20), true)
  check('and the megabyte it did write is kept', done.text.length >= (1 << 20), true)
}

// ── When it goes wrong ───────────────────────────────────────────────────────
// A failed run must end, and say something a person can read. Left "running", the page would
// sit there with the bar sliding for ever.
section('When it goes wrong')
if (POSIX) {
  reset(BAD)
  writer.run('k0-changelog', 'week:3:4', 'THE-FACTS')
  const done = await settle('week:3:4')
  check('it stops', done.running, false)
  check('there is nothing to show', done.text, null)
  check('and it says what happened', done.error, 'no session')

  // Nothing has to be reloaded for the page to try again: a key holding a failure is free.
  process.env.K0_CLAUDE = GOOD
  writer.run('k0-changelog', 'week:3:4', 'THE-FACTS-AGAIN')
  check('asking again after a failure starts a new run', (await settle('week:3:4')).text, 'GOT:THE-FACTS-AGAIN')

  process.env.K0_CLAUDE = MUTE
  writer.run('k0-changelog', 'quiet:1:1', 'THE-FACTS')
  const mute = await settle('quiet:1:1')
  check('a run that answers nothing at all still ends', mute.running, false)
  check('and admits the summary came back empty', mute.error, 'The summary came back empty.')

  process.env.K0_CLAUDE = UNRUNNABLE
  writer.run('k0-changelog', 'unrunnable:1:1', 'THE-FACTS')
  const dead = await settle('unrunnable:1:1')
  check('a Claude Code that will not start ends too', dead.running, false)
  check('and says it would not start', dead.error.startsWith('Claude Code would not start:'), true)
}

// ── When it takes too long ───────────────────────────────────────────────────
// Three minutes is the whole patience, and a real one cannot be waited out here — so the clock is
// the fake one and the child is real. What is being proved is that the run ends, that it ends
// saying something, and that the child dying afterwards does not write its own ending over that.
section('When it takes too long')
if (POSIX) {
  reset(SLOW)
  mock.timers.enable({ apis: ['setTimeout'] })
  writer.run('k0-changelog', 'slow:1:1', 'THE-FACTS')
  mock.timers.tick(3 * 60 * 1000)
  const gave = writer.state('slow:1:1')
  mock.timers.reset()

  check('it gives up rather than sliding for ever', gave.running, false)
  check('and says so in a sentence', gave.error, 'The summary took too long to write and was given up on.')

  await breathe()
  check('the child dying after it does not overwrite that', writer.state('slow:1:1').error, gave.error)
  check('and leaves nothing to show', writer.state('slow:1:1').text, null)
}

// ── When Claude Code is not there ────────────────────────────────────────────
// The page must still be worth opening: the facts are shown and the missing half is explained.
// An adapter never pretends, and neither does this.
section('When Claude Code is not there')
{
  reset(path.join(DIR, 'not-a-real-thing'))
  const can = writer.capability('k0-changelog')
  check('it says it cannot', can.can, false)
  check('in a sentence meant for a person', can.why.includes('Claude Code is not on this machine'), true)

  const state = writer.run('k0-changelog', 'month:5:6', 'THE-FACTS')
  check('asking for it anyway does not hang', state.running, false)
  check('it explains itself instead', state.error, can.why)
}

// ── When nothing names it ────────────────────────────────────────────────────
// `K0_CLAUDE` is the exception, not the rule: on a normal machine nobody sets it, and Claude Code
// has to be looked for — under the home directory, in the two places Homebrew and the installers
// use, and then along `PATH`. This is the only place that lookup runs, so `HOME` and `PATH` are
// pointed at the temporary directory first and a `claude` is put there for it to find.
//
// It stays a question and never becomes a run. Asking whether the write-up can happen only looks
// at the filesystem, and this section must remain the last thing that leaves `K0_CLAUDE` unset:
// the lookup is remembered once, and on a machine that has a real Claude Code in one of those
// fixed places it is the real one that gets remembered.
section('When nothing names it')
if (POSIX) {
  writer.stop()
  delete process.env.K0_CLAUDE
  const realPath = process.env.PATH
  const realHome = process.env.HOME
  process.env.PATH = DIR
  process.env.HOME = DIR
  fs.copyFileSync(GOOD, path.join(DIR, 'claude'))
  fs.chmodSync(path.join(DIR, 'claude'), 0o755)

  check('Claude Code is found without being named', writer.capability('k0-changelog').can, true)

  process.env.PATH = realPath
  process.env.HOME = realHome
  process.env.K0_CLAUDE = GOOD
}

after(() => {
  writer.stop()
  delete process.env.K0_CLAUDE
  fs.rmSync(DIR, { recursive: true, force: true })
})
