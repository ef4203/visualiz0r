import { bandSpectrum } from '../audio/bands.ts'
import { STAGE_BACKGROUND } from './palette.ts'
import type { Visualization } from './types.ts'

/** Cells per side. Odd, so a single cell sits at the centre of the diamond. */
const GRID = 15
const BAND_COUNT = 32
const MIN_HZ = 40
const MAX_HZ = 16000
const CONTRAST = 1.4
const ATTACK_S = 0.025
const MIN_HEIGHT = 0.05
const MAX_HEIGHT = 2.4
/** Rows of empty screen kept above the grid for tall shapes. */
const HEADROOM = 1.2

/** Footprints are sampled at this many angles, so every polygon below morphs into any other. */
const FACETS = 24
const FACET_STEP = (Math.PI * 2) / FACETS
/** Corner pointing at the viewer along the grid diagonal; puts squares square to the grid. */
const VERTEX_ANGLE = Math.PI / 4
const SHAPE_FOLLOW_S = 0.25
const TAPER_FOLLOW_S = 0.35

const BEATS_PER_SECTION = 8
const MAX_SECTION_S = 14
const HUE_SPAN = 140

const MAX_RIPPLES = 4
const RIPPLE_WIDTH = 1.4
const RIPPLE_LIFT = 0.9

const ISO_X = Math.sqrt(3) / 2
const ISO_Y = 0.5
const INV_SQRT2 = Math.SQRT1_2
const HUE_STEP = 3

/** `sides` 0 is round. `radius` is the circumradius in cells, tuned so the shapes look equally large. */
const SHAPES = [
  { sides: 4, radius: 0.62 },
  { sides: 6, radius: 0.5 },
  { sides: 3, radius: 0.52 },
  { sides: 0, radius: 0.46 },
] as const

/** [taper when quiet, taper when loud]: 0 keeps the top as wide as the base, 1 closes it to a point. */
const TAPERS = [
  [0, 0.95],
  [0.95, 0],
  [0, 0],
  [0.5, 0.5],
] as const

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

function polygonRadius(sides: number, circumradius: number, angle: number): number {
  if (sides === 0) return circumradius
  const sector = (Math.PI * 2) / sides
  const u = (((angle - VERTEX_ANGLE) % sector) + sector) % sector
  return (circumradius * Math.cos(sector / 2)) / Math.cos(u - sector / 2)
}

const PROFILES = SHAPES.map(({ sides, radius }) =>
  Float32Array.from({ length: FACETS }, (_, k) => polygonRadius(sides, radius, k * FACET_STEP)),
)
const COS = Float32Array.from({ length: FACETS }, (_, k) => Math.cos(k * FACET_STEP))
const SIN = Float32Array.from({ length: FACETS }, (_, k) => Math.sin(k * FACET_STEP))

interface Ripple {
  age: number
  speed: number
  strength: number
}

export const isoGrid: Visualization = {
  id: 'iso-grid',
  name: 'Iso Grid',
  create() {
    const half = (GRID - 1) / 2
    const cellCount = GRID * GRID
    const maxDist = 0.6 * half + 0.4 * half * Math.SQRT2

    // Cells are stored back to front (by i + j) so painting them in order hides the right things.
    const cellX = new Float32Array(cellCount)
    const cellY = new Float32Array(cellCount)
    const cellPos = new Float32Array(cellCount)
    const cellDist = new Float32Array(cellCount)
    const cellBand = new Uint8Array(cellCount)
    const cellFrac = new Float32Array(cellCount)
    let n = 0
    for (let s = 0; s <= 2 * (GRID - 1); s++) {
      for (let i = Math.max(0, s - GRID + 1); i <= Math.min(s, GRID - 1); i++) {
        const gx = i - half
        const gy = s - i - half
        // Between square and round rings: diamonds on screen with a little diagonal variation.
        const dist = 0.6 * Math.max(Math.abs(gx), Math.abs(gy)) + 0.4 * Math.hypot(gx, gy)
        const pos = dist / maxDist
        const bandPos = Math.pow(pos, 1.2) * (BAND_COUNT - 1)
        const band = Math.min(BAND_COUNT - 2, Math.floor(bandPos))
        cellX[n] = gx
        cellY[n] = gy
        cellPos[n] = pos
        cellDist[n] = dist
        cellBand[n] = band
        cellFrac[n] = bandPos - band
        n++
      }
    }

    const target = new Float32Array(BAND_COUNT)
    const bands = new Float32Array(BAND_COUNT)
    const footprint = Float32Array.from(PROFILES[0])
    const groundX = new Float32Array(FACETS)
    const groundY = new Float32Array(FACETS)
    const vx = new Float32Array(FACETS)
    const vy = new Float32Array(FACETS)
    const shade = new Float32Array(FACETS)
    const visible = new Uint8Array(FACETS)
    const rippleFront = new Float32Array(MAX_RIPPLES)
    const rippleAmp = new Float32Array(MAX_RIPPLES)
    const ripples: Ripple[] = []
    const colors = new Map<number, string>()

    let energy = 0
    let hue = 200
    let section = 0
    let beatsInSection = 0
    let sinceSection = 0
    let taperQuiet: number = TAPERS[0][0]
    let taperLoud: number = TAPERS[0][1]
    let faceStart = 0

    const color = (hueStep: number, lightness: number): string => {
      const l = clamp(Math.round(lightness), 0, 100)
      const key = hueStep * 128 + l
      let c = colors.get(key)
      if (c === undefined) {
        c = `hsl(${hueStep * HUE_STEP},88%,${l}%)`
        colors.set(key, c)
      }
      return c
    }

    /** One camera-facing wall (or several neighbouring ones of equal shade) of the current footprint. */
    const fillWall = (
      ctx: CanvasRenderingContext2D,
      px: number,
      py: number,
      topY: number,
      topScale: number,
      first: number,
      last: number,
      fill: string,
    ) => {
      ctx.fillStyle = fill
      ctx.beginPath()
      ctx.moveTo(px + vx[first % FACETS], py + vy[first % FACETS])
      for (let f = first + 1; f <= last + 1; f++) {
        ctx.lineTo(px + vx[f % FACETS], py + vy[f % FACETS])
      }
      for (let f = last + 1; f >= first; f--) {
        const v = f % FACETS
        ctx.lineTo(px + vx[v] * topScale, topY + vy[v] * topScale)
      }
      ctx.closePath()
      ctx.fill()
    }

    const drawSolid = (
      ctx: CanvasRenderingContext2D,
      px: number,
      py: number,
      heightPx: number,
      topScale: number,
      hueStep: number,
      baseLightness: number,
      taper: number,
    ) => {
      const topY = py - heightPx
      let first = -1
      let last = -1
      let runLightness = -1
      for (let m = 0; m < FACETS; m++) {
        const f = faceStart + m
        const k = f % FACETS
        if (!visible[k]) {
          if (first >= 0) {
            fillWall(ctx, px, py, topY, topScale, first, last, color(hueStep, runLightness))
            first = -1
          }
          continue
        }
        const l = Math.round(baseLightness * (0.68 + 0.26 * shade[k] + 0.12 * taper))
        if (first >= 0 && l !== runLightness) {
          fillWall(ctx, px, py, topY, topScale, first, last, color(hueStep, runLightness))
          first = -1
        }
        if (first < 0) {
          first = f
          runLightness = l
        }
        last = f
      }
      if (first >= 0) fillWall(ctx, px, py, topY, topScale, first, last, color(hueStep, runLightness))

      if (topScale > 0.05) {
        ctx.fillStyle = color(hueStep, Math.min(92, baseLightness))
        ctx.beginPath()
        ctx.moveTo(px + vx[0] * topScale, topY + vy[0] * topScale)
        for (let k = 1; k < FACETS; k++) ctx.lineTo(px + vx[k] * topScale, topY + vy[k] * topScale)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
    }

    return {
      draw(ctx, frame, { width, height }) {
        if (width <= 0 || height <= 0) return
        const { dt, beat } = frame
        const pulse = beat.pulse

        bandSpectrum(frame, target, MIN_HZ, MAX_HZ)
        const period = beat.bpm > 0 ? 60 / beat.bpm : 0.5
        const attack = 1 - Math.exp(-dt / ATTACK_S)
        const release = 1 - Math.exp(-dt / clamp(period * 0.4, 0.09, 0.3))
        for (let i = 0; i < BAND_COUNT; i++) {
          const t = Math.pow(target[i], CONTRAST)
          bands[i] += (t - bands[i]) * (t > bands[i] ? attack : release)
        }
        const drive = (frame.level + frame.bass + frame.mid) / 3
        energy += (drive - energy) * (1 - Math.exp(-dt / 0.25))
        const presence = 0.35 + 0.65 * clamp(energy * 2, 0, 1)

        // Every few bars the footprint, the taper profile and the colour move on.
        sinceSection += dt
        if (beat.onset) {
          beatsInSection++
          if (beat.strength > 0.5) hue += 6
          if (ripples.length >= MAX_RIPPLES) ripples.shift()
          ripples.push({
            age: 0,
            speed: clamp(9 / period, 8, 20),
            strength: 0.5 + 0.5 * beat.strength,
          })
        }
        if (beatsInSection >= BEATS_PER_SECTION || sinceSection > MAX_SECTION_S) {
          beatsInSection = 0
          sinceSection = 0
          section++
          hue += 70
        }
        hue += dt * (8 + 30 * energy)

        const shapeFollow = 1 - Math.exp(-dt / SHAPE_FOLLOW_S)
        const profile = PROFILES[section % PROFILES.length]
        for (let k = 0; k < FACETS; k++) footprint[k] += (profile[k] - footprint[k]) * shapeFollow
        const taperFollow = 1 - Math.exp(-dt / TAPER_FOLLOW_S)
        const taperGoal = TAPERS[section % TAPERS.length]
        taperQuiet += (taperGoal[0] - taperQuiet) * taperFollow
        taperLoud += (taperGoal[1] - taperLoud) * taperFollow

        const u = Math.min(
          (width * 0.92) / (2 * ISO_X * GRID),
          (height * 0.92) / (GRID + HEADROOM),
        )
        const ox = width / 2
        const oy = (height - (GRID + HEADROOM) * u) / 2 + (HEADROOM + GRID / 2) * u

        // Footprint corners relative to a cell centre, in pixels, and which walls face the camera.
        const breathe = 1 + 0.06 * pulse
        for (let k = 0; k < FACETS; k++) {
          groundX[k] = footprint[k] * COS[k]
          groundY[k] = footprint[k] * SIN[k]
          vx[k] = (groundX[k] - groundY[k]) * ISO_X * u * breathe
          vy[k] = (groundX[k] + groundY[k]) * ISO_Y * u * breathe
        }
        for (let k = 0; k < FACETS; k++) {
          const next = (k + 1) % FACETS
          const ex = groundX[next] - groundX[k]
          const ey = groundY[next] - groundY[k]
          const len = Math.hypot(ex, ey) || 1
          const nx = ey / len
          const ny = -ex / len
          visible[k] = nx + ny > 0.02 ? 1 : 0
          // Lit from the left of the screen, so the left wall is brightest and the right darkest.
          shade[k] = 0.5 + 0.5 * (ny - nx) * INV_SQRT2
        }
        faceStart = 0
        for (let k = 0; k < FACETS; k++) {
          if (visible[k] && !visible[(k + FACETS - 1) % FACETS]) {
            faceStart = k
            break
          }
        }

        const reach = maxDist + 3 * RIPPLE_WIDTH
        let live = 0
        for (let r = ripples.length - 1; r >= 0; r--) {
          ripples[r].age += dt
          if (ripples[r].age * ripples[r].speed > reach) ripples.splice(r, 1)
        }
        for (const ripple of ripples) {
          const front = ripple.age * ripple.speed
          rippleFront[live] = front
          rippleAmp[live] = ripple.strength * (1 - front / reach)
          live++
        }

        ctx.globalAlpha = 1
        ctx.fillStyle = STAGE_BACKGROUND
        ctx.fillRect(0, 0, width, height)

        if (pulse > 0.01) {
          const glow = ctx.createRadialGradient(ox, oy, 0, ox, oy, Math.max(width, height) * 0.6)
          glow.addColorStop(0, `hsla(${Math.round(hue) % 360},80%,50%,${(0.3 * pulse).toFixed(3)})`)
          glow.addColorStop(1, `hsla(${Math.round(hue) % 360},80%,50%,0)`)
          ctx.fillStyle = glow
          ctx.fillRect(0, 0, width, height)
        }

        // The floor grid runs off the screen and fades with distance from the centre.
        const lines = Math.ceil((height / u + width / (2 * ISO_X * u)) / 2) + 2
        const gridAlpha = 0.2 + 0.25 * pulse
        const fade = ctx.createRadialGradient(ox, oy, 0, ox, oy, Math.hypot(width, height) * 0.5)
        fade.addColorStop(0, `rgba(240,239,236,${gridAlpha.toFixed(3)})`)
        fade.addColorStop(0.55, `rgba(240,239,236,${(gridAlpha * 0.4).toFixed(3)})`)
        fade.addColorStop(1, 'rgba(240,239,236,0)')
        ctx.strokeStyle = fade
        ctx.lineWidth = Math.max(1, u * 0.025)
        ctx.beginPath()
        for (let k = -lines; k <= lines; k++) {
          const g = k + 0.5
          ctx.moveTo(ox + (-lines - g) * ISO_X * u, oy + (-lines + g) * ISO_Y * u)
          ctx.lineTo(ox + (lines - g) * ISO_X * u, oy + (lines + g) * ISO_Y * u)
          ctx.moveTo(ox + (g + lines) * ISO_X * u, oy + (g - lines) * ISO_Y * u)
          ctx.lineTo(ox + (g - lines) * ISO_X * u, oy + (g + lines) * ISO_Y * u)
        }
        ctx.stroke()

        ctx.strokeStyle = `rgba(255,255,255,${(0.25 + 0.2 * pulse).toFixed(3)})`
        ctx.lineWidth = 1
        ctx.lineJoin = 'round'
        const kick = 1 + 0.1 * pulse
        for (let c = 0; c < cellCount; c++) {
          const band = cellBand[c]
          const level = clamp(bands[band] + (bands[band + 1] - bands[band]) * cellFrac[c], 0, 1)

          let lift = 0
          for (let r = 0; r < live; r++) {
            const d = (cellDist[c] - rippleFront[r]) / RIPPLE_WIDTH
            if (d > -3 && d < 3) lift += rippleAmp[r] * Math.exp(-d * d)
          }
          lift = Math.min(1, lift)

          const h = (MIN_HEIGHT + MAX_HEIGHT * level + RIPPLE_LIFT * lift) * kick
          const taper = taperQuiet + (taperLoud - taperQuiet) * level
          const topScale = Math.max(0, 1 - taper)
          const cellHue = hue + cellPos[c] * HUE_SPAN + level * 55
          const hueStep = Math.round((((cellHue % 360) + 360) % 360) / HUE_STEP) % (360 / HUE_STEP)
          const lightness = Math.min(
            88,
            40 + 14 * presence + 22 * level + 14 * lift + 6 * pulse,
          )

          drawSolid(
            ctx,
            ox + (cellX[c] - cellY[c]) * ISO_X * u,
            oy + (cellX[c] + cellY[c]) * ISO_Y * u,
            h * u,
            topScale,
            hueStep,
            lightness,
            taper,
          )
        }
      },
    }
  },
}
