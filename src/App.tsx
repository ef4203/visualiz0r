import { useState } from 'react'
import { AudioEngine } from './audio/AudioEngine.ts'
import SetupScreen from './components/SetupScreen.tsx'
import Stage from './components/Stage.tsx'

function App() {
  const [engine] = useState(() => new AudioEngine())
  const [running, setRunning] = useState(false)

  return running ? (
    <Stage engine={engine} onExit={() => setRunning(false)} />
  ) : (
    <SetupScreen engine={engine} onLaunch={() => setRunning(true)} />
  )
}

export default App
