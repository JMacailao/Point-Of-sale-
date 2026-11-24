import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'firebase/auth'
import { auth, applyRememberSession } from '../services/firebase'
import { api, setApiStore, onUnauthorized } from '../services/api'

const AuthContext = createContext(null)

/**
 * Session state:
 *  - setupStatus: public { adminClaimed, setupCompleted, store } used only for routing
 *  - session: backend-verified context { user, store, role, permissions, setup }
 */
export function AuthProvider({ children }) {
  const [setupStatus, setSetupStatus] = useState(null)
  const [statusError, setStatusError] = useState(null)
  const [firebaseUser, setFirebaseUser] = useState(undefined)
  const [session, setSession] = useState(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [authMessage, setAuthMessage] = useState(null)
  const freshLogin = useRef(false)

  const refreshSetupStatus = useCallback(async () => {
    try {
      setStatusError(null)
      const { data } = await api.public('/setup/status')
      setSetupStatus(data)
      return data
    } catch (err) {
      setStatusError(err)
      return null
    }
  }, [])

  const applySession = useCallback((ctx) => {
    setSession(ctx)
    setApiStore(ctx?.store?.id ?? null)
  }, [])

  const loadSession = useCallback(async () => {
    const endpoint = freshLogin.current ? api.post('/auth/verify') : api.get('/auth/me')
    freshLogin.current = false
    const { data } = await endpoint
    applySession(data)
    return data
  }, [applySession])

  useEffect(() => { refreshSetupStatus() }, [refreshSetupStatus])

  useEffect(() => {
    onUnauthorized((err) => {
      setAuthMessage(err.code === 'SESSION_EXPIRED' || err.code === 'SESSION_REVOKED'
        ? err.message : 'Your session has ended. Please sign in again.')
      signOut(auth)
    })
    return onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user)
      if (!user) {
        applySession(null)
        setSessionLoading(false)
        return
      }
      setSessionLoading(true)
      try {
        await loadSession()
      } catch (err) {
        // The backend rejected the identity (no profile, inactive, ...): sign out.
        setAuthMessage(err.message)
        applySession(null)
        await signOut(auth)
      } finally {
        setSessionLoading(false)
      }
    })
  }, [applySession, loadSession])

  const login = useCallback(async (email, password, remember) => {
    setAuthMessage(null)
    await applyRememberSession(remember)
    freshLogin.current = true
    await signInWithEmailAndPassword(auth, email, password)
  }, [])

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout', {}) } catch { /* ignore: signing out anyway */ }
    await signOut(auth)
    applySession(null)
  }, [applySession])

  const resetPassword = useCallback((email) => sendPasswordResetEmail(auth, email), [])

  const can = useCallback((...perms) => perms.some((p) => session?.permissions?.includes(p)), [session])

  const value = useMemo(() => ({
    setupStatus, statusError, refreshSetupStatus, firebaseUser, session, sessionLoading,
    authMessage, setAuthMessage, login, logout, resetPassword, can, applySession, loadSession,
    store: session?.store ?? null, user: session?.user ?? null,
  }), [setupStatus, statusError, refreshSetupStatus, firebaseUser, session, sessionLoading, authMessage,
    login, logout, resetPassword, can, applySession, loadSession])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
