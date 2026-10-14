import { useEffect, useState } from 'react'
import ClaudeChat from './ClaudeChat'
import type { PanelTheme } from './PanelDisplayControls'
import type { Project, Session } from './worldData'

type ProjectChoice = { cwd: string; name: string }
type SharedPanel = { theme: PanelTheme; displayControls: React.ReactNode; resizeHandle: React.ReactNode; onClose: () => void }

export function HospitalPanel({ theme, displayControls, resizeHandle, onClose, onCreated }: SharedPanel & { onCreated: (id: string, prompt: string) => void }) {
  const [projects, setProjects] = useState<ProjectChoice[]>([])
  const [chosen, setChosen] = useState('')
  const [otherPath, setOtherPath] = useState('')
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/claude/projects', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => { if (!response.ok) throw new Error('Could not load local Claude projects.'); return await response.json() as { projects: ProjectChoice[] } })
      .then((value) => { setProjects(value.projects); setChosen(value.projects[0]?.cwd || '__other__') })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load projects.') })
    return () => controller.abort()
  }, [])

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (working) return
    setWorking(true); setError(null)
    try {
      const response = await fetch('/api/claude/chats', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: chosen === '__other__' ? otherPath.trim() : chosen, title: title.trim() }) })
      const payload = await response.json() as { session?: { id: string }; error?: string }
      if (!response.ok || !payload.session) throw new Error(payload.error || 'Could not welcome this villager.')
      onCreated(payload.session.id, prompt.trim())
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create this chat.'); setWorking(false) }
  }

  return <><div className="telemetry-scrim" onClick={onClose} aria-hidden="true" />
    <aside className={`telemetry-panel claude hospital-panel ${theme}`} role="dialog" aria-modal="true" aria-label="Village Hospital">
      {resizeHandle}
      <div className="telemetry-panel-head"><div><p className="telemetry-eyebrow">CLAUDE VILLAGE / HOSPITAL</p><h2>Welcome a new villager</h2><p>Every new Claude chat begins here, then finds a home in its project.</p></div><button type="button" className="telemetry-close" onClick={onClose} aria-label="Close hospital">×</button></div>
      {displayControls}
      <div className="hospital-story" aria-hidden="true"><span className="hospital-cross">✚</span><div><strong>A place for new beginnings</strong><small>Choose a project and write the first hello. A child villager will appear here before heading to work.</small></div></div>
      <form className="hospital-form" onSubmit={(event) => void create(event)}>
        <label htmlFor="hospital-project">Project home</label>
        <select id="hospital-project" value={chosen} onChange={(event) => setChosen(event.target.value)} required>
          {projects.map((project) => <option value={project.cwd} key={project.cwd}>{project.name} — {project.cwd}</option>)}
          <option value="__other__">Another folder…</option>
        </select>
        {chosen === '__other__' && <input type="text" value={otherPath} onChange={(event) => setOtherPath(event.target.value)} placeholder="/absolute/path/to/project" aria-label="Project folder path" required />}
        <p className="session-note">Claude will work in this local folder. You can choose a recent Claude project or enter another existing folder.</p>
        <label htmlFor="hospital-title">Villager name</label>
        <input id="hospital-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder="What are we working on?" required />
        <label htmlFor="hospital-message">First message</label>
        <textarea id="hospital-message" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={8000} placeholder="Say hello and describe the task…" required />
        <p className="session-note">Creating a villager saves it locally. Sending the first message uses your signed-in Claude Code plan and its normal usage limits.</p>
        {error && <p className="claude-chat-error" role="alert">{error}</p>}
        <button type="submit" disabled={working || !chosen || !title.trim() || !prompt.trim()}>{working ? 'Welcoming…' : 'Welcome villager →'}</button>
      </form>
    </aside>
  </>
}

export function VillageChatPanel({ session, project, theme, displayControls, resizeHandle, onClose, initialPrompt, onPromptStarted, onCompleted }: SharedPanel & {
  session: Session; project: Project; initialPrompt?: string; onPromptStarted: () => void; onCompleted: () => void
}) {
  return <><div className="telemetry-scrim" onClick={onClose} aria-hidden="true" />
    <aside className={`telemetry-panel claude hospital-panel ${theme}`} role="dialog" aria-modal="true" aria-label={`${session.name} chat`}>
      {resizeHandle}
      <div className="telemetry-panel-head"><div><p className="telemetry-eyebrow">CLAUDE VILLAGE / {session.newborn ? 'HOSPITAL NURSERY' : project.name.toUpperCase()}</p><h2>{session.name}</h2><p>{session.newborn ? 'This child is preparing for a first conversation.' : `Now at home in ${project.name}.`}</p></div><button type="button" className="telemetry-close" onClick={onClose} aria-label="Close chat">×</button></div>
      {displayControls}
      <ClaudeChat sessionId={session.externalId || session.id} initialPrompt={initialPrompt} loadHistory onStarted={onPromptStarted} onCompleted={onCompleted} />
    </aside>
  </>
}
