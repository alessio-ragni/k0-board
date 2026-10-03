import { check, section } from './harness.mjs'
import fs from 'node:fs'
import {
  DOC,
  candidates,
  viewerUrl,
  artifactUrl,
  titleOf,
  linkify,
  referencesIn,
} from '../.claude/skills/k0-links/hooks/links.js'

// ── The mod: what Claude names, as links ─────────────────────────────────────
// The mod's hooks need Claude Code to run, and CI has none; what decides anything — which names
// are worth asking about, and how the reply is rewritten — is pure, and is tested here.

const ROOT = '/work/repo'

section('k0-links · which names are worth asking k0 about')
{
  const got = candidates('The plan is in docs/plan.md, the code in server/index.js.', ROOT)
  check('a document is asked about', got.map((c) => c.rel).join(','), 'docs/plan.md')
  check('trailing punctuation is not part of the name', got[0].written, 'docs/plan.md')
}
check(
  'an absolute path inside the repository becomes relative',
  candidates('Wrote /work/repo/out/report.html', ROOT)[0]?.rel,
  'out/report.html'
)
check('an absolute path outside the repository is left out', candidates('See /etc/notes.md', ROOT).length, 0)
check('a hidden path is left out', candidates('In .claude/skills/x/SKILL.md', ROOT).length, 0)
check('a path from home is left out', candidates('See ~/notes.md', ROOT).length, 0)
check('a fenced block is not looked into', candidates('```\nREADME.md\n```', ROOT).length, 0)
check('one spelling is asked about once', candidates('README.md and README.md', ROOT).length, 1)
check(
  'at most sixty names, as the server reads no more',
  candidates(Array.from({ length: 80 }, (_, i) => `f${i}.md`).join(' '), ROOT).length,
  60
)

section('k0-links · addresses')
check(
  "the viewer's address is the one the git mark opens",
  viewerUrl(4319, '/work/my repo', 'docs/a b.md'),
  'http://localhost:4319/files.html?repo=%2Fwork%2Fmy+repo&f=docs%2Fa+b.md'
)
check(
  "an artifact's address is found in what the tool answered",
  artifactUrl('Published. https://claude.ai/code/artifact/ab12-cd34 is private.'),
  'https://claude.ai/code/artifact/ab12-cd34'
)
check('no address, no artifact', artifactUrl('Refused.'), null)
check('the title comes from the page', titleOf('<html><title> Usage  page </title></html>'), 'Usage page')
check('no title, no guess', titleOf('<html></html>'), null)

section('k0-links · rewriting the reply')
{
  const links = new Map([
    ['docs/plan.md', 'http://v/plan'],
    ['plan.md', 'http://v/short'],
    ['Usage page', 'https://claude.ai/artifact/u'],
  ])
  check('a name becomes a link', linkify('Read docs/plan.md.', links), 'Read [docs/plan.md](http://v/plan).')
  check('the longest name wins', linkify('docs/plan.md', links).includes('http://v/short'), false)
  check('backticks stay inside the link', linkify('see `plan.md`', links), 'see [`plan.md`](http://v/short)')
  check('a title becomes a link', linkify('I published the Usage page.', links), 'I published the [Usage page](https://claude.ai/artifact/u).')
  check('a link already there is left alone', linkify('[plan](docs/plan.md)', links), '[plan](docs/plan.md)')
  check('a fenced block is left alone', linkify('```\nplan.md\n```', links), '```\nplan.md\n```')
  check('half a name is not a name', linkify('myplan.md', links), 'myplan.md')
  check('nothing known, nothing changes', linkify('docs/plan.md', new Map()), 'docs/plan.md')
}

section('k0-links · what the last reply pointed at')
{
  const files = new Map([['b.md', 'http://v/b'], ['a.md', 'http://v/a'], ['z.md', 'http://v/z']])
  const artifacts = new Map([['Usage page', 'https://claude.ai/artifact/u']])
  const got = referencesIn('First a.md, then the Usage page, then b.md and a.md again.', files, artifacts)
  check('in the order the reply said them', got.map((r) => r.label).join(','), 'a.md,Usage page,b.md')
  check('a file the reply did not name is not there', got.some((r) => r.label === 'z.md'), false)
}

section('k0-links · the same documents as the viewer')
{
  // The mod is copied out of k0 and cannot import the server's list, so it keeps its own: this
  // is what keeps the two from drifting apart.
  const src = fs.readFileSync(new URL('../server/files.js', import.meta.url), 'utf8')
  const server = [...src.match(/const DOC_EXT = new Set\(\[([\s\S]*?)\]\)/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  check('the extension lists match', [...DOC].sort().join(' '), server.sort().join(' '))
}
