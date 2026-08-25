import { test, after } from 'node:test'
import assert from 'node:assert/strict'

// ── The one shape a test in here takes ───────────────────────────────────────
// Every test file in k0 asks the same question over and over: this label, this value, that value.
// It used to be a `check` rebuilt from scratch at the top of all seven files, collecting rows into
// an array that a hand-written loop printed at the end. The loop is gone — Node's own test runner
// does the printing, the counting and the exit code — but the question keeps the shape it had,
// because the labels are what these tests are worth and they read the same either way.
//
// `got` is computed by the caller before `check` is ever entered, exactly as it always was: the
// call is a comparison of two values already in hand, not a piece of work deferred until later.
// That is why teardown written at the bottom of a file still does no harm.

/** The section the checks after it belong to, so a whole band can be run or read on its own. */
let group = ''

/** Names the band that follows. Mirrors the comment banners the files are already divided by. */
export const section = (title) => {
  group = title
}

/** A label, what came out, and what should have come out. */
export const check = (label, got, want) =>
  test(group ? `${group} · ${label}` : label, () => assert.strictEqual(got, want))

// Teardown belongs after the tests have run, not at the end of the file: re-exported here so a
// test file has one place to import from.
export { after }
