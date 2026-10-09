// Production static server for the Docker image: serves dist/ and a /config.js
// generated from the container environment, so no credentials are baked into
// the image. Node built-ins only (no runtime dependencies).
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const host = process.env.HOST || '0.0.0.0'
const port = Number(process.env.PORT || '4173')
const distRoot = path.resolve(process.cwd(), 'dist')
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
])

const runtimeConfigScript = `window.__APP_CONFIG__ = ${JSON.stringify({
  telegramApiId: process.env.TELEGRAM_API_ID || '',
  telegramApiHash: process.env.TELEGRAM_API_HASH || '',
  useMockAdapter: process.env.USE_MOCK_ADAPTER || '',
})}\n`

async function sendFile(response, filePath, cacheControl) {
  const body = await readFile(filePath)
  response.writeHead(200, {
    'Content-Type': mimeTypes.get(path.extname(filePath)) || 'application/octet-stream',
    'Cache-Control': cacheControl,
  })
  response.end(body)
}

const server = createServer(async (request, response) => {
  try {
    const { pathname } = new URL(request.url || '/', 'http://localhost')
    if (pathname === '/config.js') {
      response.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      response.end(runtimeConfigScript)
      return
    }

    const relative = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\]|\.\.[/\\])+/, '')
    const filePath = path.join(distRoot, relative || 'index.html')
    if (!filePath.startsWith(distRoot)) {
      response.writeHead(403).end()
      return
    }
    try {
      const immutable = relative.startsWith('assets')
      await sendFile(response, filePath, immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
    } catch {
      if (path.extname(relative)) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found')
        return
      }
      await sendFile(response, path.join(distRoot, 'index.html'), 'no-cache')
    }
  } catch {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Internal server error')
  }
})

server.listen(port, host, () => {
  process.stdout.write(`Serving dist on http://${host}:${port}\n`)
})
