/** Calls `onFrame` with the rAF timestamp every display frame. Returns a stop function. */
export function startFrameLoop(onFrame: (nowMs: number) => void): () => void {
  let raf = 0
  const tick = (now: number) => {
    onFrame(now)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
}
