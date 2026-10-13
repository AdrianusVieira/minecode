import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { TelemetryStores } from './telemetryStore.js'

const MAX_BODY_BYTES = 2_000_000

function send(response: ServerResponse, status: number, message?: string): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  response.end(JSON.stringify(message ? { error: message } : {}))
}

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  const length = Number(request.headers['content-length'])
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new ReceiverError(413, 'Request too large')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > MAX_BODY_BYTES) throw new ReceiverError(413, 'Request too large')
    chunks.push(bytes)
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object')
    return value
  } catch { throw new ReceiverError(400, 'Invalid OTLP JSON') }
}

class ReceiverError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

function receiver(source: 'claude' | 'codex', stores: TelemetryStores): Server {
  return createServer(async (request, response) => {
    const host = request.headers.host
    if (host !== undefined && !/^127\.0\.0\.1(?::\d+)?$/.test(host) && !/^localhost(?::\d+)?$/.test(host)) {
      send(response, 403, 'Invalid host')
      return
    }
    const path = request.url
    if (request.method !== 'POST' || (path !== '/v1/logs' && (source !== 'claude' || path !== '/v1/metrics'))) {
      send(response, 404, 'Not found')
      return
    }
    if (!request.headers['content-type']?.startsWith('application/json')) {
      send(response, 415, 'Use OTLP HTTP/JSON')
      return
    }
    try {
      const payload = await jsonBody(request)
      if (source === 'claude') {
        if (path === '/v1/metrics') stores.claude.ingestMetrics(payload)
        else stores.claude.ingestLogs(payload)
      } else stores.codex.ingestLogs(payload)
      send(response, 200)
    } catch (error) {
      if (error instanceof ReceiverError) send(response, error.status, error.message)
      else { console.error(`${source} telemetry ingest failed:`, error); send(response, 500, 'Internal error') }
    }
  })
}

function port(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback)
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} must be a valid port`)
  return value
}

function listen(server: Server, portNumber: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(portNumber, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
  })
}

export async function startTelemetryReceivers(stores: TelemetryStores, ports?: { claude: number; codex: number }): Promise<Server[]> {
  const claudePort = ports?.claude ?? port('CLAUDE_OTLP_PORT', 4318)
  const codexPort = ports?.codex ?? port('CODEX_OTLP_PORT', 18766)
  if (claudePort === codexPort && claudePort !== 0) throw new Error('Claude and Codex OTLP ports must differ')
  const servers = [receiver('claude', stores), receiver('codex', stores)]
  try {
    await listen(servers[0], claudePort)
    await listen(servers[1], codexPort)
  } catch (error) {
    for (const server of servers) server.close()
    throw error
  }
  console.log(`Claude OTLP: http://127.0.0.1:${(servers[0].address() as { port: number }).port}`)
  console.log(`Codex OTLP: http://127.0.0.1:${(servers[1].address() as { port: number }).port}/v1/logs`)
  return servers
}
