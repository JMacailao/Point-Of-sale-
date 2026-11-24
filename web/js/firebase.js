import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js'
import {
  getAuth, initializeAuth, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword, sendPasswordResetEmail, setPersistence, browserLocalPersistence,
  browserSessionPersistence, inMemoryPersistence, deleteUser, EmailAuthProvider, reauthenticateWithCredential,
  updatePassword,
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js'
import { firebaseConfig, AUTH_EMULATOR } from './config.js'

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
if (AUTH_EMULATOR) connectAuthEmulator(auth, `http://${AUTH_EMULATOR}`, { disableWarnings: true })

export {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword,
  sendPasswordResetEmail, deleteUser,
}

export function setRemember(remember) {
  return setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence)
}

export async function changePassword(current, next) {
  const cred = EmailAuthProvider.credential(auth.currentUser.email, current)
  await reauthenticateWithCredential(auth.currentUser, cred)
  await updatePassword(auth.currentUser, next)
}

/**
 * Creates a staff account WITHOUT signing the administrator out, using a
 * temporary secondary Firebase app with in-memory persistence. `link` runs
 * with the new account's uid; if it throws, the new account is deleted.
 */
export async function createStaffAccount(email, link) {
  const secondary = initializeApp(firebaseConfig, `staff-${Date.now()}`)
  const secAuth = initializeAuth(secondary, { persistence: inMemoryPersistence })
  if (AUTH_EMULATOR) connectAuthEmulator(secAuth, `http://${AUTH_EMULATOR}`, { disableWarnings: true })
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(24))
    const tempPassword = btoa(String.fromCharCode(...bytes)) + 'aA1!' // never shown or stored
    const { user } = await createUserWithEmailAndPassword(secAuth, email, tempPassword)
    try {
      return await link(user.uid)
    } catch (err) {
      await deleteUser(user).catch(() => {})
      throw err
    }
  } finally {
    await signOut(secAuth).catch(() => {})
    await deleteApp(secondary).catch(() => {})
  }
}

export function firebaseMessage(err) {
  switch (err?.code) {
    case 'auth/invalid-credential': case 'auth/wrong-password': case 'auth/user-not-found':
    case 'auth/invalid-login-credentials': return 'Incorrect email or password.'
    case 'auth/user-disabled': return 'This account has been disabled.'
    case 'auth/too-many-requests': return 'Too many attempts. Please wait a moment and try again.'
    case 'auth/network-request-failed': return 'Network error. Check your connection and try again.'
    case 'auth/invalid-email': return 'Enter a valid email address.'
    case 'auth/email-already-in-use': return 'An account with this email address already exists.'
    case 'auth/weak-password': return 'The password is too weak.'
    case 'auth/operation-not-allowed': return 'Email/password accounts are disabled in Firebase. Enable them in the Firebase console.'
    case 'auth/admin-restricted-operation': return 'Account creation is disabled in Firebase (Authentication > Settings > User actions).'
    case 'auth/requires-recent-login': return 'Please sign in again to continue.'
    default: return err?.message || 'Something went wrong. Please try again.'
  }
}
