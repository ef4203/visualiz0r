import { useCallback, useEffect, useRef, useState } from 'react'
import type { AudioEngine } from '../audio/AudioEngine.ts'
import { startFrameLoop } from '../frameLoop.ts'
import { keepScreenAwake } from '../keepScreenAwake.ts'
import { createRenderScaler } from '../renderScale.ts'
import {
  BRIGHTNESS_STEP,
  clampBrightness,
  loadBrightness,
  loadVisualIndex,
  saveBrightness,
  saveVisual,
} from '../settings.ts'
import { visualizations } from '../visuals/index.ts'
import type { Size, VisualizationInstance } from '../visuals/types.ts'

const HUD_HIDE_MS = 3000
const MAX_DPR = 2
const BRIGHTNESS_SAVE_DELAY_MS = 300

interface Props {
  engine: AudioEngine
  onExit: () => void
}

function Stage({ engine, onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hudTimer = useRef(0)
  const selectOpen = useRef(false)
  // Settings are saved only after the user changes them, so a restored fallback never
  // overwrites what is stored.
  const visualChosen = useRef(false)
  const brightnessChanged = useRef(false)
  const pendingBrightness = useRef<number | null>(null)
  const brightnessTimer = useRef(0)
  const [index, setIndex] = useState(() => loadVisualIndex(visualizations.map((v) => v.id)))
  const [hudVisible, setHudVisible] = useState(true)
  const [blackout, setBlackout] = useState(false)
  const [brightness, setBrightness] = useState(loadBrightness)
  const [inputLost, setInputLost] = useState(false)
  const [failedVisual, setFailedVisual] = useState<string | null>(null)
  const [deviceLabel] = useState(() => engine.deviceLabel)

  const active = visualizations[index]

  const chooseVisual = useCallback((next: (i: number) => number) => {
    visualChosen.current = true
    setFailedVisual(null)
    setIndex(next)
  }, [])

  // Debounced, since holding +/- auto-repeats and storage writes are synchronous.
  useEffect(() => {
    if (!brightnessChanged.current) return
    pendingBrightness.current = brightness
    window.clearTimeout(brightnessTimer.current)
    brightnessTimer.current = window.setTimeout(() => {
      if (pendingBrightness.current !== null) saveBrightness(pendingBrightness.current)
      pendingBrightness.current = null
    }, BRIGHTNESS_SAVE_DELAY_MS)
  }, [brightness])

  useEffect(() => {
    const flush = () => {
      window.clearTimeout(brightnessTimer.current)
      if (pendingBrightness.current !== null) saveBrightness(pendingBrightness.current)
      pendingBrightness.current = null
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])

  const scheduleHudHide = useCallback(() => {
    window.clearTimeout(hudTimer.current)
    hudTimer.current = window.setTimeout(() => {
      if (selectOpen.current) return
      setHudVisible(false)
    }, HUD_HIDE_MS)
  }, [])

  const showHud = useCallback(() => {
    setHudVisible(true)
    scheduleHudHide()
  }, [scheduleHudHide])

  // The HUD starts visible; this only arms the timer that hides it.
  useEffect(() => {
    scheduleHudHide()
    return () => window.clearTimeout(hudTimer.current)
  }, [scheduleHudHide])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !ctx) return

    let instance: VisualizationInstance | undefined
    // Reused between resizes so dragging the window does not allocate a canvas per event.
    let scratch: HTMLCanvasElement | null = null
    const size: Size = { width: 0, height: 0 }
    const scale = { x: 1, y: 1 }
    const scaler = createRenderScaler()
    const resize = () => {
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1) * scaler.scale
      size.width = canvas.clientWidth
      size.height = canvas.clientHeight
      // Resizing clears the canvas, so carry the old pixels over for visuals that accumulate.
      let old: HTMLCanvasElement | null = null
      if (canvas.width > 0 && canvas.height > 0) {
        old = scratch ??= document.createElement('canvas')
        if (old.width !== canvas.width) old.width = canvas.width
        if (old.height !== canvas.height) old.height = canvas.height
        old.getContext('2d')?.drawImage(canvas, 0, 0)
      }
      canvas.width = Math.max(1, Math.round(size.width * dpr))
      canvas.height = Math.max(1, Math.round(size.height * dpr))
      // Use the real pixel ratio so rounding never stretches the content.
      scale.x = size.width > 0 ? canvas.width / size.width : dpr
      scale.y = size.height > 0 ? canvas.height / size.height : dpr
      if (old) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.drawImage(old, 0, 0, canvas.width, canvas.height)
      }
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    let drawn = false
    const stopLoop = startFrameLoop((now) => {
      if (scaler.update(now) !== null) resize()
      const frame = engine.update(now)
      ctx.setTransform(scale.x, 0, 0, scale.y, 0, 0)
      try {
        instance ??= active.create()
        instance.draw(ctx, frame, size)
      } catch (e) {
        // An uncaught throw would end the frame loop and freeze the screen without a word.
        console.error(e)
        stopLoop()
        setFailedVisual(active.name)
        setHudVisible(true)
        return
      }
      // Remember a chosen visual only once it has drawn, so one that throws is never restored.
      if (!drawn) {
        drawn = true
        if (visualChosen.current) saveVisual(active.id)
      }
    })

    return () => {
      stopLoop()
      observer.disconnect()
      instance?.dispose?.()
    }
  }, [engine, active])

  useEffect(() => {
    return engine.subscribeEnded(() => {
      setInputLost(true)
      setHudVisible(true)
    })
  }, [engine])

  useEffect(() => {
    const exit = () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
      onExit()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      showHud()

      const step = (delta: number) => {
        brightnessChanged.current = true
        setBrightness((b) => clampBrightness(b + delta))
      }
      const inSelect = e.target instanceof HTMLSelectElement

      switch (e.key.toLowerCase()) {
        case '-':
          step(-BRIGHTNESS_STEP)
          return
        case '+':
        case '=':
          step(BRIGHTNESS_STEP)
          return
        case 'arrowleft':
        case 'arrowright':
          // A focused drop-down already handles arrows itself.
          if (inSelect) return
          e.preventDefault()
          if (e.repeat) return
          chooseVisual(
            (i) => (i + (e.key === 'ArrowRight' ? 1 : -1) + visualizations.length) % visualizations.length,
          )
          return
      }

      if (e.repeat) return
      switch (e.key.toLowerCase()) {
        case 'b':
          setBlackout((on) => !on)
          break
        case 'f':
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
          else document.documentElement.requestFullscreen().catch(() => {})
          break
        case 's':
          exit()
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onExit, showHud, chooseVisual])

  useEffect(() => keepScreenAwake(), [])

  const hud = hudVisible || inputLost || failedVisual !== null

  return (
    <div className={`stage${hud ? '' : ' stage--idle'}`} onMouseMove={showHud}>
      <canvas ref={canvasRef} className="stage__canvas" />
      <div
        className="stage__dim"
        style={{ opacity: blackout ? 1 : 1 - brightness }}
        aria-hidden="true"
      />
      <div className={`hud${hud ? ' hud--visible' : ''}`}>
        <div className="hud__top">
          <select
            className="hud__select"
            aria-label="Visual"
            value={index}
            onChange={(e) => {
              const next = Number(e.target.value)
              chooseVisual(() => next)
              e.target.blur()
            }}
            onFocus={() => {
              selectOpen.current = true
              showHud()
            }}
            onBlur={() => {
              selectOpen.current = false
              showHud()
            }}
          >
            {visualizations.map((v, i) => (
              <option key={v.id} value={i}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div className="hud__bottom">
          {failedVisual && (
            <p className="hud__alert" role="alert">
              {failedVisual} failed. Press ← or → to choose another visual.
            </p>
          )}
          {inputLost && (
            <p className="hud__alert" role="alert">
              Audio input lost. Press S to choose another input.
            </p>
          )}
          <p>
            {deviceLabel && <>{deviceLabel} · </>}
            <kbd>←</kbd>
            <kbd>→</kbd> switch visual · <kbd>B</kbd> blackout{blackout && ' (on)'} · <kbd>-</kbd>
            <kbd>+</kbd> brightness {Math.round(brightness * 100)}% · <kbd>F</kbd> fullscreen ·{' '}
            <kbd>S</kbd> change input
          </p>
        </div>
      </div>
    </div>
  )
}

export default Stage
