import fs from 'node:fs'
import path from 'node:path'
import * as db from './db.js'
import * as git from './git.js'
import { listProjects, projectName } from './projects.js'

// ── What you have been doing ─────────────────────────────────────────────────
// The board says what is happening now. This says what happened, which is a different
// question and needs a different source: git already keeps that diary, perfectly, and has
// been keeping it since long before k0 existed.
//
// So nothing here is stored. There is no table, no nightly run, no index to keep in step with
// reality — the facts are read from git and from `session_event` when somebody asks for them.
// A cache would be wrong more often than it helped anyway: "today" changes while you are
// reading it, and "this week" contains today.
//
// This module gathers. It writes no prose and calls no model: that is `writer.js`.

const DAY = 24 * 60 * 60 * 1000
const LOOKBACK = 30 * DAY // how far back "the last day you worked" is willing to look
const CONCURRENCY = 4 // git processes at once: enough to be quick, few enough to stay polite
const CHANGELOG_HEAD = 64 * 1024 // `[Unreleased]` lives at the top; the rest is history

export const PERIODS = ['today', 'yesterday', 'week', 'month']

const startOfDay = (t) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * The four windows, in local time, because a day is a day where the person is — not where the
 * server thinks it is. `week` and `month` roll backwards from today rather than snapping to a
 * calendar Monday or a first of the month: on the 2nd, a calendar month would be two days.
 *
 * `last` is not here: which day that is depends on the data, so it is decided in `facts()`.
 */
export function windowFor(period, now = Date.now()) {
  const today = startOfDay(now)
  const tomorrow = today + DAY
  if (period === 'today') return { period, from: today, to: tomorrow }
  if (period === 'yesterday') return { period, from: today - DAY, to: today }
  if (period === 'week') return { period, from: today - 6 * DAY, to: tomorrow }
  if (period === 'month') return { period, from: today - 29 * DAY, to: tomorrow }
  return null
}

/**
 * The most recent day that has anything in it — the one the page opens on.
 *
 * Not "yesterday": on a Monday yesterday is Sunday, and a page that opens empty after every
 * weekend teaches you not to open it. This is the same idea `web/recency.js` already uses to
 * decide which columns are still warm — anchored to the work rather than to the clock.
 */
export function lastActiveDay(stamps, now = Date.now()) {
  let best = null
  for (const t of stamps) {
    if (!Number.isFinite(t) || t > now) continue
    if (best === null || t > best) best = t
  }
  return best === null ? null : startOfDay(best)
}

/**
 * The `[Unreleased]` lines of a Keep a Changelog file: written down, not yet released.
 * Everything from that heading to the next one at the same level or higher.
 */
export function unreleasedSection(md) {
  const lines = String(md ?? '').split('\n')
  const start = lines.findIndex((l) => /^#{1,3}\s*\[?unreleased\]?/i.test(l))
  if (start === -1) return null
  const depth = (/^(#+)/.exec(lines[start]) || [, '##'])[1].length
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#+)\s/.exec(lines[i])
    if (m && m[1].length <= depth) break
    const line = lines[i].trim()
    if (line) out.push(line)
  }
  return out.length ? out : null
}

/**
 * Does this repository belong in the summary at all?
 *
 * This is the rule that keeps the page honest. A repository that has been dirty since March
 * and that you have not opened since is not news, and a summary that repeats it every single
 * morning is a summary you stop reading. Something has to have happened IN the window — a
 * commit, a file saved, a card moved — and only then is it worth saying what is still
 * outstanding there.
 */
export function isActive(repo) {
  return !!(repo && (repo.commits.length || repo.dirty.length || repo.cards.length))
}

/** Keeps only what falls inside a window, and drops the repositories left with nothing. */
export function narrow(repos, from, to) {
  const inside = (t) => Number.isFinite(t) && t >= from && t < to
  return repos
    .map((r) => ({
      ...r,
      commits: r.commits.filter((c) => inside(Date.parse(c.at))),
      dirty: r.dirty.filter((f) => inside(f.at)),
      cards: r.cards.filter((c) => inside(c.touched)),
    }))
    .filter(isActive)
}

/** Runs the work a few at a time: dozens of repositories must not become dozens of processes. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i], i)
  })
  await Promise.all(workers)
  return out
}

function unreleasedOf(dir) {
  const file = path.join(dir, 'CHANGELOG.md')
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(CHANGELOG_HEAD)
      const read = fs.readSync(fd, buf, 0, CHANGELOG_HEAD, 0)
      return unreleasedSection(buf.subarray(0, read).toString('utf8'))
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null // no changelog is the normal case, not a problem to report
  }
}

/** When each hanging file was last saved. A path that has vanished under us is simply skipped. */
function stampDirty(dir, paths) {
  const out = []
  for (const rel of paths) {
    try {
      out.push({ path: rel, at: fs.statSync(path.join(dir, rel)).mtimeMs })
    } catch {
      /* gone between the listing and the stat */
    }
  }
  return out
}

async function gather(from, to) {
  const projects = listProjects().filter((p) => fs.existsSync(path.join(p.path, '.git')))
  const cards = db.eventsBetween(from, to)
  const byRepo = new Map()
  for (const c of cards) {
    if (!byRepo.has(c.project_path)) byRepo.set(c.project_path, [])
    byRepo.get(c.project_path).push(c)
  }

  const repos = await mapLimit(projects, CONCURRENCY, async (p) => {
    const [h, dirty] = await Promise.all([git.history(p.path, { from, to }), git.dirtyFiles(p.path)])
    if (!h) return null
    return {
      name: projectName(p.path),
      path: p.path,
      remote: h.remote,
      unpushedTotal: h.unpushedTotal,
      commits: h.commits.map((c) => ({
        sha: c.sha.slice(0, 7),
        at: c.at,
        subject: c.subject,
        body: c.body,
        online: c.online,
      })),
      dirty: stampDirty(p.path, dirty),
      dirtyTotal: dirty.length,
      unreleased: unreleasedOf(p.path),
      cards: (byRepo.get(p.path) ?? []).map((c) => ({
        title: c.title,
        description: c.description || '',
        status: c.status,
        touched: c.touched,
        done: c.status === 'COMPLETED',
      })),
    }
  })
  return repos.filter(Boolean)
}

/** The one-line arithmetic the page and the writer both need, worked out once. */
export function totals(repos) {
  let commits = 0
  let online = 0
  let local = 0
  let dirty = 0
  let cardsOpen = 0
  let cardsDone = 0
  for (const r of repos) {
    commits += r.commits.length
    for (const c of r.commits) {
      if (c.online === true) online++
      else if (c.online === false) local++
    }
    dirty += r.dirty.length
    for (const c of r.cards) {
      if (c.done) cardsDone++
      else cardsOpen++
    }
  }
  return { repositories: repos.length, commits, online, local, dirty, cardsOpen, cardsDone }
}

/**
 * Everything the page and the writer work from. Reads git and the board; touches nothing.
 *
 * `last` costs the same as any other period even though it does not know its own window yet:
 * one pass over the lookback answers both "which day was the last one" and "what happened on
 * it", because a month of `git log` is the same single process as a day of it.
 */
export async function facts(period, now = Date.now()) {
  const wanted = windowFor(period, now)
  const scan = wanted ?? { period: 'last', from: startOfDay(now) - LOOKBACK, to: startOfDay(now) + DAY }
  const gathered = await gather(scan.from, scan.to)

  let { from, to } = scan
  let resolved = scan.period
  if (!wanted) {
    const stamps = []
    for (const r of gathered) {
      for (const c of r.commits) stamps.push(Date.parse(c.at))
      for (const f of r.dirty) stamps.push(f.at)
      for (const c of r.cards) stamps.push(c.touched)
    }
    const day = lastActiveDay(stamps, now)
    // Nothing at all in the last month: rather than an arbitrary day, show today and say so.
    from = day ?? startOfDay(now)
    to = from + DAY
    resolved = 'last'
  }

  const repos = narrow(gathered, from, to).sort((a, b) => b.commits.length - a.commits.length || a.name.localeCompare(b.name))
  return { period: resolved, from, to, repos, totals: totals(repos) }
}
