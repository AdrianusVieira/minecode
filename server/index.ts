import { createReadStream, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getWorldSnapshot } from './worldSource.js'
import { getTelemetrySummary } from './telemetrySummary.js'
import { openTelemetryStores } from './telemetryStore.js'
import { startTelemetryReceivers } from './telemetryReceiver.js'
import { getClaudeAccounts, getSessionEvents, getSessionView } from './telemetryViews.js'
import { periodFrom } from './timeRange.js'
import { findClaudeChatSession, readClaudeChatMessages, runClaudeChat, type ClaudeChatEvent } from './claudeChat.js'
import { ClaudeNursery } from './claudeNursery.js'
import type { TelemetrySource } from '../src/telemetryData.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dist = join(root, 'dist')
const dataFile = process.env.VILLAGE_DATA_FILE ? resolve(process.env.VILLAGE_DATA_FILE) : undefined
const dataMode = process.env.VILLAGE_SOURCE || 'auto'
if (!['auto', 'telemetry', 'sample'].includes(dataMode)) throw new Error('VILLAGE_SOURCE must be auto, telemetry, or sample')
const port = Number(process.env.VILLAGE_PORT || 41321)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('VILLAGE_PORT must be a valid port')
const activeClaudeChats = new Set<string>()
const nursery = new ClaudeNursery()
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

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('Send a JSON message.')
  let body = ''
  for await (const chunk of request) {
    body += chunk.toString('utf8')
    if (Buffer.byteLength(body) > 16_384) throw new Error('Message is too long.')
  }
  let value: unknown
  try { value = JSON.parse(body) }
  catch { throw new Error('Invalid JSON message.') }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Send a JSON object.')
  return value as Record<string, unknown>
}

async function readChatPrompt(request: IncomingMessage): Promise<string> {
  const { prompt } = await readJsonBody(request)
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8_000) throw new Error('Enter a message up to 8,000 characters.')
  return prompt.trim()
}

function chatOriginAllowed(request: IncomingMessage): boolean {
  const allowedOrigins = new Set([`http://127.0.0.1:${port}`, 'http://127.0.0.1:5177'])
  return (!request.headers.origin || allowedOrigins.has(request.headers.origin)) && request.headers['sec-fetch-site'] !== 'cross-site'
}

function sendChatEvent(response: ServerResponse, event: ClaudeChatEvent): void {
  if (response.writableEnded || response.destroyed) return
  response.write(`data: ${JSON.stringify(event)}\n\n`)
  if (event.type !== 'text') response.end()
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  const pathname = url.pathname
  if (pathname === '/api/claude/projects' && request.method === 'GET') {
    try { sendJson(response, { projects: await nursery.projects() }) }
    catch (error) { console.error('Claude projects failed:', error); sendJson(response, { error: 'Could not list Claude projects.' }, 503) }
    return
  }
  if (pathname === '/api/claude/chats' && request.method === 'POST') {
    if (!chatOriginAllowed(request)) { sendJson(response, { error: 'Cross-origin chat requests are not allowed.' }, 403); return }
    try {
      const body = await readJsonBody(request)
      const record = await nursery.create(body.cwd, body.title)
      sendJson(response, { session: record }, 201)
    } catch (error) { sendJson(response, { error: error instanceof Error ? error.message : 'Could not create this chat.' }, 400) }
    return
  }
  const chatMatch = /^\/api\/claude\/chat\/([^/]+?)(\/messages)?$/.exec(pathname)
  if (chatMatch && (request.method === 'GET' || request.method === 'POST')) {
    const id = chatMatch[1]
    if (request.method === 'GET' && !chatMatch[2]) {
      const session = nursery.get(id) || await findClaudeChatSession(id)
      sendJson(response, { available: !!session, reason: session ? null : 'This Claude session has no local transcript or project folder.' })
      return
    }
    if (request.method === 'GET' && chatMatch[2]) {
      const record = nursery.get(id)
      const transcript = await findClaudeChatSession(id)
      const session = transcript || (record ? { id, cwd: record.cwd, newSession: true } : null)
      if (!session) { sendJson(response, { error: 'This Claude session cannot be found.' }, 404); return }
      try { sendJson(response, { messages: await readClaudeChatMessages(session) }) }
      catch (error) { console.error('Claude history failed:', error); sendJson(response, { error: 'Could not read this chat history.' }, 503) }
      return
    }
    if (request.method === 'POST' && chatMatch[2]) {
      if (!chatOriginAllowed(request)) {
        sendJson(response, { error: 'Cross-origin chat requests are not allowed.' }, 403); return
      }
      const record = nursery.get(id)
      const transcript = await findClaudeChatSession(id)
      const session = transcript || (record ? { id, cwd: record.cwd, newSession: true } : null)
      if (!session) { sendJson(response, { error: 'This Claude session cannot be resumed from this machine.' }, 404); return }
      let prompt: string
      try { prompt = await readChatPrompt(request) }
      catch (error) { sendJson(response, { error: error instanceof Error ? error.message : 'Invalid message.' }, 400); return }
      if (activeClaudeChats.has(id)) { sendJson(response, { error: 'Claude is already responding in this session.' }, 409); return }
      activeClaudeChats.add(id)
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no' })
      response.flushHeaders()
      const controller = new AbortController()
      response.on('close', () => controller.abort())
      const timeout = setTimeout(() => {
        sendChatEvent(response, { type: 'error', message: 'Claude took too long to reply. Try again or choose a shorter session.' })
        controller.abort()
      }, 120_000)
      try { await runClaudeChat(session, prompt, controller.signal, (event) => {
        if (event.type === 'done') nursery.settle(id)
        sendChatEvent(response, event)
      }) }
      finally { clearTimeout(timeout); activeClaudeChats.delete(id); if (!response.writableEnded) response.end() }
      return
    }
  }
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
    try { sendJson(response, nursery.merge(await getWorldSnapshot(dataFile, period, dataMode, stores))) }
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
