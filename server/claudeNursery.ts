import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { listSessions } from '@anthropic-ai/claude-agent-sdk'
import type { WorldSnapshot } from '../src/worldData.js'

export type NurseryRecord = { id: string; cwd: string; title: string; createdAt: string; updatedAt: string; stage: 'newborn' | 'settled' }
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class ClaudeNursery {
  private readonly file: string
  private records: NurseryRecord[]

  constructor(dataDir = process.env.VILLAGE_DATA_DIR || join(import.meta.dirname, '..', 'data')) {
    this.file = join(resolve(dataDir), 'claude-nursery.json')
    this.records = this.read()
  }

  private read(): NurseryRecord[] {
    if (!existsSync(this.file)) return []
    const value: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
    if (!Array.isArray(value)) throw new Error('Claude nursery data is invalid.')
    return value.filter((entry): entry is NurseryRecord => entry && typeof entry === 'object'
      && ID.test(entry.id) && typeof entry.cwd === 'string' && isAbsolute(entry.cwd)
      && typeof entry.title === 'string' && typeof entry.createdAt === 'string'
      && (entry.stage === 'newborn' || entry.stage === 'settled'))
  }

  private save(): void {
    mkdirSync(resolve(this.file, '..'), { recursive: true })
    const temporary = `${this.file}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(this.records, null, 2), { mode: 0o600 })
    renameSync(temporary, this.file)
  }

  get(id: string): NurseryRecord | undefined { return ID.test(id) ? this.records.find((record) => record.id === id) : undefined }

  async create(cwdInput: unknown, titleInput: unknown): Promise<NurseryRecord> {
    if (typeof cwdInput !== 'string' || !isAbsolute(cwdInput) || cwdInput.length > 2048) throw new Error('Choose an absolute project folder path.')
    let cwd: string
    try {
      cwd = await realpath(cwdInput)
      if (!(await stat(cwd)).isDirectory()) throw new Error('not a directory')
    } catch { throw new Error('That project folder does not exist or cannot be opened.') }
    if (typeof titleInput !== 'string' || !titleInput.trim() || titleInput.trim().length > 100) throw new Error('Give this villager a name up to 100 characters.')
    const now = new Date().toISOString()
    const record: NurseryRecord = { id: randomUUID(), cwd, title: titleInput.trim(), createdAt: now, updatedAt: now, stage: 'newborn' }
    this.records.unshift(record)
    this.save()
    return record
  }

  settle(id: string): void {
    const record = this.get(id)
    if (!record) return
    record.stage = 'settled'
    record.updatedAt = new Date().toISOString()
    this.save()
  }

  async projects(): Promise<{ cwd: string; name: string }[]> {
    let sessions: Awaited<ReturnType<typeof listSessions>> = []
    try { sessions = await listSessions({ limit: 200 }) }
    catch (error) { console.error('Could not list local Claude projects:', error) }
    const paths = [...new Set([...this.records.map((record) => record.cwd), ...sessions.map((session) => session.cwd).filter((cwd): cwd is string => !!cwd), process.cwd()])]
    const valid: string[] = []
    for (const path of paths) {
      try { if (isAbsolute(path) && statSync(path).isDirectory()) valid.push(path) }
      catch { /* A project may have moved since Claude last used it. */ }
    }
    return valid.map((cwd) => ({ cwd, name: basename(cwd) || cwd }))
  }

  merge(snapshot: WorldSnapshot): WorldSnapshot {
    if (snapshot.source !== 'telemetry') return snapshot
    const projects = snapshot.projects.map((project) => ({ ...project, sessions: [...project.sessions] }))
    const hospital = { id: 'claude:village-hospital:0', name: 'Village Hospital', kind: 'Hospital', source: 'claude' as const, sessions: [] as WorldSnapshot['projects'][number]['sessions'] }
    for (const record of this.records) {
      const id = `claude:${record.id}`
      const observed = projects.flatMap((project) => project.sessions).find((session) => session.id === id || session.externalId === record.id)
      for (const project of projects) project.sessions = project.sessions.filter((session) => session.id !== id && session.externalId !== record.id)
      const updatedAt = observed?.updatedAt && Date.parse(observed.updatedAt) > Date.parse(record.updatedAt || record.createdAt)
        ? observed.updatedAt : record.updatedAt || record.createdAt
      const session = { id, externalId: record.id, name: record.title, updatedAt,
        activity: record.stage === 'newborn' ? 'Waiting for a first hello' : 'Chatting from Minecode',
        status: Date.now() - Date.parse(updatedAt) < 15 * 60_000 ? 'recent' as const : 'quiet' as const,
        tokens: observed?.tokens, minecodeCreated: true, newborn: record.stage === 'newborn' }
      if (record.stage === 'newborn') hospital.sessions.push(session)
      else {
        const projectId = `claude:${record.cwd}:0`
        let project = projects.find((item) => item.id === projectId)
        if (!project) {
          project = { id: projectId, name: basename(record.cwd) || record.cwd, kind: 'Workshop', source: 'claude', sessions: [] }
          projects.push(project)
        }
        project.sessions.unshift(session)
      }
    }
    projects.unshift(hospital)
    return { ...snapshot, projects: projects.filter((project) => project.kind === 'Hospital' || project.sessions.length > 0) }
  }
}
