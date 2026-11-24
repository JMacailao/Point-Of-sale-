import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { env } from './env.js';

let authInstance;

export function firebaseAuth() {
  if (authInstance) return authInstance;
  const app = getApps()[0] || (env.firebase.authEmulatorHost
    ? initializeApp({ projectId: env.firebase.projectId })
    : initializeApp({
        credential: cert({
          projectId: env.firebase.projectId,
          clientEmail: env.firebase.clientEmail,
          // Hosting dashboards usually store the key with literal "\n" sequences.
          privateKey: env.firebase.privateKey?.replace(/\\n/g, '\n'),
        }),
        projectId: env.firebase.projectId,
      }));
  authInstance = getAuth(app);
  return authInstance;
}
