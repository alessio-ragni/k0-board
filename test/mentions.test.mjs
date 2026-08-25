import { check, section } from './harness.mjs'
import { mentions, countIn } from '../web/mentions.js'

// ── The files a piece of text names ──────────────────────────────────────────
section('The files a piece of text names')
// The fixture is a research repository: notes from customer interviews, laid out the way a
// real one is. Three things about it are load-bearing, and every case below leans on one of
// them: eight `README.md` files in eight directories, three `summary.md` files, and a
// `survey-round-two.md` that the story only ever calls "the survey".
//
// It also carries the trap that started all of this: `onboarding` is both a directory and an
// ordinary word. A text about onboarding says "onboarding" without meaning the directory, and
// a rule that took it literally would carry off that directory's files and leave the honest
// clues with nothing.
//
// The dates are made-up minutes and do one job: say which file was touched last.

const f = (p, m) => ({ p, m, s: 100 })
const REPO = [
  f('README.md', 10),
  f('CLAUDE.md', 11),
  f('interviews/README.md', 20),
  f('interviews/open-questions.md', 21),
  f('interviews/glossary.md', 22),
  f('interviews/billing/summary.md', 30),
  f('interviews/onboarding/journal.md', 40),
  f('interviews/onboarding/summary.md', 41),
  f('interviews/search/summary.md', 31),
  f('billing/plan-picker/README.md', 25),
  f('billing/invoices/README.md', 26),
  f('billing/dunning/README.md', 27),
  f('search/filters/README.md', 28),
  f('onboarding/what-to-fix/README.md', 50),
  f('onboarding/what-to-fix/funnel.md', 51),
  f('onboarding/what-to-fix/from-the-call.md', 52),
  f('onboarding/what-to-fix/talking-to-users.md', 53),
  f('onboarding/what-to-fix/survey-round-two.md', 54),
  f('onboarding/what-to-fix/observations/README.md', 55),
  f('reports/q3-2026/report-august-2026.html', 60),
]

/** The path of an entry's main row, or the directory it opens. */
const head = (e) => (e ? (e.dir ? `${e.dir}/` : e.file.p) : undefined)
const paths = (es) => es.map(head).join(' | ')

// ── What is written out in full ──────────────────────────────────────────────
section('What is written out in full')
{
  const { named, maybe, missing } = mentions('I touched from-the-call.md and that is all', REPO)
  check('a name written out in full is found', paths(named), 'onboarding/what-to-fix/from-the-call.md')
  check('and there is nothing left to guess', maybe.length, 0)
  check('and nothing is missing', missing.length, 0)
}
{
  const { named } = mentions('the entry is in interviews/onboarding/journal.md', REPO)
  check('with the path in front it takes the right one', paths(named), 'interviews/onboarding/journal.md')
}
{
  const { named } = mentions('opened /home/you/research-notes/interviews/onboarding/journal.md', REPO)
  check('an absolute path counts the same as a relative one', paths(named), 'interviews/onboarding/journal.md')
}
{
  const { named } = mentions('it is written in from-the-call.md.', REPO)
  check('a full stop is not part of the name', paths(named), 'onboarding/what-to-fix/from-the-call.md')
}
{
  const { named } = mentions('"from-the-call.md", then (talking-to-users.md).', REPO)
  check(
    'quotes and brackets do not stick to the name',
    paths(named),
    'onboarding/what-to-fix/from-the-call.md | onboarding/what-to-fix/talking-to-users.md'
  )
}
{
  const { named } = mentions('FROM-THE-CALL.MD', REPO)
  check('capitals do not matter', paths(named), 'onboarding/what-to-fix/from-the-call.md')
}

// ── The order is the order of the story ──────────────────────────────────────
section('The order is the order of the story')
{
  const { named } = mentions('first talking-to-users.md, then funnel.md, then from-the-call.md', REPO)
  check(
    'the files come in the order you wrote them',
    paths(named),
    'onboarding/what-to-fix/talking-to-users.md | onboarding/what-to-fix/funnel.md | onboarding/what-to-fix/from-the-call.md'
  )
}

// ── One name, several files ──────────────────────────────────────────────────
section('One name, several files')
{
  const { named } = mentions('I updated README.md', REPO)
  check('of the eight READMEs only one appears', named.length, 1)
  check('and it is the one touched last', head(named[0]), 'onboarding/what-to-fix/observations/README.md')
  check('the other seven wait to one side', named[0].more.length, 7)
  check('and they are in date order', named[0].more[0].p, 'onboarding/what-to-fix/README.md')
  check('but all eight count', countIn(named), 8)
}

// ── What is only guessed at ──────────────────────────────────────────────────
section('What is only guessed at')
{
  const { named, maybe } = mentions('Survey, summary and open-questions are untouched', REPO)
  check('without the dot it does not end up among the certain', named.length, 0)
  check('but it becomes a maybe', maybe.length, 3)
  check('the survey is found from half a name', head(maybe[0]), 'onboarding/what-to-fix/survey-round-two.md')
  check('"summary" takes the most recent of the three', head(maybe[1]), 'interviews/onboarding/summary.md')
  check('and brings the other two along', maybe[1].more.length, 2)
  check('"open-questions" is one on its own', head(maybe[2]), 'interviews/open-questions.md')
}
{
  const { maybe } = mentions("it is in yesterday's journal", REPO)
  check('one short word is enough', head(maybe[0]), 'interviews/onboarding/journal.md')
}
{
  const { named, maybe } = mentions('the file is funnel.md, and I say funnel all the time', REPO)
  check('one already found by name does not come back as a guess', maybe.length, 0)
  check('and it stays among the certain exactly once', named.length, 1)
}
{
  const { maybe } = mentions('it has only 12 of them', REPO)
  check('numbers and short words are not file names', maybe.length, 0)
}

// ── Directories ──────────────────────────────────────────────────────────────
section('Directories')
{
  const { named } = mentions('it is all in onboarding/what-to-fix', REPO)
  check('a directory written as a path is certain', head(named[0]), 'onboarding/what-to-fix/')
  check('and it opens only the files it holds', named[0].files.length, 5)
  check(
    'subdirectories do not come in',
    named[0].files.some((x) => x.p.includes('observations')),
    false
  )
}
{
  const { named, maybe } = mentions('look in what-to-fix', REPO)
  check('a directory named without its path is a maybe', named.length, 0)
  check('but it is still found', head(maybe[0]), 'onboarding/what-to-fix/')
}
{
  // The real case: "onboarding" is an ordinary word before it is a directory, and it must not
  // carry off the onboarding summary and leave "summary" showing somebody else's.
  const { maybe } = mentions('nothing changed on onboarding, and I am leaving the summary as it is', REPO)
  check('a file name beats a directory named with a single word', head(maybe[0]), 'interviews/onboarding/summary.md')
  check('and the directory comes after', head(maybe[1]), 'interviews/onboarding/')
  check('holding only what is left', maybe[1].files.length, 1)
}
{
  const { named, maybe } = mentions('I wrote it in reports/q3-2026/report-august-2026.html', REPO)
  check(
    'a file inside a named directory beats the directory',
    paths(named),
    'reports/q3-2026/report-august-2026.html'
  )
  check('and the directory is not repeated empty', maybe.length, 0)
}

// ── What is not here ─────────────────────────────────────────────────────────
section('What is not here')
{
  const { named, missing } = mentions('I changed plan-2025.md and notes.md', REPO)
  check('a name that does not exist does not invent a file', named.length, 0)
  check('and it says which ones', missing.join(', '), 'plan-2025.md, notes.md')
}
{
  const { missing } = mentions('it is at example.com and at k0.localhost', REPO)
  check('an address is not a missing file', missing.length, 0)
}
{
  const { missing } = mentions('notes.md is gone, I said: notes.md', REPO)
  check('the same name is not reported twice', missing.length, 1)
}

// ── The empty cases ──────────────────────────────────────────────────────────
section('The empty cases')
{
  const { named, maybe, missing } = mentions('', REPO)
  check('empty text finds nothing', named.length + maybe.length + missing.length, 0)
}
{
  const { named, maybe } = mentions('I did nothing at all today', REPO)
  check('text with no names finds nothing', named.length + maybe.length, 0)
}
{
  const { named, maybe, missing } = mentions('from-the-call.md', [])
  check('with no files it finds nothing and does not blow up', named.length + maybe.length + missing.length, 0)
}

// ── The real case, all at once ───────────────────────────────────────────────
section('The real case, all at once')
{
  const text = `Tweaks to the files that were already there
- from-the-call.md: two new warning signs that were absent.
- talking-to-users.md: one more question for them.
- README.md: the new row in the table.
- interviews/onboarding/journal.md: the entry of 10 August.
Survey, summary and open-questions are untouched.`
  const { named, maybe, missing } = mentions(text, REPO)
  check('a real summary gives four certain entries', named.length, 4)
  check('in the order of the story', head(named[0]), 'onboarding/what-to-fix/from-the-call.md')
  check('with the journal taken by its path', head(named[3]), 'interviews/onboarding/journal.md')
  check('and three guesses', maybe.length, 3)
  check('with nothing lost', missing.length, 0)
  check('for eleven certain files', countIn(named), 11)
  check('and five guessed at', countIn(maybe), 5)
}

