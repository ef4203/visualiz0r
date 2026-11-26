import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { AudioEngine } from './AudioEngine.ts'

function fakeStream() {
  const track = {
    stopped: false,
    stop() {
      this.stopped = true
    },
    addEventListener() {},
    getSettings: () => ({ deviceId: 'dev' }),
    label: 'Fake input',
  }
  return { track, stream: { getTracks: () => [track], getAudioTracks: () => [track] } }
}

const node = () => ({ connect() {}, disconnect() {}, fftSize: 0, smoothingTimeConstant: 0 })

describe('AudioEngine.start', () => {
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  let pending: Array<(s: ReturnType<typeof fakeStream>) => void> = []
  let contextFails = false

  beforeEach(() => {
    pending = []
    contextFails = false
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: () => new Promise((resolve) => pending.push((s) => resolve(s.stream))),
        },
      },
    })
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      value: class {
        sampleRate = 48000
        state = 'running'
        constructor() {
          if (contextFails) throw new Error('no audio context')
        }
        resume = () => Promise.resolve()
        createAnalyser = node
        createMediaStreamSource = node
      },
    })
  })

  afterEach(() => {
    if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator)
    delete (globalThis as { AudioContext?: unknown }).AudioContext
  })

  it('stops the stream of a start() that a newer start() superseded', async () => {
    const engine = new AudioEngine()
    const first = engine.start('a')
    const second = engine.start('b')
    const a = fakeStream()
    const b = fakeStream()
    pending[0](a)
    pending[1](b)
    await Promise.all([first, second])
    assert.equal(a.track.stopped, true)
    assert.equal(b.track.stopped, false)
    assert.equal(engine.active, true)
  })

  it('stops the stream when stop() is called while start() is in flight', async () => {
    const engine = new AudioEngine()
    const started = engine.start()
    engine.stop()
    const s = fakeStream()
    pending[0](s)
    await started
    assert.equal(s.track.stopped, true)
    assert.equal(engine.active, false)
  })

  it('stops the stream when setting up the audio graph fails', async () => {
    contextFails = true
    const engine = new AudioEngine()
    const started = engine.start()
    const s = fakeStream()
    pending[0](s)
    await assert.rejects(started, /no audio context/)
    assert.equal(s.track.stopped, true)
    assert.equal(engine.active, false)
  })
})
