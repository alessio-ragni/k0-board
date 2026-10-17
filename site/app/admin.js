// Who has signed up, who has asked to, and the switch that lets them in.
import { api, el, gate, header } from './cloud.js'

const root = document.getElementById('root')
let person = null

function day(iso) { return iso ? new Date(iso).toLocaleDateString() : '' }

function table(heads, rows, empty) {
  if (!rows.length) return el('p', { class: 'empty' }, empty)
  return el('table', { class: 'list' },
    el('thead', {}, el('tr', {}, heads.map(h => el('th', {}, h)))),
    el('tbody', {}, rows))
}

async function setApproved(account, yes, button) {
  button.disabled = true
  try {
    await api('/rest/v1/rpc/k0_set_approved', { method: 'POST', body: { account, yes } })
    await load()
  } catch (e) {
    button.disabled = false
    alert(e.message)
  }
}

async function load() {
  const [accounts, requests] = await Promise.all([
    api('/rest/v1/accounts?select=id,email,name,provider,approved,created_at,approved_at&order=created_at.desc'),
    api('/rest/v1/access_requests?select=email,note,created_at&order=created_at.desc')
  ])
  // Pending first: they are the ones waiting for somebody to do something.
  accounts.sort((a, b) => Number(a.approved) - Number(b.approved))

  const accountRows = accounts.map(a => {
    const button = el('button', { type: 'button', class: a.approved ? 'danger' : 'primary' },
      a.approved ? 'Revoke' : 'Approve')
    button.addEventListener('click', () => setApproved(a.id, !a.approved, button))
    return el('tr', {},
      el('td', {}, el('span', { class: 'tag ' + (a.approved ? 'approved' : 'pending') },
        a.approved ? 'Approved' : 'Pending')),
      el('td', {}, a.email || ''),
      el('td', {}, a.name || ''),
      el('td', {}, a.provider || ''),
      el('td', {}, 'Signed up ' + day(a.created_at), a.approved_at ? ' · approved ' + day(a.approved_at) : ''),
      el('td', {}, button))
  })
  const requestRows = requests.map(r => el('tr', {},
    el('td', {}, r.email || ''), el('td', {}, r.note || ''), el('td', {}, day(r.created_at))))

  const pending = accounts.filter(a => !a.approved).length
  root.replaceChildren(header(person), el('main', { class: 'admin' },
    el('h2', {}, 'Accounts · ' + accounts.length + (pending ? ' · ' + pending + ' pending' : '')),
    table(['Status', 'Email', 'Name', 'Provider', 'Dates', ''], accountRows, 'No accounts yet.'),
    el('h2', {}, 'Access requests · ' + requests.length),
    table(['Email', 'Note', 'Date'], requestRows, 'No requests yet.')))
}

async function start() {
  person = await gate(root)
  if (!person) return
  if (!person.is_admin) {
    root.replaceChildren(header(person), el('main', { class: 'gate' },
      el('h1', {}, 'Admins only'), el('p', {}, 'This page is for admins.')))
    return
  }
  try {
    await load()
  } catch (e) {
    root.replaceChildren(header(person), el('main', { class: 'gate' },
      el('h1', {}, 'Could not load'), el('p', { class: 'error' }, e.message)))
  }
}

start()
