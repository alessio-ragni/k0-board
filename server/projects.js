import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { projectRecency } from './db.js'
import { hasDocs } from './files.js'
import { shell } from '../platform/index.js'

const HOME = os.homedir()
const CLAUDE_JSON = path.join(HOME, '.claude.json')

/** Still there? A renamed or deleted directory is no longer a project. */
function exists(dir) {
  try {
    return fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

/**
 * Is it empty? An empty directory under your home is one you have just made, and it cannot be
 * anything other than a project about to start: it is the sign installed software never has.
 * Entries are read one at a time rather than with `readdirSync`, which for a directory full of
 * things would drag the whole lot along on every round of the board. Anything starting with a
 * dot does not count: the metadata file the file manager scatters the moment you walk past
 * must not make an empty directory look full.
 */
function isEmpty(dir) {
  let d
  try {
    d = fs.opendirSync(dir)
  } catch {
    return false
  }
  try {
    for (;;) {
      const e = d.readSync()
      if (!e) return true
      if (!e.name.startsWith('.')) return false
    }
  } catch {
    return false
  } finally {
    try {
      d.closeSync()
    } catch {
      /* already closed: does not change the answer */
    }
  }
}

/**
 * When you last opened each project according to Claude Code, which keeps it in
 * ~/.claude.json. Careful: `lastStartTime` is rewritten when the session ENDS, so on its own
 * it only tells you about the past — the present is k0's to know (see below).
 */
function lastUsed() {
  const map = new Map()
  try {
    const data = JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf8'))
    for (const [p, v] of Object.entries(data.projects || {})) {
      const t = Number(v?.lastStartTime) || Number(v?.lastSessionModified) || 0
      if (t) map.set(p, t)
    }
  } catch {
    /* no history: fall back to alphabetical order */
  }
  return map
}

/**
 * The candidate directories: everything under your home, plus the ones Claude Code has seen
 * elsewhere. No cache and no filtering on `.git`: a directory just created or just renamed has
 * to show up with the right name on the first refresh of the page, and reading the home
 * directory costs far too little to put off.
 */
function scan(fromClaude) {
  const paths = new Set()
  const skip = shell.homeSkipList()

  for (const name of fs.readdirSync(HOME)) {
    if (name.startsWith('.') || skip.has(name)) continue
    const dir = path.join(HOME, name)
    if (exists(dir)) paths.add(dir)
  }
  for (const dir of fromClaude) {
    // No worktrees: they are temporary copies, not projects.
    if (dir.includes(`${path.sep}.claude-worktrees${path.sep}`) || dir.includes('/.claude-worktrees/')) continue
    if (exists(dir)) paths.add(dir)
  }

  return [...paths]
}

/**
 * The repositories, most used at the top. Recency is the fresher of two histories: Claude
 * Code's, which knows where you have worked even outside k0, and k0's own cards, which are the
 * only thing that notices a session still open right now.
 */
export function listProjects() {
  const fromClaude = lastUsed()
  const mine = new Map(projectRecency().map((r) => [r.project_path, Number(r.at) || 0]))
  // A repository with a card is always selectable, even if it lives outside your home — but
  // only while its directory exists: the old name of a renamed one does not come back.
  const paths = new Set([...scan(fromClaude.keys()), ...[...mine.keys()].filter(exists)])
  // Your home is not a project: it is the directory that contains them all. It ends up here
  // because Claude Code notes a session started from it in ~/.claude.json too, but as a
  // repository it means nothing — and in the list it would sit among its own children.
  paths.delete(HOME)

  const list = [...paths].map((dir) => ({
    name: path.basename(dir),
    path: dir,
    last_used: Math.max(fromClaude.get(dir) || 0, mine.get(dir) || 0),
    // Your stuff, or installed stuff? One sign is enough: a `.git`, a history in Claude Code, a
    // card, a document in there, or the opposite of all of them — that there is nothing in it
    // yet. Under your home there are also directories that are only ever programs, and those
    // stay out precisely because they are full of things nobody reads.
    // The empty question is asked last: it touches the disk, and by then only the few
    // directories no other sign has already claimed still ask it.
    known:
      fromClaude.has(dir) ||
      mine.has(dir) ||
      fs.existsSync(path.join(dir, '.git')) ||
      hasDocs(dir) ||
      isEmpty(dir),
  }))
  list.sort((a, b) => b.last_used - a.last_used || a.name.localeCompare(b.name))
  return list
}

/**
 * The cards still standing: the ones whose directory exists. It is the same rule as the
 * repository list above — "a card is kept alive by its directory" — carried over to the board
 * too, which used to work its columns out from the cards alone. Without it, a deleted or
 * renamed directory leaves a column behind forever.
 *
 * Hide, do not delete: the cards stay in the database, and if the directory comes back one day
 * — an external disk remounted, a directory put back — so do they.
 *
 * The disk is asked once per repository and not once per card: there are a couple of dozen
 * columns and a few hundred cards, and this round runs every second.
 */
export function onDisk(cards) {
  const alive = new Map()
  return cards.filter((c) => {
    if (!alive.has(c.project_path)) alive.set(c.project_path, exists(c.project_path))
    return alive.get(c.project_path)
  })
}

export const projectName = (p) => path.basename(p)
