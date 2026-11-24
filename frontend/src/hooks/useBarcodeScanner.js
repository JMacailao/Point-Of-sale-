import { useEffect, useRef } from 'react'

/**
 * USB barcode scanners act as keyboards: they type the code very quickly and
 * finish with Enter. This hook captures such bursts when the focus is NOT in a
 * text field (when the search box is focused, its own Enter handler is used).
 */
export function useBarcodeScanner(onScan, { minLength = 4, maxGapMs = 50 } = {}) {
  const buffer = useRef('')
  const last = useRef(0)
  const cb = useRef(onScan)
  useEffect(() => { cb.current = onScan }, [onScan])

  useEffect(() => {
    function onKey(e) {
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const now = performance.now()
      if (now - last.current > maxGapMs) buffer.current = ''
      last.current = now
      if (e.key === 'Enter') {
        if (buffer.current.length >= minLength) {
          e.preventDefault()
          cb.current(buffer.current)
        }
        buffer.current = ''
      } else if (e.key.length === 1) {
        buffer.current += e.key
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [minLength, maxGapMs])
}
