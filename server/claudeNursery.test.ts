import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ClaudeNursery } from './claudeNursery.js'
import type { WorldSnapshot } from '../src/worldData.js'

test('a new Claude chat persists in the hospital and moves to its project after a reply', async () => {
  const root = mkdtempSync(join(tmpdir(), 'minecode-nursery-'))
  try {
    const nursery = new ClaudeNursery(root)
    const record = await nursery.create(root, 'Explore the village')
    const base: WorldSnapshot = { source: 'telemetry', updatedAt: new Date().toISOString(), projects: [] }
    const born = nursery.merge(base)
    assert.equal(born.projects[0].kind, 'Hospital')
    assert.equal(born.projects[0].sessions[0].newborn, true)
    assert.equal(born.projects[0].sessions[0].name, 'Explore the village')
    const reopened = new ClaudeNursery(root)
    assert.equal(reopened.get(record.id)?.stage, 'newborn')
    reopened.settle(record.id)
    const settled = reopened.merge(base)
    assert.equal(settled.projects[0].sessions.length, 0)
    assert.equal(settled.projects[1].sessions[0].externalId, record.id)
    assert.equal(settled.projects[1].sessions[0].newborn, false)
    assert.equal(settled.projects[1].name, root.split('/').at(-1))
    const withTelemetry: WorldSnapshot = { ...base, projects: [{ id: `claude:${root}:0`, name: 'Project', kind: 'Workshop', source: 'claude', sessions: [
      { id: `claude:${record.id}`, externalId: record.id, name: 'Telemetry title', updatedAt: null, activity: 'Observed', status: 'recent' },
    ] }] }
    const merged = reopened.merge(withTelemetry)
    assert.equal(merged.projects.flatMap((project) => project.sessions).filter((session) => session.externalId === record.id).length, 1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('the hospital accepts only an existing absolute project directory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'minecode-nursery-'))
  try {
    const nursery = new ClaudeNursery(root)
    await assert.rejects(nursery.create('../somewhere', 'Name'), /absolute project/)
    await assert.rejects(nursery.create(join(root, 'missing'), 'Name'), /does not exist/)
    await assert.rejects(nursery.create(root, ''), /name/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
