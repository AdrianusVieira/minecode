import { useEffect, useRef, useState } from 'react'
import WorldScene, { type WorldControls } from './WorldScene'
import type { Project, Session, WorldSnapshot } from './worldData'
import { groupCount } from './worldData'

function timeAgo(value: string | null): string {
  if (!value) return 'No timestamp supplied'
  const elapsed = Date.now() - Date.parse(value)
  if (!Number.isFinite(elapsed)) return 'Timestamp unavailable'
  if (elapsed < 60_000) return 'Less than a minute ago'
  if (elapsed < 3_600_000) return `${Math.max(1, Math.floor(elapsed / 60_000))} minutes ago`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} hours ago`
  return `${Math.floor(elapsed / 86_400_000)} days ago`
}

export default function App() {
  const scene = useRef<WorldControls>(null)
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(false)
  const [copied, setCopied] = useState(false)
  const [days, setDays] = useState(2)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const response = await fetch(`/api/world?days=${days}`, { cache: 'no-store' })
        if (!response.ok) throw new Error(`World data request failed (${response.status})`)
        const next = await response.json() as WorldSnapshot
        if (alive) { setSnapshot(next); setError(null) }
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : 'World data is unavailable')
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 15_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [days])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setSelectedId(null); setShowGuide(false) }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (event.key === '0') { scene.current?.fit(); setFocusedId(null) }
      if (event.key === '+' || event.key === '=') scene.current?.zoom(1)
      if (event.key === '-') scene.current?.zoom(-1)
      if (event.key.toLowerCase() === 'q') scene.current?.rotate(-1)
      if (event.key.toLowerCase() === 'e') scene.current?.rotate(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const projects = snapshot?.projects || []
  const focusedProject = projects.find((project) => project.id === focusedId)
  let selected: { session: Session; project: Project } | null = null
  for (const project of projects) {
    const session = project.sessions.find((item) => item.id === selectedId)
    if (session) { selected = { session, project }; break }
  }
  const focusProject = (id: string) => { setFocusedId(id); scene.current?.focusProject(id) }
  const fit = () => { setFocusedId(null); scene.current?.fit() }
  const copyId = async () => {
    if (!selected) return
    await navigator.clipboard.writeText(selected.session.externalId || selected.session.id)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return <main className="app-shell">
    {snapshot && <WorldScene ref={scene} projects={projects} selectedId={selectedId} focusedId={focusedId} onSelectSession={setSelectedId} onFocusProject={focusProject} />}
    {!snapshot && <div className="loading-world"><div className="loading-mark">✦</div><p>{error || 'Preparing the village…'}</p><button type="button" onClick={() => window.location.reload()}>Retry</button></div>}
    <header className="app-header">
      <div className="brand-mark" aria-hidden="true"><span className="brand-roof" /><span className="brand-home" /><span className="brand-door" /></div>
      <div className="brand-copy"><span className="brand-eyebrow">A WORLD FOR WORK IN PROGRESS</span><h1>Minecode</h1></div>
    </header>
    <div className="top-actions">
      {snapshot && <span className="source-badge" title={snapshot.notices?.join(' ')}><span className="source-dot" />{snapshot.source === 'sample' ? 'Sample village' : snapshot.source === 'telemetry' ? 'Live telemetry' : 'Local file'}{snapshot.notices?.length ? ' ·' : ''}</span>}
      {snapshot?.source === 'telemetry' && <label className="period-control"><span>Show</span><select aria-label="Session time range" value={days} onChange={(event) => { setDays(Number(event.target.value)); setSelectedId(null); setFocusedId(null) }}><option value={1}>24h</option><option value={2}>48h</option><option value={7}>7d</option><option value={30}>30d</option></select></label>}
      <button type="button" className="round-action" aria-label="How to explore" title="How to explore" onClick={() => setShowGuide((value) => !value)}>?</button>
    </div>
    {showGuide && <div className="guide-popover" role="dialog" aria-label="How to explore">
      <div className="popover-heading"><strong>Explore the village</strong><button type="button" aria-label="Close guide" onClick={() => setShowGuide(false)}>×</button></div>
      <p>Drag to pan. Shift-drag or right-drag to rotate and tilt. Scroll or pinch to zoom. Cross the river between the Claude village and Codex outpost. Each bank has a hall for sessions without a project. Select a building name to move closer, then select a character for session details.</p>
      <p className="guide-shortcuts">Keyboard: <kbd>0</kbd> fit all · <kbd>+</kbd> / <kbd>−</kbd> zoom · <kbd>Q</kbd> / <kbd>E</kbd> rotate · <kbd>Esc</kbd> close</p>
    </div>}
    <div className="world-intro"><span className="intro-line" />Two banks. One world. Every session has a place.</div>
    <div className="world-footer-left">
      {focusedProject ? <div className="focus-caption"><span>YOU ARE VISITING</span><strong>{focusedProject.name}</strong><button type="button" onClick={fit}>See all places <span aria-hidden="true">↗</span></button></div> : <div className="map-caption"><span className="map-caption-icon">⌖</span><span>Drag to wander<br /><small>Shift-drag to rotate · Scroll to zoom</small></span></div>}
    </div>
    <div className="world-footer-center" aria-live="polite">{projects.length} {projects.length === 1 ? 'place' : 'places'} <span>·</span> {groupCount(projects)} {groupCount(projects) === 1 ? 'session' : 'sessions'}</div>
    <div className="map-controls" aria-label="Map controls">
      <button type="button" onClick={() => scene.current?.zoom(1)} aria-label="Zoom in" title="Zoom in">+</button>
      <button type="button" onClick={() => scene.current?.zoom(-1)} aria-label="Zoom out" title="Zoom out">−</button>
      <span className="control-divider" />
      <button type="button" className="rotate-button" onClick={() => scene.current?.rotate(-1)} aria-label="Rotate left" title="Rotate left (Q)">⟲</button>
      <button type="button" className="rotate-button" onClick={() => scene.current?.rotate(1)} aria-label="Rotate right" title="Rotate right (E)">⟳</button>
      <span className="control-divider" />
      <button type="button" className="fit-button" onClick={fit} title="Fit all places">Fit all</button>
    </div>
    {selected && <aside className="session-panel" aria-label="Session details">
      <div className="panel-top"><span>{selected.project.source.toUpperCase()} SESSION / {selected.project.kind.toUpperCase()}</span><button type="button" onClick={() => setSelectedId(null)} aria-label="Close session details">×</button></div>
      <div className={`panel-portrait ${selected.project.source === 'codex' ? 'codex' : ''}`} aria-hidden="true"><span className={`portrait-orbit ${selected.session.status}`}><span className="portrait-body" /><span className="portrait-head"><span className="portrait-eyes" /><span className="portrait-nose" /></span></span></div>
      <p className="panel-kicker">AT {selected.project.name.toUpperCase()}</p>
      <h2>{selected.session.name}</h2>
      <div className="panel-activity"><span className={`activity-dot ${selected.session.status}`} /><div><small>LATEST ACTIVITY</small><strong>{selected.session.activity}</strong></div></div>
      <dl className="panel-details"><div><dt>Last observed</dt><dd>{snapshot?.source === 'sample' ? 'Sample activity' : timeAgo(selected.session.updatedAt)}</dd></div><div><dt>Agent</dt><dd>{selected.project.source === 'codex' ? 'Codex' : 'Claude Code'}</dd></div><div><dt>Data</dt><dd>{snapshot?.source === 'sample' ? 'Illustrative session' : snapshot?.source === 'telemetry' ? 'Local telemetry' : 'Local session snapshot'}</dd></div></dl>
      {snapshot?.source !== 'sample' && <button type="button" className="copy-button" onClick={() => void copyId()}>{copied ? 'Copied session ID' : 'Copy session ID'} <span aria-hidden="true">↗</span></button>}
      <p className="panel-note">Activity is the latest supplied signal. It does not confirm that a session is currently running.</p>
    </aside>}
    {error && snapshot && <div className="data-warning" role="status">Showing the last village snapshot. {error}</div>}
  </main>
}
