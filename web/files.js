import { render, esc, matter, titleOf } from '/md.js'
import { score } from '/fuzzy.js'
import { mentions, countIn } from '/mentions.js'
import { resolveRel, index as refIndexOf, resolve as resolveRef, candidates, worth, trim, TOKEN_SRC } from '/refs.js'
import { bytes } from '/units.js'
import { setFavicon } from '/favicon.js'

// ── The viewer ────────────────────────────────────────────────────────
// k0's second tab: the files on the left, what they say on the right. It opens from the mark on
// a card and does not take the board away, which stays where it is.
//
// There is no index: the listing arrives from the server ready-made and the search runs here, on
// the names. First the files the session touched, then the recently modified ones — which is also
// the only group you can have where there is no git — and below that everything else, which is
// what you need when the one you are after is not among the first.
//
// Then there is the other road, the one behind the lens: instead of searching for a file you
// paste the piece of conversation that names them, and the listing narrows to those. It fits what
// actually happens — a session ends, the summary says what it touched, and the files worth
// rereading are already written in there.

const $ = (s) => document.querySelector(s)
const params = new URLSearchParams(location.search)
const REPO = params.get('repo') || ''
const CARD = params.get('card') || ''
/** Nobody is watching: the page is open only to be printed into a PDF. */
const HEADLESS = params.has('pdf')

const api = async (url, opts) => {
  const r = await fetch(url, { headers: { 'content-type': 'application/json' }, ...opts })
  const body = await r.json()
  if (!r.ok) throw new Error(body.error || 'Something went wrong')
  return body
}

const qs = (extra = {}) =>
  new URLSearchParams({ repo: REPO, ...(CARD ? { card: CARD } : {}), ...extra }).toString()

/** The address of a file's real bytes: images and PDFs come through here. */
const rawUrl = (p) => `/api/file/raw?${qs({ path: p })}`
/** The same bytes, but as an attachment: the button that downloads the file as it is. */
const dlUrl = (p) => `/api/file/raw?${qs({ path: p, dl: '1' })}`
/** The document laid out on paper, made by the server. */
const pdfUrl = (p) => `/api/file/pdf?${qs({ path: p })}`
/**
 * A page served with its real path, rather than the one on the end of the address: only that way
 * do the stylesheet next to it and the images in the directory below — which inside the page are
 * written as relative paths — end up where they really are.
 */
const siteUrl = (p) =>
  `/api/site/${encodeURIComponent(REPO)}/${p.split('/').map(encodeURIComponent).join('/')}`
/** The viewer's address for another file, which is also a real link: it can be opened separately. */
const viewUrl = (p) => `?${qs({ f: p })}`

let all = [] // every file: { p, m, s }
let changed = new Set() // the ones touched right now
let known = new Set() // the same paths as `all`, so a new one gets noticed
let inText = [] // what was found inside the files, for the search running now
let rows = [] // the rows on screen right now, in the order they are seen
let active = -1 // where you are with the arrow keys
let open = null // { path, mtime }
// What is narrowing the listing, if anything is: a pasted piece of chat (`{ kind: 'text', text }`)
// or a directory (`{ kind: 'dir', dir }`). They are two different roads to the same place — a
// slice of the listing with a label at the top and a way out — so it is one piece of state.
let scope = null
let opened = new Set() // rows opened by hand: directories, and names that fit several files

// ── The list on the left ──────────────────────────────────────────────
const dirOf = (p) => p.slice(0, p.lastIndexOf('/') + 1).replace(/\/$/, '')
const nameOf = (p) => p.slice(p.lastIndexOf('/') + 1)

function since(ms) {
  const m = Math.floor((Date.now() - ms) / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h`
  const d = Math.floor(h / 24)
  return d === 1 ? 'yesterday' : `${d} days`
}

/**
 * The line found inside the file, with the word highlighted. The positions are worked out by the
 * server on the real text — accents included — so there is nothing to guess here.
 */
function quoted(h) {
  if (!h.len) return esc(h.line)
  return (
    esc(h.line.slice(0, h.at)) +
    `<mark>${esc(h.line.slice(h.at, h.at + h.len))}</mark>` +
    esc(h.line.slice(h.at + h.len))
  )
}

/**
 * The three groups. While searching they disappear and what is left is the names closest to what
 * you typed, and below them what can only be found inside the files.
 */
function groups() {
  const q = $('#q').value.trim()
  if (q) {
    const hits = []
    for (const f of all) {
      const s = score(f.p, q)
      if (s >= 0) hits.push({ f, s })
    }
    hits.sort((a, b) => b.s - a.s)
    const byName = hits.slice(0, 300).map((h) => h.f)
    // What can only be found by opening the file, and that you would never have guessed from the
    // name. Anything already among the names is not repeated.
    const found = new Set(byName.map((f) => f.p))
    const byText = inText.filter((h) => !found.has(h.p))
    return [
      { title: 'Names', files: byName },
      { title: 'In the text', files: byText },
    ].filter((g) => g.files.length)
  }

  const touched = all.filter((f) => changed.has(f.p)).sort((a, b) => b.m - a.m)
  const rest = all.filter((f) => !changed.has(f.p)).sort((a, b) => b.m - a.m)
  return [
    { title: 'Changed', files: touched },
    { title: 'Recent', files: rest.slice(0, 30) },
    { title: 'All files', files: rest.slice(30).sort((a, b) => a.p.localeCompare(b.p)) },
  ].filter((g) => g.files.length)
}

// ── The files a piece of chat names ───────────────────────────────────
/**
 * What the pasted text names, recomputed only when it has to be: `paint()` runs as often as every
 * three seconds while a session is working, and redoing the sums every round would be wasted
 * work. The file listing is a new array on every re-read, and that is signal enough that
 * something changed.
 */
let memo = { text: null, from: null, out: null }
function mentioned() {
  if (memo.text !== scope.text || memo.from !== all) {
    memo = { text: scope.text, from: all, out: mentions(scope.text, all) }
  }
  return memo.out
}

/** How many files the text touches, open or closed: the number must not jump about. */
const howMany = (out) => countIn(out.named) + countIn(out.maybe)

/**
 * One file row, the same in every group.
 *
 * It also records the row in `rows`, which is the order the arrow keys meet them in: writing it
 * and counting it in the same place is the only way the two cannot drift apart when a directory
 * opens or closes.
 */
function rowHtml(f) {
  rows.push(f)
  const dir = dirOf(f.p)
  return `<a class="row${f.p === open?.path ? ' on' : ''}${changed.has(f.p) ? ' hot' : ''}" href="${esc(
    viewUrl(f.p)
  )}" data-p="${esc(f.p)}"><b>${esc(nameOf(f.p))}</b>${
    dir ? `<i>${esc(dir)}</i>` : ''
  }<em>${since(f.m)}</em>${f.line ? `<q>${quoted(f)}</q>` : ''}</a>`
}

/**
 * An entry found in the text. Two cases, one gesture: a directory opens and shows the files it
 * holds; a name that fits several files — eight `README.md` — shows the most recent one and opens
 * the others underneath. Both are clicked open and clicked shut, with nothing reloaded.
 */
function entryHtml(e) {
  const key = e.dir || e.file.p
  const isOpen = opened.has(key)
  const fold = (label) =>
    `<button class="more" type="button" data-fold="${esc(key)}" aria-expanded="${isOpen}">${label}</button>`

  if (e.dir) {
    const up = dirOf(e.dir)
    const n = e.files.length
    const head = `<button class="row fold${isOpen ? ' open' : ''}" type="button" data-fold="${esc(
      key
    )}" aria-expanded="${isOpen}"><b>${esc(nameOf(e.dir))}/</b>${
      up ? `<i>${esc(up)}</i>` : ''
    }<em>${n} file${n === 1 ? '' : 's'}</em></button>`
    return head + (isOpen ? `<div class="kids">${e.files.map((f) => rowHtml(f)).join('')}</div>` : '')
  }

  const main = rowHtml(e.file)
  if (!e.more.length) return main
  return (
    main +
    fold(isOpen ? 'fewer' : `${e.more.length} more`) +
    (isOpen ? `<div class="kids">${e.more.map((f) => rowHtml(f)).join('')}</div>` : '')
  )
}

/** The files inside a directory. Only its own, not the tree below it. */
const filesIn = (d) => all.filter((f) => dirOf(f.p) === d).sort((a, b) => b.m - a.m)

/**
 * The label at the top of the listing: where you are, and how to get out. The first button is
 * also the way back to whatever brought you here — the text, to correct it — while for a
 * directory there is nothing to correct and it simply says so.
 */
function chipHtml(label, again) {
  const back = `<button type="button" id="paste-clear" class="x" title="Back to all files (Esc)" aria-label="Back to all files"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`
  const head = again
    ? `<button type="button" id="paste-again" title="See and change the text">${label}</button>`
    : `<span>${label}</span>`
  return `<div class="from-text">${head}${back}</div>`
}

/** The listing when a directory is what governs it. */
function dirHtml() {
  const fs = filesIn(scope.dir)
  return (
    chipHtml(`${fs.length} file${fs.length === 1 ? '' : 's'} in ${esc(scope.dir)}`, false) +
    `<h2>${esc(nameOf(scope.dir))}<small>${fs.length}</small></h2>` +
    fs.map((f) => rowHtml(f)).join('')
  )
}

/** The listing when a pasted text is what governs it. */
function pastedHtml() {
  const out = mentioned()
  const n = howMany(out)
  // Where you are stays visible at the top: the number, the way out, and the text itself one
  // click away so it can be corrected without pasting it again.
  let html = chipHtml(`${n} file${n === 1 ? '' : 's'} from your text`, true)
  if (out.named.length) {
    html += `<h2>From your text<small>${countIn(out.named)}</small></h2>`
    html += out.named.map(entryHtml).join('')
  }
  if (out.maybe.length) {
    // It arrives closed: these are guesses, and they must not cover what is written in full.
    const isOpen = opened.has('maybe')
    html += `<h2 class="fold${isOpen ? ' open' : ''}" data-fold="maybe" role="button" tabindex="0" aria-expanded="${isOpen}">Maybe these<small>${countIn(
      out.maybe
    )}</small></h2>`
    if (isOpen) html += out.maybe.map(entryHtml).join('')
  }
  if (out.missing.length) {
    html += `<p class="missing">not in this repository: ${esc(out.missing.join(', '))}</p>`
  }
  return html
}

/** The usual listing: the groups, and the files under them. */
function plainHtml() {
  return groups()
    .map(
      (g) =>
        `<h2>${g.title}<small>${g.files.length}</small></h2>` + g.files.map((f) => rowHtml(f)).join('')
    )
    .join('')
}

function paint() {
  const list = $('#list')
  // The listing redraws even while you are scrolling it — every three seconds, if a session is
  // working. Putting it back where it was is the difference between a live list and one that
  // slips out of your hands.
  const scroll = list.scrollTop
  rows = []
  const text = scope?.kind === 'text'
  const html = !scope ? plainHtml() : text ? pastedHtml() : dirHtml()
  if (active >= rows.length) active = rows.length - 1

  // Empty does not mean "no rows on screen": with a pasted text the guesses arrive closed, and a
  // result made only of those has no rows to show while still having found everything it should.

  const found = text ? howMany(mentioned()) : scope ? filesIn(scope.dir).length : rows.length
  list.innerHTML = !found
    ? `<p class="blank">${
        text
          ? 'Nothing of that text is here any more.'
          : scope
            ? 'Nothing in that folder any more.'
            : $('#q').value.trim()
              ? 'Nothing with that name.'
              : 'No documents here. This only lists what you can read and print — text, not code.'
      }</p>`
    : html

  list.scrollTop = scroll
  $('#count').textContent = scope
    ? `${found} of ${all.length}`
    : `${all.length} file${all.length === 1 ? '' : 's'}`
  mark()
}

/**
 * The arrow-key highlight, which is a different thing from the open file. Links only: the rows
 * that open a directory are buttons, and the arrows have nothing to do with them.
 */
function mark() {
  const els = [...$('#list').querySelectorAll('a.row')]
  els.forEach((el, i) => el.classList.toggle('active', i === active))
  if (active >= 0) els[active]?.scrollIntoView({ block: 'nearest' })
}

// ── In and out of a pasted text ───────────────────────────────────────
/** Opens the paste dialog, with the text from before or the one that just arrived. */
function openPaste(text) {
  const box = $('#p-text')
  box.value = text ?? (scope?.kind === 'text' ? scope.text : '')
  $('#p-note').hidden = true
  $('#paste').showModal()
  box.focus()
  box.setSelectionRange(box.value.length, box.value.length)
}

/**
 * Takes the text and narrows the listing to what it names. If it names nothing the dialog does
 * **not** close and the listing is not thrown away: it says what happened, so the text can be
 * corrected where it is instead of being pasted again.
 */
function applyPaste(text) {
  const t = String(text ?? '').trim()
  const out = mentions(t, all)
  if (!howMany(out)) {
    const note = $('#p-note')
    note.hidden = false
    note.textContent = out.missing.length
      ? `Not in this repository: ${out.missing.join(', ')}. Maybe it is another one.`
      : 'No file of this repository is named in that text.'
    return
  }
  scope = { kind: 'text', text: t }
  memo = { text: t, from: all, out }
  opened = new Set()
  active = -1
  $('#q').value = ''
  inText = []
  $('#paste').close()
  paint()
  // The first one named opens by itself: when the text names one — the commonest case — it is the
  // only thing you wanted, and clicking it would be one gesture too many.
  const first = out.named[0] || out.maybe[0]
  show(first.files ? first.files[0].p : first.file.p)
}

/**
 * Back to the whole listing. The file open on the right stays where it is.
 *
 * A directory is also in the address, because it is a page that can be reloaded and sent: on the
 * way out it has to be taken off, otherwise a reload would put you back inside.
 */
function clearScope() {
  const wasDir = scope?.kind === 'dir'
  scope = null
  opened = new Set()
  active = -1
  paint()
  if (wasDir) history.replaceState(null, '', open ? viewUrl(open.path) : `?${qs()}`)
}

// ── File names written inside a document ──────────────────────────────
// Documents point at each other constantly, and until now those were dead references: to open one
// you had to go back to the listing and hunt by hand. The rules about what points at what live in
// `refs.js`, which knows nothing about pages; here there is only the browser's part of the job —
// asking the server about what the listing does not know, and stitching the links.

/** How many paths are asked of the server for one document. */
const MAX_ASK = 60

let refMemo = { from: null, ix: null }
const refIndex = () => {
  if (refMemo.from !== all) refMemo = { from: all, ix: refIndexOf(all) }
  return refMemo.ix
}

/** A directory's address: it is a real page, it reloads and it can be sent. */
const dirUrl = (d) => `?${qs({ dir: d })}`

/**
 * What this document names that can really be opened: from a written name to an address. Almost
 * always it finishes without asking anybody anything, because the file listing is already here;
 * the server is only reached for the names the listing does not have, which are the documents
 * inside the directories the listing skips.
 */
async function refsIn(docPath, text) {
  const ix = refIndex()
  const map = new Map()
  const pending = []
  for (const t of candidates(text)) {
    const r = resolveRef(t, docPath, ix, true)
    if (!r) continue
    // Inside backticks a single word gets through; in the middle of a sentence it does not, or in
    // a text about onboarding the words "onboarding" and "search" would become links at random.
    const both = worth(t, false)
    if (r.path) map.set(t, { url: viewUrl(r.path), prose: both })
    else if (r.dir) map.set(t, { url: dirUrl(r.dir), prose: both })
    else pending.push([t, r.ask, both])
  }
  if (!pending.length) return map

  const paths = [...new Set(pending.flatMap(([, ask]) => ask))].slice(0, MAX_ASK)
  let there = new Set()
  try {
    const r = await api('/api/files/exist', { method: 'POST', body: JSON.stringify({ repo: REPO, paths }) })
    there = new Set(r.paths)
  } catch {
    /* the server is not answering: what is left is the links that resolved on their own */
  }
  for (const [t, ask, both] of pending) {
    const hit = ask.find((x) => there.has(x))
    if (hit) map.set(t, { url: viewUrl(hit), prose: both })
  }
  return map
}

/** A clickable name: grey as before, and it opens in a new tab. */
function refLink(url, label) {
  const a = document.createElement('a')
  a.className = 'ref'
  a.href = url
  a.target = '_blank'
  a.title = 'Open in a new tab'
  a.textContent = label
  return a
}

/**
 * Stitches the links into the document that has already been laid out.
 *
 * It happens here and not in the layout engine because `md.js` is a markdown layout engine and
 * nothing else: it does not know a repository exists, and it must not. And working on the real
 * document rather than on the text gives away for free the things that regular expressions would
 * charge dearly for — code blocks, links that are already there, and pieces inside attributes
 * stay out without having to be excluded by hand.
 */
function linkRefs(root, map) {
  if (!map.size) return

  // Code spans first: `name.md` inside backticks is how documents cite each other.
  for (const el of root.querySelectorAll('code')) {
    if (el.closest('pre, a') || el.querySelector('a')) continue
    const hit = map.get(el.textContent.trim())
    if (!hit) continue
    const label = el.textContent
    el.textContent = ''
    el.append(refLink(hit.url, label))
  }

  // Then the names written in the middle of sentences. Only real pieces of text are looked at:
  // inside a link or a code span it does not go.
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest('a, code, pre') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })
  const found = []
  for (let n = walk.nextNode(); n; n = walk.nextNode()) found.push(n)
  for (const n of found) linkRefsInText(n, map)
}

/** Splits a piece of text where it names a file, and puts the link in. */
function linkRefsInText(node, map) {
  const text = node.nodeValue
  const re = new RegExp(TOKEN_SRC, 'g')
  const frag = document.createDocumentFragment()
  let at = 0
  for (const m of text.matchAll(re)) {
    const t = trim(m[0])
    const hit = t && map.get(t)
    if (!hit?.prose) continue
    frag.append(text.slice(at, m.index), refLink(hit.url, t))
    at = m.index + t.length
  }
  if (!at) return
  frag.append(text.slice(at))
  node.replaceWith(frag)
}

// ── The document on the right ─────────────────────────────────────────
async function show(p, { keepScroll = false } = {}) {
  const doc = $('#doc')
  const scroll = keepScroll ? doc.scrollTop : 0
  let file
  try {
    file = await api(`/api/file?${qs({ path: p })}`)
  } catch (e) {
    doc.innerHTML = `<p class="blank">${esc(e.message)}</p>`
    return
  }
  open = { path: p, mtime: file.mtime }

  // What this document names, before laying it out: the layout engine is synchronous, and for the
  // names the listing does not have there is a question to ask the server.
  const refs = file.kind === 'markdown' ? await refsIn(p, file.text) : new Map()

  const crumb = crumbs(p, file)
  let head = ''
  let body
  if (file.kind === 'markdown') {
    // Relative references point at real things: images at the bytes, links at the other documents.
    // Without this a document full of references would be a dead end.
    const link = (t, kind) => {
      const abs = resolveRel(p, t)
      if (!abs) return '#'
      return kind === 'image' ? rawUrl(abs) : viewUrl(abs)
    }
    head = plate(matter(file.text).data)
    body = `<article class="md">${render(file.text, link)}</article>`
  } else if (file.kind === 'text') {
    body = `<pre class="plain">${esc(file.text)}</pre>`
  } else if (file.kind === 'image') {
    body = `<div class="media"><img src="${esc(rawUrl(p))}" alt="${esc(nameOf(p))}"></div>`
  } else if (file.kind === 'pdf') {
    body = `<iframe class="pdf" src="${esc(rawUrl(p))}" title="${esc(nameOf(p))}"></iframe>`
  } else if (file.kind === 'html') {
    // A page is looked at, like the PDF above. Shut in a frame with no permissions: from in there
    // it executes nothing and does not reach k0 — the server says so anyway, but saying it twice
    // costs nothing and still holds if the frame ever changes.
    body = `<iframe class="page" sandbox src="${esc(siteUrl(p))}" title="${esc(nameOf(p))}"></iframe>`
  } else {
    body = `<div class="blank"><p>There's no way to show this one here.</p><button id="reveal">Reveal in Finder</button></div>`
  }

  const cut = file.truncated ? '<p class="cut">Only the first 2 MB are shown.</p>' : ''
  doc.innerHTML = crumb + head + body + cut
  linkRefs(doc.querySelector('.md') ?? doc, refs)
  doc.scrollTop = scroll
  $('#reveal')?.addEventListener('click', reveal)

  // The name of the page is the document's title: it is what the browser offers as the file name
  // when you save to PDF, and it is worth far more than "k0 — Files".
  const named = file.kind === 'markdown' ? titleOf(matter(file.text).data) : null
  document.title = named || nameOf(p)

  // The address follows what you are looking at: reload and you stay on the file, and the link can
  // be sent to somebody else. Without adding an entry to the history. If you are inside a
  // directory that is written down too: otherwise reloading would give you the right file but the
  // whole listing.
  history.replaceState(null, '', scope?.kind === 'dir' ? `?${qs({ dir: scope.dir, f: p })}` : viewUrl(p))
  paint()
}

function crumbs(p, file) {
  const parts = p.split('/')
  const last = parts.pop()
  const road = parts.map((x) => `<span>${esc(x)}</span>`).join('<i>/</i>')
  const meta = `${bytes(file.size)} · ${since(file.mtime)}`
  return `<div class="crumb">${road ? `${road}<i>/</i>` : ''}<b>${esc(last)}</b><em>${meta}</em>${acts(p, file.kind)}</div>`
}

/** Drawn by hand like the others in the house: same stroke, same grid. */
const ICON = {
  print:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11"/><path d="M7.5 9.5 12 14l4.5-4.5"/><path d="M4 20h16"/></svg>',
}

/**
 * What you can do with the file you are looking at, at the end of its path row. It lives here and
 * not in the bar at the top because these are things about this document, not about the search or
 * the repository.
 *
 * Not every file offers the same things: taking the file away as it is always makes sense, but
 * printing a `.docx` that cannot even be shown here does not, and asking for the PDF of something
 * that is already a PDF does not either — that one is simply downloaded.
 */
function acts(p, kind) {
  const paper = kind === 'markdown' || kind === 'text'
  // In capitals and without the dot, like the PDF next to it: they are two buttons that do the
  // same thing, and writing them two different ways made them look like two different things.
  const ext = /\.([^./]+)$/.exec(p)?.[1].toUpperCase() || 'FILE'
  const out = []
  if (paper || kind === 'image') {
    out.push(`<button class="act" data-act="print" type="button" title="Print (⌘P)" aria-label="Print">${ICON.print}</button>`)
  }
  out.push(
    `<a class="act" href="${esc(dlUrl(p))}" download="${esc(nameOf(p))}" title="Download the file as it is on disk">${ICON.down}${esc(ext)}</a>`
  )
  if (paper) {
    out.push(`<button class="act" data-act="pdf" type="button" title="Download it already laid out on paper">${ICON.down}PDF</button>`)
  }
  return `<span class="acts">${out.join('')}</span>`
}

/**
 * The PDF is laid out by the server, and it takes a few seconds: here we wait and say so, and when
 * it arrives we hand it to the browser like any other download. It is not the print dialog — the
 * sheet comes out with the right margin already and without the browser's additions.
 */
let saving = false
async function savePdf() {
  if (!open || saving) return
  saving = true
  toast('Making the PDF…')
  try {
    const r = await fetch(pdfUrl(open.path))
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'The PDF did not come out')
    const url = URL.createObjectURL(await r.blob())
    const a = document.createElement('a')
    a.href = url
    // The name of the page is the document's title; the characters you cannot put in a file name
    // cannot go in here.
    a.download = `${document.title.replace(/[\\/:*?"<>|]+/g, '-')}.pdf`
    a.click()
    URL.revokeObjectURL(url)
    toast('Saved to your downloads.')
  } catch (e) {
    toast(e.message)
  } finally {
    saving = false
  }
}

/**
 * The label at the top of a document: what is written between the two rules. It is not text of
 * the file — it is what the file says it is — so it is read as a label and not as a paragraph,
 * with the title picked out and the rest kept quiet.
 */
function plate(data) {
  const title = titleOf(data)
  const rest = Object.entries(data).filter(([k, v]) => v && !TITLE_KEYS.has(k))
  if (!title && !rest.length) return ''
  return `<div class="plate">
    ${title ? `<b>${esc(title)}</b>` : ''}
    ${rest.map(([k, v]) => `<span><i>${esc(k)}</i> ${esc(v)}</span>`).join('')}
  </div>`
}

const TITLE_KEYS = new Set(['title', 'titolo', 'name', 'nome'])

async function reveal() {
  try {
    await api('/api/file/reveal', { method: 'POST', body: JSON.stringify({ repo: REPO, path: open.path }) })
  } catch (e) {
    toast(e.message)
  }
}

function toast(msg) {
  const t = $('#toast')
  t.textContent = msg
  t.classList.add('show')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => t.classList.remove('show'), 4000)
}

// ── The divider ───────────────────────────────────────────────────────
/** How much room the left column takes, as a percentage. It remembers. */
function split(pct) {
  const v = Math.min(60, Math.max(15, pct))
  $('#split').style.setProperty('--left', `${v}%`)
  localStorage.setItem('k0-files-split', String(v))
}

function grip() {
  const g = $('#grip')
  g.onpointerdown = (e) => {
    e.preventDefault()
    g.setPointerCapture(e.pointerId)
    const move = (ev) => split((ev.clientX / window.innerWidth) * 100)
    const up = () => {
      g.removeEventListener('pointermove', move)
      g.removeEventListener('pointerup', up)
    }
    g.addEventListener('pointermove', move)
    g.addEventListener('pointerup', up)
  }
  // Double click: back to the starting size, without having to find it by hand.
  g.ondblclick = () => split(28)
}

// ── The round ─────────────────────────────────────────────────────────
async function loadAll() {
  const data = await api(`/api/files?${qs()}`)
  all = data.files
  known = new Set(all.map((f) => f.p))
  changed = new Set(data.changed)
  document.title = `k0 — ${data.name}`
  $('#repo').textContent = data.name
  $('#ctx').textContent = data.title ? `· ${data.title}` : data.git ? '' : '· not a git repository'
  if (data.truncated) toast('This repository is huge: the list stops at 20 000 files.')
  paint()
}

/**
 * Every three seconds it asks only what changed: that is the part that moves, and it costs one
 * read of git. The whole listing is big and ages slowly, so it is re-read only now and then — or
 * straight away, if a file turns up that was not there.
 */
async function poll() {
  try {
    // The icon in the tab is tinted like the one in the menu bar, from here too: you are reading a
    // document while a session is waiting for you.
    api('/api/status').then((s) => setFavicon(s.urgent)).catch(() => {})

    const { changed: now } = await api(`/api/files?${qs({ only: 'changed' })}`)
    const fresh = now.some((p) => !known.has(p))
    const moved = now.length !== changed.size || now.some((p) => !changed.has(p))
    changed = new Set(now)
    if (fresh) await loadAll()
    else if (moved) paint()
    // The open file is changing under your eyes: it is re-read, and you stay where you are.
    if (open && changed.has(open.path)) {
      const f = await api(`/api/file?${qs({ path: open.path })}`)
      if (f.mtime !== open.mtime) await show(open.path, { keepScroll: true })
    }
  } catch {
    /* server down or repository gone: we try again next round */
  }
}

/**
 * Searching inside the files goes through the server and reads a few hundred documents: it waits
 * for you to finish typing, and an answer that arrives late for what is in the field now is
 * thrown away.
 */
function lookInside() {
  clearTimeout(lookInside.timer)
  const q = $('#q').value.trim()
  if (q.length < 2) {
    inText = []
    return
  }
  lookInside.timer = setTimeout(async () => {
    try {
      const { hits } = await api(`/api/files?${qs({ only: 'text', q })}`)
      if (q !== $('#q').value.trim()) return
      inText = hits
      paint()
    } catch {
      /* no results from the text: the names are what is left */
    }
  }, 250)
}

function keys() {
  document.onkeydown = (e) => {
    // With the paste dialog open the keys belong to it: `/` must not jump into the search while
    // you are typing, and Esc is `<dialog>`'s own business.
    if ($('#paste').open) return
    const typing = document.activeElement === $('#q')
    // Ctrl/Cmd+P is already the browser's print: here it is enough not to get in its way.
    if (e.key === '/' && !typing) {
      e.preventDefault()
      $('#q').focus()
      $('#q').select()
      return
    }
    if (e.key === 'Escape') {
      // First you leave the results of a pasted text: it is the narrowest state you can be in,
      // and it is the one you want out of first.
      if (scope) return clearScope()
      if (!$('#q').value) return $('#q').blur()
      $('#q').value = ''
      active = -1
      paint()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!rows.length) return
      e.preventDefault()
      const down = e.key === 'ArrowDown'
      // The first arrow goes into the list: from the top going down, from the bottom going up.
      if (active < 0) active = down ? 0 : rows.length - 1
      else active = (active + (down ? 1 : rows.length - 1)) % rows.length
      mark()
      return
    }
    if (e.key === 'Enter' && rows[active]) {
      e.preventDefault()
      show(rows[active].p)
    }
  }
}

async function boot() {
  if (!REPO) {
    document.body.innerHTML = '<p class="blank">No repository. Open this from a card on the dashboard.</p>'
    return
  }
  split(Number(localStorage.getItem('k0-files-split')) || 28)
  grip()
  keys()

  $('#q').oninput = () => {
    // Typing is the other search: you leave the pasted text's results and go back to searching the
    // whole repository. One behaviour at a time.
    scope = null
    active = -1
    paint() // the names are already here: they filter as you type, with nothing to wait for
    lookInside()
  }
  // Pasting a piece of chat in here is not searching: a one-line box would hide it and a search on
  // names would get nothing out of it. Above a line or a handful of words, the text goes where it
  // is meant to go.
  $('#q').addEventListener('paste', (e) => {
    const t = e.clipboardData?.getData('text') ?? ''
    if (!t.includes('\n') && t.trim().length <= 80) return
    e.preventDefault()
    openPaste(t)
  })

  $('#paste-open').onclick = () => openPaste()
  $('#p-close').onclick = () => $('#paste').close()
  $('#p-cancel').onclick = () => $('#paste').close()
  $('#paste-form').onsubmit = (e) => {
    e.preventDefault()
    applyPaste($('#p-text').value)
  }
  // Enter starts a new line, which in a big box is what it should do. To send it without taking
  // your hands off there is Ctrl/Cmd+Enter, as in every other box that gets sent.
  $('#p-text').onkeydown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      applyPaste($('#p-text').value)
    }
  }

  // An ordinary click: it opens here. With a modifier it does not — it is a real link, and anyone
  // who wants it in another tab has to be able to have it.
  $('#list').onclick = (e) => {
    // The rows that open and close come first: a directory, or a name that fits several files.
    // They do not lead anywhere, they are leafed through in place.
    const fold = e.target.closest('[data-fold]')
    if (fold) {
      e.preventDefault()
      const k = fold.dataset.fold
      opened.has(k) ? opened.delete(k) : opened.add(k)
      return paint()
    }
    if (e.target.closest('#paste-clear')) return clearScope()
    if (e.target.closest('#paste-again')) return openPaste()

    const row = e.target.closest('.row')
    if (!row || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    show(row.dataset.p)
  }
  // The heading of a collapsible group is a heading, not a button: the keyboard reaches it all the
  // same, and it has to be able to open it.
  $('#list').onkeydown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const fold = e.target.closest?.('h2[data-fold]')
    if (!fold) return
    e.preventDefault()
    e.stopPropagation() // otherwise Enter also reaches below and opens the highlighted row
    opened.has(fold.dataset.fold) ? opened.delete(fold.dataset.fold) : opened.add(fold.dataset.fold)
    paint()
  }
  // The same for the references inside a document — and for the buttons at the top of it, which
  // are rebuilt on every opening: the click is listened for once, here.
  $('#doc').onclick = (e) => {
    const act = e.target.closest('.crumb button[data-act]')
    if (act) return void (act.dataset.act === 'print' ? window.print() : savePdf())
    // File names found in the text open a new tab: they are real links, and nothing is intercepted
    // here — the browser deals with it. References written by hand inside the document instead stay
    // as they were, and open here.
    if (e.target.closest('a.ref')) return
    const a = e.target.closest('a[href^="?"]')
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return
    e.preventDefault()
    show(new URLSearchParams(a.getAttribute('href').slice(1)).get('f'))
  }

  await loadAll()
  // A directory named inside a document opens a page of its own: the listing starts already
  // narrowed to it. It is a real address, so it reloads and it can be sent.
  const dir = params.get('dir')
  if (dir) {
    scope = { kind: 'dir', dir }
    document.title = `${nameOf(dir) || '/'} — ${REPO.split('/').pop()}`
    paint()
  }
  const start = params.get('f')
  if (start) await show(start)
  // When it is the server printing us, the page has nothing to do but show itself: interrogating
  // git every three seconds while a sheet is being waited for is of no use to anybody.
  if (HEADLESS) return
  setInterval(poll, 3000)
  // The full listing ages slowly, but the dates do not: half a minute is enough.
  setInterval(() => loadAll().catch(() => {}), 30000)
}

boot()
