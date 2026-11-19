#!/usr/bin/env bash
# Restore a verified encrypted backup into a disposable local PostgreSQL 17 stack,
# run the real-data rehearsal, and remove all plaintext data before the job exits.
set -Eeuo pipefail
umask 077

BACKUP_DIR="${BACKUP_DIR:?}"
RUNNER_TEMP="${RUNNER_TEMP:?}"
ROOT="$RUNNER_TEMP/mk9-real-backup-rehearsal"
STACK="$ROOT/stack"
mkdir -m 700 -p "$ROOT" "$STACK"

for name in SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_PROJECT_REF SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL SUPABASE_ANON_KEY SUPABASE_TEST_ANON_KEY SUPABASE_TEST_SERVICE_KEY ANON_KEY SERVICE_ROLE_KEY DATABASE_URL DB_URL PGHOST PGPORT PGDATABASE PGUSER PGSERVICE PGSERVICEFILE; do
  if [[ -n "${!name:-}" ]]; then
    echo "FALHA DE SEGURANÇA: remote database configuration detected ($name)." >&2
    exit 1
  fi
done
shopt -s nocasematch
for name in $(compgen -e); do
  value="${!name:-}"
  if [[ "$value" =~ supabase\.co|pooler\.supabase\.com|xzmbesqhxcnuokjwrbnw|tafjceemuetqjyngresg ]]; then
    echo "FALHA DE SEGURANÇA: external Supabase host/reference found in environment variable $name." >&2
    exit 1
  fi
done
shopt -u nocasematch

cleanup() {
  status=$?
  if [[ -f "$STACK/supabase/config.toml" ]]; then
    (cd "$STACK" && supabase stop --no-backup >/dev/null 2>&1) || true
  fi
  container_name="supabase_db_${PROJECT_ID}"
  if ! docker info >/dev/null 2>&1; then
    echo "FALHA: Docker state could not be verified; network guard will remain active." >&2
    status=1
  else
    running="$(docker ps --filter "status=running" --filter "name=^/${container_name}$" --format '{{.ID}}')"
    if [[ -n "$running" ]]; then
      docker stop --time 15 "$container_name" >/dev/null 2>&1 || true
      running="$(docker ps --filter "status=running" --filter "name=^/${container_name}$" --format '{{.ID}}')"
    fi
    if [[ -n "$running" ]]; then
      echo "FALHA: PostgreSQL container is still running; network guard will remain active." >&2
      status=1
    else
      sudo bash scripts/rc1-25-egress-guard.sh disable >/dev/null 2>&1 || {
        echo "FALHA: could not remove the egress guard after container shutdown." >&2
        status=1
      }
    fi
  fi
  bash scripts/rc1-25-secure-remove.sh "$ROOT" "$BACKUP_DIR" >/dev/null 2>&1 || rm -rf -- "$ROOT" "$BACKUP_DIR"
  exit "$status"
}
trap cleanup EXIT

if [[ ! -s "$BACKUP_DIR/database.dump" || ! -s "$BACKUP_DIR/roles.sql" || ! -s "$BACKUP_DIR/inventory-before.json" || ! -s "$BACKUP_DIR/SHA256SUMS" ]]; then
  echo "FALHA: encrypted backup archive is missing a required database member." >&2
  exit 1
fi
(cd "$BACKUP_DIR" && sha256sum --check SHA256SUMS >/dev/null)

NONCE="$(node -e 'import("node:crypto").then(c => console.log(c.randomBytes(14).toString("hex")))')"
PROJECT_ID="mk9_restore_${NONCE}"
(cd "$STACK" && supabase init --force >/dev/null 2>&1)
sed -i 's/^major_version = .*/major_version = 17/' "$STACK/supabase/config.toml"
sed -i "s/^project_id = .*/project_id = \\"$PROJECT_ID\\"/" "$STACK/supabase/config.toml"
(cd "$STACK" && supabase start -x realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor >/dev/null 2>&1)

SERVER_VERSION="$(PGPASSWORD=postgres psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable' -v ON_ERROR_STOP=1 -Atc 'SHOW server_version;')"
if [[ ! "$SERVER_VERSION" =~ ^17\. ]]; then
  echo "FALHA: isolated restore server is not PostgreSQL 17.x." >&2
  exit 1
fi

CONTAINER_ID="$(docker ps --filter "name=^/supabase_db_$PROJECT_ID$" --format '{{.ID}}')"
if [[ -z "$CONTAINER_ID" ]]; then
  echo "FALHA: isolated PostgreSQL container was not found." >&2
  exit 1
fi
sudo bash scripts/rc1-25-egress-guard.sh enable "$CONTAINER_ID"
PGPASSWORD=postgres psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable' -v ON_ERROR_STOP=1 -c 'CREATE DATABASE mk9_backup_restore' >/dev/null

# Match the validated Run #21 restore bootstrap so ownership and Supabase roles resolve locally.
docker exec "$CONTAINER_ID" psql -U supabase_admin -d postgres -c 'ALTER ROLE postgres WITH SUPERUSER; CREATE ROLE pgbouncer; GRANT supabase_admin, supabase_auth_admin, supabase_storage_admin, supabase_functions_admin, pgbouncer TO postgres WITH ADMIN OPTION;' >/dev/null 2>"$ROOT/restore-bootstrap.log" || true
docker exec "$CONTAINER_ID" psql -U supabase_admin -d mk9_backup_restore -c 'GRANT USAGE ON SCHEMA public TO postgres; GRANT ALL ON DATABASE mk9_backup_restore TO postgres; GRANT supabase_admin, supabase_auth_admin, supabase_storage_admin, supabase_functions_admin, pgbouncer TO postgres WITH ADMIN OPTION;' >/dev/null 2>"$ROOT/restore-target-bootstrap.log" || true

node scripts/filter-roles.mjs "$BACKUP_DIR/roles.sql" "$ROOT/roles-filtered.sql" >/dev/null 2>&1
PGPASSWORD=postgres psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable' -v ON_ERROR_STOP=1 -f "$ROOT/roles-filtered.sql" >/dev/null 2>"$ROOT/restore-roles.log" || {
  echo "FALHA: backup roles could not be restored into the disposable server; details withheld from logs." >&2
  exit 1
}

docker cp "$BACKUP_DIR/database.dump" "$CONTAINER_ID:/tmp/mk9-real-database.dump" >/dev/null
docker exec "$CONTAINER_ID" pg_restore --exit-on-error --username=supabase_admin --dbname=mk9_backup_restore /tmp/mk9-real-database.dump >/dev/null 2>"$ROOT/pg-restore.log" || {
  echo "FALHA: pg_restore failed in the disposable PostgreSQL 17 database; details withheld from logs." >&2
  exit 1
}
docker exec "$CONTAINER_ID" rm -f /tmp/mk9-real-database.dump >/dev/null

LOCAL_DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/mk9_backup_restore?sslmode=disable'
test "$LOCAL_DB_URL" = 'postgresql://postgres:postgres@127.0.0.1:54322/mk9_backup_restore?sslmode=disable'
INVENTORY_BEFORE="$ROOT/inventory-before-migrations.json"
PGPASSWORD=postgres psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 --quiet --tuples-only --no-align --file=scripts/backup-inventory.sql > "$INVENTORY_BEFORE" 2>"$ROOT/inventory-restore.log" || {
  echo "FALHA: inventory capture after restore failed; details withheld from logs." >&2
  exit 1
}
node scripts/compare-inventory.mjs "$BACKUP_DIR/inventory-before.json" "$INVENTORY_BEFORE"

PGPASSWORD=postgres psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 --quiet --file=scripts/rc1-25-historical-data-snapshot.sql -v mode=capture >/dev/null 2>"$ROOT/historical-capture.log" || {
  echo "FALHA: could not capture private historical-data fingerprint baseline." >&2
  exit 1
}

echo "Verified full backup restore against its source inventory; applying migrations only to loopback database mk9_backup_restore."
MK9_USE_RESTORED_DB=true ./scripts/rc1-25-postgres17-runner.sh

PGPASSWORD=postgres psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 --quiet --file=scripts/rc1-25-historical-data-snapshot.sql -v mode=verify >/dev/null 2>"$ROOT/historical-verify.log" || {
  echo "FALHA: historical table/row fingerprint verification failed; details withheld from logs." >&2
  exit 1
}

FINAL_LEDGER="$(PGPASSWORD=postgres psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version ~ '^[0-9]{8,14}$';")"
if [[ "$FINAL_LEDGER" != "44" ]]; then
  echo "FALHA: expected 44 historical plus rehearsed ledger versions after migrations; found $FINAL_LEDGER." >&2
  exit 1
fi

echo "PASS: restored PG17 rehearsal completed; historical row counts/content fingerprints and migration ledger were preserved/updated as expected."
