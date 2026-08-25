// ── Numbers as people read them ───────────────────────────────────────────────
// The measurements are written in one place, like the title rule in title.js: both pages use
// them, and one of them does so at a point where the shape of the number decides when to
// redraw.

const MB = 1048576
const GB = 1073741824

/**
 * What a session weighs, rounded in steps: tens of MB below a gigabyte, tenths of a GB above.
 *
 * The rounding is not decoration. It is the rounded number — the one you read on the card —
 * that goes into the signature of the refresh round: that way the board only redraws when the
 * figure on screen really changes, instead of on every sample, throwing away the pointer and
 * the buttons that appear under it.
 */
export function weight(bytes) {
  const mb = bytes / MB
  if (mb >= 1000) return `${(Math.round(mb / 100) / 10).toFixed(1)} GB`
  const step = Math.round(mb / 10) * 10
  return `${step || Math.round(mb)} MB`
}

/** A file's exact size: there is nothing to round in steps here. */
export function bytes(n) {
  if (n < 1024) return `${n} B`
  if (n < MB) return `${Math.round(n / 1024)} KB`
  if (n < GB) return `${(n / MB).toFixed(1)} MB`
  return `${(n / GB).toFixed(1)} GB`
}

/** Round gigabytes, for the machine's own numbers. */
export const gb = (n) => `${(n / GB).toFixed(1)} GB`
