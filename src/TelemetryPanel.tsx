import { useEffect, useRef, useState } from 'react'
import type { AccountOverview, TelemetryPeriod, TelemetrySource, TelemetrySummary } from './telemetryData'
import type { PanelTheme } from './PanelDisplayControls'

const whole = new Intl.NumberFormat()
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
export const number = (value: number | null) => value === null ? 'Unavailable' : whole.format(Math.round(value))
export const short = (value: number | null) => value === null ? 'Unavailable' : compact.format(value)
export const currency = (value: number | null) => value === null ? 'Unavailable' : `$${value.toFixed(2)}`
export const duration = (value: number | null) => value === null ? 'Unavailable' : value >= 3600 ? `${(value / 3600).toFixed(1)}h` : `${Math.round(value / 60)}m`
const date = (value: number) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value))

export function Chart({ points, source }: { points: TelemetrySummary['timeline']; source: TelemetrySource }) {
  if (!points.length) return <p className="telemetry-empty">Token timing becomes available when completed responses report token counts.</p>
  const first = points[0].timestamp
  const last = points.at(-1)!.timestamp
  const total = points.at(-1)!.total
  const x = (timestamp: number, index: number) => 58 + (last === first ? (points.length === 1 ? .5 : index / (points.length - 1)) : (timestamp - first) / (last - first)) * 696
  const y = (value: number) => 202 - value / Math.max(1, total) * 165
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${x(point.timestamp, index).toFixed(1)},${y(point.total).toFixed(1)}`).join(' ')
  const area = `M${x(first, 0).toFixed(1)},202 ${line.replace(/^M/, 'L')} L${x(last, points.length - 1).toFixed(1)},202 Z`
  return <div className={`telemetry-chart ${source}`}><svg viewBox="0 0 810 246" role="img" aria-label={`Cumulative token timeline ending at ${number(total)} tokens`}>
    {[0, .5, 1].map((fraction) => <g key={fraction}><line x1="58" x2="754" y1={202 - fraction * 165} y2={202 - fraction * 165} /><text x="48" y={207 - fraction * 165} textAnchor="end">{short(total * fraction)}</text></g>)}
    <path d={area} className="chart-area" /><path d={line} className="chart-line" />
    {points.map((point, index) => <circle key={`${point.timestamp}-${index}`} cx={x(point.timestamp, index)} cy={y(point.total)} r="3" tabIndex={0} aria-label={`${date(point.timestamp)}: ${number(point.total)} cumulative tokens`}><title>{date(point.timestamp)} · {number(point.total)} cumulative tokens</title></circle>)}
    <text x="58" y="235">{date(first)}</text><text x="754" y="235" textAnchor="end">{date(last)}</text>
  </svg></div>
}

export function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="telemetry-metric"><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</div>
}

function AccountsView({ overview }: { overview: AccountOverview }) {
  const maxTokens = Math.max(1, ...overview.accounts.map((account) => account.inputTokens + account.outputTokens + account.cacheReadTokens + account.cacheCreationTokens))
  return <div className="accounts-view">
    <p className="account-explainer">Usage is grouped by the account email on each Claude telemetry record. A chat used with multiple accounts appears in each account’s chat count, while its usage is split by record. Missing emails appear as Unattributed.</p>
    {!overview.accounts.length ? <div className="telemetry-message">No account usage in this period yet.</div> : overview.accounts.map((account) => {
      const tokens = account.inputTokens + account.outputTokens + account.cacheReadTokens + account.cacheCreationTokens
      const active = (account.activeUserSeconds ?? 0) + (account.activeCliSeconds ?? 0)
      return <article className="account-card" key={account.email}>
        <div className="account-card-heading"><div><span className="telemetry-eyebrow">CLAUDE ACCOUNT</span><h3>{account.email || 'Unattributed'}</h3></div><small>{number(account.projects.length)} {account.projects.length === 1 ? 'project' : 'projects'}</small></div>
        <div className="account-usage-track" role="img" aria-label={`${number(tokens)} tokens`}><span style={{ width: `${tokens / maxTokens * 100}%` }} /></div>
        <div className="telemetry-metrics account-metrics">
          <Metric label="Tokens" value={number(tokens)} hint="Input, output, and cache" />
          <Metric label="Estimated cost" value={currency(account.estimatedCostUsd)} hint={account.estimatedCostUsd === null ? 'No cost estimate' : account.missingCostSlices ? 'Partial Claude Code estimate' : 'Claude Code estimate'} />
          <Metric label="Chats" value={number(account.sessions)} hint="Distinct session IDs" />
          <Metric label="Prompts" value={number(account.prompts)} />
          <Metric label="API requests" value={number(account.apiRequests)} />
          <Metric label="Active time" value={account.activeUserSeconds === null && account.activeCliSeconds === null ? 'Unavailable' : duration(active)} />
        </div>
        <div className="account-breakdown"><span>Input <strong>{number(account.inputTokens)}</strong></span><span>Output <strong>{number(account.outputTokens)}</strong></span><span>Cache read <strong>{number(account.cacheReadTokens)}</strong></span><span>Cache write <strong>{number(account.cacheCreationTokens)}</strong></span></div>
        <p className="account-projects">Projects: {account.projects.join(', ') || 'Unknown'}</p>
      </article>
    })}
  </div>
}

export default function TelemetryPanel({ source, theme, displayControls, onClose }: { source: TelemetrySource; theme: PanelTheme; displayControls: React.ReactNode; onClose: () => void }) {
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [period, setPeriod] = useState<TelemetryPeriod>(30)
  const [view, setView] = useState<'overview' | 'accounts'>('overview')
  const [data, setData] = useState<TelemetrySummary | null>(null)
  const [accounts, setAccounts] = useState<AccountOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    closeRef.current?.focus()
    return () => { document.querySelector<HTMLElement>(`[data-world-label="board"][data-world-id="${source}"]`)?.focus() }
  }, [source])
  const containFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const controls = [...(panelRef.current?.querySelectorAll<HTMLElement>('button, select, input') || [])]
    if (!controls.length) return
    const first = controls[0], last = controls.at(-1)!
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const response = await fetch(view === 'accounts' ? `/api/telemetry/claude/accounts?days=${period}` : `/api/telemetry/${source}?days=${period}`, { signal: controller.signal, cache: 'no-store' })
        const next = await response.json() as TelemetrySummary | AccountOverview | { error: string }
        if (!response.ok) throw new Error('error' in next ? next.error : `Telemetry request failed (${response.status})`)
        if (!controller.signal.aborted) {
          if (view === 'accounts') setAccounts(next as AccountOverview)
          else setData(next as TelemetrySummary)
          setError(null)
        }
      } catch (cause) {
        if (!controller.signal.aborted) { setData(null); setAccounts(null); setError(cause instanceof Error ? cause.message : 'Telemetry is unavailable') }
      }
    }
    setData(null); setAccounts(null); setError(null)
    void load()
    const timer = window.setInterval(() => void load(), 15_000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [source, period, view])

  const name = source === 'claude' ? 'Claude Code' : 'Codex'
  return <><div className="telemetry-scrim" onClick={onClose} aria-hidden="true" />
    <aside ref={panelRef} className={`telemetry-panel ${source} ${theme}`} role="dialog" aria-modal="true" aria-label={`${name} telemetry`} onKeyDown={containFocus}>
      <div className="telemetry-panel-head"><div><p className="telemetry-eyebrow">{name.toUpperCase()} / TELEMETRY</p><h2>{view === 'accounts' ? 'Claude Code accounts' : `${name} dashboard`}</h2><p>{view === 'accounts' ? 'Usage attributed to each Claude account.' : `Observed usage across ${source === 'claude' ? 'chats' : 'conversations'}.`}</p></div><button ref={closeRef} type="button" className="telemetry-close" onClick={onClose} aria-label="Close telemetry dashboard">×</button></div>
      {displayControls}
      {source === 'claude' && <div className="telemetry-tabs" role="tablist" aria-label="Claude telemetry views"><button type="button" role="tab" aria-selected={view === 'overview'} className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}>Overview</button><button type="button" role="tab" aria-selected={view === 'accounts'} className={view === 'accounts' ? 'active' : ''} onClick={() => setView('accounts')}>Accounts</button></div>}
      <div className="telemetry-toolbar"><label>Period <select value={period} onChange={(event) => setPeriod(event.target.value === 'all' ? 'all' : Number(event.target.value) as 7 | 30 | 90)}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value="all">All time</option></select></label>{(data || accounts) && <span>Updated {new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date((data || accounts)!.updatedAt))}</span>}</div>
      {error ? <div className="telemetry-message" role="status"><h3>Telemetry unavailable</h3><p>{error}</p><p>Minecode receives and stores {name} telemetry locally.</p></div> : view === 'accounts' ? accounts ? <AccountsView overview={accounts} /> : <div className="telemetry-message" role="status">Loading accounts…</div> : !data ? <div className="telemetry-message" role="status">Loading telemetry…</div> : <div className="telemetry-panel-content">
        <div className="telemetry-metrics">
          <Metric label={source === 'claude' ? 'Chats' : 'Conversations'} value={number(data.conversations)} hint="Distinct IDs" />
          <Metric label="Prompts" value={number(data.prompts)} hint="User prompt events" />
          <Metric label={source === 'claude' ? 'Tokens' : 'Observed tokens'} value={short(data.tokens)} hint={source === 'claude' ? 'Input, output, and cache' : 'Reported by completed responses'} />
          {source === 'claude' ? <>
            <Metric label="Estimated cost" value={currency(data.estimatedCostUsd)} hint={data.estimatedCostUsd === null ? 'No cost estimate' : data.partialCost ? 'Partial Claude Code estimate' : 'Claude Code estimate'} />
            <Metric label="Active time" value={duration(data.activeSeconds)} hint="User + Claude processing" />
            <Metric label="Avg tokens / request" value={number(data.avgTokensPerRequest)} hint={`${number(data.timelineEvents)} requests with token counts`} />
            <Metric label="Avg tokens / prompt" value={number(data.avgTokensPerPrompt)} hint={`${number(data.linkedPrompts)} linked prompt groups`} />
          </> : <>
            <Metric label="API requests" value={number(data.apiRequests)} />
            <Metric label="API errors" value={number(data.errors)} />
            <Metric label="Tool results" value={number(data.toolResults)} />
          </>}
        </div>
        <section className="telemetry-timeline"><div className="telemetry-section-head"><div><span>USAGE OVER TIME</span><h3>Token timeline</h3></div><small>{number(data.timelineEvents)} {source === 'claude' ? 'API requests' : 'responses'} across {number(data.conversations)} {source === 'claude' ? 'chats' : 'conversations'}</small></div><Chart points={data.timeline} source={source} /><p>Each point adds the token count reported by {source === 'claude' ? 'an API request' : 'a completed response'}.</p></section>
      </div>}
    </aside>
  </>
}
