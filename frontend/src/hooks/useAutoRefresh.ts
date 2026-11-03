import { useEffect, useState } from 'react'

const DEFAULT_INTERVAL_MS = 15_000
const EVENT_DEBOUNCE_MS = 1_000

/** Trigger a page's existing data loader periodically and when the browser tab becomes active. */
export function useAutoRefresh(enabled = true, intervalMs = DEFAULT_INTERVAL_MS): number {
  const [refreshSignal, setRefreshSignal] = useState(0)

  useEffect(() => {
    if (!enabled) return undefined

    let lastTriggeredAt = 0
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastTriggeredAt < EVENT_DEBOUNCE_MS) return
      lastTriggeredAt = now
      setRefreshSignal((current) => current + 1)
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    const interval = window.setInterval(refresh, intervalMs)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [enabled, intervalMs])

  return refreshSignal
}
