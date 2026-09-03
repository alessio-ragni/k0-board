#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { bold, dim, say, step, ok, warn, fail, note, confirm } from './prompt.js'

/**
 * k0's command line.
 *
 * It replaces what used to be a shell script, for one reason: it has to run on Windows too, and
 * bash does not. Everything platform-specific it needs — how to register a service, how to keep
 * the machine awake, what a terminal even is — comes from the adapters under platform/, so this
 * file is the same three hundred lines on every operating system.
 *
 * The order of the installation is deliberate and is the whole point of the file:
 *
 *   1. say what is about to change, in full, before changing anything;
 *   2. ask;
 *   3. only then act.
 *
 * A tool that writes to /etc/sudoers.d and rewrites your terminal preferences has no business
 * being installed by a single unexplained "y". Everything below can be undone with `uninstall`.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SOURCE = path.dirname(HERE)

const args = process.argv.slice(2)
const command = args.find((a) => !a.startsWith('-')) || 'install'
const flag = (name) => args.includes(`--${name}`)

const PORT = Number(process.env.K0_PORT || 4319)

// ── Node itself ──────────────────────────────────────────────────────────────
// k0 stores the board in SQLite through `node:sqlite`, which is built into Node and needs a
// recent one. Saying so here, in a sentence, is better than the stack trace the import would
// otherwise produce three files later.
const MIN_NODE = 24
if (Number(process.versions.node.split('.')[0]) < MIN_NODE) {
  console.error(
    `k0 needs Node ${MIN_NODE} or newer (this is ${process.versions.node}).\n` +
      'It uses the SQLite support built into Node, which older versions do not have.'
  )
  process.exit(1)
}

const { name: platformName, capabilities, notes, service, extras, shell } = await import('../platform/index.js')
const paths = await import('../server/paths.js')
const settings = await import('../server/settings.js')

const APP_DIR = flag('from-source') ? SOURCE : paths.APP_DIR
const ENTRY = path.join(APP_DIR, 'server', 'index.js')

// ── Copying the app into place ───────────────────────────────────────────────
/**
 * Why the app is copied at all: `npx` unpacks into a cache directory npm is free to wipe, and a
 * service pointing at it would break the first time that happened. `--from-source` skips the
 * copy and points the service at this checkout instead, which is what you want when you are
 * working on k0 itself.
 */
// `.claude` travels: the import skill lives in it, and it is what makes /k0-import work for
// anybody who cloned the repository. `worktrees` does not: those are working copies.
const SKIP = new Set(['node_modules', '.git', '.github', 'test', 'docs', 'worktrees'])

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith('k0.db')) continue
    const src = path.join(from, entry.name)
    const dst = path.join(to, entry.name)
    if (entry.isDirectory()) copyTree(src, dst)
    else if (entry.isFile()) fs.copyFileSync(src, dst)
  }
}

// ── The tray icon ────────────────────────────────────────────────────────────
/**
 * The three trays are three different things — a compiled Swift app, a Python script, a
 * PowerShell script — and only the first one has to be built. Where the build cannot happen,
 * that is a missing icon and nothing more: the board and the server do not need it.
 */
function buildTray() {
  if (process.platform === 'darwin') {
    const script = path.join(APP_DIR, 'menubar', 'build.sh')
    if (!fs.existsSync(script)) return null
    try {
      execFileSync('/bin/bash', [script], { stdio: 'inherit' })
      return path.join(APP_DIR, 'menubar', 'k0.app', 'Contents', 'MacOS', 'k0')
    } catch {
      warn('the menu bar icon did not build — the board still works without it')
      return null
    }
  }
  if (process.platform === 'linux') return path.join(APP_DIR, 'platform', 'linux', 'tray.py')
  if (process.platform === 'win32') return path.join(APP_DIR, 'platform', 'win32', 'tray.ps1')
  return null
}

// ── Talking to a running server ──────────────────────────────────────────────
async function api(route, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${route}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${PORT}` },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

const alive = async () => {
  try {
    await api('/api/status')
    return true
  } catch {
    return false
  }
}

async function waitForServer(seconds = 10) {
  for (let i = 0; i < seconds * 2; i++) {
    if (await alive()) return true
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

// ── Opening the board ────────────────────────────────────────────────────────
/**
 * Opens the board in a browser and answers with the address it used.
 *
 * `k0.localhost` is the name the board deserves, and inside a browser it is guaranteed to mean
 * this machine — RFC 6761 reserves the whole of `.localhost` for loopback and every browser
 * honours it. A resolver is under no such obligation, and on Windows usually declines. So the
 * name is tried first, from here, and the number is what we fall back to: a board at a duller
 * address beats a blank page at a prettier one.
 *
 * Not being able to open anything at all is not a failure. Installing over SSH, or on a machine
 * with no session to put a window in, is an ordinary thing to do, and the install has already
 * succeeded by the time we get here.
 */
async function openBoard() {
  let url = `http://k0.localhost:${PORT}`
  try {
    await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(1500) })
  } catch {
    url = `http://127.0.0.1:${PORT}`
  }
  await shell.openBrowser(url).catch(() => {})
  return url
}

// ── install ──────────────────────────────────────────────────────────────────
async function install() {
  say(`\n${bold('k0')} — the board that drives your Claude Code sessions`)
  say(dim(`  ${platformName}, Node ${process.versions.node}, port ${PORT}`))

  if (process.getuid && process.getuid() === 0) {
    fail('do not run this with sudo: k0 runs as you, not as root.')
    note('Run it again without. It asks for your password by itself, once, and only for the')
    note('permission to keep the machine awake with the lid closed — which you can also skip.')
    process.exit(1)
  }

  // What the platform simply cannot do here, said now rather than discovered later.
  const missing = Object.entries(notes).filter(([key]) => key !== 'platform')
  if (!capabilities.terminal.readScreen && !capabilities.terminal.pasteWithoutSending) {
    fail(`k0 cannot drive terminals on this machine.`)
    for (const [, why] of missing) note(why)
    process.exit(1)
  }

  // ── The consent screen ─────────────────────────────────────────────────────
  const wanted = []
  for (const extra of extras) {
    const supported = typeof extra.supported === 'function' ? await extra.supported() : true
    if (!supported) continue
    if (flag(`no-${extra.id}`)) continue
    wanted.push(extra)
  }

  say(`\n${bold('k0 is about to change the following on this machine:')}\n`)
  say(`  • copy k0 into ${APP_DIR}`)
  say(dim(`    its database, logs and cache live in ${paths.HOME}`))
  for (const { path: p, what } of service.describe()) {
    say(`  • ${what}`)
    say(dim(`    → ${p}`))
  }
  for (const extra of wanted) {
    say(`  • ${extra.title}`)
    say(dim(`    → ${extra.target}`))
    say(dim(`    ${extra.detail}`))
  }
  say(`\n  ${dim(`All of this can be undone with \`k0-board uninstall\`.`)}`)
  if (wanted.length) say(`  ${dim('Skip any one of them with --no-<name>, e.g. --no-lid-sleep.')}`)

  const go = flag('yes') || (await confirm(`\n${bold('Continue?')}`, { fallback: false }))
  if (!go) {
    say('\nNothing was changed.')
    process.exit(0)
  }

  // ── Doing it ───────────────────────────────────────────────────────────────
  paths.ensureDirs()

  if (APP_DIR !== SOURCE) {
    step(`Copying k0 into ${APP_DIR}`)
    fs.rmSync(APP_DIR, { recursive: true, force: true })
    copyTree(SOURCE, APP_DIR)
    ok('copied')
  } else {
    step('Running from this checkout')
    note('the service will point at this directory; moving it will break the service')
  }

  step('Building the tray icon')
  const tray = buildTray()
  if (tray && fs.existsSync(tray)) ok('built')
  else if (capabilities.tray) warn('not built')
  else note(notes.tray || 'this system has no tray icon')

  // Before switching on, not after: that way the server finds the permissions already in place
  // on its very first run instead of waiting for a restart to be complete.
  for (const extra of wanted) {
    if (extra.manual) continue
    step(extra.title)
    if (await extra.installed()) {
      ok('already in place')
      continue
    }
    const result = await extra.install()
    if (result?.ok) ok(result.message || 'done')
    else warn(result?.message || 'not done')
  }

  step('Starting the service')
  await service.install({
    node: process.execPath,
    entry: ENTRY,
    port: PORT,
    logDir: paths.LOG_DIR,
    appDir: APP_DIR,
    tray,
  })
  const up = await waitForServer()
  if (up) ok(`k0 is up: ${bold(`http://k0.localhost:${PORT}`)}`)
  else warn(`the server is not answering yet — look in ${paths.LOG_DIR}`)

  // ── The two invitations ────────────────────────────────────────────────────
  await offerSkill()
  await offerImport()

  for (const extra of wanted.filter((e) => e.manual)) {
    say(`\n${bold(extra.title)}`)
    note(extra.detail)
    note(`Where: ${extra.target}`)
  }

  // Last of all, on purpose: by now the imported cards are on the board, so what opens is
  // somebody's own work rather than an empty grid they would have to reload.
  if (up && !flag('no-open')) {
    say(`\n${bold('Done.')} The board is open at ${await openBoard()}`)
    return
  }
  say(`\n${bold('Done.')} The board is at http://k0.localhost:${PORT}`)
  if (process.platform === 'win32') note(`If that name does not resolve, use http://127.0.0.1:${PORT}`)
}

/**
 * The import skill lives in the repository, which is enough for anybody who cloned it. For
 * anybody who installed with one command there is no repository to open Claude Code in, so it is
 * offered as a copy into their own skills directory — where it works from any project.
 */
async function offerSkill() {
  const from = path.join(APP_DIR, '.claude', 'skills', 'k0-import')
  const to = path.join(os.homedir(), '.claude', 'skills', 'k0-import')
  if (!fs.existsSync(from) || fs.existsSync(to)) return
  say('')
  const yes = await confirm(
    `Install the ${bold('/k0-import')} skill for Claude Code? ${dim('(fills the board from sessions you already have)')}`,
    { fallback: true }
  )
  if (!yes) return
  copyTree(from, to)
  ok(`copied into ${to}`)
}

/**
 * An empty board says nothing about what k0 is for. This fills it from the sessions already on
 * the machine, so the first thing you see is your own work.
 *
 * The titles here are mechanical — the name the session already had, or the first few words of
 * the first prompt. `/k0-import` inside Claude Code writes better ones, because it reads the
 * conversation; that is said out loud rather than left to be discovered.
 */
async function offerImport() {
  let candidates = []
  try {
    candidates = await api('/api/sessions/candidates?days=14&per_repo=10')
  } catch {
    return
  }
  if (!candidates.length) return

  const repos = new Set(candidates.map((c) => c.project_name))
  say('')
  const yes = await confirm(
    `Found ${bold(String(candidates.length))} Claude Code sessions from the last 14 days in ` +
      `${bold(String(repos.size))} ${repos.size === 1 ? 'repository' : 'repositories'}. Put them on the board?`,
    { fallback: true }
  )
  if (!yes) return

  const items = candidates.map((c) => ({
    session_id: c.session_id,
    project_path: c.project_path,
    title: (c.title_hint || firstWords(c.first_prompt) || 'Session').slice(0, 60),
    description: oneLine(c.first_prompt),
    started_at: c.started_at,
    ended_at: c.ended_at,
  }))

  let created = 0
  for (let i = 0; i < items.length; i += 30) {
    const res = await api('/api/sessions/import', { items: items.slice(i, i + 30) })
    created += res.created
  }
  ok(`${created} cards on the board`)
  note('Run /k0-import inside Claude Code for titles written by reading the conversation.')
}

const firstWords = (s) => String(s || '').trim().split(/\s+/).slice(0, 5).join(' ')
const oneLine = (s) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > 160 ? `${t.slice(0, 157)}…` : t
}

// ── uninstall ────────────────────────────────────────────────────────────────
async function uninstall() {
  say(`\n${bold('k0')} — removing`)

  step('Stopping the service')
  await service.uninstall()
  ok('stopped and removed')

  for (const extra of extras) {
    if (extra.manual) continue
    step(extra.title)
    const result = await extra.uninstall()
    if (result?.ok) ok(result.message || 'removed')
    else warn(result?.message || 'not removed')
  }

  if (fs.existsSync(paths.APP_DIR)) {
    step('Removing the installed copy')
    fs.rmSync(paths.APP_DIR, { recursive: true, force: true })
    ok(paths.APP_DIR)
  }

  say(`\n${bold('Done.')} Your board is still where it was: ${paths.DB_PATH}`)
  note(`Delete ${paths.HOME} to remove it as well.`)
  for (const extra of extras.filter((e) => e.manual)) note(`Revoke by hand: ${extra.target}`)
}

// ── start ────────────────────────────────────────────────────────────────────
/** Runs the server in the foreground and opens the board. No service, nothing installed. */
async function start() {
  const open = !flag('no-open')
  if (await alive()) {
    ok(`k0 is already running on http://k0.localhost:${PORT}`)
    if (open) await openBoard()
    return
  }
  const child = spawn(process.execPath, [path.join(SOURCE, 'server', 'index.js')], {
    stdio: 'inherit',
    env: { ...process.env, K0_PORT: String(PORT) },
  })
  if ((await waitForServer()) && open) await openBoard()
  child.on('exit', (code) => process.exit(code ?? 0))
}

// ── doctor ───────────────────────────────────────────────────────────────────
/**
 * What is here, what is not, and what that costs. It is the first thing to ask for when
 * something does not work, and the first thing to paste into an issue.
 */
async function doctor() {
  say(`\n${bold('k0 doctor')}`)
  say(dim(`  ${platformName} ${os.release()} · Node ${process.versions.node} · port ${PORT}`))
  say(dim(`  app: ${APP_DIR}`))
  say(dim(`  data: ${paths.HOME}`))

  step('Claude Code')
  const claude = shell.findClaude()
  if (claude && claude !== 'claude' && fs.existsSync(claude)) ok(claude)
  else warn('not found — k0 can open terminals but Claude Code will not start in them')

  step('Server')
  const running = await alive()
  const state = await service.status().catch(() => ({ running: false }))
  if (running) ok('answering')
  else if (state.running) warn('the service is running but the server is not answering')
  else warn('not running — `k0-board install` or `k0-board start`')

  step('What this machine can do')
  const rows = [
    ['open terminals', capabilities.terminal.pasteWithoutSending || capabilities.terminal.readScreen],
    ['place and raise windows', capabilities.terminal.windows],
    ['read a terminal to know when Claude Code is ready', capabilities.terminal.readScreen],
    ['leave a prompt unsent', capabilities.terminal.pasteWithoutSending],
    ['resize the terminal font for driving mode', capabilities.terminal.font],
    ['keep the machine awake', capabilities.power.keepAwake],
    ['keep the screen awake', capabilities.power.keepDisplayAwake],
    ['keep working with the lid closed', capabilities.power.lidSleep],
    ['read the battery', capabilities.power.battery],
    ['read the kernel memory-pressure verdict', capabilities.metrics.pressure],
    ['start at login', capabilities.service.autostart],
    ['show a tray icon', capabilities.tray],
  ]
  for (const [what, yes] of rows) (yes ? ok : warn)(what)

  // The settings, in full, with what is actually in force. k0 has no settings page and is not
  // getting one, so this — and the file itself — is where the list lives. Printing every key
  // rather than only the ones somebody has changed is the point: it is an inventory.
  step('Settings')
  const conf = settings.status()
  say(dim(`  ${conf.path}${conf.exists ? '' : ' (not written yet — the defaults are in force)'}`))
  if (conf.broken) warn('this file could not be read: it is being ignored and the defaults are in force')
  for (const [key, value] of Object.entries(conf.values)) {
    const dflt = settings.DEFAULTS[key]
    const off = key === 'closeIdleTerminalsAfterHours' && value === 0
    say(`  ${bold(key)}  ${off ? 'off' : value}${value === dflt ? dim(' (default)') : dim(` (default ${dflt})`)}`)
  }

  const explained = Object.entries(notes)
  if (explained.length) {
    step('Why not')
    for (const [key, why] of explained) {
      say(`  ${bold(key)}`)
      note(why)
    }
  }
}

// ── the rest ─────────────────────────────────────────────────────────────────
async function restart() {
  await service.restart()
  ok((await waitForServer()) ? 'restarted' : 'restarted, but not answering yet')
}

async function status() {
  const running = await alive()
  say(running ? `k0 is running on http://k0.localhost:${PORT}` : 'k0 is not running')
  process.exit(running ? 0 : 1)
}

/**
 * Called by the menu bar icon the moment Terminal quits, which is the only moment the key
 * binding survives being written. Not meant to be typed by hand.
 */
async function shiftEnter() {
  const extra = extras.find((e) => e.id === 'shift-enter')
  if (!extra) return
  const result = await extra.install()
  if (!result?.ok && result?.message) console.error(`k0: ${result.message}`)
}

function usage() {
  say(`
${bold('k0-board')} — a board of sticky notes that drives your Claude Code sessions

  ${bold('k0-board install')}     install and start it (this is the default)
  ${bold('k0-board uninstall')}   undo everything install did
  ${bold('k0-board start')}       run the server in the foreground, without installing anything
  ${bold('k0-board restart')}     restart the service
  ${bold('k0-board status')}      is it running?
  ${bold('k0-board doctor')}      what this machine can and cannot do, and why

Options
  ${bold('--yes')}            do not ask, assume yes
  ${bold('--from-source')}    point the service at this directory instead of copying it
  ${bold('--no-open')}        do not open the board in a browser at the end
  ${bold('--no-<name>')}      skip one optional change, e.g. --no-lid-sleep
`)
}

const commands = { install, uninstall, start, restart, status, doctor, 'shift-enter': shiftEnter }

if (flag('help') || flag('h') || command === 'help') {
  usage()
} else if (commands[command]) {
  try {
    await commands[command]()
  } catch (err) {
    fail(String(err?.message || err))
    process.exit(1)
  }
} else {
  fail(`unknown command: ${command}`)
  usage()
  process.exit(1)
}
