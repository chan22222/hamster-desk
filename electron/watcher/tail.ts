import { promises as fsp } from 'node:fs'

/**
 * Incremental line reader. Remembers the byte offset and only reads what was appended.
 * Multi-byte UTF-8 is handled by keeping the unfinished tail as a Buffer, never as a string.
 */
export class Tailer {
  private offset = 0
  private partial: Buffer = Buffer.alloc(0)
  private reading = false
  private dirty = false
  private skipFirstPartial = false
  private closed = false

  constructor(
    public readonly path: string,
    private readonly onLine: (line: string) => void,
    private readonly opts: { tailBytes?: number; onError?: (e: unknown) => void } = {},
  ) {}

  /** Start reading. With `tailBytes`, a large file is opened near its end (the first cut line is dropped). */
  async open(): Promise<void> {
    try {
      const st = await fsp.stat(this.path)
      const tb = this.opts.tailBytes
      if (tb && st.size > tb) {
        this.offset = st.size - tb
        this.skipFirstPartial = true
      }
    } catch (e) {
      this.opts.onError?.(e)
    }
    await this.poll()
  }

  close(): void {
    this.closed = true
  }

  /** Read whatever was appended since the last call. Safe to call often; concurrent calls coalesce. */
  async poll(): Promise<void> {
    if (this.closed) return
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

  private async readOnce(): Promise<void> {
    let st
    try {
      st = await fsp.stat(this.path)
    } catch {
      return // file vanished (or not yet created)
    }
    if (st.size < this.offset) {
      // truncated / rewritten: start over
      this.offset = 0
      this.partial = Buffer.alloc(0)
      this.skipFirstPartial = false
    }
    if (st.size === this.offset) return
    const len = st.size - this.offset
    const fh = await fsp.open(this.path, 'r')
    let buf: Buffer
    try {
      buf = Buffer.alloc(len)
      const { bytesRead } = await fh.read(buf, 0, len, this.offset)
      buf = buf.subarray(0, bytesRead)
      this.offset += bytesRead
    } finally {
      await fh.close()
    }
    let data = this.partial.length ? Buffer.concat([this.partial, buf]) : buf
    if (this.skipFirstPartial) {
      const nl = data.indexOf(0x0a)
      if (nl < 0) {
        this.partial = data
        return
      }
      data = data.subarray(nl + 1)
      this.skipFirstPartial = false
    }
    const lastNl = data.lastIndexOf(0x0a)
    if (lastNl < 0) {
      this.partial = data
      return
    }
    this.partial = Buffer.from(data.subarray(lastNl + 1))
    const text = data.subarray(0, lastNl).toString('utf8')
    for (const raw of text.split('\n')) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
      if (line.length) this.onLine(line)
    }
  }
}
