// The early-access form. It writes one row to the `access_requests` table of k0 Cloud and nothing
// else: the publishable key below belongs to the anonymous role, which row-level security lets
// insert into that table and do nothing more — it cannot read the list back, so it is safe to ship.

const ENDPOINT = 'https://pegjzrbsogextluajmjm.supabase.co/rest/v1/access_requests'
const KEY = 'sb_publishable_Q-kGvSLvbsxiFikQxO1UEA_QiDsCamH'
const THANKS = 'You are on the list. You will hear when your account is ready.'

// Deliberately loose: the server is the real judge, and the only thing worth catching here is a
// typo such as a missing @ or a missing dot.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const form = document.getElementById('waitlist')
if (form) wire(form)

function wire(form) {
  const email = form.elements.email
  const note = form.elements.note
  const error = document.getElementById('a-error')
  const button = form.querySelector('button')

  const fail = (message, field) => {
    error.textContent = message
    if (field) {
      field.setAttribute('aria-invalid', 'true')
      field.focus()
    }
  }

  email.addEventListener('input', () => {
    email.removeAttribute('aria-invalid')
    error.textContent = ''
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    error.textContent = ''
    const address = email.value.trim()
    if (!address) return fail('Please enter your email address.', email)
    if (!EMAIL.test(address)) return fail('That does not look like an email address — check it and try again.', email)

    const label = button.textContent
    button.disabled = true
    button.textContent = 'Sending…'
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { apikey: KEY, 'content-type': 'application/json', prefer: 'return=minimal' },
        body: JSON.stringify({ email: address, note: note.value.trim() || null })
      })
      // 409 is the unique index on the address: somebody already asked with it, which for them is
      // the same good news.
      if (response.status === 201 || response.status === 409) return done(form)
      fail('Something went wrong on our side. Please try again in a minute.')
    } catch {
      fail('The request did not get through. Check your connection and try again.')
    }
    button.disabled = false
    button.textContent = label
  })
}

function done(form) {
  const thanks = document.createElement('p')
  thanks.className = 'thanks'
  thanks.setAttribute('role', 'status')
  thanks.setAttribute('tabindex', '-1')
  thanks.textContent = THANKS
  form.replaceWith(thanks)
  thanks.focus()
}
