/**
 * Ship contract: a sprite flies right; `anchorY` is the sprite row on the scene's centre row, and
 * hullTop/hullBot and each nozzle's top/bot are rows relative to it. `nozzleX` is the column the
 * flames leave from (leftwards), one flame per nozzle. Alpha is 1 wherever the ship is. The scene
 * draws the flame, the exhaust line, the receding and the finish glow.
 */

export type Rgb = readonly [number, number, number]

export class Canvas {
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

/** A canvas that also records alpha: every `set` pixel becomes opaque. */
export class Sprite extends Canvas {
  readonly alpha: Float32Array
  constructor(w: number, h: number) { super(w, h); this.alpha = new Float32Array(w * h) }
  set(x: number, y: number, col: Rgb) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    super.set(x, y, col)
    this.alpha[y * this.w + x] = 1
  }
}

/** A ship drawn at native size: RGB and alpha per pixel (see the contract above). */
export interface Ship {
  w: number; h: number
  px: Float32Array; alpha: Float32Array
  anchorY: number; hullTop: number; hullBot: number; nozzleX: number
  nozzles: { top: number; bot: number }[]
}

/** small: band under 8 px tall; medium: 8 to 15; large: 16 and up (ship up to 14 x ~52 px). */
export type ShipTier = 'small' | 'medium' | 'large'
export type ShipDrawer = (tier: ShipTier, t: number) => Ship

export const lerp = (a: Rgb, b: Rgb, k: number): Rgb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
export const smooth = (k: number) => k * k * (3 - 2 * k)
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export const HULL: Rgb = [222, 226, 236], HULL_LIT: Rgb = [250, 251, 255], HULL_DARK: Rgb = [120, 124, 150]
export const TRIM: Rgb = [92, 44, 156], TRIM_LIT: Rgb = [138, 88, 206], TRIM_DARK: Rgb = [52, 22, 96], INK: Rgb = [40, 18, 84]
export const STEEL: Rgb = [84, 88, 104]
export const FLAME: Rgb[] = [[255, 255, 255], [170, 225, 255], [90, 160, 255], [60, 90, 230]]
export const FLAME_GLOW: Rgb = [120, 180, 255]
export const TILE: Rgb = [38, 40, 50], TILE_LIT: Rgb = [60, 62, 74], WINDOW: Rgb = [30, 40, 72], WING: Rgb = [190, 194, 206]
export const BELL: Rgb = [128, 132, 150]

/** 4 rows, 3 wide. */
export const GLYPHS: Record<string, readonly string[]> = {
  E: ['###', '##.', '#..', '###'],
  U: ['#.#', '#.#', '#.#', '###'],
  L: ['#..', '#..', '#..', '###'],
  R: ['##.', '#.#', '##.', '#.#'],
}

/** 5 rows, 4 wide, for large ships. */
export const GLYPHS_BIG: Record<string, readonly string[]> = {
  E: ['####', '#...', '###.', '#...', '####'],
  U: ['#..#', '#..#', '#..#', '#..#', '.##.'],
  L: ['#...', '#...', '#...', '#...', '####'],
  R: ['###.', '#..#', '###.', '#.#.', '#..#'],
}

/**
 * Write `text` with its top-left at (x, y): GLYPHS (3 wide, 4 tall) or, when `big`, GLYPHS_BIG
 * (4 wide, 5 tall), with a 1-column gap. Characters without a glyph leave a blank cell.
 * Returns the x just past the last cell's gap.
 */
export function letter(s: Sprite, text: string, x: number, y: number, col: Rgb, big: boolean): number {
  const set = big ? GLYPHS_BIG : GLYPHS
  const gw = big ? 4 : 3, gh = big ? 5 : 4
  for (const ch of text) {
    const g = set[ch]
    if (g) for (let r = 0; r < gh; r++) for (let k = 0; k < gw; k++) if (g[r][k] === '#') s.set(x + k, y + r, col)
    x += gw + 1
  }
  return x
}
