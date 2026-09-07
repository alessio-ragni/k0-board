import fs from 'node:fs'
import path from 'node:path'
import { getPref, setPref } from './db.js'
import { ROOT } from './paths.js'
import * as settings from './settings.js'

// ── The one request k0 makes ─────────────────────────────────────────────────
// Everywhere else in k0 the answer to "shall we ask the internet" is no: no fonts fetched, no
// telemetry, no `git fetch`. This file is the single exception, and what it does is written out
// here rather than left in a commit message, because it is a promise a sceptical reader should
// be able to check by reading one screen.
//
// WHAT LEAVES THIS MACHINE. One GET to https://registry.npmjs.org/k0-board/latest, at most once
// a day, asking a public registry what the newest version of a public package is. The package
// name is in the address and nothing else is in the request: not the version you are running,
// not your repositories, not your commits, not your board, not an identifier of any kind. There
// is no query string, no body and no cookie. The `user-agent` is the fixed string `k0-board`
// with no version in it, so two people asking look the same. npm learns that an address asked
// about a package — the same thing it learns when anybody types `npm view k0-board`.
//
// WHAT COMES BACK is one JSON document about that package, of which k0 keeps two things: the
// version string and the time it was told. Nothing is downloaded and nothing is run. k0 cannot
// update itself; the most it can do is say that a newer version exists.
//
// HOW TO SWITCH IT OFF. `"updateCheck": false` in `~/.k0/config.json`, and no socket is opened,
// ever — not on start, not on a restart, not when somebody presses the button on the What's New
// page. `force` skips the day's cache, never the switch, and with the switch off the board also
// stops mentioning whatever the last answer was.
//
// AND IT NEVER GETS IN THE WAY. Every failure is silent: no network, DNS gone, npm down, a 500,
// an answer that is not JSON — the board simply does not mention an update. A version check is
// not worth a red box on somebody's screen, and it is not worth a second of startup either, so
// nothing here is awaited on the way up and nothing here throws where it would take the server
// down with it.

const REGISTRY = 'https://registry.npmjs.org/k0-board/latest'
const TIMEOUT = 5000
const DAY = 24 * 60 * 60 * 1000

// ── Which version is running ─────────────────────────────────────────────────

let running

/**
 * The version in `package.json`, read once. A copy of k0 with no readable `package.json` should
 * not be told it has jumped from nowhere to nowhere, so an unreadable one is `null` and every
 * question below answers "nothing to say" rather than inventing a version.
 */
export function version() {
  if (running !== undefined) return running
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    running = typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    running = null
  }
  return running
}

/**
 * Enough of semver to order two k0 versions, which is all that is ever compared here. A version
 * neither side can read orders as equal: a mark saying "newer version available" that came out
 * of a string nobody could parse would be worse than no mark.
 */
export function compareVersions(a, b) {
  const x = parts(a)
  const y = parts(b)
  if (!x || !y) return 0
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1
  if (x.pre === y.pre) return 0
  // A prerelease comes before the release it leads to: 0.5.0-rc.1 is older than 0.5.0.
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre < y.pre ? -1 : 1
}

const parts = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v ?? '').trim())
  return m ? { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || '' } : null
}

// ── The version jump ─────────────────────────────────────────────────────────
// k0 writes down the version it last ran under `update.last_seen`. When what is running differs
// from what is written down, the board shows a discreet mark leading to the What's New page.

/**
 * What changed under the user, or `null` if nothing did. A board that has never recorded a
 * version has just been installed: that is a first run, not a jump, and the only thing to do is
 * write the version down so the next upgrade is one. The mark stays until `seen()` clears it —
 * closing the tab is not the same as having read it.
 */
export function jump() {
  const to = version()
  if (!to) return null
  const from = getPref('update.last_seen', null)
  if (!from) {
    setPref('update.last_seen', to)
    return null
  }
  return from === to ? null : { from, to }
}

/** The user has seen what changed. Clears the mark by agreeing with what is running. */
export function seen() {
  const to = version()
  if (to) setPref('update.last_seen', to)
  return to
}

// ── What npm says ────────────────────────────────────────────────────────────

/**
 * The switch, in `~/.k0/config.json` next to the others. It is the one setting in k0 that a person
 * has a real reason to look for — it is the only thing here that opens a socket — so it lives in
 * the file they can open and not in the database, where reaching it would mean `sqlite3`.
 */
export function enabled() {
  return settings.read().updateCheck
}

/**
 * The last answer npm gave, or `null` when there is none to give — including when the check is
 * switched off, because switching it off should take the mark off the board too, not merely
 * stop the asking. The row itself is kept, so switching it back on shows what k0 already knew
 * without waiting for another day to pass.
 */
export function latest() {
  if (!enabled()) return null
  const saved = read()
  if (!saved.version) return null
  const now = version()
  return { version: saved.version, at: saved.at, newer: !!now && compareVersions(saved.version, now) > 0 }
}

let asking = null

/**
 * Ask npm, at most once a day. Returns what `latest()` would return, and never rejects.
 *
 * `fetch` is here so a test can answer without a socket — the same seam `K0_CLAUDE` gives
 * `writer.js`, for the same reason: the one part of k0 that reaches outside must be provable
 * without ever actually going there.
 */
export async function check({ force = false, fetch = globalThis.fetch } = {}) {
  try {
    if (!enabled()) return null
    if (!force && Date.now() - read().asked < DAY) return latest()
    // Two windows opening at once are one question, not two.
    if (!asking) {
      asking = ask(fetch).finally(() => {
        asking = null
      })
    }
    return await asking
  } catch {
    return null
  }
}

async function ask(fetch) {
  const saved = read()
  const answer = await request(fetch)
  // The attempt is recorded whether or not it worked, which is what "at most once a day" has to
  // mean: a laptop with no network must not ask again on every poll. A failure leaves the last
  // good answer in place rather than throwing it away — it is still the truest thing k0 knows.
  remember({
    version: answer || saved.version,
    at: answer ? Date.now() : saved.at,
    asked: Date.now(),
  })
  return latest()
}

async function request(fetch) {
  try {
    const res = await fetch(REGISTRY, {
      // We asked npm, so we take an answer from npm and from nowhere else. A redirect somewhere
      // is not an answer to this question.
      redirect: 'error',
      // `AbortSignal.timeout` does not hold the event loop open, so a slow registry cannot keep
      // the server alive after somebody has stopped it.
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { accept: 'application/json', 'user-agent': 'k0-board' },
    })
    if (!res.ok) return null
    const body = await res.json()
    const v = body?.version
    return typeof v === 'string' && parts(v) ? v : null
  } catch {
    return null
  }
}

/** `update.latest` holds one object: what npm said, when it said it, and when k0 last asked. */
function read() {
  try {
    const saved = JSON.parse(getPref('update.latest', '') || '{}')
    return {
      version: typeof saved.version === 'string' ? saved.version : null,
      at: Number(saved.at) || 0,
      asked: Number(saved.asked) || 0,
    }
  } catch {
    // A hand-edited preference is not a reason to stop working: it is a reason to ask again.
    return { version: null, at: 0, asked: 0 }
  }
}

const remember = (entry) => setPref('update.latest', JSON.stringify(entry))

// ── The changelog, as data ───────────────────────────────────────────────────
// What's New hands the model the entries between two versions. It is the model's job to say what
// they mean in the user's own language, and this file's job to hand over exactly the right ones:
// the range is arithmetic and must not be left to a model that would guess it.

const HEADING = /^##\s+\[?([^\]]+?)\]?\s*(?:[-–—]\s*(\d{4}-\d{2}-\d{2}))?\s*$/
const SECTION = /^###\s+(.+?)\s*$/
const LINK = /^\[[^\]]+\]:\s/
const BULLET = /^[-*]\s+(.*)$/

/**
 * `CHANGELOG.md` as `[{ version, date, intro, sections: { Added: [...], Fixed: [...] } }]`,
 * newest first.
 *
 * One line of a section is one changelog entry, not one line of the file: the entries are wrapped
 * by hand at a hundred columns and a model handed the halves separately would summarise the
 * wrapping. `text` is there so a test can parse a changelog of its own.
 *
 * `sections` is an object keyed by the heading and not a list of `{ name, lines }` pairs, because
 * both things that read it — the What's New page and the skill that writes the page — ask for a
 * heading by name. Insertion order is the file's order, which is the order they are shown in.
 */
export function parseChangelog(text = null) {
  const source = typeof text === 'string' ? text : readChangelog()
  const entries = []
  let entry = null
  let section = null
  let open = null // the section whose last entry is still collecting its wrapped lines

  for (const raw of source.split('\n')) {
    const line = raw.trimEnd()

    const head = HEADING.exec(line)
    if (head) {
      entry = { version: head[1].trim(), date: head[2] || null, intro: [], sections: {} }
      entries.push(entry)
      section = null
      open = null
      continue
    }
    if (!entry) continue

    const sub = SECTION.exec(line)
    if (sub) {
      // Keep a Changelog does not forbid the same heading twice under one version, and 0.2.0
      // has `### Changed` twice. The second block joins the first rather than replacing it.
      if (!entry.sections[sub[1]]) entry.sections[sub[1]] = []
      section = entry.sections[sub[1]]
      open = null
      continue
    }

    // The reference links at the foot of the file belong to no version and must not be read as
    // the last one's final entry.
    if (LINK.test(line)) {
      open = null
      continue
    }

    const item = BULLET.exec(line)
    if (item && section) {
      section.push(item[1])
      open = section
      continue
    }

    if (!line.trim()) {
      open = null
      if (!section && entry.intro.length) entry.intro.push('')
      continue
    }

    if (open && /^\s/.test(raw)) {
      open[open.length - 1] += ` ${line.trim()}`
      continue
    }

    // The paragraph a version opens with, before the first heading: it is the one place the
    // changelog says what the release was about rather than what is in it.
    if (!section) entry.intro.push(line.trim())
  }

  for (const e of entries) e.intro = e.intro.join('\n').trim()
  return entries
}

/**
 * The entries that separate two versions: everything after `from`, up to and including `to`.
 * `from` is left out because the user already had it, and `to` is put in because it is what they
 * have now. A missing end is an open one, so `entriesBetween('0.3.0')` is everything since.
 *
 * `[Unreleased]` never comes back: it has no version, so it sits in no range. A pair the wrong
 * way round — somebody who went back a version — is read as the stretch between the two rather
 * than as an empty answer, because the question is still "what is different".
 */
export function entriesBetween(fromVersion = null, toVersion = null, text = null) {
  const entries = parseChangelog(text).filter((e) => parts(e.version))
  let low = parts(fromVersion) ? fromVersion : null
  let high = parts(toVersion) ? toVersion : null
  if (low && high && compareVersions(low, high) > 0) [low, high] = [high, low]
  const after = (e) => !low || compareVersions(e.version, low) > 0
  const upTo = (e) => !high || compareVersions(e.version, high) <= 0
  return entries.filter((e) => after(e) && upTo(e))
}

function readChangelog() {
  try {
    return fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8')
  } catch {
    // The package ships its changelog, but a checkout mid-rename should show an empty What's New
    // rather than fail the request that asked for it.
    return ''
  }
}
