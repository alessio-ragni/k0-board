import * as db from './db.js'
import { findTranscript, readLiveSessions, transcriptIndex, transcriptName, writeName } from './watcher.js'
import { sessionName, setWindowTitle } from './launcher.js'

// ── A story's name on every session it has had ───────────────────────────────
// A session is called after its story — key and title, see `sessionName` — and the name has to
// follow the story wherever it changes: a title edited on the board or by a skill, a provisional
// key the cloud has just numbered, a key handed out again on a move to another repository. Rather
// than one hook on each of those doors, and a door forgotten the day a new one opens, the watching
// loop looks at the name every story should have and acts the moment it differs from the one it
// last saw. The first round after a start sees every story for the first time, and that is what
// brings the sessions that existed before into line.
//
// Three places, as ever: the window's title bar, at once; the transcript of every session the
// story has had that is no longer running, by appending the name — the last one wins; and the live
// session itself, which only its own `/rename` can reach and which the loop already types in
// (`renameDue`). Nothing here touches a running transcript: its process would write the old name
// back over it at the next turn.

const seen = new Map() // story id -> the name its sessions were last brought into line with
let index = null // session id -> transcript, for the round that looks at every story at once

/**
 * Called by the loop for every story, every round. Costs one string comparison when nothing has
 * changed, which is every round but the first and the ones right after an edit.
 */
export function keep(story, live) {
  const name = sessionName(story)
  if (seen.get(story.id) === name) return
  if (!seen.has(story.id) && story.session_id) index ??= transcriptIndex()
  follow(story, live)
}

/** The end of a round: the index was only good for the round that built it. */
export function roundDone() {
  index = null
}

/**
 * Brings every session of one story to the name it should have now. Returns how many transcripts
 * were renamed, which is what the tests count; the window title goes in without being awaited by
 * anybody, because a title bar that could not be reached is not a reason to stop.
 */
export function follow(story, live = readLiveSessions()) {
  const name = sessionName(story)
  seen.set(story.id, name)
  if (story.terminal_window_id) {
    Promise.resolve()
      .then(() => setWindowTitle(story.terminal_window_id, name))
      .catch(() => {})
  }
  let renamed = 0
  for (const s of db.listSessions(story.id)) {
    if (!s.session_id || live.has(s.session_id)) continue
    // With the index in hand it is the whole answer: a transcript not in it is not on the machine,
    // and looking it up again would walk the projects directory once for each one deleted.
    const file = index ? index.get(s.session_id) : findTranscript(s.session_id, s.work_path, story.project_path)
    if (!file || transcriptName(file) === name) continue
    writeName(file, s.session_id, name)
    renamed++
  }
  return renamed
}

/** A story that is gone takes its entry with it. */
export function forget(storyId) {
  seen.delete(storyId)
}
