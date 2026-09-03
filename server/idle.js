/**
 * Which terminals have been sitting there long enough to be worth giving back.
 *
 * A session left open costs memory whether or not anybody is looking at it: the `claude` process,
 * the MCP servers it started, the browsers those opened. `Close` on a card has always been the
 * cure — it stops the session and shuts its window, leaves the card exactly where it is, and
 * `Resume` picks the conversation up where it was. This is that same gesture, remembered for you.
 *
 * Only the deciding lives here. Nothing in this file kills anything, opens anything or reads a
 * disk, which is what lets every rule below be proved without a machine to prove it on.
 */

const HOUR = 3600000

/**
 * The cards whose terminal should go, most of the rules being about what to leave alone.
 *
 * Yellow only — `IDLE`, the ball in your court. Not because the others are less forgotten but
 * because of what closing them would destroy: a question and a finished plan are drawn by the
 * terminal and are not in the transcript yet, so shutting that window throws away the very thing
 * it was showing you. `WORKING` and `PLANNING` are somebody mid-thought. And a session Claude
 * Code reports as `shell` is a shell you dropped into, which may well have a command of yours
 * running in it — k0 does not know what, so k0 does not touch it.
 */
export function dueForClose({ cards, live, hours, now = Date.now() }) {
  if (!(hours > 0)) return [] // switched off, and nothing to think about
  const deadline = now - hours * HOUR
  return cards.filter((card) => {
    if (card.completed_at || !card.session_id || !card.session_alive) return false
    if (card.status !== 'IDLE') return false
    const session = live.get(card.session_id)
    if (!session || session.status !== 'idle') return false
    return lastSignOfLife(card, session) <= deadline
  })
}

/**
 * The most recent sign that something happened here, from every source that keeps one, and the
 * newest of them wins.
 *
 * Taking the maximum is the whole safety of this feature. Being wrong in that direction leaves a
 * window open and costs a few hundred megabytes until tomorrow; being wrong the other way closes
 * a terminal somebody was about to go back to. So a single stale clock can never be the one that
 * decides.
 *
 * `updatedAt` and `statusUpdatedAt` come out of Claude Code's own `~/.claude/sessions/<pid>.json`,
 * which k0 already reads every second and until now threw away. They move when the session really
 * changes state and are not a heartbeat — a session that had been busy for twenty-three minutes
 * was carrying timestamps twenty-three minutes old — so they say what they appear to say.
 *
 * `updated_at` matters for the case none of the others cover: resuming a card leaves the status at
 * `IDLE`, so no new event is written and `status_since` stays as old as it was.
 */
export function lastSignOfLife(card, session) {
  return Math.max(card.updated_at || 0, card.status_since || 0, session.updatedAt || 0, session.statusUpdatedAt || 0)
}
