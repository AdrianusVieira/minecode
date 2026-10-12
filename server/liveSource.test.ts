import assert from 'node:assert/strict'
import test from 'node:test'
import { mapSessions } from './liveSource.js'

const now = Date.parse('2026-10-12T12:00:00Z')

test('maps only recent telemetry fields into Claude buildings', () => {
  const result = mapSessions('claude', [
    { id: 'abc', title: 'Plan launch', project: '/work/the-village', lastSeen: now - 60_000,
      recentEvents: [{ name: 'assistant_response', prompt: 'private text' }], prompt: 'private text' },
    { id: 'old', title: 'Old session', project: 'Archive', lastSeen: now - 3 * 86_400_000 },
  ], 2, now)
  assert.equal(result.projects.length, 1)
  assert.equal(result.projects[0].name, 'the-village')
  assert.equal(result.projects[0].sessions[0].name, 'Plan launch')
  assert.equal(result.projects[0].sessions[0].activity, 'A response was completed')
  assert.equal(result.projects[0].sessions[0].status, 'recent')
  assert.equal(JSON.stringify(result).includes('private text'), false)
})

test('groups Codex sessions with missing metadata honestly', () => {
  const result = mapSessions('codex', [{ id: 'xyz', lastSeen: now, recentEvents: [{ name: 'sse_event' }] }], 1, now)
  assert.equal(result.projects[0].name, 'Unmapped Codex work')
  assert.equal(result.projects[0].sessions[0].name, 'Codex session xyz')
  assert.equal(result.projects[0].sessions[0].externalId, 'xyz')
  assert.ok(result.notices.some((notice) => notice.includes('no local project metadata')))
})

test('keeps projects with the same folder name separate', () => {
  const result = mapSessions('codex', [
    { id: 'one', lastSeen: now }, { id: 'two', lastSeen: now },
  ], 1, now, new Map([
    ['one', { cwd: '/one/app', title: 'First' }],
    ['two', { cwd: '/two/app', title: 'Second' }],
  ]))
  assert.equal(result.projects.length, 2)
  assert.deepEqual(result.projects.map((project) => project.name), ['app', 'app'])
  assert.notEqual(result.projects[0].id, result.projects[1].id)
})

test('groups Codex dated chat folders without treating one-letter names as projects', () => {
  const result = mapSessions('codex', [
    { id: 'one', lastSeen: now }, { id: 'two', lastSeen: now },
  ], 1, now, new Map([
    ['one', { cwd: '/Users/example/Documents/Codex/2026-10-09/c', title: 'Set up Postman requests' }],
    ['two', { cwd: '/Users/example/Documents/Codex/2026-10-10/l', title: 'Find Alexa options' }],
  ]))
  assert.equal(result.projects.length, 1)
  assert.equal(result.projects[0].name, 'Codex chats')
  assert.deepEqual(result.projects[0].sessions.map((session) => session.name), ['Set up Postman requests', 'Find Alexa options'])
})
