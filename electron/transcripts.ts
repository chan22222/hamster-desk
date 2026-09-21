// Past conversations for one folder, read from the transcript files only (head + tail, never the
// whole file). Stub: the real implementation lands with the session work — plan §3.4. Owner: B.

import type { TranscriptEntry } from '../shared/events'

/** `live` = a sessionId in this set is running right now (watcher.liveSessions). */
export async function listTranscripts(_cwd: string, _live: Set<string>): Promise<TranscriptEntry[]> {
  return []
}
