import { readFile } from 'node:fs/promises'
import type { Project, Session, WorldSnapshot } from '../src/worldData.js'
import { getLiveSnapshot } from './liveSource.js'
import type { TelemetryStores } from './telemetryStore.js'
import type { TelemetryPeriod } from '../src/telemetryData.js'

const examples: Project[] = [
  { id: 'village-hall', name: 'Village Hall', kind: 'Commons', source: 'claude', sessions: [
    { id: 'sample-village-hall-1', name: 'Explore an idea', updatedAt: null, activity: 'Thinking together', status: 'quiet', tokens: 520_000 },
    { id: 'sample-village-hall-2', name: 'Sketch a direction', updatedAt: null, activity: 'Reviewing options', status: 'recent', tokens: 12_000 },
  ] },
  { id: 'hearth', name: 'Hearth & Home', kind: 'Workshop', source: 'claude', sessions: [
    { id: 'sample-hearth-1', name: 'Shape the first welcome', updatedAt: null, activity: 'Sketching the arrival flow', status: 'recent', tokens: 88_000 },
    { id: 'sample-hearth-2', name: 'Refine the warm palette', updatedAt: null, activity: 'Choosing materials', status: 'quiet' },
    { id: 'sample-hearth-3', name: 'Plan the courtyard', updatedAt: null, activity: 'Reviewing the plan', status: 'quiet' },
  ] },
  { id: 'fieldnotes', name: 'Fieldnotes', kind: 'Library', source: 'claude', sessions: [
    { id: 'sample-field-1', name: 'Map the knowledge base', updatedAt: null, activity: 'Reading notes', status: 'recent', tokens: 1_200_000 },
    { id: 'sample-field-2', name: 'Organize research trails', updatedAt: null, activity: 'Sorting references', status: 'quiet' },
  ] },
  { id: 'lantern', name: 'Signal Keep', kind: 'Outpost', source: 'codex', sessions: [
    { id: 'sample-lantern-1', name: 'Prototype the signal', updatedAt: null, activity: 'Building a prototype', status: 'recent', tokens: 310_000 },
    { id: 'sample-lantern-2', name: 'Test the watch', updatedAt: null, activity: 'Trying interactions', status: 'quiet' },
  ] },
  { id: 'outpost-hall', name: 'Outpost Hall', kind: 'Commons', source: 'codex', sessions: [
    { id: 'sample-outpost-hall-1', name: 'Try a new approach', updatedAt: null, activity: 'Running an experiment', status: 'recent' },
    { id: 'sample-outpost-hall-2', name: 'Inspect a small fix', updatedAt: null, activity: 'Looking through code', status: 'quiet' },
    { id: 'sample-outpost-hall-3', name: 'Draft a quick answer', updatedAt: null, activity: 'Writing a response', status: 'quiet' },
  ] },
  { id: 'greenhouse', name: 'The Foundry', kind: 'Forge', source: 'codex', sessions: [
    { id: 'sample-green-1', name: 'Forge the roadmap', updatedAt: null, activity: 'Planning next steps', status: 'quiet' },
    { id: 'sample-green-2', name: 'Tend the build', updatedAt: null, activity: 'Refining the build', status: 'quiet' },
  ] },
]

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`)
  return value.trim().slice(0, 160)
}

export function parseWorldFile(value: unknown): Project[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { projects?: unknown }).projects)) {
    throw new Error('World data must have a projects array')
  }
  const projects = (value as { projects: unknown[] }).projects
  if (projects.length > 60) throw new Error('World data supports up to 60 projects')
  const projectIds = new Set<string>()
  const sessionIds = new Set<string>()
  return projects.map((entry, projectIndex): Project => {
    if (!entry || typeof entry !== 'object') throw new Error(`projects[${projectIndex}] must be an object`)
    const raw = entry as Record<string, unknown>
    const id = nonEmpty(raw.id, `projects[${projectIndex}].id`)
    if (projectIds.has(id)) throw new Error(`Duplicate project id: ${id}`)
    projectIds.add(id)
    if (!Array.isArray(raw.sessions) || raw.sessions.length > 24) throw new Error(`${id}.sessions must contain up to 24 sessions`)
    const sessions = raw.sessions.map((item, sessionIndex): Session => {
      if (!item || typeof item !== 'object') throw new Error(`${id}.sessions[${sessionIndex}] must be an object`)
      const session = item as Record<string, unknown>
      const sessionId = nonEmpty(session.id, `${id}.sessions[${sessionIndex}].id`)
      if (sessionIds.has(sessionId)) throw new Error(`Duplicate session id: ${sessionId}`)
      sessionIds.add(sessionId)
      const date = session.updatedAt === null || session.updatedAt === undefined ? null : nonEmpty(session.updatedAt, `${sessionId}.updatedAt`)
      if (date !== null && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(date) || Number.isNaN(Date.parse(date)))) throw new Error(`${sessionId}.updatedAt must be an ISO timestamp`)
      const status = session.status
      if (status !== 'recent' && status !== 'quiet' && status !== 'unknown') throw new Error(`${sessionId}.status must be recent, quiet, or unknown`)
      const tokens = session.tokens
      if (tokens !== undefined && (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens < 0)) throw new Error(`${sessionId}.tokens must be a non-negative number`)
      return { id: sessionId, name: nonEmpty(session.name, `${sessionId}.name`), updatedAt: date, activity: nonEmpty(session.activity, `${sessionId}.activity`), status, ...(tokens === undefined ? {} : { tokens }) }
    })
    const source = raw.source === undefined ? 'claude' : raw.source
    if (source !== 'claude' && source !== 'codex') throw new Error(`${id}.source must be claude or codex`)
    return { id, name: nonEmpty(raw.name, `${id}.name`), kind: nonEmpty(raw.kind, `${id}.kind`), source, sessions }
  })
}

export async function getWorldSnapshot(filePath?: string, period: TelemetryPeriod = 2, mode = 'auto', stores?: TelemetryStores): Promise<WorldSnapshot> {
  if (filePath) {
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as unknown
    return { source: 'file', updatedAt: new Date().toISOString(), projects: parseWorldFile(raw) }
  }
  if (mode !== 'sample' && stores) return getLiveSnapshot(period, stores)
  if (mode === 'telemetry') throw new Error('Telemetry storage is unavailable')
  return { source: 'sample', updatedAt: new Date().toISOString(), projects: examples,
    notices: mode === 'sample' ? [] : ['Telemetry storage is unavailable; showing sample sessions.'] }
}
