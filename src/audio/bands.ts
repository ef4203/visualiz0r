export interface SpectrumSource {
  spectrum: Float32Array
  binHz: number
}

/**
 * Resample an FFT spectrum into `out.length` log-spaced bands between
 * `minHz` and `maxHz`. Bands narrower than one FFT bin are interpolated,
 * wider ones are averaged.
 */
export function bandSpectrum(
  src: SpectrumSource,
  out: Float32Array,
  minHz: number,
  maxHz: number,
): void {
  const { spectrum, binHz } = src
  const count = out.length
  const lastBin = spectrum.length - 1
  const ratio = maxHz / minHz
  let f0 = minHz
  for (let k = 0; k < count; k++) {
    const f1 = minHz * Math.pow(ratio, (k + 1) / count)
    const lo = f0 / binHz
    const hi = f1 / binHz
    if (hi - lo < 1) {
      const centre = Math.min((lo + hi) / 2, lastBin - 1)
      const i = Math.floor(centre)
      const t = centre - i
      out[k] = spectrum[i] * (1 - t) + spectrum[i + 1] * t
    } else {
      const a = Math.floor(lo)
      const b = Math.min(Math.ceil(hi), lastBin + 1)
      let sum = 0
      for (let i = a; i < b; i++) sum += spectrum[i]
      out[k] = sum / (b - a)
    }
    f0 = f1
  }
}

export function meanInRange(
  src: SpectrumSource,
  minHz: number,
  maxHz: number,
): number {
  const { spectrum, binHz } = src
  const a = Math.max(1, Math.round(minHz / binHz))
  const b = Math.min(spectrum.length - 1, Math.round(maxHz / binHz))
  if (b < a) return 0
  let sum = 0
  for (let i = a; i <= b; i++) sum += spectrum[i]
  return sum / (b - a + 1)
}
