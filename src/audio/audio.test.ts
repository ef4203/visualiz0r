import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bandSpectrum } from './bands.ts'
import { BeatDetector, estimateTempo } from './BeatDetector.ts'
import { ONSET_BAND_COUNT, SpectrumProcessor } from './SpectrumProcessor.ts'

const DT = 1 / 60

/** Feeds a click track (loud for 10% of each beat) and returns the next time and onset count. */
function feedClicks(det: BeatDetector, bpm: number, seconds: number, start = 0) {
  const bands = new Float32Array(ONSET_BAND_COUNT)
  const period = 60 / bpm
  let onsets = 0
  let t = start
  const end = start + seconds
  for (; t < end; t += DT) {
    bands.fill((t - start) % period < period * 0.1 ? 1 : 0.1)
    det.update(t, DT, bands)
    if (det.onset) onsets++
  }
  return { t, onsets }
}

test('BeatDetector locks onto a click track', () => {
  for (const bpm of [128, 100]) {
    const det = new BeatDetector()
    const { onsets } = feedClicks(det, bpm, 30)
    assert.ok(Math.abs(det.bpm - bpm) <= 1.5, `${bpm}: got ${det.bpm}`)
    assert.ok(onsets > 0 && onsets < 30 * 60 * 0.2, `${bpm}: ${onsets} onsets`)
  }
})

test('BeatDetector drops the tempo after silence', () => {
  const det = new BeatDetector()
  const { t } = feedClicks(det, 128, 30)
  assert.ok(det.bpm > 0)
  const silent = new Float32Array(ONSET_BAND_COUNT)
  for (let i = 0; i < 7 * 60; i++) det.update(t + i * DT, DT, silent)
  assert.equal(det.bpm, 0)
  assert.equal(det.confidence, 0)
})

test('estimateTempo accepts exactly 160 BPM without halving it', () => {
  const beats = Array.from({ length: 10 }, (_, i) => (i * 60) / 160)
  const est = estimateTempo(beats, beats[beats.length - 1])
  assert.ok(est)
  assert.ok(Math.abs(est.bpm - 160) <= 1, `got ${est.bpm}`)
})

test('bandSpectrum puts a 1 kHz bin in the band that contains 1 kHz', () => {
  const binHz = 11.72
  const spectrum = new Float32Array(2048)
  spectrum[Math.round(1000 / binHz)] = 1
  const out = new Float32Array(24)
  bandSpectrum({ spectrum, binHz }, out, 30, 8000)
  let best = 0
  for (let k = 1; k < out.length; k++) if (out[k] > out[best]) best = k
  const edge = (k: number) => 30 * Math.pow(8000 / 30, k / 24)
  assert.ok(out[best] > 0)
  assert.ok(edge(best) <= 1000 && 1000 <= edge(best + 1), `band ${best}`)
})

test('SpectrumProcessor handles silence and normalises a loud tone', () => {
  const binHz = 11.72
  const proc = new SpectrumProcessor(new Float32Array(2048), binHz)
  const silent = new Float32Array(2048).fill(-Infinity)
  proc.process(silent, DT)
  assert.ok(proc.spectrum.every((v) => v === 0))
  assert.equal(proc.level, 0)
  assert.ok(proc.onsetBands.every((v) => Number.isFinite(v)))

  const tone = new Float32Array(2048).fill(-120)
  tone[Math.round(1000 / binHz)] = -20
  for (let i = 0; i < 30; i++) proc.process(tone, DT)
  assert.ok(Math.max(...proc.spectrum) > 0.99)
})
