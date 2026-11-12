import { useCallback, useEffect, useRef, useState } from 'react'
import type { AudioEngine } from '../audio/AudioEngine.ts'
import { startFrameLoop } from '../frameLoop.ts'
import { keepScreenAwake } from '../keepScreenAwake.ts'
import { visualizations } from '../visuals/index.ts'
import type { Size } from '../visuals/types.ts'

const HUD_HIDE_MS = 3000
const MAX_DPR = 2

interface Props {
  engine: AudioEngine
  onExit: () => void
}

function Stage({ engine, onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hudTimer = useRef(0)
  const selectOpen = useRef(false)
  const [index, setIndex] = useState(0)
  const [hudVisible, setHudVisible] = useState(true)
  const [inputLost, setInputLost] = useState(false)
  const [deviceLabel] = useState(() => engine.deviceLabel)

  const active = visualizations[index]

  const showHud = useCallback(() => {
    setHudVisible(true)
    window.clearTimeout(hudTimer.current)
    hudTimer.current = window.setTimeout(() => {
      if (selectOpen.current) return
      setHudVisible(false)
    }, HUD_HIDE_MS)
  }, [])

  useEffect(() => {
    showHud()
    return () => window.clearTimeout(hudTimer.current)
  }, [showHud])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !ctx) return

    const instance = active.create()
    const size: Size = { width: 0, height: 0 }
    const scale = { dpr: 1 }
    const resize = () => {
      scale.dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
      size.width = canvas.clientWidth
      size.height = canvas.clientHeight
      canvas.width = Math.round(size.width * scale.dpr)
      canvas.height = Math.round(size.height * scale.dpr)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const stopLoop = startFrameLoop((now) => {
      const frame = engine.update(now)
      ctx.setTransform(scale.dpr, 0, 0, scale.dpr, 0, 0)
      instance.draw(ctx, frame, size)
    })

    return () => {
      stopLoop()
      observer.disconnect()
      instance.dispose?.()
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

      if (e.repeat) return
      switch (e.key.toLowerCase()) {
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
  }, [onExit, showHud])

  useEffect(() => keepScreenAwake(), [])

  const hud = hudVisible || inputLost

  return (
    <div className={`stage${hud ? '' : ' stage--idle'}`} onMouseMove={showHud}>
      <canvas ref={canvasRef} className="stage__canvas" />
      <div className={`hud${hud ? ' hud--visible' : ''}`}>
        <div className="hud__top">
          <select
            className="hud__select"
            aria-label="Visual"
            value={index}
            onChange={(e) => {
              setIndex(Number(e.target.value))
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
          {inputLost && (
            <p className="hud__alert" role="alert">
              Audio input lost. Press S to choose another input.
            </p>
          )}
          <p>
            {deviceLabel && <>{deviceLabel} · </>}
            <kbd>F</kbd> fullscreen · <kbd>S</kbd> change input
          </p>
        </div>
      </div>
    </div>
  )
}

export default Stage
