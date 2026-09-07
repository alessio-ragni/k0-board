import { check, section, after } from './harness.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ── The one part of k0 that reaches outside ──────────────────────────────────
// `server/update.js` is the only file in k0 that opens a socket, so the first thing this test
// does is make sure it cannot: `check({ fetch })` takes the answer from here, and the real
// `fetch` is replaced by one that throws, so a bug that ignored the seam fails loudly instead of
// quietly asking npm from somebody's `npm test`. The same reasoning as `K0_CLAUDE` in
// `test/writer.test.mjs`, and for the same reason: what reaches outside must be provable without
// ever going there.
//
// What is worth proving is that no shape of bad news ever reaches the user — an unreachable
// registry, an answer that is not what was asked for, a registry having a bad day — and that
// asking is rare: once a day, once between two windows, never at all when it is switched off.

process.env.K0_DB = path.join(os.tmpdir(), `k0-update-test-${process.pid}.db`)

const realFetch = globalThis.fetch
globalThis.fetch = () => {
  throw new Error('a test must never reach the real registry')
}

const store = await import('../server/db.js')
const update = await import('../server/update.js')

/** A registry that answers, and counts how often it was asked. */
const npm = (version) => {
  const f = async () => {
    f.calls++
    return { ok: true, json: async () => ({ version }) }
  }
  f.calls = 0
  return f
}

// ── The version jump ─────────────────────────────────────────────────────────
section('The version jump')
{
  const now = update.version()
  check('the running version is the one in package.json', typeof now === 'string' && now.length > 0, true)

  check('a board that has never run before has not jumped', update.jump(), null)
  check('and the version it saw is written down', store.getPref('update.last_seen'), now)

  store.setPref('update.last_seen', '0.0.1')
  const jumped = update.jump()
  check('a different version is a jump', jumped && `${jumped.from} to ${jumped.to}`, `0.0.1 to ${now}`)
  check('and the mark stays until it has been looked at', update.jump() !== null, true)

  update.seen()
  check('having looked at it clears the mark', update.jump(), null)
  check('by agreeing with what is running', store.getPref('update.last_seen'), now)
}

// ── When npm cannot be reached ───────────────────────────────────────────────
// Every failure is the same failure as far as the board is concerned: there is nothing to say.
section('When npm cannot be reached')
{
  store.dropPref('update.latest')
  const dead = async () => {
    throw new Error('getaddrinfo ENOTFOUND registry.npmjs.org')
  }
  check('a machine with no network hears nothing back', await update.check({ force: true, fetch: dead }), null)
  check('and the board has nothing to mention', update.latest(), null)

  store.dropPref('update.latest')
  const timedOut = async () => {
    throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
  }
  check('a registry too slow to answer is the same silence', await update.check({ force: true, fetch: timedOut }), null)
}

// ── When the answer makes no sense ───────────────────────────────────────────
section('When the answer makes no sense')
{
  store.dropPref('update.latest')
  const noVersion = async () => ({ ok: true, json: async () => ({ name: 'k0-board' }) })
  check('an answer with no version in it says nothing', await update.check({ force: true, fetch: noVersion }), null)

  store.dropPref('update.latest')
  const notAVersion = async () => ({ ok: true, json: async () => ({ version: 'the newest one' }) })
  check('nor does a version that is not one', await update.check({ force: true, fetch: notAVersion }), null)

  store.dropPref('update.latest')
  const notJson = async () => ({
    ok: true,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0')
    },
  })
  check('an answer that is not JSON is not a crash', await update.check({ force: true, fetch: notJson }), null)

  store.dropPref('update.latest')
  const badDay = async () => ({ ok: false, status: 503, json: async () => ({}) })
  check('and a registry having a bad day is silent too', await update.check({ force: true, fetch: badDay }), null)
}

// ── At most once a day ───────────────────────────────────────────────────────
section('At most once a day')
{
  store.dropPref('update.latest')
  const registry = npm('99.0.0')

  const answer = await update.check({ force: true, fetch: registry })
  check('npm says what the newest version is', answer.version, '99.0.0')
  check('and it is newer than the one running', answer.newer, true)

  await update.check({ fetch: registry })
  await update.check({ fetch: registry })
  check('asking again the same day does not ask npm again', registry.calls, 1)
  check('the answer is still the one it gave', update.latest().version, '99.0.0')

  const saved = JSON.parse(store.getPref('update.latest'))
  store.setPref('update.latest', JSON.stringify({ ...saved, asked: saved.asked - 25 * 60 * 60 * 1000 }))
  await update.check({ fetch: registry })
  check('a day later it asks once more', registry.calls, 2)
}

// ── Two windows opening at once ──────────────────────────────────────────────
section('Two windows opening at once')
{
  store.dropPref('update.latest')
  const registry = npm('99.0.0')
  const both = await Promise.all([
    update.check({ force: true, fetch: registry }),
    update.check({ force: true, fetch: registry }),
  ])
  check('are one question, not two', registry.calls, 1)
  check('and both get the same answer', both.map((a) => a.version).join(' '), '99.0.0 99.0.0')
}

// ── A failed attempt keeps the last good answer ──────────────────────────────
// Losing what npm said last week because the wifi is off today would be worse than saying nothing.
section('A failed attempt keeps the last good answer')
{
  const dead = async () => {
    throw new Error('getaddrinfo ENOTFOUND registry.npmjs.org')
  }
  await update.check({ force: true, fetch: dead })
  check('what npm said before is still there', update.latest().version, '99.0.0')
}

// ── Switched off ─────────────────────────────────────────────────────────────
// The promise is absolute: off means no socket, not even the one somebody asks for by hand.
section('Switched off')
{
  store.setPref('update.check', '0')
  const registry = npm('99.0.0')
  await update.check({ force: true, fetch: registry })
  check('not even a forced check asks npm', registry.calls, 0)
  check('and the board stops mentioning what it knew', update.latest(), null)

  store.setPref('update.check', '1')
  check('switching it back on remembers the answer', update.latest().version, '99.0.0')
}

// ── Ordering two versions ────────────────────────────────────────────────────
section('Ordering two versions')
check('a bigger minor is newer', update.compareVersions('0.5.0', '0.4.9'), 1)
check('a bigger patch is newer', update.compareVersions('0.4.10', '0.4.9'), 1)
check('the same version is the same version', update.compareVersions('1.2.3', '1.2.3'), 0)
check('a release candidate comes before its release', update.compareVersions('0.5.0-rc.1', '0.5.0'), -1)
check('and something unreadable is never called newer', update.compareVersions('tomorrow', '0.4.0'), 0)

// ── Reading the changelog ────────────────────────────────────────────────────
// The entries are wrapped by hand, the same heading can appear twice under one version, and the
// reference links at the foot belong to nobody. All three have to come out right, because what
// comes out of here is what the model is given to write the What's New page from.
const CHANGELOG = `# Changelog

All notable changes are documented here.

## [Unreleased]

## [0.4.0] - 2026-09-07

The file viewer stops being read-only.

### Added

- **Folders, at last.** The listing starts with the folders, and clicking one
  takes you inside it.
- Open in Finder.

### Changed

- The git mark sits against the right edge.

## [0.3.0]

### Added

- The terminals you have stopped using close themselves.

## [0.2.0]

### Fixed

- A tab left open no longer shows you the old interface.

### Fixed

- A second block of the same name joins the first.

[0.3.0]: https://example.invalid/compare/v0.2.0...v0.3.0
`

section('Reading the changelog')
{
  const versions = (from, to) =>
    update
      .entriesBetween(from, to, CHANGELOG)
      .map((e) => e.version)
      .join(' ')

  check('the range leaves out the version you were on', versions('0.2.0', '0.4.0'), '0.4.0 0.3.0')
  check('and takes in the one you are on now', versions('0.3.0', '0.4.0'), '0.4.0')
  check('no start means everything up to here', versions(null, '0.3.0'), '0.3.0 0.2.0')
  check('no end means everything since', versions('0.2.0', null), '0.4.0 0.3.0')
  check('a version nobody has jumped is an empty range', versions('0.4.0', '0.4.0'), '')
  check('going back a version still shows the stretch between', versions('0.4.0', '0.2.0'), '0.4.0 0.3.0')
  check('and Unreleased belongs to no range', versions(null, null).includes('Unreleased'), false)

  const [release] = update.entriesBetween('0.3.0', '0.4.0', CHANGELOG)
  check('a release keeps its date', release.date, '2026-09-07')
  check('and the sentence it opens with', release.intro, 'The file viewer stops being read-only.')
  // The page and the skill both ask for a heading by name, so the sections are an object keyed by
  // heading — in the order the file has them, which is the order they are shown in.
  check('the sections come out in order', Object.keys(release.sections).join(' '), 'Added Changed')
  check('and are reached by their name', release.sections.Added.length, 2)
  check(
    'with the wrapping undone',
    release.sections.Added[0].endsWith('the folders, and clicking one takes you inside it.'),
    true
  )

  const old = update.parseChangelog(CHANGELOG).find((e) => e.version === '0.2.0')
  check('the same heading twice is one section', Object.keys(old.sections).length, 1)
  check('holding both blocks', Object.values(old.sections)[0].length, 2)
  check(
    'and the links at the foot of the file join nothing',
    Object.values(old.sections)[0][1],
    'A second block of the same name joins the first.'
  )
}

// ── The changelog this repository actually has ───────────────────────────────
// The fixture above proves the parsing; this proves it is pointed at the real file and that the
// real file has the shape the parser expects.
section('The changelog this repository actually has')
{
  const shipped = update.entriesBetween('0.1.0', '0.1.1')
  check('it reads the file k0 ships with', shipped.map((e) => e.version).join(' '), '0.1.1')
  check('and finds what is written under it', Object.keys(shipped[0].sections).length > 0, true)
}

after(() => {
  globalThis.fetch = realFetch
  store.close()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.K0_DB + suffix, { force: true })
})
