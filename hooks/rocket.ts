/**
 * The scene: parallax stars and a faint nebula, with a rocket marked EULER flying right. While Claude
 * works the stars streak into warp, the rocket recedes (shrinks to ~70%) and its blue flame stretches;
 * a finished turn makes the ship glow, with a halo, a lightened hull and a few sparkles. A space
 * shuttle can fly instead (see SHIPS).
 *
 * A renderer is made for one size and called once per frame with `energy` from 0 (idle) to 1
 * (working) and `flash`: ms since a turn finished, or null.
 */
import { hash } from './effects'
import {
  type Rgb, type Ship, type ShipDrawer, type ShipTier, Canvas, Sprite, lerp, smooth, clamp01, letter,
  HULL, HULL_LIT, HULL_DARK, TRIM, TRIM_LIT, TRIM_DARK, INK, STEEL, FLAME, FLAME_GLOW, TILE, TILE_LIT, WINDOW, WING, BELL,
} from './ship-kit'
import { retroSprite } from './ships/retro'
import { stagedSprite } from './ships/staged'
import { scifiSprite } from './ships/scifi'

export type { Ship, ShipDrawer, ShipTier } from './ship-kit'

export interface SceneInput { t: number; energy: number; flash: number | null }
export type Renderer = (input: SceneInput) => Uint32Array

/** How long the finish flourish lasts, in ms. */
export const FLASH_MS = 900

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

export function eulerocket(w: number, h: number, kind: ShipKind = 'rocket', recede = 0.3, blur = 1): Renderer {
  const layers = [
    { density: 0.03, speed: 1.2, bright: 0.45 },
    { density: 0.014, speed: 3.5, bright: 0.75 },
    { density: 0.006, speed: 9, bright: 1 },
  ]
  const TINTS: Rgb[] = [[255, 255, 255], [190, 210, 255], [255, 236, 200], [255, 200, 200]]
  let warp = 0 // eased separately so stars stretch smoothly
  const zoom: Zoom = { width: 0 }

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
    rocket(c, t, warp, pulse(flash), zoom, kind, recede, blur)
    return c.pack()
  }
}

/** Which ships can fly, in menu order; another design is another entry here and in SHIPS. */
export const SHIP_KINDS = ['rocket', 'shuttle', 'retro', 'staged', 'scifi'] as const
export type ShipKind = (typeof SHIP_KINDS)[number]

export const SHIP_LABELS: Record<ShipKind, string> = {
  rocket: 'Classic rocket', shuttle: 'Space shuttle', retro: 'Retro rocket', staged: 'Staged rocket', scifi: 'Starship',
}

/** The size tier for a scene `h` pixels tall (the full scene, not the visible slice). */
export function shipTier(h: number): ShipTier {
  return h >= 16 ? 'large' : h >= 8 ? 'medium' : 'small'
}

/** The EULER rocket: nozzle, swept fins, a hull with a purple band, a rounded nose, the lettering. */
function rocketSprite(tier: ShipTier): Ship {
  const lettered = tier !== 'small' // 'large' draws like 'medium' for now
  // hull rows relative to the centre row: a one-pixel rim round four rows of lettering, or a plain three-row hull
  const top = lettered ? -3 : -1, bot = lettered ? 2 : 1
  const mid = (top + bot) / 2, hf = (bot - top) / 2
  const bodyLen = lettered ? 23 : 8
  const noseLen = lettered ? 5 : 3
  const finLen = lettered ? 5 : 3, finMax = lettered ? 2 : 1
  const s = new Sprite(1 + bodyLen + noseLen, bot - top + 1 + 2 * finMax)
  const cy = finMax - top
  const tail = 0, bx = 1 // the body starts after a one-pixel nozzle
  for (let dy = top + 1; dy <= bot - 1; dy++) s.set(tail, cy + dy, STEEL)
  // fins: small and swept back past the tail, one above and one below
  for (let k = 0; k < finLen; k++) {
    const reach = Math.max(1, Math.round((1 - k / finLen) * finMax))
    for (let r = 1; r <= reach; r++) {
      s.set(bx - 1 + k, cy + top - r, r === reach ? TRIM_LIT : TRIM)
      s.set(bx - 1 + k, cy + bot + r, r === reach ? TRIM_DARK : TRIM)
    }
  }
  // hull: lit along the top, shaded along the bottom, a purple band by the tail
  for (let x = bx; x < bx + bodyLen; x++) {
    const band = x - bx === 1
    for (let dy = top; dy <= bot; dy++) {
      // light rims keep the dark lettering clear of the hull's edges
      let col: Rgb = dy === top ? HULL_LIT : dy === bot ? lerp(HULL, HULL_DARK, 0.45) : HULL
      if (band) col = dy === top ? TRIM_LIT : dy === bot ? TRIM_DARK : TRIM
      s.set(x, cy + dy, col)
    }
  }
  // nose cone, rounded, with a highlight along its upper edge
  for (let k = 0; k < noseLen; k++) {
    const reach = hf * Math.sqrt(1 - (k / noseLen) ** 1.6) + 0.01
    const rows: number[] = []
    for (let dy = top; dy <= bot; dy++) if (Math.abs(dy - mid) <= reach) rows.push(dy)
    rows.forEach((dy, i) => s.set(bx + bodyLen + k, cy + dy, i === 0 ? TRIM_LIT : i === rows.length - 1 ? TRIM_DARK : TRIM))
  }
  if (lettered) letter(s, 'EULER', bx + 3, cy + top + 1, INK, false)
  return { w: s.w, h: s.h, px: s.buf, alpha: s.alpha, anchorY: cy, hullTop: top, hullBot: bot, nozzleX: tail, nozzles: [{ top, bot }] }
}

/**
 * The space shuttle: white on top, black heat-shield tiles underneath, a delta wing, a tall swept
 * tail fin with a purple leading edge, three engines (one when small), a cockpit and the lettering.
 */
function shuttleSprite(tier: ShipTier): Ship {
  const lettered = tier !== 'small' // 'large' draws like 'medium' for now
  const top = lettered ? -3 : -1, bot = lettered ? 2 : 1
  const mid = (top + bot) / 2
  const nozzleLen = lettered ? 2 : 1, bodyLen = lettered ? 24 : 9
  const finRows = lettered ? 3 : 2, wingRows = lettered ? 2 : 1
  // the nose profile, column by column from the body: [first row, last row] relative to the centre
  const nose: [number, number][] = lettered ? [[-2, 2], [-1, 2], [0, 1]] : [[0, 1], [1, 1]]
  const s = new Sprite(nozzleLen + bodyLen + nose.length, bot - top + 1 + finRows + wingRows)
  const cy = finRows - top
  const bx = nozzleLen, nx = bx + bodyLen
  // engines: a bell and a throat per nozzle; between them the aft bulkhead
  const jets = lettered ? [-2, 0, 2] : [0]
  if (lettered) for (let dy = top; dy <= bot; dy++) s.set(1, cy + dy, HULL_DARK)
  for (const dy of jets) {
    s.set(0, cy + dy, BELL)
    if (lettered) s.set(1, cy + dy, STEEL)
  }
  // fuselage: lit along the top, tiles along the belly
  for (let x = bx; x < nx; x++) {
    for (let dy = top; dy <= bot; dy++) s.set(x, cy + dy, dy === top ? HULL_LIT : dy === bot ? TILE : HULL)
  }
  // blunt nose: white above the centre, tiles below, a lighter tile at the tip
  nose.forEach(([a, b], k) => {
    for (let dy = a; dy <= b; dy++) {
      const under = dy > mid
      s.set(nx + k, cy + dy, under ? (k === nose.length - 1 ? TILE_LIT : TILE) : dy === a ? HULL_LIT : HULL)
    }
  })
  // cockpit windows just behind the nose
  const panes: [number, number][] = lettered ? [[nx - 2, -2], [nx - 1, -2], [nx, -1]] : [[nx - 1, -1]]
  for (const [x, dy] of panes) s.set(x, cy + dy, WINDOW)
  // tail fin: tallest at the tail, its leading edge sloping down toward the nose
  for (let r = 1; r <= finRows; r++) {
    const reach = lettered ? 6 - (r - 1) * 2 : 3 - r
    // two purple pixels per lettered row keep the stepped leading edge one unbroken line
    for (let k = 0; k < reach; k++) s.set(bx + k, cy + top - r, k >= reach - (lettered ? 2 : 1) ? TRIM : HULL)
  }
  // delta wing under the fuselage, about 40 to 85% of the body back from the nose
  const front = nx - 1 - Math.round(bodyLen * 0.4), back = nx - 1 - Math.round(bodyLen * 0.85)
  for (let r = 1; r <= wingRows; r++) {
    const edge = Math.round(front - (front - back) * (r - 1) / wingRows)
    for (let x = back; x <= edge; x++) s.set(x, cy + bot + r, r === wingRows && lettered ? TILE_LIT : x === edge ? HULL_LIT : WING)
  }
  if (lettered) letter(s, 'EULER', bx + 1, cy + top + 1, INK, false)
  return {
    w: s.w, h: s.h, px: s.buf, alpha: s.alpha, anchorY: cy, hullTop: top, hullBot: bot, nozzleX: 0,
    nozzles: jets.map((dy) => ({ top: dy, bot: dy })),
  }
}

const SHIPS: Record<ShipKind, ShipDrawer> = {
  rocket: rocketSprite, shuttle: shuttleSprite, retro: retroSprite, staged: stagedSprite, scifi: scifiSprite,
}

export function drawShip(kind: ShipKind, tier: ShipTier, t: number): Ship {
  return SHIPS[kind](tier, t)
}

/** The ship's current width in pixels, kept between frames so the scale only moves in whole steps. */
interface Zoom { width: number }

/**
 * Draw `ship` scaled by `s` with its left edge at column `x0` and its top edge at row `y0` (may be
 * fractional). Each scene pixel takes the alpha-weighted average of the sprite area it covers, so
 * a shrunken ship softens at the edges instead of flickering. `blur` (0..1) mixes that average with
 * the crisp nearest sprite pixel: 1 is fully averaged, 0 fully crisp. Coverage goes into `cov`.
 */
function composite(c: Canvas, ship: Ship, x0: number, y0: number, s: number, cov: Float32Array, blur = 1) {
  const spans = (from: number, n: number, size: number) => {
    const out: { at: number; src: number[]; wt: number[] }[] = []
    for (let d = Math.floor(from); d < Math.ceil(from + n * s); d++) {
      const a = (d - from) / s, b = (d + 1 - from) / s
      const src: number[] = [], wt: number[] = []
      for (let i = Math.max(0, Math.floor(a)); i < Math.min(size, Math.ceil(b)); i++) {
        const o = Math.min(b, i + 1) - Math.max(a, i)
        if (o > 0) { src.push(i); wt.push(o * s) }
      }
      out.push({ at: d, src, wt })
    }
    return out
  }
  const xs = spans(x0, ship.w, ship.w), ys = spans(y0, ship.h, ship.h)
  for (const Y of ys) {
    if (Y.at < 0 || Y.at >= c.h) continue
    for (const X of xs) {
      if (X.at < 0 || X.at >= c.w) continue
      let a = 0, r = 0, g = 0, b = 0
      for (let j = 0; j < Y.src.length; j++) {
        for (let i = 0; i < X.src.length; i++) {
          const p = Y.src[j] * ship.w + X.src[i]
          const k = Y.wt[j] * X.wt[i] * ship.alpha[p]
          if (k <= 0) continue
          a += k; r += k * ship.px[p * 3]; g += k * ship.px[p * 3 + 1]; b += k * ship.px[p * 3 + 2]
        }
      }
      if (a <= 0) continue
      let col: Rgb = [r / a, g / a, b / a]
      if (blur < 1) {
        const sx = Math.floor((X.at + 0.5 - x0) / s), sy = Math.floor((Y.at + 0.5 - y0) / s)
        const p = sx >= 0 && sy >= 0 && sx < ship.w && sy < ship.h ? sy * ship.w + sx : -1
        const na = p >= 0 ? ship.alpha[p] : 0
        if (na > 0) col = lerp([ship.px[p * 3], ship.px[p * 3 + 1], ship.px[p * 3 + 2]], col, blur)
        a = na + (Math.min(1, a) - na) * blur
        if (a <= 0) continue
      }
      if (a >= 1 - 1e-6) { a = 1; c.set(X.at, Y.at, col) } else c.mix(X.at, Y.at, col, a)
      cov[Y.at * c.w + X.at] = a
    }
  }
}

const GLOW: Rgb = [210, 225, 255], WHITE: Rgb = [255, 255, 255]

/**
 * A ship flying right, a little past the middle. While working it edges forward, recedes (by `recede`,
 * a fraction of its size) and its blue flame stretches; a finish makes the ship glow and adds a burst to the
 * flame. Tall bands get the lettering.
 */
function rocket(c: Canvas, t: number, warp: number, f: number, zoom: Zoom, kind: ShipKind = 'rocket', recede = 0.3, blur = 1) {
  const { w, h } = c
  const ship = drawShip(kind, shipTier(h), t)
  const { hullTop: top, hullBot: bot } = ship
  const mid = (top + bot) / 2, hf = (bot - top) / 2
  const cy = Math.round(h * 0.5 + Math.sin(t / 900) * 0.6 + (warp > 0.5 ? Math.sin(t / 37) * 0.4 : 0))
  // the shrink pivots on the nose, so the right edge is left + ship.w - 1 at any scale; keep it 2 px in
  const left = Math.min(Math.round(w * 0.74 - (ship.w - 1) / 2 + warp * w * 0.05), w - 3 - (ship.w - 1))
  // whole-pixel width steps with a dead band, so a settled warp never flips between two sizes
  const want = (1 - recede * warp) * ship.w
  if (zoom.width < 1 || zoom.width > ship.w || Math.abs(want - zoom.width) > 0.6) zoom.width = Math.min(ship.w, Math.max(1, Math.round(want)))
  const s = zoom.width / ship.w
  // shrink about the nose and the hull's vertical centre
  const x0 = left + ship.w - zoom.width
  const yc = cy + mid // hull centre, in row-index terms
  const y0 = yc + 0.5 - (ship.anchorY + mid + 0.5) * s
  const tail = Math.round(x0 + ship.nozzleX * s)
  const hs = hf * s
  // flame: wide and bright at the nozzle, thinning to a point, then one thin line of exhaust that
  // runs back to the band's edge; it stretches with warp and bursts on a finish
  const len = 6 + hf * 2 + warp * (14 + hf * 4) + f * 12 + Math.sin(t / 60) * 1.2 + hash(Math.floor(t / 80), 0, 911) * 1.5
  const line = Math.round(yc)
  for (let x = tail - Math.round(len); x >= 0; x--) {
    const u = (tail - len - x) / Math.max(1, tail - len)
    const k = (0.55 + warp * 0.25) * (1 - u) ** 1.4 * (0.85 + 0.15 * Math.sin(t / 90 + x * 0.7))
    c.mix(x, line, FLAME[1], k)
  }
  const EPS = 1e-9
  // each nozzle's own centre and half-height, scaled about the hull centre like the sprite
  const jets = ship.nozzles.map((n) => ({ yc: yc + ((n.top + n.bot) / 2 - mid) * s, hs: ((n.bot - n.top) / 2) * s }))
  // all glows before any core, so a neighbour's glow never washes over a white core
  for (const { yc, hs } of jets) {
    for (let k = 1; k <= len + 3; k++) {
      const u = Math.min(1, k / len)
      for (let y = Math.ceil(yc - hs - EPS); y <= Math.floor(yc + hs + EPS); y++) {
        c.mix(tail - k, y, FLAME_GLOW, 0.3 * (1 - u) * (1 - Math.abs(y - yc) / (hs + 1)))
      }
    }
  }
  for (const { yc, hs } of jets) {
    const inner = Math.max(0.5, hs - 1)
    for (let k = 1; k <= len; k++) {
      const u = k / len
      const reach = (hs - 0.5) * (1 - u) ** 0.8
      for (let y = Math.ceil(yc - inner - EPS); y <= Math.floor(yc + inner + EPS); y++) {
        const d = Math.abs(y - yc)
        if (d > reach + 0.5 && !(d <= 0.5)) continue
        const core = d <= reach - 0.5 || d <= 0.5
        const col = FLAME[Math.min(FLAME.length - 1, Math.floor(u * (FLAME.length - 1)) + (core ? 0 : 1))]
        c.mix(tail - k, y, col, core ? 1 - u * 0.4 : 0.75 * (1 - u * 0.6))
      }
    }
  }
  const cov = new Float32Array(w * h)
  composite(c, ship, x0, y0, s, cov, blur)
  if (f > 0) glow(c, cov, t, f, x0, Math.floor(y0), zoom.width, Math.ceil(y0 + ship.h * s))
}

/**
 * The finish, on the ship alone: a halo hugging the silhouette (strong at 1px, faint at 2px), the
 * hull lightened toward white, and a few sparkles that twinkle on or just beside it.
 */
function glow(c: Canvas, cov: Float32Array, t: number, f: number, x0: number, y0: number, sw: number, y1: number) {
  const { w, h } = c
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : cov[y * w + x])
  const near = (x: number, y: number, r: number) => {
    let m = 0
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) m = Math.max(m, at(x + dx, y + dy))
    return m
  }
  for (let y = y0 - 2; y < y1 + 2; y++) {
    for (let x = x0 - 2; x < x0 + sw + 2; x++) {
      const own = at(x, y)
      if (own < 1) c.mix(x, y, GLOW, Math.max(0.9 * near(x, y, 1), 0.45 * near(x, y, 2)) * f * (1 - own))
      if (own > 0) c.mix(x, y, WHITE, 0.45 * f * own)
    }
  }
  const tick = Math.floor(t / 80)
  const n = 2 + Math.floor(hash(tick, 0, 919) * 3)
  for (let i = 0; i < n; i++) {
    if (hash(tick, i + 1, 921) >= f) continue
    for (let tries = 0; tries < 8; tries++) {
      const x = x0 - 1 + Math.floor(hash(tick, i * 8 + tries, 923) * (sw + 2))
      const y = y0 - 1 + Math.floor(hash(tick, i * 8 + tries, 925) * (y1 - y0 + 2))
      if (near(x, y, 1) < 0.5) continue
      c.mix(x, y, WHITE, 1)
      break
    }
  }
}
