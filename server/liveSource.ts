import { execFile } from 'node:child_process'
import { open, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import type { Project, Session, WorldSnapshot } from '../src/worldData.js'

const execFileAsync = promisify(execFile)
const DAY = 86_400_000
const MAX_PER_SOURCE = 96
const MAX_PER_BUILDING = 24

type Source = Project['source']
type RawSession = Record<string, unknown>
type Metadata = { title?: string; cwd?: string }
type MetadataMap = Map<string, Metadata>
type LiveRecord = { id: string; title: string; project: string; projectKey: string; lastSeen: number; activity: string }
let metadataCache: { at: number; value: MetadataMap } | null = null

const eventNames: Record<string, string> = {
  user_prompt: 'A new request arrived', assistant_response: 'A response was completed',
  api_request: 'Working on a response', api_error: 'An API request failed',
  tool_result: 'A tool finished', tool_decision: 'A tool decision was made',
  compaction: 'Context was compacted', subagent_completed: 'A helper finished',
  sse_event: 'Response activity observed', websocket_event: 'Response activity observed',
  websocket_request: 'A live connection was opened',
}

function record(value: unknown): RawSession {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RawSession : {}
}

function text(value: unknown, fallback: string, max = 90): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback
}

function timestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function projectName(value: unknown, fallback: string): string {
  const name = text(value, fallback, 180)
  return name.includes('/') || name.includes('\\') ? basename(name.replaceAll('\\', '/')) || fallback : name
}

function codexLocation(value: unknown): { name: string; key: string } {
  const cwd = text(value, '', 1000).replaceAll('\\', '/')
  // Codex gives projectless chats dated local folders such as Documents/Codex/2026-10-09/c.
  // Their final path component is an arbitrary chat folder, not a project name.
  if (!cwd || /(?:^|\/)Documents\/Codex\/\d{4}-\d{2}-\d{2}\/[^/]+(?:\/.*)?$/.test(cwd)) {
    return { name: 'Outpost Hall', key: 'codex:commons' }
  }
  return { name: projectName(cwd, 'Outpost Hall'), key: cwd }
}

function claudeLocation(value: unknown): { name: string; key: string } {
  const project = text(value, '', 1000)
  if (!project || ['unknown', 'unmapped claude work', 'no project'].includes(project.toLowerCase())) {
    return { name: 'Village Hall', key: 'claude:commons' }
  }
  return { name: projectName(project, 'Village Hall'), key: project }
}

function latestActivity(value: unknown): string {
  if (!Array.isArray(value) || !value.length) return 'Activity observed'
  const event = record(value[0])
  return eventNames[text(event.name, '', 50)] || 'Activity observed'
}

function parseSessions(value: unknown): RawSession[] {
  const payload = record(value)
  if (!Array.isArray(payload.sessions)) throw new Error('Telemetry response has no sessions array')
  return payload.sessions.map(record)
}

function portFromEnv(name: string, fallback: number): number {
  const port = Number(process.env[name] || fallback)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${name} must be a valid port`)
  return port
}

async function fetchSessions(port: number, days: number): Promise<RawSession[]> {
  const upstreamDays = days <= 7 ? 7 : 30
  const response = await fetch(`http://127.0.0.1:${port}/api/sessions?days=${upstreamDays}`, { signal: AbortSignal.timeout(5000), cache: 'no-store' })
  if (!response.ok) throw new Error(`Telemetry dashboard returned ${response.status}`)
  return parseSessions(await response.json() as unknown)
}

async function catalogMetadata(): Promise<MetadataMap> {
  const path = process.env.CODEX_CATALOG_DB || join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sqlite', 'codex-dev.db')
  try {
    const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-json', path,
      'SELECT thread_id, display_title, cwd FROM local_thread_catalog'], { timeout: 2000, maxBuffer: 4_000_000 })
    const rows = JSON.parse(stdout) as unknown
    if (!Array.isArray(rows)) return new Map()
    return new Map<string, Metadata>(rows.map((value): [string, Metadata] => {
      const row = record(value)
      return [text(row.thread_id, ''), { title: text(row.display_title, ''), cwd: text(row.cwd, '', 1000) }]
    }).filter(([id]) => id))
  } catch { return new Map() }
}

async function listSessionFiles(root: string): Promise<string[]> {
  const result: string[] = []
  async function visit(path: string): Promise<void> {
    let entries
    try { entries = await readdir(path, { withFileTypes: true }) }
    catch { return }
    for (const entry of entries) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) await visit(child)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) result.push(child)
    }
  }
  await visit(root)
  return result
}

async function firstLine(path: string): Promise<string | null> {
  const file = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(65_536)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    const newline = buffer.subarray(0, bytesRead).indexOf(10)
    return newline < 0 ? null : buffer.toString('utf8', 0, newline)
  } finally { await file.close() }
}

async function codexMetadata(ids: Set<string>): Promise<MetadataMap> {
  if (metadataCache && Date.now() - metadataCache.at < 60_000) return metadataCache.value
  const metadata = await catalogMetadata()
  const home = process.env.CODEX_HOME || join(homedir(), '.codex')
  const files = [...await listSessionFiles(join(home, 'sessions')), ...await listSessionFiles(join(home, 'archived_sessions'))]
  for (const path of files) {
    const fileName = basename(path)
    const id = [...ids].find((candidate) => candidate && fileName.includes(candidate))
    if (!id || metadata.get(id)?.cwd) continue
    try {
      const line = await firstLine(path)
      if (!line) continue
      const payload = record(record(JSON.parse(line)).payload)
      if (payload.id !== id && payload.session_id !== id) continue
      metadata.set(id, { ...metadata.get(id), cwd: text(payload.cwd, '', 1000) })
    } catch { /* Metadata is optional; telemetry remains the source of activity. */ }
  }
  metadataCache = { at: Date.now(), value: metadata }
  return metadata
}

export function mapSessions(source: Source, raw: RawSession[], days: number, now: number, metadata: MetadataMap = new Map()): { projects: Project[]; notices: string[] } {
  const notices: string[] = []
  const cutoff = now - days * DAY
  const filtered = raw.filter((item) => timestamp(item.lastSeen) !== null && (item.lastSeen as number) >= cutoff)
    .sort((a, b) => (b.lastSeen as number) - (a.lastSeen as number))
  if (filtered.length > MAX_PER_SOURCE) notices.push(`Showing the ${MAX_PER_SOURCE} most recent ${source === 'codex' ? 'Codex' : 'Claude'} sessions in this period.`)
  const records: LiveRecord[] = filtered.slice(0, MAX_PER_SOURCE).map((item) => {
    const id = text(item.id, '', 160)
    const meta = metadata.get(id)
    const rawProject = source === 'claude' ? item.project : meta?.cwd
    const location = source === 'claude' ? claudeLocation(rawProject) : codexLocation(rawProject)
    const title = source === 'claude'
      ? text(item.title, `Claude session ${id.slice(0, 8)}`)
      : text(meta?.title, `Codex session ${id.slice(0, 8)}`)
    return { id, title, project: location.name, projectKey: location.key, lastSeen: item.lastSeen as number, activity: latestActivity(item.recentEvents) }
  }).filter((item) => item.id)
  const groups = new Map<string, LiveRecord[]>()
  for (const item of records) groups.set(item.projectKey, [...groups.get(item.projectKey) || [], item])
  const projects: Project[] = []
  for (const [key, entries] of groups) {
    const name = entries[0].project
    const commons = key === 'claude:commons' || key === 'codex:commons'
    const capacity = commons ? MAX_PER_SOURCE : MAX_PER_BUILDING
    for (let start = 0; start < entries.length; start += capacity) {
      const annex = start / capacity
      const sessions: Session[] = entries.slice(start, start + capacity).map((item) => ({
        id: `${source}:${item.id}`, externalId: item.id, name: item.title,
        updatedAt: new Date(item.lastSeen).toISOString(), activity: item.activity,
        status: now - item.lastSeen < 15 * 60_000 ? 'recent' : 'quiet',
      }))
      projects.push({ id: `${source}:${key}:${annex}`, name: annex ? `${name} · Annex ${annex + 1}` : name,
        kind: commons ? 'Commons' : source === 'claude' ? 'Workshop' : 'Outpost', source, sessions })
    }
  }
  if (source === 'codex' && records.some((item) => item.projectKey === 'codex:commons')) {
    notices.push('Codex chats without project metadata are gathered in Outpost Hall.')
  }
  return { projects, notices }
}

export async function getLiveSnapshot(days: number): Promise<WorldSnapshot | null> {
  const [claude, codex] = await Promise.allSettled([
    fetchSessions(portFromEnv('CLAUDE_DASHBOARD_PORT', 41300), days),
    fetchSessions(portFromEnv('CODEX_DASHBOARD_PORT', 18765), days),
  ])
  if (claude.status === 'rejected' && codex.status === 'rejected') return null
  const now = Date.now()
  const metadata = codex.status === 'fulfilled' ? await codexMetadata(new Set(codex.value.map((item) => text(item.id, '')))) : new Map<string, Metadata>()
  const claudeWorld = claude.status === 'fulfilled' ? mapSessions('claude', claude.value, days, now) : { projects: [], notices: ['Claude telemetry is unavailable.'] }
  const codexWorld = codex.status === 'fulfilled' ? mapSessions('codex', codex.value, days, now, metadata) : { projects: [], notices: ['Codex telemetry is unavailable.'] }
  const projects = [...claudeWorld.projects, ...codexWorld.projects]
  const notices = [...claudeWorld.notices, ...codexWorld.notices]
  if (projects.length > 60) notices.push('Showing the first 60 project buildings in this period.')
  return { source: 'telemetry', updatedAt: new Date(now).toISOString(),
    projects: projects.slice(0, 60), notices }
}
