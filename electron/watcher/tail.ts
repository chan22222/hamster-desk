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
  private reading = false
  private dirty = false
  private skipFirstPartial = false
  private opened = false
  private closed = false

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
   * Before open() has placed the offset a call does nothing — it would read the file from byte 0 (and
   * open() then read the tail of it again); open() reads everything there is anyway.
   */
  async poll(): Promise<void> {
    if (this.closed || !this.opened) return
    if (this.reading) {
      this.dirty = true
      return
    }
    this.reading = true
    try {
      do {
        this.dirty = false
        await this.readOnce()
      } while (this.dirty && !this.closed)
    } catch (e) {
      this.opts.onError?.(e)
    } finally {
      this.reading = false
    }
  }

  /** Where reading starts in a file of `size` bytes: its start, or `tailBytes` from its end. */
  private seek(size: number): void {
    const tb = this.opts.tailBytes
    this.partial = []
    this.skipFirstPartial = !!tb && size > tb
    this.offset = this.skipFirstPartial ? size - tb! : 0
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
