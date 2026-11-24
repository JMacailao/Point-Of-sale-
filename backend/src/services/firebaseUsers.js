import { randomBytes } from 'node:crypto';
import { firebaseAuth } from '../config/firebase.js';
import { AppError, conflict, badRequest } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

function mapFirebaseError(err) {
  switch (err?.code) {
    case 'auth/email-already-exists':
      return conflict('An account with this email address already exists', 'EMAIL_EXISTS');
    case 'auth/invalid-email':
      return badRequest('Invalid email address');
    case 'auth/invalid-password':
      return badRequest('Password does not meet the requirements');
    default:
      logger.error({ err }, 'firebase admin error');
      return new AppError(502, 'AUTH_PROVIDER_ERROR', 'The authentication service is unavailable. Please try again.');
  }
}

export function generateTemporaryPassword() {
  // Never shown or stored: the user sets their own password via the reset link.
  return `${randomBytes(18).toString('base64url')}aA1!`;
}

export async function createFirebaseUser({ email, password, displayName }) {
  try {
    return await firebaseAuth().createUser({
      email,
      password,
      displayName: displayName || undefined,
      emailVerified: false,
      disabled: false,
    });
  } catch (err) {
    throw mapFirebaseError(err);
  }
}

export async function getFirebaseUserByEmail(email) {
  try {
    return await firebaseAuth().getUserByEmail(email);
  } catch (err) {
    if (err?.code === 'auth/user-not-found') return null;
    throw mapFirebaseError(err);
  }
}

export async function deleteFirebaseUser(uid) {
  try {
    await firebaseAuth().deleteUser(uid);
  } catch (err) {
    logger.error({ err, uid }, 'failed to delete firebase user during rollback');
  }
}

export async function setFirebaseUserDisabled(uid, disabled) {
  try {
    await firebaseAuth().updateUser(uid, { disabled });
    if (disabled) await firebaseAuth().revokeRefreshTokens(uid);
  } catch (err) {
    throw mapFirebaseError(err);
  }
}

export async function revokeSessions(uid) {
  try {
    await firebaseAuth().revokeRefreshTokens(uid);
  } catch (err) {
    throw mapFirebaseError(err);
  }
}

export async function generatePasswordSetupLink(email) {
  try {
    return await firebaseAuth().generatePasswordResetLink(email);
  } catch (err) {
    logger.warn({ err }, 'could not generate password setup link');
    return null;
  }
}
