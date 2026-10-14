import { useEffect, useRef, useState } from 'react'
import WorldScene, { type PanKey, type WorldControls } from './WorldScene'
import type { Project, Session, WorldSnapshot } from './worldData'
import { groupCount } from './worldData'
import TelemetryPanel from './TelemetryPanel'
import SessionTelemetryPanel from './SessionTelemetryPanel'
import PanelDisplayControls, { type PanelTheme } from './PanelDisplayControls'
import PanelResizeHandle from './PanelResizeHandle'
import type { TelemetrySource } from './telemetryData'
import TimeRangePicker, { useTimeRange } from './TimeRangePicker'
import { worldClock } from './worldClock'
import { HospitalPanel, VillageChatPanel } from './VillageHospital'

function timeAgo(value: string | null): string {
  if (!value) return 'No timestamp supplied'
  const elapsed = Date.now() - Date.parse(value)
  if (!Number.isFinite(elapsed)) return 'Timestamp unavailable'
  if (elapsed < 60_000) return 'Less than a minute ago'
  if (elapsed < 3_600_000) return `${Math.max(1, Math.floor(elapsed / 60_000))} minutes ago`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} hours ago`
  return `${Math.floor(elapsed / 86_400_000)} days ago`
}

const panKeys = new Set<PanKey>(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
const savedTheme = (): PanelTheme => {
  try { const value = localStorage.getItem('minecode.panel.theme'); if (value === 'light' || value === 'dark') return value } catch { /* Storage can be unavailable. */ }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}
const savedWidth = (): number => {
  try { const value = Number(localStorage.getItem('minecode.panel.width')); if (value >= 50 && value <= 80) return value } catch { /* Storage can be unavailable. */ }
  return 75
}

export default function App() {
  const scene = useRef<WorldControls>(null)
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(false)
  const [copied, setCopied] = useState(false)
  const worldRange = useTimeRange(2)
  const [exilingId, setExilingId] = useState<string | null>(null)
  const exilingRef = useRef(false)
  const refreshWorldRef = useRef<(() => Promise<void>) | null>(null)
  const [telemetrySource, setTelemetrySource] = useState<TelemetrySource | null>(null)
  const [panelTheme, setPanelTheme] = useState<PanelTheme>(savedTheme)
  const [panelWidth, setPanelWidth] = useState(savedWidth)
  const [worldTime, setWorldTime] = useState(() => worldClock(Date.now()))
  const [hospitalOpen, setHospitalOpen] = useState(false)
  const [pendingBirth, setPendingBirth] = useState<{ id: string; prompt: string } | null>(null)

  useEffect(() => { const timer = window.setInterval(() => setWorldTime(worldClock(Date.now())), 5_000); return () => window.clearInterval(timer) }, [])

  useEffect(() => { try { localStorage.setItem('minecode.panel.theme', panelTheme) } catch { /* Storage can be unavailable. */ } }, [panelTheme])
  useEffect(() => { try { localStorage.setItem('minecode.panel.width', String(panelWidth)) } catch { /* Storage can be unavailable. */ } }, [panelWidth])

  useEffect(() => {
    let alive = true
    const load = async (force = false) => {
      if (!worldRange.query) return
      try {
        const response = await fetch(`/api/world?${worldRange.query}`, { cache: 'no-store' })
        if (!response.ok) throw new Error(`World data request failed (${response.status})`)
        const next = await response.json() as WorldSnapshot
        if (alive && (force || !exilingRef.current)) { setSnapshot(next); setError(null) }
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : 'World data is unavailable')
      }
    }
    refreshWorldRef.current = () => load(true)
    void load()
    const timer = window.setInterval(() => void load(), 15_000)
    return () => { alive = false; refreshWorldRef.current = null; window.clearInterval(timer) }
  }, [worldRange.query])

  const finishExile = (id: string) => {
    exilingRef.current = true
    setExilingId(id)
    setSelectedId(null)
    window.setTimeout(() => {
      setSnapshot((current) => current ? { ...current, projects: current.projects.map((project) => ({
        ...project, sessions: project.sessions.filter((session) => session.id !== id),
      })).filter((project) => project.sessions.length > 0) } : current)
      void refreshWorldRef.current?.().finally(() => { exilingRef.current = false; setExilingId(null) })
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 350 : 3200)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setSelectedId(null); setShowGuide(false); setTelemetrySource(null); setHospitalOpen(false) }
      if (hospitalOpen || telemetrySource || (selectedId && snapshot?.source === 'telemetry')) return
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.matches('input, textarea, select, [role="textbox"]'))) return
      if (panKeys.has(event.key as PanKey) && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        scene.current?.setPanKey(event.key as PanKey, true)
        setFocusedId(null)
        return
      }
      if (event.key === '0') { scene.current?.fit(); setFocusedId(null) }
      if (event.key.toLowerCase() === 'q') scene.current?.rotate(-1)
      if (event.key.toLowerCase() === 'e') scene.current?.rotate(1)
    }
    const onKeyUp = (event: KeyboardEvent) => { if (panKeys.has(event.key as PanKey)) scene.current?.setPanKey(event.key as PanKey, false) }
    const onBlur = () => scene.current?.clearPanKeys()
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur) }
  }, [hospitalOpen, telemetrySource, selectedId, snapshot?.source])

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

  const sessionFocusOpen = hospitalOpen || !!(selected && snapshot?.source === 'telemetry')
  const displayControls = <PanelDisplayControls theme={panelTheme} onThemeChange={setPanelTheme} />
  const resizeHandle = <PanelResizeHandle width={panelWidth} onWidthChange={setPanelWidth} />
  return <main className={`app-shell ${sessionFocusOpen ? 'session-focus-open' : ''}`} style={{ '--panel-width': `${panelWidth}vw` } as React.CSSProperties}>
    {snapshot && <WorldScene ref={scene} projects={projects} selectedId={selectedId || exilingId} exilingId={exilingId} focusedId={focusedId} lockSessionFocus={sessionFocusOpen || !!exilingId} onSelectSession={(id) => { if (!exilingId) { setHospitalOpen(false); setSelectedId(id) } }} onFocusProject={focusProject} onOpenHospital={() => { setSelectedId(null); setTelemetrySource(null); setShowGuide(false); setHospitalOpen(true) }} onOpenTelemetry={(source) => { setSelectedId(null); setHospitalOpen(false); setShowGuide(false); setTelemetrySource(source) }} />}
    {!snapshot && <div className="loading-world"><div className="loading-mark">✦</div><p>{error || 'Preparing the village…'}</p><button type="button" onClick={() => window.location.reload()}>Retry</button></div>}
    <header className="app-header">
      <img className="brand-mark" src="/minecode-mark.svg" alt="" />
      <div className="brand-copy"><span className="brand-eyebrow">A WORLD FOR WORK IN PROGRESS</span><h1>Minecode</h1></div>
    </header>
    <div className="top-actions">
      {snapshot?.source === 'telemetry' && <button type="button" className="hospital-action" onClick={() => { setSelectedId(null); setTelemetrySource(null); setHospitalOpen(true) }}><span aria-hidden="true">✚</span> New Claude chat</button>}
      <span className="world-weather" title="The village runs on its own clock: a 29 minute day and 43 minute seasons.">{worldTime.season} <span>·</span> {worldTime.daylight > 0.35 ? 'Day' : 'Night'}</span>
      {snapshot && <span className="source-badge" title={snapshot.notices?.join(' ')}><span className="source-dot" />{snapshot.source === 'sample' ? 'Sample village' : snapshot.source === 'telemetry' ? 'Live telemetry' : 'Local file'}{snapshot.notices?.length ? ' ·' : ''}</span>}
      {snapshot?.source === 'telemetry' && <div className="period-control"><TimeRangePicker control={worldRange} compact /></div>}
      <button type="button" className="round-action" aria-label="How to explore" title="How to explore" onClick={() => setShowGuide((value) => !value)}>?</button>
    </div>
    {showGuide && <div className="guide-popover" role="dialog" aria-label="How to explore">
      <div className="popover-heading"><strong>Explore the village</strong><button type="button" aria-label="Close guide" onClick={() => setShowGuide(false)}>×</button></div>
      <p>Drag or use the arrow keys to pan. Shift-drag or right-drag to rotate and tilt. Scroll or pinch to zoom. Cross the river between the Claude village and Codex outpost. Select a telemetry board for each district’s usage dashboard. Select a building name to move closer, then select a character for session details.</p>
      <p className="guide-shortcuts">Keyboard: <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> pan · <kbd>0</kbd> fit all · <kbd>Q</kbd> / <kbd>E</kbd> rotate · <kbd>Esc</kbd> close</p>
    </div>}
    <div className="world-footer-left">
      {focusedProject ? <div className="focus-caption"><span>YOU ARE VISITING</span><strong>{focusedProject.name}</strong><button type="button" onClick={fit}>See all places <span aria-hidden="true">↗</span></button></div> : <div className="map-caption"><span className="map-caption-icon">⌖</span><span>Drag or use arrow keys<br /><small>Shift-drag to rotate · Scroll to zoom</small></span></div>}
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
    {selected && snapshot?.source !== 'telemetry' && <aside className="session-panel" aria-label="Session details">
      <div className="panel-top"><span>{selected.project.source.toUpperCase()} SESSION / {selected.project.kind.toUpperCase()}</span><button type="button" onClick={() => setSelectedId(null)} aria-label="Close session details">×</button></div>
      <div className={`panel-portrait ${selected.project.source === 'codex' ? 'codex' : ''}`} aria-hidden="true"><span className={`portrait-orbit ${selected.session.status}`}><span className="portrait-body" /><span className="portrait-head"><span className="portrait-eyes" /><span className="portrait-nose" /></span></span></div>
      <p className="panel-kicker">AT {selected.project.name.toUpperCase()}</p>
      <h2>{selected.session.name}</h2>
      <div className="panel-activity"><span className={`activity-dot ${selected.session.status}`} /><div><small>LATEST ACTIVITY</small><strong>{selected.session.activity}</strong></div></div>
      <dl className="panel-details"><div><dt>Last observed</dt><dd>{snapshot?.source === 'sample' ? 'Sample activity' : timeAgo(selected.session.updatedAt)}</dd></div><div><dt>Agent</dt><dd>{selected.project.source === 'codex' ? 'Codex' : 'Claude Code'}</dd></div><div><dt>Data</dt><dd>{snapshot?.source === 'sample' ? 'Illustrative session' : 'Local session snapshot'}</dd></div></dl>
      {snapshot?.source !== 'sample' && <button type="button" className="copy-button" onClick={() => void copyId()}>{copied ? 'Copied session ID' : 'Copy session ID'} <span aria-hidden="true">↗</span></button>}
      <p className="panel-note">Activity is the latest supplied signal. It does not confirm that a session is currently running.</p>
    </aside>}
    {selected && snapshot?.source === 'telemetry' && (selected.session.minecodeCreated
      ? <VillageChatPanel key={selected.session.id} session={selected.session} project={selected.project} theme={panelTheme} displayControls={displayControls} resizeHandle={resizeHandle} initialPrompt={pendingBirth && pendingBirth.id === selected.session.externalId ? pendingBirth.prompt : undefined} onPromptStarted={() => setPendingBirth(null)} onCompleted={() => void refreshWorldRef.current?.()} onClose={() => setSelectedId(null)} />
      : <SessionTelemetryPanel key={`${selected.project.source}:${selected.session.id}`} session={selected.session} project={selected.project} initialPeriod={worldRange.range || 2} theme={panelTheme} displayControls={displayControls} resizeHandle={resizeHandle} onExiled={() => finishExile(selected!.session.id)} onClose={() => setSelectedId(null)} />)}
    {hospitalOpen && <HospitalPanel theme={panelTheme} displayControls={displayControls} resizeHandle={resizeHandle} onClose={() => setHospitalOpen(false)} onCreated={(id, prompt) => { setPendingBirth({ id, prompt }); setHospitalOpen(false); setSelectedId(`claude:${id}`); void refreshWorldRef.current?.() }} />}
    {telemetrySource && <TelemetryPanel key={telemetrySource} source={telemetrySource} initialPeriod={worldRange.range || 2} theme={panelTheme} displayControls={displayControls} resizeHandle={resizeHandle} onClose={() => setTelemetrySource(null)} />}
    {!worldRange.query && snapshot?.source === 'telemetry' && <div className="data-warning" role="status">Choose a valid date range. The village still shows the previous period.</div>}
    {error && snapshot && <div className="data-warning" role="status">Showing the last village snapshot. {error}</div>}
  </main>
}
