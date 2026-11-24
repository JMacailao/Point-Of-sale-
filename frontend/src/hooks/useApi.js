import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../services/api'

/** Loads `path` with `query` and reloads when they change. */
export function useApi(path, query, { enabled = true } = {}) {
  const [data, setData] = useState(null)
  const [meta, setMeta] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(enabled)
  const key = JSON.stringify([path, query])
  const seq = useRef(0)

  const load = useCallback(async () => {
    if (!enabled || !path) return
    const id = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const res = await api.get(path, query)
      if (id !== seq.current) return
      setData(res.data)
      setMeta(res.meta ?? null)
    } catch (err) {
      if (id === seq.current) setError(err)
    } finally {
      if (id === seq.current) setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])

  useEffect(() => { load() }, [load])

  return { data, meta, error, loading, reload: load, setData }
}

export function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}
