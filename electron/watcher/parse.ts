import { basename } from 'node:path'
import type { DeskEvent, ToolAction } from '../../shared/events'

export interface ParseCtx {
  sessionId: string
  /** null for the main conversation, agent id for a subagent transcript */
  agentId: string | null
}

const TEXT_MAX = 400 // the bubble summarizer needs enough of the sentence to work with; the renderer shortens it again
const PREVIEW_MAX = 1600

export function toolAction(name: string): ToolAction {
  switch (name) {
    case 'Read':
      return 'read'
    case 'Grep':
    case 'Glob':
    case 'LS':
      return 'search'
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'write'
    case 'Bash':
    case 'PowerShell':
      return 'run'
    case 'Agent':
    case 'Task':
    case 'Workflow':
      return 'hire'
    case 'WebFetch':
    case 'WebSearch':
      return 'browse'
  }
  if (name.startsWith('mcp__claude-in-chrome__')) return 'browse'
  return 'other'
}

function countLines(s: unknown): number {
  if (typeof s !== 'string' || s.length === 0) return 0
  let n = 1
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++
  return n
}

function clip(s: string, max: number): string {
  s = s.replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function fileOf(input: Record<string, unknown>): string | null {
  const f = input.file_path ?? input.notebook_path ?? input.path
  return typeof f === 'string' && f.length ? f : null
}

function toolLabel(name: string, input: Record<string, unknown>): string {
  const f = fileOf(input)
  if (f) return basename(f)
  const d = input.description
  if (typeof d === 'string' && d.trim()) return clip(d, 80)
  if (typeof input.pattern === 'string') return clip(String(input.pattern), 60)
  if (typeof input.command === 'string') return clip(String(input.command), 60)
  if (typeof input.query === 'string') return clip(String(input.query), 60)
  if (typeof input.url === 'string') return clip(String(input.url), 60)
  if (typeof input.prompt === 'string') return clip(String(input.prompt), 60)
  return name
}

function stampOf(rec: Record<string, unknown>): number | null {
  const t = rec.timestamp
  if (typeof t === 'string') {
    const n = Date.parse(t)
    if (!Number.isNaN(n)) return n
  }
  if (typeof t === 'number') return t
  return null
}

function tsOf(rec: Record<string, unknown>): number {
  return stampOf(rec) ?? Date.now()
}

/** When a record was written, or null when it does not say (tsOf's "now" would make it look like the newest). */
export function recordTs(rec: unknown): number | null {
  return rec && typeof rec === 'object' ? stampOf(rec as Record<string, unknown>) : null
}

/**
 * How Claude Code wraps what it files as a `user` record without it being a prompt: a slash command
 * and its output, a `!` shell line and its output, a finished background task, an Esc.
 */
const ENVELOPE = /^(?:<(?:command-name|command-message|command-args|local-command-(?:stdout|stderr|caveat)|bash-(?:input|stdout|stderr)|task-notification)>|\[Request interrupted by user)/

/**
 * Whether a `user` record's text is something asked of the model — a prompt, which the renderer
 * treats as the start of a turn: it wipes the main hamster's feed, starts the turn clock and keeps the
 * text as the session's last prompt. Much of what the CLI files as `user` is its own: housekeeping
 * (`isMeta`), the summary a compaction leaves, a notice that a background task finished, a message
 * from another session. Newer versions say where a record came from (`origin.kind`: human,
 * task-notification, peer, auto-continuation, …); older ones do not, so the envelope is looked at too.
 * A person's own text can start with a tag (pasted HTML, `<pasted_content>`), so no other tag counts.
 */
function typed(r: Record<string, unknown>, text: string): boolean {
  if (r.isMeta || r.isCompactSummary || r.isVisibleInTranscriptOnly) return false
  const origin = r.origin && typeof r.origin === 'object' ? (r.origin as Record<string, unknown>).kind : undefined
  if (typeof origin === 'string' ? origin !== 'human' : r.promptSource === 'system') return false
  return !ENVELOPE.test(text.trimStart())
}

/** Turn one transcript JSONL record into zero or more desk events. Unknown records are ignored. */
export function parseRecord(rec: unknown, ctx: ParseCtx): DeskEvent[] {
  if (!rec || typeof rec !== 'object') return []
  const r = rec as Record<string, unknown>
  const { sessionId, agentId } = ctx
  const out: DeskEvent[] = []
  const type = r.type

  if (type === 'assistant') {
    const msg = r.message as Record<string, unknown> | undefined
    const content = msg?.content
    const ts = tsOf(r)
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const b = block as Record<string, unknown>
        if (b.type === 'tool_use') {
          const name = String(b.name ?? '')
          const input = (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>
          const toolUseId = String(b.id ?? '')
          out.push({
            kind: 'tool',
            sessionId,
            agentId,
            toolUseId,
            name,
            action: toolAction(name),
            label: toolLabel(name, input),
            file: fileOf(input),
            ts,
          })
          const edit = editEvent(name, input, { sessionId, agentId, toolUseId, ts })
          if (edit) out.push(edit)
        } else if (b.type === 'text') {
          const t = typeof b.text === 'string' ? b.text.trim() : ''
          if (t) out.push({ kind: 'text', sessionId, agentId, text: clip(t, TEXT_MAX), ts })
        } else if (b.type === 'thinking' || b.type === 'redacted_thinking') {
          out.push({ kind: 'thinking', sessionId, agentId, ts })
        }
      }
    }
    const model = typeof msg?.model === 'string' ? msg.model : typeof r.advisorModel === 'string' ? r.advisorModel : null
    if (model) {
      const effort = typeof r.perTurnEffort === 'string' ? r.perTurnEffort : typeof r.effort === 'string' ? r.effort : null
      out.push({ kind: 'model', sessionId, agentId, model, effort, ts })
    }
    if (agentId && msg?.stop_reason === 'end_turn') {
      out.push({ kind: 'agent_stop', sessionId, agentId, ts })
    }
    return out
  }

  if (type === 'user') {
    const msg = r.message as Record<string, unknown> | undefined
    const content = msg?.content
    const ts = tsOf(r)
    if (typeof content === 'string') {
      if (content.trim() && typed(r, content)) out.push({ kind: 'prompt', sessionId, agentId, text: clip(content, TEXT_MAX), ts })
      return out
    }
    if (Array.isArray(content)) {
      let promptText = ''
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const b = block as Record<string, unknown>
        if (b.type === 'tool_result') {
          out.push({
            kind: 'tool_done',
            sessionId,
            agentId,
            toolUseId: String(b.tool_use_id ?? ''),
            ok: b.is_error !== true,
            ts,
          })
        } else if (b.type === 'text' && typeof b.text === 'string') {
          promptText += (promptText ? ' ' : '') + b.text
        }
      }
      if (promptText.trim() && !out.length && typed(r, promptText)) {
        out.push({ kind: 'prompt', sessionId, agentId, text: clip(promptText, TEXT_MAX), ts })
      }
    }
    return out
  }

  if (type === 'system') {
    if (r.subtype === 'turn_duration') {
      out.push({ kind: 'turn_end', sessionId, durationMs: Number(r.durationMs ?? 0), ts: tsOf(r) })
    } else if (r.subtype === 'compact_boundary') {
      out.push({ kind: 'compact', sessionId, ts: tsOf(r) })
    }
    return out
  }

  if (type === 'cost-state') {
    out.push({
      kind: 'cost',
      sessionId,
      linesAdded: Number(r.totalLinesAdded ?? 0),
      linesRemoved: Number(r.totalLinesRemoved ?? 0),
      costUSD: Number(r.totalCostUSD ?? 0),
    })
    return out
  }

  if (type === 'ai-title' && typeof r.aiTitle === 'string') {
    out.push({ kind: 'title', sessionId, title: r.aiTitle })
    return out
  }

  return out
}

function editEvent(
  name: string,
  input: Record<string, unknown>,
  base: { sessionId: string; agentId: string | null; toolUseId: string; ts: number },
): DeskEvent | null {
  const file = fileOf(input)
  if (!file) return null
  const prev = (s: unknown): string => (typeof s === 'string' ? (s.length > PREVIEW_MAX ? s.slice(0, PREVIEW_MAX) + '\n…' : s) : '')
  switch (name) {
    case 'Edit':
      return {
        kind: 'edit',
        ...base,
        file,
        op: 'edit',
        added: countLines(input.new_string),
        removed: countLines(input.old_string),
        preview: { old: prev(input.old_string), new: prev(input.new_string) },
      }
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : []
      let added = 0
      let removed = 0
      for (const e of edits) {
        added += countLines(e.new_string)
        removed += countLines(e.old_string)
      }
      const first = edits[0] ?? {}
      return { kind: 'edit', ...base, file, op: 'edit', added, removed, preview: { old: prev(first.old_string), new: prev(first.new_string) } }
    }
    case 'Write':
      return { kind: 'edit', ...base, file, op: 'write', added: countLines(input.content), removed: 0, preview: { old: '', new: prev(input.content) } }
    case 'NotebookEdit':
      return { kind: 'edit', ...base, file, op: 'edit', added: countLines(input.new_source), removed: 0, preview: { old: '', new: prev(input.new_source) } }
  }
  return null
}

/** One JSONL line as a record; null for a line that is not JSON (parseRecord and taskEnds pass it over). */
export function readRecord(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

export function parseLine(line: string, ctx: ParseCtx): DeskEvent[] {
  return parseRecord(readRecord(line), ctx)
}

export const NOTICE = '<task-notification>'
/** how a background task can end; a notice without one of these (a check-in, a Monitor event) ends nothing */
const ENDED = new Set(['completed', 'failed', 'killed', 'stopped'])

export interface TaskEnd {
  /** for a subagent, the id of its agent-<id>.jsonl; also background shells and workflow runs */
  taskId: string
  ts: number
}

/**
 * Background tasks a main-transcript record says have finished. Claude Code tells the conversation
 * with a `<task-notification>` naming the task and how it ended — for a subagent that stopped without
 * an end_turn (it failed, was killed, or its last turn ended on a tool call) the only sign there is.
 * The notice is written two to four times, in different shapes: queued (`queue-operation` enqueue),
 * taken off the queue (remove), handed in as a `queued_command` attachment or as a user message.
 * Only text that is a notice from its first tag counts, so a tool result quoting one (a grep through
 * a transcript) or an agent's report that mentions the tags does not end anything.
 */
export function taskEnds(rec: unknown): TaskEnd[] {
  if (!rec || typeof rec !== 'object') return []
  const r = rec as Record<string, unknown>
  const texts: unknown[] = []
  if (r.type === 'queue-operation') texts.push(r.content)
  else if (r.type === 'attachment') {
    const a = r.attachment as Record<string, unknown> | undefined
    if (a?.type === 'queued_command') texts.push(...blockTexts(a.prompt))
  } else if (r.type === 'user') texts.push(...blockTexts((r.message as Record<string, unknown> | undefined)?.content))
  const out: TaskEnd[] = []
  for (const t of texts) {
    if (typeof t !== 'string' || !t.trimStart().startsWith(NOTICE)) continue
    for (const part of t.split(NOTICE).slice(1)) {
      // the tags Claude Code writes come before <result>; what follows is the agent's own words
      const head = part.split('</task-notification>')[0].split('<result>')[0]
      const id = head.match(/<task-id>([^<]+)<\/task-id>/)?.[1]?.trim()
      const status = head.match(/<status>([^<]+)<\/status>/)?.[1]?.trim()
      if (id && status && ENDED.has(status)) out.push({ taskId: id, ts: tsOf(r) })
    }
  }
  return out
}

/** a message's content as its text parts: the string itself, or the text blocks of an array */
function blockTexts(content: unknown): unknown[] {
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  return content.filter((b) => b && typeof b === 'object' && (b as Record<string, unknown>).type === 'text').map((b) => (b as Record<string, unknown>).text)
}
