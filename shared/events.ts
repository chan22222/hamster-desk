// Normalized events flowing from the watcher (Electron main / CLI) to the desk renderer.
// Everything here is derived from files Claude Code already writes; no hooks, no CLI patching.

export type ToolAction =
  | 'read' // Read
  | 'search' // Grep, Glob, LS
  | 'write' // Edit, Write, NotebookEdit, MultiEdit
  | 'run' // Bash, PowerShell
  | 'hire' // Agent, Task, Workflow
  | 'browse' // WebFetch, WebSearch, mcp__claude-in-chrome__*
  | 'other'

export type SessionStatus = 'busy' | 'idle' | string

export interface SessionInfo {
  sessionId: string
  pid: number
  cwd: string
  name: string
  status: SessionStatus
  startedAt: number
  updatedAt: number
  version: string
  sessionKind: string
  /** true when the claude process is a descendant of a shell this window spawned */
  mine: boolean
  /** which embedded terminal (pty id) the claude process runs in, when mine */
  ptyId: number | null
  transcriptPath: string | null
}

export interface RateWindow {
  usedPercentage: number
  /** unix ms */
  resetsAt: number | null
}

/** Snapshot written by the status-line script Claude Code runs (opt-in, see electron/statusline.ts). */
export interface StatusSnapshot {
  sessionId: string
  ts: number
  model: { id: string; displayName: string } | null
  effort: string | null
  contextUsedPct: number | null
  contextSize: number | null
  costUSD: number | null
  linesAdded: number | null
  linesRemoved: number | null
  fiveHour: RateWindow | null
  sevenDay: RateWindow | null
  /** any extra windows the CLI reports, keyed by name */
  otherWindows: Record<string, RateWindow>
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export const EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

export interface VersionInfo {
  current: string | null
  latest: string | null
  checkedAt: number
  error: string | null
}

export type DeskEvent =
  | ({ kind: 'session' } & SessionInfo)
  | { kind: 'session_gone'; sessionId: string }
  | { kind: 'title'; sessionId: string; title: string; ts?: number }
  | { kind: 'prompt'; sessionId: string; agentId: string | null; text: string; ts: number }
  | {
      kind: 'agent_start' // upsert: may arrive twice (jsonl first, meta.json later)
      sessionId: string
      agentId: string
      agentType: string
      description: string
      toolUseId: string | null
      depth: number
      background: boolean
      ts: number
    }
  | { kind: 'agent_stop'; sessionId: string; agentId: string; ts: number }
  | {
      kind: 'tool'
      sessionId: string
      agentId: string | null
      toolUseId: string
      name: string
      action: ToolAction
      label: string
      file: string | null
      ts: number
    }
  | { kind: 'tool_done'; sessionId: string; agentId: string | null; toolUseId: string; ok: boolean; ts: number }
  | {
      kind: 'edit'
      sessionId: string
      agentId: string | null
      toolUseId: string
      file: string
      op: 'edit' | 'write'
      added: number
      removed: number
      preview: { old: string; new: string } | null
      ts: number
    }
  | { kind: 'text'; sessionId: string; agentId: string | null; text: string; ts: number }
  | { kind: 'thinking'; sessionId: string; agentId: string | null; ts: number }
  | { kind: 'turn_end'; sessionId: string; durationMs: number; ts: number }
  | { kind: 'cost'; sessionId: string; linesAdded: number; linesRemoved: number; costUSD: number; ts?: number }
  | { kind: 'compact'; sessionId: string; ts: number }
  /** model / effort as recorded on each assistant message */
  | { kind: 'model'; sessionId: string; agentId: string | null; model: string; effort: string | null; ts: number }
  /** status-line snapshot (rate limits, context window, cost) */
  | ({ kind: 'status' } & StatusSnapshot)
  | ({ kind: 'version' } & VersionInfo)
  // from the embedded terminal (heuristic on pty output)
  | { kind: 'waiting'; ptyId: number; reason: 'permission' | 'question'; ts: number }
  | { kind: 'waiting_clear'; ptyId: number; ts: number }

export type DeskEventKind = DeskEvent['kind']

export interface PtyInfo {
  id: number
  pid: number
  shell: string
  cwd: string
}


// ---- folder browser / recent projects (electron/main.ts fs:* and projects:recent)

export interface DirEntry {
  name: string
  path: string
  git: boolean
  claude: boolean
}

export interface FileEntry {
  name: string
  path: string
  size: number
  /** unix ms */
  mtime: number
  /** lowercase extension without the dot ('' when none) */
  ext: string
}

/** Derived from ~/.claude/history.jsonl — only `project` and `timestamp`; prompt text never leaves main. */
export interface RecentProject {
  path: string
  lastActiveAt: number
  prompts: number
  git: boolean
  claude: boolean
  exists: boolean
}

// ---- speech bubble summaries (electron/summarize.ts)

export interface BubbleRequest {
  /** renderer-side identity of this bubble; echoed back so stale answers can be dropped */
  key: string
  /** one in-flight request per lane (a hamster); a newer request supersedes a queued one */
  lane: string
  kind: 'said' | 'assigned'
  text: string
  /** language for the bubble, as written in the prompt (e.g. "Korean") */
  lang: string
  maxChars: number
}

export interface BubbleResult {
  key: string
  text: string | null
  error: string | null
}

/** What the bubble summaries have cost so far. Only calls that actually reached Haiku are counted. */
export interface BubbleStats {
  calls: number
  /** input + cache creation + cache read */
  inputTokens: number
  outputTokens: number
  costUSD: number
  /** unix ms the counter started (or was last reset) */
  since: number
}

export interface BubbleState {
  available: boolean
  reason: string | null
  /** unix ms until which the summarizer stays off after repeated failures */
  disabledUntil: number | null
  stats: BubbleStats
}
