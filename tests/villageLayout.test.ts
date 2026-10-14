import assert from 'node:assert/strict'
import test from 'node:test'
import { BUILDING_GAP, footprintsConflict, planVillageLayout, projectedFootprintsConflict } from '../src/villageLayout.js'

type Building = Parameters<typeof planVillageLayout>[0][number]

function assertClear(buildings: Building[]) {
  const layout = planVillageLayout(buildings)
  for (let index = 0; index < layout.footprints.length; index++) {
    const first = layout.footprints[index]
    assert.ok(layout.size / 2 - Math.abs(first.x) - first.width / 2 >= 12)
    assert.ok(layout.size / 2 - Math.abs(first.z) - first.depth / 2 >= 12)
    for (const second of layout.footprints.slice(index + 1)) {
      assert.equal(footprintsConflict(first, second), false, `${first.id} blocks ${second.id}; required gap ${BUILDING_GAP}`)
      assert.equal(projectedFootprintsConflict(first, second), false, `${first.id} hides ${second.id} in the default camera view`)
    }
  }
  return layout
}

test('the hospital has a reserved lot and workshops keep clear space around every building', () => {
  const buildings: Building[] = [
    { id: 'hall', source: 'claude', kind: 'Commons', width: 13.2, depth: 10.5 },
    { id: 'hospital', source: 'claude', kind: 'Hospital', width: 9.4, depth: 7.5 },
    ...Array.from({ length: 12 }, (_, index): Building => ({ id: `claude-${index}`, source: 'claude', kind: 'Workshop', width: 9.4, depth: 7.5 })),
    ...Array.from({ length: 12 }, (_, index): Building => ({ id: `codex-${index}`, source: 'codex', kind: 'Outpost', width: 9.4, depth: 7.5 })),
  ]
  const layout = assertClear(buildings)
  assert.ok(layout.size >= 120)
  assert.ok(layout.sites.has('hospital'))
})

test('larger halls and crowded workshops expand the territory without collisions', () => {
  const buildings: Building[] = [
    { id: 'hall', source: 'claude', kind: 'Commons', width: 20, depth: 24 },
    { id: 'hospital', source: 'claude', kind: 'Hospital', width: 18, depth: 12 },
    ...Array.from({ length: 40 }, (_, index): Building => ({ id: `project-${index}`, source: index % 2 ? 'codex' : 'claude', kind: 'Workshop', width: index % 3 ? 12 : 21, depth: index % 4 ? 7.5 : 12 })),
  ]
  assertClear(buildings)
})
