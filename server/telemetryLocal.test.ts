import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Store as ClaudeStore } from './collectors/claude/store.js'
import { Store as CodexStore } from './collectors/codex/store.js'
import { startTelemetryReceivers } from './telemetryReceiver.js'
import { getTelemetrySummary } from './telemetrySummary.js'
import { importHistory } from './telemetryStore.js'
import { getWorldSnapshot } from './worldSource.js'

const attribute = (key: string, value: string) => ({ key, value: { stringValue: value } })
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()))
const port = (server: Server) => (server.address() as { port: number }).port

test('Minecode receives both streams, persists them, and serves its own world and board summaries', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'minecode-telemetry-'))
  const claudePath = join(dir, 'claude.sqlite3')
  const codexPath = join(dir, 'codex.sqlite3')
  const stores = { claude: new ClaudeStore(claudePath), codex: new CodexStore(codexPath) }
  const servers = await startTelemetryReceivers(stores, { claude: 0, codex: 0 })
  const oldCodexHome = process.env.CODEX_HOME
  process.env.CODEX_HOME = dir
  try {
    const timestamp = String(BigInt(Date.now()) * 1_000_000n)
    const claude = { resourceMetrics: [{ resource: { attributes: [attribute('project.id', 'pilot')] }, scopeMetrics: [{ metrics: [{
      name: 'claude_code.token.usage', sum: { aggregationTemporality: 1, dataPoints: [{
        timeUnixNano: timestamp, asInt: '12', attributes: [attribute('session.id', 'claude-chat'), attribute('type', 'input')],
      }] },
    }] }] }] }
    const codex = { resourceLogs: [{ scopeLogs: [{ logRecords: [{
      timeUnixNano: timestamp, body: { stringValue: 'codex.user_prompt' },
      attributes: [attribute('conversation.id', 'codex-chat'), attribute('prompt', 'Hello')],
    }] }] }] }
    const post = (receiver: Server, path: string, body: unknown) => fetch(`http://127.0.0.1:${port(receiver)}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    assert.equal((await post(servers[0], '/v1/metrics', claude)).status, 200)
    assert.equal((await post(servers[1], '/v1/logs', codex)).status, 200)
    assert.equal((await post(servers[0], '/v1/metrics', claude)).status, 200)
    assert.equal((await post(servers[1], '/v1/metrics', codex)).status, 404)
    assert.equal(getTelemetrySummary('claude', 30, stores).tokens, 12)
    assert.equal(getTelemetrySummary('codex', 30, stores).prompts, 1)
    const world = await getWorldSnapshot(undefined, 2, 'telemetry', stores)
    assert.equal(world.source, 'telemetry')
    assert.equal(world.projects.reduce((sum, project) => sum + project.sessions.length, 0), 2)
  } finally {
    if (oldCodexHome === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = oldCodexHome
    await Promise.all(servers.map(close))
    stores.claude.close()
    stores.codex.close()
  }
  const reopened = { claude: new ClaudeStore(claudePath), codex: new CodexStore(codexPath) }
  try {
    assert.equal(getTelemetrySummary('claude', 30, reopened).tokens, 12)
    assert.equal(getTelemetrySummary('codex', 30, reopened).prompts, 1)
  } finally {
    reopened.claude.close()
    reopened.codex.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('first-run import copies a consistent legacy SQLite history once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'minecode-import-'))
  const sourcePath = join(dir, 'legacy.sqlite3')
  const destinationPath = join(dir, 'new', 'claude.sqlite3')
  const source = new ClaudeStore(sourcePath)
  try {
    const timestamp = String(BigInt(Date.now()) * 1_000_000n)
    source.ingestMetrics({ resourceMetrics: [{ scopeMetrics: [{ metrics: [{ name: 'claude_code.token.usage', sum: {
      aggregationTemporality: 1, dataPoints: [{ timeUnixNano: timestamp, asInt: '5', attributes: [attribute('session.id', 'legacy-chat'), attribute('type', 'input')] }],
    } }] }] }] })
    await importHistory(sourcePath, destinationPath)
    const imported = new ClaudeStore(destinationPath)
    try { assert.equal(imported.sessions(30).sessions[0].inputTokens, 5) }
    finally { imported.close() }
    await importHistory(sourcePath, destinationPath)
    const again = new ClaudeStore(destinationPath)
    try { assert.equal(again.sessions(30).sessions[0].inputTokens, 5) }
    finally { again.close() }
  } finally {
    source.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
