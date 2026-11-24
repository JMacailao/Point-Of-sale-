// Integration test harness: real Express app + real PostgreSQL + Firebase Auth emulator.
//
// Requirements (see README "Running the tests"):
//   * Firebase Auth emulator:  firebase emulators:start --only auth --project demo-pos
//   * PostgreSQL with the Supabase roles (supabase/tests/local_bootstrap.sql) and an empty
//     database owned by pos_owner:  TEST_DATABASE_URL (default below)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const PROJECT = 'demo-pos';
const DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://pos_owner:pos_owner_local@localhost:5432/pos_e2e';

// Configure the app for tests BEFORE it is imported.
Object.assign(process.env, {
  NODE_ENV: 'test',
  FIREBASE_PROJECT_ID: PROJECT,
  FIREBASE_AUTH_EMULATOR_HOST: EMULATOR,
  FIREBASE_CHECK_REVOKED: 'true',
  DATABASE_URL,
  DATABASE_SSL: 'false',
  FRONTEND_URL: 'http://localhost:5173',
});

// ----------------------------------------------------------- fake storage
// Minimal stand-in for the Supabase Storage REST API (upload/remove only).
export const storageUploads = [];
let storageServer;
async function startFakeStorage() {
  storageServer = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.method === 'POST' && req.url.startsWith('/storage/v1/object/')) {
        const key = req.url.replace('/storage/v1/object/', '');
        if (key.startsWith('product-images') || key.startsWith('store-assets')) {
          storageUploads.push({ key, bytes: Buffer.concat(chunks).length });
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ Key: key, Id: 'x' }));
        }
      }
      if (req.method === 'DELETE') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end('[]');
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise((r) => storageServer.listen(0, '127.0.0.1', r));
  process.env.SUPABASE_URL = `http://127.0.0.1:${storageServer.address().port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
}

// --------------------------------------------------------------- database
export async function resetDatabase() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query('drop schema if exists app cascade; drop schema if exists public cascade; create schema public;');
    const dir = path.resolve(here, '../../supabase/migrations');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    }
  } finally {
    await client.end();
  }
}

export async function dbQuery(text, params) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, params)).rows;
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------- firebase
export async function clearFirebaseAccounts() {
  const r = await fetch(`http://${EMULATOR}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`Could not reach the Firebase Auth emulator at ${EMULATOR}`);
}

export async function signIn(email, password) {
  const r = await fetch(`http://${EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await r.json();
  if (!r.ok) throw Object.assign(new Error(`sign in failed: ${body.error?.message}`), { body });
  return body.idToken;
}

export async function signUpDirect(email, password) {
  const r = await fetch(`http://${EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`sign up failed: ${body.error?.message}`);
  return body.idToken;
}

export async function listFirebaseAccounts() {
  const r = await fetch(`http://${EMULATOR}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:batchGet?maxResults=100`, {
    headers: { authorization: 'Bearer owner' },
  });
  return (await r.json()).users || [];
}

// --------------------------------------------------------------------- app
let server;
let baseUrl;

export async function startApp() {
  await startFakeStorage();
  const { createApp } = await import('../src/app.js');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  return baseUrl;
}

export async function stopApp() {
  const { closePool } = await import('../src/config/database.js');
  await new Promise((r) => server.close(r));
  await new Promise((r) => storageServer.close(r));
  await closePool();
}

export async function api(method, url, { token, body, form, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    h['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const r = await fetch(`${baseUrl}${url}`, { method, headers: h, body: payload });
  const type = r.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await r.json() : await r.text();
  return { status: r.status, body: data, headers: r.headers };
}

// 1x1 transparent PNG
export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
