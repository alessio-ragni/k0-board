// The one place the pages talk to k0 Cloud: sign-in, the session, and fetch with the right headers.
// Supabase is called directly with fetch — no client library — so the pages stay static files.

export const URL_BASE = 'https://pegjzrbsogextluajmjm.supabase.co'
// The publishable key is meant to be public: what it may do is decided by row-level security.
export const KEY = 'sb_publishable_Q-kGvSLvbsxiFikQxO1UEA_QiDsCamH'

const SESSION_KEY = 'k0.cloud.session'
const VERIFIER_KEY = 'k0.cloud.verifier'

// Storage can throw (private windows, blocked site data), and a page that cannot remember a
// session should still render and say so rather than break.
const store = {
  get (area, key) { try { return window[area].getItem(key) } catch { return null } },
  set (area, key, value) { try { window[area].setItem(key, value) } catch {} },
  del (area, key) { try { window[area].removeItem(key) } catch {} }
}

function loadSession () {
  try { return JSON.parse(store.get('localStorage', SESSION_KEY)) } catch { return null }
}
function saveSession (s) {
  const expires = s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600)
  store.set('localStorage', SESSION_KEY, JSON.stringify({
    access_token: s.access_token, refresh_token: s.refresh_token, expires_at: expires
  }))
}
function clearSession () { store.del('localStorage', SESSION_KEY) }

function b64url (bytes) {
  let s = ''
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// The address the provider sends the person back to: this page, without the query that
// carried the last code or error.
function here () { return location.origin + location.pathname }

async function authFetch (path, body, token) {
  const headers = { apikey: KEY, 'Content-Type': 'application/json' }
  if (token) headers.Authorization = 'Bearer ' + token
  const res = await fetch(URL_BASE + path, { method: 'POST', headers, body: JSON.stringify(body || {}) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error_description || data.msg || data.message || 'HTTP ' + res.status)
  return data
}

export async function providers () {
  const res = await fetch(URL_BASE + '/auth/v1/settings', { headers: { apikey: KEY } })
  if (!res.ok) throw new Error('Could not reach k0 Cloud (HTTP ' + res.status + ')')
  const ext = (await res.json()).external || {}
  return ['github', 'google'].filter(p => ext[p] === true)
}

export async function signIn (provider) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)))
  store.set('sessionStorage', VERIFIER_KEY, verifier)
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  const q = new URLSearchParams({
    provider, redirect_to: here(), code_challenge: challenge, code_challenge_method: 's256'
  })
  location.assign(URL_BASE + '/auth/v1/authorize?' + q)
}

// Run once on load: turns ?code= into a session, or ?error= into a message to show.
// Supabase may put the error in the fragment as well as the query, so both are read.
export async function handleReturn () {
  const q = new URLSearchParams(location.search)
  const h = new URLSearchParams(location.hash.slice(1))
  const error = q.get('error') || h.get('error')
  const code = q.get('code')
  if (!error && !code) return null
  history.replaceState(null, '', here())
  if (error) return (q.get('error_description') || h.get('error_description') || error).replace(/\+/g, ' ')
  const verifier = store.get('sessionStorage', VERIFIER_KEY)
  store.del('sessionStorage', VERIFIER_KEY)
  if (!verifier) return 'The sign-in started in another tab or window. Please try again from here.'
  try {
    saveSession(await authFetch('/auth/v1/token?grant_type=pkce', { auth_code: code, code_verifier: verifier }))
    return null
  } catch (e) {
    return e.message
  }
}

let refreshing = null

// A valid access token, refreshed when less than a minute is left; null when signed out.
export async function token () {
  const s = loadSession()
  if (!s || !s.access_token) return null
  if (s.expires_at - Date.now() / 1000 > 60) return s.access_token
  // Two requests racing to refresh would spend the same refresh token twice, and the second loses.
  refreshing = refreshing || authFetch('/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh_token })
    .then(fresh => { saveSession(fresh); return fresh.access_token })
    .catch(() => { clearSession(); return null })
    .finally(() => { refreshing = null })
  return refreshing
}

export async function signOut () {
  const t = await token()
  if (t) await authFetch('/auth/v1/logout', {}, t).catch(() => {})
  clearSession()
  location.assign(here())
}

export class SignedOut extends Error {}

// PostgREST call as the signed-in person. Throws SignedOut if the session is gone.
export async function api (path, { method = 'GET', body } = {}) {
  const t = await token()
  if (!t) throw new SignedOut('Signed out')
  const headers = { apikey: KEY, Authorization: 'Bearer ' + t }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(URL_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  if (res.status === 401) { clearSession(); throw new SignedOut('Signed out') }
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error((data && (data.message || data.error)) || 'HTTP ' + res.status)
  return data
}

export function me () { return api('/rest/v1/rpc/k0_me', { method: 'POST', body: {} }) }

// ── DOM helpers shared by both pages ────────────────────────────────────────
// Everything from the data goes in as text nodes: nothing here ever sets innerHTML.

export function el (tag, attrs, ...children) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue
    if (k === 'class') node.className = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else node.setAttribute(k, v === true ? '' : v)
  }
  for (const c of children.flat()) {
    if (c === undefined || c === null || c === false) continue
    node.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
  return node
}

const LABELS = { github: 'Sign in with GitHub', google: 'Sign in with Google' }

// The header: the name on the left, the person on the right once there is one.
export function header (person, extra) {
  const right = el('div', { class: 'who' })
  if (person) {
    const initial = (person.name || person.email || '?').trim().charAt(0).toUpperCase()
    const avatar = person.avatar_url
      ? el('img', { class: 'avatar', src: person.avatar_url, alt: '', referrerpolicy: 'no-referrer' })
      : el('span', { class: 'avatar' }, initial)
    right.append(avatar, el('span', { class: 'email' }, person.email || person.name || ''),
      el('button', { onclick: signOut }, 'Sign out'))
  }
  return el('header', { class: 'top' },
    el('a', { class: 'brand', href: './' }, 'k0', el('span', {}, ' Cloud')), extra || null, right)
}

// Sign-in gate shared by both pages. Resolves to the person when signed in and approved;
// otherwise renders the right message into `root` and resolves to null.
export async function gate (root) {
  const problem = await handleReturn()
  const show = (person, ...body) => root.replaceChildren(header(person), el('main', { class: 'gate' }, ...body))

  if (await token()) {
    try {
      const person = await me()
      if (person && person.approved) return person
      show(person, el('h1', {}, 'You are on the list'),
        el('p', {}, 'You are on the list — your account opens when it has been approved.'))
      return null
    } catch (e) {
      if (!(e instanceof SignedOut)) {
        show(null, el('h1', {}, 'Something went wrong'), el('p', { class: 'error' }, e.message))
        return null
      }
    }
  }

  const body = [el('h1', {}, 'Sign in to k0 Cloud')]
  if (problem) body.push(el('p', { class: 'error' }, problem))
  try {
    const list = await providers()
    if (list.length) {
      body.push(el('p', {}, 'Your board, as your computer last sent it.'),
        el('div', { class: 'providers' }, list.map(p =>
          el('button', { class: 'primary', onclick: () => signIn(p) }, LABELS[p]))))
    } else {
      body.push(el('p', {}, 'Sign-in is not open yet. Come back soon.'))
    }
  } catch (e) {
    body.push(el('p', { class: 'error' }, e.message))
  }
  show(null, ...body)
  return null
}
