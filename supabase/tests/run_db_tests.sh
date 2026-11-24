#!/usr/bin/env bash
# Runs the migrations + database test suite against a throwaway local PostgreSQL database.
# Requires a local PostgreSQL 15+ server and a superuser able to create roles.
#   PG_SUPERUSER_CMD="sudo -u postgres" ./supabase/tests/run_db_tests.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SUPER=${PG_SUPERUSER_CMD:-"su postgres -c"}
DB=${TEST_DB:-pos_test}
HOST=${PGHOST:-localhost}

run_super() { if [[ "$SUPER" == "su postgres -c" ]]; then su postgres -c "$1"; else $SUPER bash -c "$1"; fi; }

run_super "psql -q -v ON_ERROR_STOP=1 -f $(pwd)/tests/local_bootstrap.sql 2>/dev/null"
run_super "dropdb --if-exists $DB && createdb -O pos_owner $DB"

export PGPASSWORD=pos_owner_local
for f in migrations/*.sql; do
  psql -h "$HOST" -U pos_owner -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done
psql -h "$HOST" -U pos_owner -d "$DB" -v ON_ERROR_STOP=1 -f tests/db_tests.sql
