import { check, section, after } from './harness.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ── The dictation trial ──────────────────────────────────────────────────────
// What is worth proving here: that a phrase never lands anywhere but the trial folder, that what
// the app and the page send is cut down to a text and a time, that the model download is the only
// thing that reaches outside and goes exactly where the page says it goes, and that Whisper is
// asked on the loopback interface and nowhere else. The real `fetch` is replaced by one that
// throws, so a bug that ignored the seams fails loudly instead of downloading 1.6 GB from somebody's
// `npm test`. Everything lives in a temporary home, set before the first import.

const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-dictate-home-'))
process.env.K0_DB = path.join(FAKE_HOME, 'k0.db')
process.env.K0_HOME = FAKE_HOME
process.env.HOME = FAKE_HOME
globalThis.fetch = async () => {
  throw new Error('the test tried to reach the network')
}

const dictate = await import('../server/dictate.js')
const platform = await import('../platform/index.js')

const tick = () => new Promise((r) => setTimeout(r, 30))

section('Where a phrase may be')

const { dir } = dictate.hello({ accessibility: true, microphone: true, apple: true })
check('the app is told the trial folder inside k0 home', dir, path.join(FAKE_HOME, 'dictate', 'trial'))
check('after hello the app counts as alive', dictate.state().app.alive, true)
check('a trial needs a numeric id', 'error' in dictate.addTrial({ id: '../x', wav: path.join(dir, 'x.wav') }), true)
check(
  'a recording outside the trial folder is refused',
  dictate.addTrial({ id: '1', wav: path.join(FAKE_HOME, '1.wav') }).error !== undefined,
  true
)
check(
  'a recording whose name is not its id is refused',
  dictate.addTrial({ id: '1', wav: path.join(dir, '2.wav') }).error !== undefined,
  true
)

section('What comes back from the engines')

fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, '100.wav'), 'RIFF')
const heard = []
const trial = dictate.addTrial(
  { id: '100', releasedAt: Date.now() - 500, durationMs: 1234.4, wav: path.join(dir, '100.wav') },
  { run: async (file) => (heard.push(file), { text: '  ciao mondo  ', lang: 'it' }) }
)
await tick()
check('Whisper is handed the recording itself', heard[0], path.join(dir, '100.wav'))
check('the text is trimmed', trial.whisper.text, 'ciao mondo')
check('the time is counted from letting go', trial.whisper.ms >= 500, true)
check('the language is kept', trial.whisper.lang, 'it')
check('the length of the phrase is whole milliseconds', trial.durationMs, 1234)
check('the same phrase twice is one trial', dictate.addTrial({ id: '100', wav: path.join(dir, '100.wav') }), trial)

const candidates = [{ lang: 'en-US', text: 'chow' }]
dictate.update('100', { apple: { text: 'x'.repeat(6000), ms: 812.7, lang: 'it-IT', candidates } })
check('a text is cut to 5000 characters', trial.apple.text.length, 5000)
check('a time is whole milliseconds', trial.apple.ms, 813)
check('what the other language heard is kept', trial.apple.candidates[0].text, 'chow')
dictate.update('100', { wispr: { text: 'Ciao mondo.', ms: -4, extra: 'ignored' } })
check('a negative time becomes zero', trial.wispr.ms, 0)
check('fields nobody asked for are dropped', 'extra' in trial.wispr, false)
check('an unknown trial is not updated', dictate.update('999', { wispr: { text: 'x' } }), null)
check('its recording can be played back', dictate.audio('100'), path.join(dir, '100.wav'))
check('an unknown trial has no recording', dictate.audio('999'), null)
const written = fs.existsSync(path.join(FAKE_HOME, 'dictate', 'trials.json'))
check('the trials are written to k0 home, not the database', written, true)
check('the newest comes first', dictate.state().trials[0].id, '100')

section('Whisper, on the loopback interface')

const bin = path.join(FAKE_HOME, 'bin')
fs.mkdirSync(bin)
fs.writeFileSync(path.join(bin, 'whisper-server'), '#!/bin/sh\nsleep 30\n', { mode: 0o755 })
process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`
const cached = path.join(FAKE_HOME, '.cache', 'whisper-models', 'ggml-large-v3-turbo.bin')
fs.mkdirSync(path.dirname(cached), { recursive: true })
fs.writeFileSync(cached, 'model')
check('a model already on the Mac is used, not downloaded again', dictate.findModel(), cached)
check('whisper-server is found on PATH', dictate.findWhisper(), path.join(bin, 'whisper-server'))

const asked = []
const local = async (url, init) => {
  asked.push(String(url))
  return { json: async () => ({ text: 'hello there', language: 'en' }) }
}
fs.writeFileSync(path.join(dir, '200.wav'), 'RIFF')
const second = dictate.addTrial({ id: '200', releasedAt: Date.now(), wav: path.join(dir, '200.wav') }, {
  fetch: local,
})
for (let i = 0; i < 50 && !second.whisper; i++) await tick()
check('Whisper answers through whisper-server', second.whisper?.text, 'hello there')
const loopback = asked.length > 0 && asked.every((u) => u.startsWith('http://127.0.0.1:'))
check('every request stays on 127.0.0.1', loopback, true)
check('the phrase goes to /inference', asked.some((u) => u.endsWith('/inference')), true)
dictate.stop()

section('The model, the one download')

const model = path.join(FAKE_HOME, 'dictate', 'models', 'ggml-large-v3-turbo.bin')
fs.rmSync(path.join(FAKE_HOME, '.cache'), { recursive: true })
const fetched = []
const broken = async (url) => (fetched.push(url), { ok: false, status: 404, body: null, headers: new Headers() })
const failed = await dictate.downloadModel({ fetch: broken })
check('a failed download says so', failed.state, 'error')
check('and leaves nothing half-written', fs.existsSync(`${model}.part`), false)
check('it asked the address the page shows, and only that', fetched.join(), dictate.MODEL_URL)

const good = async () => new Response('the model', { headers: { 'content-length': '9' } })
const done = await dictate.downloadModel({ fetch: good })
check('a good download is done', done.state, 'done')
check('it counts what arrived', done.received, 9)
check('the model lands in k0 home', fs.readFileSync(model, 'utf8'), 'the model')
check('it is not downloaded a second time', (await dictate.downloadModel({ fetch: broken })).state, 'done')

section('Clearing up, and what each platform says')

dictate.clear()
check('throwing away empties the list', dictate.state().trials.length, 0)
check('and removes the recordings', fs.existsSync(dir), false)
check('dictation is a yes or a no', typeof platform.capabilities.dictation, 'boolean')
check(
  'where it is a no, the board is told why',
  platform.capabilities.dictation || typeof platform.why('dictation') === 'string',
  true
)

after(() => fs.rmSync(FAKE_HOME, { recursive: true, force: true }))
