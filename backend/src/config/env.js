import 'dotenv/config';

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const nodeEnv = process.env.NODE_ENV || 'development';

export const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: Number(process.env.PORT || 4000),
  frontendUrls: (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: process.env.TRUST_PROXY ?? '1',

  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY,
    authEmulatorHost: process.env.FIREBASE_AUTH_EMULATOR_HOST,
    // Checking revocation costs one Firebase call per request but makes
    // deactivation/sign-out-everywhere take effect immediately.
    checkRevoked: bool(process.env.FIREBASE_CHECK_REVOKED, true),
  },

  database: {
    url: process.env.DATABASE_URL,
    ssl: bool(process.env.DATABASE_SSL, true),
    sslRejectUnauthorized: bool(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED, false),
    poolMax: Number(process.env.DATABASE_POOL_MAX || 10),
  },

  supabase: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },

  logLevel: process.env.LOG_LEVEL || (nodeEnv === 'test' ? 'silent' : 'info'),
};

export function assertConfig() {
  const missing = [];
  if (!env.firebase.projectId) missing.push('FIREBASE_PROJECT_ID');
  if (!env.firebase.authEmulatorHost) {
    if (!env.firebase.clientEmail) missing.push('FIREBASE_CLIENT_EMAIL');
    if (!env.firebase.privateKey) missing.push('FIREBASE_PRIVATE_KEY');
  }
  if (!env.database.url) missing.push('DATABASE_URL');
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}. See backend/.env.example`);
  }
  if (env.isProduction && env.firebase.authEmulatorHost) {
    // The emulator accepts unsigned tokens. Never allow it in production.
    throw new Error('FIREBASE_AUTH_EMULATOR_HOST must not be set in production');
  }
}
