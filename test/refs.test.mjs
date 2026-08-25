import { check, section, after } from './harness.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveRel, index, resolve, candidates, worth } from '../web/refs.js'
import { exist } from '../server/files.js'

// ── The references inside a document ─────────────────────────────────────────
section('The references inside a document')
// The fixture is the same research repository the mentions tests use, cut down to what matters
// here: four `README.md` files in four directories, three `summary.md` files, and the PDFs
// inside `out/` — which the viewer's listing skips and which therefore are **not here**, just
// as in real life.

const f = (p) => ({ p, m: 1, s: 100 })
const REPO = [
  f('README.md'),
  f('CLAUDE.md'),
  f('interviews/README.md'),
  f('interviews/open-questions.md'),
  f('interviews/glossary.md'),
  f('interviews/billing/summary.md'),
  f('interviews/onboarding/journal.md'),
  f('interviews/onboarding/summary.md'),
  f('interviews/search/journal.md'),
  f('interviews/search/summary.md'),
  f('billing/invoices/README.md'),
  f('onboarding/what-to-fix/README.md'),
  f('onboarding/what-to-fix/from-the-call.md'),
  f('onboarding/what-to-fix/survey-round-two.md'),
  f('onboarding/what-to-fix/observations/README.md'),
]
const IX = index(REPO)

/** Where `t` points when read from inside `doc`, as one line to compare. */
const at = (t, doc, code = true) => {
  const r = resolve(t, doc, IX, code)
  if (!r) return 'nothing'
  if (r.path) return r.path
  if (r.dir) return `${r.dir}/`
  return `ask: ${r.ask.join(' | ')}`
}

// ── The path relative to the document ────────────────────────────────────────
section('The path relative to the document')
{
  const doc = 'interviews/README.md'
  check("a bare name is looked for in the document's own directory", at('glossary.md', doc), 'interviews/glossary.md')
  check('a path is read relative to the document', at('search/summary.md', doc), 'interviews/search/summary.md')
  check("and it does not take another area's", at('onboarding/summary.md', doc), 'interviews/onboarding/summary.md')
  check('dot dot really does go up', at('../onboarding/what-to-fix/', doc), 'onboarding/what-to-fix/')
  check('a directory written from the root is found all the same', at('interviews/', doc), 'interviews/')
}
{
  const doc = 'onboarding/what-to-fix/survey-round-two.md'
  check("a subdirectory of the document's own", at('observations/', doc), 'onboarding/what-to-fix/observations/')
  check('a path written out from the root', at('interviews/onboarding/journal.md', doc), 'interviews/onboarding/journal.md')
}

// ── Climbing out of a directory ──────────────────────────────────────────────
section('Climbing out of a directory')
{
  check("README.md inside interviews is the interviews one", at('README.md', 'interviews/glossary.md'), 'interviews/README.md')
  check(
    'and inside what-to-fix it is the what-to-fix one',
    at('README.md', 'onboarding/what-to-fix/from-the-call.md'),
    'onboarding/what-to-fix/README.md'
  )
  check('where the directory has none, we climb', at('README.md', 'interviews/onboarding/journal.md'), 'interviews/README.md')
  check('all the way to the root', at('CLAUDE.md', 'interviews/onboarding/journal.md'), 'CLAUDE.md')
}
{
  // No README in the directory and none above: several candidates, no way to choose.
  check('from the root, README.md is the root one', at('README.md', 'CLAUDE.md'), 'README.md')
  check(
    'a name that fits three files and is not on the way up does not become a link',
    at('summary.md', 'CLAUDE.md'),
    'nothing'
  )
  check('while if only one exists, that is the one', at('from-the-call.md', 'CLAUDE.md'), 'onboarding/what-to-fix/from-the-call.md')
}

// ── What is not a reference ──────────────────────────────────────────────────
section('What is not a reference')
check('a word in the middle of a sentence is not a file', worth('README', false), false)
check('not even a long one', worth('formatting', false), false)
check('with a dot and an extension it is', worth('README.md', false), true)
check('a code file is not', worth('src/config.mjs', false), false)
check('and not inside backticks either', worth('src/config.mjs', true), false)
check('a single word inside backticks may be a directory', worth('interviews', true), true)
check('but in the middle of a sentence it is not', worth('interviews', false), false)
check('a value with a space in it is not a path', worth('active: false', true), false)
check('an address is not a file from here', worth('example.com', true), false)
{
  check('a single word that is a directory, inside backticks', at('interviews', 'CLAUDE.md'), 'interviews/')
  check('but not in the middle of a sentence', at('interviews', 'CLAUDE.md', false), 'nothing')
  check('and a word that is nothing stays nothing', at('formatting', 'CLAUDE.md'), 'nothing')
  // Case does not matter for finding it, but what comes back has to be the real path: with
  // `interviews/Onboarding` the directory would open empty.
  check('a directory comes back with the name it has on disk', at('Onboarding', 'interviews/README.md'), 'interviews/onboarding/')
  check('and so does a file', at('GLOSSARY.MD', 'interviews/README.md'), 'interviews/glossary.md')
}

// ── What the listing does not have ───────────────────────────────────────────
section('What the listing does not have')
{
  const doc = 'billing/invoices/README.md'
  check(
    'a PDF inside out/ is not in the listing, so the server is asked',
    at('out/report.pdf', doc),
    'ask: billing/invoices/out/report.pdf | out/report.pdf'
  )
  check('a code file is not even asked about', at('src/config.mjs', doc), 'nothing')
  check('and neither is a hidden directory', at('.claude/skills/x/SKILL.md', 'README.md'), 'nothing')
}

// ── The pieces worth trying, taken from a document ───────────────────────────
section('The pieces worth trying, taken from a document')
{
  const doc = [
    'It produces `out/report.pdf` (9 pages) and `out/report.html`.',
    'The switches are `spacing`, `underline` and `TRUE`.',
    '',
    '```bash',
    'node src/build.mjs   # and in here it says other.md',
    '```',
    '',
    'See also CLAUDE.md and the `interviews/` directory.',
  ].join('\n')
  const got = candidates(doc)
  check('it takes the names with an extension', got.includes('out/report.pdf'), true)
  check('including the ones written mid-sentence', got.includes('CLAUDE.md'), true)
  check('and the directories with a slash', got.includes('interviews/'), true)
  check('single words get through, resolution will throw them out', got.includes('spacing'), true)
  check('but inside a code block nothing is looked at', got.includes('other.md'), false)
}

// ── The relative path, on its own ────────────────────────────────────────────
section('The relative path, on its own')
check('resolveRel cuts the query string off', resolveRel('a/b.md', 'c.md?x=1'), 'a/c.md')
check('and the anchor', resolveRel('a/b.md', 'c.md#here'), 'a/c.md')
check('and it does not get lost climbing too far', resolveRel('a/b.md', '../../../x.md'), 'x.md')

// ── The check on disk, on the server side ────────────────────────────────────
section('The check on disk, on the server side')
// This is the part that really touches the disk: get it wrong here and a name written inside a
// document reads whatever it likes from outside the repository.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-refs-'))
  fs.mkdirSync(path.join(root, 'out'), { recursive: true })
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true })
  fs.writeFileSync(path.join(root, 'out', 'report.pdf'), '%PDF-')
  fs.writeFileSync(path.join(root, 'out', 'build.mjs'), 'no')
  fs.writeFileSync(path.join(root, '.claude', 'SKILL.md'), 'no')
  fs.writeFileSync(path.join(root, 'real.md'), '# yes')

  check('a document inside out/ exists and is confirmed', exist(root, ['out/report.pdf']).join(), 'out/report.pdf')
  check('one that is not there is not confirmed', exist(root, ['out/absent.pdf']).length, 0)
  check('code is not confirmed even when it exists', exist(root, ['out/build.mjs']).length, 0)
  check('nor is anything hidden', exist(root, ['.claude/SKILL.md']).length, 0)
  check('there is no getting out of the repository', exist(root, ['../../../etc/passwd.md']).length, 0)
  check('and none sideways either', exist(root, ['out/../../outside.md']).length, 0)
  check('a directory is not a file', exist(root, ['out']).length, 0)
  check('several paths at once return only the real ones', exist(root, ['real.md', 'fake.md']).join(), 'real.md')
  check('a malformed question breaks nothing', exist(root, null).length, 0)

  after(() => fs.rmSync(root, { recursive: true, force: true }))
}

