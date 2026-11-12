import { STAGE_BACKGROUND } from './palette.ts'
import type { Visualization } from './types.ts'

/** Tiles along the short side of the screen. */
const TILES_SHORT_SIDE = 12

/**
 * Photosensitivity cap: large-area flashes must stay at or below about 3 full-screen
 * equivalents per second (cf. WCAG 2.3.1, three flashes per second), because live events
 * include photosensitive viewers. Every flip pays its screen fraction from a token bucket.
 * This is unconditional on purpose: there is no way to turn it off.
 */
const MAX_FULLSCREEN_FLIPS_PER_S = 3
const BUCKET_CAP = 1

const FALLBACK_BEAT_PERIOD_S = 0.5
const TILE_HOLD_BEATS = 0.25
const BLOCK_HOLD_BEATS = 0.5

/** Kick block covers this share of the screen, scaled by beat strength. */
const BLOCK_AREA_MIN = 1 / 6
const BLOCK_AREA_MAX = 1 / 4

const SECTION_BEATS = [8, 16]

/** Local band onset detection: a band must exceed its slow average by `RISE` and `MIN_LEVEL`. */
const AVG_TAU_S = 0.6
const MIN_LEVEL = 0.12
const SNARE_RISE = 0.12
const SNARE_REFRACTORY_S = 0.12
const HAT_RISE = 0.1
const HAT_REFRACTORY_S = 0.05

const PATTERN_COUNT = 4

/** Lit tiles are filled with one diagonal gradient whose hue range drifts slowly. */
const HUE_SPAN = 150
const HUE_DRIFT_DEG_PER_S = 8
const GRADIENT_STOPS = 5
const SATURATION = 90
const LIGHTNESS = 58

interface Grid {
  cols: number
  rows: number
  tile: number
}

function pickDifferent(count: number, previous: number): number {
  if (count <= 1) return 0
  let n = Math.floor(Math.random() * (count - 1))
  if (n >= previous) n++
  return n
}

function fillPattern(out: Uint8Array, { cols, rows }: Grid, pattern: number) {
  out.fill(0)
  switch (pattern) {
    case 0:
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) out[r * cols + c] = r & 1
      break
    case 1:
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) out[r * cols + c] = (r + c) & 1
      break
    case 2:
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) out[r * cols + c] = ((r + c) >> 1) & 1
      break
    default: {
      const clusters = Math.max(3, Math.round((cols * rows) / 14))
      for (let k = 0; k < clusters; k++) {
        const w = 1 + Math.floor(Math.random() * 3)
        const h = 1 + Math.floor(Math.random() * 3)
        const c0 = Math.floor(Math.random() * cols)
        const r0 = Math.floor(Math.random() * rows)
        for (let r = r0; r < Math.min(rows, r0 + h); r++)
          for (let c = c0; c < Math.min(cols, c0 + w); c++)
            out[r * cols + c] = 1
      }
    }
  }
}

export const tileStrobe: Visualization = {
  id: 'tile-strobe',
  name: 'Tile Strobe',
  create() {
    let grid: Grid = { cols: 0, rows: 0, tile: 0 }
    let base = new Uint8Array(0)
    let next = new Uint8Array(0)
    /** Time at which each tile stops being inverted; 0 means not flipped. */
    let flipUntil = new Float64Array(0)

    let pattern = -1
    let pendingSection = false
    let beatsInSection = 0
    let sectionLength = SECTION_BEATS[0]
    let tokens = BUCKET_CAP

    let avgMid = 0
    let avgTreble = 0
    let midHigh = false
    let trebleHigh = false
    let lastSnare = -Infinity
    let lastHat = -Infinity
    let lastBlock = -1
    let lastWidth = 0
    let lastHeight = 0

    const relayout = (width: number, height: number) => {
      const tile = Math.min(width, height) / TILES_SHORT_SIDE
      grid = {
        tile,
        cols: Math.ceil(width / tile - 1e-6),
        rows: Math.ceil(height / tile - 1e-6),
      }
      const n = grid.cols * grid.rows
      base = new Uint8Array(n)
      next = new Uint8Array(n)
      flipUntil = new Float64Array(n)
      if (pattern < 0) pattern = Math.floor(Math.random() * PATTERN_COUNT)
      fillPattern(base, grid, pattern)
      if (pendingSection) fillPattern(next, grid, pattern)
    }

    const pay = (fraction: number): boolean => {
      if (tokens < fraction) return false
      tokens -= fraction
      return true
    }

    const flipRect = (
      c0: number,
      r0: number,
      w: number,
      h: number,
      until: number,
    ) => {
      const { cols, rows } = grid
      const c1 = Math.min(cols, c0 + w)
      const r1 = Math.min(rows, r0 + h)
      if (!pay(((c1 - c0) * (r1 - r0)) / (cols * rows))) return
      for (let r = r0; r < r1; r++)
        for (let c = c0; c < c1; c++) flipUntil[r * cols + c] = until
    }

    return {
      draw(ctx, frame, { width, height }) {
        if (width <= 0 || height <= 0) return
        const { time, dt, beat } = frame

        if (grid.tile === 0 || width !== lastWidth || height !== lastHeight) {
          lastWidth = width
          lastHeight = height
          relayout(width, height)
        }
        const { cols, rows, tile } = grid
        const total = cols * rows

        tokens = Math.min(BUCKET_CAP, tokens + MAX_FULLSCREEN_FLIPS_PER_S * dt)

        const period = beat.bpm > 0 ? 60 / beat.bpm : FALLBACK_BEAT_PERIOD_S
        const tileHold = time + period * TILE_HOLD_BEATS
        const blockHold = time + period * BLOCK_HOLD_BEATS

        if (beat.onset) {
          // Kick: one big block.
          const area =
            BLOCK_AREA_MIN +
            (BLOCK_AREA_MAX - BLOCK_AREA_MIN) * Math.min(1, beat.strength)
          const side = Math.sqrt(area)
          const bw = Math.max(1, Math.round(cols * side))
          const bh = Math.max(1, Math.round(rows * side))
          const slots = (cols - bw + 1) * (rows - bh + 1)
          let slot = pickDifferent(slots, lastBlock)
          if (slots <= 1) slot = 0
          lastBlock = slot
          flipRect(
            slot % (cols - bw + 1),
            Math.floor(slot / (cols - bw + 1)),
            bw,
            bh,
            blockHold,
          )

          if (++beatsInSection >= sectionLength) {
            beatsInSection = 0
            sectionLength =
              SECTION_BEATS[Math.floor(Math.random() * SECTION_BEATS.length)]
            pattern = pickDifferent(PATTERN_COUNT, pattern)
            fillPattern(next, grid, pattern)
            pendingSection = true
          }
        }

        // Snare: rising edge of mid over its slow average.
        const midRising =
          frame.mid > MIN_LEVEL && frame.mid > avgMid + SNARE_RISE
        if (midRising && !midHigh && time - lastSnare >= SNARE_REFRACTORY_S) {
          lastSnare = time
          const w = 1 + Math.floor(Math.random() * 2)
          flipRect(Math.floor(Math.random() * cols), 0, w, rows, blockHold)
        }
        midHigh = midRising
        avgMid += (frame.mid - avgMid) * (1 - Math.exp(-dt / AVG_TAU_S))

        // Hi-hat: rising edge of treble, one random tile.
        const trebleRising =
          frame.treble > MIN_LEVEL && frame.treble > avgTreble + HAT_RISE
        if (trebleRising && !trebleHigh && time - lastHat >= HAT_REFRACTORY_S) {
          lastHat = time
          flipRect(
            Math.floor(Math.random() * cols),
            Math.floor(Math.random() * rows),
            1,
            1,
            tileHold,
          )
        }
        trebleHigh = trebleRising
        avgTreble +=
          (frame.treble - avgTreble) * (1 - Math.exp(-dt / AVG_TAU_S))

        // Section change costs the share of tiles it changes; retried each frame until paid.
        if (pendingSection) {
          let changed = 0
          for (let i = 0; i < total; i++) if (base[i] !== next[i]) changed++
          if (pay(changed / total)) {
            const t = base
            base = next
            next = t
            pendingSection = false
          }
        }

        ctx.fillStyle = STAGE_BACKGROUND
        ctx.fillRect(0, 0, width, height)
        const gradient = ctx.createLinearGradient(0, 0, width, height)
        const hue0 = (time * HUE_DRIFT_DEG_PER_S) % 360
        for (let i = 0; i < GRADIENT_STOPS; i++) {
          const t = i / (GRADIENT_STOPS - 1)
          gradient.addColorStop(
            t,
            `hsl(${((hue0 + t * HUE_SPAN) % 360).toFixed(0)} ${SATURATION}% ${LIGHTNESS}%)`,
          )
        }
        ctx.fillStyle = gradient
        ctx.beginPath()
        for (let r = 0; r < rows; r++) {
          const y0 = Math.round(r * tile)
          const y1 =
            r === rows - 1 ? Math.ceil(height) : Math.round((r + 1) * tile)
          for (let c = 0; c < cols; c++) {
            const i = r * cols + c
            if ((base[i] === 1) === flipUntil[i] > time) continue
            const x0 = Math.round(c * tile)
            const x1 =
              c === cols - 1 ? Math.ceil(width) : Math.round((c + 1) * tile)
            ctx.rect(x0, y0, x1 - x0, y1 - y0)
          }
        }
        ctx.fill()
      },
    }
  },
}
