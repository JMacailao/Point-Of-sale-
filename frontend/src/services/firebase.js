import { initializeApp } from 'firebase/app'
import {
  getAuth, connectAuthEmulator, setPersistence, browserLocalPersistence, browserSessionPersistence,
} from 'firebase/auth'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseConfigured = Boolean(config.apiKey && config.projectId)

const app = initializeApp(firebaseConfigured ? config : { apiKey: 'missing', projectId: 'missing' })
export const auth = getAuth(app)

const emulator = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST
if (emulator) {
  connectAuthEmulator(auth, `http://${emulator}`, { disableWarnings: true })
}

export function applyRememberSession(remember) {
  return setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence)
}

/** Maps Firebase Auth error codes to user-friendly messages. */
export function firebaseErrorMessage(err) {
  switch (err?.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-login-credentials':
      return 'Incorrect email or password.'
    case 'auth/user-disabled':
      return 'This account has been deactivated. Contact your administrator.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.'
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.'
    case 'auth/invalid-email':
      return 'Enter a valid email address.'
    case 'auth/requires-recent-login':
      return 'Please sign in again to continue.'
    case 'auth/weak-password':
      return 'The password is too weak.'
    default:
      return err?.message || 'Something went wrong. Please try again.'
  }
}
