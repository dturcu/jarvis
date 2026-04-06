import { useEffect, useState, useCallback } from 'react'

interface UseApiResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => void
}

/**
 * Single-fetch hook (no polling). Fetches on mount and provides refetch.
 */
export function useApi<T>(url: string | null): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(!!url)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(() => {
    if (!url) return
    setLoading(true)
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

  useEffect(() => { fetchData() }, [fetchData])

  return { data, loading, error, refetch: fetchData }
}

/**
 * Mutation helper for POST/PATCH/DELETE operations.
 */
export async function apiFetch<T>(
  url: string,
  options?: { method?: string; body?: unknown }
): Promise<T> {
  const resp = await fetch(url, {
    method: options?.method ?? 'POST',
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText)
    throw new Error(text)
  }
  return resp.json()
}
