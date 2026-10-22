// The dictation trial page. It asks the server once a second what has been said, and does the one
// thing only it can do: notice when Wispr Flow writes into the box, and when.

import { whileVisible } from '/awake.js'

const $ = (id) => document.getElementById(id)

const PHRASES = [
  'Domani alle nove ho la riunione per decidere la roadmap del prossimo trimestre.',
  'Apri il file README e controlla la sezione che spiega come si fa il deploy.',
  'Fai il commit, poi il push sul branch main, e aspetta che la pipeline sia verde.',
  'Lancia npm test e dimmi se la coverage scende sotto la soglia.',
  'Questa feature è un nice to have: mettila nel backlog e la riprendiamo dopo la release.',
  'Il worktree non isola il database, quindi occhio alle migration.',
  'Scrivi una mail al cliente: il preventivo arriva entro venerdì diciassette.',
  'Mi serve un endpoint che restituisca il JSON con lo status di ogni session.',
  'Ventitré euro e cinquanta, più IVA, da pagare entro il trenta novembre.',
  "Let's ship it tomorrow morning, after the code review.",
]

const seconds = (ms) => (ms == null ? '' : `${(ms / 1000).toFixed(1)} s`)

/** What Wispr wrote, and when it first appeared — waiting to be matched to a phrase. */
let pending = null
let settle = null

$('wispr').addEventListener('input', () => {
  if (!pending) pending = { at: Date.now() }
  pending.text = $('wispr').value
  clearTimeout(settle)
  // Wispr pastes the whole phrase at once; a pause means it has finished.
  settle = setTimeout(() => (pending.settled = true), 800)
})

/**
 * Wispr's text belongs to the newest phrase let go of before it appeared. It is matched on the
 * page's side because the box can fill before the page has heard about the phrase at all — Wispr
 * is sometimes quicker than one poll.
 */
async function matchWispr(trials) {
  if (!pending?.settled) return
  const target = trials.find((t) => !t.wispr && t.releasedAt <= pending.at && pending.at - t.releasedAt < 30_000)
  if (!target) {
    if (Date.now() - pending.at > 15_000) pending = null
    return
  }
  const answer = { text: pending.text.trim(), ms: pending.at - target.releasedAt }
  pending = null
  $('wispr').value = ''
  await fetch(`/api/dictate/trial/${target.id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wispr: answer }),
  })
}

function note(kind, html, button) {
  const p = document.createElement('p')
  p.className = `note ${kind}`
  const span = document.createElement('span')
  span.innerHTML = html
  p.append(span)
  if (button) p.append(button)
  return p
}

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function button(label, action) {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  b.addEventListener('click', async () => {
    b.disabled = true
    try {
      const res = await fetch(action, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) alert(body.error || 'That did not work.')
    } finally {
      b.disabled = false
      refresh()
    }
  })
  return b
}

function drawNotes(s) {
  const out = []
  if (!s.available) {
    out.push(note('bad', `<b>Not available here.</b> ${escape(s.why || '')}`))
    $('notes').replaceChildren(...out)
    return false
  }
  if (!s.app.alive) {
    out.push(
      note(
        'bad',
        '<b>k0 Dictate is not running.</b> Starting it builds it the first time (a few seconds), then macOS asks ' +
          'for the Microphone and for Accessibility — Accessibility is what lets it notice Control being held.',
        button('Start k0 Dictate', '/api/dictate/app')
      )
    )
  } else {
    const missing = []
    if (!s.app.microphone) missing.push('Microphone')
    if (!s.app.accessibility) missing.push('Accessibility')
    out.push(
      missing.length
        ? note('bad', `<b>k0 Dictate needs ${missing.join(' and ')}.</b> System Settings → Privacy &amp; Security → ` +
            `${missing.join(', ')} → switch on <b>k0 Dictate</b>, then quit it and press Start again.`,
            button('Start k0 Dictate', '/api/dictate/app'))
        : note('good', '<b>k0 Dictate is listening.</b> Hold Control on its own to dictate; any other key cancels.')
    )
    if (!s.app.apple) {
      out.push(note('', '<b>Apple\'s engine is still getting ready.</b> macOS downloads its Italian and English models ' +
        'the first time; it does that by itself, not k0.'))
    }
  }
  const w = s.whisper
  if (!w.binary) {
    out.push(note('bad', '<b>Whisper is not installed.</b> In a terminal: <code>brew install whisper-cpp</code>'))
  } else if (!w.model) {
    const d = w.download
    if (d.state === 'running') {
      const pct = d.total ? Math.floor((100 * d.received) / d.total) : 0
      out.push(note('', `<b>Downloading the Whisper model… ${pct}%</b> from <code>${escape(w.modelUrl)}</code>`))
    } else {
      out.push(
        note(
          d.state === 'error' ? 'bad' : '',
          `<b>Whisper needs its model, once (about 1.6 GB).</b> It comes from <code>${escape(w.modelUrl)}</code> ` +
            'and stays in <code>~/.k0/dictate/models/</code>. Only the model comes here — nothing you say goes there.' +
            (d.error ? ` Last attempt: ${escape(d.error)}` : ''),
          button('Download the model', '/api/dictate/model')
        )
      )
    }
  } else {
    out.push(note('good', `<b>Whisper is ready.</b> Model: <code>${escape(w.model)}</code>`))
  }
  $('notes').replaceChildren(...out)
  return true
}

function median(list) {
  if (!list.length) return null
  const sorted = [...list].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const ENGINES = [
  ['wispr', 'Wispr Flow'],
  ['apple', 'Apple'],
  ['whisper', 'Whisper'],
]

function drawTiles(trials) {
  if (!trials.length) return $('tiles').replaceChildren()
  $('tiles').replaceChildren(
    ...ENGINES.map(([key, label]) => {
      const times = trials.map((t) => t[key]).filter((a) => a && !a.error && a.text).map((a) => a.ms)
      const tile = document.createElement('div')
      tile.className = 'tile'
      tile.innerHTML = `<div class="k">${label}, typical time</div><div class="v">${times.length ? seconds(median(times)) : '—'}</div>` +
        `<div class="s">${times.length} phrase${times.length === 1 ? '' : 's'} · slowest ${times.length ? seconds(Math.max(...times)) : '—'}</div>`
      return tile
    })
  )
}

function engineBox(trial, key, label) {
  const a = trial[key]
  const box = document.createElement('div')
  box.className = 'engine'
  const times = ENGINES.map(([k]) => trial[k]).filter((x) => x && !x.error && x.text).map((x) => x.ms)
  const fastest = a && !a.error && a.text && a.ms === Math.min(...times) && times.length > 1
  const lang = a?.lang ? ` · ${escape(a.lang)}` : ''
  box.innerHTML = `<div class="name"><span>${label}${lang}</span><span class="${fastest ? 'fastest' : ''}">${a ? seconds(a.ms) : ''}</span></div>`
  const text = document.createElement('div')
  if (!a) {
    text.className = 'text waiting'
    text.textContent = key === 'wispr' ? 'Waiting for Wispr to write in the box…' : 'Working…'
  } else if (a.error) {
    text.className = 'text error'
    text.textContent = a.error
  } else {
    text.className = 'text'
    text.textContent = a.text || '(nothing heard)'
  }
  box.append(text)
  // Apple listens in one language at a time: show what the losing language heard as well.
  const others = (a?.candidates || []).filter((c) => c.lang !== a.lang && c.text)
  for (const c of others) {
    const alt = document.createElement('div')
    alt.className = 'alt'
    alt.textContent = `${c.lang}: ${c.text}`
    box.append(alt)
  }
  return box
}

let drawn = ''

function drawTrials(trials) {
  // Redrawn only when something changed, so a recording being played is not cut short.
  const key = JSON.stringify(trials)
  if (key === drawn) return
  drawn = key
  if (!trials.length) {
    $('trials').innerHTML = '<p class="caption">Nothing dictated yet.</p>'
    return
  }
  $('trials').replaceChildren(
    ...trials.map((t) => {
      const el = document.createElement('div')
      el.className = 'trial'
      const head = document.createElement('div')
      head.className = 'head'
      const when = new Date(t.releasedAt).toLocaleTimeString()
      head.innerHTML = `<span>${when} · spoken for ${seconds(t.durationMs)}</span>`
      const audio = document.createElement('audio')
      audio.controls = true
      audio.preload = 'none'
      audio.src = `/api/dictate/trial/${t.id}/audio`
      head.append(audio)
      const row = document.createElement('div')
      row.className = 'row'
      row.append(...ENGINES.map(([k, label]) => engineBox(t, k, label)))
      el.append(head, row)
      return el
    })
  )
}

async function refresh() {
  try {
    const s = await fetch('/api/dictate').then((r) => r.json())
    if (!drawNotes(s)) return
    await matchWispr(s.trials)
    drawTiles(s.trials)
    drawTrials(s.trials)
  } catch {
    $('notes').replaceChildren(note('bad', '<b>The k0 server is not answering.</b>'))
  }
}

$('phrases').replaceChildren(
  ...PHRASES.map((p) => {
    const li = document.createElement('li')
    li.textContent = p
    return li
  })
)

$('clear').addEventListener('click', async () => {
  if (!confirm('Throw away every phrase and its recording?')) return
  await fetch('/api/dictate/trial', { method: 'DELETE' })
  refresh()
})

refresh()
// You dictate into this very tab, so it is in front of you whenever there is anything to see.
whileVisible(refresh, 1000)
$('wispr').focus()
