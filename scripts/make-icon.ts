// Draws the app's hamster as 16×16 pixel art and writes it out as the icons the app ships with:
//
//   build/icon.ico          the exe / taskbar icon (electron-builder reads it from `build.win.icon`)
//   build/icon.png          256 px, the window icon of a dev run
//   src/assets/hamster.png  the grid at 1:1, scaled up by CSS on the loading screen (index.html)
//
// Pure node (zlib only), so it needs no image library. Every size in the .ico is an integer
// multiple of the grid, scaled nearest-neighbour — a smooth downscale would blur the pixels.
// The outputs are committed; run `npm run icon` again only after changing the drawing.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { deflateSync } from 'node:zlib'

const ROOT = join(__dirname, '..')

/** the studio hamster's own tones (src/desk/vox/hamster.ts: BASE, INNER_EAR, NOSE) */
const PALETTE: Record<string, [number, number, number, number]> = {
  '.': [0, 0, 0, 0],
  o: [0x5b, 0x3a, 0x1f, 255], // outline, mouth
  f: [0xf6, 0xd1, 0x9b, 255], // fur
  d: [0xd9, 0x9e, 0x58, 255], // forehead patch
  b: [0xf9, 0xe2, 0xc0, 255], // cheeks, muzzle
  e: [0x25, 0x2a, 0x33, 255], // eye
  w: [0xff, 0xff, 0xff, 255], // eye highlight
  p: [0xe8, 0xa0, 0xb0, 255], // inner ear, blush
  n: [0xd9, 0x7a, 0x8a, 255], // nose
}

const GRID = [
  '................',
  '..oo.oooooo.oo..',
  '.opfoffddffofpo.',
  '.opffffddffffpo.',
  'offffffffffffffo',
  'offffffffffffffo',
  'offfweffffwefffo',
  'offfeeffffeefffo',
  'offfffbnnbfffffo',
  'offbbbboobbbbffo',
  'obbbbbbbbbbbbbbo',
  'obppbbbbbbbbppbo',
  '.obbbbbbbbbbbbo.',
  '..oobbbbbbbboo..',
  '....oooooooo....',
  '................',
]
const N = GRID.length
/** .ico sizes: all integer multiples of the 16 px grid */
const ICO_SIZES = [16, 32, 48, 64, 128, 256]

for (const [y, row] of GRID.entries()) {
  if (row.length !== N) throw new Error(`row ${y} is ${row.length} wide, expected ${N}`)
  for (const ch of row) if (!PALETTE[ch]) throw new Error(`row ${y}: no colour for '${ch}'`)
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), 8 + data.length)
  return out
}

/** the grid as an RGBA PNG, `size` px on a side */
function png(size: number): Buffer {
  if (size % N) throw new Error(`${size} is not a multiple of ${N}`)
  const scale = size / N
  const raw = Buffer.alloc(size * (1 + size * 4)) // each scanline: filter byte 0, then RGBA
  for (let y = 0; y < size; y++) {
    const row = GRID[Math.floor(y / scale)]
    const at = y * (1 + size * 4) + 1
    for (let x = 0; x < size; x++) raw.set(PALETTE[row[Math.floor(x / scale)]], at + x * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.set([8, 6, 0, 0, 0], 8) // 8 bit, RGBA, deflate, no filter method, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** an .ico whose entries are PNGs (Windows Vista and later read those at every size) */
function ico(sizes: number[]): Buffer {
  const images = sizes.map(png)
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach((img, i) => {
    const at = 6 + 16 * i
    header.writeUInt8(sizes[i] % 256, at) // 256 is written as 0
    header.writeUInt8(sizes[i] % 256, at + 1)
    header.writeUInt16LE(1, at + 4) // colour planes
    header.writeUInt16LE(32, at + 6) // bits per pixel
    header.writeUInt32LE(img.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += img.length
  })
  return Buffer.concat([header, ...images])
}

const outputs: [string, Buffer][] = [
  ['build/icon.ico', ico(ICO_SIZES)],
  ['build/icon.png', png(256)],
  ['src/assets/hamster.png', png(N)],
]
for (const [rel, data] of outputs) {
  const file = join(ROOT, rel)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, data)
  console.log(`${rel}  ${data.length} B`)
}
