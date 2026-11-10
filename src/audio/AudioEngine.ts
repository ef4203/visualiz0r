import { BeatDetector } from './BeatDetector.ts'
import { SpectrumProcessor } from './SpectrumProcessor.ts'
import type { AudioFrame } from './types.ts'

const FFT_SIZE = 4096
const MAX_DT_S = 0.1

export interface AudioInputDevice {
  deviceId: string
  label: string
}

/** Owns the audio input stream and turns it into one `AudioFrame` per call to `update`. */
export class AudioEngine {
  private readonly endedListeners = new Set<() => void>()
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private stream: MediaStream | null = null
  private processor: SpectrumProcessor | null = null
  private readonly beat = new BeatDetector()
  private readonly fft = new Float32Array(FFT_SIZE / 2)
  private lastTime = 0
  private startToken = 0

  private readonly frame: AudioFrame = {
    dt: 1 / 60,
    time: 0,
    spectrum: new Float32Array(FFT_SIZE / 2),
    binHz: 48000 / FFT_SIZE,
    level: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    beat: { onset: false, strength: 0, pulse: 0, bpm: 0, confidence: 0 },
  }

  /** Subscribe to the active input disappearing (unplugged, permission revoked). Returns an unsubscribe function. */
  subscribeEnded(listener: () => void): () => void {
    this.endedListeners.add(listener)
    return () => {
      this.endedListeners.delete(listener)
    }
  }

  get active(): boolean {
    return this.stream !== null
  }

  get deviceId(): string | null {
    return this.stream?.getAudioTracks()[0]?.getSettings().deviceId ?? null
  }

  get deviceLabel(): string {
    return this.stream?.getAudioTracks()[0]?.label ?? ''
  }

  /**
   * Open an input and start analysing it. Must be triggered by a user gesture
   * the first time so the AudioContext is allowed to run.
   */
  async start(deviceId?: string): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        'Audio capture is unavailable. Open this page over https:// or on localhost.',
      )
    }
    const token = ++this.startToken
    this.release()

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
    if (token !== this.startToken) {
      for (const track of stream.getTracks()) track.stop()
      return
    }

    const ctx = (this.ctx ??= new AudioContext({ latencyHint: 'interactive' }))
    await ctx.resume()
    if (token !== this.startToken) {
      for (const track of stream.getTracks()) track.stop()
      return
    }

    if (!this.analyser) {
      const analyser = ctx.createAnalyser()
      analyser.fftSize = FFT_SIZE
      analyser.smoothingTimeConstant = 0
      this.analyser = analyser
      this.frame.binHz = ctx.sampleRate / FFT_SIZE
      this.processor = new SpectrumProcessor(this.frame.spectrum, this.frame.binHz)
    }

    // The analyser is deliberately not connected to ctx.destination: that would
    // route the input to the speakers and cause feedback with a live microphone.
    this.source = ctx.createMediaStreamSource(stream)
    this.source.connect(this.analyser)
    this.stream = stream
    this.lastTime = 0

    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        if (this.stream === stream) {
          this.release()
          for (const listener of this.endedListeners) listener()
        }
      })
    }
  }

  stop(): void {
    this.startToken++
    this.release()
  }

  async resume(): Promise<void> {
    if (this.ctx?.state === 'suspended') await this.ctx.resume()
  }

  /** Sample the analyser. Call once per animation frame, with the rAF timestamp in ms. */
  update(nowMs: number): AudioFrame {
    const frame = this.frame
    const time = nowMs / 1000
    const dt = this.lastTime === 0 ? 1 / 60 : Math.min(MAX_DT_S, Math.max(0, time - this.lastTime))
    this.lastTime = time
    frame.dt = dt
    frame.time = time

    const { analyser, processor } = this
    if (analyser && processor && this.stream) {
      analyser.getFloatFrequencyData(this.fft)
      processor.process(this.fft, dt)
      this.beat.update(time, dt, processor.onsetBands)
      frame.level = processor.level
      frame.bass = processor.bass
      frame.mid = processor.mid
      frame.treble = processor.treble
    } else {
      frame.spectrum.fill(0)
      frame.level = frame.bass = frame.mid = frame.treble = 0
    }

    const b = frame.beat
    b.onset = this.beat.onset
    b.strength = this.beat.strength
    b.pulse = this.beat.pulse
    b.bpm = this.beat.bpm
    b.confidence = this.beat.confidence
    return frame
  }

  private release(): void {
    this.source?.disconnect()
    this.source = null
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop()
      this.stream = null
    }
  }
}

export async function listAudioInputs(): Promise<AudioInputDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Audio input ${i + 1}`,
    }))
}
