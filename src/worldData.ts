export type Session = {
  id: string
  name: string
  updatedAt: string | null
  activity: string
  status: 'recent' | 'quiet' | 'unknown'
}

export type Project = {
  id: string
  name: string
  kind: string
  sessions: Session[]
}

export type WorldSnapshot = {
  source: 'sample' | 'file'
  updatedAt: string
  projects: Project[]
}

export function groupCount(projects: Project[]): number {
  return projects.reduce((total, project) => total + project.sessions.length, 0)
}
