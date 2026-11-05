/**
 * The scene: parallax stars and a faint nebula, with a rocket marked EULER flying right. While Claude
 * works the stars streak into warp and the rocket's blue flame stretches; a finished turn flashes.
 *
 * A renderer is made for one size and called once per frame with `energy` from 0 (idle) to 1
 * (working) and `flash`: ms since a turn finished, or null.
 */
import { hash } from './effects'

export interface SceneInput { t: number; energy: number; flash: number | null }
export type Renderer = (input: SceneInput) => Uint32Array

/** How long the finish flourish lasts, in ms. */
export const FLASH_MS = 900

type Rgb = readonly [number, number, number]

class Canvas {
  readonly buf: Float32Array
  constructor(readonly w: number, readonly h: number) { this.buf = new Float32Array(w * h * 3) }
  set(x: number, y: number, c: Rgb) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const o = (y * this.w + x) * 3
    this.buf[o] = c[0]; this.buf[o + 1] = c[1]; this.buf[o + 2] = c[2]
  }
  /** Blend toward `c` by `k`. */
  mix(x: number, y: number, c: Rgb, k: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || k <= 0) return
    if (k > 1) k = 1
    const o = (y * this.w + x) * 3
    this.buf[o] += (c[0] - this.buf[o]) * k
    this.buf[o + 1] += (c[1] - this.buf[o + 1]) * k
    this.buf[o + 2] += (c[2] - this.buf[o + 2]) * k
  }
  get(x: number, y: number): Rgb {
    x = Math.min(this.w - 1, Math.max(0, x)); y = Math.min(this.h - 1, Math.max(0, y))
    const o = (y * this.w + x) * 3
    return [this.buf[o], this.buf[o + 1], this.buf[o + 2]]
  }
  pack(): Uint32Array {
    const out = new Uint32Array(this.w * this.h)
    const c = (v: number) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v))
    for (let i = 0; i < out.length; i++) {
      out[i] = ((c(this.buf[i * 3]) << 16) | (c(this.buf[i * 3 + 1]) << 8) | c(this.buf[i * 3 + 2])) >>> 0
    }
    return out
  }
}

const lerp = (a: Rgb, b: Rgb, k: number): Rgb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
const smooth = (k: number) => k * k * (3 - 2 * k)
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Smooth value noise in [0, 1). */
function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = smooth(x - ix), fy = smooth(y - iy)
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed)
  const c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

/** A finished-turn pulse: 1 right at the finish, fading to 0 over FLASH_MS. */
const pulse = (flash: number | null) => (flash === null || flash >= FLASH_MS ? 0 : (1 - flash / FLASH_MS) ** 2)

export function eulerocket(w: number, h: number): Renderer {
  const layers = [
    { density: 0.03, speed: 1.2, bright: 0.45 },
    { density: 0.014, speed: 3.5, bright: 0.75 },
    { density: 0.006, speed: 9, bright: 1 },
  ]
  const TINTS: Rgb[] = [[255, 255, 255], [190, 210, 255], [255, 236, 200], [255, 200, 200]]
  let warp = 0 // eased separately so stars stretch smoothly

  return ({ t, energy, flash }) => {
    const c = new Canvas(w, h)
    warp += (energy - warp) * 0.15
    // deep space with a faint nebula
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        c.set(x, y, lerp([3, 3, 12], [9, 6, 22], y / h))
        const n = noise(x * 0.05 + t * 0.00005, y * 0.12, 61)
        const m = noise(x * 0.09, y * 0.2 + t * 0.00003, 63)
        c.mix(x, y, [70, 30, 100], smooth(clamp01((n - 0.55) / 0.4)) * 0.45)
        c.mix(x, y, [20, 70, 110], smooth(clamp01((m - 0.6) / 0.4)) * 0.35)
      }
    }
    // stars: each layer drifts left at its own speed; at warp they streak
    const mult = 1 + warp * 30
    layers.forEach((L, li) => {
      const n = Math.max(1, Math.floor(w * h * L.density))
      const len = Math.min(w / 2, L.speed * mult * 0.12)
      for (let i = 0; i < n; i++) {
        const span = w + len + 2
        const x = ((hash(i, li, 71) * span - (t / 1000) * L.speed * mult) % span + span) % span - 1
        const y = Math.floor(hash(i, li, 73) * h)
        const tw = li === 0 ? 0.55 + 0.45 * Math.sin(t / 400 + i * 1.7) : 1
        const tint = TINTS[Math.floor(hash(i, li, 75) * TINTS.length)]
        const k = L.bright * tw
        c.mix(Math.floor(x), y, tint, k)
        for (let s = 1; s <= len; s++) c.mix(Math.floor(x) + s, y, tint, k * (1 - s / (len + 1)) * 0.8)
      }
    })
    // a shooting star every so often
    const SLOT = 7000, s = Math.floor(t / SLOT)
    if (hash(s, 0, 77) < 0.5) {
      const dt = t - s * SLOT - hash(s, 1, 77) * 5000
      if (dt > 0 && dt < 500) {
        const sx = hash(s, 2, 77) * w * 0.7 + (dt / 500) * w * 0.3, sy = hash(s, 3, 77) * h * 0.4 + (dt / 500) * h * 0.3
        for (let k = 0; k < 5; k++) c.mix(Math.floor(sx - k), Math.floor(sy - k * 0.5), [255, 255, 255], 0.9 - k * 0.18)
      }
    }
    const f = pulse(flash)
    rocket(c, t, warp, f)
    // finish: a hyperspace flash
    if (f > 0) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) c.mix(x, y, [210, 225, 255], f * 0.4)
    return c.pack()
  }
}

const GLYPHS: Record<string, readonly string[]> = {
  E: ['###', '##.', '#..', '###'],
  U: ['#.#', '#.#', '#.#', '###'],
  L: ['#..', '#..', '#..', '###'],
  R: ['##.', '#.#', '##.', '#.#'],
}
const HULL: Rgb = [222, 226, 236], HULL_LIT: Rgb = [250, 251, 255], HULL_DARK: Rgb = [120, 124, 150]
const TRIM: Rgb = [92, 44, 156], TRIM_LIT: Rgb = [138, 88, 206], TRIM_DARK: Rgb = [52, 22, 96], INK: Rgb = [40, 18, 84]
const STEEL: Rgb = [84, 88, 104]
const FLAME: Rgb[] = [[255, 255, 255], [170, 225, 255], [90, 160, 255], [60, 90, 230]]
const FLAME_GLOW: Rgb = [120, 180, 255]

/**
 * A rocket flying right, a little past the middle, EULER on its side. It edges forward and
 * its blue flame stretches with warp; a finish adds a burst. Tall bands get the lettering.
 */
function rocket(c: Canvas, t: number, warp: number, f: number) {
  const { w, h } = c
  const lettered = h >= 8
  // hull rows relative to cy: a one-pixel rim round four rows of lettering, or a plain three-row hull
  const top = lettered ? -3 : -1, bot = lettered ? 2 : 1
  const mid = (top + bot) / 2, hf = (bot - top) / 2
  const bodyLen = lettered ? 23 : 8
  const noseLen = lettered ? 5 : 3
  const cy = Math.round(h * 0.5 + Math.sin(t / 900) * 0.6 + (warp > 0.5 ? Math.sin(t / 37) * 0.4 : 0))
  const tail = Math.round(w * 0.74 - (bodyLen + noseLen) / 2 + warp * w * 0.05)
  const bx = tail + 1 // the body starts after a one-pixel nozzle
  // flame: wide and bright at the nozzle, thinning to a point, then one thin line of exhaust that
  // runs back to the band's edge; it stretches with warp and bursts on a finish
  const len = 6 + hf * 2 + warp * (14 + hf * 4) + f * 12 + Math.sin(t / 60) * 1.2 + hash(Math.floor(t / 80), 0, 911) * 1.5
  const line = Math.round(cy + mid)
  for (let x = tail - Math.round(len); x >= 0; x--) {
    const u = (tail - len - x) / Math.max(1, tail - len)
    const k = (0.55 + warp * 0.25) * (1 - u) ** 1.4 * (0.85 + 0.15 * Math.sin(t / 90 + x * 0.7))
    c.mix(x, line, FLAME[1], k)
  }
  for (let k = 1; k <= len + 3; k++) {
    const u = Math.min(1, k / len)
    for (let dy = top; dy <= bot; dy++) c.mix(tail - k, cy + dy, FLAME_GLOW, 0.3 * (1 - u) * (1 - Math.abs(dy - mid) / (hf + 1)))
  }
  for (let k = 1; k <= len; k++) {
    const u = k / len
    const reach = (hf - 0.5) * (1 - u) ** 0.8
    for (let dy = top + 1; dy <= bot - 1; dy++) {
      const d = Math.abs(dy - mid)
      if (d > reach + 0.5 && !(d <= 0.5)) continue
      const core = d <= reach - 0.5 || d <= 0.5
      const col = FLAME[Math.min(FLAME.length - 1, Math.floor(u * (FLAME.length - 1)) + (core ? 0 : 1))]
      c.mix(tail - k, cy + dy, col, core ? 1 - u * 0.4 : 0.75 * (1 - u * 0.6))
    }
  }
  for (let dy = top + 1; dy <= bot - 1; dy++) c.set(tail, cy + dy, STEEL)
  // fins: small and swept back past the tail, one above and one below
  const finLen = lettered ? 5 : 3
  for (let k = 0; k < finLen; k++) {
    const reach = Math.max(1, Math.round((1 - k / finLen) * (lettered ? 2 : 1)))
    for (let r = 1; r <= reach; r++) {
      c.set(bx - 1 + k, cy + top - r, r === reach ? TRIM_LIT : TRIM)
      c.set(bx - 1 + k, cy + bot + r, r === reach ? TRIM_DARK : TRIM)
    }
  }
  // hull: lit along the top, shaded along the bottom, a purple band by the tail
  for (let x = bx; x < bx + bodyLen; x++) {
    const band = x - bx === 1
    for (let dy = top; dy <= bot; dy++) {
      // light rims keep the dark lettering clear of the hull's edges
      let col: Rgb = dy === top ? HULL_LIT : dy === bot ? lerp(HULL, HULL_DARK, 0.45) : HULL
      if (band) col = dy === top ? TRIM_LIT : dy === bot ? TRIM_DARK : TRIM
      c.set(x, cy + dy, col)
    }
  }
  // nose cone, rounded, with a highlight along its upper edge
  for (let k = 0; k < noseLen; k++) {
    const reach = hf * Math.sqrt(1 - (k / noseLen) ** 1.6) + 0.01
    const rows: number[] = []
    for (let dy = top; dy <= bot; dy++) if (Math.abs(dy - mid) <= reach) rows.push(dy)
    rows.forEach((dy, i) => c.set(bx + bodyLen + k, cy + dy, i === 0 ? TRIM_LIT : i === rows.length - 1 ? TRIM_DARK : TRIM))
  }
  if (!lettered) return
  let gx = bx + 3
  for (const ch of 'EULER') {
    const g = GLYPHS[ch]
    for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) if (g[r][k] === '#') c.set(gx + k, cy + top + 1 + r, INK)
    gx += 4
  }
}

