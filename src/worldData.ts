export type Session = {
  id: string
  externalId?: string
  name: string
  updatedAt: string | null
  activity: string
  status: 'recent' | 'quiet' | 'unknown'
}

export type Project = {
  id: string
  name: string
  kind: string
  source: 'claude' | 'codex'
  sessions: Session[]
}

export type WorldSnapshot = {
  source: 'sample' | 'file' | 'telemetry'
  updatedAt: string
  projects: Project[]
  notices?: string[]
}

export function groupCount(projects: Project[]): number {
  return projects.reduce((total, project) => total + project.sessions.length, 0)
}
