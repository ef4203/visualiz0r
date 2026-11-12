import { eqBars } from './eqBars.ts'
import { cubes } from './cubes.ts'
import { laserRig } from './laserRig.ts'
import { ridgeline } from './ridgeline.ts'
import { tileStrobe } from './tileStrobe.ts'
import type { Visualization } from './types.ts'
import { warpTunnel } from './warpTunnel.ts'
import { psychedelic } from './psychedelic.ts'

/**
 * Registered visualizations, listed in this order in the stage's visual menu.
 * To add one, implement `Visualization` in its own file and append it here.
 */
export const visualizations: readonly Visualization[] = [
  eqBars,
  psychedelic,
  cubes,
  warpTunnel,
  laserRig,
  ridgeline,
  tileStrobe,
]
