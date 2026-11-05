/** A frame of pixel art: 0xRRGGBB per pixel, row by row, or TRANSPARENT. */
export interface Art { w: number; h: number; px: Uint32Array }

/** A value outside 0xRRGGBB, so it can't collide with a real colour. */
export const TRANSPARENT = 0x01000000
