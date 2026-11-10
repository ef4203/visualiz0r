/** Prevents the display from sleeping until the returned function is called. Re-acquires after tab switches. */
export function keepScreenAwake(): () => void {
  let lock: WakeLockSentinel | null = null
  let disposed = false

  const acquire = async () => {
    if (lock && !lock.released) return
    try {
      const next = await navigator.wakeLock?.request('screen')
      if (!next) return
      if (disposed) next.release().catch(() => {})
      else lock = next
    } catch {
      // Unsupported or denied: the display may sleep, nothing else to do.
    }
  }
  const onVisibility = () => {
    if (document.visibilityState === 'visible') acquire()
  }

  acquire()
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    disposed = true
    document.removeEventListener('visibilitychange', onVisibility)
    lock?.release().catch(() => {})
    lock = null
  }
}
