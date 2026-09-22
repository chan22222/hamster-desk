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
  /** which account (config folder) this session was found under; absent = the default one */
  profileId?: string
}

/**
 * One Claude Code account = one config folder (`CLAUDE_CONFIG_DIR`). `dir: null` is the account the
 * CLI uses when nobody tells it otherwise (~/.claude); the app never sets the variable for that one.
 */
export interface Profile {
  id: string
  name: string
  dir: string | null
  /** who is logged in there, as the CLI wrote it down (read-only; filled in by `profiles:list`) */
  email?: string | null
}

export const DEFAULT_PROFILE_ID = 'default'

export interface ProfilesState {
  list: Profile[]
  /** the account new terminals open under */
  currentId: string
  /**
   * The CLI's own account (~/.claude) was taken off the list. It cannot be *deleted* — that folder
   * is not this app's — so "remove" on it only hides it, and this is what lets the UI offer it back.
   */
  hiddenDefault?: boolean
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
  /** `CLAUDE_CONFIG_DIR` the session ran with ('' = unset); undefined when an older script wrote the file */
  configDir?: string
  /** the account those rate limits belong to (main fills it in before the event goes out) */
  profileId?: string
}

/**
 * What the CLI's own usage query says about an account (electron/usage-query.ts): the two windows
 * the status line also reports, plus the per-model weekly windows the status line never carries —
 * `Fable` has a weekly budget of its own that can run out before the all-model one does.
 */
export interface UsageWindows {
  profileId: string
  ts: number
  fiveHour: RateWindow | null
  sevenDay: RateWindow | null
  /** per-model weekly windows, keyed by the name the server gives the bucket (`Fable`, `Opus`, `Sonnet`) */
  models: Record<string, RateWindow>
  /** 'max' | 'pro' | … as the CLI reports it; null when the account is not a subscription */
  subscription: string | null
}

/** One account's "start the next 5-hour window as soon as the last one ends" (electron/five-hour.ts). */
export interface FiveHourAccount {
  on: boolean
  /** unix ms the account's current 5-hour window ends, as far as the app knows */
  resetsAt: number | null
  /** unix ms of the last message the app sent to start one */
  lastAt: number | null
  /** unix ms the next one goes out (now or later); null while off */
  nextAt: number | null
  /** a message is on its way right now */
  sending: boolean
  error: string | null
}

/** profile id → its FiveHourAccount, for every account on the list */
export type FiveHourState = Record<string, FiveHourAccount>

/**
 * "멀티 에이전트" — a standing instruction block the app keeps in each account's CLAUDE.md that tells
 * Claude when to split work across sub-agents (electron/delegation.ts). `preset` picks the harness
 * text, `cap` limits the agents run at once (0 = no line about it), `custom` is the user's own text.
 */
export type DelegationPreset = 'when-needed' | 'eager' | 'plan-review' | 'custom'
/** the harnesses on offer, in menu order (the texts themselves live in electron/delegation.ts) */
export const DELEGATION_PRESETS: { id: DelegationPreset; label: string; hint: string }[] = [
  { id: 'when-needed', label: '필요할 때만', hint: '독립적인 부분으로 나뉠 때만 병렬로' },
  { id: 'eager', label: '적극 분담', hint: '부분이 둘 이상이면 언제나 나눠서' },
  { id: 'plan-review', label: '계획 → 분담 → 검토', hint: '나눠 맡긴 뒤 검토 에이전트가 확인' },
  { id: 'custom', label: '직접 입력', hint: '내가 쓴 지시문 그대로' },
]
/** how many sub-agents at once; 0 = no limit line */
export const DELEGATION_CAPS = [0, 2, 3, 4, 6] as const
export interface DelegationConfig {
  on: boolean
  preset: DelegationPreset
  cap: number
  custom: string
}
/** 'installed' = this config's block is in the file; 'stale' = a block is there but says something else */
export type DelegationFileState = 'installed' | 'stale' | 'none' | 'error'
export interface DelegationState {
  config: DelegationConfig
  /** profile id → the state of that account's CLAUDE.md, and why when it could not be written */
  accounts: Record<string, { state: DelegationFileState; file: string; error: string | null }>
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export const EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']

export interface VersionInfo {
  current: string | null
  latest: string | null
  checkedAt: number
  error: string | null
}

/** This app against `main` of its own repository on GitHub (electron/app-update.ts). */
export interface AppUpdateInfo {
  /** the commit this build was made from; null when it was built outside a git checkout */
  commit: string | null
  /** how many commits `main` has that this build does not */
  behind: number
  /** those commits, newest first: short sha and the first line of the message */
  commits: { sha: string; title: string }[]
  /** true when "update" can pull and rebuild by itself (the app runs out of its own git checkout) */
  canSelfUpdate: boolean
  checkedAt: number
  error: string | null
  /** the running app's version (package.json) */
  version?: string
  /**
   * An *installed* build does not follow commits: it follows GitHub Releases (electron/app-release.ts).
   * 'available': a newer release, not downloaded until the user says so. 'ready': downloaded, and a
   * restart installs it.
   */
  release?: { version: string; state: 'available' | 'downloading' | 'ready'; percent: number } | null
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
  /** the CLI's usage query for one account (per-model weekly windows included) */
  | ({ kind: 'usage_windows' } & UsageWindows)
  | ({ kind: 'version' } & VersionInfo)
  | ({ kind: 'app_update' } & AppUpdateInfo)
  // from the embedded terminal (heuristic on pty output)
  | { kind: 'waiting'; ptyId: number; reason: 'permission' | 'question'; ts: number }
  | { kind: 'waiting_clear'; ptyId: number; ts: number }

export type DeskEventKind = DeskEvent['kind']

export interface PtyInfo {
  id: number
  pid: number
  shell: string
  cwd: string
  /** the account this shell was started under (absent = default) */
  profileId?: string
}


// ---- folder browser (electron/main.ts fs:*)

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

// ---- UI settings persisted outside the Electron profile (electron/ui-store.ts, ~/.hamster-desk/ui.json)

/** Whatever the renderer wants remembered (language, open panels, …); shallow-merged, JSON only. */
export type UiState = Record<string, unknown>

// ---- OS notifications (electron/notify.ts)

export interface NotifyRequest {
  title: string
  body: string
  /** what the notification is about; also the key the renderer de-duplicates on */
  tag: 'permission' | 'question' | 'turn'
  /** the tab id to open when the notification is clicked (`ws:<id>` / `session:<id>`) */
  tab: string
}

/** `unsupported` = this OS/build cannot show toasts at all; `failed` = it tried and the OS refused. */
export type NotifyResult = 'shown' | 'failed' | 'unsupported'

// ---- past conversations (electron/transcripts.ts)

/** One `~/.claude/projects/<slug>/<id>.jsonl`, summarized without parsing the whole file. */
export interface TranscriptEntry {
  sessionId: string
  path: string
  title: string
  subtitle: string
  /** unix ms of the first user record */
  startedAt: number
  /** unix ms of the last record seen in the tail */
  lastAt: number
  branch: string | null
  /** bytes */
  size: number
  /** a claude is running this session right now */
  live: boolean
}

// ---- git (electron/git.ts — read-only commands only)

export interface GitInfo {
  repo: boolean
  branch: string | null
  /** number of changed paths in `git status --porcelain` */
  changed: number
  ahead: number
  behind: number
  /** unix ms this snapshot was taken */
  at: number
  error: string | null
}

export interface GitDiff {
  text: string
  /** the diff was longer than the cap and the text is cut */
  truncated: boolean
  /** the file is not in git yet, so there is nothing to diff */
  untracked: boolean
  error: string | null
}

// ---- turn summaries (src/log/turn.ts)

export interface TurnSummary {
  /** distinct files touched during the turn */
  files: number
  added: number
  removed: number
  durationMs: number
  /** the last thing the main hamster said, trimmed */
  said: string
  /** unix ms the turn ended */
  at: number
}

/** A `TurnSummary` on screen: it knows which session and tab it belongs to. */
export type TurnToast = TurnSummary & { sessionId: string; tab: string }

// ---- speech bubble log (src/log/FeedLog.tsx)

/** A permanent copy of one feed row, kept per session after the bubble itself expires. */
export interface LogItem {
  id: string
  hid: string
  hidName: string
  kind: 'say' | 'act'
  tone: string
  text: string
  raw: string
  ts: number
  count: number
}

// ---- window placement (electron/window-state.ts)

export interface WindowState {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}
