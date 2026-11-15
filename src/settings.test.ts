import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_BRIGHTNESS,
  MIN_BRIGHTNESS,
  clampBrightness,
  loadBrightness,
  loadInputDevice,
  loadVisualIndex,
  saveBrightness,
  saveInputDevice,
  saveVisual,
  type SettingsStorage,
} from './settings.ts'

function memoryStorage(): SettingsStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
}

const throwingStorage: SettingsStorage = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('quota')
  },
}

const IDS = ['eq-bars', 'warp-tunnel', 'laser-rig']

test('defaults when nothing is saved', () => {
  const s = memoryStorage()
  assert.equal(loadVisualIndex(IDS, s), 0)
  assert.equal(loadBrightness(s), MAX_BRIGHTNESS)
  assert.equal(loadInputDevice(s), undefined)
})

test('round-trips the visual by id', () => {
  const s = memoryStorage()
  saveVisual('laser-rig', s)
  assert.equal(loadVisualIndex(IDS, s), 2)
  // Survives a reordered menu.
  assert.equal(loadVisualIndex(['laser-rig', 'eq-bars'], s), 0)
})

test('falls back to the first visual when the saved one no longer exists', () => {
  const s = memoryStorage()
  saveVisual('removed-visual', s)
  assert.equal(loadVisualIndex(IDS, s), 0)
})

test('round-trips brightness', () => {
  const s = memoryStorage()
  saveBrightness(0.7, s)
  assert.equal(loadBrightness(s), 0.7)
})

test('restores the exact brightness, even at the minimum', () => {
  const s = memoryStorage()
  saveBrightness(MIN_BRIGHTNESS, s)
  assert.equal(loadBrightness(s), MIN_BRIGHTNESS)
})

test('sanitizes stored brightness', () => {
  const s = memoryStorage()
  for (const [raw, expected] of [
    ['0', MIN_BRIGHTNESS],
    ['-3', MIN_BRIGHTNESS],
    ['7', MAX_BRIGHTNESS],
    ['NaN', MAX_BRIGHTNESS],
    ['abc', MAX_BRIGHTNESS],
    ['', MAX_BRIGHTNESS],
    ['0.64', 0.6],
  ] as const) {
    s.data.set('visualiz0r.brightness', raw)
    assert.equal(loadBrightness(s), expected, `stored ${JSON.stringify(raw)}`)
  }
})

test('clampBrightness rounds to 10% steps within range', () => {
  assert.equal(clampBrightness(0.7 + 0.1), 0.8)
  assert.equal(clampBrightness(0.2 + 0.1), 0.3)
  assert.equal(clampBrightness(0.05), MIN_BRIGHTNESS)
  assert.equal(clampBrightness(1.2), MAX_BRIGHTNESS)
  assert.equal(clampBrightness(Infinity), MAX_BRIGHTNESS)
})

test('round-trips the input device and ignores empty ids', () => {
  const s = memoryStorage()
  saveInputDevice('', s)
  assert.equal(s.data.size, 0)
  saveInputDevice('abc123', s)
  assert.equal(loadInputDevice(s), 'abc123')
})

test('falls back to defaults when storage throws or is missing', () => {
  assert.doesNotThrow(() => {
    saveVisual('laser-rig', throwingStorage)
    saveBrightness(0.5, throwingStorage)
    saveInputDevice('abc', throwingStorage)
  })
  assert.equal(loadVisualIndex(IDS, throwingStorage), 0)
  assert.equal(loadBrightness(throwingStorage), MAX_BRIGHTNESS)
  assert.equal(loadInputDevice(throwingStorage), undefined)
  assert.equal(loadVisualIndex(IDS, null), 0)
  assert.equal(loadBrightness(null), MAX_BRIGHTNESS)
})
