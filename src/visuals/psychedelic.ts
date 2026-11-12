import { bandSpectrum } from '../audio/bands.ts'
import { STAGE_BACKGROUND } from './palette.ts'
import type { Visualization } from './types.ts'

/** Longest side of the offscreen feedback buffer; it is scaled up to the screen, which also softens it. */
const BUFFER_MAX = 1280
const BAND_COUNT = 32
const MIN_HZ = 45
const MAX_HZ = 14000
const CONTRAST = 1.3
const ATTACK_S = 0.03
const RELEASE_S = 0.14
/** How long a drawn element lingers in the feedback trail. */
const TRAIL_S = 0.32
const SYMMETRIES = [6, 8, 5, 10, 7] as const
const BEATS_PER_SECTION = 16
const MAX_SECTION_S = 22
const ORBS = 3
const MAX_RINGS = 6
const RING_LIFE_S = 1.4
const TAU = Math.PI * 2

interface Ring {
  age: number
  hue: number
  strength: number
}

interface Buffer {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
}

function createBuffer(): Buffer {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('2D canvas is unavailable')
  return { canvas, ctx }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

function hsla(hue: number, lightness: number, alpha: number): string {
  const h = ((hue % 360) + 360) % 360
  return `hsla(${h.toFixed(0)},100%,${lightness}%,${alpha.toFixed(3)})`
}

/** Hue sweep along the angular extent of one wedge (angle 0..half), in the current coordinate space. */
function wedgeGradient(
  g: CanvasRenderingContext2D,
  half: number,
  hue: number,
  spread: number,
  lightness: number,
): CanvasGradient {
  const gradient = g.createConicGradient(0, 0, 0)
  const end = half / TAU
  const stops = 6
  for (let s = 0; s <= stops; s++) {
    gradient.addColorStop((s / stops) * end, hsla(hue + (s / stops) * spread, lightness, 1))
  }
  return gradient
}

function tracePath(g: CanvasRenderingContext2D, xs: Float32Array, ys: Float32Array): void {
  const last = xs.length - 1
  g.beginPath()
  g.moveTo(xs[0], ys[0])
  for (let i = 1; i < last; i++) {
    g.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[i + 1]) / 2, (ys[i] + ys[i + 1]) / 2)
  }
  g.lineTo(xs[last], ys[last])
}

export const psychedelic: Visualization = {
  id: 'psychedelic',
  name: 'Psychedelic',
  create() {
    const buffers: [Buffer, Buffer] = [createBuffer(), createBuffer()]
    let current = 0

    const target = new Float32Array(BAND_COUNT)
    const bands = new Float32Array(BAND_COUNT)
    const outerX = new Float32Array(BAND_COUNT)
    const outerY = new Float32Array(BAND_COUNT)
    const innerX = new Float32Array(BAND_COUNT)
    const innerY = new Float32Array(BAND_COUNT)
    const rings: Ring[] = []

    let energy = 0
    let bass = 0
    let hue = 0
    let patternAngle = 0
    let direction = 1
    let symmetryIndex = 0
    let beatsInSection = 0
    let sinceSection = 0

    return {
      draw(ctx, frame, { width, height }) {
        if (width <= 0 || height <= 0) return
        const { dt, time, beat } = frame

        const fit = Math.min(1, BUFFER_MAX / Math.max(width, height))
        const bw = Math.max(1, Math.round(width * fit))
        const bh = Math.max(1, Math.round(height * fit))
        if (buffers[0].canvas.width !== bw || buffers[0].canvas.height !== bh) {
          for (const b of buffers) {
            b.canvas.width = bw
            b.canvas.height = bh
            b.ctx.fillStyle = STAGE_BACKGROUND
            b.ctx.fillRect(0, 0, bw, bh)
          }
        }
        const m = Math.min(bw, bh)

        bandSpectrum(frame, target, MIN_HZ, MAX_HZ)
        const attack = 1 - Math.exp(-dt / ATTACK_S)
        const release = 1 - Math.exp(-dt / RELEASE_S)
        for (let i = 0; i < BAND_COUNT; i++) {
          const t = Math.pow(target[i], CONTRAST)
          bands[i] += (t - bands[i]) * (t > bands[i] ? attack : release)
        }
        const drive = (frame.level + frame.bass + frame.mid) / 3
        energy += (drive - energy) * (1 - Math.exp(-dt / 0.25))
        bass += (frame.bass - bass) * (frame.bass > bass ? attack : release)

        // Every few bars the pattern changes shape, spin direction and colour.
        sinceSection += dt
        if (beat.onset) {
          beatsInSection++
          if (beat.strength > 0.5) hue += 8
          if (rings.length >= MAX_RINGS) rings.shift()
          rings.push({ age: 0, hue: hue + 180, strength: clamp(0.4 + beat.strength, 0, 1) })
        }
        if (beatsInSection >= BEATS_PER_SECTION || sinceSection > MAX_SECTION_S) {
          beatsInSection = 0
          sinceSection = 0
          symmetryIndex = (symmetryIndex + 1) % SYMMETRIES.length
          direction = -direction
          hue += 60
        }

        hue += dt * (10 + 30 * energy)
        patternAngle += dt * direction * (0.12 + 0.2 * energy)
        const spin = direction * (0.1 + 0.35 * frame.mid + 0.25 * beat.pulse) * dt
        const zoom = 1 + (0.08 + 0.55 * bass + 0.45 * beat.pulse) * dt
        const decay = Math.exp(-dt / TRAIL_S)

        const cx = bw / 2 + Math.sin(time * 0.37) * m * 0.06
        const cy = bh / 2 + Math.cos(time * 0.29) * m * 0.05

        // Feedback: last frame, turned and zoomed outward and faded, becomes the new background.
        const src = buffers[current]
        const dst = buffers[1 - current]
        const g = dst.ctx
        g.globalCompositeOperation = 'source-over'
        g.globalAlpha = 1
        g.fillStyle = STAGE_BACKGROUND
        g.fillRect(0, 0, bw, bh)
        g.save()
        g.translate(cx, cy)
        g.rotate(spin)
        g.scale(zoom, zoom)
        g.translate(-cx, -cy)
        g.globalAlpha = decay
        g.drawImage(src.canvas, 0, 0)
        g.restore()
        g.globalAlpha = 1
        g.globalCompositeOperation = 'lighter'

        const n = SYMMETRIES[symmetryIndex]
        const half = Math.PI / n
        const outerBase = m * 0.15
        const outerAmp = m * 0.3
        const innerBase = m * 0.06
        const innerAmp = m * 0.12
        for (let i = 0; i < BAND_COUNT; i++) {
          const a = (i / (BAND_COUNT - 1)) * half
          const outer = outerBase + outerAmp * bands[i]
          const inner = innerBase + innerAmp * bands[BAND_COUNT - 1 - i]
          outerX[i] = Math.cos(a) * outer
          outerY[i] = Math.sin(a) * outer
          innerX[i] = Math.cos(a) * inner
          innerY[i] = Math.sin(a) * inner
        }

        const orbGradients: CanvasGradient[] = []
        const orbX: number[] = []
        const orbY: number[] = []
        const orbR: number[] = []
        for (let j = 0; j < ORBS; j++) {
          const a = (0.5 + 0.5 * Math.sin(time * (0.6 + 0.37 * j) + j * 2.1)) * half
          const r = m * (0.1 + 0.3 * (0.5 + 0.5 * Math.sin(time * (0.43 + 0.29 * j) + j * 1.3)))
          const size = m * (0.02 + 0.06 * bands[4 + j * 10] + (j === 0 ? 0.04 * beat.pulse : 0))
          const x = Math.cos(a) * r
          const y = Math.sin(a) * r
          const orbHue = hue + j * 70 + 40
          const glow = g.createRadialGradient(x, y, 0, x, y, size)
          glow.addColorStop(0, hsla(orbHue, 62, 0.9))
          glow.addColorStop(0.5, hsla(orbHue, 55, 0.4))
          glow.addColorStop(1, hsla(orbHue, 50, 0))
          orbGradients.push(glow)
          orbX.push(x)
          orbY.push(y)
          orbR.push(size)
        }

        const presence = 0.35 + 0.65 * clamp(energy * 2, 0, 1)
        const outerStroke = wedgeGradient(g, half, hue, 160, 58)
        const innerStroke = wedgeGradient(g, half, hue + 120, 140, 60)
        const lineW = Math.max(1.5, m * 0.004)
        g.lineJoin = 'round'
        g.lineCap = 'round'

        // Draws `paint` once per mirrored wedge, in that wedge's own coordinate space.
        const eachWedge = (paint: () => void) => {
          for (let c = 0; c < n * 2; c++) {
            g.save()
            g.translate(cx, cy)
            g.rotate(patternAngle + Math.floor(c / 2) * 2 * half)
            if (c & 1) g.scale(1, -1)
            paint()
            g.restore()
          }
        }

        // Lines add light, so crossings glow.
        eachWedge(() => {
          tracePath(g, outerX, outerY)
          g.lineTo(0, 0)
          g.globalAlpha = 0.025 * presence
          g.fillStyle = outerStroke
          g.fill()

          tracePath(g, outerX, outerY)
          g.strokeStyle = outerStroke
          g.lineWidth = lineW * 4
          g.globalAlpha = 0.12 * presence
          g.stroke()
          g.lineWidth = lineW
          g.globalAlpha = 0.8 * presence
          g.stroke()

          tracePath(g, innerX, innerY)
          g.strokeStyle = innerStroke
          g.lineWidth = lineW * 0.8
          g.globalAlpha = 0.65 * presence
          g.stroke()
        })

        for (let i = rings.length - 1; i >= 0; i--) {
          const ring = rings[i]
          ring.age += dt
          if (ring.age >= RING_LIFE_S) {
            rings.splice(i, 1)
            continue
          }
          const life = 1 - ring.age / RING_LIFE_S
          g.globalAlpha = 1
          g.strokeStyle = hsla(ring.hue, 58, 0.3 * life * ring.strength)
          g.lineWidth = Math.max(2, m * 0.02 * life)
          g.beginPath()
          g.arc(cx, cy, m * (0.04 + 0.55 * ring.age), 0, TAU)
          g.stroke()
        }

        // Orbs and core are painted over the trail instead of added to it, so they keep their colour.
        g.globalCompositeOperation = 'source-over'
        g.globalAlpha = 1
        eachWedge(() => {
          for (let j = 0; j < ORBS; j++) {
            g.fillStyle = orbGradients[j]
            g.beginPath()
            g.arc(orbX[j], orbY[j], orbR[j], 0, TAU)
            g.fill()
          }
        })

        const coreR = m * (0.035 + 0.05 * bass + 0.06 * beat.pulse)
        const core = g.createRadialGradient(cx, cy, 0, cx, cy, coreR)
        core.addColorStop(0, hsla(hue + 30, 78, 0.95))
        core.addColorStop(0.4, hsla(hue + 15, 58, 0.55))
        core.addColorStop(1, hsla(hue, 55, 0))
        g.fillStyle = core
        g.fillRect(cx - coreR, cy - coreR, coreR * 2, coreR * 2)

        current = 1 - current

        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(dst.canvas, 0, 0, width, height)
      },
      dispose() {
        for (const b of buffers) {
          b.canvas.width = 0
          b.canvas.height = 0
        }
      },
    }
  },
}
