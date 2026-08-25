// ── Markdown ──────────────────────────────────────────────────────────────────
// A small layout engine, written by hand because k0 has no dependencies and nothing to
// compile. It covers what documents actually contain: headings, lists — including the ones with
// checkboxes, which is the shape an archived plan takes — tables, quotes, code blocks, and
// inline bold, italic, strikethrough and links.
//
// The order matters. First every piece of HTML is escaped, so nothing in the file can become a
// tag; then the pieces that need protecting — code and links — are set aside and put back at
// the end, otherwise a `**x**` inside code would come out bold.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/**
 * The header block between two lines of nothing but dashes, the way Claude Code's skills and
 * plans write it. It is not text of the document: it is its label, and it should be read as
 * one — the title becomes the name of the page, not just another paragraph.
 * Returns `{ data, body }`; with no header, `data` is empty and `body` is everything.
 */
export function matter(md) {
  const text = String(md ?? '').replace(/\0/g, '').replace(/\r\n?/g, '\n')
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  if (!m) return { data: {}, body: text }

  const data = {}
  for (const line of m[1].split('\n')) {
    // Only `key: value` on one line. The rest — lists, nesting — is of no use here, and
    // trying would mean writing a whole YAML parser.
    const kv = /^([A-Za-z_][\w -]*):\s*(.*)$/.exec(line)
    if (!kv) continue
    data[kv[1].trim().toLowerCase()] = kv[2].trim().replace(/^["'](.*)["']$/s, '$1')
  }
  return { data, body: text.slice(m[0].length) }
}

/** The title written in the header, whatever it was called. */
export const titleOf = (data) => data.title || data.name || null

/**
 * `md` is the text, `link(target, kind)` decides where a reference leads: the viewer needs it
 * to point images at the real bytes and links at the other documents.
 */
export function render(md, link = (t) => t) {
  const lines = matter(md).body.split('\n')

  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i++
      continue
    }

    // A code fence: nothing inside is looked at, it is simply copied.
    const fence = /^\s*(```+|~~~+)\s*(\S*)/.exec(line)
    if (fence) {
      const close = fence[1][0]
      const body = []
      i++
      while (i < lines.length && !new RegExp(`^\\s*${close}{3,}\\s*$`).test(lines[i])) body.push(lines[i++])
      i++ // the closing line
      const lang = fence[2] ? ` class="lang-${esc(fence[2])}"` : ''
      out.push(`<pre><code${lang}>${esc(body.join('\n'))}</code></pre>`)
      continue
    }

    const head = /^(#{1,6})\s+(.*)$/.exec(line)
    if (head) {
      const n = head[1].length
      out.push(`<h${n}>${inline(head[2].replace(/\s+#+\s*$/, ''), link)}</h${n}>`)
      i++
      continue
    }

    if (/^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(line)) {
      out.push('<hr>')
      i++
      continue
    }

    if (/^\s{0,3}>/.test(line)) {
      const body = []
      while (i < lines.length && (/^\s{0,3}>/.test(lines[i]) || (body.length && lines[i].trim()))) {
        body.push(lines[i++].replace(/^\s{0,3}>\s?/, ''))
      }
      out.push(`<blockquote>${render(body.join('\n'), link)}</blockquote>`)
      continue
    }

    if (ITEM.test(line)) {
      const items = []
      while (i < lines.length && (ITEM.test(lines[i]) || (items.length && lines[i].trim() && /^\s{2,}/.test(lines[i])))) {
        const m = ITEM.exec(lines[i])
        if (m) items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), text: m[3] })
        // A continuation line: it belongs to the last item.
        else items[items.length - 1].text += ` ${lines[i].trim()}`
        i++
      }
      // One pass is usually enough. A second is only needed when a list starts indented and
      // then comes back to the left: those items are a list of their own.
      for (let k = 0; k < items.length; ) {
        const built = nest(items, k, link)
        out.push(built.html)
        k = built.i
      }
      continue
    }

    if (line.includes('|') && i + 1 < lines.length && isRule(lines[i + 1])) {
      const header = cells(line)
      const align = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''))
      i += 2
      const rows = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]))
      const th = header.map((c, k) => `<th${style(align[k])}>${inline(c, link)}</th>`).join('')
      const tb = rows
        .map((r) => `<tr>${r.map((c, k) => `<td${style(align[k])}>${inline(c, link)}</td>`).join('')}</tr>`)
        .join('')
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`)
      continue
    }

    // A paragraph runs until something else starts. The lines are joined: documents wrap at
    // seventy characters, and breaking there for real would cut every sentence in half.
    const para = []
    while (i < lines.length && lines[i].trim() && !starts(lines[i])) para.push(lines[i++])
    out.push(`<p>${inline(para.join('\n'), link)}</p>`)
  }
  return out.join('\n')
}

const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const style = (a) => (a ? ` style="text-align:${a}"` : '')
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
const isRule = (line) => {
  const c = cells(line)
  return c.length > 0 && c.every((x) => /^:?-{1,}:?$/.test(x))
}

/** The lines that open a different block, and so close the paragraph in progress. */
const starts = (l) =>
  /^\s*(```|~~~)/.test(l) || /^#{1,6}\s/.test(l) || /^\s{0,3}>/.test(l) || ITEM.test(l) || /^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(l)

/** Lists nest by indentation: everything further right is taken. */
function nest(items, from, link) {
  const indent = items[from].indent
  const ordered = items[from].ordered
  const parts = []
  let i = from
  while (i < items.length && items[i].indent >= indent) {
    if (items[i].indent > indent) {
      const inner = nest(items, i, link)
      parts[parts.length - 1] += inner.html
      i = inner.i
      continue
    }
    parts.push(item(items[i].text, link))
    i++
  }
  const tag = ordered ? 'ol' : 'ul'
  return { html: `<${tag}>${parts.map((p) => `<li>${p}</li>`).join('')}</${tag}>`, i }
}

/** `- [ ]` and `- [x]`: the checkboxes of an archived plan, shown but not tickable. */
function item(text, link) {
  const box = /^\[( |x|X)\]\s+(.*)$/.exec(text)
  if (!box) return inline(text, link)
  const on = box[1] !== ' '
  // The text has to be wrapped: the label is both a column and a row, and without one
  // container every bold fragment would become a column of its own.
  return `<label class="task"><input type="checkbox" disabled${on ? ' checked' : ''}><span>${inline(
    box[2],
    link
  )}</span></label>`
}

// ── Inline ───────────────────────────────────────────────────────────────────
function inline(raw, link) {
  // Anything already finished is set aside behind a placeholder and put back at the end. The
  // placeholder lives in Unicode's private-use area: no real document contains those
  // characters, so there is no way to confuse one with the text.
  const kept = []
  const hold = (html) => `\uE000${kept.push(html) - 1}\uE001`

  let s = esc(raw)

  // Code first: what is inside it is not markdown, it is text.
  s = s.replace(/`([^`\n]+)`/g, (_, c) => hold(`<code>${c}</code>`))
  // Images before links: same syntax, with an exclamation mark in front.
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (_, alt, src) =>
    hold(`<img src="${href(src, 'image', link)}" alt="${alt}" loading="lazy">`)
  )
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (_, text, target) => {
    const u = href(target, 'link', link)
    const out = /^https?:/i.test(u) ? ' target="_blank" rel="noreferrer"' : ''
    return hold(`<a href="${u}"${out}>${text}</a>`)
  })
  // Bare addresses, which in documents are the majority.
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, before, u) =>
    `${before}${hold(`<a href="${u}" target="_blank" rel="noreferrer">${u}</a>`)}`
  )

  // Bold can start on one line and end on the next. Documents wrap at seventy characters, and
  // a bold phrase longer than that is bound to straddle a break: excluding the newline left it
  // on screen with the asterisks still in it. Crossing a newline here is safe — the real break,
  // the one between one paragraph and the next, never reaches this far: every block is laid out
  // on its own.
  s = s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_]+)_/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    // Two spaces at the end of a line are a deliberate break; other newlines are not.
    .replace(/ {2,}\n/g, '<br>\n')

  // Several passes, because the placeholders nest: a link whose text is already a piece set
  // aside — `[`name.md`](...)` — brings the code's placeholder back out when it is restored.
  // A single pass would leave it there, on screen, as a little square.
  for (let i = 0; i < 6 && s.includes('\uE000'); i++) {
    s = s.replace(/\uE000(\d+)\uE001/g, (_, k) => kept[Number(k)] ?? '')
  }
  return s
}

/**
 * Where a reference leads. Schemes that are not addresses — `javascript:`, `data:` — do not get
 * through: Claude writes these files, but they are still files that come off the disk and
 * nobody has looked at them before they are shown.
 */
function href(target, kind, link) {
  const t = target.trim()
  if (/^(https?:|mailto:|#)/i.test(t)) return t
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return '#'
  return link(t, kind)
}
