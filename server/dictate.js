import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { HOME } from './paths.js'
import * as settings from './settings.js'

// ── The dictation trial ──────────────────────────────────────────────────────
// Before k0 gets a dictation of its own, one question has to be answered on a real Mac with a
// real voice: is an offline engine good enough to replace Wispr Flow? Two candidates, Apple's
// and Whisper, against the thing they would replace. You dictate with Wispr as usual, holding
// Control; the "k0 Dictate" app (dictate/) records the same microphone at the same moment and,
// when you let go, Apple's engine transcribes it there while this file hands it to Whisper. The
// trial page puts the three texts and the three times side by side, and the verdict is yours.
//
// Nothing here goes into the database. The database is synced to k0 Cloud, and nothing you say
// may leave this Mac: the trials live in ~/.k0/dictate/, recordings included, and the button on
// the page throws them away.
//
// ── The third place k0 reaches outside ───────────────────────────────────────
// WHAT LEAVES THIS MACHINE. One GET to MODEL_URL below, the Whisper model published by the
// whisper.cpp project on Hugging Face — only when you press the button on the trial page that
// shows that address, only if no copy of the model is already on this Mac, and only once: the
// file stays in ~/.k0/dictate/models/. The request carries the address and the fixed user-agent
// `k0-board`, nothing else. What comes back is the model, about 1.6 GB, and nothing else is run.
// Your voice never goes anywhere: the model comes here, the recordings do not go there.
//
// Whisper itself runs as `whisper-server` on the loopback interface, started by this file and
// stopped when the app has been quiet for a while, so the model is loaded once and not for every
// phrase — otherwise the trial would time Whisper's start-up instead of Whisper.

export const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin'
const MODEL = 'ggml-large-v3-turbo.bin'

export const DIR = path.join(HOME, 'dictate')
export const TRIAL_DIR = path.join(DIR, 'trial')
const MODEL_DIR = path.join(DIR, 'models')
const TRIALS_FILE = path.join(DIR, 'trials.json')
// Dictation proper. The recording of a phrase lives here only until it has been transcribed; the
// text lives in the history, ten phrases and no more, so "paste the last one" works when a paste
// went wrong and nothing piles up.
export const LIVE_DIR = path.join(DIR, 'live')
const HISTORY_FILE = path.join(DIR, 'history.json')
export const HISTORY = 10
const KEEP = 200
const ALIVE = 15_000
const IDLE = 15 * 60_000

// ── Finding Whisper ──────────────────────────────────────────────────────────

/**
 * k0's own copy first, then the places whisper.cpp's own scripts put it: somebody who already has
 * the 1.6 GB file should not be made to download it a second time.
 */
export function findModel() {
  const cache = path.join(os.homedir(), '.cache')
  const places = [MODEL_DIR, path.join(cache, 'whisper-models'), path.join(cache, 'whisper')]
  for (const dir of places) {
    const file = path.join(dir, MODEL)
    if (fs.existsSync(file) && fs.statSync(file).size > 0) return file
  }
  return null
}

/**
 * Homebrew's `whisper-cpp` provides it. Looked for on PATH first, then where Homebrew puts it,
 * because k0 runs under launchd, whose PATH does not include Homebrew.
 */
export function findWhisper() {
  const dirs = [...String(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin']
  for (const dir of dirs) {
    if (!dir) continue
    const file = path.join(dir, 'whisper-server')
    try {
      fs.accessSync(file, fs.constants.X_OK)
      return file
    } catch {}
  }
  return null
}

// ── What has been said ───────────────────────────────────────────────────────

function load() {
  try {
    const list = JSON.parse(fs.readFileSync(TRIALS_FILE, 'utf8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

let trials = load()

function save() {
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(TRIALS_FILE, JSON.stringify(trials.slice(-KEEP)))
}

const find = (id) => trials.find((t) => t.id === String(id))

/** A text and a time, from a caller that is not trusted to send either. */
const clean = (answer) =>
  answer && typeof answer === 'object'
    ? {
        text: String(answer.text ?? '').slice(0, 5000),
        ms: Math.max(0, Math.round(Number(answer.ms) || 0)),
        lang: String(answer.lang ?? '').slice(0, 16),
        ...(answer.error ? { error: String(answer.error).slice(0, 500) } : {}),
        ...(Array.isArray(answer.candidates)
          ? {
              candidates: answer.candidates.slice(0, 4).map((c) => ({
                lang: String(c?.lang ?? '').slice(0, 16),
                text: String(c?.text ?? '').slice(0, 5000),
                confidence: Number(c?.confidence) || 0,
              })),
            }
          : {}),
      }
    : null

let app = { seenAt: 0, accessibility: false, microphone: false, apple: false }

/**
 * The app says it is alive, and is told what to be: the trial, which only listens beside Wispr,
 * or dictation, which pastes. Never both — with dictation on, k0 and Wispr would paste the same
 * phrase twice — and dictation only once somebody has chosen the engine the trial was for.
 */
export function hello(body = {}) {
  app = {
    seenAt: Date.now(),
    accessibility: body.accessibility === true,
    microphone: body.microphone === true,
    apple: body.apple === true,
  }
  const { dictation, dictationEngine } = settings.read()
  const on = dictation && !!dictationEngine
  if (!on || dictationEngine === 'whisper') warm()
  return { dir: TRIAL_DIR, liveDir: LIVE_DIR, mode: on ? 'dictate' : 'trial', engine: dictationEngine }
}

/**
 * A phrase has just been dictated. Recorded now, with the moment Control was let go, so every
 * engine — Wispr included, timed by the page — is measured from the same instant.
 */
export function addTrial(body = {}, options = {}) {
  const id = String(body.id ?? '')
  if (!/^\d{1,16}$/.test(id)) return { error: 'A trial needs a numeric id.' }
  const wav = path.resolve(String(body.wav ?? ''))
  if (path.dirname(wav) !== TRIAL_DIR || path.basename(wav) !== `${id}.wav`) {
    return { error: 'The recording must be in the trial folder k0 handed out.' }
  }
  if (find(id)) return find(id)
  const trial = {
    id,
    releasedAt: Number(body.releasedAt) || Date.now(),
    durationMs: Math.round(Number(body.durationMs) || 0),
    apple: null,
    whisper: null,
    wispr: null,
  }
  trials.push(trial)
  save()
  transcribe(trial, options)
  return trial
}

/** Apple's answer from the app, or Wispr's from the page. Anything else is ignored. */
export function update(id, body = {}) {
  const trial = find(id)
  if (!trial) return null
  if (body.apple) trial.apple = clean(body.apple)
  if (body.wispr) trial.wispr = clean(body.wispr)
  save()
  return trial
}

export function audio(id) {
  if (!find(id)) return null
  const file = path.join(TRIAL_DIR, `${id}.wav`)
  return fs.existsSync(file) ? file : null
}

/** Throws every trial away, recordings included. */
export function clear() {
  trials = []
  fs.rmSync(TRIAL_DIR, { recursive: true, force: true })
  save()
}

// ── Whisper, kept warm ───────────────────────────────────────────────────────

let whisper = null
let idleTimer = null

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })

async function waitUntilUp(port, fetch) {
  const until = Date.now() + 120_000
  while (Date.now() < until) {
    try {
      await fetch(`http://127.0.0.1:${port}/`)
      return true
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

/** Starts whisper-server if it is not running, and says when it has the model loaded. */
function warm({ fetch = globalThis.fetch } = {}) {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(stop, IDLE)
  idleTimer.unref?.()
  if (whisper) return whisper
  const bin = findWhisper()
  const model = findModel()
  if (!bin || !model) return null
  whisper = {
    ready: freePort().then((port) => {
      const child = spawn(bin, ['-m', model, '--host', '127.0.0.1', '--port', String(port), '-l', 'auto'], {
        stdio: 'ignore',
      })
      child.on('exit', () => {
        if (whisper?.child === child) whisper = null
      })
      whisper.child = child
      whisper.port = port
      return waitUntilUp(port, fetch)
    }),
  }
  whisper.ready.catch(() => (whisper = null))
  return whisper
}

export function stop() {
  clearTimeout(idleTimer)
  whisper?.child?.kill()
  whisper = null
}

process.on('exit', () => whisper?.child?.kill())

/**
 * The text of a whisper-server answer, as one phrase. Its `text` puts each segment on a line of its
 * own, and a segment can end in the middle of a word ("si mu" / "oveva"): pasted as it came, every
 * break landed in the document. A segment that starts a new word starts with a space, so the
 * segments are simply put back together.
 */
export function spoken(json = {}) {
  const parts = Array.isArray(json.segments) && json.segments.length
    ? json.segments.map((s) => String(s?.text ?? ''))
    : String(json.text ?? '').split('\n')
  return parts.join('').replace(/\s+/g, ' ').trim()
}

/**
 * What Whisper says over silence, or a breath, when nobody spoke: the ends of the subtitled videos it
 * learned from. Said on its own, such a phrase is thrown away instead of pasted; inside a real
 * sentence it is left alone.
 */
const INVENTED = [
  '', '.', '..', '...', 'thank you', 'thank you.', 'thanks for watching', 'thanks for watching!', 'you',
  'grazie', 'grazie.', 'grazie a tutti', 'grazie per la visione', 'sottotitoli creati dalla comunità amara.org',
  'sottotitoli e revisione a cura di qtss', 'sottotitoli a cura di qtss',
]

export function invented(text = '') {
  const t = String(text).trim().toLowerCase()
  // Over silence Whisper can also read its own prompt back.
  return INVENTED.includes(t) || t === PROMPT.toLowerCase() || /^[\s.,!?…-]*$/.test(t) || /^sottotitoli\b/.test(t)
}

/**
 * A nudge, not a setting: the language is still Whisper's call, but a first line in Italian with
 * English in it keeps a short Italian phrase from being heard as Spanish.
 */
export const PROMPT = 'Allora, facciamo il deploy e poi la code review del branch main.'

async function transcribe(trial, { fetch = globalThis.fetch, run } = {}) {
  const done = (answer) => {
    trial.whisper = clean({ ...answer, text: String(answer.text ?? '').trim(), ms: Date.now() - trial.releasedAt })
    save()
  }
  try {
    if (run) return done(await run(path.join(TRIAL_DIR, `${trial.id}.wav`)))
    const w = warm({ fetch })
    if (!w) return done({ error: whyNoWhisper() })
    if (!(await w.ready)) return done({ error: 'whisper-server did not start.' })
    const form = new FormData()
    form.append('file', new Blob([fs.readFileSync(path.join(TRIAL_DIR, `${trial.id}.wav`))]), 'audio.wav')
    form.append('response_format', 'verbose_json')
    form.append('temperature', '0')
    const reply = await fetch(`http://127.0.0.1:${w.port}/inference`, { method: 'POST', body: form })
    const json = await reply.json()
    done({ text: spoken(json), lang: json.language ?? '' })
  } catch (err) {
    done({ error: String(err.message || err) })
  }
}

/**
 * One phrase of real dictation, for Whisper. Awaited, unlike the trial: the app is waiting for the
 * text to paste it. The recording is deleted once heard, whatever happened to it.
 */
export async function transcribeLive(body = {}, { fetch = globalThis.fetch, run } = {}) {
  const wav = path.resolve(String(body.wav ?? ''))
  if (path.dirname(wav) !== LIVE_DIR || !/^\d{1,16}\.wav$/.test(path.basename(wav))) {
    return { error: 'The recording must be in the folder k0 handed out.' }
  }
  const started = Date.now()
  try {
    if (run) return heard(await run(wav), started)
    const w = warm({ fetch })
    if (!w) return { error: whyNoWhisper() }
    if (!(await w.ready)) return { error: 'whisper-server did not start.' }
    const form = new FormData()
    form.append('file', new Blob([fs.readFileSync(wav)]), 'audio.wav')
    form.append('response_format', 'verbose_json')
    form.append('temperature', '0')
    form.append('prompt', PROMPT)
    const reply = await fetch(`http://127.0.0.1:${w.port}/inference`, { method: 'POST', body: form })
    return heard(await reply.json(), started)
  } catch (err) {
    return { error: String(err.message || err) }
  } finally {
    fs.rmSync(wav, { force: true })
  }
}

function heard(json, started) {
  const text = spoken(json)
  return {
    text: invented(text) ? '' : text,
    ...(invented(text) && text ? { dropped: text } : {}),
    lang: json.language ?? json.lang ?? '',
    ms: Date.now() - started,
  }
}

// ── The history ──────────────────────────────────────────────────────────────

export function history() {
  try {
    const list = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'))
    return Array.isArray(list) ? list.slice(0, HISTORY) : []
  } catch {
    return []
  }
}

/** Newest first, ten at most. Written before the paste is tried, so a paste that fails loses nothing. */
export function remember(body = {}) {
  const text = String(body.text ?? '').trim().slice(0, 20_000)
  if (!text) return { error: 'Nothing was said.' }
  const list = [{ text, at: Date.now() }, ...history()].slice(0, HISTORY)
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(list))
  return list
}

// ── The switch ───────────────────────────────────────────────────────────────

/** Why dictation cannot be switched on with this engine, in a sentence for the page; null if it can. */
export function whyNotOn(engine) {
  if (!settings.ENGINES.includes(engine)) {
    return 'Choose the engine first: try both on this page, then press the one you want to keep.'
  }
  if (engine === 'whisper') return whyNoWhisper()
  return null
}

/** The engine is the verdict of the trial, and only somebody looking at it can give it. */
export function choose(engine) {
  if (!settings.ENGINES.includes(engine)) return { error: `The engine is one of: ${settings.ENGINES.join(', ')}.` }
  return settings.write({ dictationEngine: engine })
}

function whyNoWhisper() {
  if (!findWhisper()) return 'whisper-server was not found. Install it with `brew install whisper-cpp`.'
  if (!findModel()) return 'The Whisper model is not on this Mac yet: download it from the trial page.'
  return null
}

// ── The model ────────────────────────────────────────────────────────────────

let download = { state: 'idle', received: 0, total: 0, error: null }

/**
 * Fetches the model, once. Resolves when it is over, whichever way it went — it never rejects, so
 * the route that starts it does not wait for it and nothing is left unhandled.
 */
export async function downloadModel({ fetch = globalThis.fetch } = {}) {
  if (download.state === 'running') return download
  if (findModel()) return (download = { state: 'done', received: 0, total: 0, error: null })
  download = { state: 'running', received: 0, total: 0, error: null }
  const target = path.join(MODEL_DIR, MODEL)
  const part = `${target}.part`
  try {
    const res = await fetch(MODEL_URL, { headers: { 'user-agent': 'k0-board' } })
    if (!res.ok || !res.body) throw new Error(`The model's address answered ${res.status}.`)
    download.total = Number(res.headers.get('content-length')) || 0
    fs.mkdirSync(MODEL_DIR, { recursive: true })
    const count = new Transform({
      transform(chunk, _, next) {
        download.received += chunk.length
        next(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(res.body), count, fs.createWriteStream(part))
    fs.renameSync(part, target)
    download.state = 'done'
  } catch (err) {
    fs.rmSync(part, { force: true })
    download = { ...download, state: 'error', error: String(err.message || err) }
  }
  return download
}

// ── What the page reads ──────────────────────────────────────────────────────

export function state() {
  const { dictation, dictationEngine } = settings.read()
  return {
    dictation: { on: dictation, engine: dictationEngine, why: dictation ? null : whyNotOn(dictationEngine) },
    history: history(),
    app: { ...app, alive: Date.now() - app.seenAt < ALIVE },
    whisper: {
      binary: findWhisper(),
      model: findModel(),
      modelUrl: MODEL_URL,
      download,
      problem: whyNoWhisper(),
    },
    trials: [...trials].reverse(),
  }
}
