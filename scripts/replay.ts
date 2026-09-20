// Dump every event of a finished session (main + subagents) as JSON for the renderer's replay mode.
//   npm run replay -- <path/to/session.jsonl> [out.json]
import { writeFileSync } from 'node:fs'
import { collectEvents } from '../electron/watcher'

const [, , src, out] = process.argv
if (!src) {
  console.error('usage: replay <session.jsonl> [out.json]')
  process.exit(1)
}
collectEvents(src).then((events) => {
  const counts: Record<string, number> = {}
  for (const e of events) counts[e.kind] = (counts[e.kind] ?? 0) + 1
  console.log(`${events.length} events`, counts)
  const dest = out ?? 'src/dev/replay.json'
  writeFileSync(dest, JSON.stringify(events))
  console.log('wrote', dest)
})
