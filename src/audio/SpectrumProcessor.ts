import { bandSpectrum, meanInRange, type SpectrumSource } from './bands.ts'

export const ONSET_BAND_COUNT = 24
export const ONSET_MIN_HZ = 30
export const ONSET_MAX_HZ = 8000

/** Displayed dynamic range below the (auto-gained) ceiling. */
const RANGE_DB = 60
/** The ceiling never drops below this, so silence and hiss are not amplified. */
const CEIL_MIN_DB = -45
const CEIL_MAX_DB = -10
const HEADROOM_DB = 3
const AGC_ATTACK_S = 0.25
const AGC_RELEASE_DB_PER_S = 3
/** Music rolls off towards the treble; lift it so high bands are readable. */
const TILT_START_HZ = 500
const TILT_DB_PER_OCTAVE = 4
const PEAK_MIN_HZ = 30
const PEAK_MAX_HZ = 16000
const SILENCE_DB = -200

/**
 * Turns raw analyser output (dB per bin) into a 0..1 spectrum with
 * automatic gain, so a quiet microphone and a hot line-in look alike.
 */
export class SpectrumProcessor implements SpectrumSource {
  readonly spectrum: Float32Array
  readonly binHz: number
  readonly onsetBands = new Float32Array(ONSET_BAND_COUNT)
  level = 0
  bass = 0
  mid = 0
  treble = 0

  private readonly tilt: Float32Array
  private readonly peakLoBin: number
  private readonly peakHiBin: number
  private agcDb = CEIL_MIN_DB

  constructor(spectrum: Float32Array, binHz: number) {
    this.spectrum = spectrum
    this.binHz = binHz
    this.tilt = new Float32Array(spectrum.length)
    for (let i = 1; i < spectrum.length; i++) {
      const f = i * binHz
      this.tilt[i] =
        f > TILT_START_HZ ? TILT_DB_PER_OCTAVE * Math.log2(f / TILT_START_HZ) : 0
    }
    this.peakLoBin = Math.max(1, Math.floor(PEAK_MIN_HZ / binHz))
    this.peakHiBin = Math.min(spectrum.length - 1, Math.ceil(PEAK_MAX_HZ / binHz))
  }

  process(db: Float32Array, dt: number): void {
    const { spectrum, tilt } = this

    let peak = SILENCE_DB
    for (let i = this.peakLoBin; i <= this.peakHiBin; i++) {
      const v = db[i] + tilt[i]
      if (v > peak) peak = v
    }
    if (peak > this.agcDb) {
      this.agcDb += (peak - this.agcDb) * (1 - Math.exp(-dt / AGC_ATTACK_S))
    } else {
      this.agcDb = Math.max(peak, this.agcDb - AGC_RELEASE_DB_PER_S * dt)
    }

    const ceil = Math.min(CEIL_MAX_DB, Math.max(CEIL_MIN_DB, this.agcDb + HEADROOM_DB))
    const floor = ceil - RANGE_DB
    const inv = 1 / RANGE_DB
    spectrum[0] = 0
    for (let i = 1; i < spectrum.length; i++) {
      const x = (Math.max(db[i], SILENCE_DB) + tilt[i] - floor) * inv
      spectrum[i] = x < 0 ? 0 : x > 1 ? 1 : x
    }

    this.level = meanInRange(this, 40, 10000)
    this.bass = meanInRange(this, 30, 150)
    this.mid = meanInRange(this, 150, 2000)
    this.treble = meanInRange(this, 2000, 12000)
    bandSpectrum(this, this.onsetBands, ONSET_MIN_HZ, ONSET_MAX_HZ)
  }
}
