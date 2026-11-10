export interface BeatState {
  /** True only on the single frame in which a beat onset was detected. */
  onset: boolean
  /** 0..1 strength of the most recent onset. */
  strength: number
  /** 0..1 envelope: jumps up on every onset, then decays at a tempo-dependent rate. */
  pulse: number
  /** Estimated tempo in BPM, or 0 while unknown. */
  bpm: number
  /** 0..1 confidence in `bpm`. */
  confidence: number
}

/**
 * Snapshot of the incoming audio, produced once per animation frame.
 * The object and its arrays are reused between frames: read, don't retain.
 */
export interface AudioFrame {
  /** Seconds since the previous frame. */
  dt: number
  /** Monotonic clock in seconds. */
  time: number
  /** Auto-gained 0..1 magnitude per FFT bin. Bin `i` is centred on `i * binHz`. */
  spectrum: Float32Array
  binHz: number
  /** Overall loudness, 0..1. */
  level: number
  /** Sub/kick range, 0..1. */
  bass: number
  mid: number
  treble: number
  beat: BeatState
}
