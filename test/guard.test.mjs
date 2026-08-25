import { check, section } from './harness.mjs'
import { allowed } from '../server/guard.js'

// The whole of the promise made in SECURITY.md: k0 answers itself and nothing else. There is no
// account and no token behind this, so these few lines are the only thing standing between a web
// page you happen to have open and an API that opens terminals on your machine.
//
// Nothing is started here. The guard reads two headers and a port, which is why it was moved out
// of the server: a promise this size should be readable, and provable, on its own.

const PORT = 4319
const may = (headers) => allowed(headers, PORT)

// ── The address we answer to ─────────────────────────────────────────────────
section('The address we answer to')
check('the loopback address', may({ host: '127.0.0.1:4319' }), true)
check('the name that resolves to it', may({ host: 'localhost:4319' }), true)
check('the name k0 installs for itself', may({ host: 'k0.localhost:4319' }), true)
check('and the same address written the long way', may({ host: '[::1]:4319' }), true)

// A hostile domain that resolves to 127.0.0.1 arrives with its own name in the Host header. This
// is DNS rebinding, and refusing the name is the whole defence against it.
check('a domain pointed at this machine is still not us', may({ host: 'k0.attacker.example:4319' }), false)
check('nor is one that only looks like us', may({ host: 'localhost.attacker.example:4319' }), false)
check('nor one that ends with our name', may({ host: 'evil-localhost:4319' }), false)
// A request that arrives with no Host at all is not a browser following our page.
check('no address at all is not an address', may({}), false)
check('and neither is an empty one', may({ host: '' }), false)

// ── The port is part of the address ──────────────────────────────────────────
section('The port is part of the address')
// Another server on the same machine, on another port, is not this one — and a page it serves is
// a different origin, with a different set of permissions.
check('the right name on the wrong port', may({ host: 'localhost:9999' }), false)
check('the name with no port at all', may({ host: 'localhost' }), false)
check('and a second k0 on another port answers for itself', allowed({ host: 'localhost:5000' }, 5000), true)

// ── Where the request says it came from ──────────────────────────────────────
section('Where the request says it came from')
// A browser attaches Origin to every cross-origin request and to every same-origin POST, so a
// hostile page always identifies itself here.
check('our own page', may({ host: 'localhost:4319', origin: 'http://localhost:4319' }), true)
check('our own page under another of our names', may({ host: 'localhost:4319', origin: 'http://127.0.0.1:4319' }), true)
check('a page from a website', may({ host: 'localhost:4319', origin: 'https://attacker.example' }), false)
check(
  'a page that names us but is not us',
  may({ host: 'localhost:4319', origin: 'http://localhost.attacker.example:4319' }),
  false
)
// https to the same name is a different origin, and it is not one k0 ever serves.
check('the same address over https is not the same origin', may({ host: 'localhost:4319', origin: 'https://localhost:4319' }), false)
check('a page from another port on this machine', may({ host: 'localhost:4319', origin: 'http://localhost:9999' }), false)
// The word a browser sends when it will not say where it came from: not one of ours, so refused.
check('an origin that refuses to say', may({ host: 'localhost:4319', origin: 'null' }), false)

// Things that are not browsers send no Origin: the menu bar icon, curl, the import skill. They
// are already running as you, on your machine, and a header would not tell us anything a hostile
// process could not also write.
check('no origin at all gets through', may({ host: 'localhost:4319' }), true)
check('and an empty one counts as none', may({ host: 'localhost:4319', origin: '' }), true)

// ── Both have to hold ────────────────────────────────────────────────────────
section('Both have to hold')
// A right origin does not rescue a wrong address, and the address is looked at first.
check(
  'our origin does not excuse another address',
  may({ host: 'attacker.example:4319', origin: 'http://localhost:4319' }),
  false
)
