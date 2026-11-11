import { check, section } from './harness.mjs'
import { rank, snippet } from '../web/finder.js'

// ── ⌘K: what turns up, and in what order ─────────────────────────────────────
// A small board: a handful of stories across two repositories, one of them finished. Every
// timestamp is made up and absolute, so the order never depends on when the test runs.

const at = (h) => new Date(Date.UTC(2026, 10, 1, h)).toISOString()
const story = (id, title, extra = {}) => ({
  id,
  key: `K${id}`,
  title,
  description: '',
  status: 'IDLE',
  project_name: 'board',
  updated_at: at(id % 24),
  ...extra,
})

const stories = [
  story(4, 'Login page'),
  story(41, 'Fix the export to PDF'),
  story(42, 'Quick find on the board', { description: 'Slack-like palette, search titles and notes' }),
  story(7, 'Dictation keeps its permissions', { completed_at: at(3), status: 'COMPLETED' }),
  story(9, 'Export the usage chart', { description: 'csv download for the accountant' }),
]
const columns = [
  { path: '/r/board', name: 'board' },
  { path: '/r/astika-import', name: 'astika-import' },
]
const keys = (q) =>
  rank({ stories, columns }, q)
    .map((r) => (r.kind === 'repo' ? `repo:${r.item.name}` : r.item.key))
    .join(' ')
const first = (q) => keys(q).split(' ')[0]

section('A number, with or without its K')
check('42 finds K42', first('42'), 'K42')
check('k42 finds K42', first('k42'), 'K42')
check('K42 finds K42', first('K42'), 'K42')
check('4 puts K4 first, then the keys that start with it', keys('4'), 'K4 K42 K41')
check('a finished story found by its number comes first all the same', first('7'), 'K7')

section('Words of the title')
check('a whole word', first('login'), 'K4')
check('half a word', first('expo'), 'K41')
check('scattered letters', first('qfind'), 'K42')
check('every word has to be there', keys('export pdf'), 'K41')
check('the case does not matter', first('LOGIN'), 'K4')

section('Words of the notes')
check('a word that is only in the notes', first('palette'), 'K42')
check('half a word of the notes', first('accoun'), 'K9')
check('a hit in the notes says so', rank({ stories }, 'palette')[0].notes, true)
check('a hit in the title does not', rank({ stories }, 'login')[0].notes, false)
check('a title hit outranks a notes hit', keys('chart'), 'K9')

section('Repositories and finished stories')
check('a repository by its name', first('astika'), 'repo:astika-import')
check('a repository comes after the open stories', keys('board'), 'K42 repo:board')
check('a finished story comes after everything open', keys('permissions'), 'K7')
check('and after the open ones when both match', keys('i').split(' ').pop(), 'K7')

section('Nothing typed')
check('the open stories, most recent first, no finished ones', keys(''), 'K42 K41 K9 K4')
check('the underlined letters are the ones that matched', rank({ stories }, 'login')[0].at.join(','), '0,1,2,3,4')
check('nothing that is not there', keys('zzqx'), '')

section('The line of the notes shown under a title')
check('short notes as they are', snippet('csv download', 'csv'), 'csv download')
check('empty notes, nothing', snippet('', 'x'), '')
check(
  'long notes cut around the word',
  snippet(`${'a '.repeat(80)}needle ${'b '.repeat(80)}`, 'needle').includes('needle'),
  true
)
