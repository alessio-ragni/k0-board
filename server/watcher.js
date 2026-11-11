import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { alive as isAlive } from '../platform/shared/run.js'

const SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions')
export const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects')

const SLUG_MAX = 200

/**
 * Reproduces exactly the slug Claude Code uses to name the transcript directory: every
 * non-alphanumeric character becomes `-`, and above 200 characters the name is truncated and
 * closed with a hash of the original path.
 *   /home/you/my-project -> -home-you-my-project
 */
export function projectSlug(cwd) {
  const s = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  if (s.length <= SLUG_MAX) return s
  let h = 0
  for (let i = 0; i < cwd.length; i++) h = ((h << 5) - h + cwd.charCodeAt(i)) | 0
  return `${s.slice(0, SLUG_MAX)}-${Math.abs(h).toString(36)}`
}

export function transcriptPath(cwd, sessionId) {
  return path.join(PROJECTS_DIR, projectSlug(cwd), `${sessionId}.jsonl`)
}

/**
 * Where the transcript of a session really is.
 *
 * Usually under the slug of the directory the session was started in — but a session that moved
 * into a worktree writes under the worktree's slug from then on, and the story only knows the
 * repository. So the hints are tried first, cheaply, and when none of them has the file the whole
 * projects directory is read once: one `readdir` per rename, never on the per-second scan.
 */
export function findTranscript(sessionId, ...cwds) {
  for (const cwd of cwds) {
    if (!cwd) continue
    const file = transcriptPath(cwd, sessionId)
    if (fs.existsSync(file)) return file
  }
  let dirs
  try {
    dirs = fs.readdirSync(PROJECTS_DIR)
  } catch {
    return null
  }
  for (const d of dirs) {
    const file = path.join(PROJECTS_DIR, d, `${sessionId}.jsonl`)
    if (fs.existsSync(file)) return file
  }
  return null
}

/**
 * Changes the name of a session that has already ended, so that renaming a story makes the new
 * name show up in the list of sessions you can resume.
 *
 * These are the two lines Claude Code writes for itself at the end of the transcript on every
 * turn, and the last one wins: all this does is write another copy.
 *
 * Only on a closed session: if the process is alive it holds the file open for appending and
 * would put the old name back on the next turn. There, `/rename` typed into its window takes care
 * of it — `renameLive` in launcher.js — and the `-n` of Resume does the rest.
 *
 * `story` is the flat row: the session's id, and the two places its transcript is likeliest to be.
 */
export function renameSession(story, name) {
  const sessionId = story.session_id
  const file = findTranscript(sessionId, story.work_path, story.project_path)
  if (!file) return false
  writeName(file, sessionId, name)
  return true
}

/** The two lines themselves, appended to a transcript already found. */
export function writeName(file, sessionId, name) {
  const line = (o) => JSON.stringify({ ...o, sessionId }) + '\n'
  fs.appendFileSync(
    file,
    line({ type: 'custom-title', customTitle: name }) + line({ type: 'agent-name', agentName: name })
  )
}

/** How much of the end of a transcript is read to find the name it goes by. */
const TAIL = 64 * 1024

/**
 * The name a transcript goes by now: the last `custom-title` near its end, or null when there is
 * none there. Claude Code writes that line at the end of every turn and a rename appends one, so
 * the tail is where it is; a transcript whose tail has none is simply named again, which costs two
 * lines and nothing else.
 */
export function transcriptName(file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    const len = Math.min(size, TAIL)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, size - len)
    const lines = buf.toString('utf8').split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"custom-title"')) continue
      try {
        const o = JSON.parse(lines[i])
        if (o.type === 'custom-title' && typeof o.customTitle === 'string') return o.customTitle
      } catch {
        // the first line of the tail is usually cut in half: not this one, then
      }
    }
    return null
  } catch {
    return null
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

/**
 * Every transcript on the machine by session id, read in one pass over the projects directory.
 * Used when every story's sessions are brought into line at once, where looking each one up on its
 * own would walk the whole directory again for every transcript that is not where it was expected.
 */
export function transcriptIndex() {
  const index = new Map()
  let dirs
  try {
    dirs = fs.readdirSync(PROJECTS_DIR)
  } catch {
    return index
  }
  for (const d of dirs) {
    let files
    try {
      files = fs.readdirSync(path.join(PROJECTS_DIR, d))
    } catch {
      continue
    }
    for (const f of files) {
      if (f.endsWith('.jsonl') && !index.has(f.slice(0, -6))) index.set(f.slice(0, -6), path.join(PROJECTS_DIR, d, f))
    }
  }
  return index
}

/**
 * Reads the live sessions: ~/.claude/sessions/<pid>.json.
 * `status` is busy | shell | idle | waiting; with waiting, `waitingFor` says why.
 */
export function readLiveSessions() {
  const map = new Map()
  let files
  try {
    files = fs.readdirSync(SESSIONS_DIR)
  } catch {
    return map
  }
  for (const f of files) {
    if (!/^\d+\.json$/.test(f)) continue
    let s
    try {
      s = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'))
    } catch {
      continue
    }
    if (!s.sessionId || !isAlive(s.pid)) continue
    map.set(s.sessionId, s)
  }
  return map
}

/**
 * State read from the transcript, kept incrementally: on the first look the whole file is
 * read, then only the new part. It has to work this way because the `permission-mode` line is
 * written when the mode changes, and in a long session it would fall outside any window on
 * the end of the file.
 */
const scans = new Map() // sessionId -> { offset, permissionMode, pending: Map<id,name>, tail }

const WATCHED_TOOLS = new Set(['ExitPlanMode', 'AskUserQuestion'])

export function scanTranscript(cwd, sessionId) {
  const file = transcriptPath(cwd, sessionId)
  let scan = scans.get(sessionId)
  if (!scan) {
    scan = { offset: 0, permissionMode: null, pending: new Map(), tail: '' }
    scans.set(sessionId, scan)
  }

  let size
  try {
    size = fs.statSync(file).size
  } catch {
    return summarise(scan)
  }
  // File recreated or truncated: start over.
  if (size < scan.offset) Object.assign(scan, { offset: 0, permissionMode: null, pending: new Map(), tail: '' })
  if (size === scan.offset) return summarise(scan)

  const fd = fs.openSync(file, 'r')
  try {
    const len = size - scan.offset
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, scan.offset)
    scan.offset = size
    const chunk = scan.tail + buf.toString('utf8')
    const lines = chunk.split('\n')
    // The last line may still be half written: we pick it up again next round.
    scan.tail = lines.pop() ?? ''
    for (const line of lines) applyLine(scan, line)
  } finally {
    fs.closeSync(fd)
  }
  return summarise(scan)
}

function applyLine(scan, line) {
  if (!line.trim()) return
  let d
  try {
    d = JSON.parse(line)
  } catch {
    return
  }
  if (d.type === 'permission-mode' && d.permissionMode) {
    scan.permissionMode = d.permissionMode
    return
  }
  const content = d.message?.content
  if (!Array.isArray(content)) return
  for (const c of content) {
    if (c?.type === 'tool_use' && WATCHED_TOOLS.has(c.name)) {
      scan.pending.set(c.id, c.name)
      continue
    }
    if (c?.type !== 'tool_result' || !c.tool_use_id) continue
    const was = scan.pending.get(c.tool_use_id)
    scan.pending.delete(c.tool_use_id)
    // Plan approved: leave plan mode straight away, without waiting for the `permission-mode`
    // line that only arrives on the next turn. If the plan was rejected instead, we stay in
    // planning.
    if (was === 'ExitPlanMode' && typeof c.content === 'string' && c.content.includes('approved your plan')) {
      scan.permissionMode = 'auto'
    }
  }
}

function summarise(scan) {
  const names = [...scan.pending.values()]
  return {
    planMode: scan.permissionMode === 'plan',
    pendingPlan: names.includes('ExitPlanMode'),
    pendingAsk: names.includes('AskUserQuestion'),
  }
}

export function forgetSession(sessionId) {
  scans.delete(sessionId)
}

/**
 * Lets go of every session that is not running any more.
 *
 * `forgetSession` above is the deliberate goodbye — a story deleted, a terminal closed by hand —
 * and a session that simply ends is none of those, so nothing ever said goodbye to it. One entry
 * stayed behind per session this server had ever watched, each holding the tail of a transcript
 * and the tools it was waiting on; on a board that has seen a few hundred of them, that was most
 * of what the process was holding on to at rest. It had grown to 479 against 11 really alive.
 *
 * Losing the offset of a session that comes back is not a loss: the next scan reads the file from
 * the top, which is what the first scan of any session does anyway.
 */
export function forgetDeadSessions(alive) {
  for (const sessionId of scans.keys()) if (!alive.has(sessionId)) scans.delete(sessionId)
}

/**
 * The conversation now running in this story's terminal, when it is not the one the story knows.
 *
 * Claude Code's session id belongs to a conversation, not to a process. `/compact` keeps it;
 * `/clear` starts a new conversation in the same process, under a new id, and so does `/resume`
 * when it switches to another one. Looked up by the old id, the story found nothing and took its
 * terminal for dead: the post-it stopped breathing while work went on, and Resume opened a second
 * window on a conversation that had been cleared away.
 *
 * The process is what stays, so the process is what is followed: the pid the story last saw alive
 * and, where both sides know it, the time that process started — a pid is handed out again once
 * its process has gone, and the start time is what tells a stranger from the same terminal. With
no start time on either side there is no telling them apart, and the story is left where it is.
 *
 * Whatever is now running there becomes the story's, unless another story already claims it —
 * `claimedBy` answers which story holds a session id, if any. Returns the new id, or null.
 */
export function followTerminal(story, live, claimedBy) {
  if (story.completed_at || !story.session_id || !story.session_pid || !story.session_proc_start) return null
  if (live.has(story.session_id)) return null
  for (const s of live.values()) {
    if (Number(s.pid) !== Number(story.session_pid) || s.procStart !== story.session_proc_start) continue
    const owner = claimedBy(s.sessionId)
    if (owner != null && owner !== story.id) return null
    return s.sessionId
  }
  return null
}

/**
 * Something is really running behind this status. It is the one question two different places
 * ask: whether a status that survives the death of a process would be a lie, and whether a
 * session may be closed from the board — a session that is grinding away is not.
 */
export const busy = (status) => status === 'WORKING' || status === 'PLANNING'

/**
 * Translates Claude Code's signals into the board's five live statuses.
 * Returns { status, alive }.
 *
 * Five, not seven: `BACKLOG` and `COMPLETED` were never things a session does — one means the
 * story has no session at all, the other means you have ticked it off — and they are the story's
 * business now, on the other axis. What is left here is what the process is actually doing.
 */
export function deriveStatus(story, live) {
  // Ticked off. The terminal was closed when you said Done, so whatever the session was in the
  // middle of, it is not in the middle of it any more — and until the process really goes, the
  // post-it must not go on breathing.
  if (story.completed_at) return { status: story.session_status || 'IDLE', alive: false }
  if (!story.session_id) return { status: story.session_status || 'IDLE', alive: false }

  const session = live.get(story.session_id)
  if (!session) {
    // Process dead: the session can still be resumed. We keep the last status only if it said
    // something about you (an open question, a plan left sitting there); WORKING and PLANNING
    // would be a lie, nothing is grinding away any more.
    const last = story.session_status || 'IDLE'
    return { status: busy(last) ? 'IDLE' : last, alive: false }
  }

  const t = scanTranscript(session.cwd || story.project_path, story.session_id)

  switch (session.status) {
    case 'busy':
      return { status: t.planMode ? 'PLANNING' : 'WORKING', alive: true }

    case 'waiting':
      // While a dialog is open the transcript has not yet written the call that caused it
      // (verified: with the plan on screen, there is no trace of ExitPlanMode). The
      // distinction comes from `waitingFor`, which the session file writes immediately:
      // "input needed" is a question, "permission prompt" in plan mode is a plan to approve.
      if (session.waitingFor === 'input needed') return { status: 'ASK', alive: true }
      if (t.planMode || t.pendingPlan) return { status: 'PLANNED', alive: true }
      return { status: 'ASK', alive: true }

    default: // idle | shell — no dialog open, the ball is in your court
      return { status: 'IDLE', alive: true }
  }
}
