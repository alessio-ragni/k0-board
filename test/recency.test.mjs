import { check, section } from './harness.mjs'
import { lastTouched, busy, cutoff, split, DAY } from '../web/recency.js'

// ── Which repositories are still warm ────────────────────────────────────────
// The story these all tell is one working week. A dozen repositories are open, three of them are
// today's, and the board has to show those three without being asked. The interesting cases are
// the ones where "recent" is not the same thing as "recent according to the clock".
//
// Every timestamp below is absolute and made up. Nothing in here reads the real clock — that is
// the point of the module: what folds a column away is your own last piece of work, not the time
// of day, so the same input has to give the same answer whenever the test happens to run.

const H = 3600e3
const FRI = 1_000_000_000_000 // Friday, late afternoon, as far as these tests are concerned
const MON = FRI + 3 * DAY // three days later: nothing happened over the weekend

const card = (path, at, status = 'COMPLETED') => ({ project_path: path, updated_at: at, status })
const list = (a) => a.join(' ')

// ── An ordinary day ──────────────────────────────────────────────────────────
section('An ordinary day')
{
  const cards = [card('/repo/board', FRI), card('/repo/api', FRI - 2 * H), card('/repo/site', FRI - 30 * H)]
  const paths = ['/repo/api', '/repo/board', '/repo/site']
  const { open, old } = split({ paths, cards })
  check('the ones you have been on today stay', list(open), '/repo/api /repo/board')
  check('the one from the day before yesterday folds', list(old), '/repo/site')
  check('the order they came in is kept', list(split({ paths, cards }).open), '/repo/api /repo/board')
}

// ── Monday morning ───────────────────────────────────────────────────────────
// The case the whole design turns on. Measured from the clock, every column would be older than
// a day and the entire board would fold on the one morning you most need to see where you left
// off. Measured from your last piece of work, Monday shows you Friday.
section('Monday morning')
{
  const cards = [card('/repo/board', FRI), card('/repo/api', FRI - H), card('/repo/site', FRI - 9 * H)]
  const { open, old } = split({ paths: ['/repo/api', '/repo/board', '/repo/site'], cards })
  check('friday is still on the board on monday', list(open), '/repo/api /repo/board /repo/site')
  check('and nothing has folded', old.length, 0)
  check('the cutoff is a day back from the work, not from now', cutoff(lastTouched(cards)), FRI - DAY)
  check('which is well before monday', cutoff(lastTouched(cards)) < MON, true)
}

// ── A session alive in there ─────────────────────────────────────────────────
section('A session alive in there')
{
  const stale = FRI - 30 * H
  const PAIR = ['/repo/board', '/repo/site']
  check(
    'a question waiting in an old column keeps it open',
    list(split({ paths: PAIR, cards: [card('/repo/board', FRI), card('/repo/site', stale, 'ASK')] }).old),
    ''
  )
  check(
    'so does a plan waiting for approval',
    list(split({ paths: ['/repo/site'], cards: [card('/repo/site', stale, 'PLANNED')] }).open),
    '/repo/site'
  )
  check(
    'and it beats a column you put away by hand',
    list(
      split({
        paths: ['/repo/site'],
        cards: [card('/repo/site', stale, 'WORKING')],
        folded: new Set(['/repo/site']),
      }).open
    ),
    '/repo/site'
  )
  check(
    'a column with nothing but backlog in it is not alive',
    list(split({ paths: PAIR, cards: [card('/repo/board', FRI), card('/repo/site', stale, 'BACKLOG')] }).old),
    '/repo/site'
  )
}

// ── Put away by hand ─────────────────────────────────────────────────────────
section('Put away by hand')
{
  const cards = [card('/repo/board', FRI), card('/repo/api', FRI - H)]
  const paths = ['/repo/api', '/repo/board']
  const { open, old } = split({ paths, cards, folded: new Set(['/repo/api']) })
  check('it folds although you were on it an hour ago', list(old), '/repo/api')
  check('and the others are untouched', list(open), '/repo/board')
}

// ── Fetched back for this visit ──────────────────────────────────────────────
section('Fetched back for this visit')
{
  const cards = [card('/repo/board', FRI), card('/repo/site', FRI - 30 * H)]
  const paths = ['/repo/board', '/repo/site']
  check('an old column held open stays open', list(split({ paths, cards, held: new Set(['/repo/site']) }).old), '')
  check(
    'holding it beats having put it away',
    list(split({ paths, cards, folded: new Set(['/repo/site']), held: new Set(['/repo/site']) }).open),
    '/repo/board /repo/site'
  )
}

// ── Boards with nothing much on them ─────────────────────────────────────────
section('Boards with nothing much on them')
{
  const { open, old } = split({ paths: [], cards: [] })
  check('an empty board opens nothing', open.length, 0)
  check('and folds nothing', old.length, 0)
  const only = (at) => list(split({ paths: ['/repo/board'], cards: [card('/repo/board', at)] }).open)
  check('a board of one repository always shows it', only(FRI), '/repo/board')
  check('a card with no timestamp at all does not fold the board', only(null), '/repo/board')
  check('with nothing touched there is no line to draw', cutoff(new Map()), 0)
}

// ── The pieces on their own ──────────────────────────────────────────────────
section('The pieces on their own')
{
  const cards = [card('/repo/board', FRI - 5 * H), card('/repo/board', FRI), card('/repo/api', FRI - H, 'IDLE')]
  const touched = lastTouched(cards)
  check('a repository is as fresh as its freshest card', touched.get('/repo/board'), FRI)
  check('one card is enough for the others', touched.get('/repo/api'), FRI - H)
  check('your turn counts as alive', busy(cards).has('/repo/api'), true)
  check('finished work does not', busy(cards).has('/repo/board'), false)
  const { alive } = split({ paths: ['/repo/api'], cards })
  check('and split says who is alive as well', list([...alive]), '/repo/api')
}
