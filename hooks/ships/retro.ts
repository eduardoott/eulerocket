/**
 * The retro rocket: a 1950s pulp cigar with a pointed purple nose, a brass porthole, pinstripes,
 * rivets and three big swept fins (one up, one down, one face-on as a dark band at the tail).
 */
import {
  type Rgb, type Ship, type ShipDrawer, type ShipTier, Sprite, lerp, clamp01, letter,
  TRIM, TRIM_LIT, TRIM_DARK, INK, STEEL, BELL,
} from '../ship-kit'

const CREAM_LIT: Rgb = [255, 252, 243], CREAM_HI: Rgb = [246, 239, 222], CREAM: Rgb = [230, 220, 198]
const CREAM_MID: Rgb = [200, 188, 170], CREAM_DARK: Rgb = [146, 134, 140]
const RIVET: Rgb = [150, 136, 126]
const BRASS: Rgb = [218, 176, 92], BRASS_DARK: Rgb = [140, 100, 52]
const GLASS: Rgb = [150, 208, 244], GLASS_DARK: Rgb = [78, 132, 196], GLINT: Rgb = [255, 255, 255]
const NOSE_SHINE: Rgb = lerp(TRIM_LIT, [255, 255, 255], 0.4)

/**
 * Per-tier layout. The hull runs from column x0 to x1 (exclusive) and is symmetric about the centre
 * row: half-height T rows at the tail, swelling to P at `peak` (0..1 along the hull), then tapering
 * to a one-pixel point. The purple cone starts at coneX.
 */
interface Spec {
  W: number; T: number; P: number; x0: number; x1: number; peak: number; coneX: number
  fin: [number, number][] // columns [from, to] of each fin row, outward from the tail's edge
  band: number[]
  bell: { x: number; half: number; col: Rgb }[]
  nozzleX: number; nozzle: { top: number; bot: number }
  port: { x: number; y: number; size: number } // top-left, relative to the centre row
  text?: { x: number; y: number; big: boolean }
  stripes: boolean; rivets?: { from: number; to: number }
}

const SPECS: Record<ShipTier, Spec> = {
  large: {
    W: 52, T: 2, P: 4.8, x0: 6, x1: 52, peak: 0.42, coneX: 42,
    fin: [[3, 13], [2, 12], [1, 10], [0, 5]], band: [8, 9],
    bell: [{ x: 4, half: 2, col: BELL }, { x: 5, half: 1, col: STEEL }],
    nozzleX: 4, nozzle: { top: -2, bot: 2 },
    port: { x: 37, y: -2, size: 5 }, text: { x: 12, y: -2, big: true },
    stripes: true, rivets: { from: 11, to: 41 },
  },
  medium: {
    W: 33, T: 1, P: 3, x0: 3, x1: 33, peak: 0.42, coneX: 28,
    fin: [[2, 9], [1, 7], [0, 4]], band: [],
    bell: [{ x: 2, half: 1, col: BELL }],
    nozzleX: 2, nozzle: { top: -1, bot: 1 },
    port: { x: 26, y: -1, size: 2 }, text: { x: 7, y: -2, big: false },
    stripes: false,
  },
  small: {
    W: 14, T: 0, P: 1.6, x0: 3, x1: 14, peak: 0.4, coneX: 10,
    fin: [[1, 3], [0, 1]], band: [],
    bell: [{ x: 2, half: 0, col: BELL }],
    nozzleX: 2, nozzle: { top: 0, bot: 0 },
    port: { x: 8, y: -1, size: 1 },
    stripes: false,
  },
}

export const retroSprite: ShipDrawer = (tier: ShipTier, _t: number): Ship => {
  const p = SPECS[tier]
  // half-height at a column's centre: a rounded shoulder behind the peak, a pointed ogive ahead of it
  const H = (x: number) => {
    const u = (x + 0.5 - p.x0) / (p.x1 - p.x0)
    if (u < p.peak) return p.T + (p.P - p.T) * Math.sin((Math.PI / 2) * (u / p.peak))
    return p.P * Math.cos((Math.PI / 2) * clamp01((u - p.peak) / (1 - p.peak))) ** 0.7
  }
  const inHull = (x: number, dy: number) => x >= p.x0 && x < p.x1 && Math.abs(dy) < H(x) + 0.5
  const top = -(p.T + p.fin.length)
  const s = new Sprite(p.W, 2 * (p.T + p.fin.length) + 1)
  const cy = -top

  // fins: a convex leading edge and a trailing edge swept back past the tail
  for (const sign of [-1, 1]) {
    p.fin.forEach(([from, to], q) => {
      const outer = q + 1 < p.fin.length ? p.fin[q + 1][1] : from - 1
      for (let x = from; x <= to; x++) {
        const col = x > outer ? (sign < 0 ? NOSE_SHINE : TRIM_LIT) : x === from ? TRIM_DARK : sign < 0 ? lerp(TRIM, TRIM_LIT, 0.3) : TRIM
        s.set(x, cy + sign * (p.T + q + 1), col)
      }
    })
  }

  // nozzle bell, lit on top and shaded underneath
  for (const b of p.bell) {
    for (let dy = -b.half; dy <= b.half; dy++) {
      s.set(b.x, cy + dy, b.half && dy === -b.half ? lerp(b.col, CREAM_LIT, 0.35) : b.half && dy === b.half ? lerp(b.col, TRIM_DARK, 0.4) : b.col)
    }
  }

  // hull and cone: a rounded gradient from the profile's local top to its bottom
  for (let x = p.x0; x < p.x1; x++) {
    const h = H(x), cone = x >= p.coneX, band = p.band.includes(x)
    for (let dy = -Math.ceil(p.P); dy <= Math.ceil(p.P); dy++) {
      if (!inHull(x, dy)) continue
      const v = dy / (h + 0.5)
      const topEdge = !inHull(x, dy - 1), botEdge = !inHull(x, dy + 1)
      let col: Rgb
      if (band) col = topEdge ? TRIM : botEdge ? lerp(TRIM_DARK, [0, 0, 0], 0.35) : v < 0 ? lerp(TRIM, TRIM_DARK, 0.6) : TRIM_DARK
      else if (cone) col = topEdge ? TRIM_LIT : botEdge ? TRIM_DARK : v < -0.25 ? lerp(TRIM, TRIM_LIT, 0.45) : v < 0.35 ? TRIM : lerp(TRIM, TRIM_DARK, 0.5)
      else col = topEdge ? CREAM_LIT : botEdge ? CREAM_DARK : v < -0.4 ? CREAM_HI : v < 0.35 ? CREAM : CREAM_MID
      s.set(x, cy + dy, col)
    }
  }
  // a glint along the cone's upper flank
  if (tier !== 'small') {
    for (let x = p.coneX + 1; x < p.x1 - 2; x++) {
      const dy = -Math.round(H(x) * 0.5)
      if (dy < 0 && inHull(x, dy - 1)) s.set(x, cy + dy, NOSE_SHINE)
    }
  }

  // pinstripes that follow the hull's curve, from the tail band to the cone
  if (p.stripes) {
    for (let x = (p.band.at(-1) ?? p.x0) + 1; x < p.coneX; x++) {
      for (const sign of [-1, 1]) {
        const dy = sign * Math.round(H(x) * 0.8)
        if (Math.abs(dy) > 2 && inHull(x, dy - 1) && inHull(x, dy + 1)) s.set(x, cy + dy, sign < 0 ? TRIM_LIT : TRIM)
      }
    }
  }
  if (p.rivets) {
    for (let x = p.rivets.from; x <= p.rivets.to; x += 3) {
      const dy = Math.round(H(x) * 0.6)
      if (dy > 2 && dy < Math.round(H(x) * 0.8)) s.set(x, cy + dy, RIVET)
    }
  }

  // porthole: a brass ring round light-blue glass with a white glint
  const { x: px, y: py, size } = p.port
  if (size === 1) s.set(px, cy + py, GLASS)
  else if (size === 2) {
    s.set(px, cy + py, GLINT); s.set(px + 1, cy + py, GLASS)
    s.set(px, cy + py + 1, GLASS); s.set(px + 1, cy + py + 1, GLASS_DARK)
  } else {
    const r = (size - 1) / 2
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const dx = i - r, dyy = j - r
        if (Math.abs(dx) === r && Math.abs(dyy) === r) continue // rounded corners
        const ring = Math.abs(dx) === r || Math.abs(dyy) === r
        const col = ring ? (dx + dyy > 0 ? BRASS_DARK : BRASS) : dx + dyy > 0 ? GLASS_DARK : GLASS
        s.set(px + i, cy + py + j, col)
      }
    }
    s.set(px + 1, cy + py + 1, GLINT)
  }

  if (p.text) letter(s, 'EULER', p.text.x, cy + p.text.y, INK, p.text.big)

  return {
    w: s.w, h: s.h, px: s.buf, alpha: s.alpha, anchorY: cy, hullTop: -Math.round(p.P), hullBot: Math.round(p.P),
    nozzleX: p.nozzleX, nozzles: [p.nozzle],
  }
}
