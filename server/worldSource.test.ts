import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseWorldFile } from './worldSource.js'

test('accepts a standalone session snapshot', () => {
  const projects = parseWorldFile({ projects: [{ id: 'project-one', name: 'Project One', kind: 'Workshop', sessions: [{ id: 'session-one', name: 'Plan village', updatedAt: '2026-10-12T12:00:00Z', activity: 'Planning', status: 'recent' }] }] })
  assert.equal(projects[0].sessions[0].name, 'Plan village')
  assert.equal(projects[0].source, 'claude')
})

test('assigns Codex projects to their own district', () => {
  const projects = parseWorldFile({ projects: [{ id: 'codex-project', name: 'Signal Keep', kind: 'Outpost', source: 'codex', sessions: [] }] })
  assert.equal(projects[0].source, 'codex')
  assert.throws(() => parseWorldFile({ projects: [{ id: 'bad', name: 'Bad', kind: 'Outpost', source: 'other', sessions: [] }] }), /source must be claude or codex/)
})

test('rejects duplicate session identities across buildings', () => {
  assert.throws(() => parseWorldFile({ projects: [
    { id: 'a', name: 'A', kind: 'Workshop', sessions: [{ id: 'same', name: 'One', activity: 'Idle', status: 'quiet' }] },
    { id: 'b', name: 'B', kind: 'Workshop', sessions: [{ id: 'same', name: 'Two', activity: 'Idle', status: 'quiet' }] },
  ] }), /Duplicate session id/)
})

test('validates optional token totals for character aging', () => {
  const project = { id: 'p', name: 'P', kind: 'Workshop', sessions: [
    { id: 's', name: 'S', activity: 'Working', status: 'recent', tokens: 12_000 },
  ] }
  assert.equal(parseWorldFile({ projects: [project] })[0].sessions[0].tokens, 12_000)
  assert.throws(() => parseWorldFile({ projects: [{ ...project, sessions: [{ ...project.sessions[0], tokens: -1 }] }] }), /tokens must be a non-negative number/)
})
