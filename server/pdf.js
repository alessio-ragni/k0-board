import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CACHE_DIR } from './paths.js'
import { shell } from '../platform/index.js'

// ── The document on paper ─────────────────────────────────────────────────────
// The PDF is made by the browser, because the page has to come out the same as what you see:
// same layout engine, same print CSS, same fonts. Writing one here would mean a large
// dependency and a worse result.
//
// So a headless Chrome is opened on the viewer's page and asked to print it to a file. The
// difference from ⌘P is that here we decide the margins and what the browser adds:
// `--no-pdf-header-footer` removes the date, the address and the page number, and the margin
// is the one in the CSS `@page`. From the print dialog, whatever the user picked in there wins.
//
// Two things learned by trying it, which explain the code below:
//   1. Chrome writes the PDF and THEN stays up. It does not exit on its own: it has to be
//      stopped as soon as it is done, or every download leaves a process hanging around.
//   2. Two Chromes on the same profile directory wait for each other forever. So requests are
//      served one at a time, in a queue.

/** The browser that prints, or nothing. Printing and downloading the raw file do not use it. */
export const browser = () => shell.findChrome()

// A profile of its own, kept aside: without one, Chrome would attach to the user's real
// profile. Keeping it between runs saves a few seconds.
const PROFILE = path.join(CACHE_DIR, 'chrome')

const TIMEOUT = 30000 // past this, something went wrong and nobody is waiting any more
/** How Chrome says it has finished, on its error channel. */
const DONE = /bytes written to file/i

/** The queue: one print at a time, so two Chromes never fight over the same profile. */
let queue = Promise.resolve()

/**
 * The page at `url`, printed, as the bytes of a PDF.
 * Any address this server can serve will do.
 */
export function render(url) {
  const mine = queue.then(
    () => once(url),
    () => once(url)
  )
  // The queue must never break: if one print goes wrong, the next one still starts.
  queue = mine.catch(() => {})
  return mine
}

function once(url) {
  const bin = browser()
  if (!bin) throw new Error('Install Google Chrome or Chromium to download PDFs')

  const out = path.join(os.tmpdir(), `k0-${process.pid}-${Date.now()}.pdf`)
  fs.mkdirSync(PROFILE, { recursive: true })

  const child = spawn(bin, [
    '--headless',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-extensions',
    '--no-pdf-header-footer',
    // The document arrives after the page has loaded, and without this Chrome would print the
    // blank sheet from before. It is not a real wait: Chrome runs the clock itself and stops
    // as soon as nothing more is coming.
    '--virtual-time-budget=8000',
    `--user-data-dir=${PROFILE}`,
    `--print-to-pdf=${out}`,
    url,
  ])

  return new Promise((resolve, reject) => {
    let over = false
    const end = (err, buf) => {
      if (over) return
      over = true
      clearTimeout(timer)
      child.kill('SIGKILL')
      try {
        fs.unlinkSync(out)
      } catch {} // if it was never written there is nothing to remove
      err ? reject(err) : resolve(buf)
    }

    const timer = setTimeout(() => end(new Error('The PDF took too long')), TIMEOUT)

    // The signal that it is finished comes from here, not from the process exiting: Chrome
    // writes the file and then stays up, and waiting for it to close would mean waiting forever.
    let log = ''
    child.stderr.on('data', (c) => {
      log = (log + c).slice(-4000)
      if (!DONE.test(log)) return
      try {
        end(null, fs.readFileSync(out))
      } catch (e) {
        end(e)
      }
    })

    child.on('error', (e) => end(new Error(`The browser did not start: ${e.message}`)))
    // If instead it exits before having written anything, there is no PDF: better to say so
    // now than to sit still until the time runs out.
    child.on('exit', () => setTimeout(() => end(new Error('The PDF did not come out')), 200))
  })
}
