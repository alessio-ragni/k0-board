#!/usr/bin/env node
// ── The feature pages of k0-board.com ────────────────────────────────────────
// Every feature of k0 is one Markdown file in `site/features/`, and this turns them into pages:
// one page per feature at `/features/<slug>/`, the index at `/features/`, the grid on the home
// page and the sitemap. The pages it writes are committed, so the site stays what it was — static
// files served as they are, with nothing to run when it is deployed. Running this is the only
// step, and `--check` says whether somebody forgot it.
//
//   node site/build.mjs           write every page
//   node site/build.mjs --check   write nothing; fail if a page on disk is not what would be written
//
// It reads the Markdown with the renderer the board already uses for documents, so there is
// still no dependency and still no second dialect of Markdown to learn.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { matter, render, esc } from '../web/md.js'

export const ORIGIN = 'https://k0-board.com'

// The pages written by hand that the sitemap lists as well, with the day they last changed.
const STATIC = [
  { loc: '/privacy.html', lastmod: '2026-10-17' },
  { loc: '/terms.html', lastmod: '2026-10-17' },
]
const HOME_LASTMOD = '2026-10-17'

const START = '<!-- features:start -->'
const END = '<!-- features:end -->'

/**
 * One feature, from its file. The header carries what the pages need around the text; lists are
 * written comma-separated on one line, because the header reader only knows `key: value`.
 */
export function readFeature(file, text, art = '') {
  const { data, body } = matter(text)
  const slug = path.basename(file, '.md')
  const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean)
  const missing = ['title', 'summary', 'card'].filter((k) => !data[k])
  if (missing.length) throw new Error(`${file}: the header has no ${missing.join(', ')}`)
  return {
    slug,
    title: data.title,
    summary: data.summary,
    card: data.card,
    kicker: data.kicker || '',
    order: Number(data.order) || 999,
    status: data.status === 'coming' ? 'coming' : 'live',
    home: /^(yes|true)$/i.test(String(data.home || '')),
    since: data.since || '',
    updated: data.updated || HOME_LASTMOD,
    stories: list(data.stories),
    related: list(data.related),
    body,
    art,
  }
}

/**
 * A file as text with Unix line endings. Git on Windows checks the whole tree out with CRLF, the
 * Markdown and the pages already built alike: read as they are, every page there would look
 * out of date next to the one the same sources make on a Mac, and the check would fail on a
 * site that is perfectly up to date.
 */
const text = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

/** Every feature in the folder, in the order they are meant to be read. */
export function readFeatures(dir) {
  if (!fs.existsSync(dir)) return []
  const out = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const artFile = path.join(dir, f.replace(/\.md$/, '.art.html'))
      const art = fs.existsSync(artFile) ? text(artFile).trim() : ''
      return readFeature(f, text(path.join(dir, f)), art)
    })
  out.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug))
  const live = new Set(out.filter((f) => f.status === 'live').map((f) => f.slug))
  // A related page that does not exist is a broken link on a public page: better to stop here.
  for (const f of out) {
    const bad = f.related.filter((r) => !live.has(r))
    if (bad.length) throw new Error(`${f.slug}.md: related to ${bad.join(', ')}, which has no page`)
  }
  return out
}

const url = (f) => `/features/${f.slug}/`

/** What every page shares above the content. `here` marks the nav entry of the page you are on. */
export function head({ title, description, canonical, type = 'website', extra = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${ORIGIN}${canonical}">
  <meta property="og:type" content="${type}">
  <meta property="og:site_name" content="k0">
  <meta property="og:url" content="${ORIGIN}${canonical}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta name="twitter:card" content="summary">
  <meta name="theme-color" content="#f3f1ea" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#1b1a17" media="(prefers-color-scheme: dark)">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap">
  <link rel="stylesheet" href="/site.css">${extra}
</head>`
}

export const header = () => `  <a class="skip" href="#main">Skip to content</a>

  <header class="wrap site-header">
    <a class="logo" href="/" aria-label="k0, home">k0</a>
    <nav class="site-nav" aria-label="Main">
      <a href="/features/">Features</a>
      <a href="/features/statuses/">How it works</a>
      <a href="/#pricing">Pricing</a>
      <a href="https://github.com/alessio-ragni/k0-board">GitHub</a>
      <a href="/app/">Sign in</a>
    </nav>
    <a class="btn" href="/#access">Get early access</a>
  </header>`

export const footer = () => `  <footer class="wrap site-footer">
    <span>k0 · source-available under the Sustainable Use License · made by Alessio Ragni</span>
    <span class="footer-links">
      <a href="/features/">Features</a>
      <a href="https://github.com/alessio-ragni/k0-board">GitHub</a>
      <a href="/privacy.html">Privacy</a>
      <a href="/terms.html">Terms</a>
    </span>
  </footer>
</body>
</html>
`

/** One card: a link when the feature has a page, a plain card marked "coming soon" when not. */
export function card(f, level = 3) {
  const inner = `<h${level}>${esc(f.title)}</h${level}>
          <p>${esc(f.card)}</p>`
  if (f.status === 'coming') {
    return `        <article class="card feature-card is-coming">
          <span class="coming">coming soon</span>
          ${inner}
        </article>`
  }
  return `        <a class="card feature-card" href="${url(f)}">
          ${inner}
          <span class="more" aria-hidden="true">Read more →</span>
        </a>`
}

/** The page of one feature. */
export function featurePage(f, all) {
  const live = all.filter((x) => x.status === 'live')
  const i = live.findIndex((x) => x.slug === f.slug)
  const prev = live[(i - 1 + live.length) % live.length]
  const next = live[(i + 1) % live.length]
  // Related first, in the order written; then the neighbours, so every page leads somewhere.
  const picked = f.related.map((s) => live.find((x) => x.slug === s))
  for (const x of [next, prev]) if (x !== f && !picked.includes(x) && picked.length < 3) picked.push(x)

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: f.title,
    description: f.summary,
    url: `${ORIGIN}${url(f)}`,
    dateModified: f.updated,
    isPartOf: { '@type': 'WebSite', name: 'k0', url: `${ORIGIN}/` },
    about: { '@type': 'SoftwareApplication', name: 'k0', applicationCategory: 'DeveloperApplication' },
  }
  // `<` would let the text close the script tag; the escape keeps it inside the JSON.
  const json = JSON.stringify(ld).replace(/</g, '\\u003c')

  return `${head({
    title: `${f.title} — k0`,
    description: f.summary,
    canonical: url(f),
    type: 'article',
    extra: `\n  <script type="application/ld+json">${json}</script>`,
  })}
<body>
${header()}

  <main id="main" class="wrap feature">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/features/">Features</a> <span aria-hidden="true">/</span> <span>${esc(f.title)}</span></nav>
    <div class="feature-top">
      <div class="feature-copy">
${f.kicker ? `        <p class="kicker">${esc(f.kicker)}</p>\n` : ''}        <h1>${esc(f.title)}</h1>
        <p class="lede">${esc(f.summary)}</p>
${f.since ? `        <p class="small">Since k0 ${esc(f.since)}</p>\n` : ''}      </div>
${f.art ? `      <figure class="art" aria-hidden="true">\n${f.art}\n      </figure>\n` : ''}    </div>

    <article class="prose">
${swatches(render(f.body))}
    </article>

    <section class="more-features" aria-labelledby="more-title">
      <h2 id="more-title">Keep reading</h2>
      <div class="grid">
${picked.map((x) => card(x)).join('\n')}
      </div>
      <p class="pager">
        <a href="${url(prev)}">← ${esc(prev.title)}</a>
        <a class="btn btn-outline" href="/features/">All features</a>
        <a href="${url(next)}">${esc(next.title)} →</a>
      </p>
    </section>

    <section class="cta" aria-label="Get early access">
      <p>k0 is in early access. Leave your address and you will hear when your account is ready.</p>
      <a class="btn" href="/#access">Get early access</a>
    </section>
  </main>

${footer()}`
}

/** `/features/`: every feature, the ones still coming at the end. */
export function indexPage(all) {
  const ordered = [...all.filter((f) => f.status === 'live'), ...all.filter((f) => f.status === 'coming')]
  return `${head({
    title: 'Features — k0',
    description:
      'Everything k0 does for people who run ten Claude Code sessions at once, one short page per feature.',
    canonical: '/features/',
  })}
<body>
${header()}

  <main id="main" class="wrap section">
    <h1>Features</h1>
    <p class="intro">One short page for each thing k0 does, and why it does it.</p>
    <div class="grid">
${ordered.map((f) => card(f, 2)).join('\n')}
    </div>
  </main>

${footer()}`
}

/** The cards on the home page, between the two markers. */
// The home page shows only the features marked `home: yes`, and never more than two rows of four,
// so it stays a taste and not a list of everything; /features/ has the rest. With none marked it
// takes the first ones in order.
export const HOME_MAX = 8
export function homeGrid(all) {
  const shown = all.some((f) => f.home) ? all.filter((f) => f.home) : all
  const ordered = [...shown.filter((f) => f.status === 'live'), ...shown.filter((f) => f.status === 'coming')].slice(0, HOME_MAX)
  return `${START}
      <div class="grid grid-compact">
${ordered.map((f) => card(f)).join('\n')}
      </div>
      <p class="see-all"><a class="btn btn-outline" href="/features/">See all features</a></p>
      ${END}`
}

// A table cell that is nothing but the name of a board colour is shown on that colour, like a
// small note, so a table of statuses reads at a glance instead of as a list of words.
const COLOURS = { grey: 'grey', red: 'red', amber: 'amber', yellow: 'yellow', blue: 'blue', 'light blue': 'sky', green: 'green' }
export function swatches(html) {
  return html.replace(/<td([^>]*)>(grey|red|amber|yellow|blue|light blue|green)<\/td>/g, (_, attrs, word) =>
    `<td${attrs}><span class="swatch ${COLOURS[word]}">${word}</span></td>`
  )
}

/** The home page with its grid replaced. Without the markers it is a mistake, not a no-op. */
export function withGrid(html, all) {
  const a = html.indexOf(START)
  const b = html.indexOf(END)
  if (a < 0 || b < a) throw new Error(`index.html has no ${START} … ${END}`)
  return html.slice(0, a) + homeGrid(all) + html.slice(b + END.length)
}

export function sitemap(all) {
  const live = all.filter((f) => f.status === 'live')
  const newest = live.reduce((m, f) => (f.updated > m ? f.updated : m), HOME_LASTMOD)
  const rows = [
    { loc: '/', lastmod: newest },
    { loc: '/features/', lastmod: newest },
    ...live.map((f) => ({ loc: url(f), lastmod: f.updated })),
    ...STATIC,
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows.map((r) => `  <url><loc>${ORIGIN}${r.loc}</loc><lastmod>${r.lastmod}</lastmod></url>`).join('\n')}
</urlset>
`
}

/** Every file the site should hold, as path (relative to `site/`) → content. */
export function build(root) {
  const all = readFeatures(path.join(root, 'features'))
  const files = new Map()
  for (const f of all.filter((x) => x.status === 'live')) files.set(`features/${f.slug}/index.html`, featurePage(f, all))
  files.set('features/index.html', indexPage(all))
  files.set('index.html', withGrid(text(path.join(root, 'index.html')), all))
  files.set('sitemap.xml', sitemap(all))
  return { all, files }
}

/**
 * The pages on disk that disagree with what would be written, and the feature folders left behind
 * by a feature that was renamed, removed or put back to "coming".
 */
export function stale(root) {
  const { files } = build(root)
  const out = []
  for (const [rel, page] of files) {
    const p = path.join(root, rel)
    if (!fs.existsSync(p) || text(p) !== page) out.push(rel)
  }
  for (const rel of orphans(root, files)) out.push(rel)
  return out
}

function orphans(root, files) {
  const dir = path.join(root, 'features')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !files.has(`features/${d.name}/index.html`))
    .map((d) => `features/${d.name}/`)
}

export function write(root) {
  const { files } = build(root)
  for (const rel of orphans(root, files)) fs.rmSync(path.join(root, rel), { recursive: true, force: true })
  const changed = []
  for (const [rel, page] of files) {
    const p = path.join(root, rel)
    if (fs.existsSync(p) && text(p) === page) continue
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, page)
    changed.push(rel)
  }
  return changed
}

/* c8 ignore start — the command line around the functions above, which the tests call directly */
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.dirname(fileURLToPath(import.meta.url))
  if (process.argv.includes('--check')) {
    const bad = stale(root)
    if (bad.length) {
      console.error(`The site is out of date — run \`npm run site\`:\n  ${bad.join('\n  ')}`)
      process.exit(1)
    }
    console.log('The site is up to date.')
  } else {
    const changed = write(root)
    console.log(changed.length ? `Written:\n  ${changed.join('\n  ')}` : 'Nothing to write: the site is up to date.')
  }
}
/* c8 ignore stop */
