// Public configuration. These values are designed to be visible in the browser:
// access is enforced by Firebase Authentication + Supabase row level security.
export const firebaseConfig = {
  apiKey: 'AIzaSyDNakwbCd0VrU6MEC0cfuinXRV5lEVzRwU',
  authDomain: 'pointofsale-c6771.firebaseapp.com',
  projectId: 'pointofsale-c6771',
  appId: '1:660647215701:web:bcf950065bbfd5490e8adc',
}

export const SUPABASE_URL = 'https://qnkknretbojqohiitjje.supabase.co'
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_5OIrWy_kR-UsGO34-iDPkw_MkWxXJuz'

// Local testing only: point at the Firebase Auth emulator / a local API by
// setting localStorage keys (never used in production unless set by hand).
function local(key) { try { return localStorage.getItem(key) } catch { return null } }
export const AUTH_EMULATOR = local('pos.authEmulator')
export const API_URL = local('pos.apiUrl') || SUPABASE_URL
if (local('pos.firebaseProjectId')) firebaseConfig.projectId = local('pos.firebaseProjectId')
