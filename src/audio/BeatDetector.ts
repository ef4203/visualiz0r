import {
  ONSET_BAND_COUNT,
  ONSET_MAX_HZ,
  ONSET_MIN_HZ,
} from './SpectrumProcessor.ts'

/** Detector runs at most this often, regardless of display refresh rate. */
const TICK_S = 0.014
/** A longer gap (tab switch, GC pause) invalidates the previous spectrum. */
const STALL_S = 0.08
const HISTORY_S = 1.5
const WARMUP_SAMPLES = 20
/** Fastest beat we accept (240 BPM). */
const MIN_INTERVAL_S = 0.25
const THRESHOLD_STD = 2
const THRESHOLD_MIN_RISE = 0.02
/** Minimum weighted band energy for an onset to count, so room hiss never triggers. */
const ENERGY_GATE = 0.03

const MIN_BPM = 70
const MAX_BPM = 160
const BEAT_WINDOW_S = 12
const MAX_BEATS = 24
const MIN_BEATS_FOR_TEMPO = 5
const TEMPO_LOST_S = 6
/** Estimates this close to the current tempo are smoothed, others must repeat. */
const TEMPO_SNAP_BPM = 4
const TEMPO_SWITCH_AFTER = 3

export class BeatDetector {
  onset = false
  strength = 0
  pulse = 0
  bpm = 0
  confidence = 0

  private readonly weights = new Float32Array(ONSET_BAND_COUNT)
  private readonly prev = new Float32Array(ONSET_BAND_COUNT)
  private lastTick = -Infinity
  private lastOnset = -Infinity
  private prevFlux = 0
  private histTimes: number[] = []
  private histValues: number[] = []
  private beats: number[] = []
  private pendingBpm = 0
  private pendingCount = 0

  constructor() {
    // Kick and bass carry the beat; weight low bands most.
    const ratio = ONSET_MAX_HZ / ONSET_MIN_HZ
    let sum = 0
    for (let k = 0; k < ONSET_BAND_COUNT; k++) {
      const centre = ONSET_MIN_HZ * Math.pow(ratio, (k + 0.5) / ONSET_BAND_COUNT)
      this.weights[k] = centre < 250 ? 1 : centre < 2000 ? 0.5 : 0.25
      sum += this.weights[k]
    }
    for (let k = 0; k < ONSET_BAND_COUNT; k++) this.weights[k] /= sum
  }

  update(time: number, dt: number, bands: Float32Array): void {
    this.onset = false
    this.pulse *= Math.exp(-dt / this.pulseDecay())

    const gap = time - this.lastTick
    if (gap < TICK_S) return
    this.lastTick = time

    if (gap > STALL_S) {
      this.prev.set(bands)
      this.histTimes.length = 0
      this.histValues.length = 0
      this.prevFlux = 0
      return
    }

    let flux = 0
    let energy = 0
    for (let k = 0; k < ONSET_BAND_COUNT; k++) {
      const d = bands[k] - this.prev[k]
      if (d > 0) flux += d * this.weights[k]
      energy += bands[k] * this.weights[k]
      this.prev[k] = bands[k]
    }

    const stats = this.history(time)
    this.histTimes.push(time)
    this.histValues.push(flux)

    const threshold =
      stats.mean + THRESHOLD_STD * stats.std + THRESHOLD_MIN_RISE
    const rising = flux > this.prevFlux
    this.prevFlux = flux

    if (
      stats.count >= WARMUP_SAMPLES &&
      energy >= ENERGY_GATE &&
      rising &&
      flux > threshold &&
      time - this.lastOnset >= MIN_INTERVAL_S
    ) {
      this.lastOnset = time
      this.onset = true
      this.strength = clamp01((flux / threshold - 1) * 1.5 + 0.35)
      this.pulse = Math.max(this.pulse, 0.55 + 0.45 * this.strength)
      this.registerBeat(time)
    }

    if (this.bpm > 0 && time - this.lastOnset > TEMPO_LOST_S) {
      this.bpm = 0
      this.confidence = 0
      this.beats.length = 0
      this.pendingBpm = 0
      this.pendingCount = 0
    }
  }

  private pulseDecay(): number {
    const period = this.bpm > 0 ? 60 / this.bpm : 0.5
    return Math.min(0.25, Math.max(0.08, period * 0.3))
  }

  private history(time: number): { mean: number; std: number; count: number } {
    const cutoff = time - HISTORY_S
    let drop = 0
    while (drop < this.histTimes.length && this.histTimes[drop] < cutoff) drop++
    if (drop > 0) {
      this.histTimes.splice(0, drop)
      this.histValues.splice(0, drop)
    }
    const n = this.histValues.length
    if (n === 0) return { mean: 0, std: 0, count: 0 }
    let sum = 0
    for (let i = 0; i < n; i++) sum += this.histValues[i]
    const mean = sum / n
    let sq = 0
    for (let i = 0; i < n; i++) sq += (this.histValues[i] - mean) ** 2
    return { mean, std: Math.sqrt(sq / n), count: n }
  }

  private registerBeat(time: number): void {
    this.beats.push(time)
    while (
      this.beats.length > MAX_BEATS ||
      (this.beats.length > 0 && time - this.beats[0] > BEAT_WINDOW_S)
    ) {
      this.beats.shift()
    }
    if (this.beats.length < MIN_BEATS_FOR_TEMPO) return

    const estimate = estimateTempo(this.beats, time)
    if (!estimate) return
    this.confidence = estimate.confidence

    if (this.bpm === 0) {
      this.bpm = estimate.bpm
    } else if (Math.abs(estimate.bpm - this.bpm) <= TEMPO_SNAP_BPM) {
      this.bpm += (estimate.bpm - this.bpm) * 0.25
      this.pendingCount = 0
    } else if (Math.abs(estimate.bpm - this.pendingBpm) <= TEMPO_SNAP_BPM) {
      if (++this.pendingCount >= TEMPO_SWITCH_AFTER) {
        this.bpm = estimate.bpm
        this.pendingCount = 0
      }
    } else {
      this.pendingBpm = estimate.bpm
      this.pendingCount = 1
    }
  }
}

/**
 * Votes for a tempo using the intervals between every nearby pair of beats.
 * An interval of `ioi` seconds spanning `k` beat periods implies
 * 60 * k / ioi BPM; every k that lands in the accepted range casts a vote,
 * so half/double-time ambiguity is resolved by the consistent candidate.
 */
export function estimateTempo(
  beats: readonly number[],
  now: number,
): { bpm: number; confidence: number } | null {
  const size = Math.ceil(MAX_BPM - MIN_BPM) + 1
  const weight = new Float64Array(size)
  const weightedBpm = new Float64Array(size)
  let total = 0

  for (let j = 1; j < beats.length; j++) {
    const age = now - beats[j]
    const recency = Math.exp(-age / 8)
    for (let i = j - 1; i >= 0 && j - i <= 6; i--) {
      const ioi = beats[j] - beats[i]
      if (ioi > 4) break
      for (let k = 1; k <= 8; k++) {
        const bpm = (60 * k) / ioi
        if (bpm < MIN_BPM || bpm >= MAX_BPM) continue
        const bin = Math.round(bpm - MIN_BPM)
        weight[bin] += recency
        weightedBpm[bin] += recency * bpm
        total += recency
      }
    }
  }
  if (total === 0) return null

  let best = 0
  let bestScore = 0
  for (let b = 0; b < size; b++) {
    let score = 0
    for (let d = -2; d <= 2; d++) {
      const idx = b + d
      if (idx >= 0 && idx < size) score += weight[idx] * (1 - Math.abs(d) / 3)
    }
    if (score > bestScore) {
      bestScore = score
      best = b
    }
  }

  let w = 0
  let wb = 0
  for (let d = -2; d <= 2; d++) {
    const idx = best + d
    if (idx >= 0 && idx < size) {
      w += weight[idx]
      wb += weightedBpm[idx]
    }
  }
  if (w === 0) return null
  return { bpm: wb / w, confidence: clamp01(w / total) }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}
