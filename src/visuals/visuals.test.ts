import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import type { AudioFrame } from '../audio/types.ts'
import { visualizations } from './index.ts'
import type { Size, VisualizationInstance } from './types.ts'

interface MockContext {
  ctx: CanvasRenderingContext2D
  /** Number of draw operations recorded. */
  calls: () => number
  /** Anything a real canvas would silently ignore or throw on. */
  problems: string[]
  /** Unbalanced save/restore depth. */
  saveDepth: () => number
}

const DEFAULT_PROPS: Record<string, unknown> = {
  globalAlpha: 1,
  lineWidth: 1,
  globalCompositeOperation: 'source-over',
  fillStyle: '#000000',
  strokeStyle: '#000000',
  lineJoin: 'miter',
  imageSmoothingEnabled: true,
  imageSmoothingQuality: 'low',
}

function checkValue(where: string, value: unknown, problems: string[]): void {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    problems.push(`${where}: non-finite number ${value}`)
  } else if (typeof value === 'string' && /NaN|undefined|Infinity/.test(value)) {
    problems.push(`${where}: bad string "${value}"`)
  }
}

/** A 2D context that records misuse instead of painting. Unknown methods are accepted. */
function createMockContext(): MockContext {
  const state: Record<string, unknown> = { ...DEFAULT_PROPS }
  const problems: string[] = []
  let calls = 0
  let depth = 0

  const gradient = (name: string) => ({
    addColorStop(offset: number, color: string) {
      checkValue(`${name}.addColorStop`, offset, problems)
      checkValue(`${name}.addColorStop`, color, problems)
      if (!(offset >= 0 && offset <= 1)) problems.push(`${name}: stop offset ${offset} outside 0..1`)
    },
  })

  const ctx = new Proxy(state, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined
      if (prop in target) return target[prop]
      return (...args: unknown[]) => {
        args.forEach((arg, i) => checkValue(`${prop}[${i}]`, arg, problems))
        if (prop === 'save') depth++
        else if (prop === 'restore') {
          if (depth === 0) problems.push('restore without matching save')
          else depth--
        } else if (prop === 'createRadialGradient') {
          if (Number(args[2]) < 0 || Number(args[5]) < 0) problems.push('negative gradient radius')
        } else if (prop === 'arc' && Number(args[2]) < 0) {
          problems.push('negative arc radius')
        }
        if (prop.startsWith('create')) return gradient(prop)
        if (prop !== 'save' && prop !== 'restore') calls++
        return undefined
      }
    },
    set(target, prop, value) {
      if (typeof prop === 'string') checkValue(`set ${prop}`, value, problems)
      target[prop as string] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D

  return { ctx, calls: () => calls, problems, saveDepth: () => depth }
}

/** Deterministic PRNG so a failure is reproducible. */
function createRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

function createFrame(bins = 1024): AudioFrame {
  return {
    dt: 1 / 60,
    time: 0,
    spectrum: new Float32Array(bins),
    binHz: 24000 / bins,
    level: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    beat: { onset: false, strength: 0, pulse: 0, bpm: 0, confidence: 0 },
  }
}

type Scenario = 'silence' | 'music' | 'unknown-tempo' | 'saturated'

/** Mutates the shared frame in place, like the engine does. */
function advance(frame: AudioFrame, scenario: Scenario, index: number, random: () => number): void {
  frame.time += frame.dt
  const { spectrum, beat } = frame
  const onset = scenario !== 'silence' && index % 30 === 0

  for (let i = 0; i < spectrum.length; i++) {
    const rolloff = 1 - i / spectrum.length
    spectrum[i] =
      scenario === 'silence' ? 0 : scenario === 'saturated' ? 1 : random() * rolloff
  }

  const loud = scenario === 'silence' ? 0 : scenario === 'saturated' ? 1 : 0.4 + random() * 0.4
  frame.level = loud
  frame.bass = scenario === 'silence' ? 0 : onset ? 1 : loud
  frame.mid = loud
  frame.treble = scenario === 'silence' ? 0 : random()

  beat.onset = onset
  beat.strength = onset ? 0.5 + random() * 0.5 : beat.strength
  beat.pulse = onset ? 1 : beat.pulse * 0.9
  beat.bpm = scenario === 'music' || scenario === 'saturated' ? 128 : 0
  beat.confidence = beat.bpm > 0 ? 0.8 : 0
}

const SIZES: Size[] = [
  { width: 1920, height: 1080 },
  { width: 600, height: 900 },
  { width: 64, height: 64 },
]
const SCENARIOS: Scenario[] = ['silence', 'music', 'unknown-tempo', 'saturated']
const FRAMES = 150

function run(instance: VisualizationInstance, mock: MockContext, size: Size, scenario: Scenario): void {
  const frame = createFrame()
  const random = createRandom(1)
  for (let i = 0; i < FRAMES; i++) {
    advance(frame, scenario, i, random)
    instance.draw(mock.ctx, frame, size)
  }
}

describe('visual registry', () => {
  it('is not empty', () => {
    assert.ok(visualizations.length > 0)
  })

  it('has unique, non-empty ids and names', () => {
    const ids = visualizations.map((v) => v.id)
    const names = visualizations.map((v) => v.name)
    assert.ok(ids.every((id) => /^[a-z0-9-]+$/.test(id)), `ids must be kebab-case: ${ids}`)
    assert.ok(names.every((name) => name.trim().length > 0))
    assert.equal(new Set(ids).size, ids.length, 'ids must be unique')
    assert.equal(new Set(names).size, names.length, 'names must be unique')
  })
})

describe('visuals', () => {
  const realDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')

  let offscreen: MockContext[] = []

  function assertOffscreenClean(): void {
    for (const mock of offscreen) {
      assert.deepEqual(mock.problems.slice(0, 5), [], 'offscreen canvas')
      assert.equal(mock.saveDepth(), 0, 'offscreen canvas: every save() needs a restore()')
    }
  }

  // psychedelic renders into offscreen buffers created through the DOM.
  beforeEach(() => {
    offscreen = []
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement: () => ({
          width: 0,
          height: 0,
          getContext: () => {
            const mock = createMockContext()
            offscreen.push(mock)
            return mock.ctx
          },
        }),
      },
    })
  })

  afterEach(() => {
    if (realDocument) Object.defineProperty(globalThis, 'document', realDocument)
    else delete (globalThis as { document?: unknown }).document
  })

  for (const visual of visualizations) {
    describe(`${visual.id}`, () => {
      it('creates instances with a draw function', () => {
        const instance = visual.create()
        assert.equal(typeof instance.draw, 'function')
        assert.ok(instance.dispose === undefined || typeof instance.dispose === 'function')
        instance.dispose?.()
      })

      it('creates independent instances', () => {
        const a = visual.create()
        const b = visual.create()
        assert.notEqual(a, b)
        a.dispose?.()
        b.dispose?.()
      })

      for (const scenario of SCENARIOS) {
        it(`draws valid output for "${scenario}" audio at every size`, () => {
          for (const size of SIZES) {
            const instance = visual.create()
            const mock = createMockContext()
            assert.doesNotThrow(() => run(instance, mock, size, scenario))
            assert.ok(mock.calls() > 0, 'draw must paint something')
            assert.deepEqual(mock.problems.slice(0, 5), [], `${size.width}x${size.height}`)
            assert.equal(mock.saveDepth(), 0, 'every save() needs a restore()')
            assertOffscreenClean()
            instance.dispose?.()
          }
        })
      }

      it('keeps working when the stage is resized mid-run', () => {
        const instance = visual.create()
        const mock = createMockContext()
        const frame = createFrame()
        const random = createRandom(2)
        for (let i = 0; i < FRAMES; i++) {
          advance(frame, 'music', i, random)
          instance.draw(mock.ctx, frame, SIZES[i % SIZES.length])
        }
        assert.deepEqual(mock.problems.slice(0, 5), [])
        assertOffscreenClean()
        instance.dispose?.()
      })

      it('does not modify the audio frame', () => {
        const instance = visual.create()
        const mock = createMockContext()
        const frame = createFrame()
        advance(frame, 'music', 0, createRandom(3))
        const before = structuredClone(frame)
        instance.draw(mock.ctx, frame, SIZES[0])
        assert.deepEqual(frame, before)
        instance.dispose?.()
      })

      it('can be disposed after drawing', () => {
        const instance = visual.create()
        run(instance, createMockContext(), SIZES[0], 'music')
        assert.doesNotThrow(() => instance.dispose?.())
      })
    })
  }
})
