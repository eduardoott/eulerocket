// Renders preview PNGs of every ship from the real scene into docs/img/.
// Run from the repo root: bun tools/preview.ts
// Writes ship-<kind>.png, all-ships.png and working.png; no dependencies beyond node:zlib.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { eulerocket, SHIP_KINDS, type ShipKind } from '../hooks/rocket'

const W = 160, H = 32, SCALE = 4, RECEDE = 0.6, BLUR = 0.25
const OUT = join(import.meta.dir, '..', 'docs', 'img')

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** Encodes 0xRRGGBB pixels as an 8-bit RGB PNG, nearest-neighbour upscaled by `scale`. */
function encodePng(px: Uint32Array, w: number, h: number, scale = 1): Uint8Array {
  const ow = w * scale, oh = h * scale, stride = ow * 3 + 1
  const raw = new Uint8Array(stride * oh)
  for (let y = 0; y < oh; y++) {
    const row = y * stride // filter byte 0 (none) left in place
    const sy = Math.floor(y / scale)
    for (let x = 0; x < ow; x++) {
      const p = px[sy * w + Math.floor(x / scale)]
      const o = row + 1 + x * 3
      raw[o] = (p >>> 16) & 0xff
      raw[o + 1] = (p >>> 8) & 0xff
      raw[o + 2] = p & 0xff
    }
  }
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, ow)
  dv.setUint32(4, oh)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

function idle(kind: ShipKind): Uint32Array {
  return eulerocket(W, H, kind, RECEDE, BLUR)({ t: 1000, energy: 0, flash: null })
}

function save(name: string, px: Uint32Array, w: number, h: number) {
  const file = join(OUT, name)
  writeFileSync(file, encodePng(px, w, h, SCALE))
  console.log(`${name.padEnd(20)} ${(statSync(file).size / 1024).toFixed(1)} KB`)
}

mkdirSync(OUT, { recursive: true })

const all = new Uint32Array(W * H * SHIP_KINDS.length)
SHIP_KINDS.forEach((kind, i) => {
  const px = idle(kind)
  save(`ship-${kind}.png`, px, W, H)
  all.set(px, i * W * H)
})
save('all-ships.png', all, W, H * SHIP_KINDS.length)

const work = eulerocket(W, H, 'scifi', RECEDE, BLUR)
let frame = new Uint32Array(0)
for (let i = 0; i < 250; i++) frame = work({ t: 1000 + i * 33, energy: 1, flash: null })
save('working.png', frame, W, H)
