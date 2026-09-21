import { whileVisible } from '/awake.js'

// ── Usage ────────────────────────────────────────────────────────────────────
// What the Claude Code sessions consumed, a week at a time: tokens, the model and effort they ran
// on, the time Claude spent working, what it would have cost at the API price, and — when the
// statusline writes it down — how full each account's weekly limit got.
//
// The server reads all of it out of files already on this machine; this page only asks it for a
// span and draws what comes back. Nothing here, and nothing behind it, spends a token.

const $ = (s) => document.querySelector(s)

const api = async (url) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText)
  return r.json()
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// ── Names and numbers ────────────────────────────────────────────────────────
/** `claude-sonnet-4-6` → `Sonnet 4.6`. Anything that is not shaped like that is shown as it is. */
function modelName(id) {
  const m = /^claude-([a-z]+)-(\d+(?:-\d+)*)$/.exec(id || '')
  if (!m) return id || 'unknown model'
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2].replace(/-/g, '.')}`
}

const AGENTS = { main: 'The conversation itself', sub: 'Subagents', workflow: 'Workflows (Ultracode)' }

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const money = (n) => (n >= 100 ? usd.format(Math.round(n)).replace(/\.00$/, '') : usd.format(n))

function tokens(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`
  return String(n)
}

function duration(ms) {
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric' })
const whenFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const spanFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

const accountName = (email, uuid) => email || (uuid ? `account ${uuid.slice(0, 8)}` : 'Unknown account')

// ── Colours ──────────────────────────────────────────────────────────────────
// Fixed to the entity, so a model keeps its colour from one week to the next. Six slots; a
// seventh model is grey and says "other" in the legend rather than getting a made-up hue.
const MODEL_ORDER = [
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-fable-5-1',
  'claude-opus-4-8',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
]
const colourOf = (model) => {
  const i = MODEL_ORDER.indexOf(model)
  return i >= 0 ? `var(--s${i + 1})` : 'var(--other)'
}
// Accounts take the slots in the order they were first seen, which does not change either.
const accountColour = (uuid, known) => {
  const i = known.findIndex((a) => a.uuid === uuid)
  return i >= 0 && i < 6 ? `var(--s${i + 1})` : 'var(--other)'
}

// ── The span ─────────────────────────────────────────────────────────────────
const DAY = 86_400_000

/** Monday at midnight, here. The week is yours, so it is the browser that decides where it starts. */
function monday(at) {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}
const plusDays = (at, n) => {
  const d = new Date(at)
  d.setDate(d.getDate() + n)
  return d.getTime()
}

let from = monday(Date.now())
let account = null
let showAll = false
let last = null

try {
  const kept = localStorage.getItem('k0-usage-account')
  if (kept !== null) account = kept
} catch {
  /* private window: the filter is simply not remembered */
}

async function load() {
  const to = plusDays(from, 7)
  const qs = new URLSearchParams({ from, to })
  if (account !== null) qs.set('account', account)
  try {
    last = await api(`/api/usage?${qs}`)
    render(last)
  } catch (e) {
    $('#notes').innerHTML = `<p class="note"><b>Couldn't load the usage:</b> ${esc(e.message)}</p>`
  }
}

// ── Drawing ──────────────────────────────────────────────────────────────────
function render(d) {
  const to = plusDays(from, 7)
  $('#span').textContent = `${spanFmt.format(from)} – ${spanFmt.format(to - 1)} ${new Date(from).getFullYear()}`
  $('#next').disabled = to > Date.now()
  renderAccounts(d)
  renderNotes(d)
  renderTiles(d)
  costChart(d)
  limitsChart(d)
  renderTables(d)
  renderSessions(d)
}

function renderAccounts(d) {
  const sel = $('#account')
  const options = [['', 'All accounts', null]]
    .concat(d.known.map((a) => [a.uuid, accountName(a.email, a.uuid), a.uuid]))
    .concat([['unknown', 'Unknown account', '']])
  const want = account === null ? '' : account === '' ? 'unknown' : account
  sel.innerHTML = options.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('')
  sel.value = want
}

function renderNotes(d) {
  const notes = []
  const r = d.tracking.reading
  if (r.bytes > 0) {
    notes.push(`<b>Still reading the history.</b> ${r.files} transcripts and ${tokens(r.bytes)}B to go; the numbers
      grow as it catches up. It spends no tokens: it only reads files already on this machine.`)
  }
  if (!d.tracking.statusline) {
    notes.push(`<b>No limit samples yet.</b> Claude Code only tells the statusline how full the five-hour and weekly
      limits are, and keeps it nowhere else. Add the few lines from k0's README (<i>Usage → the limits</i>) to your
      statusline and they are written to <code>~/.k0/usage/limits.jsonl</code> as you work.`)
  }
  if (d.totals.unpriced > 0) {
    notes.push(`<b>${tokens(d.totals.unpriced)} tokens have no price.</b> They ran on a model k0's price list does not
      know, so they count as tokens but not as dollars.`)
  }
  $('#notes').innerHTML = notes.map((n) => `<p class="note">${n}</p>`).join('')
}

function renderTiles(d) {
  const t = d.totals
  const now = latestFive(d)
  const tiles = [
    [money(t.cost), 'at API prices', 'what the week would have cost without a subscription'],
    [tokens(t.tokens), 'tokens', `${tokens(t.output)} written by Claude, ${tokens(t.cache_read)} read back from cache`],
    [duration(t.work_ms), 'Claude worked', `across ${t.sessions} session${t.sessions === 1 ? '' : 's'}`],
    [String(t.requests), 'replies', `${tokens(t.thinking)} tokens of them thinking`],
    [String(t.limits), 'times a limit stopped you', t.limits ? 'see the sessions below' : 'not once this week'],
  ]
  if (now) tiles.push([`${Math.round(now.five)}%`, 'of the five-hour limit, last seen', accountName(now.email, now.account)])
  $('#tiles').innerHTML = tiles
    .map(([v, k, s]) => `<div class="tile"><div class="v">${esc(v)}</div><div class="k">${esc(k)}</div><div class="s">${esc(s)}</div></div>`)
    .join('')
}

function latestFive(d) {
  let best = null
  for (const series of d.limits) {
    const s = series.samples.filter((x) => x.five != null).at(-1)
    if (s && (!best || s.at > best.at)) best = { ...s, account: series.account, email: series.email }
  }
  return best
}

// Chart geometry, in the SVG's own units; it scales to the width of the panel.
const W = 900
const H = 240
const PAD = { l: 52, r: 12, t: 12, b: 26 }

function niceMax(v) {
  if (!(v > 0)) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}

function costChart(d) {
  const models = [...new Set(d.days.flatMap((day) => Object.keys(day.models)))].sort(
    (a, b) => (MODEL_ORDER.indexOf(a) + 1 || 99) - (MODEL_ORDER.indexOf(b) + 1 || 99)
  )
  $('#cost-legend').innerHTML =
    models.length > 1
      ? models.map((m) => `<span><i style="background:${colourOf(m)}"></i>${esc(modelName(m))}${MODEL_ORDER.includes(m) ? '' : ' (other)'}</span>`).join('')
      : ''
  const max = niceMax(Math.max(0, ...d.days.map((day) => day.cost)))
  const iw = W - PAD.l - PAD.r
  const ih = H - PAD.t - PAD.b
  const slot = iw / d.days.length
  const bw = Math.min(56, slot * 0.6)
  const y = (v) => PAD.t + ih - (v / max) * ih
  let svg = ''
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i
    svg += `<line class="grid-line" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v)}" y2="${y(v)}"/>`
    svg += `<text class="axis" x="${PAD.l - 8}" y="${y(v) + 4}" text-anchor="end">${esc(money(v))}</text>`
  }
  d.days.forEach((day, i) => {
    const x = PAD.l + slot * i + (slot - bw) / 2
    let base = 0
    const segs = models.filter((m) => day.models[m] > 0)
    segs.forEach((m, j) => {
      const v = day.models[m]
      const top = y(base + v)
      const h = Math.max(0, y(base) - top)
      // A 2px gap of paper between segments, and the rounded end only on the top one.
      const r = j === segs.length - 1 ? Math.min(4, h) : 0
      svg += `<path class="seg" fill="${colourOf(m)}" d="${barPath(x, top, bw, Math.max(0, h - (j ? 2 : 0)), r)}"/>`
      base += v
    })
    if (day.cost > 0) svg += `<text class="label" x="${x + bw / 2}" y="${y(day.cost) - 6}" text-anchor="middle">${esc(money(day.cost))}</text>`
    svg += `<text class="axis" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(dayFmt.format(day.at))}</text>`
    svg += `<rect class="hit" data-day="${i}" x="${PAD.l + slot * i}" y="${PAD.t}" width="${slot}" height="${ih}"/>`
  })
  if (!d.days.some((day) => day.tokens)) {
    svg += `<text class="empty" x="${W / 2}" y="${H / 2}" text-anchor="middle">No session consumed anything this week.</text>`
  }
  const el = $('#cost-chart')
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cost per day by model">${svg}</svg>`
  el.querySelectorAll('.hit').forEach((hit) => {
    const day = d.days[Number(hit.dataset.day)]
    tipOn(hit, () => {
      const rows = models
        .filter((m) => day.models[m] > 0)
        .reverse()
        .map((m) => `<div><i style="background:${colourOf(m)}"></i>${esc(modelName(m))} ${esc(money(day.models[m]))}</div>`)
      return `<b>${esc(dayFmt.format(day.at))} · ${esc(money(day.cost))}</b><div>${tokens(day.tokens)} tokens, ${day.requests} replies</div>${rows.join('')}`
    })
  })
}

/** A bar with only its top corners rounded: the bottom sits on the baseline. */
function barPath(x, y, w, h, r) {
  if (h <= 0) return ''
  const b = y + h
  return `M${x},${b}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${b}Z`
}

function limitsChart(d) {
  const to = plusDays(from, 7)
  const series = d.limits.map((s) => ({ ...s, samples: s.samples.filter((x) => x.week != null) })).filter((s) => s.samples.length)
  $('#limits-caption').textContent = series.length
    ? 'Per account, as the statusline saw it after each reply. It falls back to zero when the week resets.'
    : 'Nothing to draw yet: the statusline has not written any samples for this week.'
  $('#limits-legend').innerHTML =
    series.length > 1
      ? series.map((s) => `<span><i style="background:${accountColour(s.account, d.known)}"></i>${esc(accountName(s.email, s.account))}</span>`).join('')
      : ''
  const iw = W - PAD.l - PAD.r
  const ih = H - PAD.t - PAD.b
  const x = (at) => PAD.l + ((Math.min(Math.max(at, from), to) - from) / (to - from)) * iw
  const y = (v) => PAD.t + ih - (Math.min(100, Math.max(0, v)) / 100) * ih
  let svg = ''
  for (const v of [0, 25, 50, 75, 100]) {
    svg += `<line class="grid-line" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v)}" y2="${y(v)}"/>`
    svg += `<text class="axis" x="${PAD.l - 8}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`
  }
  for (let i = 0; i < 7; i++) {
    const at = plusDays(from, i)
    svg += `<text class="axis" x="${x(at + DAY / 2)}" y="${H - 8}" text-anchor="middle">${esc(dayFmt.format(at))}</text>`
  }
  const dots = []
  for (const s of series) {
    const colour = accountColour(s.account, d.known)
    // The sample before Monday sets where the line starts; it is drawn at the left edge.
    const pts = s.samples.map((p) => [x(p.at), y(p.week), p])
    svg += `<polyline class="line" stroke="${colour}" points="${pts.map(([a, b]) => `${a},${b}`).join(' ')}"/>`
    const end = pts.at(-1)
    svg += `<circle class="dot" cx="${end[0]}" cy="${end[1]}" r="4.5" fill="${colour}"/>`
    svg += `<text class="label" x="${Math.min(end[0] + 8, W - PAD.r - 30)}" y="${end[1] - 8}">${Math.round(end[2].week)}%</text>`
    for (const p of pts) if (p[2].at >= from) dots.push({ x: p[0], y: p[1], p: p[2], s, colour })
  }
  const el = $('#limits-chart')
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly limit used, per account">${svg}
    <rect class="hit" id="limits-hit" x="${PAD.l}" y="${PAD.t}" width="${iw}" height="${ih}"/></svg>`
  // A crosshair's worth of help without the crosshair: the sample nearest the pointer.
  const hit = el.querySelector('#limits-hit')
  if (!dots.length) return
  tipOn(hit, (ev) => {
    const box = hit.ownerSVGElement.getBoundingClientRect()
    const px = ((ev.clientX - box.left) / box.width) * W
    const near = dots.reduce((a, b) => (Math.abs(b.x - px) < Math.abs(a.x - px) ? b : a))
    const five = near.p.five != null ? `, five-hour ${Math.round(near.p.five)}%` : ''
    return `<b><i style="background:${near.colour}"></i>${esc(accountName(near.s.email, near.s.account))}</b><div>${esc(whenFmt.format(near.p.at))}</div><div>week ${Math.round(near.p.week)}%${five}</div>`
  })
}

// ── The tooltip ──────────────────────────────────────────────────────────────
const tip = $('#tip')
function tipOn(el, html) {
  el.addEventListener('mousemove', (ev) => {
    tip.innerHTML = html(ev)
    tip.hidden = false
    const r = tip.getBoundingClientRect()
    tip.style.left = `${Math.min(ev.clientX + 14, innerWidth - r.width - 8)}px`
    tip.style.top = `${Math.min(ev.clientY + 14, innerHeight - r.height - 8)}px`
  })
  el.addEventListener('mouseleave', () => (tip.hidden = true))
}

// ── Tables ───────────────────────────────────────────────────────────────────
const head = (cols) => `<thead><tr>${cols.map(([t, n]) => `<th${n ? ' class="n"' : ''}>${esc(t)}</th>`).join('')}</tr></thead>`
const empty = (span) => `<tr><td colspan="${span}" class="muted">Nothing this week.</td></tr>`

function share(v, total) {
  return total > 0 ? `${Math.round((v / total) * 100)}%` : '—'
}

function renderTables(d) {
  const total = d.totals.cost
  $('#t-models').innerHTML =
    head([['Model'], ['Effort'], ['Replies', 1], ['Tokens', 1], ['Cost', 1], ['Share', 1]]) +
    `<tbody>${
      d.models
        .map(
          (m) => `<tr><td><span class="swatch" style="background:${colourOf(m.model)}"></span>${esc(modelName(m.model))}${
            m.speed === 'fast' ? ' <span class="muted">fast</span>' : ''
          }</td><td>${esc(m.effort || '—')}</td><td class="n">${m.requests}</td><td class="n">${tokens(m.tokens)}</td><td class="n">${
            m.unpriced ? '?' : esc(money(m.cost))
          }</td><td class="n">${share(m.cost, total)}</td></tr>`
        )
        .join('') || empty(6)
    }</tbody>`

  $('#t-agents').innerHTML =
    head([['Who'], ['Replies', 1], ['Tokens', 1], ['Cost', 1], ['Share', 1]]) +
    `<tbody>${
      d.agents
        .map(
          (a) => `<tr><td>${esc(AGENTS[a.agent] ?? a.agent)}</td><td class="n">${a.requests}</td><td class="n">${tokens(a.tokens)}</td><td class="n">${esc(
            money(a.cost)
          )}</td><td class="n">${share(a.cost, total)}</td></tr>`
        )
        .join('') || empty(5)
    }</tbody>`

  $('#t-repos').innerHTML =
    head([['Repository'], ['Tokens', 1], ['Cost', 1], ['Share', 1]]) +
    `<tbody>${
      d.repos
        .map(
          (r) => `<tr><td>${esc(r.project ?? 'outside any repository')}</td><td class="n">${tokens(r.tokens)}</td><td class="n">${esc(
            money(r.cost)
          )}</td><td class="n">${share(r.cost, total)}</td></tr>`
        )
        .join('') || empty(4)
    }</tbody>`

  // Always every account, whatever the filter says: this table is how you choose one.
  const all = d.accounts.reduce((x, a) => x + a.cost, 0)
  $('#t-accounts').innerHTML =
    head([['Account'], ['Tokens', 1], ['Cost', 1], ['Share', 1]]) +
    `<tbody>${
      d.accounts
        .map(
          (a) => `<tr><td><span class="swatch" style="background:${a.uuid ? accountColour(a.uuid, d.known) : 'var(--other)'}"></span>${esc(
            accountName(a.email, a.uuid)
          )}${a.uuid ? '' : '<span class="sub">before k0 was watching which account was signed in</span>'}</td><td class="n">${tokens(
            a.tokens
          )}</td><td class="n">${esc(money(a.cost))}</td><td class="n">${share(a.cost, all)}</td></tr>`
        )
        .join('') || empty(4)
    }</tbody>`
}

const LIMIT = 40

function renderSessions(d) {
  const list = showAll ? d.sessions : d.sessions.slice(0, LIMIT)
  const rows = list.map((s) => {
    const name = s.title || `Session ${s.session_id.slice(0, 8)}`
    const title = s.story
      ? `<a href="/#story-${s.story.id}"><span class="key">${esc(s.story.key)}</span>${esc(name)}</a>`
      : esc(name)
    const models = Object.entries(s.models)
      .sort((a, b) => b[1] - a[1])
      .map(([m]) => {
        const [id, ...rest] = m.split(' · ')
        return esc([modelName(id), ...rest].join(' · '))
      })
      .join('<br>')
    const helpers = (s.agents.sub ?? 0) + (s.agents.workflow ?? 0)
    const via = helpers > 0 && s.cost > 0 ? `<span class="sub">${share(helpers, s.cost)} by agents</span>` : ''
    return `<tr>
      <td>${title}<span class="sub">${esc(s.project ?? '')}${s.accounts.length ? ` · ${esc(s.accounts.join(', '))}` : ''}</span></td>
      <td>${esc(whenFmt.format(s.first_at))}</td>
      <td>${models}</td>
      <td class="n">${s.work_ms ? duration(s.work_ms) : '—'}</td>
      <td class="n">${tokens(s.tokens)}</td>
      <td class="n">${s.unpriced && !s.cost ? '?' : esc(money(s.cost))}${via}</td>
      <td class="n">${s.week_pct != null ? `≈ ${s.week_pct.toFixed(1)}%` : '—'}</td>
      <td class="n">${s.limits ? `<span class="warn">${s.limits}</span>` : ''}</td>
    </tr>`
  })
  $('#t-sessions').innerHTML =
    head([['Session'], ['Started'], ['Model · effort'], ['Worked', 1], ['Tokens', 1], ['Cost', 1], ['Of the week', 1], ['Stopped', 1]]) +
    `<tbody>${rows.join('') || empty(8)}</tbody>`
  const more = $('#more')
  more.hidden = d.sessions.length <= LIMIT
  more.textContent = showAll ? `Show the ${LIMIT} most expensive` : `Show all ${d.sessions.length} sessions`
}

// ── Controls ─────────────────────────────────────────────────────────────────
$('#prev').onclick = () => {
  from = plusDays(from, -7)
  load()
}
$('#next').onclick = () => {
  from = plusDays(from, 7)
  load()
}
$('#account').onchange = (e) => {
  const v = e.target.value
  account = v === '' ? null : v === 'unknown' ? '' : v
  try {
    if (account === null) localStorage.removeItem('k0-usage-account')
    else localStorage.setItem('k0-usage-account', account)
  } catch {
    /* not remembered, still applied */
  }
  load()
}
$('#more').onclick = () => {
  showAll = !showAll
  if (last) renderSessions(last)
}

load()
// The numbers move once a minute at most: the server reads the transcripts at that pace.
whileVisible(load, 30_000)
