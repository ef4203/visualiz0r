import { bandSpectrum } from '../audio/bands.ts'
import { INK, STAGE_BACKGROUND } from './palette.ts'
import type { Visualization } from './types.ts'

/** Vertices per ring. 48 puts a vertex on every corner of a triangle, square, hexagon and octagon. */
const SEGMENTS = 48
const HALF = SEGMENTS / 2
/** One band per distinct ring angle: floor is the lowest band, ceiling the highest, mirrored left/right. */
const BAND_COUNT = HALF + 1
const MIN_HZ = 40
const MAX_HZ = 16000
const CONTRAST = 1.4
const ATTACK_S = 0.02
const RELEASE_S = 0.12
/** How far a wall is pushed out where its band is loud. */
const DISPLACE = 0.32

/** Depth units in front of the camera. Rings spawn at FAR, fog in, and are recycled at NEAR. */
const FAR = 16
const NEAR = 0.2
const FOG_SPAN = FAR * 0.65
const NEAR_FADE_END = 0.7
/** Rings never spawn closer together than this, which also keeps them sorted by depth. */
const MIN_GAP = 0.12
const AMBIENT_SPACING = 0.75
/** Depth units per second at 128 BPM and full energy. */
const BASE_SPEED = 5
const MAX_RINGS = 96
/** Ring radius of 1 spans this fraction of the short screen side at depth 1. */
const FOCAL = 0.42
const KICK_ZOOM = 0.07
const RAIL_STEP = 6

const SIDES = [4, 6, 3, 8] as const
const SHAPE_FOLLOW_S = 0.5
const BEATS_PER_SECTION = 16
const MAX_SECTION_S = 20

/** A kick after this long without one counts as a drop. */
const DROP_AFTER_S = 2.5
/** Kick-less time before a riser starts to build tension, and how long it takes to peak. */
const RISER_DELAY_S = 1
const RISER_RAMP_S = 6
const BURST_RINGS = 7
const BURST_GAP = 0.55

const TAU = Math.PI * 2

const SIN = Float32Array.from({ length: SEGMENTS }, (_, k) => Math.sin((k / SEGMENTS) * TAU))
const COS = Float32Array.from({ length: SEGMENTS }, (_, k) => Math.cos((k / SEGMENTS) * TAU))

/**
 * Regular polygon with a flat floor (angle 0 points at the floor), scaled to the same area
 * as the unit circle so every shape feels equally wide.
 */
function polygonRadius(sides: number, angle: number): number {
  const sector = TAU / sides
  const circumradius = Math.sqrt(Math.PI / ((sides / 2) * Math.sin(sector)))
  const apothem = circumradius * Math.cos(sector / 2)
  const phi = ((((angle + sector / 2) % sector) + sector) % sector) - sector / 2
  return apothem / Math.cos(phi)
}

const PROFILES = SIDES.map((sides) =>
  Float32Array.from({ length: SEGMENTS }, (_, k) => polygonRadius(sides, (k / SEGMENTS) * TAU)),
)

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

function hsl(hue: number, lightness: number): string {
  return `hsl(${(((hue % 360) + 360) % 360).toFixed(0)},90%,${lightness}%)`
}

function hsla(hue: number, lightness: number, alpha: number): string {
  return `hsla(${(((hue % 360) + 360) % 360).toFixed(0)},90%,${lightness}%,${alpha.toFixed(3)})`
}

interface Ring {
  /** Distance from the camera. */
  d: number
  /** 0 for the thin ambient rings, otherwise the strength of the kick that spawned it. */
  kick: number
  hue: number
  /** Roll at spawn time, so a turning tunnel spirals along its length. */
  cos: number
  sin: number
  /** World radius per vertex, frozen at spawn: the tunnel carries the music it was born with. */
  radius: Float32Array
  /** Screen position per vertex, refreshed every frame. */
  x: Float32Array
  y: Float32Array
  visibility: number
}

function createRing(): Ring {
  return {
    d: FAR,
    kick: 0,
    hue: 0,
    cos: 1,
    sin: 0,
    radius: new Float32Array(SEGMENTS),
    x: new Float32Array(SEGMENTS),
    y: new Float32Array(SEGMENTS),
    visibility: 0,
  }
}

function addPolygon(ctx: CanvasRenderingContext2D, ring: Ring): void {
  const { x, y } = ring
  ctx.moveTo(x[0], y[0])
  for (let k = 1; k < SEGMENTS; k++) ctx.lineTo(x[k], y[k])
  ctx.closePath()
}

export const warpTunnel: Visualization = {
  id: 'warp-tunnel',
  name: 'Warp Tunnel',
  create() {
    const target = new Float32Array(BAND_COUNT)
    const bands = new Float32Array(BAND_COUNT)
    const footprint = Float32Array.from(PROFILES[0])
    const pool: Ring[] = Array.from({ length: MAX_RINGS }, createRing)
    /** Nearest first. Spawning always appends beyond the farthest ring, so this stays sorted. */
    const rings: Ring[] = []

    let energy = 0
    let bass = 0
    let hue = 200
    let roll = 0
    let direction = 1
    let section = 0
    let beatsInSection = 0
    let sinceSection = 0
    let speed = BASE_SPEED * 0.4
    let traveled = 0
    let lastOnset = -1
    let tension = 0
    let surge = 0
    let flash = 0

    const spawn = (kick: number, gap: number, hueOffset: number) => {
      const ring = pool.pop()
      if (!ring) return
      const farthest = rings[rings.length - 1]
      ring.d = farthest ? Math.max(FAR, farthest.d + gap) : FAR
      ring.kick = kick
      ring.hue = hue + hueOffset
      ring.cos = Math.cos(roll)
      ring.sin = Math.sin(roll)
      const bulge = kick > 0 ? 0.12 + 0.2 * kick : 0.18 * bass
      for (let k = 0; k < SEGMENTS; k++) {
        const level = bands[k <= HALF ? k : SEGMENTS - k]
        ring.radius[k] = footprint[k] * (1 + DISPLACE * level + bulge)
      }
      rings.push(ring)
    }

    return {
      draw(ctx, frame, { width, height }) {
        if (width <= 0 || height <= 0) return
        const { dt, time, beat } = frame
        const pulse = beat.pulse
        const m = Math.min(width, height)

        bandSpectrum(frame, target, MIN_HZ, MAX_HZ)
        const attack = 1 - Math.exp(-dt / ATTACK_S)
        const release = 1 - Math.exp(-dt / RELEASE_S)
        for (let i = 0; i < BAND_COUNT; i++) {
          const t = Math.pow(target[i], CONTRAST)
          bands[i] += (t - bands[i]) * (t > bands[i] ? attack : release)
        }
        bass += (frame.bass - bass) * (frame.bass > bass ? attack : release)
        const drive = (frame.level + frame.bass + frame.mid) / 3
        energy += (drive - energy) * (1 - Math.exp(-dt / 0.25))
        const presence = 0.35 + 0.65 * clamp(energy * 2, 0, 1)

        let kickStrength = 0
        let drop = false
        sinceSection += dt
        if (beat.onset) {
          beatsInSection++
          if (beat.strength > 0.5) hue += 5
          kickStrength = clamp(0.45 + 0.55 * beat.strength, 0, 1)
          // The first kick after a long gap, a breakdown, is the drop.
          drop = lastOnset >= 0 && time - lastOnset >= DROP_AFTER_S && beat.strength > 0.4
          lastOnset = time
        }
        if (beatsInSection >= BEATS_PER_SECTION || sinceSection > MAX_SECTION_S) {
          beatsInSection = 0
          sinceSection = 0
          section++
          direction = -direction
          hue += 70
        }

        // While the kick is missing but sound continues, tension builds and the tunnel accelerates.
        const sinceKick = lastOnset < 0 ? 0 : time - lastOnset
        const riser =
          clamp((sinceKick - RISER_DELAY_S) / RISER_RAMP_S, 0, 1) * clamp(energy * 3, 0, 1)
        tension += (riser - tension) * (1 - Math.exp(-dt / (riser > tension ? 1 : 0.25)))
        surge *= Math.exp(-dt / 1.2)
        flash *= Math.exp(-dt / 0.35)

        hue += dt * (6 + 24 * energy)
        roll += direction * dt * (0.03 + 0.12 * frame.mid + 0.12 * pulse)

        const shapeFollow = 1 - Math.exp(-dt / SHAPE_FOLLOW_S)
        const profile = PROFILES[section % PROFILES.length]
        for (let k = 0; k < SEGMENTS; k++) footprint[k] += (profile[k] - footprint[k]) * shapeFollow

        const tempo = beat.bpm > 0 ? clamp(beat.bpm / 128, 0.7, 1.4) : 1
        const speedGoal =
          BASE_SPEED *
          tempo *
          (0.4 + 0.6 * clamp(energy * 2.2, 0, 1)) *
          (1 + 1.1 * tension) *
          (1 + 1.2 * surge)
        speed += (speedGoal - speed) * (1 - Math.exp(-dt / 0.3))

        const step = speed * dt
        for (const ring of rings) ring.d -= step
        while (rings.length > 0 && rings[0].d < NEAR) {
          const gone = rings.shift()
          if (gone) pool.push(gone)
        }

        if (kickStrength > 0) {
          spawn(kickStrength, MIN_GAP, 0)
          traveled = 0
        }
        if (drop) {
          surge = 1
          flash = 1
          hue += 40
          for (let i = 0; i < BURST_RINGS; i++) spawn(1, i === 0 ? MIN_GAP : BURST_GAP, i * 10)
        }
        traveled += step
        while (traveled >= AMBIENT_SPACING) {
          traveled -= AMBIENT_SPACING
          spawn(0, MIN_GAP, 0)
        }

        // The tunnel snakes: far rings drift sideways, rings at the camera stay centred.
        const focal = m * FOCAL * (1 + KICK_ZOOM * pulse)
        const cx = width / 2
        const cy = height / 2
        const sway = (d: number) => 1 - 1 / (1 + 0.5 * d)
        const swayX = (d: number) => Math.sin(time * 0.37 + d * 0.3) * m * 0.08 * sway(d)
        const swayY = (d: number) => Math.sin(time * 0.29 + d * 0.23 + 1.7) * m * 0.045 * sway(d)
        for (const ring of rings) {
          const { d, radius, x, y, cos, sin } = ring
          const ox = cx + swayX(d)
          const oy = cy + swayY(d)
          const scale = focal / d
          for (let k = 0; k < SEGMENTS; k++) {
            const r = radius[k] * scale
            x[k] = ox + r * (SIN[k] * cos + COS[k] * sin)
            y[k] = oy + r * (COS[k] * cos - SIN[k] * sin)
          }
          const fog = clamp((FAR - d) / FOG_SPAN, 0, 1)
          const nearFade = clamp((d - NEAR) / (NEAR_FADE_END - NEAR), 0, 1)
          ring.visibility = fog * nearFade
        }

        ctx.save()
        ctx.fillStyle = STAGE_BACKGROUND
        ctx.fillRect(0, 0, width, height)
        ctx.globalCompositeOperation = 'lighter'
        ctx.lineJoin = 'miter'

        // Light at the end of the tunnel: flickers with every kick, blazes on a drop.
        const glowX = cx + swayX(FAR)
        const glowY = cy + swayY(FAR)
        const glowAlpha = clamp(0.08 + 0.3 * pulse + 0.5 * flash + 0.15 * tension, 0, 0.9)
        const glow = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, m * (0.3 + 0.5 * flash))
        glow.addColorStop(0, hsla(hue, 55, glowAlpha))
        glow.addColorStop(1, hsla(hue, 55, 0))
        ctx.fillStyle = glow
        ctx.fillRect(0, 0, width, height)

        // Walls between a kick ring and the next ring behind it are lit in the kick's colour.
        for (let i = rings.length - 2; i >= 0; i--) {
          const ring = rings[i]
          if (ring.kick === 0 || ring.visibility < 0.01) continue
          ctx.beginPath()
          addPolygon(ctx, ring)
          addPolygon(ctx, rings[i + 1])
          ctx.fillStyle = hsl(ring.hue, 55)
          ctx.globalAlpha = 0.16 * ring.kick * ring.visibility
          ctx.fill('evenodd')
        }

        ctx.globalAlpha = clamp(0.1 + 0.1 * presence + 0.2 * tension, 0, 1)
        ctx.strokeStyle = INK
        ctx.lineWidth = Math.max(1, m * 0.0012)
        ctx.beginPath()
        for (let i = 0; i < rings.length - 1; i++) {
          const near = rings[i]
          const far = rings[i + 1]
          if (far.d > FAR) continue
          for (let k = 0; k < SEGMENTS; k += RAIL_STEP) {
            ctx.moveTo(near.x[k], near.y[k])
            ctx.lineTo(far.x[k], far.y[k])
          }
        }
        ctx.stroke()

        for (let i = rings.length - 1; i >= 0; i--) {
          const ring = rings[i]
          const { visibility } = ring
          if (visibility < 0.01) continue
          const w = clamp((m * 0.0024) / Math.pow(ring.d, 0.85), 0.8, m * 0.012)
          ctx.beginPath()
          addPolygon(ctx, ring)
          if (ring.kick === 0) {
            ctx.strokeStyle = INK
            ctx.globalAlpha = clamp((0.2 + 0.3 * presence + 0.25 * pulse) * visibility, 0, 1)
            ctx.lineWidth = w
            ctx.stroke()
          } else {
            ctx.strokeStyle = hsl(ring.hue, 62)
            ctx.globalAlpha = 0.22 * visibility
            ctx.lineWidth = w * 5
            ctx.stroke()
            ctx.globalAlpha = visibility
            ctx.lineWidth = w * (1.2 + 0.8 * ring.kick)
            ctx.stroke()
          }
        }

        ctx.restore()
      },
    }
  },
}
