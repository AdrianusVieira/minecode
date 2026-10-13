import { useState } from 'react'
import type { TelemetryPeriod } from './telemetryData'

type Choice = 1 | 2 | 7 | 30 | 90 | 'all' | 'custom'
type RangeControl = {
  choice: Choice; setChoice: (choice: Choice) => void
  from: string; setFrom: (value: string) => void; to: string; setTo: (value: string) => void
  range: TelemetryPeriod | null; query: string | null
}

function localDay(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dayStart(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date.getTime() : null
}

function nextDay(value: string): number | null {
  const start = dayStart(value)
  if (start === null) return null
  const date = new Date(start)
  date.setDate(date.getDate() + 1)
  return date.getTime()
}

export function useTimeRange(initial: TelemetryPeriod): RangeControl {
  const custom = typeof initial === 'object'
  const [choice, setChoice] = useState<Choice>(custom ? 'custom' : initial)
  const [from, setFrom] = useState(() => localDay(custom ? initial.start : Date.now() - 6 * 86_400_000))
  const [to, setTo] = useState(() => localDay(custom ? initial.end - 1 : Date.now()))
  const start = dayStart(from), end = nextDay(to)
  const range = choice === 'custom' ? start !== null && end !== null && start < end ? { start, end } : null : choice
  const query = range === null ? null : typeof range === 'object'
    ? `days=custom&start=${range.start}&end=${range.end}` : `days=${range}`
  return { choice, setChoice, from, setFrom, to, setTo, range, query }
}

export default function TimeRangePicker({ control, compact = false }: { control: RangeControl; compact?: boolean }) {
  return <div className={`time-range-picker ${compact ? 'compact' : ''}`}>
    <label><span>{compact ? 'Show' : 'Period'}</span><select aria-label={compact ? 'Session time range' : 'Telemetry period'} value={control.choice} onChange={(event) => setPeriod(event.target.value, control.setChoice)}>
      <option value={1}>Last 24 hours</option><option value={2}>Last 48 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value="all">All time</option><option value="custom">Custom range</option>
    </select></label>
    {control.choice === 'custom' && <div className="time-range-dates">
      <label>From <input type="date" aria-label="From date" value={control.from} max={control.to} onChange={(event) => control.setFrom(event.target.value)} /></label>
      <label>To <input type="date" aria-label="To date" value={control.to} min={control.from} onChange={(event) => control.setTo(event.target.value)} /></label>
      {!control.range && <span className="range-error" role="status">Choose a valid date range.</span>}
    </div>}
  </div>
}

function setPeriod(value: string, onChange: (choice: Choice) => void): void {
  onChange(value === 'custom' || value === 'all' ? value : Number(value) as Choice)
}
