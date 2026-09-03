import { check, section } from './harness.mjs'
import { tree, mark } from '../web/json.js'

// ── A JSON file, laid out ────────────────────────────────────────────────────
// The tree that `web/json.js` builds, and the search that goes with it. The search is the part
// worth proving: it exists because the browser's own find does not look inside a closed branch,
// so if it stopped opening the right ones the file would go back to hiding things.

section('The tree')
{
  const out = tree('{"name":"k0","port":4319,"live":true,"none":null}')
  check('it parses', out.error, null)
  check('the keys are there', out.html.includes('<b class="key">name</b>'), true)
  check('a string is a string', out.html.includes('<span class="v str">k0</span>'), true)
  check('a number is a number', out.html.includes('<span class="v num">4319</span>'), true)
  check('a boolean is a boolean', out.html.includes('<span class="v bool">true</span>'), true)
  check('and null is said, not left blank', out.html.includes('<span class="v nil">null</span>'), true)
}

check('an array counts items', tree('{"tags":["a","b"]}').html.includes('<em>2 items</em>'), true)
check('an object counts keys', tree('{"a":{"b":1}}').html.includes('<em>1 key</em>'), true)
// A fold with nothing inside it is a fold that lies: there is nothing to open.
check('an empty object does not become a fold', tree('{"a":{}}').html.includes('<details'), false)
check('and it says it is empty', tree('{"a":{}}').html.includes('class="v empty">{}'), true)

section('What it arrives showing')
// The first levels are the shape of the file; below that is its contents, and nobody wants a
// `package.json` opened all the way down to every dependency.
check('the top is open', tree('{"a":{"b":{"c":1}}}').html.startsWith('<div class="json"><details class="node" open>'), true)
check(
  'the third level is not',
  (tree('{"a":{"b":{"c":1}}}').html.match(/<details class="node">/g) || []).length,
  1
)

section('Searching inside it')
{
  const doc = '{"scripts":{"test":"node --test"},"name":"k0"}'
  const out = tree(doc, 'node')
  check('it says how many it found', out.matches, 1)
  check('and picks it out', out.html.includes('<mark>node</mark>'), true)
  // This is the whole reason the search lives here rather than in the browser.
  check('the branch holding it is open', out.html.includes('<details class="node" open><summary><b class="key">scripts</b>'), true)
  check('a branch holding nothing is shut', out.html.includes('<details class="node">'), false)
  check('the keys are searched too, not only the values', tree(doc, 'scripts').matches, 1)
  check('and it does not care about case', tree(doc, 'NODE').matches, 1)
  check('a word that is not there finds nothing', tree(doc, 'zzz').matches, 0)
  check('with nothing searched for, nothing is picked out', tree(doc, '').html.includes('<mark>'), false)
}

section('When it is not JSON at all')
// Usually the reason you opened the file. Nothing is invented: the page is told why, and shows
// the text exactly as it is on disk.
{
  const out = tree('{ oops')
  check('there is no tree', out.html, '')
  check('but there is a reason', out.error.length > 0, true)
  check('and nothing is counted', out.matches, 0)
}

section('Nothing gets out as markup')
// The values come from somebody else's repository: a `<script>` in a string is a string.
{
  const out = tree('{"note":"<script>alert(1)</script>"}')
  check('a tag in a value is written, not run', out.html.includes('&lt;script&gt;'), true)
  check('and no real tag survives', out.html.includes('<script>'), false)
  check('a tag in a key is escaped too', tree('{"<b>":1}').html.includes('&lt;b&gt;'), true)
  check('a quote does not break out of an attribute', mark('a"b', '').html, 'a&quot;b')
}

section('Picking a word out of a line')
{
  check('every time it appears', mark('one two one', 'one').n, 2)
  check('and the rest is left alone', mark('a b', 'zz').html, 'a b')
  check('what is around it is still escaped', mark('<a>x</a>', 'x').html, '&lt;a&gt;<mark>x</mark>&lt;/a&gt;')
  check('with nothing to look for it is plain text', mark('abc', '').n, 0)
}
