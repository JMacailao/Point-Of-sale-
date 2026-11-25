// Camera barcode scanner (phone back camera or webcam).
// Uses the browser's built-in BarcodeDetector when available (Chrome on Android/Mac/ChromeOS),
// otherwise loads the ZXing decoder from a CDN on first use. Requires HTTPS (or localhost).
import { esc, icon, openModal, toast } from './util.js'

// ZXing @zxing/browser 0.1.5 (MIT), bundled in web/vendor so scanning works without a CDN.
const ZXING_URL = new URL('../vendor/zxing-browser.min.js', import.meta.url).href
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code', 'data_matrix']

const pref = {
  get camera() { try { return localStorage.getItem('pos.cameraId') || '' } catch { return '' } },
  set camera(v) { try { localStorage.setItem('pos.cameraId', v) } catch { /* ignore */ } },
}

export const cameraSupported = () => Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext

let zxingLoad = null
function loadZxing() {
  if (window.ZXingBrowser) return Promise.resolve(window.ZXingBrowser)
  zxingLoad ||= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = ZXING_URL
    s.onload = () => resolve(window.ZXingBrowser)
    s.onerror = () => { zxingLoad = null; reject(new Error('Could not load the barcode reader.')) }
    document.head.appendChild(s)
  })
  return zxingLoad
}

async function nativeDetector() {
  if (!('BarcodeDetector' in window)) return null
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats()
    const formats = FORMATS.filter((f) => supported.includes(f))
    if (!formats.includes('ean_13') && !formats.includes('code_128')) return null
    return new window.BarcodeDetector({ formats })
  } catch { return null }
}

let audioCtx
function beep() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)()
    const o = audioCtx.createOscillator(), g = audioCtx.createGain()
    o.frequency.value = 1400; g.gain.value = 0.08
    o.connect(g); g.connect(audioCtx.destination)
    o.start(); o.stop(audioCtx.currentTime + 0.09)
  } catch { /* sound is optional */ }
  navigator.vibrate?.(60)
}

function cameraError(err) {
  if (!window.isSecureContext) return 'The camera only works when the site is opened over HTTPS.'
  switch (err?.name) {
    case 'NotAllowedError': case 'SecurityError': return 'Camera permission was denied. Allow camera access for this site in your browser settings, then try again.'
    case 'NotFoundError': case 'OverconstrainedError': return 'No camera was found on this device.'
    case 'NotReadableError': return 'The camera is being used by another app. Close it and try again.'
    default: return err?.message || 'Could not start the camera.'
  }
}

/**
 * Opens the camera scanner.
 *  - single scan:     const code = await openCameraScanner({ title })   (null if cancelled)
 *  - continuous scan: openCameraScanner({ continuous: true, onCode: async (code) => 'message shown' })
 */
export function openCameraScanner({ title = 'Scan barcode', continuous = false, onCode } = {}) {
  return new Promise((resolve) => {
    let stream = null, timer = null, zxControls = null, stopped = false, result = null
    let last = { code: '', at: 0 }, busy = false
    const md = openModal({
      title, size: 'lg',
      body: `<div class="scanner">
          <div class="scanner-view"><video id="cam" playsinline muted autoplay></video><div class="scanner-frame"></div>
            <p class="scanner-status" id="cam-status">Starting camera…</p></div>
          <div class="row-wrap mt-sm"><label class="small muted" for="cam-select">Camera</label>
            <select id="cam-select" class="input input-auto" style="max-width:260px"></select>
            <span class="small muted grow hide-sm">Hold the barcode inside the frame.</span></div>
          ${continuous ? '<ul class="scan-log" id="scan-log" aria-live="polite"></ul>' : ''}
          <form id="manual" class="row mt-sm"><input id="manual-code" class="input" placeholder="Or type the barcode" aria-label="Type barcode" autocomplete="off">
            <button class="btn btn-secondary" type="submit">Add</button></form>
        </div>`,
      footer: `<button class="btn btn-${continuous ? 'primary' : 'secondary'}" data-close>${continuous ? 'Done' : 'Cancel'}</button>`,
      onClose: () => { stop(); resolve(result) },
    })
    const el = md.el
    const video = el.querySelector('#cam'), status = el.querySelector('#cam-status'), select = el.querySelector('#cam-select')
    const setStatus = (t, err = false) => { status.textContent = t; status.classList.toggle('error', err) }

    function stop() {
      stopped = true
      clearInterval(timer); timer = null
      try { zxControls?.stop() } catch { /* ignore */ }
      zxControls = null
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
    }

    async function handle(code) {
      code = String(code || '').trim()
      if (!code || busy) return
      const now = Date.now()
      // While the same barcode stays in view it is counted once; it counts again
      // only after it has been out of view for a moment (like a handheld scanner).
      if (code === last.code && now - last.at < 1500) { last.at = now; return }
      last = { code, at: now }
      beep()
      if (!continuous) { result = code; md.close(); return }
      busy = true
      let msg, ok = true
      try { msg = (await onCode?.(code)) || code } catch (err) { msg = err.message; ok = false }
      busy = false
      const log = el.querySelector('#scan-log')
      if (log) log.insertAdjacentHTML('afterbegin', `<li class="${ok ? 'ok' : 'bad'}">${icon(ok ? 'checkCircle' : 'alert')} ${esc(msg)}</li>`)
      setStatus(ok ? `Added: ${msg}` : msg, !ok)
    }

    async function start(deviceId) {
      stop(); stopped = false
      setStatus('Starting camera…')
      const constraints = { audio: false, video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } }
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints)
      } catch (err) {
        if (deviceId) { pref.camera = ''; return start('') }
        return setStatus(cameraError(err), true)
      }
      if (stopped) return stop()
      video.srcObject = stream
      await video.play().catch(() => {})
      // List cameras (labels are available after permission is granted).
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
      const active = stream.getVideoTracks()[0]?.getSettings().deviceId || ''
      select.innerHTML = cams.map((c, i) => `<option value="${esc(c.deviceId)}" ${c.deviceId === active ? 'selected' : ''}>${esc(c.label || `Camera ${i + 1}`)}</option>`).join('')
      select.disabled = cams.length < 2

      const detector = await nativeDetector()
      if (detector) {
        setStatus('Scanning…')
        timer = setInterval(async () => {
          if (busy || video.readyState < 2) return
          try { const codes = await detector.detect(video); if (codes[0]) handle(codes[0].rawValue) } catch { /* next frame */ }
        }, 180)
      } else {
        try {
          setStatus('Loading barcode reader…')
          const ZX = await loadZxing()
          if (stopped) return
          const reader = new ZX.BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 150 })
          zxControls = await reader.decodeFromStream(stream, video, (res) => { if (res) handle(res.getText()) })
          if (stopped) { zxControls.stop(); return }
          setStatus('Scanning…')
        } catch (err) { setStatus(err.message, true) }
      }
    }

    select.onchange = () => { pref.camera = select.value; start(select.value) }
    el.querySelector('#manual').onsubmit = (e) => {
      e.preventDefault()
      const input = el.querySelector('#manual-code')
      const v = input.value.trim()
      input.value = ''
      if (v) { last = { code: '', at: 0 }; handle(v) }
    }
    if (!cameraSupported()) setStatus(cameraError({}), true)
    else start(pref.camera).catch((err) => toast.error(err))
  })
}
