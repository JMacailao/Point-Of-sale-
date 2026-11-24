// Talks to Supabase directly. Every call carries the user's Firebase ID token;
// Supabase verifies it (Third-Party Auth) and row level security decides access.
import { API_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js'
import { auth } from './firebase.js'

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}

let onSessionError = null
export function setSessionErrorHandler(fn) { onSessionError = fn }

const FRIENDLY = {
  '23505': 'This record already exists (duplicate name, SKU or barcode).',
  '23503': 'A referenced record does not exist.',
  '23514': 'Invalid value supplied.',
  '22P02': 'Invalid value supplied.',
  '22003': 'A number is out of range.',
  '42501': 'You do not have permission to perform this action.',
}

async function headers(extra = {}) {
  const h = { apikey: SUPABASE_PUBLISHABLE_KEY, ...extra }
  const user = auth.currentUser
  if (user) h.Authorization = `Bearer ${await user.getIdToken()}`
  return h
}

function parseError(status, body) {
  const raw = body?.message || body?.error || `Request failed (${status})`
  const m = /^([A-Z_]+)(?::\s*(.*))?$/s.exec(raw)
  if (m && body?.code === 'P0001') {
    const msg = m[2] || m[1].replace(/_/g, ' ').toLowerCase()
    return new ApiError(status, m[1], msg.charAt(0).toUpperCase() + msg.slice(1))
  }
  if (body?.code === '23505') {
    const d = `${body.details || ''} ${body.message || ''}`
    if (/sku/i.test(d)) return new ApiError(status, 'DUPLICATE', 'A product with this SKU already exists.')
    if (/barcode/i.test(d)) return new ApiError(status, 'DUPLICATE', 'A product with this barcode already exists.')
    if (/categories/i.test(d)) return new ApiError(status, 'DUPLICATE', 'A category with this name already exists.')
    if (/email/i.test(d)) return new ApiError(status, 'DUPLICATE', 'A user with this email already exists.')
  }
  if (body?.code && FRIENDLY[body.code]) return new ApiError(status, body.code, FRIENDLY[body.code])
  if (status === 401 || /JWT|jwt/.test(raw)) return new ApiError(401, 'SESSION', 'Your session has ended. Please sign in again.')
  return new ApiError(status, body?.code || 'ERROR', raw)
}

/** Calls a Postgres function: POST /rest/v1/rpc/<name> with named arguments. */
export async function rpc(name, args = {}) {
  let res
  try {
    res = await fetch(`${API_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: await headers({ 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: JSON.stringify(args),
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your internet connection.')
  }
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = { message: text } }
  if (!res.ok) {
    const err = parseError(res.status, body)
    if (err.status === 401 && onSessionError) onSessionError(err)
    throw err
  }
  return body
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

/** Uploads an image to Supabase Storage and returns its public URL. */
export async function uploadImage(bucket, folder, file) {
  if (!EXT[file.type]) throw new ApiError(400, 'VALIDATION', 'Image must be PNG, JPEG or WebP.')
  if (file.size > 2 * 1024 * 1024) throw new ApiError(400, 'VALIDATION', 'Image must be 2 MB or smaller.')
  const path = `${folder}/${crypto.randomUUID ? crypto.randomUUID() : Date.now()}.${EXT[file.type]}`
  let res
  try {
    res = await fetch(`${API_URL}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST',
      headers: await headers({ 'Content-Type': file.type, 'x-upsert': 'false', 'cache-control': '31536000' }),
      body: file,
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'Image upload failed. Check your connection.')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, 'STORAGE', body.message === 'new row violates row-level security policy'
      ? 'You are not allowed to upload this image.' : `Image upload failed (${body.message || res.status}).`)
  }
  return `${API_URL === SUPABASE_URL ? SUPABASE_URL : API_URL}/storage/v1/object/public/${bucket}/${path}`
}
