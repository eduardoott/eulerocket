/**
 * A multi-stage launch rocket, Saturn-V-like: bell nozzles under a flared skirt with fins, a white
 * first stage with the black-and-white roll pattern, dark interstage rings, a narrower lettered
 * second stage, a short third stage, a purple fairing and a launch-escape tower spike.
 */
import {
  type Rgb, type Ship, type ShipDrawer, type ShipTier, Sprite, lerp, letter,
  HULL, HULL_LIT, HULL_DARK, TRIM, TRIM_LIT, TRIM_DARK, INK, STEEL, TILE, TILE_LIT, BELL,
} from '../ship-kit'

const BLACK_DARK: Rgb = [22, 23, 30]
const BELL_LIT: Rgb = [170, 174, 192]
const FIN_LIT: Rgb = [112, 116, 134]

type Paint = (dy: number, top: number, bot: number) => Rgb

/** Three-tone cylinder shading for a white section spanning rows top..bot. */
const white: Paint = (dy, top, bot) => {
  const n = bot - top + 1
  if (dy === top) return HULL_LIT
  if (dy === bot) return lerp(HULL, HULL_DARK, 0.6)
  if (n >= 7 && dy === top + 1) return lerp(HULL_LIT, HULL, 0.5)
  if (n >= 7 && dy === bot - 1) return lerp(HULL, HULL_DARK, 0.25)
  return HULL
}
const black: Paint = (dy, top, bot) => (dy === top ? TILE_LIT : dy === bot ? BLACK_DARK : TILE)
const ring: Paint = (dy, top, bot) => (dy === top ? STEEL : dy === bot ? BLACK_DARK : TILE)
const purple: Paint = (dy, top, bot) => (dy === top ? TRIM_LIT : dy === bot ? TRIM_DARK : TRIM)
// greyer than the stages so the flare reads as a separate engine fairing
const skirt: Paint = (dy, top, bot) => lerp(white(dy, top, bot), HULL_DARK, 0.4)

/** Roll pattern: the upper and lower halves of each block alternate black and white. */
const roll = (block: number): Paint => (dy, top, bot) => ((dy <= (top + bot) / 2 - 0.5) !== (block % 2 === 1) ? black : white)(dy, top, bot)

function column(s: Sprite, x: number, cy: number, top: number, bot: number, paint: Paint) {
  for (let dy = top; dy <= bot; dy++) s.set(x, cy + dy, paint(dy, top, bot))
}

/** Fins above and below the hull rows `top`/`bot`, `reach[k]` rows deep at column `x + k`. */
function fins(s: Sprite, x: number, cy: number, top: number, bot: number, reach: number[]) {
  reach.forEach((n, k) => {
    for (let r = 1; r <= n; r++) {
      s.set(x + k, cy + top - r, r === n ? FIN_LIT : STEEL)
      s.set(x + k, cy + bot + r, r === n ? TILE_LIT : STEEL)
    }
  })
}

function ship(s: Sprite, cy: number, top: number, bot: number, jets: { top: number; bot: number }[]): Ship {
  return { w: s.w, h: s.h, px: s.buf, alpha: s.alpha, anchorY: cy, hullTop: top, hullBot: bot, nozzleX: 0, nozzles: jets }
}

/** 53 x 13: three bells, skirt and fins, roll-pattern first stage, lettered second, third, fairing, tower. */
function large(): Ship {
  const s = new Sprite(53, 13)
  const cy = 6
  const bells = [-4, 0, 4]
  for (const c of bells) {
    column(s, 0, cy, c - 1, c + 1, (dy) => (dy < c ? BELL_LIT : dy > c ? STEEL : BELL))
    s.set(1, cy + c, STEEL)
  }
  column(s, 2, cy, -5, 5, skirt)
  column(s, 3, cy, -5, 5, skirt)
  for (let x = 4; x <= 13; x++) column(s, x, cy, -4, 4, x <= 11 ? roll((x - 4) >> 1) : white)
  fins(s, 3, cy, -4, 4, [2, 2, 1, 1])
  column(s, 14, cy, -4, 4, ring)
  column(s, 15, cy, -3, 3, purple)
  for (let x = 16; x <= 41; x++) column(s, x, cy, -3, 3, white)
  letter(s, 'EULER', 17, cy - 2, INK, true)
  column(s, 42, cy, -3, 3, ring)
  for (let x = 43; x <= 45; x++) column(s, x, cy, -2, 2, white)
  const fair: [number, number][] = [[-2, 2], [-1, 1], [-1, 1], [0, 0]]
  fair.forEach(([a, b], k) => column(s, 46 + k, cy, a, b, purple))
  s.set(50, cy, STEEL); s.set(51, cy, STEEL); s.set(52, cy, HULL_LIT)
  return ship(s, cy, -4, 4, bells.map((c) => ({ top: c - 1, bot: c + 1 })))
}

/** 36 x 10, centred on row -0.5: two bells, roll blocks, small lettering, third stage, fairing, tower. */
function medium(): Ship {
  const s = new Sprite(36, 10)
  const cy = 5
  const bells = [-3, 1]
  for (const c of bells) { s.set(0, cy + c, BELL_LIT); s.set(0, cy + c + 1, STEEL) }
  column(s, 1, cy, -4, 3, skirt)
  for (let x = 2; x <= 7; x++) column(s, x, cy, -4, 3, roll((x - 2) >> 1))
  fins(s, 1, cy, -4, 3, [1, 1, 1])
  column(s, 8, cy, -4, 3, ring)
  for (let x = 9; x <= 29; x++) column(s, x, cy, -3, 2, white)
  letter(s, 'EULER', 10, cy - 2, INK, false)
  column(s, 30, cy, -3, 2, ring)
  column(s, 31, cy, -2, 1, white)
  column(s, 32, cy, -2, 1, purple)
  column(s, 33, cy, -1, 0, purple)
  s.set(34, cy, STEEL); s.set(35, cy, HULL_LIT)
  return ship(s, cy, -4, 3, bells.map((c) => ({ top: c, bot: c + 1 })))
}

/** 14 x 5: white body with a dark band, purple tip, spike and one jet. */
function small(): Ship {
  const s = new Sprite(14, 5)
  const cy = 2
  s.set(0, cy, BELL)
  column(s, 1, cy, -2, 2, skirt)
  for (let x = 2; x <= 9; x++) column(s, x, cy, -1, 1, x === 3 || x === 7 ? ring : white)
  column(s, 10, cy, -1, 1, purple)
  s.set(11, cy, TRIM)
  s.set(12, cy, STEEL); s.set(13, cy, HULL_LIT)
  return ship(s, cy, -1, 1, [{ top: 0, bot: 0 }])
}

export const stagedSprite: ShipDrawer = (tier: ShipTier) => (tier === 'large' ? large() : tier === 'medium' ? medium() : small())
