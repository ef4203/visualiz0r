const SAMPLE_RATE = 48000
const BPM = 124
const BARS = 16
const BEATS_PER_BAR = 4

// Am - F - C - G, one chord per bar: bass root and arpeggio notes in Hz.
const PROGRESSION = [
  { bass: 55, arp: [220, 261.63, 329.63, 440] },
  { bass: 43.65, arp: [174.61, 220, 261.63, 349.23] },
  { bass: 65.41, arp: [261.63, 329.63, 392, 523.25] },
  { bass: 49, arp: [196, 246.94, 293.66, 392] },
]

/** Small deterministic PRNG so the track (and therefore the screenshots) is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Renders a loopable house-style demo track as a 16-bit mono WAV: kick on every beat, clap on 2 and 4,
 * off-beat hats, an off-beat bass and a 16th-note arpeggio. Strong bass, mid and treble content
 * plus a steady tempo make every visual look like it does at a show.
 */
export function renderDemoTrack(): Buffer {
  const samplesPerBeat = (SAMPLE_RATE * 60) / BPM
  const totalBeats = BARS * BEATS_PER_BAR
  const length = Math.round(totalBeats * samplesPerBeat)
  const mix = new Float32Array(length)
  const random = mulberry32(1)

  const add = (startBeat: number, seconds: number, voice: (t: number) => number) => {
    const start = Math.round(startBeat * samplesPerBeat)
    const count = Math.min(Math.round(seconds * SAMPLE_RATE), length - start)
    for (let i = 0; i < count; i++) mix[start + i] += voice(i / SAMPLE_RATE)
  }

  for (let beat = 0; beat < totalBeats; beat++) {
    const chord = PROGRESSION[Math.floor(beat / BEATS_PER_BAR) % PROGRESSION.length]

    let phase = 0
    add(beat, 0.4, (t) => {
      phase += (2 * Math.PI * (45 + 120 * Math.exp(-t * 28))) / SAMPLE_RATE
      return 0.9 * Math.sin(phase) * Math.exp(-t * 8)
    })

    if (beat % 2 === 1) {
      let previous = 0
      add(beat, 0.25, (t) => {
        const noise = random() * 2 - 1
        const high = noise - previous
        previous = noise
        return 0.35 * high * Math.exp(-t * 18)
      })
    }

    for (const offset of [0.5, 0.25, 0.75]) {
      let previous = 0
      const level = offset === 0.5 ? 0.22 : 0.08
      add(beat + offset, 0.08, (t) => {
        const noise = random() * 2 - 1
        const high = noise - previous
        previous = noise
        return level * high * Math.exp(-t * 60)
      })
    }

    let lowPass = 0
    add(beat + 0.5, 0.45 * (60 / BPM), (t) => {
      const saw = 2 * ((t * chord.bass) % 1) - 1
      lowPass += 0.06 * (saw - lowPass)
      return 0.55 * lowPass * (1 - Math.exp(-t * 400))
    })

    for (let step = 0; step < 4; step++) {
      const note = chord.arp[(beat * 4 + step) % chord.arp.length]
      add(beat + step / 4, 0.2, (t) => {
        const square = (t * note) % 1 < 0.5 ? 1 : -1
        const saw = 2 * ((t * note * 1.005) % 1) - 1
        return 0.1 * (square + saw) * Math.exp(-t * 14)
      })
    }
  }

  let peak = 0
  for (let i = 0; i < length; i++) {
    mix[i] = Math.tanh(mix[i])
    peak = Math.max(peak, Math.abs(mix[i]))
  }

  const dataBytes = length * 2
  const wav = Buffer.alloc(44 + dataBytes)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + dataBytes, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20) // PCM
  wav.writeUInt16LE(1, 22) // mono
  wav.writeUInt32LE(SAMPLE_RATE, 24)
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(dataBytes, 40)
  const gain = 0.85 / peak
  for (let i = 0; i < length; i++) {
    wav.writeInt16LE(Math.round(mix[i] * gain * 32767), 44 + i * 2)
  }
  return wav
}
