import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  safePath, parseChanged, kindOf, mimeOf, isPage, attachment, list, read, changed, isDoc, hasDocs, grep, plain,
} from '../server/files.js'
import { score, search } from '../web/fuzzy.js'
import { render, esc, matter, titleOf } from '../web/md.js'
import { icon } from '../web/favicon.js'
import { weight, bytes } from '../web/units.js'

// The home directory is moved somewhere disposable before anything else: the repository list
// reads whatever is under it, and several cases here create directories to be listed. Pointed
// at your real home, this test would both litter it and give different answers on every
// machine. `os.homedir()` honours $HOME on POSIX and %USERPROFILE% on Windows.
const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-home-'))
process.env.HOME = FAKE_HOME
process.env.USERPROFILE = FAKE_HOME

// `projects.js` drags in `db.js`, which opens the database the moment it is imported. Nothing
// is written to it here, but the real one is not opened even to read. `K0_DB` first, the
// import after — with a plain `import` at the top it would already be too late.
process.env.K0_DB = path.join(os.tmpdir(), `k0-files-test-${process.pid}.db`)
const { listProjects, onDisk } = await import('../server/projects.js')

// A fake repository with no git: the case of a plain folder of notes, and the one the walk over
// the disk has to hold up on by itself.
const REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-files-'))
fs.mkdirSync(path.join(REPO, 'docs', 'backlog'), { recursive: true })
fs.mkdirSync(path.join(REPO, 'node_modules', 'stuff'), { recursive: true })
fs.mkdirSync(path.join(REPO, '.hidden'), { recursive: true })
fs.writeFileSync(path.join(REPO, 'README.md'), '# Title\n\nA paragraph.\n')
fs.writeFileSync(path.join(REPO, 'docs', 'audit-report.md'), '# Audit\n')
fs.writeFileSync(path.join(REPO, 'docs', 'backlog', 'note.txt'), 'hello')
fs.writeFileSync(path.join(REPO, 'node_modules', 'stuff', 'index.js'), 'no')
fs.writeFileSync(path.join(REPO, '.hidden', 'secret.md'), 'no')
fs.writeFileSync(path.join(REPO, 'binary.bin'), Buffer.from([0, 1, 2, 3, 0, 255]))

const cases = []
const check = (label, got, want) => cases.push([label, got, want, got === want])

// ── The path guard ───────────────────────────────────────────────────────────
// Get this wrong and a hand-written address reads whatever it likes off the disk.
const rel = (p) => (p ? path.relative(fs.realpathSync(REPO), p) : p)

check('a file inside the repository gets through', rel(safePath(REPO, 'README.md')), 'README.md')
check('a subdirectory too', rel(safePath(REPO, 'docs/audit-report.md')), path.join('docs', 'audit-report.md'))
check('dots in the middle are simplified away', rel(safePath(REPO, 'docs/../README.md')), 'README.md')
check('climbing out does not get through', safePath(REPO, '../../.ssh/id_rsa'), null)
check('nor climbing out at the end', safePath(REPO, 'docs/../../../etc/passwd'), null)
check('an absolute path somewhere else does not get through', safePath(REPO, '/etc/passwd'), null)
check('a zero byte in the name does not get through', safePath(REPO, 'READ\0ME.md'), null)
check('a root that does not exist does not get through', safePath('/no/such/place/at/all', 'x.md'), null)

// A symbolic link is the other way out: the path looks like it is inside, but what would open
// is outside.
const SYMLINKS = (() => {
  try {
    fs.symlinkSync('/etc/passwd', path.join(REPO, 'shortcut'))
    fs.symlinkSync('README.md', path.join(REPO, 'inside-link'))
    return true
  } catch {
    // Windows needs a privilege for this that a normal account does not have. The guard is
    // still there; it just cannot be exercised here.
    return false
  }
})()
if (SYMLINKS) {
  check('a link that leads out does not get through', safePath(REPO, 'shortcut'), null)
  // One that stays inside does, and it stays the path you asked for: that is what shows at the
  // top of the page, not the real one behind the link.
  check('a link that stays inside gets through', rel(safePath(REPO, 'inside-link')), 'inside-link')
}

// ── What kind of file is this ────────────────────────────────────────────────
check('markdown gets laid out', kindOf('a/b/plan.md', Buffer.from('# x')), 'markdown')
check('a .js is text you read', kindOf('server/index.js', Buffer.from('const x')), 'text')
check('a .docx is mush, it is not shown', kindOf('Contract.docx', Buffer.from('PK')), 'binary')
check('a PDF gets its own frame', kindOf('invoice.pdf', Buffer.alloc(0)), 'pdf')
// Of an `.html` you want to see the page, not the source: it gets a frame of its own like a
// PDF. Of a `.js` you want to see the actual text, and it stays text.
check('a page is looked at, not read', kindOf('report/index.html', Buffer.from('<!doctype html>')), 'html')
check('and the short spelling counts too', kindOf('old.htm', Buffer.from('<html>')), 'html')
check('a stylesheet stays text', kindOf('web/files.css', Buffer.from('.a{}')), 'text')
check('a PNG is an image', kindOf('photo.png', Buffer.alloc(0)), 'image')
check('with no extension it is tasted: text', kindOf('Makefile', Buffer.from('all:\n\techo')), 'text')
check('with no extension it is tasted: binary', kindOf('blob', Buffer.from([0, 1, 2])), 'binary')
check('an empty file is empty text', kindOf('empty', Buffer.alloc(0)), 'text')
check('the mime type of a PNG', mimeOf('x.PNG'), 'image/png')
check('the mime type of a PDF', mimeOf('x.pdf'), 'application/pdf')
check('the mime type of something unknown', mimeOf('x.docx'), 'application/octet-stream')
// With the wrong type a page comes out naked: the browser does not apply the stylesheet.
check('the mime type of a page', mimeOf('index.HTML'), 'text/html; charset=utf-8')
check('the mime type of a stylesheet', mimeOf('x.css'), 'text/css; charset=utf-8')
check('the mime type of a font', mimeOf('x.woff2'), 'font/woff2')
check('a page is recognised', isPage('report/index.html'), true)
check('a document is not', isPage('note.md'), false)

// ── The name of what gets downloaded ─────────────────────────────────────────
// Getting this wrong means an attachment with the wrong name, or a broken header — and with a
// slash in it, a file written somewhere else entirely.
check(
  'a simple name goes in both forms',
  attachment('note.md'),
  'attachment; filename="note.md"; filename*=UTF-8\'\'note.md'
)
check(
  'accents survive intact in the long form',
  attachment('café.pdf'),
  'attachment; filename="caf_.pdf"; filename*=UTF-8\'\'caf%C3%A9.pdf'
)
check('slashes never reach the browser', attachment('../../etc/passwd').includes('/'), false)
check('newlines do not split the header', attachment('a\r\nb.md').includes('\n'), false)
check('quotes do not close the name early', attachment('a"name.md').includes('"name'), false)
check('an empty name does not leave the field empty', attachment('   '), 'attachment; filename="file"; filename*=UTF-8\'\'file')

// ── The lines of git status ──────────────────────────────────────────────────
// The number of fields before the path changes for each kind of line: get it wrong and you
// show half a path, or none.
const Z = '\0'
check(
  'a modified-file line',
  parseChanged(`1 .M N... 100644 100644 100644 aaa bbb server/git.js${Z}`)[0],
  'server/git.js'
)
check('a file never seen before', parseChanged(`? web/new.js${Z}`)[0], 'web/new.js')
check(
  'a conflicted file',
  parseChanged(`u UU N... 100644 100644 100644 100644 a b c web/board.js${Z}`)[0],
  'web/board.js'
)
{
  // A rename takes two records: the second is the old name, which no longer exists.
  const out = parseChanged(`2 R. N... 100644 100644 100644 aaa bbb R100 web/new.js${Z}web/old.js${Z}? other.md${Z}`)
  check('of a rename it keeps the new name', out[0], 'web/new.js')
  check('and the old name is thrown away', out.includes('web/old.js'), false)
  check('the next line is still read', out[1], 'other.md')
}
check('a path with a space in it stays whole', parseChanged(`? docs/my file.md${Z}`)[0], 'docs/my file.md')
check('empty output, no paths', parseChanged('').length, 0)

// ── The walk over a repository with no git ───────────────────────────────────
{
  const found = await list(REPO)
  const names = found.files.map((f) => f.p).sort()
  check('it is not a git repository', found.git, false)
  check('every document is there', names.join(','), 'README.md,docs/audit-report.md,docs/backlog/note.txt')
  check(
    'code and binaries are not listed',
    names.some((n) => n.endsWith('.bin')),
    false
  )
  check(
    'node_modules stays out',
    names.some((n) => n.includes('node_modules')),
    false
  )
  check(
    'directories starting with a dot stay out',
    names.some((n) => n.includes('hidden')),
    false
  )
  if (SYMLINKS) {
    check(
      'symbolic links stay out',
      names.some((n) => n.includes('link')),
      false
    )
  }
  check(
    'every file has a date',
    found.files.every((f) => f.m > 0),
    true
  )
}
check('with no git there is nothing to say about what changed', (await changed(REPO)).length, 0)

// ── Reading ──────────────────────────────────────────────────────────────────
{
  const md = read(path.join(REPO, 'README.md'))
  check('markdown comes back with its text', md.text.startsWith('# Title'), true)
  check('and it is not cut', md.truncated, false)
  const bin = read(path.join(REPO, 'binary.bin'))
  check('a binary has no contents read', bin.text, undefined)
  check('but it does have a size', bin.size, 6)
}

// ── The repository list ──────────────────────────────────────────────────────
// Under your home there are also directories that are only installed software. They stay
// selectable — a directory you just made has no sign on it yet — but not in the list.
// `hasDocs` caches its answer for five minutes, so every case needs its own directory:
// running it twice on the same one would give the answer from before.
{
  // Data only, nothing to read: the case of a tool that keeps its output under your home.
  const dataOnly = path.join(FAKE_HOME, 'k0-test-data-only')
  fs.mkdirSync(path.join(dataOnly, 'stuff'), { recursive: true })
  fs.writeFileSync(path.join(dataOnly, 'stuff', 'crawl.ndjson'), '{}')
  // One document inside is enough: it is why a folder of notes stays in the list despite having
  // neither a `.git` nor a history in Claude Code.
  const papers = path.join(FAKE_HOME, 'k0-test-with-documents')
  fs.mkdirSync(path.join(papers, 'stuff'), { recursive: true })
  fs.writeFileSync(path.join(papers, 'stuff', 'notes.md'), '# hello')
  // Empty: the directory you just made and have not put anything in yet. It is where a new
  // project starts, and it belongs on the board.
  const fresh = path.join(FAKE_HOME, 'k0-test-empty')
  fs.mkdirSync(fresh, { recursive: true })
  // A file manager scatters metadata files the moment you walk past: empty stays empty.
  const seeded = path.join(FAKE_HOME, 'k0-test-empty-with-metadata')
  fs.mkdirSync(seeded, { recursive: true })
  fs.writeFileSync(path.join(seeded, '.DS_Store'), '')
  // And one with a `.git`, which is a project by any measure.
  const repo = path.join(FAKE_HOME, 'k0-test-git-repo')
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true })

  try {
    const found = listProjects()
    const a = found.find((p) => p.path === dataOnly)
    const b = found.find((p) => p.path === papers)
    const c = found.find((p) => p.path === fresh)
    const d = found.find((p) => p.path === seeded)
    const e = found.find((p) => p.path === repo)
    check('the repositories are found at all', found.length > 0, true)
    check('any directory under your home stays selectable', !!a, true)
    check('but with nothing to read it is not a project', a?.known, false)
    check('with a document inside it is', b?.known, true)
    check('and so is an empty one, which is a project beginning', c?.known, true)
    check('a stray metadata file does not make it full', d?.known, true)
    check('a directory with a .git is one too', e?.known, true)
    check(
      'your home itself is not a repository',
      found.some((p) => p.path === os.homedir()),
      false
    )
  } finally {
    for (const dir of [dataOnly, papers, fresh, seeded, repo]) fs.rmSync(dir, { recursive: true, force: true })
  }
}

// ── The cards of a directory that is gone ────────────────────────────────────
// A column is held up by its cards, and the cards by their directory. Without this rule a
// deleted or renamed directory leaves a column behind forever.
{
  const gone = path.join(os.tmpdir(), 'k0-test-gone')
  fs.rmSync(gone, { recursive: true, force: true })
  const cards = [
    { id: 1, project_path: REPO },
    { id: 2, project_path: gone },
    { id: 3, project_path: REPO },
  ]
  const left = onDisk(cards)
  check(
    'the card of a directory that is gone is not on the board',
    left.some((c) => c.id === 2),
    false
  )
  check('the others all stay', left.map((c) => c.id).join(','), '1,3')
  check('no cards, no columns', onDisk([]).length, 0)
  // Hiding is not deleting: if the directory comes back, so do its cards.
  fs.mkdirSync(gone, { recursive: true })
  try {
    check('and if the directory comes back, so does the card', onDisk(cards).length, 3)
  } finally {
    fs.rmSync(gone, { recursive: true, force: true })
  }
}

// The probe stops at the surface: a document buried at the bottom does not count, or the whole
// disk would have to be walked on every round of the board.
{
  const deep = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-deep-'))
  fs.mkdirSync(path.join(deep, 'a', 'b', 'c', 'd'), { recursive: true })
  fs.writeFileSync(path.join(deep, 'a', 'b', 'c', 'd', 'x.md'), '# at the bottom')
  check('below two levels it stops looking', hasDocs(deep), false)

  const shallow = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-shallow-'))
  fs.mkdirSync(path.join(shallow, 'a'), { recursive: true })
  fs.writeFileSync(path.join(shallow, 'a', 'y.md'), '# near the surface')
  check('but at the surface it does', hasDocs(shallow), true)

  fs.rmSync(deep, { recursive: true, force: true })
  fs.rmSync(shallow, { recursive: true, force: true })
}

// ── Documents only ───────────────────────────────────────────────────────────
// The listing is of things you read and print: in a real repository code is 95% of the files,
// and among two thousand `.tsx` files the document you were after cannot be found.
check('a markdown is a document', isDoc('docs/plan.md'), true)
check('so is an html', isDoc('site/index.html'), true)
check('so is a text file', isDoc('note.txt'), true)
check('so is a PDF', isDoc('invoice.pdf'), true)
check('so is a Word file, which then opens in the file manager', isDoc('Contract.docx'), true)
check('a component is not', isDoc('src/pages/Faq.tsx'), false)
check('a json is not', isDoc('src/config/settings.json'), false)
check('an image is not: it is not a document you read', isDoc('images/x.png'), false)
check('and the extension does not care about case', isDoc('READMEFIRST.MD'), true)

// ── Searching inside the files ───────────────────────────────────────────────
// The name is almost never what makes you remember a document: what stays with you about a
// letter is "the one where the strap broke", and the file is called `2026-07-28_note.md`.
{
  const INSIDE = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-grep-'))
  fs.writeFileSync(
    path.join(INSIDE, '2026-07-28_note.md'),
    'Hello.\n\nThis came out of the session on "the strap that broke", because it was over. We met in a café.\n'
  )
  fs.writeFileSync(path.join(INSIDE, 'shopping.md'), '# Shopping\n\nBread and milk.\n')
  fs.writeFileSync(path.join(INSIDE, 'data.ndjson'), '{"strap": true}')

  const hits = await grep(INSIDE, 'strap')
  check('it finds the document by what is in it', hits.length, 1)
  check('and it is the right one', hits[0]?.p, '2026-07-28_note.md')
  check('and the line it appears on comes back', hits[0]?.line.includes('the strap that broke'), true)
  // The positions are worked out by the server on the real text: the page highlights over them.
  check(
    'with the exact spot to highlight inside it',
    hits[0]?.line.slice(hits[0].at, hits[0].at + hits[0].len),
    'strap'
  )
  check('what is not a document is not even read', (await grep(INSIDE, 'true')).length, 0)

  // The words can be far apart: "strap over" is not a phrase to find whole, it is two words
  // that both have to be there.
  check('two words scattered through the same file', (await grep(INSIDE, 'strap over')).length, 1)
  check('if one is missing, the file is not it', (await grep(INSIDE, 'strap august')).length, 0)
  check('with nothing to search for, no results', (await grep(INSIDE, '   ')).length, 0)

  // Accents: nobody types them into a search box.
  const acc = await grep(INSIDE, 'cafe')
  check('"cafe" finds "café"', acc.length, 1)
  check('and highlights the accented word', acc[0]?.line.slice(acc[0].at, acc[0].at + acc[0].len), 'café')
  check('normalising does not lengthen the string', plain('café').length, 'café'.length)
  check('and it really does drop the accent', plain('Café'), 'cafe')

  fs.rmSync(INSIDE, { recursive: true, force: true })
}

// ── The front matter at the top of a document ────────────────────────────────
// The block between the two rules is not text of the file: it used to end up in the document as
// a paragraph reading "title: ...", which means nothing to a reader.
{
  const src = '---\ntitle: Team Profile\ntype: reference\n---\n# The real title\n\nBody.\n'
  const { data, body } = matter(src)
  check('the title is read from the front matter', data.title, 'Team Profile')
  check('and so are the other fields', data.type, 'reference')
  check('the front matter leaves the body', body.startsWith('# The real title'), true)
  check('and does not end up in the laid-out document', render(src).includes('title:'), false)
  check('the body is laid out, though', render(src).includes('<h1>The real title</h1>'), true)
  check('`name` counts as a title too', titleOf(matter('---\nname: Hello\n---\nx').data), 'Hello')
  check('quotes around the value come off', matter('---\ntitle: "With spaces"\n---\nx').data.title, 'With spaces')
}
check('with no front matter the document stays whole', matter('# Just text').body, '# Just text')
check('and no title is invented', titleOf(matter('# Just text').data), null)
// Three dashes in the middle of the text are a horizontal rule, not front matter.
check('a horizontal rule is not front matter', matter('text\n\n---\n\nmore').data.title, undefined)

// Placeholders nest: a link whose text is code puts one inside the other. With a single pass of
// restoring, the inner one stayed on screen as a little square.
{
  const out = render('Basis: [`03_ARCHITECTURE.md`](docs/03_ARCHITECTURE.md).')
  check('a link with code inside it is put back together', out.includes('<code>03_ARCHITECTURE.md</code>'), true)
  check('and no placeholder is left on screen', /[\uE000\uE001]/.test(out), false)
}

// ── The icon in the browser tab ──────────────────────────────────────────────
// The same colours as the menu bar icon: if they change over there, they change here too.
check('a session waiting for you turns it red', icon('ASK').includes('#f04545'), true)
check('one that is grinding away, blue', icon('WORKING').includes('#3b82f5'), true)
check('nothing going on: outline only', icon(null).includes('fill="none"'), true)
check('and it is not filled', icon(null).includes('#f04545'), false)

// ── Searching the names ──────────────────────────────────────────────────────
check('scattered letters are enough', score('docs/audit-report.md', 'audrep') >= 0, true)
check('if one letter is missing, nothing', score('docs/audit-report.md', 'audxyz'), -1)
check('an empty search scores zero for everybody', score('anything', '   '), 0)
check('the file name beats the directory', score('report/x.md', 'report') < score('x/report.md', 'report'), true)
check('letters together beat letters apart', score('board.css', 'board') > score('b-o-a-r-d.css', 'board'), true)
{
  const files = ['server/sessions.js', 'web/board.css', 'docs/audit-report.md', 'README.md']
  check('it finds the right one', search(files, 'audrep')[0], 'docs/audit-report.md')
  check('with no matches nothing comes back', search(files, 'zzzz').length, 0)
  check('with no search everything comes back', search(files, '').length, 4)
}

// ── Markdown ─────────────────────────────────────────────────────────────────
// These files come off the disk and nobody has looked at them before they are shown.
check('a tag written in the document does not become a tag', render('<script>alert(1)</script>').includes('&lt;script&gt;'), true)
check('and no real script is left', render('<script>alert(1)</script>').includes('<script'), false)
check('javascript: does not become a link', render('[x](javascript:alert(1))').includes('href="#"'), true)
check('a real address does', render('[x](https://example.com)').includes('href="https://example.com"'), true)
check('and it opens in another tab', render('[x](https://example.com)').includes('target="_blank"'), true)

check('the heading', render('# Hello'), '<h1>Hello</h1>')
check('bold', render('a **strong** here').includes('<strong>strong</strong>'), true)
check('italic', render('a *quiet* here').includes('<em>quiet</em>'), true)
check('strikethrough', render('~~gone~~').includes('<del>gone</del>'), true)
// Documents wrap at seventy characters: a bold phrase longer than that is bound to sit on two
// lines, and it used to stay on screen with the asterisks still in it.
check(
  'bold survives a line break in the middle',
  render('it is a role: **in the middle of a room\nthat is watching, you are the place.** They need it.').includes(
    '<strong>in the middle of a room\nthat is watching, you are the place.</strong>'
  ),
  true
)
check('and so does italic', render('a *long\nplan* here').includes('<em>long\nplan</em>'), true)
// But a new paragraph is a new block: bold does not carry across it.
check('between two paragraphs it does not carry', render('first **open\n\nsecond** closed').includes('<strong>'), false)
check('inside code bold does not apply', render('`**x**`').includes('<strong>'), false)
check('and the code stays code', render('`**x**`').includes('<code>**x**</code>'), true)
check('the code fence', render('```js\nconst a = 1\n```').includes('<pre><code class="lang-js">'), true)
check('inside the fence nothing is laid out', render('```\n# not a heading\n```').includes('<h1>'), false)
check('the horizontal rule', render('---'), '<hr>')
check('the quote', render('> said').includes('<blockquote>'), true)
check('the lines of a paragraph join up', render('one\ntwo'), '<p>one\ntwo</p>')
{
  const t = render('| a | b |\n| --- | --: |\n| 1 | 2 |')
  check('the table has its header', t.includes('<th>a</th>'), true)
  check('and its rows', t.includes('<td>1</td>'), true)
  check('and the alignment to the right', t.includes('text-align:right'), true)
}
{
  const l = render('- one\n- two\n  - inside')
  check('the list', (l.match(/<li>/g) || []).length, 3)
  check('and the nested one is inside', l.includes('<ul><li>inside</li></ul></li>'), true)
}
{
  const t = render('- [ ] to do\n- [x] done')
  check('the checkboxes of a plan show up', (t.match(/type="checkbox"/g) || []).length, 2)
  check('and the ticked one is ticked', t.includes('disabled checked'), true)
}
{
  // The part that makes the viewer feel like a code host: the references inside a document lead
  // somewhere instead of breaking.
  const link = (t, kind) => (kind === 'image' ? `/raw/${t}` : `/see/${t}`)
  check('images point at the real bytes', render('![x](images/a.png)', link).includes('src="/raw/images/a.png"'), true)
  check('references point at the viewer', render('[x](../other.md)', link).includes('href="/see/../other.md"'), true)
}
check('quotes in the text do not break an attribute', esc('he "said"'), 'he &quot;said&quot;')

// ── The measurements ─────────────────────────────────────────────────────────
// The weight goes into the signature of the round: if it changed on every byte, the board would
// redraw constantly and the buttons would vanish from under the pointer.
check('under a gigabyte it rounds to tens of MB', weight(312 * 1048576), '310 MB')
check('two nearby values give the same text', weight(311 * 1048576), weight(313.9 * 1048576))
check('above a gigabyte it goes to tenths', weight(1971 * 1048576), '2.0 GB')
check('a small session does not become zero', weight(4 * 1048576), '4 MB')
check("a file's size is exact", bytes(2048), '2 KB')
check('and in bytes when it is small', bytes(6), '6 B')

fs.rmSync(REPO, { recursive: true, force: true })
fs.rmSync(FAKE_HOME, { recursive: true, force: true })
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.K0_DB + suffix, { force: true })

let bad = 0
for (const [label, got, want, ok] of cases) {
  if (!ok) bad++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label} → ${got}${ok ? '' : ` (expected ${want})`}`)
}
console.log(`\n${cases.length - bad}/${cases.length} passed`)
process.exit(bad ? 1 : 0)
