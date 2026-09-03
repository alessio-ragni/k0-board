import { check, section } from './harness.mjs'
import { envRows, envTable, highlight } from '../web/conf.js'

// ── Configuration files, laid out ────────────────────────────────────────────
// What `web/conf.js` makes of an `.env` and of the YAML-shaped files next to it. The cases that
// matter are the awkward ones: a value with an `=` in it, a value with a `#` in it, and the
// quotes people put round both.

section('An .env, line by line')
const rows = envRows(
  '# what it is for\nAPI_KEY=abc\nexport PORT=3000\nEMPTY=\nQUOTED="a b"\nURL=https://x/y?a=1\n'
)
const shape = rows.map((r) => r.kind).join(' ')
check('every line is accounted for', shape, 'comment pair pair pair pair pair')
check('a pair is a pair', `${rows[1].key}=${rows[1].value}`, 'API_KEY=abc')
check('`export` in front is not part of the name', rows[2].key, 'PORT')
check('an empty value stays empty', rows[3].value, '')
check('the quotes are not part of the value', rows[4].value, 'a b')
// The first `=` is the separator; the others belong to the value. A query string in a URL is the
// commonest way to get this wrong.
check('only the first = separates', rows[5].value, 'https://x/y?a=1')
check('and the comment is kept', rows[0].text, 'what it is for')

section('The awkward values')
check('a hash after the value is a comment', envRows('A=b # note\n')[0].value, 'b')
check('a hash inside quotes is part of the password', envRows('A="p#ss"\n')[0].value, 'p#ss')
check('single quotes count too', envRows("A='x y'\n")[0].value, 'x y')
check('a blank line is a blank line', envRows('A=1\n\nB=2\n')[1].kind, 'blank')
// A file ends with a newline; that is the end of the file, not an empty row at the bottom of it.
check('the newline at the end is not a row', envRows('A=1\n').length, 1)
check('a line that is neither is left as it was', envRows('nonsense\n')[0].kind, 'raw')
check('and kept whole', envRows('  nonsense  \n')[0].text, '  nonsense  ')

section('The table it becomes')
{
  const html = envTable('# note\nA=1\nB=\n')
  check('the name is the heading of the row', html.includes('<th>A</th>'), true)
  check('the value sits beside it', html.includes('<td class="val">1</td>'), true)
  check('an empty value says so rather than looking like a mistake', html.includes('>empty<'), true)
  check('the comment keeps its own row', html.includes('<tr class="note">'), true)
  // The values come out of somebody else's repository.
  check('a tag in a value is written, not run', envTable('A=<b>\n').includes('&lt;b&gt;'), true)
  check('and a tag in a name too', envTable('<b>=1\n').includes('<th>&lt;b&gt;</th>'), true)
}

section('YAML, TOML and INI')
{
  const html = highlight('# a note\n[tool]\nname: k0\n  - one\nport = 4319\n')
  check('a comment is a comment', html.includes('<span class="c"># a note</span>'), true)
  check('a heading is a heading', html.includes('<span class="sec">[tool]</span>'), true)
  check('a key is picked out', html.includes('<span class="key">name</span>'), true)
  check('and so is its value', html.includes('<span class="v">k0</span>'), true)
  check('an equals sign separates as well as a colon', html.includes('<span class="key">port</span>'), true)
  check('a list item keeps its dash', html.includes('<span class="dash">- </span>'), true)
  // Nothing is parsed, so nothing can be shown that is not in the file.
  check('the indent is kept exactly', highlight('  a: 1\n').includes('  <span class="key">a</span>'), true)
  check('a line it does not recognise is still shown', highlight('just words\n').includes('just words'), true)
  check('a tag in the text is escaped', highlight('a: <b>\n').includes('&lt;b&gt;'), true)
  check('and no real tag survives', highlight('<script>\n').includes('<script>'), false)
}
