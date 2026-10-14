import { useEffect, useRef, useState } from 'react'

type ChatMessage = { role: 'user' | 'assistant'; text: string }
type ChatEvent = { type: 'text'; text: string } | { type: 'done'; text: string } | { type: 'error'; message: string }

export default function ClaudeChat({ sessionId, initialPrompt, loadHistory = false, onCompleted, onStarted }: { sessionId: string; initialPrompt?: string; loadHistory?: boolean; onCompleted?: () => void; onStarted?: () => void }) {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const autoSentRef = useRef<string | null>(null)
  const [historyLoaded, setHistoryLoaded] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setAvailable(null); setReason(null); setMessages([]); setError(null); setHistoryLoaded(false)
    void (async () => {
      try {
        const statusResponse = await fetch(`/api/claude/chat/${encodeURIComponent(sessionId)}`, { signal: controller.signal, cache: 'no-store' })
        if (!statusResponse.ok) throw new Error('Could not check this local session.')
        const status = await statusResponse.json() as { available: boolean; reason: string | null }
        if (loadHistory && status.available) {
          const historyResponse = await fetch(`/api/claude/chat/${encodeURIComponent(sessionId)}/messages`, { signal: controller.signal, cache: 'no-store' })
          if (historyResponse.ok) {
            const history = await historyResponse.json() as { messages: ChatMessage[] }
            if (!controller.signal.aborted) setMessages(history.messages)
          }
        }
        if (!controller.signal.aborted) { setAvailable(status.available); setReason(status.reason); setHistoryLoaded(true) }
      } catch (cause) {
        if (!controller.signal.aborted) { setAvailable(false); setReason(cause instanceof Error ? cause.message : 'Connection check failed.'); setHistoryLoaded(true) }
      }
    })()
    return () => { controller.abort(); abortRef.current?.abort() }
  }, [sessionId, loadHistory])

  const sendPrompt = async (prompt: string) => {
    if (!prompt || !available || sending) return
    const controller = new AbortController()
    abortRef.current = controller
    onStarted?.()
    setDraft(''); setError(null); setSending(true)
    setMessages((current) => [...current, { role: 'user', text: prompt }, { role: 'assistant', text: '' }])
    try {
      const response = await fetch(`/api/claude/chat/${encodeURIComponent(sessionId)}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }), signal: controller.signal,
      })
      if (!response.ok) {
        const payload = await response.json() as { error?: string }
        throw new Error(payload.error || `Chat failed (${response.status}).`)
      }
      if (!response.body) throw new Error('Streaming is unavailable in this browser.')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let complete = false
      const receive = (value: ChatEvent) => {
        if (value.type === 'error') { setError(value.message); complete = true; return }
        if (value.type === 'done') { complete = true; onCompleted?.() }
        setMessages((current) => current.map((item, index) => index === current.length - 1 && item.role === 'assistant'
          ? { ...item, text: value.type === 'done' ? value.text || item.text : item.text + value.text } : item))
      }
      while (true) {
        const { value, done } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        const frames = buffer.split('\n\n')
        buffer = frames.pop() || ''
        for (const frame of frames) {
          const line = frame.split('\n').find((part) => part.startsWith('data: '))
          if (line) receive(JSON.parse(line.slice(6)) as ChatEvent)
        }
        if (complete) { await reader.cancel(); break }
        if (done) break
      }
      if (!complete) throw new Error('Claude disconnected before finishing the reply.')
    } catch (cause) {
      if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : 'Could not send this message.'); setDraft(prompt) }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setSending(false)
    }
  }

  useEffect(() => {
    if (!initialPrompt || !available || !historyLoaded || autoSentRef.current === sessionId) return
    autoSentRef.current = sessionId
    void sendPrompt(initialPrompt)
  }, [available, historyLoaded, initialPrompt, sessionId])

  const send = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const prompt = draft.trim()
    if (prompt) void sendPrompt(prompt)
  }

  const stop = () => {
    abortRef.current?.abort()
    setError('Reply stopped. You can send another message.')
  }

  return <section className="claude-chat" aria-label="Claude Code chat">
    <div className="claude-chat-heading"><div><span>{loadHistory ? 'CLAUDE CODE CHAT' : 'LIVE CONNECTION TEST'}</span><h3>{loadHistory ? 'Talk with your villager' : 'Chat with this Claude session'}</h3></div><div className="claude-chat-status"><small>{available === null ? 'Checking local session…' : sending ? 'Claude is responding…' : available ? 'Local session ready' : 'Unavailable'}</small>{sending && <button type="button" className="claude-chat-stop" onClick={stop}>Stop reply</button>}</div></div>
    <p className="session-note">Claude can read project files; edits and commands are disabled until Minecode has approval controls.</p>
    {reason && <p className="session-note" role="status">{reason}</p>}
    {messages.length > 0 && <ol className="claude-chat-messages" aria-live="polite">{messages.map((message, index) => <li className={message.role} key={index}><strong>{message.role === 'user' ? 'You' : 'Claude'}</strong><p>{message.text || (sending && index === messages.length - 1 ? 'Thinking…' : 'No reply received.')}</p></li>)}</ol>}
    {error && <p className="claude-chat-error" role="alert">{error}</p>}
    <form className="claude-chat-form" onSubmit={(event) => void send(event)}>
      <label htmlFor="claude-chat-prompt">Message</label>
      <textarea id="claude-chat-prompt" value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} maxLength={8000} placeholder="Ask a follow-up in this Claude session…" disabled={!available || sending} />
      <div className="claude-chat-actions">
        <button type="submit" disabled={!available || sending || !draft.trim()}>{sending ? 'Claude is responding…' : 'Send to Claude'}</button>
      </div>
    </form>
  </section>
}
