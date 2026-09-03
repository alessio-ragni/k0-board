// ── Configuration files, laid out ─────────────────────────────────────────────
// An `.env` is a table pretending to be a text file: two columns, one per line, and the reason
// you opened it is always to compare a name with a value. Shown as text, the values start in a
// different place on every line and the eye has to walk each one to the `=`. Shown as a table,
// you read the column.
//
// The rest — YAML, TOML, INI — is not a table: nesting matters, and a table would flatten the one
// thing that carries the meaning. Those keep their shape and only get their keys, their values
// and their comments told apart by colour.
//
// Like the tree next door, this knows nothing about the page: text in, a string of HTML out.

/** Written again here for the same reason as in `json.js`: the tests run in Node. */
const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/**
 * An `.env` read line by line, keeping everything — the comments and the blank lines included.
 *
 * They are kept because they are the file: a comment above a key says what the key is for, and a
 * view that dropped it would be a different file that happens to have the same values. Anything
 * this does not understand comes back as it was written rather than being guessed at.
 *
 * Returns rows of `{ kind: 'pair' | 'comment' | 'blank' | 'raw' }`.
 */
export function envRows(text) {
  const rows = []
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.replace(/\r$/, '')
    const trimmed = line.trim()
    if (!trimmed) {
      rows.push({ kind: 'blank' })
      continue
    }
    if (trimmed.startsWith('#')) {
      rows.push({ kind: 'comment', text: trimmed.replace(/^#\s?/, '') })
      continue
    }
    // `export FOO=bar` is the same line with a word in front of it: shell files and `.env` files
    // are copied back and forth, and both spellings turn up in the same repository.
    const body = trimmed.replace(/^export\s+/, '')
    const at = body.indexOf('=')
    if (at <= 0) {
      rows.push({ kind: 'raw', text: line })
      continue
    }
    const key = body.slice(0, at).trim()
    rows.push({ kind: 'pair', key, value: unquote(body.slice(at + 1).trim()) })
  }
  // A file ends with a newline, and that last empty line is not a blank line in the file: it is
  // the end of it. Showing it would put a hole at the bottom of every table.
  if (rows.length && rows[rows.length - 1].kind === 'blank') rows.pop()
  return rows
}

/**
 * The value without the quotes around it, and without the comment after it.
 *
 * The comment is only cut off an unquoted value: inside quotes a `#` is a character like any
 * other, and a password with a hash in it must not lose half of itself on the way to the screen.
 */
function unquote(value) {
  const quoted = /^(['"])([\s\S]*)\1$/.exec(value)
  if (quoted) return quoted[2]
  const hash = value.search(/\s#/)
  return hash === -1 ? value : value.slice(0, hash).trimEnd()
}

/** The two columns. An empty value is said in words, or the row would look like a mistake. */
export function envTable(text) {
  const body = envRows(text)
    .map((r) => {
      if (r.kind === 'pair') {
        const value = r.value
          ? `<td class="val">${esc(r.value)}</td>`
          : '<td class="val none">empty</td>'
        return `<tr><th>${esc(r.key)}</th>${value}</tr>`
      }
      if (r.kind === 'comment') return `<tr class="note"><td colspan="2">${esc(r.text)}</td></tr>`
      if (r.kind === 'raw') return `<tr class="odd"><td colspan="2">${esc(r.text)}</td></tr>`
      return '<tr class="gap"><td colspan="2"></td></tr>'
    })
    .join('')
  return `<table class="env">${body}</table>`
}

/**
 * YAML, TOML and INI: the same file, with the parts told apart.
 *
 * No parsing. A YAML parser written here would be a second thing to keep correct, and every one
 * of its mistakes would show you a file that is not the file. Reading a line at a time never
 * shows you anything that is not there — at worst it colours something in as though it were
 * ordinary text, which is what it does with everything it does not recognise.
 */
export function highlight(text) {
  const out = String(text ?? '')
    .split('\n')
    .map((raw) => {
      const line = raw.replace(/\r$/, '')
      const lead = line.length - line.trimStart().length
      const indent = esc(line.slice(0, lead))
      const rest = line.slice(lead)
      if (!rest) return ''
      if (rest.startsWith('#') || rest.startsWith(';')) return `${indent}<span class="c">${esc(rest)}</span>`
      // A TOML or INI heading: the one line that says where you are in the file.
      if (/^\[.*]$/.test(rest)) return `${indent}<span class="sec">${esc(rest)}</span>`
      // `- ` is a YAML list, and what follows it may itself be a pair.
      const dash = /^-\s+/.exec(rest)
      const item = dash ? rest.slice(dash[0].length) : rest
      const bullet = dash ? `<span class="dash">${esc(dash[0])}</span>` : ''
      const pair = /^([^:=#]+?)\s*([:=])\s*([\s\S]*)$/.exec(item)
      if (!pair) return `${indent}${bullet}<span class="v">${esc(item)}</span>`
      const value = pair[3] ? `<span class="v">${esc(pair[3])}</span>` : ''
      return `${indent}${bullet}<span class="key">${esc(pair[1])}</span><span class="sep">${pair[2]}</span> ${value}`
    })
    .join('\n')
  return `<pre class="conf">${out}</pre>`
}
