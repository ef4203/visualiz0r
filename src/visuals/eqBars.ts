import { bandSpectrum } from '../audio/bands.ts'
import { INK, STAGE_BACKGROUND, blue } from './palette.ts'
import type { Visualization } from './types.ts'

const BAND_COUNT = 48
const MIN_HZ = 40
const MAX_HZ = 16000
const ROWS = 32
/** >1 pushes quiet bands down so loud ones stand out. */
const CONTRAST = 1.5
const ATTACK_S = 0.02
const PEAK_GRAVITY = 2.4
const UNLIT = 'rgba(255,255,255,0.05)'
const BASELINE = 'rgba(240,239,236,0.2)'
const GLOW = '37,106,191'

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

export const eqBars: Visualization = {
  id: 'eq-bars',
  name: 'EQ Bars',
  create() {
    const target = new Float32Array(BAND_COUNT)
    const level = new Float32Array(BAND_COUNT)
    const peak = new Float32Array(BAND_COUNT)
    const peakHold = new Float32Array(BAND_COUNT)
    const peakFall = new Float32Array(BAND_COUNT)

    return {
      draw(ctx, frame, { width, height }) {
        const { dt, beat } = frame
        bandSpectrum(frame, target, MIN_HZ, MAX_HZ)

        // Tempo shapes the motion: at a faster tempo bars drop back sooner
        // and peak caps are released earlier, so the display stays in time.
        const period = beat.bpm > 0 ? 60 / beat.bpm : 0.5
        const attack = 1 - Math.exp(-dt / ATTACK_S)
        const release = 1 - Math.exp(-dt / clamp(period * 0.4, 0.09, 0.3))
        const holdS = clamp(period * 0.8, 0.25, 0.6)

        for (let i = 0; i < BAND_COUNT; i++) {
          const t = Math.pow(target[i], CONTRAST)
          level[i] += (t - level[i]) * (t > level[i] ? attack : release)
          if (level[i] >= peak[i]) {
            peak[i] = level[i]
            peakHold[i] = holdS
            peakFall[i] = 0
          } else if (peakHold[i] > 0) {
            peakHold[i] -= dt
          } else {
            peakFall[i] += PEAK_GRAVITY * dt
            peak[i] = Math.max(level[i], peak[i] - peakFall[i] * dt)
          }
        }

        const pulse = beat.pulse

        ctx.fillStyle = STAGE_BACKGROUND
        ctx.fillRect(0, 0, width, height)

        if (pulse > 0.01) {
          const radius = Math.max(width, height) * 0.7
          const glow = ctx.createRadialGradient(width / 2, height, 0, width / 2, height, radius)
          glow.addColorStop(0, `rgba(${GLOW},${0.35 * pulse})`)
          glow.addColorStop(1, `rgba(${GLOW},0)`)
          ctx.fillStyle = glow
          ctx.fillRect(0, 0, width, height)
        }

        const marginX = width * 0.05
        const baseY = height * 0.92
        const maxH = height * 0.8
        const pitch = (width - 2 * marginX) / BAND_COUNT
        const barGap = Math.max(2, pitch * 0.16)
        const barW = pitch - barGap
        const rowPitch = maxH / ROWS
        const rowGap = Math.max(2, rowPitch * 0.2)
        const rowH = rowPitch - rowGap
        const boost = 1 + 0.06 * pulse
        const rowTop = (r: number) => baseY - (r + 1) * rowPitch + rowGap

        ctx.fillStyle = UNLIT
        ctx.beginPath()
        for (let i = 0; i < BAND_COUNT; i++) {
          const x = marginX + i * pitch + barGap / 2
          for (let r = 0; r < ROWS; r++) ctx.rect(x, rowTop(r), barW, rowH)
        }
        ctx.fill()

        for (let i = 0; i < BAND_COUNT; i++) {
          const x = marginX + i * pitch + barGap / 2
          const lit = Math.min(1, level[i] * boost) * ROWS
          const full = Math.floor(lit)
          for (let r = 0; r < full; r++) {
            ctx.fillStyle = blue((r / (ROWS - 1)) * 0.85 + 0.15 * pulse)
            ctx.fillRect(x, rowTop(r), barW, rowH)
          }
          if (full < ROWS && lit > full) {
            ctx.globalAlpha = lit - full
            ctx.fillStyle = blue((full / (ROWS - 1)) * 0.85 + 0.15 * pulse)
            ctx.fillRect(x, rowTop(full), barW, rowH)
            ctx.globalAlpha = 1
          }
          const capRow = Math.min(ROWS - 1, Math.floor(peak[i] * ROWS))
          if (capRow >= 1) {
            ctx.fillStyle = INK
            ctx.fillRect(x, rowTop(capRow), barW, rowH)
          }
        }

        ctx.fillStyle = BASELINE
        ctx.fillRect(marginX, baseY + rowGap * 2, width - 2 * marginX, 2)
      },
    }
  },
}
