import pg from 'pg';
import { env } from './env.js';

// NUMERIC (money) and BIGINT (counts) as JS numbers. All money arithmetic is
// done inside PostgreSQL with NUMERIC; JS only displays the results.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// DATE columns stay as 'YYYY-MM-DD' strings (no timezone shifting).
pg.types.setTypeParser(1082, (v) => v);

let pool;

export function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: env.database.url,
      max: env.database.poolMax,
      ssl: env.database.ssl ? { rejectUnauthorized: env.database.sslRejectUnauthorized } : false,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}

/**
 * Privileged query for trusted backend operations (setup status, identity
 * lookup, initial administrator claim). Never use it with client-controlled
 * identifiers that have not been verified.
 */
export function systemQuery(text, params) {
  return getPool().query(text, params);
}

export async function systemTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Runs `fn` inside a transaction as the Postgres "authenticated" role with the
 * verified Firebase UID in request.jwt.claims, so row level security policies
 * apply exactly as they would through the Supabase API.
 */
export async function withUser(firebaseUid, fn) {
  if (!firebaseUid) throw new Error('withUser requires a verified firebase uid');
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: firebaseUid, role: 'authenticated' }),
    ]);
    await client.query('set local role authenticated');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
