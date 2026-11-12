import { INK, STAGE_BACKGROUND, blue } from './palette.ts'
import type { Visualization } from './types.ts'

const MIN_EMITTERS = 2
const MAX_EMITTERS = 4
const BEAMS_PER_EMITTER = 40
/** 160 beams at most; with the glow pass that is 320 line segments per frame. */
const MAX_BEAMS = MAX_EMITTERS * BEAMS_PER_EMITTER

const FAN = 0
const CROSS = 1
const PARALLEL = 2
const PATTERN_COUNT = 3
const BEATS_PER_SECTION = 16

/** Total angle covered by one emitter's beams, per pattern. Parallel beams don't fan out. */
const FAN_SPREAD = 1.15
const CROSS_SPREAD = 0.75
/** Fan emitters lean outwards by this much between the left and right edge. */
const FAN_TILT = 0.5
/** Emitters sit this fraction of the screen's diagonal beyond the edge, so no origin is visible. */
const OFFSCREEN = 0.06
/**
 * Cross emitters stand on an ellipse this fraction of the screen from the centre. Anything over
 * 0.5 * sqrt(2) puts every point of the ellipse outside the screen rectangle.
 */
const RING = 0.78

/** Sweep swing per pattern, and how fast its phase advances between mid = 0 and mid = MID_FULL. */
const SWEEP_AMPLITUDE = [0.35, 0.22, 0.3]
const SWEEP_MIN_RAD_S = 0.35
const SWEEP_MAX_RAD_S = 1.9
const SWEEP_STAGGER = 1.9
const MID_FULL = 0.5
const MID_SMOOTH_S = 0.4

/** A kick moves every fan by a hard-cut angle between these two, scaled by the onset strength. */
const SNAP_MIN = 0.1
const SNAP_MAX = 0.55
const SNAP_JITTER = 0.25

/** Below LEVEL_FLOOR the rig is black, so mic hiss never lights it. */
const LEVEL_FLOOR = 0.05
const LEVEL_FULL = 0.3
const LEVEL_ATTACK_S = 0.06
const LEVEL_RELEASE_S = 0.4
/** Below this presence nothing but the black background is drawn. */
const MIN_VISIBLE = 0.01

const TREBLE_FLOOR = 0.08
const TREBLE_FULL = 0.45
const TREBLE_ATTACK_S = 0.03
const TREBLE_RELEASE_S = 0.15
const FLICKER_GROUPS = 3
const FLICKER_DEPTH = 0.85
/** Flicker is re-rolled at ~20 Hz: a shimmer, not a strobe. */
const FLICKER_INTERVAL_S = 0.05

/** Beam brightness is 1 - PULSE_LIFT between kicks and 1 at the peak of a kick. */
const PULSE_LIFT = 0.4
const FINE_LEVEL = 0.55
const ACCENT_LEVEL = 0.9
const GLOW_ALPHA = 0.05
const GLOW_WIDTH = 6
/** Beam width as a fraction of the short screen side, never under 1 px. */
const CORE_WIDTH = 0.001

const HAZE_RGB = '37,106,191'
const HAZE_ALPHA = 0.07
const HAZE_RADIUS = 0.6

const ACCENT = blue(0.55)
const ACCENT_GLOW = blue(0.2)

const TAU = Math.PI * 2
const HALF_PI = Math.PI / 2

/** Beams are drawn per bucket so each bucket is one path and one stroke(). */
const ACCENT_BUCKET = 0
const MAIN_BUCKET = 1
const FINE_BUCKET = 2
const LAST_BUCKET = FINE_BUCKET + FLICKER_GROUPS - 1

/** Every 8th beam is accent, every 4th a bright INK beam, the rest are flickering fine beams. */
const BUCKET_OF = Uint8Array.from({ length: BEAMS_PER_EMITTER }, (_, k) =>
  k % 8 === 0 ? ACCENT_BUCKET : k % 4 === 0 ? MAIN_BUCKET : FINE_BUCKET + (k % FLICKER_GROUPS),
)

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

function smoothstep(lo: number, hi: number, x: number): number {
  const t = clamp((x - lo) / (hi - lo), 0, 1)
  return t * t * (3 - 2 * t)
}

function follow(current: number, target: number, dt: number, attackS: number, releaseS: number) {
  const tau = target > current ? attackS : releaseS
  return current + (target - current) * (1 - Math.exp(-dt / tau))
}

interface Beams {
  count: number
  x0: Float32Array
  y0: Float32Array
  x1: Float32Array
  y1: Float32Array
  bucket: Uint8Array
}

function addBeams(ctx: CanvasRenderingContext2D, beams: Beams, first: number, last: number): void {
  const { count, x0, y0, x1, y1, bucket } = beams
  ctx.beginPath()
  for (let i = 0; i < count; i++) {
    const b = bucket[i]
    if (b < first || b > last) continue
    ctx.moveTo(x0[i], y0[i])
    ctx.lineTo(x1[i], y1[i])
  }
}

/** Unit-radius gradient: it is moved and scaled onto each emitter with the canvas transform. */
function createHaze(ctx: CanvasRenderingContext2D): CanvasGradient {
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
  gradient.addColorStop(0, `rgba(${HAZE_RGB},1)`)
  gradient.addColorStop(0.35, `rgba(${HAZE_RGB},0.3)`)
  gradient.addColorStop(1, `rgba(${HAZE_RGB},0)`)
  return gradient
}

export const laserRig: Visualization = {
  id: 'laser-rig',
  name: 'Laser Rig',
  create() {
    const beams: Beams = {
      count: 0,
      x0: new Float32Array(MAX_BEAMS),
      y0: new Float32Array(MAX_BEAMS),
      x1: new Float32Array(MAX_BEAMS),
      y1: new Float32Array(MAX_BEAMS),
      bucket: Uint8Array.from({ length: MAX_BEAMS }, (_, i) => BUCKET_OF[i % BEAMS_PER_EMITTER]),
    }
    const emitterX = new Float32Array(MAX_EMITTERS)
    const emitterY = new Float32Array(MAX_EMITTERS)
    const snapSign = Float32Array.from({ length: MAX_EMITTERS }, (_, e) => (e % 2 === 0 ? 1 : -1))
    const snapOffset = new Float32Array(MAX_EMITTERS)
    const flicker = new Float32Array(FLICKER_GROUPS).fill(1)
    let haze: CanvasGradient | null = null

    let pattern = FAN
    let emitters = 3
    let parallelBase = -HALF_PI
    let beatsInSection = 0
    let phase = 0
    let flickerClock = 0
    let level = 0
    let mid = 0
    let treble = 0

    const nextSection = () => {
      // Adding 1 or 2 modulo 3 always lands on one of the two other patterns.
      pattern = (pattern + 1 + Math.floor(Math.random() * (PATTERN_COUNT - 1))) % PATTERN_COUNT
      emitters = MIN_EMITTERS + Math.floor(Math.random() * (MAX_EMITTERS - MIN_EMITTERS + 1))
      parallelBase = Math.random() * Math.PI
    }

    // Signs alternate on every kick, so each snap moves a fan by at least ~1.5 * SNAP_MIN.
    const snapFans = (strength: number) => {
      const size = SNAP_MIN + (SNAP_MAX - SNAP_MIN) * clamp(strength, 0, 1)
      for (let e = 0; e < MAX_EMITTERS; e++) {
        snapSign[e] = -snapSign[e]
        snapOffset[e] = snapSign[e] * size * (1 - SNAP_JITTER * Math.random())
      }
    }

    const layout = (width: number, height: number) => {
      const n = emitters
      const cx = width / 2
      const cy = height / 2
      const diagonal = Math.sqrt(width * width + height * height)
      const margin = diagonal * OFFSCREEN
      // Emitters are off screen, so beams must travel further to cross the whole stage.
      const reach = diagonal * 1.7
      const count = n * BEAMS_PER_EMITTER
      const { x0, y0, x1, y1 } = beams
      beams.count = count

      if (pattern === PARALLEL) {
        // One shared angle. Beams start on the screen's upstream edge, evenly spaced across it.
        const angle = parallelBase + SWEEP_AMPLITUDE[PARALLEL] * Math.sin(phase) + snapOffset[0]
        const dx = Math.cos(angle)
        const dy = Math.sin(angle)
        const nx = -dy
        const ny = dx
        const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2
        const across = Math.abs(width * nx) + Math.abs(height * ny)
        const spacing = across / count
        const length = 2 * half + margin * 2
        const ox = cx - dx * (half + margin)
        const oy = cy - dy * (half + margin)
        for (let i = 0; i < count; i++) {
          const offset = (i + 0.5 - count / 2) * spacing
          const x = ox + nx * offset
          const y = oy + ny * offset
          x0[i] = x
          y0[i] = y
          x1[i] = x + dx * length
          y1[i] = y + dy * length
        }
        for (let e = 0; e < n; e++) {
          const offset = ((e + 0.5) * BEAMS_PER_EMITTER - count / 2) * spacing
          emitterX[e] = ox + nx * offset
          emitterY[e] = oy + ny * offset
        }
        return
      }

      const spread = pattern === CROSS ? CROSS_SPREAD : FAN_SPREAD
      for (let e = 0; e < n; e++) {
        let x: number
        let y: number
        let aim: number
        if (pattern === CROSS) {
          // Emitters on a ring all aim at the centre, so opposite ones aim at each other.
          const around = Math.PI + (e * TAU) / n
          x = cx + Math.cos(around) * width * RING
          y = cy + Math.sin(around) * height * RING
          aim = Math.atan2(cy - y, cx - x)
        } else {
          // Emitters alternate between the floor (aiming up) and the ceiling (aiming down).
          const t = (e + 0.5) / n
          const down = e % 2 === 1
          x = t * width
          y = down ? -margin : height + margin
          aim = (down ? HALF_PI : -HALF_PI) + (down ? -1 : 1) * (t - 0.5) * FAN_TILT
        }
        aim += SWEEP_AMPLITUDE[pattern] * Math.sin(phase + e * SWEEP_STAGGER) + snapOffset[e]
        emitterX[e] = x
        emitterY[e] = y

        const base = e * BEAMS_PER_EMITTER
        for (let k = 0; k < BEAMS_PER_EMITTER; k++) {
          const a = aim + ((k + 0.5) / BEAMS_PER_EMITTER - 0.5) * spread
          const i = base + k
          x0[i] = x
          y0[i] = y
          x1[i] = x + Math.cos(a) * reach
          y1[i] = y + Math.sin(a) * reach
        }
      }
    }

    return {
      draw(ctx, frame, { width, height }) {
        if (width <= 0 || height <= 0) return
        const { dt, beat } = frame

        level = follow(level, frame.level, dt, LEVEL_ATTACK_S, LEVEL_RELEASE_S)
        mid = follow(mid, frame.mid, dt, MID_SMOOTH_S, MID_SMOOTH_S)
        treble = follow(treble, frame.treble, dt, TREBLE_ATTACK_S, TREBLE_RELEASE_S)
        const presence = smoothstep(LEVEL_FLOOR, LEVEL_FULL, level)

        // The section changes on the same frame as a kick, so the pattern cut lands on the beat.
        if (beat.onset) {
          beatsInSection++
          if (beatsInSection >= BEATS_PER_SECTION) {
            beatsInSection = 0
            nextSection()
          }
          snapFans(beat.strength)
        }

        const sweepSpeed =
          SWEEP_MIN_RAD_S + (SWEEP_MAX_RAD_S - SWEEP_MIN_RAD_S) * clamp(mid / MID_FULL, 0, 1)
        phase = (phase + sweepSpeed * dt) % TAU

        const flickerAmount = smoothstep(TREBLE_FLOOR, TREBLE_FULL, treble)
        flickerClock += dt
        if (flickerClock >= FLICKER_INTERVAL_S) {
          flickerClock %= FLICKER_INTERVAL_S
          for (let g = 0; g < FLICKER_GROUPS; g++) {
            flicker[g] = 1 - flickerAmount * FLICKER_DEPTH * Math.random()
          }
        }

        layout(width, height)

        ctx.save()
        ctx.fillStyle = STAGE_BACKGROUND
        ctx.fillRect(0, 0, width, height)

        if (presence >= MIN_VISIBLE) {
          const m = Math.min(width, height)
          const bright = presence * (1 - PULSE_LIFT + PULSE_LIFT * beat.pulse)
          ctx.globalCompositeOperation = 'lighter'

          // The haze follows the smoothed level only, never the kick: no screen-wide flashes.
          haze ??= createHaze(ctx)
          const radius = m * HAZE_RADIUS
          ctx.fillStyle = haze
          ctx.globalAlpha = HAZE_ALPHA * presence
          for (let e = 0; e < emitters; e++) {
            ctx.save()
            ctx.translate(emitterX[e], emitterY[e])
            ctx.scale(radius, radius)
            ctx.fillRect(-1, -1, 2, 2)
            ctx.restore()
          }

          const core = Math.max(1, m * CORE_WIDTH)
          ctx.lineWidth = core * GLOW_WIDTH
          ctx.globalAlpha = GLOW_ALPHA * bright
          ctx.strokeStyle = INK
          addBeams(ctx, beams, MAIN_BUCKET, LAST_BUCKET)
          ctx.stroke()
          ctx.strokeStyle = ACCENT_GLOW
          addBeams(ctx, beams, ACCENT_BUCKET, ACCENT_BUCKET)
          ctx.stroke()

          ctx.lineWidth = core
          ctx.strokeStyle = INK
          ctx.globalAlpha = clamp(bright, 0, 1)
          addBeams(ctx, beams, MAIN_BUCKET, MAIN_BUCKET)
          ctx.stroke()
          for (let g = 0; g < FLICKER_GROUPS; g++) {
            ctx.globalAlpha = clamp(bright * FINE_LEVEL * flicker[g], 0, 1)
            addBeams(ctx, beams, FINE_BUCKET + g, FINE_BUCKET + g)
            ctx.stroke()
          }
          ctx.strokeStyle = ACCENT
          ctx.globalAlpha = clamp(bright * ACCENT_LEVEL, 0, 1)
          addBeams(ctx, beams, ACCENT_BUCKET, ACCENT_BUCKET)
          ctx.stroke()
        }

        ctx.restore()
      },
    }
  },
}
