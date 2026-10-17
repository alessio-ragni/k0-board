// ── The emails k0 Cloud sends ────────────────────────────────────────────────
// Two moments, and nothing else: somebody leaves their address on k0-board.com, and somebody signs
// in to k0 and waits to be let in. The first gets a line saying they are on the list; the person
// who runs k0 gets told about both, so nobody waits for an approval nobody knows is pending.
//
// The database calls this (see the migration that adds `k0_notify`) with a shared secret, so it is
// deployed without JWT verification and checks that secret instead. The address that receives the
// notices and the Resend key are Supabase secrets: neither is in this repository.

const RESEND = 'https://api.resend.com/emails'
const FROM = 'k0 <hello@mail.k0-board.com>'
const REPLY_TO = 'hello@k0-board.com'

const escape = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

async function send(to, subject, text, html) {
  const res = await fetch(RESEND, {
    method: 'POST',
    headers: { authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject, text, html }),
  })
  if (!res.ok) throw new Error(`Resend said ${res.status}: ${await res.text()}`)
}

const page = (body) => `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.55;color:#2b2b2b;max-width:560px">${body}
<p style="color:#7d7869;font-size:13px">k0 — the board that knows which Claude Code session needs you · <a href="https://k0-board.com" style="color:#7d7869">k0-board.com</a></p></div>`

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  if (req.headers.get('x-k0-hook') !== Deno.env.get('K0_HOOK_SECRET')) return new Response('no', { status: 401 })
  const { kind, email, note, name, provider } = await req.json().catch(() => ({}))
  const owner = Deno.env.get('K0_NOTIFY_EMAIL')
  try {
    if (kind === 'access_request' && email) {
      await send(
        email,
        'You are on the k0 list',
        'Thanks for asking for k0. Accounts open one at a time while k0 Cloud grows, and you will hear from us when yours is ready.\n\n— k0, https://k0-board.com',
        page('<p>Thanks for asking for k0.</p><p>Accounts open one at a time while k0 Cloud grows, and you will hear from us when yours is ready.</p>'),
      )
      if (owner) {
        await send(owner, `k0: ${email} asked for early access`, `${email} asked for early access.\n\n${note || '(no note)'}\n\nhttps://k0-board.com/app/admin.html`,
          page(`<p><strong>${escape(email)}</strong> asked for early access.</p><p>${escape(note) || '<em>No note.</em>'}</p><p><a href="https://k0-board.com/app/admin.html">Open the admin page</a></p>`))
      }
    } else if (kind === 'account' && owner) {
      await send(owner, `k0: ${email || name} signed in and is waiting to be let in`,
        `${name || ''} <${email}> signed in with ${provider || 'a provider'} and is waiting for approval.\n\nhttps://k0-board.com/app/admin.html`,
        page(`<p><strong>${escape(name)}</strong> &lt;${escape(email)}&gt; signed in with ${escape(provider)} and is waiting for approval.</p><p><a href="https://k0-board.com/app/admin.html">Approve on the admin page</a></p>`))
    }
    return new Response('ok')
  } catch (err) {
    return new Response(String(err.message || err), { status: 502 })
  }
})
