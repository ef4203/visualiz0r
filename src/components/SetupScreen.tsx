import { useEffect, useRef, useState } from 'react'
import {
  listAudioInputs,
  type AudioEngine,
  type AudioInputDevice,
} from '../audio/AudioEngine.ts'
import { startFrameLoop } from '../frameLoop.ts'

const STORAGE_KEY = 'visualiz0r.inputDevice'

type Status = 'idle' | 'connecting' | 'ready'

interface Props {
  engine: AudioEngine
  onLaunch: () => void
}

function errorName(e: unknown): string {
  return typeof e === 'object' && e !== null && 'name' in e ? String(e.name) : ''
}

function describeError(e: unknown): string {
  switch (errorName(e)) {
    case 'NotAllowedError':
      return 'Audio input permission was denied. Allow microphone access for this site in the browser settings, then try again.'
    case 'NotFoundError':
      return 'No audio input device was found.'
    case 'NotReadableError':
      return 'The audio input is unavailable or in use by another application.'
  }
  return e instanceof Error ? e.message : String(e)
}

function SetupScreen({ engine, onLaunch }: Props) {
  const [status, setStatus] = useState<Status>(engine.active ? 'ready' : 'idle')
  const [devices, setDevices] = useState<AudioInputDevice[]>([])
  const [deviceId, setDeviceId] = useState(engine.deviceId ?? '')
  const [error, setError] = useState<string | null>(null)
  const meterRef = useRef<HTMLDivElement>(null)
  const launchRef = useRef<HTMLButtonElement>(null)
  const focusedLaunch = useRef(false)
  const shownLevel = useRef(0)

  useEffect(() => {
    const refresh = () => {
      listAudioInputs().then(setDevices, () => {})
    }
    if (engine.active) refresh()

    const unsubscribe = engine.subscribeEnded(() => {
      setStatus('idle')
      setError('The audio input was disconnected. Choose an input to continue.')
      refresh()
    })
    navigator.mediaDevices?.addEventListener('devicechange', refresh)
    return () => {
      unsubscribe()
      navigator.mediaDevices?.removeEventListener('devicechange', refresh)
    }
  }, [engine])

  useEffect(() => {
    return startFrameLoop((now) => {
      const level = Math.min(1, engine.update(now).level * 2.5)
      shownLevel.current = level > shownLevel.current ? level : shownLevel.current * 0.9
      if (meterRef.current) {
        meterRef.current.style.transform = `scaleX(${shownLevel.current})`
      }
    })
  }, [engine])

  useEffect(() => {
    if (status === 'ready' && devices.length > 0 && !focusedLaunch.current) {
      focusedLaunch.current = true
      launchRef.current?.focus()
    }
  }, [status, devices.length])

  async function open(id?: string) {
    setError(null)
    setStatus('connecting')
    try {
      try {
        await engine.start(id)
      } catch (e) {
        // A remembered device that is no longer plugged in: fall back to the default input.
        if (id && errorName(e) === 'OverconstrainedError') await engine.start()
        else throw e
      }
      // A newer selection superseded this one; it will update the UI.
      if (!engine.active) return
      const actual = engine.deviceId ?? ''
      setDeviceId(actual)
      if (actual) localStorage.setItem(STORAGE_KEY, actual)
      setDevices(await listAudioInputs())
      setStatus('ready')
    } catch (e) {
      setError(describeError(e))
      setStatus('idle')
    }
  }

  function launch() {
    document.documentElement.requestFullscreen?.().catch(() => {})
    engine.resume().then(onLaunch, onLaunch)
  }

  const showPicker = devices.length > 0

  return (
    <main className="setup">
      <div className="setup__card">
        <h1 className="setup__title">visualiz0r</h1>
        <p className="setup__lead">
          Choose the audio source to visualize. For a DJ rig or mixer, pick its
          audio interface or a loopback device.
        </p>

        {!showPicker && (
          <button
            type="button"
            className="button button--primary"
            disabled={status === 'connecting'}
            onClick={() => open(localStorage.getItem(STORAGE_KEY) ?? undefined)}
          >
            {status === 'connecting' ? 'Connecting…' : 'Connect audio input'}
          </button>
        )}

        {showPicker && (
          <form
            className="setup__form"
            onSubmit={(e) => {
              e.preventDefault()
              if (status === 'ready') launch()
            }}
          >
            <label className="setup__label" htmlFor="input-device">
              Audio input
            </label>
            <select
              id="input-device"
              className="select"
              value={deviceId}
              onChange={(e) => {
                setDeviceId(e.target.value)
                open(e.target.value)
              }}
            >
              {!devices.some((d) => d.deviceId === deviceId) && (
                <option value={deviceId} disabled>
                  Select an input…
                </option>
              )}
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>

            <div className="setup__label">Input level</div>
            <div
              className="meter"
              role="meter"
              aria-label="Input level"
              aria-valuemin={0}
              aria-valuemax={1}
            >
              <div className="meter__fill" ref={meterRef} />
            </div>

            <button
              ref={launchRef}
              type="submit"
              className="button button--primary"
              disabled={status !== 'ready'}
            >
              {status === 'connecting' ? 'Connecting…' : 'Start visualizer'}
            </button>
          </form>
        )}

        {error && (
          <p className="setup__error" role="alert">
            {error}
          </p>
        )}

        <p className="setup__keys">
          While running: <kbd>F</kbd> fullscreen · <kbd>S</kbd> back to this
          screen
        </p>
      </div>
    </main>
  )
}

export default SetupScreen
