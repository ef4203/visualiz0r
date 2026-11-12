import { eqBars } from './eqBars.ts'
import { isoGrid } from './isoGrid.ts'
import { laserRig } from './laserRig.ts'
import { ridgeline } from './ridgeline.ts'
import { tileStrobe } from './tileStrobe.ts'
import type { Visualization } from './types.ts'
import { warpTunnel } from './warpTunnel.ts'
import { xpPatterns } from './xpPatterns.ts'

/**
 * Registered visualizations. Array position decides the hotkey:
 * index 0 is key "1", index 1 is key "2", and so on up to "9".
 * To add one, implement `Visualization` in its own file and append it here.
 */
export const visualizations: readonly Visualization[] = [
  eqBars,
  xpPatterns,
  isoGrid,
  warpTunnel,
  laserRig,
  ridgeline,
  tileStrobe,
]
