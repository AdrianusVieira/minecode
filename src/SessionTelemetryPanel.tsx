import { useEffect, useRef, useState } from 'react'
import { Chart, Metric, currency, duration, number } from './TelemetryPanel'
import type { ClaudeSession, CodexSession, SessionActivity, SessionView, TelemetryPeriod, TelemetrySource } from './telemetryData'
import type { Project, Session } from './worldData'
import type { PanelTheme } from './PanelDisplayControls'
import TimeRangePicker, { useTimeRange } from './TimeRangePicker'
import ClaudeChat from './ClaudeChat'

const dateTime = (value: number | null) => value === null ? 'Unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
const eventNames: Record<string, string> = {
  user_prompt: 'Prompt sent', assistant_response: 'Response completed', api_request: 'API request', api_error: 'API error',
  api_retries_exhausted: 'Retries exhausted', tool_result: 'Tool finished', tool_decision: 'Tool decision',
  compaction: 'Context compacted', subagent_completed: 'Helper completed', conversation_starts: 'Conversation started',
  sse_event: 'Response activity', websocket_event: 'Response activity', websocket_request: 'Connection opened',
}

function cumulative(points: { timestamp: number; tokens: number }[]) {
  const stride = Math.max(1, Math.ceil(points.length / 160))
  let total = 0
  const result: { timestamp: number; total: number }[] = []
  points.forEach((point, index) => {
    total += point.tokens
    if ((index + 1) % stride === 0 || index === points.length - 1) result.push({ timestamp: point.timestamp, total })
  })
  return result
}

function sessionTimeline(view: SessionView) {
  if (view.source === 'claude') return cumulative((view.session as ClaudeSession).tokenTimeline.map((point) => ({
    timestamp: point.timestamp, tokens: point.input + point.output + point.cacheRead + point.cacheWrite,
  })))
  return cumulative((view.session as CodexSession).tokenTimeline.map((point) => ({ timestamp: point.timestamp, tokens: point.total })))
}

function Activity({ events }: { events: SessionActivity[] }) {
  return <ol className="session-activity-list">{events.map((event, index) => <li key={`${event.timestamp}-${index}`}>
    <span className="activity-marker" aria-hidden="true" /><div><strong>{eventNames[event.name] || event.name.replaceAll('_', ' ')}</strong><small>{dateTime(event.timestamp)}{(event.toolName || event.tool) ? ` · ${event.toolName || event.tool}` : ''}{event.durationMs !== null ? ` · ${Math.round(event.durationMs)} ms` : ''}</small></div>
  </li>)}</ol>
}

export default function SessionTelemetryPanel({ session, project, initialPeriod, theme, displayControls, resizeHandle, onExiled, onClose }: { session: Session; project: Project; initialPeriod: TelemetryPeriod; theme: PanelTheme; displayControls: React.ReactNode; resizeHandle: React.ReactNode; onExiled: () => void; onClose: () => void }) {
  const source: TelemetrySource = project.source
  const id = session.externalId || session.id
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const loadedCountRef = useRef(50)
  const period = useTimeRange(initialPeriod)
  const [data, setData] = useState<SessionView | null>(null)
  const [activity, setActivity] = useState<SessionActivity[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [confirmExile, setConfirmExile] = useState(false)
  const [exiling, setExiling] = useState(false)
  const [exileError, setExileError] = useState<string | null>(null)

  useEffect(() => {
    closeRef.current?.focus()
    return () => { document.querySelector<HTMLElement>(`[data-world-label="session"][data-world-id="${CSS.escape(session.id)}"]`)?.focus() }
  }, [session.id])

  useEffect(() => {
    const controller = new AbortController()
    if (!period.query) { setData(null); setActivity([]); setError(null); return () => controller.abort() }
    const load = async () => {
      try {
        const response = await fetch(`/api/telemetry/${source}/sessions/${encodeURIComponent(id)}?${period.query}`, { signal: controller.signal, cache: 'no-store' })
        const next = await response.json() as SessionView | { error: string }
        if (!response.ok) throw new Error('error' in next ? next.error : `Session request failed (${response.status})`)
        const view = next as SessionView
        const offsets = Array.from({ length: Math.max(0, Math.ceil((Math.min(loadedCountRef.current, view.activityTotal) - 50) / 50)) }, (_, index) => 50 + index * 50)
        const extra = await Promise.all(offsets.map(async (offset) => {
          const page = await fetch(`/api/telemetry/${source}/sessions/${encodeURIComponent(id)}/events?${period.query}&offset=${offset}`, { signal: controller.signal, cache: 'no-store' })
          if (!page.ok) throw new Error(`Activity request failed (${page.status})`)
          return (await page.json() as { events: SessionActivity[] }).events
        }))
        if (!controller.signal.aborted) { setData(view); setActivity([...view.activity, ...extra.flat()]); setError(null) }
      } catch (cause) {
        if (!controller.signal.aborted) { setData(null); setActivity([]); setError(cause instanceof Error ? cause.message : 'Session data is unavailable') }
      }
    }
    loadedCountRef.current = 50
    setData(null); setActivity([]); setError(null)
    void load()
    const timer = window.setInterval(() => void load(), 15_000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [source, id, period.query])

  const loadMore = async () => {
    if (loadingMore || !data || !period.query) return
    setLoadingMore(true)
    try {
      const response = await fetch(`/api/telemetry/${source}/sessions/${encodeURIComponent(id)}/events?${period.query}&offset=${activity.length}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`Activity request failed (${response.status})`)
      const next = await response.json() as { events: SessionActivity[] }
      setActivity((current) => {
        const combined = [...current, ...next.events]
        loadedCountRef.current = combined.length
        return combined
      })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Activity is unavailable') }
    finally { setLoadingMore(false) }
  }

  const exile = async () => {
    if (exiling) return
    setExiling(true); setExileError(null)
    try {
      const response = await fetch(`/api/telemetry/${source}/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', cache: 'no-store' })
      if (!response.ok) {
        const payload = await response.json() as { error?: string }
        throw new Error(payload.error || `Exile failed (${response.status})`)
      }
      onExiled()
    } catch (cause) { setExileError(cause instanceof Error ? cause.message : 'Exile failed'); setExiling(false) }
  }

  const containFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const controls = [...(panelRef.current?.querySelectorAll<HTMLElement>('button, select, input, summary, [role="separator"]') || [])].filter((item) => item.getClientRects().length > 0)
    if (!controls.length) return
    const first = controls[0], last = controls.at(-1)!
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  const name = source === 'claude' ? 'Claude Code' : 'Codex'
  const detail = data?.session
  const claude = detail && source === 'claude' ? detail as ClaudeSession : null
  const codex = detail && source === 'codex' ? detail as CodexSession : null
  const tokenTotal = claude ? claude.inputTokens + claude.outputTokens + claude.cacheReadTokens + claude.cacheCreationTokens : codex?.observedTokens ?? null
  const activeSeconds = claude && (claude.activeUserSeconds !== null || claude.activeCliSeconds !== null)
    ? (claude.activeUserSeconds || 0) + (claude.activeCliSeconds || 0) : null

  return <><div className="telemetry-scrim" onClick={onClose} aria-hidden="true" />
    <aside ref={panelRef} className={`telemetry-panel session-telemetry-panel ${source} ${theme}`} role="dialog" aria-modal="true" aria-label={`${name} session details`} onKeyDown={containFocus}>
      {resizeHandle}
      <div className="telemetry-panel-head"><div><p className="telemetry-eyebrow">{name.toUpperCase()} / SESSION AT {project.name.toUpperCase()}</p><h2>{session.name}</h2><p>Observed activity and usage for this {source === 'claude' ? 'chat' : 'conversation'}.</p></div><button ref={closeRef} type="button" className="telemetry-close" onClick={onClose} aria-label="Close session details">×</button></div>
      {displayControls}
      {source === 'claude' && <ClaudeChat sessionId={id} />}
      <div className="telemetry-toolbar"><TimeRangePicker control={period} />{data && <span>Last observed {dateTime(detail?.lastSeen ?? null)}</span>}</div>
      <div className="session-exile"><button type="button" className="exile-open" onClick={() => setConfirmExile(true)} disabled={exiling}>Exile this session <span aria-hidden="true">↗</span></button>
        {confirmExile && <div className="exile-confirm" role="group" aria-label="Confirm exile"><strong>Send this character beyond the village?</strong><p>This permanently deletes its telemetry and saved title from Minecode. New events for this ID will be ignored. The original {name} conversation remains in its own app.</p><div><button type="button" onClick={() => setConfirmExile(false)} disabled={exiling}>Keep here</button><button type="button" className="exile-confirm-button" onClick={() => void exile()} disabled={exiling}>{exiling ? 'Preparing departure…' : 'Exile and delete data'}</button></div></div>}
        {exileError && <p className="session-note" role="alert">{exileError}</p>}
      </div>
      {!period.query ? <div className="telemetry-message">Choose a valid start and end date.</div> : error && !data ? <div className="telemetry-message" role="status"><h3>Session unavailable</h3><p>{error}</p></div> : !data ? <div className="telemetry-message" role="status">Loading session…</div> : <div className="session-telemetry-content">
        <div className="telemetry-metrics">
          <Metric label={source === 'claude' ? 'Tokens' : 'Observed tokens'} value={number(tokenTotal)} hint={source === 'codex' ? `${codex?.tokenTimeline.length || 0} of ${codex?.completedResponses || 0} completions with counts` : 'Input, output, and cache'} />
          <Metric label="Prompts" value={number(detail!.prompts)} />
          <Metric label="API requests" value={number(detail!.apiRequests)} />
          <Metric label="API errors" value={number(detail!.errors)} />
          {claude ? <><Metric label="Estimated cost" value={currency(claude.estimatedCostUsd)} hint="Claude Code estimate" /><Metric label="Active time" value={duration(activeSeconds)} hint="User + Claude processing" /></> : <><Metric label="Tool results" value={number(codex!.toolCalls)} /><Metric label="Completed responses" value={number(codex!.completedResponses)} /></>}
        </div>
        <div className="session-info-row"><span>First observed <strong>{dateTime(detail!.firstSeen)}</strong></span><span>Models <strong>{detail!.models.join(', ') || 'Unavailable'}</strong></span>{claude && <span>Accounts <strong>{claude.emails.join(', ') || 'Unattributed'}</strong></span>}</div>
        <section className="telemetry-timeline"><div className="telemetry-section-head"><div><span>USAGE OVER TIME</span><h3>Token timeline</h3></div><small>{source === 'claude' ? 'Each point is an API request' : 'Each point is a completed response with counts'}</small></div><Chart points={sessionTimeline(data)} source={source} /></section>
        <section className="session-detail-section"><div className="telemetry-section-head"><div><span>USAGE</span><h3>Token breakdown</h3></div></div><div className="session-breakdown">
          {claude ? <><span>Input <strong>{number(claude.inputTokens)}</strong></span><span>Output <strong>{number(claude.outputTokens)}</strong></span><span>Cache read <strong>{number(claude.cacheReadTokens)}</strong></span><span>Cache write <strong>{number(claude.cacheCreationTokens)}</strong></span></> : <><span>Input <strong>{number(codex!.inputTokens)}</strong></span><span>Output <strong>{number(codex!.outputTokens)}</strong></span><span>Cached input <strong>{number(codex!.cachedInputTokens)}</strong></span><span>Cache write <strong>{number(codex!.cacheWriteTokens)}</strong></span><span>Reasoning output <strong>{number(codex!.reasoningOutputTokens)}</strong></span></>}
          <span>Median API request <strong>{detail!.medianRequestMs === null ? 'Unavailable' : `${number(detail!.medianRequestMs)} ms`}</strong></span>
        </div>{codex && <p className="session-note">Cached input is included in input, and reasoning output is included in output. Cache write is shown separately.</p>}</section>
        {codex && codex.toolStats.length > 0 && <section className="session-detail-section"><div className="telemetry-section-head"><div><span>TOOLS</span><h3>Tool results</h3></div></div><div className="session-tools">{codex.toolStats.map((tool) => <div key={tool.tool}><strong>{tool.tool}</strong><span>{number(tool.count)} calls · {number(tool.failures)} failures</span></div>)}</div></section>}
        <div className="session-detail-columns"><section className="session-detail-section"><div className="telemetry-section-head"><div><span>INPUT</span><h3>Prompts</h3></div><small>{number(data.promptTotal)} prompts</small></div><div className="session-prompts">{data.prompts.length ? data.prompts.map((prompt) => <details key={prompt.id}><summary><time>{dateTime(prompt.timestamp)}</time><span>{prompt.text?.split('\n')[0].slice(0, 120) || 'Prompt text unavailable'}</span></summary><div className="session-prompt-body"><pre>{prompt.text || 'Prompt text was not included in telemetry.'}</pre>{source === 'claude' && <small>{number(prompt.requests || 0)} requests · {number(prompt.tokens || 0)} tokens · {currency(prompt.costUsd ?? null)}</small>}</div></details>) : <p className="telemetry-empty">No prompts observed in this period.</p>}{data.promptTotal > data.prompts.length && <p className="session-note">Showing the 100 most recent prompts.</p>}</div></section>
          <section className="session-detail-section"><div className="telemetry-section-head"><div><span>TIMELINE</span><h3>Recent activity</h3></div><small>{number(data.activityTotal)} events</small></div>{activity.length ? <Activity events={activity} /> : <p className="telemetry-empty">No activity observed in this period.</p>}{activity.length < data.activityTotal && <button type="button" className="session-load-more" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more activity'}</button>}</section></div>
        {error && <p className="session-note" role="status">{error}</p>}
      </div>}
    </aside>
  </>
}
