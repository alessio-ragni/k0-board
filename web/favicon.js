// ── The icon in the browser tab ───────────────────────────────────────────────
// The same as the one in the menu bar: a small rounded square like a sticky note, tinted with
// the most urgent status. With nothing going on, only the outline is left.
//
// The measurements come from `icon()` in menubar/K0MenuBar.swift: side 14, one point of margin,
// radius 2.5, outline 1.5. Here they are scaled to 32.
//
// The colours are its colours, not the board's: in a menu bar pastels disappear, and a browser
// tab is just as small. If you change a colour over there, change it here too — they are the
// two faces of the same icon.
const COLOR = {
  ASK: '#f04545',
  PLANNED: '#fa7317',
  IDLE: '#ebb308',
  WORKING: '#3b82f5',
  PLANNING: '#3b82f5',
}
const QUIET = '#9ca3b0'

/** The drawing, for a status or for nothing at all. A pure function: it can be tested. */
export function icon(state) {
  const body = COLOR[state]
    ? `<rect x="2.3" y="2.3" width="27.4" height="27.4" rx="5.7" fill="${COLOR[state]}"/>`
    : `<rect x="4" y="4" width="24" height="24" rx="5.7" fill="none" stroke="${QUIET}" stroke-width="3.4"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>`
}

let last
/** Changes the icon only when it really changes: this runs once a second. */
export function setFavicon(state) {
  if (state === last) return
  last = state
  let link = document.querySelector('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.append(link)
  }
  link.type = 'image/svg+xml'
  link.href = `data:image/svg+xml,${encodeURIComponent(icon(state))}`
}
