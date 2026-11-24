import { env, assertConfig } from './config/env.js';
import { createApp } from './app.js';
import { closePool, systemQuery } from './config/database.js';
import { logger } from './utils/logger.js';

assertConfig();

// The API runs user requests as the "authenticated" role so RLS applies.
// Fail fast if the database user cannot assume it or migrations are missing.
try {
  const { rows } = await systemQuery(
    "select pg_has_role(current_user, 'authenticated', 'member') as can_assume, to_regclass('public.system_settings') is not null as migrated");
  if (!rows[0].can_assume) throw new Error(`Database user cannot assume the "authenticated" role. Use the Supabase "postgres" user in DATABASE_URL.`);
  if (!rows[0].migrated) throw new Error('Database migrations have not been applied (see supabase/migrations).');
} catch (err) {
  logger.fatal(err.message);
  process.exit(1);
}

const app = createApp();
const server = app.listen(env.port, () => {
  logger.info(`POS API listening on port ${env.port} (${env.nodeEnv})`);
});

async function shutdown(signal) {
  logger.info(`${signal} received, shutting down`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
