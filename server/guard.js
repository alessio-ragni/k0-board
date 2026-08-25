// ── Who is allowed to talk to this server ────────────────────────────────────
// k0 listens on the loopback interface only, which keeps the rest of the network out. What it
// does not keep out is a web page open in your browser: any site can make requests to
// 127.0.0.1, and this API opens terminals and starts sessions.
//
// Two checks close that door.
//
// The `Host` header must be one we recognise. A page cannot forge it, and requiring it stops
// DNS rebinding — the trick where a hostile domain resolves to 127.0.0.1 so the browser thinks
// it is talking to its own site.
//
// The `Origin` header, when there is one, must be ours. Browsers attach it to every
// cross-origin request and to every same-origin POST, so a hostile page is always identified.
// Things that are not browsers — the menu bar icon, curl, the import skill — send none, and
// they are let through: they are already running as you, on your machine, and a header would
// not tell us anything a hostile process could not also write.
//
// It lives in a file of its own so that it can be read, and tested, without starting a server:
// this is the whole of the promise made in SECURITY.md, and it is four lines long.

/** The names this machine answers to. Anything else is somebody else's idea of where we are. */
const NAMES = ['127.0.0.1', 'localhost', 'k0.localhost', '[::1]']

/** Whether a request may be answered, given its headers and the port we are listening on. */
export function allowed(headers, port) {
  const host = String(headers.host || '')
  if (!NAMES.some((name) => host === `${name}:${port}`)) return false
  const origin = headers.origin
  if (origin && !NAMES.some((name) => origin === `http://${name}:${port}`)) return false
  return true
}
