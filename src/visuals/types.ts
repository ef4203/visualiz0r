import type { AudioFrame } from '../audio/types.ts'

export interface Size {
  /** CSS pixels. The context is already scaled for devicePixelRatio. */
  width: number
  height: number
}

export interface VisualizationInstance {
  /** Paint one frame. The canvas is not cleared for you. */
  draw(ctx: CanvasRenderingContext2D, frame: AudioFrame, size: Size): void
  dispose?(): void
}

export interface Visualization {
  id: string
  name: string
  /** Called each time the visual is selected; keep per-visual state in the instance. */
  create(): VisualizationInstance
}
