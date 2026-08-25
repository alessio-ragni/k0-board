// ── The view ──────────────────────────────────────────────────────────
// The board does not scroll: it moves. `#board` is the whole content, pushed underneath the
// fixed window of `#viewport` by a single transform. No bars and nothing to drag: you bring the
// pointer near an edge and the board slides that way — the closer you are, the faster it goes —
// and it stops dead as soon as there is nothing left on that side.
//

const $ = (s) => document.querySelector(s)

const EDGE = 96 // the sensitive band along each edge, in px
const SPEED = 1200 // px per second right at the edge; inside the band it accelerates
const STEPS = [0.3, 0.4, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 2]

let vp, board, edges, level

// x and y are how far the board has already slid away, in screen px.
let view = { x: 0, y: 0, z: 1 }

// Measurements kept aside: reading them on every frame would cost a layout recalculation exactly
// while we are writing the transform. They are retaken only when the content or the window really
// change, which is to say in refit().
let box = { left: 0, top: 0, right: 0, bottom: 0, w: 0, h: 0 }
let contentW = 0
let contentH = 0

let px = 0
let py = 0
let inside = false // the pointer is inside the view (and not over the zoom controls)
let held = false // a button is down: the board stands still, the click has to land
let frame = 0 // the requestAnimationFrame handle, 0 = stopped
let last = 0

// ── Limits and drawing ────────────────────────────────────────────────
const maxX = () => contentW * view.z - box.w
const maxY = () => contentH * view.z - box.h

/**
 * Keeps the view inside the board, and decides what to do with the space left over when the
 * board is smaller than the window.
 *
 * The two axes are not treated the same, and that is the point. Sideways, a board narrower than
 * the window is centred: with nothing anchoring the columns left or right, centred reads as
 * deliberate. Downwards it is pinned to the top instead, because the columns hang from the top —
 * they are different heights and they all start at the same line. Centring that vertically
 * splits the leftover space above and below, and the gap above pushes every column away from the
 * bar: it looks like a margin somebody forgot to remove, on exactly the screens where the board
 * happens to fit.
 */
function clamp() {
  const mx = maxX()
  const my = maxY()
  view.x = mx > 0 ? Math.min(Math.max(view.x, 0), mx) : mx / 2
  view.y = my > 0 ? Math.min(Math.max(view.y, 0), my) : 0
}

function apply() {
  board.style.transform = `translate(${-view.x}px, ${-view.y}px) scale(${view.z})`
  const mx = maxX()
  const my = maxY()
  edges.classList.toggle('can-l', view.x > 1)
  edges.classList.toggle('can-r', view.x < mx - 1)
  edges.classList.toggle('can-t', view.y > 1)
  edges.classList.toggle('can-b', view.y < my - 1)
  level.textContent = `${Math.round(view.z * 100)}%`
  save()
}

function measure() {
  const r = vp.getBoundingClientRect()
  box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height }
  // offsetWidth/offsetHeight are the layout measurements: the transform does not touch them.
  contentW = board.offsetWidth
  contentH = board.offsetHeight
}

// Writing on every frame would be sixty writes a second for nothing: where you are is noted
// when you stop.
let saveTimer
function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => localStorage.setItem('k0-view', JSON.stringify(view)), 400)
}

function load() {
  try {
    const v = JSON.parse(localStorage.getItem('k0-view') || '{}')
    for (const k of ['x', 'y', 'z']) if (Number.isFinite(v[k])) view[k] = v[k]
    view.z = Math.min(STEPS[STEPS.length - 1], Math.max(STEPS[0], view.z))
  } catch {
    /* an old view that cannot be read: start again from the top left corner */
  }
}

// ── Edge scrolling ────────────────────────────────────────────────────
/**
 * How much and which way to move, right now. The ramp is quadratic: entering the band it starts
 * slowly, right at the edge it goes at full speed. Diagonals and corners come out by themselves,
 * because there neither component is zero.
 */
function velocity() {
  if (held || !inside || document.querySelector('dialog[open]')) return [0, 0]
  const ramp = (d) => {
    const t = 1 - d / EDGE
    return t > 0 ? t * t : 0
  }
  return [
    (ramp(box.right - px) - ramp(px - box.left)) * SPEED,
    (ramp(box.bottom - py) - ramp(py - box.top)) * SPEED,
  ]
}

function step(t) {
  const [vx, vy] = velocity()
  if (!vx && !vy) return (frame = 0)
  if (!last) {
    // First frame: how much time has passed is not known yet, so it only looks.
    last = t
    frame = requestAnimationFrame(step)
    return
  }
  const dt = Math.min((t - last) / 1000, 0.05) // a frozen frame must not become a jump
  last = t
  if (dt > 0) {
    const x0 = view.x
    const y0 = view.y
    view.x += vx * dt
    view.y += vy * dt
    clamp()
    if (view.x === x0 && view.y === y0) return (frame = 0) // a wall: this side is finished
    apply()
  }
  frame = requestAnimationFrame(step)
}

/** The loop only runs while it is needed: with the board still, nothing is in motion. */
function wake() {
  if (frame) return
  last = 0
  frame = requestAnimationFrame(step)
}

// ── Zoom ──────────────────────────────────────────────────────────────
/** Changes scale while holding still the point of the board under (sx, sy). */
function zoomTo(z, sx, sy) {
  z = Math.min(STEPS[STEPS.length - 1], Math.max(STEPS[0], z))
  const cx = (view.x + sx) / view.z
  const cy = (view.y + sy) / view.z
  view.z = z
  view.x = cx * z - sx
  view.y = cy * z - sy
  clamp()
  apply()
}

/** With + and − it jumps one step, holding the centre of the view still. */
function nudge(dir) {
  const i = STEPS.findIndex((s) => Math.abs(s - view.z) < 1e-6)
  const next =
    i >= 0
      ? STEPS[Math.min(STEPS.length - 1, Math.max(0, i + dir))]
      : dir > 0
        ? (STEPS.find((s) => s > view.z) ?? STEPS[STEPS.length - 1])
        : ([...STEPS].reverse().find((s) => s < view.z) ?? STEPS[0])
  zoomTo(next, box.w / 2, box.h / 2)
}

/** Shrinks just enough to fit the whole board in. */
function fit() {
  if (!contentW || !contentH) return
  zoomTo(Math.min(1, box.w / contentW, box.h / contentH), box.w / 2, box.h / 2)
}

// ── Wiring ────────────────────────────────────────────────────────────
/** The content changed: remeasure, come back inside the limits, and redraw. */
export function refit() {
  if (!vp) return
  measure()
  clamp()
  apply()
  wake() // the board has grown: there may now be somewhere to go on this side
}

export function initView() {
  vp = $('#viewport')
  board = $('#board')
  edges = $('#edges')
  level = $('#z-level')

  load()
  measure()
  clamp()
  apply()

  document.addEventListener('pointermove', (e) => {
    px = e.clientX
    py = e.clientY
    inside =
      px >= box.left &&
      px <= box.right &&
      py >= box.top &&
      py <= box.bottom &&
      !(e.target instanceof Element && e.target.closest('#zoom'))
    wake()
  })
  // Outside the page, or with a button held, the board stands still: that way a click near the
  // edge lands instead of chasing a card that is running away. A pointer that has left the window
  // stops reporting, and without this the last report would stand — "I am at the edge" — and the
  // board would scroll forever on its own.
  document.documentElement.addEventListener('pointerleave', () => (inside = false))
  document.addEventListener('pointerdown', () => (held = true))
  document.addEventListener('pointerup', () => {
    held = false
    wake()
  })
  document.addEventListener('pointercancel', () => (held = false))
  addEventListener('blur', () => {
    inside = false
    held = false
  })

  // Two fingers on the trackpad move the view; a pinch (which arrives as a wheel event with ctrl
  // held) zooms under the pointer.
  vp.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const k = e.deltaMode === 1 ? 16 : 1 // some mice count lines, not pixels
      if (e.ctrlKey) {
        zoomTo(view.z * Math.exp((-e.deltaY * k) / 240), e.clientX - box.left, e.clientY - box.top)
      } else {
        view.x += e.deltaX * k
        view.y += e.deltaY * k
        clamp()
        apply()
      }
    },
    { passive: false }
  )

  $('#z-out').onclick = () => nudge(-1)
  $('#z-in').onclick = () => nudge(1)
  $('#z-level').onclick = () => zoomTo(1, box.w / 2, box.h / 2)
  $('#z-fit').onclick = () => fit()

  addEventListener('resize', refit)
  // Caveat is a web font: once it has loaded, the columns change size.
  document.fonts?.ready.then(refit)
}
