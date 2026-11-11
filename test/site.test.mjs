import { check, section, after } from './harness.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ── The feature pages of k0-board.com ────────────────────────────────────────
// `site/build.mjs` turns one Markdown file per feature into public pages. What is worth proving is
// that nothing it writes can lead a visitor nowhere — a related page that does not exist, a page
// for a feature that is only coming, a sitemap that forgot one — and that `--check` catches a
// site somebody forgot to rebuild. It never touches the real `site/`: every run builds a small
// copy in a temporary directory. Nothing here opens the database or reads the home directory, but
// both are moved anyway, the way every test in here starts.

process.env.K0_DB = path.join(os.tmpdir(), `k0-site-test-${process.pid}.db`)
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-site-home-'))

const site = await import('../site/build.mjs')

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-site-'))
after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true })
  fs.rmSync(process.env.HOME, { recursive: true, force: true })
})

const feature = (head, body = '## What it is\n\nA note.\n') =>
  `---\n${Object.entries(head).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n${body}`

const put = (rel, text) => {
  const p = path.join(ROOT, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text)
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))

put('index.html', '<html><body><h2>What it does</h2>\n<!-- features:start -->\nold cards\n<!-- features:end -->\n</body></html>\n')
put(
  'features/colours.md',
  feature(
    { title: 'Seven colours', card: 'A note is its status.', summary: 'The note is the colour of its status.', order: 10, since: '0.1.0', updated: '2026-11-01', related: 'modes', kicker: 'how it works' },
    '## What it is\n\nRed means [it asks](/features/modes/) something.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'
  )
)
put('features/colours.art.html', '<div class="art-stage"><div class="mini red"></div></div>')
put(
  'features/modes.md',
  feature({ title: 'Four modes', card: 'How awake the Mac stays.', summary: 'Sleep, Away, Nerd, Driving <and more>.', order: 20, updated: '2026-11-02' })
)
put('features/handover.md', feature({ title: 'Handover', card: 'Coming.', summary: 'Soon.', order: 5, status: 'coming' }))

// ── Reading the features ─────────────────────────────────────────────────────
section('Reading the features')
const all = site.readFeatures(path.join(ROOT, 'features'))
check('features come in the order they ask for', all.map((f) => f.slug).join(' '), 'handover colours modes')
check('a list in the header is split on commas', all[1].related.join(' '), 'modes')
check('the drawing beside a feature is picked up', all[1].art.includes('mini red'), true)
check('a feature with no status is live', all[2].status, 'live')
check('a feature marked coming stays coming', all[0].status, 'coming')

let threw = ''
try {
  site.readFeature('bare.md', feature({ title: 'Only a title' }))
} catch (e) {
  threw = e.message
}
check('a header without card and summary is refused', threw, 'bare.md: the header has no summary, card')

const orphanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'k0-site-bad-'))
fs.writeFileSync(path.join(orphanDir, 'a.md'), feature({ title: 'A', card: 'a', summary: 'a', related: 'nowhere' }))
threw = ''
try {
  site.readFeatures(orphanDir)
} catch (e) {
  threw = e.message
}
fs.rmSync(orphanDir, { recursive: true, force: true })
check('a related page that does not exist stops the build', threw, 'a.md: related to nowhere, which has no page')
check('a folder with no features is no features', site.readFeatures(path.join(ROOT, 'none')).length, 0)

// ── Writing the pages ────────────────────────────────────────────────────────
section('Writing the pages')
const written = site.write(ROOT)
check(
  'every page is written the first time',
  written.sort().join(' '),
  'features/colours/index.html features/index.html features/modes/index.html index.html sitemap.xml'
)
check('a feature that is only coming gets no page', exists('features/handover/index.html'), false)

const colours = read('features/colours/index.html')
check('the page has its own canonical address', colours.includes('<link rel="canonical" href="https://k0-board.com/features/colours/">'), true)
check('the summary is the description', colours.includes('<meta name="description" content="The note is the colour of its status.">'), true)
check('the title names k0', colours.includes('<title>Seven colours — k0</title>'), true)
check('the text is laid out as Markdown', colours.includes('<h2>What it is</h2>'), true)
check('a table comes out as a table', colours.includes('<table>'), true)
check('a link to another feature stays on the site', colours.includes('<a href="/features/modes/">it asks</a>'), true)
check('the drawing is on the page', colours.includes('<figure class="art" aria-hidden="true">'), true)
check('the version it arrived in is said', colours.includes('Since k0 0.1.0'), true)
check('the kicker is drawn', colours.includes('<p class="kicker">how it works</p>'), true)
check('the page says what it is to a search engine', colours.includes('"@type":"TechArticle"'), true)
check('every page leads back to all the features', colours.includes('<a class="btn btn-outline" href="/features/">All features</a>'), true)
check('the related feature is offered at the bottom', colours.includes('<a class="card feature-card" href="/features/modes/">'), true)

const modes = read('features/modes/index.html')
check('text in the header is escaped', modes.includes('Sleep, Away, Nerd, Driving &lt;and more&gt;.'), true)
check('a page with no drawing has no empty frame', modes.includes('<figure'), false)
check('a page with no version says none', modes.includes('Since k0'), false)
check('a page with no related ones still leads to its neighbour', modes.includes('href="/features/colours/"'), true)

const index = read('features/index.html')
check('the index lists the coming feature too', index.includes('coming soon'), true)
check('the coming feature is not a link', index.includes('href="/features/handover/"'), false)
check('on the index the coming ones are at the end', index.indexOf('Handover') > index.indexOf('Four modes'), true)

const home = read('index.html')
check('the home page grid is replaced between the markers', home.includes('old cards'), false)
check('the home page keeps what is around the markers', home.startsWith('<html><body><h2>What it does</h2>'), true)
check('the home page grid links every feature', home.includes('href="/features/colours/"') && home.includes('href="/features/modes/"'), true)

const map = read('sitemap.xml')
check('the sitemap lists every page', ['/', '/features/', '/features/colours/', '/features/modes/', '/privacy.html'].every((u) => map.includes(`<loc>https://k0-board.com${u}</loc>`)), true)
check('the sitemap leaves out what has no page', map.includes('handover'), false)
check('the home page is as new as its newest feature', map.includes('<loc>https://k0-board.com/</loc><lastmod>2026-11-02</lastmod>'), true)

// ── Keeping it honest ────────────────────────────────────────────────────────
section('Keeping it honest')
check('a second run writes nothing', site.write(ROOT).length, 0)
check('a site just built is not stale', site.stale(ROOT).length, 0)

put('features/modes.md', read('features/modes.md').replace('Four modes', 'Four modes, one lit'))
check('an edited feature makes its own page stale', site.stale(ROOT).includes('features/modes/index.html'), true)
site.write(ROOT)

// A feature still named as related cannot go back to coming: that is a broken link, caught above.
put('features/colours.md', read('features/colours.md').replace('related: modes', 'related:'))
put('features/modes.md', read('features/modes.md').replace('order: 20', 'order: 20\nstatus: coming'))
check('a page left behind by a feature put back to coming is stale', site.stale(ROOT).includes('features/modes/'), true)
site.write(ROOT)
check('the page left behind is removed', exists('features/modes/index.html'), false)

let markerless = ''
try {
  site.withGrid('<html></html>', [])
} catch (e) {
  markerless = e.message
}
check('a home page without the markers is a mistake, not a no-op', markerless.startsWith('index.html has no'), true)

// ── The colours and the home page ────────────────────────────────────────────
section('The colours and the home page')
check(
  'a cell that names a board colour is shown on it',
  site.swatches('<td>light blue</td><td style="x">red</td>'),
  '<td><span class="swatch sky">light blue</span></td><td style="x"><span class="swatch red">red</span></td>'
)
check('a cell that only mentions a colour is left alone', site.swatches('<td>a red note</td>'), '<td>a red note</td>')

const many = Array.from({ length: 12 }, (_, i) =>
  site.readFeature(`f${i}.md`, feature({ title: `F${i}`, card: 'c', summary: 's', order: i, ...(i % 2 ? { home: 'yes' } : {}) }))
)
const grid = site.homeGrid(many)
check('the home page shows only the features marked for it', grid.includes('/features/f1/') && !grid.includes('/features/f0/'), true)
const unmarked = site.homeGrid(many.map((f) => ({ ...f, home: false })))
check('with none marked it shows two rows at most', (unmarked.match(/feature-card/g) || []).length, site.HOME_MAX)
check('the home page offers all the rest', grid.includes('See all features'), true)

// ── Looking at it before it goes online ──────────────────────────────────────
section('Looking at it before it goes online')
const { serve } = await import('../site/serve.mjs')
put('404.html', '<p>lost</p>')
const server = serve(0, ROOT)
await new Promise((r) => server.on('listening', r))
const base = `http://127.0.0.1:${server.address().port}`
const get = async (p) => {
  const r = await fetch(base + p)
  return { status: r.status, type: r.headers.get('content-type'), text: await r.text() }
}
const page = await get('/features/colours/')
check('a folder answers with its page', page.status, 200)
check('a page is served as HTML', page.type, 'text/html; charset=utf-8')
check('the home page answers', (await get('/')).status, 200)
const lost = await get('/features/nowhere/')
check('a page that is not there answers 404', lost.status, 404)
check('with the site’s own 404 page', lost.text, '<p>lost</p>')
check('nothing outside the folder is served', (await get('/%2e%2e/%2e%2e/etc/passwd')).status, 404)
check('the server answers only this machine', server.address().address, '127.0.0.1')
await new Promise((r) => server.close(r))
