// ── The account, on the board ────────────────────────────────────────────────
// Two things, and only two. A chip at the end of the top bar saying who is signed in and whether
// the cloud has everything — a dot, green when it does, amber while something is waiting to go
// up, grey when k0 Cloud cannot be reached and the board is carrying on by itself. And, until an
// account is linked and let in, a screen in front of the board that says what to do about it.
//
// The screen only appears when there is a way past it: if the cloud has no way of signing in
// switched on yet, there is nothing the person in front of it could do, and blocking their board
// for that would be k0's failure dressed up as theirs. Offline at the first start is the same: the
// screen says so rather than offering buttons that cannot work.

const $ = (sel, root = document) => root.querySelector(sel)

const NAMES = { github: 'GitHub', google: 'Google' }

let last = null

async function get() {
  const res = await fetch('/api/cloud', { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function post(action, body = {}) {
  const res = await fetch(`/api/cloud/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else if (v != null) node.setAttribute(k, v)
  }
  for (const c of children) if (c != null) node.append(c)
  return node
}

// ── The screen in front of the board ─────────────────────────────────────────

let later = false

function gate(s) {
  let box = $('#account-gate')
  const signIn = s.enabled && (!s.linked || !s.approved) && (s.providers?.length || (!s.linked && s.online === false))
  // The move is offered, not imposed: the board keeps working on its own numbers until its owner
  // has looked at the new ones and said yes, and "Not now" really means not now.
  const moving = s.enabled && s.linked && s.approved && s.needs_move && !later
  if (!signIn && !moving) {
    box?.remove()
    document.body.classList.remove('gated')
    return
  }
  if (box?.dataset.kind === 'move' && moving) return
  if (!box) {
    box = el('div', { id: 'account-gate', class: 'account-gate', role: 'dialog', 'aria-modal': 'true' })
    document.body.append(box)
  }
  document.body.classList.add('gated')
  box.dataset.kind = moving ? 'move' : 'gate'
  box.replaceChildren(moving ? move(s) : s.linked ? waiting(s) : signInCard(s))
}

function move(s) {
  const card = el('div', { class: 'gate-card wide' },
    el('h2', {}, 'Move your board to k0 Cloud'),
    el('p', {}, `You are signed in as ${s.email || s.name || 'you'}. The stories already on this machine were numbered here, ` +
      'and from now on a number is one for your whole account, whichever repository and whichever machine. ' +
      'Moving the board renumbers every story and epic once, in the order they were made, renames their files in .k0/, ' +
      'and sends the board up. A copy of the database is kept first.'),
  )
  const table = el('div', { class: 'move-table' })
  const buttons = el('div', { class: 'gate-buttons' })
  const show = el('button', {
    type: 'button',
    onclick: async () => {
      show.disabled = true
      try {
        const res = await fetch('/api/cloud/move', { cache: 'no-store' })
        const plan = await res.json()
        if (!res.ok) throw new Error(plan.error || `HTTP ${res.status}`)
        table.replaceChildren(numbers(plan.rows))
        go.hidden = false
        show.hidden = true
      } catch (err) {
        show.disabled = false
        note(card, err.message)
      }
    },
  }, 'Show me the new numbers')
  const go = el('button', {
    type: 'button',
    class: 'primary',
    hidden: '',
    onclick: async () => {
      go.disabled = true
      try {
        const done = await post('move')
        card.replaceChildren(
          el('h2', {}, 'Moved'),
          el('p', {}, `${done.moved} stories and epics now carry their account-wide numbers, starting at K${done.start}.`),
          el('p', { class: 'gate-note' }, `The copy taken before the move: ${done.backup}`),
          el('p', { class: 'gate-note' }, `Every old number beside its new one: ${done.map}`),
          el('div', { class: 'gate-buttons' }, el('button', { type: 'button', class: 'primary', onclick: () => location.reload() }, 'Back to the board')),
        )
      } catch (err) {
        go.disabled = false
        note(card, err.message)
      }
    },
  }, 'Move it')
  const notNow = el('button', {
    type: 'button',
    onclick: () => {
      later = true
      $('#account-gate')?.remove()
      document.body.classList.remove('gated')
    },
  }, 'Not now')
  buttons.append(show, go, notNow)
  card.append(buttons, table)
  return card
}

/** Old number beside new, a repository at a time, the way the person reading it thinks of them. */
function numbers(rows) {
  const byRepo = new Map()
  for (const r of rows) {
    const name = (r.project_path || '').split(/[\\/]/).filter(Boolean).pop() || r.project_path
    if (!byRepo.has(name)) byRepo.set(name, [])
    byRepo.get(name).push(r)
  }
  const wrap = el('div')
  wrap.append(el('p', { class: 'gate-note' }, `${rows.length} in all, across ${byRepo.size} repositor${byRepo.size === 1 ? 'y' : 'ies'}.`))
  for (const [name, list] of byRepo) {
    wrap.append(el('h3', {}, name))
    const t = el('table')
    t.append(el('tr', {}, el('th', {}, 'Was'), el('th', {}, 'Will be'), el('th', {}, '')))
    for (const r of list) t.append(el('tr', {}, el('td', {}, r.old), el('td', {}, r.new), el('td', {}, `${r.kind === 'epic' ? 'Epic · ' : ''}${r.title}`)))
    wrap.append(t)
  }
  return wrap
}

function signInCard(s) {
  const providers = s.providers || []
  const card = el('div', { class: 'gate-card' },
    el('h2', {}, 'Connect your account'),
    el('p', {}, 'k0 keeps your board in k0 Cloud, so it survives a lost laptop, reaches your other machines and can be read from a browser. ' +
      'It keeps working here without a connection and catches up when it has one.'),
  )
  if (!providers.length) {
    card.append(el('p', { class: 'gate-note' }, 'k0 Cloud cannot be reached right now. Connect to the internet and this page will offer the way in.'))
    return card
  }
  const row = el('div', { class: 'gate-buttons' })
  for (const p of providers) {
    row.append(el('button', {
      type: 'button',
      class: 'primary',
      onclick: async (e) => {
        e.currentTarget.disabled = true
        try {
          const { url } = await post('login', { provider: p })
          location.href = url
        } catch (err) {
          e.currentTarget.disabled = false
          note(card, err.message)
        }
      },
    }, `Continue with ${NAMES[p] || p}`))
  }
  card.append(row)
  card.append(el('p', { class: 'gate-note' }, 'k0 is in early access: after you sign in, your account opens as soon as it has been approved.'))
  return card
}

function waiting(s) {
  const card = el('div', { class: 'gate-card' },
    el('h2', {}, 'You are on the list'),
    el('p', {}, `Signed in as ${s.email || s.name || 'you'}. k0 is in early access, and your account opens as soon as it has been approved — this page notices by itself.`),
  )
  card.append(el('div', { class: 'gate-buttons' },
    el('button', { type: 'button', onclick: () => post('logout').then(refresh) }, 'Use another account'),
  ))
  return card
}

function note(card, text) {
  let n = $('.gate-error', card)
  if (!n) card.append((n = el('p', { class: 'gate-error' })))
  n.textContent = text
}

// ── The chip on the bar ──────────────────────────────────────────────────────

function chip(s) {
  let c = $('#account')
  if (!s.enabled || !s.linked) {
    c?.remove()
    return
  }
  if (!c) {
    c = el('div', { class: 'account', id: 'account' })
    $('.topbar')?.append(c)
  }
  const state = s.online === false ? 'offline' : s.pending > 0 || s.provisional > 0 ? 'pending' : s.sync_error ? 'offline' : 'synced'
  const said = {
    synced: 'Everything is in k0 Cloud.',
    pending: `${s.pending} change${s.pending === 1 ? '' : 's'} on the way to k0 Cloud.`,
    offline: s.sync_error || 'k0 Cloud cannot be reached; the board carries on here and catches up later.',
  }[state]
  const menu = el('div', { class: 'menu account-menu', role: 'menu', hidden: '' },
    el('p', {}, s.email || s.name || ''),
    el('p', { class: 'account-said' }, said),
    el('button', { type: 'button', role: 'menuitem', onclick: () => post('sync').then(refresh) }, 'Sync now'),
    el('button', { type: 'button', role: 'menuitem', onclick: () => post('logout').then(refresh) }, 'Sign out'),
  )
  const button = el('button', {
    type: 'button',
    class: `account-chip ${state}`,
    title: said,
    'aria-label': `Account: ${said}`,
    'aria-haspopup': 'true',
    onclick: (e) => {
      e.stopPropagation()
      menu.hidden = !menu.hidden
    },
  },
    s.avatar_url ? el('img', { src: s.avatar_url, alt: '', referrerpolicy: 'no-referrer' }) : el('span', { class: 'initial' }, (s.email || s.name || '?')[0].toUpperCase()),
    el('span', { class: 'dot', 'aria-hidden': 'true' }),
  )
  c.replaceChildren(button, menu)
  document.addEventListener('click', () => (menu.hidden = true), { once: true })
}

async function refresh() {
  try {
    const s = await get()
    last = s
    gate(s)
    chip(s)
  } catch {
    // The server itself is not answering: the board has its own way of saying that.
  }
}

refresh()
// Often enough to notice an approval or a sync finishing, rarely enough to cost nothing; and not
// at all while the tab is hidden, like everything else on this page.
setInterval(() => {
  if (!document.hidden) refresh()
}, last?.linked && last?.approved ? 15000 : 5000)
