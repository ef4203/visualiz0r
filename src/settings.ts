// Settings persisted in localStorage so a restart picks up where the last show left off.
// Storage can be missing or throw (private mode, blocked site data), so every access is
// guarded and falls back to the defaults. Several windows on one origin share these keys;
// the last write wins.

export const MIN_BRIGHTNESS = 0.1
export const MAX_BRIGHTNESS = 1
export const BRIGHTNESS_STEP = 0.1

const KEYS = {
  inputDevice: 'visualiz0r.inputDevice',
  visual: 'visualiz0r.visual',
  brightness: 'visualiz0r.brightness',
} as const

type Key = keyof typeof KEYS

export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): SettingsStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function read(key: Key, storage: SettingsStorage | null): string | null {
  try {
    return storage?.getItem(KEYS[key]) ?? null
  } catch {
    return null
  }
}

function write(key: Key, value: string, storage: SettingsStorage | null): void {
  try {
    storage?.setItem(KEYS[key], value)
  } catch {
    // Quota exceeded or storage blocked: the setting just isn't remembered.
  }
}

/** Clamps to the allowed range and rounds to `BRIGHTNESS_STEP`. Non-finite values become full brightness. */
export function clampBrightness(value: number): number {
  if (!Number.isFinite(value)) return MAX_BRIGHTNESS
  const steps = Math.round(value / BRIGHTNESS_STEP)
  // Divide by the inverse so 0.1 steps come out as 0.3, not 0.30000000000000004.
  const rounded = steps / (1 / BRIGHTNESS_STEP)
  return Math.min(MAX_BRIGHTNESS, Math.max(MIN_BRIGHTNESS, rounded))
}

export function loadInputDevice(storage = defaultStorage()): string | undefined {
  return read('inputDevice', storage) || undefined
}

export function saveInputDevice(deviceId: string, storage = defaultStorage()): void {
  if (deviceId) write('inputDevice', deviceId, storage)
}

/** Index of the remembered visual in `ids`, or 0 if none is saved or it no longer exists. */
export function loadVisualIndex(ids: readonly string[], storage = defaultStorage()): number {
  const id = read('visual', storage)
  const index = id === null ? -1 : ids.indexOf(id)
  return index >= 0 ? index : 0
}

export function saveVisual(id: string, storage = defaultStorage()): void {
  write('visual', id, storage)
}

export function loadBrightness(storage = defaultStorage()): number {
  const raw = read('brightness', storage)
  if (raw === null || raw.trim() === '') return MAX_BRIGHTNESS
  return clampBrightness(Number(raw))
}

export function saveBrightness(value: number, storage = defaultStorage()): void {
  write('brightness', String(clampBrightness(value)), storage)
}
