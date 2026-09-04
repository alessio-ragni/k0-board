import { render, esc, matter, titleOf } from '/md.js'
import { tree as jsonTree } from '/json.js'
import { envTable, highlight as confText } from '/conf.js'
import { score, positions, runs } from '/fuzzy.js'
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
// Whether the configuration files are shown as well. It is remembered because it is not a search
// but a way of working: somebody who wants to see the `.env` today wants to see it tomorrow.
let nerd = localStorage.getItem('k0-files-nerd') === '1'
// What this machine can do with a file outside the browser. Until the listing arrives we assume
// it can, which is what every machine k0 has met so far does.
let can = { reveal: true, open: true, whyNot: null }
// The file being written, while it is being written: `{ path, mtime }`. Everything that would
// redraw the right-hand pane has to stand aside while this is set, or what you have typed goes.
let editing = null

// ── The list on the left ──────────────────────────────────────────────
const dirOf = (p) => p.slice(0, p.lastIndexOf('/') + 1).replace(/\/$/, '')
const nameOf = (p) => p.slice(p.lastIndexOf('/') + 1)
const extOf = (p) => (/\.[^./]+$/.exec(nameOf(p))?.[0] ?? '').toLowerCase()

// The same rules as the server's, written a second time on purpose: a browser cannot import a
// module that reads the filesystem, and this decides only what to *offer*. What is really allowed
// is decided over there, on the file it is about to write. Change one, change the other.
const ENV_NAME = /^\.env(\..+)?$/
const CONF_EXT = new Set(['.json', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf'])
const NOTE_EXT = new Set(['.md', '.markdown', '.mdx', '.txt'])
const isConfig = (p) => CONF_EXT.has(extOf(p)) || ENV_NAME.test(nameOf(p))
const canEdit = (p) => NOTE_EXT.has(extOf(p)) || isConfig(p)
// The same ceiling the server puts on a save, so the pencil is not offered for a file that would
// then be refused. Far above anything anybody edits in a browser tab.
const MAX_EDIT = 1 << 18

/** The files on show right now: everything, or everything that is not configuration. */
const listed = () => (nerd ? all : all.filter((f) => !f.c))

/** The switch as it looks. */
const markNerd = () => {
  $('#nerd').setAttribute('aria-pressed', String(nerd))
  $('#nerd').classList.toggle('on', nerd)
}

/**
 * The switch, and everything that follows from it. The search inside the files has to be asked
 * again straight away: that one runs on the server, and the server was told to look at a smaller
 * set of files than it should now be looking at.
 */
function setNerd(on) {
  nerd = on
  localStorage.setItem('k0-files-nerd', on ? '1' : '0')
  markNerd()
  active = -1
  paint()
  lookInside()
}

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
  const here = listed()
  if (q) {
    const hits = []
    for (const f of here) {
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

  const touched = here.filter((f) => changed.has(f.p)).sort((a, b) => b.m - a.m)
  const rest = here.filter((f) => !changed.has(f.p)).sort((a, b) => b.m - a.m)
  return [
    { title: 'Changed', files: touched },
    { title: 'Recent', files: rest.slice(0, 30) },
    { title: 'All files', files: rest.slice(30).sort((a, b) => a.p.localeCompare(b.p)) },
  ].filter((g) => g.files.length)
}

/**
 * How many configuration files the switch is hiding that would have come **above** everything it
 * is showing.
 *
 * Without this, searching for `.env` with the switch off is the worst kind of answer: eighty files
 * that merely happen to contain those four letters somewhere in their path, and no sign at all
 * that the one you asked for is sitting right there behind a button.
 *
 * "Better than anything visible" and not "matches at all" is the whole rule. The name search
 * matches letters in order, so nearly any word matches something somewhere: counting every hidden
 * match would put this line above almost every search, and a warning that is always there is read
 * as decoration within a day. This way it appears exactly when the answer really is the one being
 * held back.
 */
function hiddenByTheSwitch(q) {
  if (nerd || !q) return 0
  let best = -1
  const hidden = []
  for (const f of all) {
    const s = score(f.p, q)
    if (s < 0) continue
    if (f.c) hidden.push(s)
    else if (s > best) best = s
  }
  return hidden.filter((s) => s > best).length
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
  // Which letters put this row here — the search only ever looks inside the name, so every
  // position `positions()` hands back already falls inside it; the offset just undoes what it
  // added to make that position mean something against the whole path.
  const at = positions(f.p, $('#q').value.trim())
  const nameAt = dir ? dir.length + 1 : 0
  const name = lit(nameOf(f.p), at?.map((i) => i - nameAt))
  const road = dir ? `<i>${esc(dir)}</i>` : ''
  return `<a class="row${f.p === open?.path ? ' on' : ''}${changed.has(f.p) ? ' hot' : ''}" href="${esc(
    viewUrl(f.p)
  )}" data-p="${esc(f.p)}"><b>${name}</b>${road}<em>${since(f.m)}</em>${
    f.line ? `<q>${quoted(f)}</q>` : ''
  }</a>`
}

/** A piece of text with the stretches that matched underlined. */
function lit(text, at) {
  const spans = runs(at)
  if (!spans.length) return esc(text)
  let out = ''
  let from = 0
  for (const [start, stop] of spans) {
    if (start >= text.length) break
    const end = Math.min(stop, text.length)
    out += `${esc(text.slice(from, start))}<u>${esc(text.slice(start, end))}</u>`
    from = end
  }
  return out + esc(text.slice(from))
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
const filesIn = (d) => listed().filter((f) => dirOf(f.p) === d).sort((a, b) => b.m - a.m)

/**
 * The directories directly inside `d`, with how many files each one holds below it — all the way
 * down, not only its own floor. The number is what tells you whether it is worth going in, and a
 * folder of folders would otherwise say nothing at all.
 *
 * There is no separate listing of directories, and there does not need to be one: a directory is
 * a piece of the path of the files inside it, and the listing is already here.
 */
function foldersIn(d) {
  const prefix = d ? `${d}/` : ''
  const kids = new Map()
  for (const f of listed()) {
    if (prefix && !f.p.startsWith(prefix)) continue
    const rest = f.p.slice(prefix.length)
    const at = rest.indexOf('/')
    if (at === -1) continue
    const name = rest.slice(0, at)
    kids.set(name, (kids.get(name) ?? 0) + 1)
  }
  return [...kids]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, n]) => ({ dir: prefix + name, name, n }))
}

/**
 * A folder, in the same list and the same shape as the files: it is a real link, so it opens in
 * another tab like everything else here, and it goes into `rows` so the arrow keys walk it too.
 */
function folderHtml(f) {
  rows.push(f)
  return `<a class="row folder" href="${esc(dirUrl(f.dir))}" data-dir="${esc(f.dir)}"><b>${esc(
    f.name
  )}</b><em>${f.n} file${f.n === 1 ? '' : 's'}</em></a>`
}

/** The way out of a narrowed listing, drawn the same wherever the narrowing came from. */
const backOut = `<button type="button" id="paste-clear" class="x" title="Back to all files (Esc)" aria-label="Back to all files"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`

/**
 * The label at the top of the listing when a pasted text is what narrowed it: how many files it
 * named, the way back to the text itself to correct it, and the way out.
 */
const chipHtml = (label) =>
  `<div class="from-text"><button type="button" id="paste-again" title="See and change the text">${label}</button>${backOut}</div>`

/**
 * Where you are, one piece of the path at a time, each one a way back up. The first piece is the
 * repository itself, which is the way out altogether.
 *
 * It is a trail rather than a "back" button because you never climb only one floor: from
 * `docs/backlog/handover` what you want is `docs`, and a button would make you press it twice
 * without telling you where you were going to land.
 */
function trailHtml(d) {
  const parts = d.split('/')
  const road = parts
    .map((name, i) => {
      const upto = parts.slice(0, i + 1).join('/')
      const last = i === parts.length - 1
      return last
        ? `<b>${esc(name)}</b>`
        : `<a href="${esc(dirUrl(upto))}" data-dir="${esc(upto)}">${esc(name)}</a>`
    })
    .join('<i>/</i>')
  const home = `<a href="?${qs()}" data-dir="">${esc($('#repo').textContent || 'all files')}</a>`
  return `<div class="from-text trail">${home}<i>/</i>${road}${finderButton('dir-open', 'Open this folder in your file manager', can.open)}${backOut}</div>`
}

/** The listing when a directory is what governs it: what is under it, then what is in it. */
function dirHtml() {
  const dirs = foldersIn(scope.dir)
  const fs = filesIn(scope.dir)
  let html = trailHtml(scope.dir)
  if (dirs.length) html += `<h2>Folders<small>${dirs.length}</small></h2>${dirs.map(folderHtml).join('')}`
  if (fs.length) html += `<h2>${esc(nameOf(scope.dir))}<small>${fs.length}</small></h2>${fs.map((f) => rowHtml(f)).join('')}`
  return html
}

/** The listing when a pasted text is what governs it. */
function pastedHtml() {
  const out = mentioned()
  const n = howMany(out)
  // Where you are stays visible at the top: the number, the way out, and the text itself one
  // click away so it can be corrected without pasting it again.
  let html = chipHtml(`${n} file${n === 1 ? '' : 's'} from your text`)
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

/**
 * The usual listing: the folders, then the groups and the files under them.
 *
 * The folders come first because they are the only thing here that is not a document: skip past
 * them and you are in the list you already knew. While searching they are gone — you are looking
 * for a name, and the folders are not among the names you are looking at.
 */
/**
 * The line above the results when the switch is hiding something you were looking for. It is the
 * button itself, not an instruction: one click, and the file appears.
 */
function nudgeHtml() {
  const hidden = hiddenByTheSwitch($('#q').value.trim())
  if (!hidden) return ''
  return `<button type="button" class="nudge" id="show-config">${hidden} configuration file${
    hidden === 1 ? '' : 's'
  } also match — show them</button>`
}

function plainHtml() {
  const dirs = $('#q').value.trim() ? [] : foldersIn('')
  const head =
    nudgeHtml() +
    (dirs.length ? `<h2>Folders<small>${dirs.length}</small></h2>${dirs.map(folderHtml).join('')}` : '')
  return (
    head +
    groups()
      .map(
        (g) =>
          `<h2>${g.title}<small>${g.files.length}</small></h2>` + g.files.map((f) => rowHtml(f)).join('')
      )
      .join('')
  )
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

  const shown = listed().length
  const found = text
    ? howMany(mentioned())
    : scope
      ? filesIn(scope.dir).length + foldersIn(scope.dir).length
      : rows.length
  const nothing = text
    ? 'Nothing of that text is here any more.'
    : scope
      ? 'Nothing in that folder any more.'
      : $('#q').value.trim()
        ? 'Nothing with that name.'
        : nerd
          ? 'Nothing here to read or to configure.'
          : 'No documents here. This lists what you can read and print — and, with the config ' +
            'button beside the search, the configuration too.'
  // An empty folder still shows the path across the top: it is the way back up, and taking it
  // away would leave you inside a folder with nothing in it and nothing to press. And a search
  // that found nothing visible still says what the switch is holding back — that is the case
  // where saying it matters most.
  list.innerHTML = found
    ? html
    : (scope && !text ? trailHtml(scope.dir) : '') +
      (scope ? '' : nudgeHtml()) +
      `<p class="blank">${nothing}</p>`

  list.scrollTop = scroll
  $('#count').textContent = scope ? `${found} of ${shown}` : `${shown} file${shown === 1 ? '' : 's'}`
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
/**
 * Into a folder. The file open on the right stays open: you go looking for the next one without
 * losing the one you were reading.
 *
 * The address follows, because a folder is a real page — it reloads into the same place and the
 * link can be sent to somebody.
 */
function enterDir(d) {
  scope = { kind: 'dir', dir: d }
  opened = new Set()
  active = -1
  $('#q').value = ''
  inText = []
  paint()
  document.title = `${nameOf(d) || '/'} — ${REPO.split('/').pop()}`
  history.replaceState(null, '', open ? `?${qs({ dir: d, f: open.path })}` : dirUrl(d))
}

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
  // The text is kept as well as shown: the search inside a tree rebuilds it from here, and the
  // editor starts from it rather than asking the server for what it has just been given.
  open = { path: p, mtime: file.mtime, size: file.size, truncated: !!file.truncated, text: file.text ?? null }

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
    body = textBody(p, file.text)
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
    // The way out is the button in the path row above, the same one every other file has: there
    // is no reason for this case to have a second one of its own.
    body = `<div class="blank"><p>There's no way to show this one here. Open it in your file manager, or take it away with the button above.</p></div>`
  }

  const cut = file.truncated ? '<p class="cut">Only the first 2 MB are shown.</p>' : ''
  doc.innerHTML = crumb + head + body + cut
  linkRefs(doc.querySelector('.md') ?? doc, refs)
  doc.scrollTop = scroll

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

/**
 * A text file, shown as the kind of thing it is.
 *
 * A `package.json` is a tree, an `.env` is a table, a YAML file is a shape you must not flatten,
 * and everything else is text. Deciding it here rather than on the server is deliberate: the
 * server says what a file *is* — text, image, page — and that answer is already used by printing,
 * by the PDF and by the download. What it should *look like* is the page's business.
 */
function textBody(p, text) {
  if (extOf(p) === '.json') {
    const out = jsonTree(text, '')
    // A broken JSON is usually exactly why you opened it: the reason first, then the file as it
    // really is, so you can see the line that is wrong.
    if (out.error) return `<p class="cut">${esc(out.error)}</p><pre class="plain">${esc(text)}</pre>`
    return `<div class="tree" data-json>${out.html}</div>`
  }
  if (ENV_NAME.test(nameOf(p))) return envTable(text)
  if (CONF_EXT.has(extOf(p))) return confText(text)
  return `<pre class="plain">${esc(text)}</pre>`
}

/** The box that searches inside the tree, and what it found. Only where the browser cannot. */
const findBox = () =>
  `<span class="findin"><input id="jfind" type="search" autocomplete="off" spellcheck="false" placeholder="find in this file…"><em id="jcount"></em></span>`

/**
 * The tree again, with what is in the box picked out. Only the tree is rebuilt, so the box keeps
 * the cursor and what you have typed — and the branches holding a result come back open, which is
 * the whole reason this search exists rather than the browser's.
 */
function findInJson() {
  const box = $('#jfind')
  const host = $('#doc [data-json]')
  if (!box || !host || !open?.text) return
  const q = box.value.trim()
  const out = jsonTree(open.text, q)
  if (out.error) return
  host.innerHTML = out.html
  $('#jcount').textContent = q ? `${out.matches}` : ''
}

function crumbs(p, file) {
  const parts = p.split('/')
  const last = parts.pop()
  const meta = `${bytes(file.size)} · ${since(file.mtime)}`
  // The pieces of the path lead into the folders they name: from a file, the way to its
  // neighbours is the path that is already written above it.
  const walk = parts
    .map((x, i) => {
      const upto = parts.slice(0, i + 1).join('/')
      return `<a class="up" href="${esc(dirUrl(upto))}" data-dir="${esc(upto)}">${esc(x)}</a>`
    })
    .join('<i>/</i>')
  const find = extOf(p) === '.json' && file.kind === 'text' ? findBox() : ''
  return `<div class="crumb">${walk ? `${walk}<i>/</i>` : ''}<b>${esc(last)}</b><em>${meta}</em>${find}${acts(
    p,
    file.kind
  )}</div>`
}

/** Drawn by hand like the others in the house: same stroke, same grid. */
const ICON = {
  print:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11"/><path d="M7.5 9.5 12 14l4.5-4.5"/><path d="M4 20h16"/></svg>',
  finder:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14.5 6.5l3 3"/></svg>',
}

/**
 * The button that hands a file or a folder to the file manager — or the same button, in the same
 * place, switched off with the reason in its title. A control that disappears when the machine
 * cannot do the thing teaches you nothing; one that stays and says why teaches you what is
 * missing.
 */
function finderButton(id, label, allowed) {
  const why = allowed ? label : can.whyNot || `${label} — this system gives k0 no way to do that.`
  return `<button class="act" id="${id}" data-act="reveal" type="button" title="${esc(why)}" aria-label="${esc(
    label
  )}"${allowed ? '' : ' disabled'}>${ICON.finder}</button>`
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
function acts(p, file) {
  const kind = file.kind
  const paper = kind === 'markdown' || kind === 'text'
  // In capitals and without the dot, like the PDF next to it: they are two buttons that do the
  // same thing, and writing them two different ways made them look like two different things.
  const ext = /\.([^./]+)$/.exec(p)?.[1].toUpperCase() || 'FILE'
  const out = []
  // Not on a file that is only half here. What is on screen when a document is cut is the first
  // two megabytes of it, and saving that back would throw the rest away without a word.
  if (paper && canEdit(p) && !file.truncated && file.size <= MAX_EDIT) {
    out.push(`<button class="act" data-act="edit" type="button" title="Edit this file here" aria-label="Edit">${ICON.edit}</button>`)
  }
  out.push(finderButton('reveal', 'Show this file in your file manager', can.reveal))
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

/**
 * Hand a path to the file manager. The same call for a file and for a folder: which of the two
 * gestures it is — point at it, or open it — is decided on the other side, by looking at what is
 * really there.
 */
async function reveal(rel) {
  try {
    await api('/api/file/reveal', { method: 'POST', body: JSON.stringify({ repo: REPO, path: rel }) })
  } catch (e) {
    toast(e.message)
  }
}

// ── Writing a file ────────────────────────────────────────────────────
// k0 reads your repositories; this is the one place it writes into one. It is deliberately small:
// configuration and notes only, a file that is already there, and no saving over somebody else's
// work. Anything larger than that is what you opened the repository with Claude for.
//
// The editing happens where the document was, not in a dialog over it: a dialog is the right size
// for a title and the wrong size for a README, and here the pane is already as tall as the file.

/** Turns the open document into the text it is made of. */
function startEdit() {
  if (!open || open.text == null || !canEdit(open.path)) return
  // The same refusal the button already makes, said again here: what is on screen when a document
  // is cut is only the first two megabytes of it, and saving that back would lose the rest.
  if (open.truncated || open.size > MAX_EDIT) return toast('This file is too big to edit here.')
  editing = { path: open.path, mtime: open.mtime }
  const parts = open.path.split('/')
  const last = parts.pop()
  const road = parts.map((x) => `<span>${esc(x)}</span>`).join('<i>/</i>')
  $('#doc').innerHTML =
    `<div class="crumb editing">${road ? `${road}<i>/</i>` : ''}<b>${esc(last)}</b><em>editing</em>` +
    `<span class="acts"><button class="act" data-act="cancel" type="button">Cancel</button>` +
    `<button class="act keep" data-act="save" type="button" title="Save (⌘S)">Save</button></span></div>` +
    // The newline after the tag is not decoration: the HTML parser eats the first one inside a
    // `<textarea>`, and without it a file that begins with a blank line would quietly lose it.
    `<textarea class="edit" spellcheck="false" autocomplete="off">\n${esc(open.text)}</textarea>`
  const box = $('#doc .edit')
  box.focus()
  box.setSelectionRange(0, 0)
}

/** Back to reading, with whatever is on disk. What was typed and not saved is gone, as it says. */
function cancelEdit() {
  const p = editing.path
  editing = null
  show(p)
}

let writing = false
async function saveEdit() {
  const box = $('#doc .edit')
  if (!box || writing) return
  writing = true
  try {
    await api('/api/file/save', {
      method: 'POST',
      body: JSON.stringify({ repo: REPO, path: editing.path, text: box.value, mtime: editing.mtime }),
    })
    const p = editing.path
    editing = null
    toast('Saved.')
    // Straight back to the file as it now is — read again from disk, not from what we sent, so
    // what you are looking at is what is really there.
    await show(p)
  } catch (e) {
    // Including the clash: the message says what happened and the text stays exactly where it is,
    // so it can be copied out or saved again once you have looked.
    toast(e.message, 8000)
  } finally {
    writing = false
  }
}

function toast(msg, ms = 4000) {
  const t = $('#toast')
  t.textContent = msg
  t.classList.add('show')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => t.classList.remove('show'), ms)
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
  can = data.can ?? can
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
    // The open file is changing under your eyes: it is re-read, and you stay where you are. Not
    // while it is being edited, though — redrawing the pane there would take away what you have
    // typed. The save is the one that finds out, and it says so instead of overwriting.
    if (!editing && open && changed.has(open.path)) {
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
      const { hits } = await api(`/api/files?${qs({ only: 'text', q, nerd: nerd ? '1' : '0' })}`)
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
    // While a file is being written the page's shortcuts step aside altogether: `/` is a
    // character, the arrows move the cursor, and Escape must not throw the work away by accident.
    // The one that is added is the one every editor has.
    if (editing) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveEdit()
      }
      return
    }
    // The box that searches inside a tree owns its keys too: it is a text field, and the arrows
    // belong to the cursor in it.
    if (document.activeElement?.id === 'jfind') return
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
      const row = rows[active]
      row.dir ? enterDir(row.dir) : show(row.p)
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

  markNerd()
  $('#nerd').onclick = () => setNerd(!nerd)

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
    if (e.target.closest('#show-config')) return setNerd(true)
    if (e.target.closest('#paste-clear')) return clearScope()
    if (e.target.closest('#paste-again')) return openPaste()
    if (e.target.closest('#dir-open')) return void reveal(scope.dir)

    // A folder, in the list or in the trail above it. Empty means the repository itself, which is
    // the way back out to the whole listing.
    const into = e.target.closest('[data-dir]')
    if (into && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
      e.preventDefault()
      return into.dataset.dir ? enterDir(into.dataset.dir) : clearScope()
    }

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
    if (act) {
      const what = act.dataset.act
      if (what === 'print') return void window.print()
      if (what === 'pdf') return void savePdf()
      if (what === 'reveal') return void reveal(open.path)
      if (what === 'edit') return void startEdit()
      if (what === 'save') return void saveEdit()
      if (what === 'cancel') return void cancelEdit()
      return
    }
    // A piece of the path above the document: it opens the folder it names, in the list.
    const into = e.target.closest('.crumb a[data-dir]')
    if (into && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault()
      return void enterDir(into.dataset.dir)
    }
    // File names found in the text open a new tab: they are real links, and nothing is intercepted
    // here — the browser deals with it. References written by hand inside the document instead stay
    // as they were, and open here.
    if (e.target.closest('a.ref')) return
    const a = e.target.closest('a[href^="?"]')
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return
    e.preventDefault()
    show(new URLSearchParams(a.getAttribute('href').slice(1)).get('f'))
  }
  // Searching inside a tree: it runs here, on the data, because the browser's own find does not
  // look inside a branch that is closed.
  $('#doc').addEventListener('input', (e) => {
    if (e.target.id === 'jfind') findInJson()
  })

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
