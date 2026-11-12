// ── Arrows ────────────────────────────────────────────────────────────
// An arrow goes from the story that waits to the story it waits on. This file is the half of them
// that needs no page to run: which arrows there are, what a story reaches by following them, and
// the curve between two rectangles. What draws them and what listens to the pointer is in
// arrowboard.js, which is why this half can be tested and that half cannot.

/** Every arrow on the board, read off the `deps` each story already carries. */
export function edgesFrom(stories) {
  const done = new Map(stories.map((s) => [s.id, !!s.completed_at || s.state === 'Done']))
  const edges = []
  for (const s of stories) {
    for (const d of s.deps ?? []) {
      // Faded when either end is finished: the arrow is history by then, and should look it.
      edges.push({ from: s.id, to: d.id, faded: !!done.get(s.id) || d.state === 'Done' })
    }
  }
  return edges
}

function reach(id, edges, back) {
  const next = new Map()
  const put = (a, b) => next.set(a, [...(next.get(a) ?? []), b])
  for (const e of edges) {
    put(e.from, e.to)
    if (back) put(e.to, e.from)
  }
  const seen = new Set([id])
  const queue = [id]
  while (queue.length) {
    for (const n of next.get(queue.shift()) ?? []) {
      if (seen.has(n)) continue
      seen.add(n)
      queue.push(n)
    }
  }
  seen.delete(id)
  return [...seen]
}

/** What a story waits on, and what those wait on: the arrows followed the way they point. */
export const downstream = (id, edges) => reach(id, edges, false)

/** Everything a story is joined to, whichever way the arrows point — itself included. */
export const chain = (id, edges) => new Set([id, ...reach(id, edges, true)])

/** The arrows of one chain: the ones with both ends inside it. */
export const within = (ids, edges) => edges.filter((e) => ids.has(e.from) && ids.has(e.to))

/** How many arrows touch a story, and who is on the other end of each. */
export function ties(id, edges) {
  return {
    out: edges.filter((e) => e.from === id).map((e) => e.to),
    in: edges.filter((e) => e.to === id).map((e) => e.from),
  }
}

/**
 * Whether an arrow from `from` to `to` would leave stories waiting on each other for ever.
 *
 * The server refuses it too, and its refusal is the one that counts; this is only so the post-it
 * under the pointer can already say no while the arrow is still in the air.
 */
export const hitsLoop = (from, to, edges) => from === to || downstream(to, edges).includes(from)

/**
 * What letting go of an arrow means, given what is under the pointer: another note is an arrow to
 * it; a repository — its `+` or its name — is a new story there, which the arrow will point at
 * once it exists; the note the arrow left from, or nothing at all, is nothing.
 *
 * A note wins over a repository, though the page never hands over both: the header and the notes
 * do not overlap, and a note is the thing somebody aiming at a note meant.
 */
export function dropOf({ note = null, repo = null } = {}, from) {
  if (note != null) return note === from ? null : { kind: 'link', to: note }
  if (repo) return { kind: 'new', path: repo }
  return null
}

const r1 = (n) => Math.round(n * 10) / 10

/**
 * The curve from one post-it to another, as the `d` of a path.
 *
 * Two post-its in different columns are joined side to side: out of the edge that faces the other
 * one, in at the edge that faces back, with the curve leaving and arriving level. Two in the same
 * column have no facing edges, so the arrow leaves by the right, bows out into the gap between
 * columns and comes back in by the right — the one place where it does not run over the notes in
 * between. `b` may be a bare point (no `w`, no `h`): that is the arrow still being dragged.
 */
export function route(a, b) {
  const bw = b.w ?? 0
  const bh = b.h ?? 0
  const ax = a.x + a.w / 2
  const bx = b.x + bw / 2
  const sy = a.y + a.h / 2
  const ey = b.y + bh / 2
  const apart = Math.abs(bx - ax) > (a.w + bw) / 2
  if (!apart) {
    const sx = a.x + a.w
    const ex = b.x + bw
    const bow = 36 + Math.min(90, Math.abs(ey - sy) / 4)
    const out = Math.max(sx, ex) + bow
    return `M${r1(sx)} ${r1(sy)} C${r1(out)} ${r1(sy)} ${r1(out)} ${r1(ey)} ${r1(ex)} ${r1(ey)}`
  }
  const right = bx > ax
  const sx = right ? a.x + a.w : a.x
  const ex = right ? b.x : b.x + bw
  const k = Math.max(30, Math.abs(ex - sx) / 2) * (right ? 1 : -1)
  return `M${r1(sx)} ${r1(sy)} C${r1(sx + k)} ${r1(sy)} ${r1(ex - k)} ${r1(ey)} ${r1(ex)} ${r1(ey)}`
}
