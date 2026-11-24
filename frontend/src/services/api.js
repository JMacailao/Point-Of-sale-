import { auth } from './firebase'

const BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000').replace(/\/$/, '') + '/api'

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

let storeId = null
let unauthorizedHandler = null

export function setApiStore(id) { storeId = id }
export function onUnauthorized(fn) { unauthorizedHandler = fn }

async function request(method, path, { body, query, raw = false, auth: withAuth = true } = {}) {
  const url = new URL(BASE + path)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v)
    }
  }
  const headers = {}
  if (withAuth && auth.currentUser) {
    headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`
  }
  if (storeId && withAuth) headers['X-Store-Id'] = storeId
  let payload
  if (body instanceof FormData) payload = body
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  let res
  try {
    res = await fetch(url, { method, headers, body: payload })
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.')
  }

  if (raw && res.ok) return res
  const isJson = (res.headers.get('content-type') || '').includes('application/json')
  const data = isJson ? await res.json() : null
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error?.code || 'ERROR', data?.error?.message || `Request failed (${res.status})`, data?.error?.details)
    if (res.status === 401 && withAuth && unauthorizedHandler) unauthorizedHandler(err)
    throw err
  }
  return data
}

export const api = {
  get: (path, query) => request('GET', path, { query }),
  post: (path, body) => request('POST', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  del: (path, body) => request('DELETE', path, { body }),
  public: (path) => request('GET', path, { auth: false }),
  publicPost: (path, body) => request('POST', path, { body, auth: false }),
  /** Downloads a file (CSV export) with authentication. */
  async download(path, query, fallbackName) {
    const res = await request('GET', path, { query, raw: true })
    const blob = await res.blob()
    const disposition = res.headers.get('content-disposition') || ''
    const name = /filename="([^"]+)"/.exec(disposition)?.[1] || fallbackName
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  },
}
