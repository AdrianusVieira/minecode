import { createReadStream, statSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getWorldSnapshot } from './worldSource.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dist = join(root, 'dist')
const dataFile = process.env.VILLAGE_DATA_FILE ? resolve(process.env.VILLAGE_DATA_FILE) : undefined
const port = Number(process.env.VILLAGE_PORT || 41321)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('VILLAGE_PORT must be a valid port')

function sendJson(response: ServerResponse, data: unknown, status = 200): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  response.end(JSON.stringify(data))
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname
  if (request.method !== 'GET') { sendJson(response, { error: 'Not found' }, 404); return }
  if (pathname === '/api/world') {
    try { sendJson(response, await getWorldSnapshot(dataFile)) }
    catch (error) {
      console.error('World data failed:', error)
      sendJson(response, { error: 'World data is unavailable. Check VILLAGE_DATA_FILE.' }, 503)
    }
    return
  }
  if (pathname !== '/' && !pathname.startsWith('/assets/')) { sendJson(response, { error: 'Not found' }, 404); return }
  const target = pathname === '/' ? join(dist, 'index.html') : resolve(dist, pathname.slice(1))
  const pathFromDist = relative(dist, target)
  if (pathFromDist === '..' || pathFromDist.startsWith(`..${sep}`) || pathFromDist.startsWith(sep)) { sendJson(response, { error: 'Not found' }, 404); return }
  try {
    const stat = statSync(target)
    if (!stat.isFile()) throw new Error('Not a file')
    const contentType = ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' } as Record<string, string>)[extname(target)] || 'application/octet-stream'
    response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': stat.size, 'X-Content-Type-Options': 'nosniff' })
    createReadStream(target).pipe(response)
  } catch { sendJson(response, { error: 'Build the project first with npm run build' }, 503) }
})

server.listen(port, '127.0.0.1', () => console.log(`The Village: http://127.0.0.1:${port}`))
