import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { findClaudeChatSession, runClaudeChat, type ClaudeChatEvent } from './claudeChat.js'

test('a Claude chat resumes only a local transcript with a usable project directory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'minecode-claude-chat-'))
  const id = '5b3f2c1a-8d4e-4f6b-9a7c-2e1d0f9b8a6c'
  try {
    const project = join(root, 'projects', 'test-project')
    const cwd = join(root, 'work')
    mkdirSync(project, { recursive: true })
    mkdirSync(cwd)
    writeFileSync(join(project, `${id}.jsonl`), `${JSON.stringify({ type: 'user', sessionId: id, cwd })}\n`)
    assert.deepEqual(await findClaudeChatSession(id, root), { id, cwd })
    assert.equal(await findClaudeChatSession('../settings', root), null)
    rmSync(cwd, { recursive: true })
    assert.equal(await findClaudeChatSession(id, root), null)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a finished Claude assistant message closes the chat without waiting for a result event', { timeout: 2000 }, async () => {
  const events: ClaudeChatEvent[] = []
  const fakeQuery = (() => (async function* () {
    yield { type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'READY' }] } }
    await new Promise(() => {})
  })()) as unknown as NonNullable<Parameters<typeof runClaudeChat>[4]>
  await runClaudeChat({ id: '5b3f2c1a-8d4e-4f6b-9a7c-2e1d0f9b8a6c', cwd: '/tmp' }, 'check', new AbortController().signal, (event) => events.push(event), fakeQuery)
  assert.deepEqual(events, [{ type: 'done', text: 'READY' }])
})
