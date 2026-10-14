import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { getSessionMessages, query } from '@anthropic-ai/claude-agent-sdk'

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ClaudeChatSession = { id: string; cwd: string; newSession?: boolean }
export type ClaudeChatEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string }

export async function readClaudeChatMessages(session: ClaudeChatSession): Promise<{ role: 'user' | 'assistant'; text: string }[]> {
  if (session.newSession) return []
  const rows = await getSessionMessages(session.id, { dir: session.cwd })
  return rows.flatMap((row) => {
    if (row.type !== 'user' && row.type !== 'assistant') return []
    const message = row.message as { content?: unknown }
    const content = message?.content
    const text = typeof content === 'string' ? content : Array.isArray(content)
      ? content.filter((block): block is { type: 'text'; text: string } => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('') : ''
    return text.trim() ? [{ role: row.type, text: text.trim() }] : []
  }).slice(-60)
}

/** Find the transcript for a telemetry session. The caller never supplies a path. */
export async function findClaudeChatSession(id: string, claudeHome = process.env.CLAUDE_HOME || join(homedir(), '.claude')): Promise<ClaudeChatSession | null> {
  if (!SESSION_ID.test(id)) return null
  let projects
  try { projects = await readdir(join(claudeHome, 'projects'), { withFileTypes: true }) }
  catch { return null }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const path = join(claudeHome, 'projects', project.name, `${id}.jsonl`)
    try { if (!(await stat(path)).isFile()) continue }
    catch { continue }
    try {
      const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
      try {
        let count = 0
        for await (const line of lines) {
          if (++count > 100) break
          try {
            const record = JSON.parse(line) as { cwd?: unknown; sessionId?: unknown }
            if (record.sessionId !== undefined && record.sessionId !== id) continue
            if (typeof record.cwd !== 'string' || !isAbsolute(record.cwd)) continue
            const cwd = resolve(record.cwd)
            if ((await stat(cwd)).isDirectory()) return { id, cwd }
          } catch { /* Ignore incomplete and non-message lines. */ }
        }
      } finally { lines.close() }
    } catch { /* The transcript may disappear while Claude Code rotates files. */ }
  }
  return null
}

/** The first connection test keeps code actions behind a future approval UI. */
export async function runClaudeChat(session: ClaudeChatSession, prompt: string, signal: AbortSignal, emit: (event: ClaudeChatEvent) => void, queryRunner: typeof query = query): Promise<void> {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    emit({ type: 'error', message: 'An API credential is set on the Minecode server. Remove it and restart Minecode to use your Claude plan.' })
    return
  }
  let finished = false
  try {
    for await (const message of queryRunner({
      prompt,
      options: {
        cwd: session.cwd,
        ...(session.newSession ? { sessionId: session.id } : { resume: session.id }),
        includePartialMessages: true,
        abortController: signalToController(signal),
        tools: ['Read', 'Glob', 'Grep'],
        allowedTools: ['Read', 'Glob', 'Grep'],
        mcpServers: {},
        strictMcpConfig: true,
        permissionMode: 'dontAsk',
        maxTurns: 6,
      },
    })) {
      if (signal.aborted) return
      if (message.type === 'system' && message.subtype === 'init' && message.apiKeySource !== 'none' && message.apiKeySource !== 'oauth') {
        emit({ type: 'error', message: 'Claude is using an API credential. Switch Claude Code to your Pro login before chatting from Minecode.' })
        return
      }
      if (message.type === 'stream_event' && message.event.type === 'content_block_delta' && message.event.delta.type === 'text_delta') {
        emit({ type: 'text', text: message.event.delta.text })
      }
      if (message.type === 'assistant' && message.message.stop_reason === 'end_turn') {
        finished = true
        const text = message.message.content.filter((block) => block.type === 'text').map((block) => block.text).join('')
        emit({ type: 'done', text })
        return
      }
      if (message.type === 'result') {
        finished = true
        if (message.subtype === 'success' && !message.is_error) emit({ type: 'done', text: message.result })
        else emit({ type: 'error', message: 'Claude could not finish this reply. Check your Claude Code login and plan usage.' })
        return
      }
    }
    if (!finished && !signal.aborted) emit({ type: 'error', message: 'Claude ended without a reply. Check your Claude Code login.' })
  } catch (error) {
    if (!signal.aborted) {
      console.error('Claude chat failed:', error)
      emit({ type: 'error', message: 'Could not connect to Claude Code. Check your local Claude Code login.' })
    }
  }
}

function signalToController(signal: AbortSignal): AbortController {
  const controller = new AbortController()
  if (signal.aborted) controller.abort()
  else signal.addEventListener('abort', () => controller.abort(), { once: true })
  return controller
}
