# Security

## What k0 is, from a security point of view

k0 is a local tool. It runs as you, on your machine, and it can open terminals and start
processes in your repositories. That is the whole point of it, and it is also the thing to
understand before installing it.

**The server listens on the loopback interface only** (`127.0.0.1`). It is not reachable from
your network, from your router, or from anywhere else. There is no account, no login and no
token: anything already running as you on this machine can talk to it, and it is worth being
plain about that rather than implying a boundary that is not there. A process running as you
could start those terminals by itself anyway.

**Requests from web pages are refused.** Any site you visit can make requests to `127.0.0.1`,
so two checks stand in the way:

- the `Host` header has to be one k0 recognises, which is what stops DNS rebinding — the trick
  where a hostile domain resolves to `127.0.0.1` so the browser believes it is talking to its
  own site;
- the `Origin` header, when there is one, has to be k0's own. Browsers attach it to every
  cross-origin request and to every same-origin POST, so a hostile page is always identified.

**HTML files from your repositories are shown in a sandbox.** A page that comes off your disk is
text nobody has read; inside the viewer it runs with no permissions and its own opaque origin, so
it cannot reach k0's API. The cost is that web fonts it loads from k0 are refused by the browser,
which is a smaller loss than the alternative.

**File access is bounded twice.** Only directories k0 already knows as repositories can be read,
and inside them every path is resolved and checked against the root both as written and after
following symbolic links.

The backlog's own addresses are the one place where the first of those two bounds is wider, and
deliberately: `/api/backlog` accepts any absolute path that is a checkout — a directory with a
`.git` in it — because the first story in a repository is created by a command running in one k0
has never had a story for, and refusing it would be refusing somebody at the moment they start
using the thing. It reads and writes `<repo>/.k0/` there and nothing else. It is still a bound —
`/etc` and your home directory are not checkouts — but it is "is a repository", not "is a
repository k0 already knows", and the difference is worth stating here rather than leaving to be
discovered.

**One request goes out, and it is about k0.** Once a day k0 asks `registry.npmjs.org` what the
newest published version of `k0-board` is, so the board can say that there is a newer one. The
package name is in the address; there is no query string, no body, no cookie, and a fixed
`user-agent` with no version in it, so two people asking look the same. Nothing about you, your
repositories, your commits or your board is in the request, nothing is downloaded and nothing is
run — k0 cannot update itself. It is off with one preference, `update.check`, and off means no
socket is opened at all. It is written out in full at the top of `server/update.js`, which is the
only file in k0 that reaches outside; every other outbound request in this codebase is a bug.

## What installing it changes

The installer says everything it is about to do before it does any of it, and asks. On macOS the
list can include one `sudoers` rule scoped to two exact commands, and a key binding in your
Terminal profile. Nothing is written before you say yes, each item can be skipped, and
`k0-board uninstall` undoes all of it. See the README for the full list.

The Accessibility permission macOS asks for is granted to your `node`, not to a signed k0 app.
A process with that permission can send keystrokes to any application. k0 uses it for one thing —
placing your prompt in a terminal without sending it — and skipping it breaks nothing: the prompt
gets typed and the session starts by itself.

## Reporting a vulnerability

Please do not open a public issue.

Use GitHub's private reporting — **Security → Report a vulnerability** on
<https://github.com/alessio-ragni/k0-board> — which reaches the maintainer directly.

Expect a first reply within a week. k0 is maintained by one person in his spare time; there is no
bounty and no formal SLA, and it is better to say so than to imply otherwise. Anything that lets
a web page or another user reach k0's API, escape the repository sandbox, or run a command it was
not asked to run will be treated as urgent.

## Supported versions

The latest released version. k0 is pre-1.0 and there are no backports.
