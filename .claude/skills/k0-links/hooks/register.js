// ── k0-links: what the last reply pointed at, one click away ──────────────────
// A mod: Claude Code runs these hooks inside every session, k0 or not. They do something only
// while k0 is running on this machine.
//
// At the end of each reply it reads what the reply pointed at — addresses, folders, documents,
// the artifacts this session published — and puts them in a row just above the prompt. One plain
// click on an entry opens it: an address in the browser, a folder in Finder, a document in k0's
// viewer, an artifact on its claude.ai page.
//
// The reply itself is left exactly as Claude Code draws it. The macOS Terminal cannot open a link
// drawn inside the text, and redrawing Claude's replies to work around that was the wrong price:
// the row is the mod's own space, and its entries are buttons, which the terminal does not have
// to understand — Claude Code receives the click itself (in its fullscreen mode) and the mod opens
// the target with the system's own `open`.

import {
  DOC,
  MAX_REFS,
  references,
  webUrl,
  absolute,
  inside,
  extOf,
  viewerUrl,
  artifactUrl,
  titleOf,
  artifactsIn,
} from './links.js'

/** A title this short is a word, and would be found in every other reply. */
const MIN_TITLE = 4
/** What each kind of entry looks like in the row: the place it opens in, at a glance. */
const ICON = { web: '🌐', folder: '📁', doc: '📄', artifact: '✦' }

let port = 4319
let root = null
let home = null
let on = false // whether k0 answered the last time it was asked
const artifacts = new Map() // title → claude.ai address
let refs = [] // what the last reply pointed at: { icon, label, target }

/** @type {import('claude-code').Register} */
export const register = (hook) => {
  hook('session.start', async ($, e, next) => {
    const set = await $.env.get('K0_PORT')
    if (set && /^\d+$/.test(set)) port = Number(set)
    home = (await $.env.get('HOME')) ?? null
    root = await topLevel($, e.cwd)
    return next(e)
  })

  hook('prompt.submit', ($, e, next) => {
    if (refs.length) {
      refs = []
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  hook('tool.call', { tool: 'Artifact' }, async ($, e, next) => {
    const ran = await next(e)
    try {
      await remember($, e, ran)
    } catch {
      // An artifact that could not be read back is simply not in the row.
    }
    return ran
  })

  hook('turn.complete', ($, e, next) => {
    if (!e.agentId) void refresh($, e.answer)
    return next(e)
  })

  hook('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (!on || !refs.length || e.props.hasSurvey) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    return h(
      Box,
      { flexWrap: 'wrap', columnGap: 3 },
      ...refs.map((r, i) =>
        h(Button, {
          key: `ref-${i}`,
          label: `${r.icon} ${r.label}`,
          plain: true,
          onPress: () => void launch($, r.target),
        })
      )
    )
  })
}

/** The repository the session is in, as k0 knows it: git's top level, else the folder itself. */
async function topLevel($, cwd) {
  try {
    const { exitCode, stdout } = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd })
    if (exitCode === 0 && stdout.trim()) return stdout.trim()
  } catch {
    // No git on this machine: the folder is the best guess there is.
  }
  return cwd
}

/**
 * Asks k0 which of `paths` are documents its viewer has in this repository. Null when k0 is not
 * answering; `known: false` when it answers but has never seen this folder.
 */
async function exist($, paths) {
  try {
    const r = await $.http.fetch(`http://localhost:${port}/api/files/exist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repo: root, paths }),
    })
    if (r.ok) return { known: true, paths: new Set(JSON.parse(r.text).paths ?? []) }
    // k0's own refusal for a folder it has never opened a session in — anything else on this port
    // is not k0, and is treated as k0 not running.
    if (r.status === 400 && /repository/i.test(r.text)) return { known: false, paths: new Set() }
  } catch {
    // Nobody listening: k0 is off.
  }
  return null
}

/** What a folder or file on disk is, or null when there is nothing there. */
async function kindOf($, abs) {
  try {
    return (await $.fs.stat(abs)).kind
  } catch {
    return null
  }
}

/** Reads the reply that just ended, and redraws the row once, at the end. */
async function refresh($, answer) {
  const found = references(answer)
  const docs = []
  const out = []
  for (const r of found) {
    if (r.kind === 'web') {
      out.push({ icon: ICON.web, label: r.written, target: webUrl(r.written) })
      continue
    }
    const abs = absolute(r.written, root, home)
    if (!abs) continue
    const kind = await kindOf($, abs)
    // An address written without its scheme, the domain on disk nowhere: still an address.
    if (!kind && /^(?:[a-z0-9-]+\.)+[a-z]{2,}\//i.test(r.written)) {
      out.push({ icon: ICON.web, label: r.written, target: webUrl(r.written) })
    } else if (kind === 'dir') {
      out.push({ icon: ICON.folder, label: r.written, target: abs })
    } else if (kind === 'file' && DOC.has(extOf(abs))) {
      const rel = inside(abs, root)
      if (rel) {
        const entry = { icon: ICON.doc, label: r.written, target: null, rel }
        docs.push(entry)
        out.push(entry)
      }
    }
    // Code and every other file: not a place to go, it stays out of the row.
  }

  const got = await exist($, docs.map((d) => d.rel))
  on = Boolean(got)
  for (const d of docs) if (got?.known && got.paths.has(d.rel)) d.target = viewerUrl(port, root, d.rel)

  const mentioned = artifactsIn(answer, artifacts).map((a) => ({ icon: ICON.artifact, label: a.title, target: a.url }))
  const seen = new Set()
  refs = [...out.filter((r) => r.target), ...mentioned]
    .filter((r) => !seen.has(r.target) && seen.add(r.target))
    .slice(0, MAX_REFS)
  $.ui.invalidate('ui.render')
}

/** Opens a target the way the system opens it: a browser tab, a Finder window. */
async function launch($, target) {
  for (const argv of [['open', target], ['xdg-open', target]]) {
    try {
      const { exitCode } = await $.process.run(argv)
      if (exitCode === 0) return
    } catch {
      // Not this system's opener: try the next one.
    }
  }
  $.ui.toast(`Could not open ${target}`)
}

/** A published artifact, kept under its title so the reply that mentions it can list it. */
async function remember($, e, ran) {
  if (ran.deny !== undefined || ran.isError) return
  if ((e.action ?? 'publish') !== 'publish' || e.asset) return
  const url = artifactUrl(ran.text) ?? artifactUrl(e.url)
  if (!url) return
  let title = null
  if (typeof e.file_path === 'string' && /\.html?$/i.test(e.file_path)) {
    title = titleOf(await $.fs.read(e.file_path))
  }
  title ??= e.title ?? null
  if (!title && typeof e.file_path === 'string') title = e.file_path.split('/').pop().replace(/\.[^.]+$/, '')
  if (!title || title.length < MIN_TITLE) return
  // A redeploy can rename the page: the address keeps one title, the newest.
  for (const [t, u] of artifacts) if (u === url) artifacts.delete(t)
  artifacts.set(title, url)
}
