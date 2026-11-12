import { check, section } from './harness.mjs'
import { chain, downstream, dropOf, edgesFrom, hitsLoop, route, ties, within } from '../web/arrows.js'

// ── Arrows, without a page ───────────────────────────────────────────────────
// The half of the arrows that decides something: which there are, what a story reaches along
// them, and the curve between two notes. The board in these is the one the feature was asked for:
// a release that waits on three stories, one of which waits on a fourth, and a note off on its own.

const story = (id, deps = [], more = {}) => ({ id, deps: deps.map((d) => ({ id: d, state: 'Working', ...more.dep })), ...more })
const RELEASE = 1
const board = [
  story(RELEASE, [2, 3, 4]),
  story(2),
  story(3, [5]),
  story(4),
  story(5),
  story(9),
]
const edges = edgesFrom(board)
const list = (ids) => [...ids].sort((a, b) => a - b).join(' ')

section('Which arrows there are')
{
  check('one for every story something waits on', edges.length, 4)
  check('from the one that waits to the one it waits on', `${edges[0].from}>${edges[0].to}`, '1>2')
  check('a board with no backlog on it has none', edgesFrom([{ id: 1 }, { id: 2 }]).length, 0)
  check('none of them faded while everything is open', edges.some((e) => e.faded), false)

  const finished = edgesFrom([story(1, [2], { dep: { state: 'Done' } }), story(2, [], { completed_at: 5 })])
  check('an arrow to a finished story is faded', finished[0].faded, true)
  const leaving = edgesFrom([story(1, [2], { completed_at: 5 }), story(2)])
  check('and so is one leaving a finished story', leaving[0].faded, true)
  const said = edgesFrom([story(1, [2], { state: 'Done' }), story(2)])
  check('whichever way the board says it is finished', said[0].faded, true)
}

section('What a story reaches')
{
  check('downstream is what it waits on, all the way down', list(downstream(RELEASE, edges)), '2 3 4 5')
  check('from the middle it is only what is below', list(downstream(3, edges)), '5')
  check('and from the bottom nothing', downstream(5, edges).length, 0)
  check('the chain goes both ways and counts the story itself', list(chain(5, edges)), '1 2 3 4 5')
  check('a note joined to nothing is a chain of one', list(chain(9, edges)), '9')
  check('the arrows of a chain are the ones inside it', within(chain(2, edges), edges).length, 4)
  check('and a chain of one has none', within(chain(9, edges), edges).length, 0)

  const t = ties(3, edges)
  check('a note knows what it waits on', list(t.out), '5')
  check('and what waits on it', list(t.in), '1')
}

section('The arrow that must not be drawn')
{
  check('a note to itself', hitsLoop(2, 2, edges), true)
  check('straight back along an arrow', hitsLoop(2, RELEASE, edges), true)
  check('back up a longer road', hitsLoop(5, RELEASE, edges), true)
  check('across the chain is fine', hitsLoop(2, 5, edges), false)
  check('and so is the same arrow again', hitsLoop(RELEASE, 2, edges), false)
  check('and anything to a note on its own', hitsLoop(9, RELEASE, edges), false)
}

section('Letting go of an arrow')
{
  const show = (d) => (d ? `${d.kind} ${d.to ?? d.path}` : 'nothing')
  check('on another note it is an arrow to that note', show(dropOf({ note: 4 }, RELEASE)), 'link 4')
  check('on a repository it is a new story there', show(dropOf({ repo: '/work/shop' }, RELEASE)), 'new /work/shop')
  check('on the note it left from it is nothing', show(dropOf({ note: RELEASE }, RELEASE)), 'nothing')
  check('on empty board it is nothing', show(dropOf({}, RELEASE)), 'nothing')
  check('with nothing handed over at all it is nothing', show(dropOf(undefined, RELEASE)), 'nothing')
  check('a note wins over a repository', show(dropOf({ note: 4, repo: '/work/shop' }, RELEASE)), 'link 4')
}

section('The curve between two notes')
{
  const a = { x: 0, y: 0, w: 100, h: 60 }
  const right = { x: 300, y: 200, w: 100, h: 60 }
  const below = { x: 0, y: 200, w: 100, h: 60 }

  check('to the right: out of the right edge, in at the left one',
    route(a, right), 'M100 30 C200 30 200 230 300 230')
  check('to the left: the other way round', route(right, a), 'M300 230 C200 230 200 30 100 30')
  check('in the same column it leaves and arrives by the right, bowing out',
    route(a, below), 'M100 30 C186 30 186 230 100 230')
  check('the bow stops growing with the distance',
    route(a, { ...below, y: 4000 }), 'M100 30 C226 30 226 4030 100 4030')
  check('an arrow still in the air ends at the pointer', route(a, { x: 400, y: 90 }), 'M100 30 C250 30 250 90 400 90')
  check('two notes side by side still get a curve', route(a, { x: 104, y: 0, w: 100, h: 60 }), 'M100 30 C130 30 74 30 104 30')
  check('fractions are kept to a tenth', route({ x: 0.26, y: 0, w: 99.99, h: 61 }, right), 'M100.3 30.5 C200.1 30.5 200.1 230 300 230')
}
