// ── Arrows on the board ───────────────────────────────────────────────
// The half of the arrows that needs a page: the layer they are drawn on, the pointer that draws a
// new one, and the two words that appear when one is clicked. What an arrow *is* lives in
// arrows.js; nothing in here decides anything, it draws what that file says.
//
// The layer is an <svg> inside `#board`, so it slides and zooms with the notes for nothing. The
// board is emptied and rebuilt on every change, and the layer goes with it: `drawArrows` is called
// at the end of every render and puts it back, with whatever was showing still showing.

import { chain, dropOf, edgesFrom, hitsLoop, route, within } from '/arrows.js'

const NS = 'http://www.w3.org/2000/svg'
const $ = (s) => document.querySelector(s)

let edges = []
let hovered = null // the note under the pointer, if it has arrows
let pinned = null // the note whose arrows were asked to stay
let hideTimer = 0
let drag = null // { from, x0, y0, x, y, live, target }
let frame = 0
let hooks = { api: null, toast: () => {}, redraw: () => {}, newFrom: () => {} }

const board = () => $('#board')
const note = (id) => board().querySelector(`.postit[data-id="${id}"]`)

/** True while an arrow is in the air: the board must not be rebuilt under it. */
export const linking = () => !!drag?.live

// ── Where things are ──────────────────────────────────────────────────
/** How much the board is zoomed, read off the board itself rather than asked of view.js. */
function scale() {
  const b = board()
  return b.offsetWidth ? b.getBoundingClientRect().width / b.offsetWidth : 1
}

/** A point of the screen, in the board's own coordinates — the ones the layer is drawn in. */
function point(cx, cy) {
  const r = board().getBoundingClientRect()
  const z = scale()
  return { x: (cx - r.left) / z, y: (cy - r.top) / z }
}

function rect(el) {
  const r = el.getBoundingClientRect()
  const z = scale()
  const p = point(r.left, r.top)
  return { x: p.x, y: p.y, w: r.width / z, h: r.height / z }
}

// ── The layer ─────────────────────────────────────────────────────────
function layer() {
  let svg = $('#arrows')
  if (svg) return svg
  svg = document.createElementNS(NS, 'svg')
  svg.id = 'arrows'
  svg.innerHTML = `<defs>
    <marker id="arrow-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path class="head" d="M0 0L10 5L0 10z"/>
    </marker></defs>`
  board().append(svg)
  return svg
}

function path(cls, d, data = {}) {
  const p = document.createElementNS(NS, 'path')
  p.setAttribute('class', cls)
  p.setAttribute('d', d)
  for (const [k, v] of Object.entries(data)) p.dataset[k] = v
  return p
}

/** Draws the arrows of the chain that is showing, and nothing when none is. */
function paint() {
  const b = board()
  if (!b || b.classList.contains('list')) return
  const svg = layer()
  for (const p of svg.querySelectorAll('path.arrow, path.hit')) p.remove()
  for (const el of b.querySelectorAll('.postit.linked')) el.classList.remove('linked')

  const shown = pinned ?? hovered
  if (shown == null) return
  const ids = chain(shown, edges)
  for (const e of within(ids, edges)) {
    const from = note(e.from)
    const to = note(e.to)
    // An arrow is there when both its notes are: a finished story that is filtered away takes
    // its arrows off the board with it.
    if (!from || !to) continue
    from.classList.add('linked')
    to.classList.add('linked')
    const d = route(rect(from), rect(to))
    svg.append(path(`arrow${e.faded ? ' faded' : ''}`, d))
    // What is clicked is not the line, which is two pixels wide: it is a wide invisible twin.
    svg.append(path('hit', d, { from: e.from, to: e.to }))
  }
}

/** Called at the end of every render: the layer was thrown away with the board. */
export function drawArrows(stories) {
  edges = edgesFrom(stories)
  if (pinned != null && !note(pinned)) pinned = null
  if (hovered != null && !note(hovered)) hovered = null
  paint()
}

/** A note has opened or closed and the ones under it have moved: the arrows follow them. */
export const repaintArrows = () => paint()

/** The arrows on the board right now, for whoever has to count them. */
export const currentEdges = () => edges

// ── Showing and hiding ────────────────────────────────────────────────
const tied = (id) => edges.some((e) => e.from === id || e.to === id)

function show(id) {
  clearTimeout(hideTimer)
  if (hovered === id) return
  hovered = id
  paint()
}

/** Not at once: the pointer has to be able to leave the note and reach one of its arrows. */
function hideSoon() {
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    if ($('#arrow-menu')) return
    hovered = null
    paint()
  }, 320)
}

// ── Drawing a new one ─────────────────────────────────────────────────
// The places in a repository's header that mean "a new story here": the `+` and the name, on an open
// column and on the rows of the two folded columns on the right. Whatever is lit is the whole header
// or the whole row, the element that carries the repository's path.
const REPO_SPOT = '.column > h2 .add, .column > h2 .name, .repo .add, .repo .name'

/** What is under the pointer: `{ el, drop }`, the element to light up and what letting go means. */
function under(x, y) {
  const hit = document.elementFromPoint(x, y)
  const card = hit?.closest?.('.postit')
  const zone = card ? null : hit?.closest?.(REPO_SPOT)?.closest('[data-p]')
  const drop = dropOf({ note: card ? Number(card.dataset.id) : null, repo: zone?.dataset.p }, drag.from)
  return drop ? { el: card ?? zone, drop } : null
}

function follow() {
  frame = 0
  if (!drag?.live) return
  const svg = layer()
  svg.querySelector('path.draft')?.remove()
  for (const el of board().querySelectorAll('.link-target, .link-refused')) {
    el.classList.remove('link-target', 'link-refused')
  }
  const from = note(drag.from)
  if (!from) return
  const target = under(drag.x, drag.y)
  drag.target = target?.drop ?? null
  // A story that does not exist yet waits on nothing, so an arrow to one can never close a loop.
  const refused = target?.drop.kind === 'link' && hitsLoop(drag.from, target.drop.to, edges)
  if (target) target.el.classList.add(refused ? 'link-refused' : 'link-target')
  svg.append(path('arrow draft', route(rect(from), target ? rect(target.el) : point(drag.x, drag.y))))
  // The board slides under a pointer that is standing still near an edge, so the arrow has to be
  // redrawn on every frame and not only when the pointer reports a move.
  frame = requestAnimationFrame(follow)
}

function endDrag() {
  cancelAnimationFrame(frame)
  frame = 0
  board().classList.remove('linking')
  $('#arrows')?.querySelector('path.draft')?.remove()
  for (const el of board().querySelectorAll('.link-target, .link-refused')) {
    el.classList.remove('link-target', 'link-refused')
  }
  drag = null
}

async function send(body, failed) {
  try {
    await hooks.api('/api/backlog/dependency', { method: 'POST', body: JSON.stringify(body) })
  } catch (e) {
    hooks.toast(`${failed}: ${e.message}`, 8000)
  }
  hooks.redraw()
}

function onDown(e) {
  const btn = e.target.closest?.('.postit .tie')
  if (!btn || e.button !== 0) return
  e.preventDefault() // no text selection, no native drag, while the arrow is in the air
  const from = Number(btn.closest('.postit').dataset.id)
  drag = { from, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, live: false, target: null }
}

function onMove(e) {
  if (!drag) return
  drag.x = e.clientX
  drag.y = e.clientY
  if (!drag.live && Math.hypot(drag.x - drag.x0, drag.y - drag.y0) > 4) {
    drag.live = true
    pinned = null
    hovered = null
    paint()
    // view.js reads this class: with it on, a held button no longer stops the board sliding
    // when the pointer nears an edge, which is the only way to reach a note that is off screen.
    board().classList.add('linking')
  }
  if (drag.live && !frame) frame = requestAnimationFrame(follow)
}

function onUp() {
  if (!drag) return
  const { from, live, x, y } = drag
  const drop = live ? under(x, y)?.drop : null
  endDrag()
  if (!live) {
    // A plain click: the arrows of this note stay up until something else is clicked.
    pinned = pinned === from ? null : from
    paint()
    return
  }
  if (!drop) return hooks.redraw()
  pinned = from
  // Onto a repository: the story the arrow points at is written first, in the same dialog the `+`
  // opens, and the arrow is drawn when it is saved. Closing the dialog leaves neither behind.
  if (drop.kind === 'new') {
    hooks.newFrom(from, drop.path)
    return hooks.redraw()
  }
  send({ story_id: from, depends_on: drop.to }, "Couldn't draw the arrow")
}

// ── The two words on an arrow ─────────────────────────────────────────
function closeMenu() {
  $('#arrow-menu')?.remove()
}

function openMenu(hit, x, y) {
  closeMenu()
  const from = Number(hit.dataset.from)
  const to = Number(hit.dataset.to)
  const menu = document.createElement('div')
  menu.id = 'arrow-menu'
  menu.innerHTML = `<button type="button" data-do="flip" title="Turn the arrow round: the one that waited is now waited for">Flip</button>
    <button type="button" data-do="remove" title="Take the arrow away">Remove</button>`
  menu.style.left = `${x}px`
  menu.style.top = `${y}px`
  menu.onclick = (e) => {
    const what = e.target.closest('button')?.dataset.do
    if (!what) return
    closeMenu()
    const body = { story_id: from, depends_on: to, [what]: true }
    send(body, what === 'flip' ? "Couldn't turn it round" : "Couldn't remove it")
  }
  document.body.append(menu)
}

// ── Wiring ────────────────────────────────────────────────────────────
export function initArrows(given) {
  hooks = { ...hooks, ...given }
  const b = board()

  b.addEventListener('pointerover', (e) => {
    if (drag?.live) return
    if (e.target.closest?.('path.hit')) return clearTimeout(hideTimer)
    const el = e.target.closest?.('.postit')
    if (!el) return
    const id = Number(el.dataset.id)
    if (tied(id)) show(id)
  })
  b.addEventListener('pointerout', (e) => {
    if (!e.target.closest?.('.postit, path.hit')) return
    if (e.relatedTarget?.closest?.('.postit, path.hit') === e.target.closest('.postit, path.hit')) return
    hideSoon()
  })

  b.addEventListener('pointerdown', onDown)
  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', onUp)
  document.addEventListener('pointercancel', () => drag && endDrag())

  document.addEventListener('click', (e) => {
    const hit = e.target.closest?.('path.hit')
    if (hit) return openMenu(hit, e.clientX, e.clientY)
    if (e.target.closest?.('#arrow-menu, .postit .tie')) return
    closeMenu()
    if (pinned != null) {
      pinned = null
      paint()
    }
  })
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    if (drag) endDrag()
    closeMenu()
    if (pinned != null) {
      pinned = null
      paint()
    }
  })
  // The notes are where they are only until the window or the font changes.
  addEventListener('resize', paint)
}
