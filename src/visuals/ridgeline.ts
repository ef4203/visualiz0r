import { bandSpectrum } from '../audio/bands.ts'
import { INK, STAGE_BACKGROUND } from './palette.ts'
import type { Visualization } from './types.ts'

const LINES = 36
const BANDS = 96
const MIN_HZ = 40
const MAX_HZ = 16000

/** If no beat spawns a line for this long, spawn one anyway so the stack keeps moving. */
const MAX_SPAWN_GAP_S = 1
/** Time constant of the glide that follows each spawn. */
const GLIDE_TAU_S = 0.14
const MAX_GLIDE = 3

/** Front line baseline and the total height the stack climbs, as fractions of the screen height. */
const FRONT_BASELINE = 0.9
const STACK_SPAN = 0.66
/** Exponent > 1 squeezes the pitch towards the back (perspective). */
const DEPTH_CURVE = 1.6
/** Peaks of the rearmost line are this much smaller than the front line's. */
const BACK_SCALE = 0.45

/** Peak height of a full-scale band on the front line, and the hard cap, as screen-height fractions. */
const PEAK_HEIGHT = 0.17
const MAX_PEAK_HEIGHT = 0.25
/** Spectrum values under this are treated as noise, so silence draws flat lines. */
const NOISE_FLOOR = 0.06
/** Bass adds up to this much extra peak height to the front lines. */
const BASS_GAIN = 0.8
const BASS_SMOOTH_S = 0.12
/** Flat lines at the screen edges, so the range rolls out of nothing (like the album cover). */
const EDGE_TAPER = 0.12

/** A kick pushes the stack towards the viewer by up to this fraction of the screen height. */
const PUSH_SHIFT = 0.025
const PUSH_SCALE = 0.05
const PUSH_SMOOTH_S = 0.1

const LINE_WIDTH = 0.0028
const ACCENT = INK
/** Hue runs from the front (blue) to the back (orange) through violet, magenta and red. */
const HUE_FRONT = 215
const HUE_BACK = 395
const SATURATION = 90
const LIGHT_MIN = 50
const LIGHT_MAX = 70
/** Mean spectrum level of a line (times ENERGY_GAIN) picks its lightness. */
const ENERGY_GAIN = 3
const DEPTH_STEPS = 48
const LIGHT_STEPS = 4

/** Precomputed colours, indexed by depth step * LIGHT_STEPS + lightness step: no per-frame strings. */
const DISTANCE_LUT: string[] = Array.from(
  { length: DEPTH_STEPS * LIGHT_STEPS },
  (_, i) => {
    const hue =
      (HUE_FRONT +
        ((HUE_BACK - HUE_FRONT) * Math.floor(i / LIGHT_STEPS)) /
          (DEPTH_STEPS - 1)) %
      360
    const light =
      LIGHT_MIN +
      ((LIGHT_MAX - LIGHT_MIN) * (i % LIGHT_STEPS)) / (LIGHT_STEPS - 1)
    return `hsl(${hue.toFixed(0)} ${SATURATION}% ${light.toFixed(0)}%)`
  },
)

const TAPER = Float32Array.from({ length: BANDS }, (_, i) => {
  const t = i / (BANDS - 1)
  const edge = Math.min(t, 1 - t) / EDGE_TAPER
  const s = edge >= 1 ? 1 : edge * edge * (3 - 2 * edge)
  return s
})

function follow(
  current: number,
  target: number,
  dt: number,
  tau: number,
): number {
  return current + (target - current) * (1 - Math.exp(-dt / tau))
}

export const ridgeline: Visualization = {
  id: 'ridgeline-waterfall',
  name: 'Ridgeline Waterfall',
  create() {
    const rows = Array.from({ length: LINES }, () => new Float32Array(BANDS))
    /** Mean spectrum level of each row, taken when it spawns; drives its colour. */
    const energy = new Float32Array(LINES)
    let head = 0
    let glide = 0
    let lastSpawn = -Infinity
    let bass = 0
    let push = 0

    const tracePolyline = (
      ctx: CanvasRenderingContext2D,
      row: Float32Array,
      width: number,
      baseY: number,
      peak: number,
    ) => {
      ctx.beginPath()
      for (let i = 0; i < BANDS; i++) {
        const v = Math.max(0, row[i] - NOISE_FLOOR) / (1 - NOISE_FLOOR)
        const x = (i / (BANDS - 1)) * width
        const y = baseY - Math.min(1, v) * TAPER[i] * peak
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
    }

    return {
      draw(ctx, frame, { width, height }) {
        if (width <= 0 || height <= 0) return
        const { dt, time, beat } = frame

        if (beat.onset || time - lastSpawn > MAX_SPAWN_GAP_S) {
          lastSpawn = time
          head = (head + 1) % LINES
          bandSpectrum(frame, rows[head], MIN_HZ, MAX_HZ)
          let sum = 0
          for (let i = 0; i < BANDS; i++) sum += rows[head][i]
          energy[head] = sum / BANDS
          glide = Math.min(MAX_GLIDE, glide + 1)
        }
        glide *= Math.exp(-dt / GLIDE_TAU_S)
        bass = follow(bass, frame.bass, dt, BASS_SMOOTH_S)
        push = follow(push, beat.pulse, dt, PUSH_SMOOTH_S)

        ctx.save()
        ctx.fillStyle = STAGE_BACKGROUND
        ctx.fillRect(0, 0, width, height)

        const m = Math.min(width, height)
        ctx.lineWidth = Math.max(1, m * LINE_WIDTH)
        ctx.lineJoin = 'round'

        // The push scales the stack about the bottom centre and shifts it down a little.
        const zoom = 1 + PUSH_SCALE * push
        const shift = PUSH_SHIFT * height * push
        ctx.translate(width / 2, height)
        ctx.scale(zoom, zoom)
        ctx.translate(-width / 2, -height + shift)
        // Fills must reach the real screen bottom whatever the transform is.
        const bottom = height + height * 0.2

        for (let age = LINES - 1; age >= 0; age--) {
          const row = rows[(head - age + LINES) % LINES]
          // Newest line starts in place while the older ones are still gliding up to their slot.
          const pos = Math.max(0, age - glide)
          const t = Math.min(1, pos / (LINES - 1))
          const depth = 1 - Math.pow(1 - t, DEPTH_CURVE)
          const baseY = height * (FRONT_BASELINE - STACK_SPAN * depth)
          const front = 1 - t
          const scale = 1 - (1 - BACK_SCALE) * t
          const peak = Math.min(
            height * MAX_PEAK_HEIGHT,
            height *
              PEAK_HEIGHT *
              scale *
              (1 + BASS_GAIN * bass * front * front),
          )

          // Fill the area under the line first: it hides everything behind it.
          tracePolyline(ctx, row, width, baseY, peak)
          ctx.lineTo(width, bottom)
          ctx.lineTo(0, bottom)
          ctx.closePath()
          ctx.fillStyle = STAGE_BACKGROUND
          ctx.globalAlpha = 1 // a translucent fill would let lines behind show through
          ctx.fill()

          tracePolyline(ctx, row, width, baseY, peak)
          // Hue travels with distance (blue -> violet -> magenta -> orange); loud lines are lighter.
          // The newest line stays INK so it still reads as the live one.
          ctx.globalAlpha = 1
          if (age === 0) {
            ctx.strokeStyle = ACCENT
          } else {
            const level = Math.min(
              LIGHT_STEPS - 1,
              Math.floor(
                energy[(head - age + LINES) % LINES] *
                  ENERGY_GAIN *
                  LIGHT_STEPS,
              ),
            )
            ctx.strokeStyle =
              DISTANCE_LUT[
                Math.round(t * (DEPTH_STEPS - 1)) * LIGHT_STEPS + level
              ]
          }
          ctx.stroke()
        }

        ctx.restore()
      },
    }
  },
}
