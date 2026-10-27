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
process.env.USERPROFILE = FAKE_HOME
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

section('The verdict and the switch')

const settings = await import('../server/settings.js')
// Every hello keeps Whisper warm, and with a model on disk that would start whisper-server — the
// stand-in on PATH, or a real one Homebrew put on this Mac. The models step aside for the hellos.
const models = [model, cached].filter((f) => fs.existsSync(f))
for (const f of models) fs.renameSync(f, `${f}.aside`)
check('dictation starts off', settings.read().dictation, false)
check('no engine is chosen to begin with', settings.read().dictationEngine, '')
check('the app is told to be the trial', dictate.hello({}).mode, 'trial')
check('without an engine it cannot be switched on, and says why', typeof dictate.whyNotOn(''), 'string')
check('an engine nobody offered is refused', 'error' in dictate.choose('siri'), true)
dictate.choose('apple')
check('the verdict is kept in the settings file', settings.read().dictationEngine, 'apple')
check('Apple can be switched on with nothing else to fetch', dictate.whyNotOn('apple'), null)
fs.writeFileSync(settings.PATH, JSON.stringify({ ...JSON.parse(fs.readFileSync(settings.PATH, 'utf8')), mine: 1 }))
settings.write({ dictation: true })
check('switching on leaves a line written by hand alone', JSON.parse(fs.readFileSync(settings.PATH, 'utf8')).mine, 1)
const told = dictate.hello({})
check('with the switch on the app is told to dictate', told.mode, 'dictate')
check('and which engine to use', told.engine, 'apple')
check('and where its recordings go', told.liveDir, path.join(FAKE_HOME, 'dictate', 'live'))
check('the page sees it on', dictate.state().dictation.on, true)
check('a typo in the file does not switch it on', settings.normalise({ dictation: 'yes please' }).dictation, false)
check('an unknown engine in the file counts as none', settings.normalise({ dictationEngine: 'x' }).dictationEngine, '')
settings.write({ dictation: false })
for (const f of models) fs.renameSync(`${f}.aside`, f)

section('A phrase of real dictation')

const liveDir = path.join(FAKE_HOME, 'dictate', 'live')
fs.mkdirSync(liveDir, { recursive: true })
const refused = await dictate.transcribeLive({ wav: path.join(FAKE_HOME, '1.wav') })
check('a recording outside the live folder is refused', typeof refused.error, 'string')
const phrase = path.join(liveDir, '300.wav')
fs.writeFileSync(phrase, 'RIFF')
const live = await dictate.transcribeLive({ wav: phrase }, { run: async () => ({ text: 'ciao', lang: 'it' }) })
check('Whisper gives back the text', live.text, 'ciao')
check('and the recording is gone once heard', fs.existsSync(phrase), false)

check('a word cut between two segments is put back together',
  dictate.spoken({ text: 'si mu\noveva e l\'\nultima\n volta' }), "si muoveva e l'ultima volta")
check('the segments win over the text when they are there',
  dictate.spoken({ text: 'x', segments: [{ text: ' Ciao,' }, { text: ' come va' }] }), 'Ciao, come va')
check('nothing heard is an empty phrase', dictate.spoken({}), '')

section('What Whisper invents over silence')

check('"Thank you." on its own is invented', dictate.invented('Thank you.'), true)
check('so is a lone full stop', dictate.invented('.'), true)
check('and the subtitle credits', dictate.invented('Sottotitoli creati dalla comunità Amara.org'), true)
check('a real sentence with thanks in it is not', dictate.invented('Thank you for the review, ship it.'), false)
check('nor is a word somebody said', dictate.invented('Allora.'), false)
const silentWav = path.join(liveDir, '301.wav')
fs.writeFileSync(silentWav, 'RIFF')
const silent = await dictate.transcribeLive({ wav: silentWav }, { run: async () => ({ text: ' Thank you.' }) })
check('an invented phrase comes back empty, so nothing is pasted', silent.text, '')
check('and says what was thrown away', silent.dropped, 'Thank you.')

section('The last ten')

check('nothing said, nothing kept', 'error' in dictate.remember({ text: '   ' }), true)
for (let i = 1; i <= 12; i++) dictate.remember({ text: `phrase ${i}` })
check('only ten are kept', dictate.history().length, dictate.HISTORY)
check('the newest comes first', dictate.history()[0].text, 'phrase 12')
check('the oldest have gone', dictate.history().some((h) => h.text === 'phrase 2'), false)
check('they live in k0 home, not the database', fs.existsSync(path.join(FAKE_HOME, 'dictate', 'history.json')), true)
check('the page has them too', dictate.state().history.length, 10)

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
