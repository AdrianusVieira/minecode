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
import { getClaudeAccounts, getSessionEvents, getSessionView } from './telemetryViews.js'
import { getWorldSnapshot } from './worldSource.js'
import { mapSessions } from './liveSource.js'
import { periodFrom } from './timeRange.js'

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
    assert.equal(getClaudeAccounts(30, stores).accounts[0].inputTokens, 12)
    assert.equal(getSessionView('claude', 'claude-chat', 30, stores)?.session.id, 'claude-chat')
    assert.equal(getSessionView('codex', 'codex-chat', 30, stores)?.prompts.length, 1)
    assert.equal(getSessionView('codex', 'missing', 30, stores), null)
    assert.equal(getSessionEvents('codex', 'codex-chat', 30, 0, stores)?.total, 1)
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

test('Codex prompt history distinguishes a continued chat from a signal-only ID', () => {
  const dir = mkdtempSync(join(tmpdir(), 'minecode-codex-evidence-'))
  const store = new CodexStore(join(dir, 'codex.sqlite3'))
  try {
    const now = Date.now()
    const log = (id: string, name: string, timestamp: number, extra: ReturnType<typeof attribute>[] = []) => ({
      timeUnixNano: String(BigInt(timestamp) * 1_000_000n), body: { stringValue: `codex.${name}` },
      attributes: [attribute('conversation.id', id), ...extra],
    })
    store.ingestLogs({ resourceLogs: [{ scopeLogs: [{ logRecords: [
      log('continued', 'user_prompt', now - 4 * 86_400_000, [attribute('prompt', 'Earlier request')]),
      log('continued', 'sse_event', now, [attribute('event.kind', 'response.completed'), attribute('total_token_count', '7')]),
      log('signal-only', 'conversation_starts', now),
      log('signal-only', 'sse_event', now + 1, [attribute('event.kind', 'response.completed'), attribute('total_token_count', '5')]),
    ] }] }] })
    const recent = store.sessions(2).sessions
    assert.equal(recent.length, 2)
    assert.equal(recent.find((session) => session.id === 'continued')?.hasUserPrompt, true)
    assert.equal(recent.find((session) => session.id === 'continued')?.prompts, 0)
    assert.equal(recent.find((session) => session.id === 'signal-only')?.hasUserPrompt, false)
    const world = mapSessions('codex', recent, 2, now + 2)
    assert.deepEqual(world.projects.flatMap((project) => project.sessions.map((session) => session.externalId)), ['continued'])
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('custom ranges apply to the world, dashboards, accounts, and session details', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'minecode-range-'))
  const stores = { claude: new ClaudeStore(join(dir, 'claude.sqlite3')), codex: new CodexStore(join(dir, 'codex.sqlite3')) }
  const oldCodexHome = process.env.CODEX_HOME
  process.env.CODEX_HOME = dir
  try {
    const first = Date.now() - 3 * 86_400_000
    const second = first + 86_400_000
    const metric = (id: string, at: number) => ({ resourceMetrics: [{ scopeMetrics: [{ metrics: [{ name: 'claude_code.token.usage', sum: {
      aggregationTemporality: 1, dataPoints: [{ timeUnixNano: String(BigInt(at) * 1_000_000n), asInt: '5', attributes: [attribute('session.id', id), attribute('user.email', 'person@example.test'), attribute('type', 'input')] }],
    } }] }] }] })
    const log = (id: string, at: number) => ({ resourceLogs: [{ scopeLogs: [{ logRecords: [{
      timeUnixNano: String(BigInt(at) * 1_000_000n), body: { stringValue: 'codex.user_prompt' },
      attributes: [attribute('conversation.id', id), attribute('prompt', 'Range check')],
    }] }] }] })
    stores.claude.ingestMetrics(metric('first-claude', first))
    stores.claude.ingestMetrics(metric('second-claude', second))
    stores.codex.ingestLogs(log('first-codex', first))
    stores.codex.ingestLogs(log('second-codex', second))
    const range = { start: first, end: second }
    const url = new URL(`http://localhost/api/world?days=custom&start=${first}&end=${second}`)
    assert.deepEqual(periodFrom(url), range)
    assert.equal(periodFrom(new URL('http://localhost/?days=custom&start=1&end=1')), null)
    assert.equal(periodFrom(new URL('http://localhost/?days=custom&start=x&end=2')), null)
    const world = await getWorldSnapshot(undefined, range, 'telemetry', stores)
    assert.deepEqual(world.projects.flatMap((project) => project.sessions.map((session) => session.externalId)).sort(), ['first-claude', 'first-codex'])
    assert.equal(getTelemetrySummary('claude', range, stores).conversations, 1)
    assert.equal(getTelemetrySummary('codex', range, stores).conversations, 1)
    assert.equal(getClaudeAccounts(range, stores).accounts[0].sessions, 1)
    assert.equal(getSessionView('claude', 'second-claude', range, stores), null)
    assert.equal(getSessionView('codex', 'second-codex', range, stores), null)
  } finally {
    if (oldCodexHome === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = oldCodexHome
    stores.claude.close(); stores.codex.close(); rmSync(dir, { recursive: true, force: true })
  }
})

test('exile removes local history and blocks future events for both agents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'minecode-exile-'))
  const claudePath = join(dir, 'claude.sqlite3'), codexPath = join(dir, 'codex.sqlite3')
  const stores = { claude: new ClaudeStore(claudePath), codex: new CodexStore(codexPath) }
  const at = Date.now()
  const metric = { resourceMetrics: [{ scopeMetrics: [{ metrics: [{ name: 'claude_code.token.usage', sum: {
    aggregationTemporality: 1, dataPoints: [{ timeUnixNano: String(BigInt(at) * 1_000_000n), asInt: '7', attributes: [attribute('session.id', 'exiled-claude'), attribute('type', 'input')] }],
  } }] }] }] }
  const log = { resourceLogs: [{ scopeLogs: [{ logRecords: [{ timeUnixNano: String(BigInt(at) * 1_000_000n), body: { stringValue: 'codex.user_prompt' },
    attributes: [attribute('conversation.id', 'exiled-codex'), attribute('prompt', 'Hello')],
  }] }] }] }
  try {
    stores.claude.ingestMetrics(metric)
    stores.codex.ingestLogs(log)
    assert.equal(stores.claude.deleteSession('exiled-claude'), true)
    assert.equal(stores.codex.deleteConversation('exiled-codex'), true)
    assert.equal(stores.claude.deleteSession('exiled-claude'), false)
    assert.equal(stores.codex.deleteConversation('exiled-codex'), false)
    assert.equal(stores.claude.ingestMetrics(metric), 0)
    assert.equal(stores.codex.ingestLogs(log), 0)
    assert.equal(getTelemetrySummary('claude', 'all', stores).conversations, 0)
    assert.equal(getTelemetrySummary('codex', 'all', stores).conversations, 0)
  } finally { stores.claude.close(); stores.codex.close() }
  const reopened = { claude: new ClaudeStore(claudePath), codex: new CodexStore(codexPath) }
  try {
    assert.equal(reopened.claude.ingestMetrics(metric), 0)
    assert.equal(reopened.codex.ingestLogs(log), 0)
    assert.equal(getTelemetrySummary('claude', 'all', reopened).conversations, 0)
    assert.equal(getTelemetrySummary('codex', 'all', reopened).conversations, 0)
  } finally { reopened.claude.close(); reopened.codex.close(); rmSync(dir, { recursive: true, force: true }) }
})
