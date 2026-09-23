import { promises as fsp } from 'node:fs'

/**
 * The most one read takes in. A catch-up (8 MB for a main transcript) or a file read from the start is
 * read and parsed a chunk at a time with a yield in between, so it does not hold the main process —
 * and with it the output of every terminal — for the whole of it.
 */
const CHUNK_BYTES = 1 << 20

/**
 * Incremental line reader. Remembers the byte offset and only reads what was appended.
 * Multi-byte UTF-8 is handled by keeping the unfinished tail as Buffers, never as a string.
 */
export class Tailer {
  private offset = 0
  /** the unfinished last line, as the pieces it arrived in: one line can span many chunks (a base64 screenshot) */
  private partial: Buffer[] = []
  /** the read in progress: a poll that comes during it waits for it */
  private reading: Promise<void> | null = null
  private dirty = false
  private skipFirstPartial = false
  private opened = false
  private closed = false
  private from = 0

  /** where the last seek put the reader: 0, or `tailBytes` from the end — nothing before it was read */
  get windowStart(): number {
    return this.from
  }

  constructor(
    public readonly path: string,
    private readonly onLine: (line: string) => void,
    private readonly opts: { tailBytes?: number; onError?: (e: unknown) => void } = {},
  ) {}

  /** Start reading. With `tailBytes`, a large file is opened near its end (the first cut line is dropped). */
  async open(): Promise<void> {
    if (this.opened) return this.poll()
    try {
      const st = await fsp.stat(this.path)
      this.seek(st.size)
    } catch (e) {
      this.opts.onError?.(e)
    }
    this.opened = true
    await this.poll()
  }

  close(): void {
    this.closed = true
  }

  /**
   * Read whatever was appended since the last call. Safe to call often; concurrent calls coalesce.
   * A call made while a read is running resolves once that read, and the one it asks for, are done:
   * whoever awaits it has seen every line that was in the file when it asked (see ProjectWatcher.settle).
   * Before open() has placed the offset a call does nothing — it would read the file from byte 0 (and
   * open() then read the tail of it again); open() reads everything there is anyway.
   */
  poll(): Promise<void> {
    if (this.closed || !this.opened) return Promise.resolve()
    if (this.reading) {
      this.dirty = true
      return this.reading
    }
    this.reading = this.drain()
    return this.reading
  }

  private async drain(): Promise<void> {
    try {
      do {
        this.dirty = false
        await this.readOnce()
      } while (this.dirty && !this.closed)
    } catch (e) {
      this.opts.onError?.(e)
    } finally {
      // cleared in the same step as the last dirty check: a poll after it starts a read of its own
      this.reading = null
    }
  }

  /** Where reading starts in a file of `size` bytes: its start, or `tailBytes` from its end. */
  private seek(size: number): void {
    const tb = this.opts.tailBytes
    this.partial = []
    this.skipFirstPartial = !!tb && size > tb
    this.offset = this.skipFirstPartial ? size - tb! : 0
    this.from = this.offset
  }

  private async readOnce(): Promise<void> {
    let st
    try {
      st = await fsp.stat(this.path)
    } catch {
      return // file vanished (or not yet created)
    }
    // truncated / rewritten: start over, under the same rule as open() — not from byte 0 of a big file
    if (st.size < this.offset) this.seek(st.size)
    if (st.size === this.offset) return
    const fh = await fsp.open(this.path, 'r')
    try {
      while (this.offset < st.size && !this.closed) {
        const len = Math.min(CHUNK_BYTES, st.size - this.offset)
        const buf = Buffer.alloc(len)
        const { bytesRead } = await fh.read(buf, 0, len, this.offset)
        if (bytesRead === 0) break // shrank under us; the next poll sees it
        this.offset += bytesRead
        this.feed(buf.subarray(0, bytesRead))
        if (this.offset < st.size) await new Promise<void>((r) => setImmediate(r))
      }
    } finally {
      await fh.close()
    }
  }

  private feed(chunk: Buffer): void {
    let data = chunk
    if (this.skipFirstPartial) {
      const nl = data.indexOf(0x0a)
      if (nl < 0) return // still inside the line the tail cut through
      data = data.subarray(nl + 1)
      this.skipFirstPartial = false
    }
    const lastNl = data.lastIndexOf(0x0a)
    if (lastNl < 0) {
      if (data.length) this.partial.push(data)
      return
    }
    const done = this.partial.length ? Buffer.concat([...this.partial, data.subarray(0, lastNl)]) : data.subarray(0, lastNl)
    // a copy, so the rest of the chunk is not kept alive by the few bytes after its last newline
    this.partial = lastNl + 1 < data.length ? [Buffer.from(data.subarray(lastNl + 1))] : []
    for (const raw of done.toString('utf8').split('\n')) {
      if (this.closed) return
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
      if (line.length) this.onLine(line)
    }
  }
}

/** the longest line scanLines() keeps to look at; a longer one (a screenshot in base64) is passed over */
const SCAN_LINE_MAX = 1 << 20

export interface ScanOptions {
  /** where to start: past 0, the line this falls in is taken for cut and passed over */
  from: number
  /** the lines that start before this byte are looked at — the one it cuts through too, to its end */
  to: number
  /** only lines holding this become strings */
  marker: string
  onLine: (line: string) => void
  /** asked before every chunk: false stops the scan */
  go: () => boolean
  maxLine?: number
}

/**
 * Find the lines in part of a file that hold `marker`, without reading the file as lines: a chunk at a
 * time with a yield in between, as the Tailer reads, searching the raw bytes and turning only a line
 * with a hit into a string. What a chunk ends inside is kept until its end comes, as long as it is
 * shorter than `maxLine`.
 */
export async function scanLines(path: string, o: ScanOptions): Promise<void> {
  const needle = Buffer.from(o.marker)
  const maxLine = o.maxLine ?? SCAN_LINE_MAX
  const text = (b: Buffer): string => {
    const s = b.toString('utf8')
    return s.endsWith('\r') ? s.slice(0, -1) : s
  }
  let fh
  try {
    fh = await fsp.open(path, 'r')
  } catch {
    return
  }
  try {
    const buf = Buffer.alloc(CHUNK_BYTES)
    let pos = o.from
    // inside a line when a chunk begins: its pieces so far, or null once it is too long (or began before `from`)
    let inLine = o.from > 0
    let held: Buffer[] | null = null
    let heldLen = 0
    while ((pos < o.to || inLine) && o.go()) {
      const at = pos
      const { bytesRead } = await fh.read(buf, 0, CHUNK_BYTES, pos)
      if (bytesRead === 0) break
      pos += bytesRead
      const data = buf.subarray(0, bytesRead)
      let start = 0
      if (inLine) {
        const nl = data.indexOf(0x0a)
        const upto = nl < 0 ? data.length : nl
        if (held && heldLen + upto <= maxLine) {
          held.push(Buffer.from(data.subarray(0, upto)))
          heldLen += upto
        } else held = null
        if (nl >= 0) {
          if (held) {
            const line = Buffer.concat(held)
            if (line.includes(needle)) o.onLine(text(line))
          }
          inLine = false
          held = null
          start = nl + 1
        }
      }
      if (!inLine) {
        const end = Math.min(data.length, o.to - at) // a line starting here or later is past `to`
        // the whole lines in this chunk, from one hit to the next
        for (let hit = data.indexOf(needle, start); hit >= 0; ) {
          const from = data.lastIndexOf(0x0a, hit) + 1
          const nl = data.indexOf(0x0a, hit)
          if (from >= end || nl < 0) break // past `to`, or runs on into the next chunk: kept below
          o.onLine(text(data.subarray(from, nl)))
          hit = data.indexOf(needle, nl + 1)
        }
        const rest = Math.max(data.lastIndexOf(0x0a) + 1, start)
        if (rest < end) {
          inLine = true
          heldLen = data.length - rest
          // a copy: the buffer is read into again
          held = heldLen <= maxLine ? [Buffer.from(data.subarray(rest))] : null
        }
      }
      await new Promise<void>((r) => setImmediate(r))
    }
  } finally {
    await fh.close()
  }
}
