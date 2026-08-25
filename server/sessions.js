import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { PROJECTS_DIR } from './watcher.js'

/**
 * Claude Code sessions that have already happened, ready to become cards.
 *
 * Nothing is written here: it only reads ~/.claude/projects, where Claude Code keeps the
 * transcript of every session in a JSONL file.
 */

/** How much is read from the head of a transcript to decide whether to open all of it. */
const HEAD = 64 * 1024

/**
 * The mark of a real session.
 *
 * Claude Code's interface writes a `{"type":"mode",…}` line; a `claude -p`, a subagent or a
 * skill launched from a script does not. It is a clean split — on one real machine it
 * separated 145 genuine sessions from 867 automated runs — and it can be read without opening
 * the whole file.
 *
 * The line is usually at the top, but not always: if you paste the prompt while Claude is
 * still starting up, the transcript begins with the lines of the send queue and the `mode`
 * ends up further down. Which is why the end is checked too — without that check, real
 * sessions were being lost, and the best ones at that: a pasted document and a question.
 */
const MODE = /^\{"type":"mode"/m

/** The bite a transcript is read in: some of them run to megabytes. */
const CHUNK = 1 << 20

const CLIP_FIRST = 700
const CLIP_RECENT = 250
const CLIP_REPLY = 500
const RECENT = 3

/**
 * Opens and reads a piece of a file. Returns an empty string if the file disappeared in the
 * meantime: a scan must never stall over one transcript fewer.
 */
function slice(file, from, len) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
  } catch {
    return ''
  }
  try {
    const buf = Buffer.alloc(len)
    const n = fs.readSync(fd, buf, 0, len, from)
    return buf.subarray(0, n).toString('utf8')
  } catch {
    return ''
  } finally {
    fs.closeSync(fd)
  }
}

const CWD = /"cwd":"((?:[^"\\]|\\.)*)"/

function firstCwd(text) {
  const m = CWD.exec(text)
  if (!m) return null
  try {
    return JSON.parse(`"${m[1]}"`)
  } catch {
    return null // string cut in half by the edge of the window
  }
}

/**
 * From the `cwd` to a column on the board. It walks up to the first `.git`; if that is a file
 * rather than a directory we are inside a worktree, and then the work belongs to the
 * repository the worktree came from — not to the temporary copy, which tomorrow will not be
 * there. With no `.git` anywhere it falls back to the directory under your home.
 */
function resolveRoot(cwd) {
  let dir = cwd
  for (;;) {
    const dot = path.join(dir, '.git')
    let st = null
    try {
      st = fs.statSync(dot)
    } catch {
      /* nothing here: go up */
    }
    if (st?.isDirectory()) return dir
    if (st?.isFile()) {
      const m = /gitdir:\s*(.+)/.exec(fs.readFileSync(dot, 'utf8'))
      const base = m?.[1].trim().split('/.git/worktrees/')[0]
      return base && fs.existsSync(base) ? base : dir
    }
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  // No `.git` anywhere: to k0 a project is also just a directory you have worked in — a
  // folder of notes is not a repository and belongs on the board like everything else.
  // The directory under your home is what counts, so subdirectories do not each open a
  // column of their own.
  const home = os.homedir()
  if (cwd.startsWith(home + path.sep)) {
    const first = cwd.slice(home.length + 1).split(path.sep)[0]
    if (first) return path.join(home, first)
  }
  return cwd
}

function repoOf(cwd, cache) {
  if (cache.has(cwd)) return cache.get(cwd)
  const r = resolveRoot(cwd)
  const ok =
    r && fs.existsSync(r) && !r.includes('/.claude/worktrees/') && !r.includes('/.claude-worktrees/') ? r : null
  cache.set(cwd, ok)
  return ok
}

/** Walks a transcript line by line without holding all of it in memory. */
function eachLine(file, fn) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
  } catch {
    return
  }
  const buf = Buffer.alloc(CHUNK)
  const decoder = new StringDecoder('utf8')
  let rest = ''
  try {
    let pos = 0
    for (;;) {
      const n = fs.readSync(fd, buf, 0, CHUNK, pos)
      if (!n) break
      pos += n
      const parts = (rest + decoder.write(buf.subarray(0, n))).split('\n')
      rest = parts.pop() ?? ''
      for (const line of parts) fn(line)
    }
    rest += decoder.end()
    if (rest) fn(rest)
  } finally {
    fs.closeSync(fd)
  }
}

/** Lines that are not your words but the program's scaffolding. */
const NOISE =
  /^(<command-name>|<command-message>|<command-args>|<local-command|<user-prompt-submit-hook|<system-reminder>|<bash-input>|<bash-stdout>|Caveat: The messages below|\[Request interrupted)/

function textOf(o) {
  const c = o.message?.content
  if (typeof c === 'string') return c
  if (!Array.isArray(c)) return ''
  return c
    .filter((x) => x?.type === 'text' && typeof x.text === 'string')
    .map((x) => x.text)
    .join('\n')
}

function clean(s) {
  return s
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const clip = (s, n) => (s.length > n ? s.slice(0, n).trimEnd() + '…' : s)

/**
 * The gist of a session: enough to say what it was about and where it got to, without
 * dragging megabytes of conversation along.
 */
function digest(file) {
  const out = {
    turns: 0,
    first_prompt: '',
    recent_prompts: [],
    last_reply: '',
    title_hint: null,
    started_at: null,
    ended_at: null,
  }
  let aiTitle = null
  let custom = null

  eachLine(file, (line) => {
    if (!line.startsWith('{')) return
    let o
    try {
      o = JSON.parse(line)
    } catch {
      return
    }

    // The title Claude Code has already written for itself: one set by hand wins.
    if (o.type === 'ai-title' && o.aiTitle) {
      aiTitle = o.aiTitle
      return
    }
    if (o.type === 'custom-title' && o.customTitle) {
      custom = o.customTitle
      return
    }

    if (o.timestamp) {
      const t = Date.parse(o.timestamp)
      if (t) {
        if (!out.started_at || t < out.started_at) out.started_at = t
        if (!out.ended_at || t > out.ended_at) out.ended_at = t
      }
    }

    // Subagents talk among themselves: that is not the conversation with you.
    if (o.isSidechain) return

    if (o.type === 'user') {
      const t = clean(textOf(o))
      if (!t || NOISE.test(t)) return
      out.turns++
      if (!out.first_prompt) out.first_prompt = clip(t, CLIP_FIRST)
      out.recent_prompts.push(clip(t, CLIP_RECENT))
      if (out.recent_prompts.length > RECENT) out.recent_prompts.shift()
      return
    }

    if (o.type === 'assistant') {
      const t = clean(textOf(o))
      if (t) out.last_reply = clip(t, CLIP_REPLY)
    }
  })

  out.title_hint = custom || aiTitle || null
  return out
}

/**
 * The sessions worth offering as cards, most recent first.
 *
 * Two passes, because the second one is expensive: first the head of every transcript in the
 * window is checked, to keep only the real sessions and work out which repository they belong
 * to; then only the ones that actually fit under the per-repository cap are read in full.
 *
 * `exclude` are the session ids already on a card: re-importing must not make duplicates.
 * `live` are the sessions still running, which can be attached too.
 * `root` only changes in the tests, to look at a directory of fake transcripts.
 */
export function scanSessions({
  days = 14,
  perRepo = 10,
  exclude = new Set(),
  live = new Set(),
  root = PROJECTS_DIR,
} = {}) {
  const cutoff = Date.now() - days * 86400000
  const byRepo = new Map()
  const roots = new Map()

  let dirs
  try {
    dirs = fs.readdirSync(root)
  } catch {
    return [] // no transcripts on this machine: nothing to import
  }

  for (const dir of dirs) {
    const full = path.join(root, dir)
    let files
    try {
      files = fs.readdirSync(full)
    } catch {
      continue
    }
    for (const name of files) {
      if (!name.endsWith('.jsonl')) continue
      const sessionId = name.slice(0, -'.jsonl'.length)
      if (exclude.has(sessionId)) continue

      const file = path.join(full, name)
      let st
      try {
        st = fs.statSync(file)
      } catch {
        continue
      }
      if (!st.size || st.mtimeMs < cutoff) continue

      // Two reads of 64 KB at most, head and tail, and the tail only if it is needed.
      const head = slice(file, 0, HEAD)
      let tailText = null
      const tail = () => (tailText ??= st.size > HEAD ? slice(file, st.size - HEAD, HEAD) : '')

      if (!MODE.test(head) && !MODE.test(tail())) continue

      // Which directory it was running in. Always read from the transcript, never by
      // reversing the directory name: that name is lossy — `my_project` and `my-project`
      // become the same slug — and there is no way back from it.
      const cwd = firstCwd(head) ?? firstCwd(tail())
      if (!cwd) continue
      const repo = repoOf(cwd, roots)
      if (!repo) continue // the repository is gone: the session cannot be resumed

      const list = byRepo.get(repo)
      if (list) list.push({ sessionId, file, cwd, mtime: st.mtimeMs })
      else byRepo.set(repo, [{ sessionId, file, cwd, mtime: st.mtimeMs }])
    }
  }

  const out = []
  for (const [repo, list] of byRepo) {
    list.sort((a, b) => b.mtime - a.mtime)
    let taken = 0
    for (const c of list) {
      if (taken >= perRepo) break
      const d = digest(c.file)
      // Not one word of yours in the transcript: there is nothing for a card to say.
      if (!d.turns) continue
      taken++
      out.push({
        session_id: c.sessionId,
        project_path: repo,
        project_name: path.basename(repo),
        cwd: c.cwd,
        alive: live.has(c.sessionId),
        started_at: d.started_at ?? c.mtime,
        ended_at: d.ended_at ?? c.mtime,
        turns: d.turns,
        title_hint: d.title_hint,
        first_prompt: d.first_prompt,
        recent_prompts: d.recent_prompts,
        last_reply: d.last_reply,
      })
    }
  }

  out.sort((a, b) => b.ended_at - a.ended_at)
  return out
}
