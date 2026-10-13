export type TelemetrySource = 'claude' | 'codex'
export type TelemetryPeriod = 7 | 30 | 90 | 'all'

export type TelemetrySummary = {
  source: TelemetrySource
  period: TelemetryPeriod
  updatedAt: string
  conversations: number
  prompts: number
  tokens: number | null
  apiRequests: number
  errors: number
  toolResults: number | null
  estimatedCostUsd: number | null
  partialCost: boolean
  activeSeconds: number | null
  avgTokensPerRequest: number | null
  avgTokensPerPrompt: number | null
  linkedPrompts: number | null
  timeline: { timestamp: number; total: number }[]
  timelineEvents: number
}
