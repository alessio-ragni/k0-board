// ── k0-links: what Claude names, as links ─────────────────────────────────────
// A mod: Claude Code runs these hooks inside every session, k0 or not. They do something only
// while k0 is running on this machine, and they ask nothing of the outside world — every request
// goes to k0 on the loopback address, which is the board's own server.
//
// - A file a reply names becomes a link to k0's file viewer, when k0 knows the repository the
//   session is in and the file is something the viewer can show.
// - An artifact the session published becomes a link to its claude.ai page wherever the reply
//   says its title.
// - What the last reply pointed at stays in a row just above the prompt, and the hint line under
//   the prompt says how many there are.
//
// The drawing never waits on the network: the hooks that draw read what is already known, and
// k0 is asked once at the start of the session and once at the end of each turn.

import { candidates, viewerUrl, artifactUrl, titleOf, linkify, referencesIn } from './links.js'

/** Names collected while drawing, to be asked about at the end of the turn. A bound, not a goal. */
const MAX_PENDING = 200
/** A title this short is a word, and would turn every use of that word into a link. */
const MIN_TITLE = 4

let port = 4319
let root = null
// `off` while k0 is not answering; `artifacts` when it answers but does not know this folder, so
// there is no viewer to send a file to; `files` when both work.
let mode = 'off'
const files = new Map() // how a reply spells a file → its address in the viewer
const pending = new Map() // spelling → path inside the repository, not asked about yet
const artifacts = new Map() // title → claude.ai address
let refs = [] // what the last reply pointed at: { label, url }

/** @type {import('claude-code').Register} */
export const register = (on) => {
  on('session.start', async ($, e, next) => {
    const set = await $.env.get('K0_PORT')
    if (set && /^\d+$/.test(set)) port = Number(set)
    root = await topLevel($, e.cwd)
    void refresh($, '')
    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    if (refs.length) {
      refs = []
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('tool.call', { tool: 'Artifact' }, async ($, e, next) => {
    const ran = await next(e)
    try {
      await remember($, e, ran)
    } catch {
      // An artifact that could not be read back stays text, as it was before this mod.
    }
    return ran
  })

  on('turn.complete', ($, e, next) => {
    if (!e.agentId) void refresh($, e.answer)
    return next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    if (mode === 'off') return next(e)
    const text = e.props.text
    if (mode === 'files') {
      for (const { written, rel } of candidates(text, root)) {
        if (!files.has(written) && pending.size < MAX_PENDING) pending.set(written, rel)
      }
    }
    const out = linkify(text, new Map([...files, ...artifacts]))
    return out === text ? next(e) : next({ ...e, props: { ...e.props, text: out } })
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (mode === 'off' || !refs.length || e.props.hasSurvey) return next(e)
    const { Box, Text, Link } = $.ui.resolve(e)
    const parts = [h(Text, { dimColor: true }, '↗ ')]
    refs.forEach((r, i) => {
      if (i) parts.push('   ')
      parts.push(h(Link, { href: r.url }, r.label))
    })
    return h(Box, { flexWrap: 'wrap' }, h(Text, null, ...parts))
  })

  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    if (mode === 'off' || !refs.length) return next(e)
    const n = refs.length
    return next({ ...e, props: { ...e.props, tail: `· ${n} ${n === 1 ? 'reference' : 'references'} ↑` } })
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

/** Asks k0 which of `paths` are real files in this repository. Null when k0 is not answering. */
async function exist($, paths) {
  try {
    const r = await $.http.fetch(`http://localhost:${port}/api/files/exist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repo: root, paths }),
    })
    if (r.ok) return { known: true, paths: JSON.parse(r.text).paths ?? [] }
    // k0's own refusal for a folder it has never opened a session in — anything else on this port
    // is not k0, and is treated as k0 not running.
    if (r.status === 400 && /repository/i.test(r.text)) return { known: false, paths: [] }
  } catch {
    // Nobody listening: k0 is off.
  }
  return null
}

/** Where k0 stands now, then what the reply pointed at. Redraws once, at the end. */
async function refresh($, answer) {
  const asked = [...pending]
  pending.clear()
  // Every name in this answer gets asked about, drawn or not: a reply that ends the turn may not
  // have been drawn again since its last words arrived.
  for (const { written, rel } of candidates(answer, root)) {
    if (!files.has(written) && !asked.some(([w]) => w === written)) asked.push([written, rel])
  }
  const batch = asked.slice(0, 60)
  const got = await exist($, batch.map(([, rel]) => rel))
  mode = !got ? 'off' : got.known ? 'files' : 'artifacts'
  if (got?.known) {
    const real = new Set(got.paths)
    for (const [written, rel] of batch) if (real.has(rel)) files.set(written, viewerUrl(port, root, rel))
  }
  refs = mode === 'off' ? [] : referencesIn(answer, files, artifacts)
  $.ui.invalidate('ui.render')
}

/** A published artifact, kept under its title so the reply that mentions it can link it. */
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
