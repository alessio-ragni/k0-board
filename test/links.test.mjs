import { check, section } from './harness.mjs'
import fs from 'node:fs'
import {
  DOC,
  references,
  webUrl,
  absolute,
  inside,
  extOf,
  viewerUrl,
  artifactUrl,
  titleOf,
  artifactsIn,
} from '../.claude/skills/k0-links/hooks/links.js'

// ── The mod: what the last reply pointed at ──────────────────────────────────
// The mod's hooks need Claude Code to run, and CI has none; what decides anything — what in a
// reply is a place, and where it leads — is pure, and is tested here.

const said = (text) => references(text).map((r) => `${r.kind}:${r.written}`).join(' | ')

section('k0-links · what a reply points at')
check(
  'a local address, without its scheme',
  said('Open localhost:4321/projects/furniture/ and pick one.'),
  'web:localhost:4321/projects/furniture/'
)
check('a full address, with the punctuation after it left out', said('See https://example.com/a?b=1.'), 'web:https://example.com/a?b=1')
check('a domain with a path is an address', said('online on alessioragni.com/projects/furniture/.'), 'web:alessioragni.com/projects/furniture/')
check('a domain alone is a name, not a place', said('in the alessioragni.com repo'), '')
check('a folder', said('Photos in docs/projects/sideboard-140/, untouched.'), 'path:docs/projects/sideboard-140/')
check('a path from home and an absolute one', said('~/k0/README.md and /Users/x/docs/'), 'path:~/k0/README.md | path:/Users/x/docs/')
check('no path is found inside an address', said('http://localhost:4319/files.html?f=a/b.md'), 'web:http://localhost:4319/files.html?f=a/b.md')
check('a document named alone, but not a word or a piece of code', said('See README.md, index and app.js.'), 'path:README.md')
check('a fenced block is not looked into', said('```\ncd docs/plan/\n```'), '')
check('in the order the reply said them, once each', said('b/c, then https://x.io/, then b/c'), 'path:b/c | web:https://x.io/')

section('k0-links · where each one leads')
check('a scheme is added to a local address', webUrl('localhost:4321/x'), 'http://localhost:4321/x')
check('and https to a domain', webUrl('alessioragni.com/p/'), 'https://alessioragni.com/p/')
check('a full address is left as it is', webUrl('http://a.b/c'), 'http://a.b/c')
check('a relative path is inside the repository', absolute('docs/plan/', '/work/repo', '/home/me'), '/work/repo/docs/plan')
check('dots are walked', absolute('../other/x.md', '/work/repo', '/home/me'), '/work/other/x.md')
check('home is home', absolute('~/k0/README.md', '/work/repo', '/home/me'), '/home/me/k0/README.md')
check('inside the repository', inside('/work/repo/docs/a.md', '/work/repo'), 'docs/a.md')
check('outside it', inside('/work/other/a.md', '/work/repo'), null)
check('a folder has no extension', extOf('docs/v1.2/'), '.2')
check(
  "the viewer's address is the one the git mark opens",
  viewerUrl(4319, '/work/my repo', 'docs/a b.md'),
  'http://localhost:4319/files.html?repo=%2Fwork%2Fmy+repo&f=docs%2Fa+b.md'
)

section('k0-links · artifacts')
check(
  "an artifact's address is found in what the tool answered",
  artifactUrl('Published. https://claude.ai/code/artifact/ab12-cd34 is private.'),
  'https://claude.ai/code/artifact/ab12-cd34'
)
check('no address, no artifact', artifactUrl('Refused.'), null)
check('the title comes from the page', titleOf('<html><title> Usage  page </title></html>'), 'Usage page')
check('no title, no guess', titleOf('<html></html>'), null)
{
  const known = new Map([['Usage page', 'https://claude.ai/artifact/u'], ['Other one', 'https://claude.ai/artifact/o']])
  const got = artifactsIn('I published the Usage page.', known)
  check('an artifact the reply names by title', got.map((a) => a.url).join(), 'https://claude.ai/artifact/u')
  check('or by its address', artifactsIn('see https://claude.ai/artifact/o', known)[0]?.title, 'Other one')
}

section('k0-links · the same documents as the viewer')
{
  // The mod is copied out of k0 and cannot import the server's list, so it keeps its own: this
  // is what keeps the two from drifting apart.
  const src = fs.readFileSync(new URL('../server/files.js', import.meta.url), 'utf8')
  const server = [...src.match(/const DOC_EXT = new Set\(\[([\s\S]*?)\]\)/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  check('the extension lists match', [...DOC].sort().join(' '), server.sort().join(' '))
}
