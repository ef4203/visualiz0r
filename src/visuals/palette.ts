/** True black: LED walls switch pixels off, and projectors show it as the darkest they can. */
export const STAGE_BACKGROUND = '#000000'
export const INK = '#f0efec'

/**
 * One-hue sequential ramp (blue steps 500 -> 100), low -> high magnitude.
 * It starts at step 500 rather than darker so the low end survives a projector's black level.
 */
const BLUE_RAMP: readonly (readonly [number, number, number])[] = [
  [0x25, 0x6a, 0xbf],
  [0x39, 0x87, 0xe5],
  [0x6d, 0xa7, 0xec],
  [0x9e, 0xc5, 0xf4],
  [0xcd, 0xe2, 0xfb],
]

const LUT_SIZE = 64

const lut: string[] = Array.from({ length: LUT_SIZE }, (_, i) => {
  const t = (i / (LUT_SIZE - 1)) * (BLUE_RAMP.length - 1)
  const a = Math.min(BLUE_RAMP.length - 2, Math.floor(t))
  const f = t - a
  const [r0, g0, b0] = BLUE_RAMP[a]
  const [r1, g1, b1] = BLUE_RAMP[a + 1]
  return `rgb(${Math.round(r0 + (r1 - r0) * f)},${Math.round(g0 + (g1 - g0) * f)},${Math.round(b0 + (b1 - b0) * f)})`
})

/** `t` in 0..1 along the blue ramp. */
export function blue(t: number): string {
  const i = Math.round((t < 0 ? 0 : t > 1 ? 1 : t) * (LUT_SIZE - 1))
  return lut[i]
}
