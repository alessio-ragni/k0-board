// ── Which repositories are still warm ──────────────────────────────
// With a dozen repositories open the board is wider than the screen, and the three or four you
// are actually on today sit scattered among all the others. This decides which columns stay
// open and which fold away into `Old`, and it is here rather than in board.js for the reason
// docs/testing.md gives: what is worth proving comes out of the browser files into one of its
// own. Nothing in here touches the DOM.

export const DAY = 24 * 60 * 60 * 1000

/**
 * The statuses that hold a column on the board whatever its age: something is happening in there
 * right now, or something is on screen waiting for you. Hiding the one that is waiting for you is
 * the exact opposite of what the board is for.
 *
 * `IDLE` is deliberately not one of them, and it is the only debatable line in this file. It
 * means "your turn", so it looks like it belongs — but it is also the resting state of every
 * terminal you have left open, and on a real board nearly every live card is sitting in it. Let
 * it hold a column and nothing ever folds: a session you finished with three weeks ago and never
 * closed would keep its column at full width for ever. So `IDLE` gets the same treatment as
 * everything else — recent, and it stays; a fortnight old, and it goes to `Old`, where it is one
 * click away. Nothing is closed either way: the terminal is still open, and the card is still
 * exactly where you left it.
 */
const DEMANDING = new Set(['ASK', 'PLANNED', 'WORKING', 'PLANNING'])

/** The last time each repository was touched: the freshest of its cards. */
export function lastTouched(cards) {
  const map = new Map()
  for (const c of cards) {
    const t = Number(c.updated_at) || 0
    if (t > (map.get(c.project_path) ?? 0)) map.set(c.project_path, t)
  }
  return map
}

/** The repositories with something going on in them right now. */
export function busy(cards) {
  const set = new Set()
  for (const c of cards) if (DEMANDING.has(c.status)) set.add(c.project_path)
  return set
}

/**
 * The line between recent and old. It is **not** "now minus a day": it is a day back from the
 * most recent thing on the whole board.
 *
 * That one difference is what makes it survive a weekend. Anchored to the clock, a Monday
 * morning would find every column older than a day and fold the lot — you would open k0 to an
 * empty board on the one morning you most need to see where you left off. Anchored to the work,
 * Monday shows you Friday, and the moment you start something the line moves with you.
 */
export function cutoff(touched) {
  let newest = 0
  for (const t of touched.values()) if (t > newest) newest = t
  return newest ? newest - DAY : 0
}

/**
 * Which columns stay open, and which fold into `Old`. Four rules, in this order:
 *
 * 1. a repository with something going on in it is always open — see DEMANDING above, and note
 *    this beats a fold you did by hand: something in there woke up and wants you;
 * 2. one you opened by hand during this visit stays open;
 * 3. one you put away by hand stays away;
 * 4. otherwise, open if it was touched after the cutoff.
 *
 * `held` carries the fifth rule, which lives in the caller: within one visit the set of open
 * columns only ever grows. A column does not fold out from under you while you are working —
 * it folds the next time the page loads. It is the same reason the columns only reorder
 * themselves in driving mode.
 *
 * The order of `paths` is kept: whoever asked has already sorted them.
 */
export function split({ paths, cards, folded = new Set(), held = new Set() }) {
  const touched = lastTouched(cards)
  const line = cutoff(touched)
  const alive = busy(cards)
  const open = []
  const old = []
  for (const p of paths) {
    const stays =
      alive.has(p) || held.has(p) || (!folded.has(p) && (touched.get(p) ?? 0) >= line)
    ;(stays ? open : old).push(p)
  }
  return { open, old, touched, alive }
}
