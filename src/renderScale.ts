const WINDOW_FRAMES = 30
const MIN_SCALE = 0.5
const DOWN_STEP = 0.8
const UP_STEP = 1.25
const SLOW_RATIO = 1.4
const FAST_RATIO = 1.15
const BASE_GOOD_WINDOWS = 4
const MAX_GOOD_WINDOWS = 64
/** Gaps longer than this (hidden tab, breakpoint) say nothing about render cost. */
const MAX_VALID_DT_MS = 250
/** Consecutive long gaps are real slowness (a hidden tab yields one gap, not a run). */
const LONG_GAP_RUN = 5
/** Below roughly 42fps is slow whatever the learned baseline says. */
const SLOW_ABS_MS = 24
/** Share of the gap between baseline and average the baseline drifts up per window. */
const REFRESH_DRIFT = 0.02
/** Windows after a raise in which a slow window counts as a failed raise. */
const PROBATION_WINDOWS = 4

export interface RenderScaler {
  /** Feed the rAF timestamp each frame. Returns the new scale when it changed, otherwise null. */
  update(nowMs: number): number | null
  readonly scale: number
}

/**
 * Multiplier (MIN_SCALE..1) for the canvas resolution. Drops when the average frame time
 * is well above the best the display has shown (or under ~42fps), and creeps back up after
 * sustained headroom. The baseline drifts upward slowly so a changed or throttled display
 * is eventually accepted. Every failed attempt to scale back up doubles the wait before the
 * next one, and the wait resets once full scale holds.
 */
export function createRenderScaler(): RenderScaler {
  let scale = 1
  let last = -1
  let sum = 0
  let count = 0
  let refresh = Infinity
  let goodWindows = 0
  let goodNeeded = BASE_GOOD_WINDOWS
  let probation = 0
  let longRun = 0

  return {
    get scale() {
      return scale
    },
    update(now) {
      let dt = last < 0 ? -1 : now - last
      last = now
      if (dt < 0) return null
      if (dt > MAX_VALID_DT_MS) {
        if (++longRun < LONG_GAP_RUN) {
          sum = 0
          count = 0
          return null
        }
        dt = MAX_VALID_DT_MS
      } else {
        longRun = 0
      }
      sum += dt
      if (++count < WINDOW_FRAMES) return null

      const avg = sum / count
      sum = 0
      count = 0
      refresh = avg < refresh ? avg : refresh + (avg - refresh) * REFRESH_DRIFT

      if ((avg > refresh * SLOW_RATIO || avg > SLOW_ABS_MS) && scale > MIN_SCALE) {
        if (probation > 0) goodNeeded = Math.min(MAX_GOOD_WINDOWS, goodNeeded * 2)
        probation = 0
        goodWindows = 0
        scale = Math.max(MIN_SCALE, scale * DOWN_STEP)
        return scale
      }
      // Only a raise that reaches full scale and holds forgives the earlier failures.
      if (probation > 0 && --probation === 0 && scale === 1) goodNeeded = BASE_GOOD_WINDOWS
      if (avg < refresh * FAST_RATIO && avg <= SLOW_ABS_MS && scale < 1) {
        if (++goodWindows >= goodNeeded) {
          goodWindows = 0
          probation = PROBATION_WINDOWS
          scale = Math.min(1, scale * UP_STEP)
          return scale
        }
      } else {
        goodWindows = 0
      }
      return null
    },
  }
}
