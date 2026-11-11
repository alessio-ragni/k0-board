#!/usr/bin/env node
// ── k0-board.com on this machine ─────────────────────────────────────────────
// Serves `site/` as it is, on 127.0.0.1, so the pages can be looked at before they go online. It is
// what `npm run serve` starts, and that script is what gives the k0 column of the board its globe:
// one click and the site is up, with the feature pages rebuilt first. Nothing here is deployed.
//
//   node site/serve.mjs           http://localhost:8080 (or $PORT)

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

/** The file a request asks for, or null when it is outside the folder or not there. */
export function resolve(root, url) {
  let p
  try {
    p = decodeURIComponent(new URL(url, 'http://x').pathname)
  } catch {
    return null
  }
  const file = path.resolve(root, '.' + path.posix.normalize(p))
  if (file !== root && !file.startsWith(root + path.sep)) return null
  const full = fs.existsSync(file) && fs.statSync(file).isDirectory() ? path.join(file, 'index.html') : file
  return fs.existsSync(full) && fs.statSync(full).isFile() ? full : null
}

export function serve(port = 8080, root = ROOT) {
  const server = http.createServer((req, res) => {
    const file = resolve(root, req.url)
    const missing = path.join(root, '404.html')
    const send = file || (fs.existsSync(missing) ? missing : null)
    res.writeHead(file ? 200 : 404, {
      'Content-Type': TYPES[path.extname(send || '.txt')] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    res.end(send ? fs.readFileSync(send) : 'Not found')
  })
  return server.listen(port, '127.0.0.1')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8080
  serve(port).on('listening', () => console.log(`k0-board.com on http://localhost:${port}`))
}
