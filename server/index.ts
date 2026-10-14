import { createReadStream, statSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getWorldSnapshot } from './worldSource.js'
import { getTelemetrySummary } from './telemetrySummary.js'
import { openTelemetryStores } from './telemetryStore.js'
import { startTelemetryReceivers } from './telemetryReceiver.js'
import { getClaudeAccounts, getSessionEvents, getSessionView } from './telemetryViews.js'
import { periodFrom } from './timeRange.js'
import type { TelemetrySource } from '../src/telemetryData.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dist = join(root, 'dist')
const dataFile = process.env.VILLAGE_DATA_FILE ? resolve(process.env.VILLAGE_DATA_FILE) : undefined
const dataMode = process.env.VILLAGE_SOURCE || 'auto'
if (!['auto', 'telemetry', 'sample'].includes(dataMode)) throw new Error('VILLAGE_SOURCE must be auto, telemetry, or sample')
const port = Number(process.env.VILLAGE_PORT || 41321)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('VILLAGE_PORT must be a valid port')
const { stores, stopTitles } = await openTelemetryStores()
let receivers
try { receivers = await startTelemetryReceivers(stores) }
catch (error) {
  stopTitles()
  stores.claude.close()
  stores.codex.close()
  throw error
}

function sendJson(response: ServerResponse, data: unknown, status = 200): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  response.end(JSON.stringify(data))
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  const pathname = url.pathname
  const sessionMatch = /^\/api\/telemetry\/(claude|codex)\/sessions\/([^/]+?)(\/events)?$/.exec(pathname)
  if (request.method === 'DELETE' && sessionMatch && !sessionMatch[3]) {
    let id: string
    try { id = decodeURIComponent(sessionMatch[2]) }
    catch { sendJson(response, { error: 'Invalid session ID' }, 400); return }
    if (!id || id.length > 200) { sendJson(response, { error: 'Invalid session ID' }, 400); return }
    try {
      const removed = sessionMatch[1] === 'claude' ? stores.claude.deleteSession(id) : stores.codex.deleteConversation(id)
      sendJson(response, removed ? { exiled: true } : { error: 'Session not found' }, removed ? 200 : 404)
    } catch (error) { console.error('Session exile failed:', error); sendJson(response, { error: 'Could not exile this session.' }, 503) }
    return
  }
  if (request.method !== 'GET') { sendJson(response, { error: 'Not found' }, 404); return }
  if (pathname === '/api/world') {
    const period = periodFrom(url, 2)
    if (period === null) { sendJson(response, { error: 'Invalid time range' }, 400); return }
    try { sendJson(response, await getWorldSnapshot(dataFile, period, dataMode, stores)) }
    catch (error) {
      console.error('World data failed:', error)
      sendJson(response, { error: 'World data is unavailable. Check the selected data source.' }, 503)
    }
    return
  }
  const telemetryMatch = /^\/api\/telemetry\/(claude|codex)$/.exec(pathname)
  if (telemetryMatch) {
    const period = periodFrom(url)
    if (period === null) { sendJson(response, { error: 'Invalid time range' }, 400); return }
    try {
      sendJson(response, getTelemetrySummary(telemetryMatch[1] as 'claude' | 'codex', period, stores))
    } catch (error) {
      console.error('Telemetry summary failed:', error)
      sendJson(response, { error: 'Telemetry data is unavailable. Check Minecode’s local storage.' }, 503)
    }
    return
  }
  if (pathname === '/api/telemetry/claude/accounts') {
    const period = periodFrom(url)
    if (period === null) { sendJson(response, { error: 'Invalid time range' }, 400); return }
    try { sendJson(response, getClaudeAccounts(period, stores)) }
    catch (error) { console.error('Account overview failed:', error); sendJson(response, { error: 'Account data is unavailable.' }, 503) }
    return
  }
  if (sessionMatch) {
    const period = periodFrom(url)
    if (period === null) { sendJson(response, { error: 'Invalid time range' }, 400); return }
    let id: string
    try { id = decodeURIComponent(sessionMatch[2]) }
    catch { sendJson(response, { error: 'Invalid session ID' }, 400); return }
    const source = sessionMatch[1] as TelemetrySource
    const offset = Number(url.searchParams.get('offset') || '0')
    if (sessionMatch[3] && (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000)) { sendJson(response, { error: 'Invalid activity offset' }, 400); return }
    try {
      const data = sessionMatch[3] ? getSessionEvents(source, id, period, offset, stores) : getSessionView(source, id, period, stores)
      sendJson(response, data || { error: 'Session not found in this period' }, data ? 200 : 404)
    } catch (error) { console.error('Session view failed:', error); sendJson(response, { error: 'Session data is unavailable.' }, 503) }
    return
  }
  if (pathname !== '/' && pathname !== '/minecode-mark.svg' && !pathname.startsWith('/assets/')) { sendJson(response, { error: 'Not found' }, 404); return }
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

server.listen(port, '127.0.0.1', () => console.log(`Minecode: http://127.0.0.1:${port}`))
const stop = () => {
  stopTitles()
  server.close()
  for (const receiver of receivers) receiver.close()
  stores.claude.close()
  stores.codex.close()
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
