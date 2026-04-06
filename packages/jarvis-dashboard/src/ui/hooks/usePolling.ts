import { useEffect, useState, useRef, useCallback } from 'react'

interface UsePollingResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => void
}

/**
 * Generic polling hook that replaces duplicated setInterval + useRef patterns.
 * Fetches from a URL on mount and at the specified interval.
 */
export function usePolling<T>(url: string, intervalMs: number): UsePollingResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchData = useCallback(() => {
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return r.json()
      })
      .then((result: T) => {
        setData(result)
        setError(null)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [url])

  useEffect(() => {
    fetchData()
    intervalRef.current = setInterval(fetchData, intervalMs)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchData, intervalMs])

  return { data, loading, error, refetch: fetchData }
}
