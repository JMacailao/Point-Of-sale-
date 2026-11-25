// Bridge to the Android app (Capacitor). On the website these helpers report "not native".
export const isNativeApp = () => Boolean(window.Capacitor?.isNativePlatform?.())

/** Calls a native plugin method; errors carry .code (e.g. PERMISSION_DENIED, BLUETOOTH_OFF). */
export async function native(plugin, method, options = {}) {
  try {
    return await window.Capacitor.nativePromise(plugin, method, options)
  } catch (err) {
    const e = new Error(err?.message || String(err))
    e.code = err?.code || err?.data?.code || 'NATIVE_ERROR'
    throw e
  }
}

export function bytesToBase64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Prints an HTML document through Android's print system. */
export const nativePrintHtml = (html, jobName) => native('PosDevice', 'printHtml', { html, jobName })

/** Saves/shares a file through Android's share sheet. */
export const nativeShareFile = (filename, bytes, mimeType) =>
  native('PosDevice', 'shareFile', { filename, data: bytesToBase64(bytes), mimeType })
