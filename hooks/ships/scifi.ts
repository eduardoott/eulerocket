/**
 * An original wedge-hulled starship: a chiselled nose, faceted plating with panel seams, a glass
 * canopy toward the front, an engine pod above and below the stern on short pylons, purple accent
 * stripes, the lettering, and blinking navigation lights (red low, green high, a white nose strobe).
 */
import {
  type Rgb, type Ship, type ShipDrawer, type ShipTier, Sprite, lerp, letter,
  HULL, HULL_LIT, HULL_DARK, TRIM, TRIM_LIT, TRIM_DARK, INK, STEEL, BELL,
} from '../ship-kit'

const SHADE = lerp(HULL, HULL_DARK, 0.22), EDGE = lerp(HULL, HULL_DARK, 0.5), SEAM = lerp(HULL, HULL_DARK, 0.62)
const GLASS_LO: Rgb = [22, 92, 116], GLASS_HI: Rgb = [120, 224, 236], GLINT: Rgb = [255, 255, 255]
const RING: Rgb = [176, 232, 255], PYLON: Rgb = lerp(STEEL, HULL_DARK, 0.5)
const RED: Rgb = [255, 48, 48], RED_OFF: Rgb = [110, 30, 36]
const GREEN: Rgb = [70, 255, 110], GREEN_OFF: Rgb = [26, 96, 52]
const STROBE: Rgb = [255, 255, 255], STROBE_OFF: Rgb = [100, 104, 126]

/** Port/starboard lights: period 1200 ms, lit 40% of it. */
const navOn = (t: number) => ((t % 1200) + 1200) % 1200 < 480
/** Nose strobe: two 160 ms flashes every 2000 ms, so each spans at least two 80 ms frames. */
const strobeOn = (t: number) => { const p = ((t % 2000) + 2000) % 2000; return p < 160 || (p >= 320 && p < 480) }

/**
 * Cells are drawn as role characters first, then coloured in one pass, so shading can look at
 * neighbours: 'h' hull and 'o' pod casing take a lit top, a shaded underside and lit nose facets.
 */
class Grid {
  readonly c: string[][]
  constructor(readonly w: number, readonly h: number) { this.c = Array.from({ length: h }, () => Array(w).fill('.')) }
  put(x: number, y: number, ch: string) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.c[y][x] = ch }
  at(x: number, y: number) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.c[y][x] : '.' }
  run(x0: number, x1: number, y: number, ch: string) { for (let x = x0; x <= x1; x++) this.put(x, y, ch) }
}

const solid = (ch: string) => ch === 'h' || ch === 'o' || ch === '|' || ch === 'p' || ch === 'P' || ch === 'q'

function colour(g: Grid, cy: number, t: number): Sprite {
  const s = new Sprite(g.w, g.h)
  const nav = navOn(t), strobe = strobeOn(t)
  // glass spans its own rows: darker low and aft, lighter high and forward
  let gy0 = g.h, gy1 = -1, gx0 = g.w, gx1 = -1
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.c[y][x] === 'g') { gy0 = Math.min(gy0, y); gy1 = Math.max(gy1, y); gx0 = Math.min(gx0, x); gx1 = Math.max(gx1, x) }
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const ch = g.c[y][x]
      let col: Rgb | null = null
      if (ch === 'h' || ch === 'o') {
        const up = solid(g.at(x, y - 1)), down = solid(g.at(x, y + 1))
        if (!up || !solid(g.at(x + 1, y - 1)) && ch === 'h' && !solid(g.at(x + 1, y))) col = HULL_LIT
        else if (!down) col = EDGE
        else if (ch === 'h' && y > cy) col = SHADE
        else col = HULL
      } else if (ch === '|') col = SEAM
      else if (ch === 'p') col = TRIM
      else if (ch === 'P') col = TRIM_LIT
      else if (ch === 'q') col = TRIM_DARK
      else if (ch === 's') col = STEEL
      else if (ch === 'k') col = PYLON
      else if (ch === 'b') col = BELL
      else if (ch === 'e') col = RING
      else if (ch === 'g') {
        const v = (gy1 > gy0 ? (gy1 - y) / (gy1 - gy0) : 0.5) * 0.6 + (gx1 > gx0 ? (x - gx0) / (gx1 - gx0) : 0.5) * 0.4
        col = lerp(GLASS_LO, GLASS_HI, v)
      } else if (ch === 'w') col = GLINT
      else if (ch === 'R') col = nav ? RED : RED_OFF
      else if (ch === 'G') col = nav ? GREEN : GREEN_OFF
      else if (ch === 'W') col = strobe ? STROBE : STROBE_OFF
      if (col) s.set(x, y, col)
    }
  }
  return s
}

/** Upper and lower engine pods on swept pylons; the nav light sits on each pod's tip. */
function pods(g: Grid, rows: readonly (readonly [outer: number, inner: number, pylon: number, light: string])[], len: number, keel: [number, number], pylon: [number, number]) {
  for (const [outer, inner, pyl, light] of rows) {
    for (const y of new Set([outer, inner])) { g.put(0, y, 'e'); g.put(1, y, 's') }
    g.run(2, len - 1, outer, 'o'); g.run(2, len, inner, 'o')
    if (outer !== inner) g.run(keel[0], keel[1], inner, inner < pyl ? 'q' : 'p')
    else g.run(keel[0], keel[1], inner, 'p')
    g.put(len + 1, inner, light)
    g.run(pylon[0], pylon[1], pyl, 'k')
  }
}

function large(t: number): Ship {
  const W = 52, H = 14, cy = 6
  const g = new Grid(W, H)
  // main hull, column by column: [top row, bottom row]; flat deck aft, a chiselled wedge forward
  const top = (x: number) => (x <= 2 ? 4 : x <= 41 ? 3 : Math.min(8, 4 + ((x - 42) >> 1)))
  const bot = (x: number) => (x <= 2 ? 9 : x <= 33 ? 10 : x <= 47 ? 9 : 8)
  for (let x = 2; x < W; x++) for (let y = top(x); y <= bot(x); y++) g.put(x, y, 'h')
  // stern: the bulkhead and the main engine's ring
  for (let y = 4; y <= 9; y++) g.put(1, y, 's')
  for (let y = 5; y <= 8; y++) g.put(0, y, 'e')
  g.put(0, 4, 'b'); g.put(0, 9, 'b')
  // a purple band at the stern, and a flank stripe ahead of the lettering that follows the chin;
  // under the lettering it would read as an underline
  for (let y = 4; y <= 9; y++) g.put(3, y, 'p')
  for (let x = 31; x <= 47; x++) g.put(x, bot(x) - 1, 'p')
  // panel seams: the plate ahead of the lettering and the nose cap
  for (let y = 4; y <= 8; y++) g.put(30, y, '|')
  for (let y = 4; y <= 7; y++) g.put(41, y, '|')
  // canopy: steel roof and frame, glass, a purple sill on the deck
  g.run(32, 37, 0, 's')
  g.put(31, 1, 's'); g.run(32, 37, 1, 'g'); g.put(38, 1, 's')
  g.put(30, 2, 's'); g.run(31, 39, 2, 'g'); g.put(40, 2, 's')
  g.run(30, 41, 3, 'P')
  g.put(36, 1, 'w'); g.put(37, 2, 'w')
  pods(g, [[0, 1, 2, 'G'], [13, 12, 11, 'R']], 13, [5, 11], [6, 8])
  g.put(W - 1, 8, 'W')
  const s = colour(g, cy, t)
  letter(s, 'EULER', 5, 4, INK, true)
  return {
    w: W, h: H, px: s.buf, alpha: s.alpha, anchorY: cy, hullTop: -3, hullBot: 4, nozzleX: 0,
    nozzles: [{ top: -6, bot: -5 }, { top: -1, bot: 2 }, { top: 6, bot: 7 }],
  }
}

function medium(t: number): Ship {
  const W = 32, H = 10, cy = 5
  const g = new Grid(W, H)
  const top = (x: number) => (x <= 26 ? 2 : Math.min(5, 3 + ((x - 27) >> 1)))
  const bot = (x: number) => (x <= 22 ? 7 : x <= 28 ? 6 : 5)
  for (let x = 2; x < W; x++) for (let y = top(x); y <= bot(x); y++) g.put(x, y, 'h')
  for (let y = 3; y <= 6; y++) g.put(1, y, 's')
  for (let y = 4; y <= 5; y++) g.put(0, y, 'e')
  g.put(0, 3, 'b'); g.put(0, 6, 'b')
  for (let y = 3; y <= 5; y++) g.put(23, y, '|')
  for (let x = 24; x <= 28; x++) g.put(x, bot(x) - 1, 'p')
  g.run(21, 24, 0, 's')
  g.put(20, 1, 's'); g.run(21, 25, 1, 'g'); g.put(26, 1, 's')
  g.run(20, 26, 2, 'P')
  g.put(24, 1, 'w')
  pods(g, [[0, 0, 1, 'G'], [9, 9, 8, 'R']], 8, [4, 7], [4, 5])
  g.put(W - 1, 5, 'W')
  const s = colour(g, cy, t)
  letter(s, 'EULER', 3, 3, INK, false)
  return {
    w: W, h: H, px: s.buf, alpha: s.alpha, anchorY: cy, hullTop: -3, hullBot: 2, nozzleX: 0,
    nozzles: [{ top: -5, bot: -5 }, { top: -1, bot: 0 }, { top: 4, bot: 4 }],
  }
}

function small(t: number): Ship {
  const W = 14, H = 5, cy = 2
  const g = new Grid(W, H)
  g.run(2, 8, 1, 'h'); g.run(2, 13, 2, 'h'); g.run(2, 10, 3, 'h')
  for (let y = 1; y <= 3; y++) g.put(1, y, 's')
  g.put(0, 2, 'e')
  g.put(9, 1, 'g')
  g.run(2, 4, 0, 'o'); g.run(2, 4, 4, 'p'); g.put(5, 4, 'R')
  g.run(9, 11, 3, 'p')
  const s = colour(g, cy, t)
  return { w: W, h: H, px: s.buf, alpha: s.alpha, anchorY: cy, hullTop: -1, hullBot: 1, nozzleX: 0, nozzles: [{ top: 0, bot: 0 }] }
}

export const scifiSprite: ShipDrawer = (tier: ShipTier, t: number) => (tier === 'large' ? large(t) : tier === 'medium' ? medium(t) : small(t))
