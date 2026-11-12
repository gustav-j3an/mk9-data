#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

RUN_ID="${GITHUB_RUN_ID:?}"
RUN_ATTEMPT="${GITHUB_RUN_ATTEMPT:?}"
ARTIFACT_PATH="${RUNNER_TEMP:?}/mk9-production-backup-${RUN_ID}-${RUN_ATTEMPT}.tar.gz.gpg"
rm -f "$ARTIFACT_PATH"
ROOT="${RUNNER_TEMP}/mk9-production-backup"
mkdir -p "$ROOT/export" "$ROOT/restore" "$ROOT/logs"
chmod 700 "$ROOT" "$ROOT/export" "$ROOT/restore" "$ROOT/logs"

cleanup() {
  if [[ -n "${DISPOSABLE_STACK_DIR:-}" && -d "$DISPOSABLE_STACK_DIR" ]]; then
    (cd "$DISPOSABLE_STACK_DIR" && supabase stop --no-backup >/dev/null 2>&1) || true
  elif [[ -d "$ROOT/supabase" ]]; then
    (cd "$ROOT/supabase" && supabase stop --no-backup >/dev/null 2>&1) || true
  fi
  rm -rf "$ROOT"
  if [[ "${BACKUP_COMPLETE:-false}" != true ]]; then
    rm -f "$ARTIFACT_PATH"
  fi
}
BACKUP_COMPLETE=false
trap cleanup EXIT
STAGE=preflight
on_error() { echo "Production backup workflow failed at stage: ${STAGE}. Detailed logs were kept private and removed with the runner workspace." >&2; }
trap 'on_error' ERR

node scripts/production-preflight.mjs
NORMALIZED_DB_URL="$(node -e '
import { normalizeProductionPoolerUrl } from "./scripts/production-pooler-connection.mjs";
const normalized = normalizeProductionPoolerUrl(process.env.SUPABASE_DB_URL);
process.stderr.write("::add-mask::" + normalized + "\n");
process.stdout.write(normalized);
')"
node -e "console.log('::add-mask::'+process.env.SUPABASE_DB_URL); console.log('::add-mask::'+process.env.SUPABASE_SERVICE_ROLE_KEY); console.log('::add-mask::'+process.env.BACKUP_GPG_PASSPHRASE)"
printf '%s' "$BACKUP_GPG_PASSPHRASE" > "$ROOT/passphrase"
chmod 600 "$ROOT/passphrase"
unset BACKUP_GPG_PASSPHRASE

STAGE=database-export
export PGPASSWORD="$(node -e 'const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.password))' "$NORMALIZED_DB_URL")"
export PGHOST="$(node -e 'process.stdout.write(new URL(process.argv[1]).hostname)' "$NORMALIZED_DB_URL")"
export PGPORT="$(node -e 'process.stdout.write(new URL(process.argv[1]).port||"5432")' "$NORMALIZED_DB_URL")"
export PGUSER="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.argv[1]).username))' "$NORMALIZED_DB_URL")"
export PGDATABASE="postgres"
export PGSSLMODE="verify-full"
export PGSSLROOTCERT="$(node -e '
import path from "node:path";
import fs from "node:fs";
const u = new URL(process.argv[1]);
const certParam = u.searchParams.get("sslrootcert") || "certs/supabase-prod-ca-2021.crt";
if (certParam === "system") {
  process.stdout.write("system");
} else {
  const resolved = path.resolve(certParam);
  if (!fs.existsSync(resolved)) {
    console.error("SSL Root Certificate file not found:", resolved);
    process.exit(1);
  }
  process.stdout.write(resolved);
}
' "$NORMALIZED_DB_URL")"

# PostgreSQL 17 verification and inventory
pg_dump --version | grep -q '^pg_dump (PostgreSQL) 17\.'
SERVER_VERSION_NUM="$(psql --no-password --quiet --tuples-only --no-align --command='SHOW server_version_num' 2> "$ROOT/logs/server-version.log" | tr -d '[:space:]')"
if [[ ! "$SERVER_VERSION_NUM" =~ ^[0-9]{6}$ ]] || (( SERVER_VERSION_NUM < 170000 || SERVER_VERSION_NUM >= 180000 )); then
  echo 'The allowlisted production database is not PostgreSQL 17; export stopped.' >&2
  exit 1
fi

# Capture source inventory before export
psql -v ON_ERROR_STOP=1 --no-password --quiet --tuples-only --no-align --file=scripts/backup-inventory.sql > "$ROOT/export/inventory-before.json" 2> "$ROOT/logs/inventory-before.log" || (cat "$ROOT/logs/inventory-before.log" >&2 && exit 1)
test -s "$ROOT/export/inventory-before.json" || (echo "Inventory before is empty. Error log:" >&2 && cat "$ROOT/logs/inventory-before.log" >&2 && exit 1)

# Export schema, data, roles, and migration history
pg_dump --format=custom --file="$ROOT/export/database.dump" --no-password 2> "$ROOT/logs/pg_dump.log" || (cat "$ROOT/logs/pg_dump.log" >&2 && exit 1)
supabase db dump --role-only --remote="$NORMALIZED_DB_URL" > "$ROOT/export/roles.sql" 2> "$ROOT/logs/roles.log" || (cat "$ROOT/logs/roles.log" >&2 && exit 1)
pg_dump --schema-only --schema=supabase_migrations --file="$ROOT/export/migration-history.sql" --no-password 2> "$ROOT/logs/migration-schema.log" || (cat "$ROOT/logs/migration-schema.log" >&2 && exit 1)
pg_dump --data-only --schema=supabase_migrations --file="$ROOT/export/migration-history-data.sql" --no-password 2> "$ROOT/logs/migration-data.log" || (cat "$ROOT/logs/migration-data.log" >&2 && exit 1)

# Capture and bundle repository migrations with SHA256 hashes
node scripts/bundle-repository-migrations.mjs "$ROOT/export/migrations-bundle"

STAGE=storage-export
node scripts/production-storage-backup.mjs export "$ROOT/export/storage"

# Re-check production inventory to confirm database remains identical
psql -v ON_ERROR_STOP=1 --no-password --quiet --tuples-only --no-align --file=scripts/backup-inventory.sql > "$ROOT/export/inventory-after-source.json" 2> "$ROOT/logs/inventory-after-source.log" || (cat "$ROOT/logs/inventory-after-source.log" >&2 && exit 1)
test -s "$ROOT/export/inventory-after-source.json" || (echo "Inventory after source is empty. Error log:" >&2 && cat "$ROOT/logs/inventory-after-source.log" >&2 && exit 1)
node scripts/compare-inventory.mjs "$ROOT/export/inventory-before.json" "$ROOT/export/inventory-after-source.json"

# Restore and check in a fresh, disposable Supabase PostgreSQL 17 stack. No remote URL is mounted into it.
STAGE=disposable-restore
# Generate ephemeral stack project_id and cryptographic nonce to unambiguously bind the disposable container.
# Supabase CLI 3.0.0 truncates project names to at most 40 characters when naming Docker Compose containers.
# With prefix 'mk9_restore_' (12 chars), exactly 28 hex chars (14 bytes = 112 bits of entropy) guarantees
# that DISPOSABLE_PROJECT_ID is exactly 40 characters and is never truncated by the CLI or Docker Compose.
DISPOSABLE_STACK_NONCE="$(node -e 'import("node:crypto").then(c => console.log(c.randomBytes(14).toString("hex")))')"
DISPOSABLE_PROJECT_ID="mk9_restore_${DISPOSABLE_STACK_NONCE}"
DISPOSABLE_STACK_DIR="$ROOT/${DISPOSABLE_PROJECT_ID}"
mkdir -p "$DISPOSABLE_STACK_DIR"
(cd "$DISPOSABLE_STACK_DIR" && supabase init --force >/dev/null 2> "$ROOT/logs/supabase-init.log")

sed -i 's/^major_version = .*/major_version = 17/' "$DISPOSABLE_STACK_DIR/supabase/config.toml"
sed -i "s/^project_id = .*/project_id = \"${DISPOSABLE_PROJECT_ID}\"/" "$DISPOSABLE_STACK_DIR/supabase/config.toml"
(cd "$DISPOSABLE_STACK_DIR" && supabase start -x realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor >/dev/null 2> "$ROOT/logs/supabase-start.log")

# Unset PG* environment variables from remote export so local connections use default/explicit parameters
unset PGHOST PGPORT PGUSER PGDATABASE PGSSLMODE PGSSLROOTCERT
LOCAL_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable"
LOCAL_STORAGE_URL="http://127.0.0.1:54321"
LOCAL_SERVICE_KEY="$(cd "$DISPOSABLE_STACK_DIR" && supabase status -o env 2> "$ROOT/logs/supabase-status.log" | sed -n 's/^SERVICE_ROLE_KEY=//p' | tr -d '"\r')"
test -n "$LOCAL_SERVICE_KEY"
echo "::add-mask::$LOCAL_SERVICE_KEY"
export RESTORE_SUPABASE_URL="$LOCAL_STORAGE_URL"
export RESTORE_SUPABASE_SERVICE_ROLE_KEY="$LOCAL_SERVICE_KEY"

# Plant cryptographic nonce into the disposable PostgreSQL database via LOCAL_DB_URL
PGPASSWORD=postgres psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -c "CREATE TABLE IF NOT EXISTS mk9_backup_restore_nonce (token text); INSERT INTO mk9_backup_restore_nonce VALUES ('${DISPOSABLE_STACK_NONCE}');" || (cat "$ROOT/logs/restore-database.log" >&2 && exit 1)

# Database restore and Storage API restore are separate checks inside one disposable local stack.
PGPASSWORD=postgres psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -c 'CREATE DATABASE mk9_backup_restore' || (cat "$ROOT/logs/restore-database.log" >&2 && exit 1)

# In the clean disposable stack, grant superuser and missing roles to postgres so pg_restore
# can restore objects and schema definitions without role mismatch.
# Unambiguously resolve the disposable container matching DISPOSABLE_PROJECT_ID, image provenance,
# and internal database nonce verification before performing any docker exec commands.
CONTAINER_ID="$(node scripts/resolve-disposable-container.mjs "$DISPOSABLE_PROJECT_ID" "$DISPOSABLE_STACK_NONCE")"
if [[ -z "$CONTAINER_ID" ]]; then
  echo "DISPOSABLE_CONTAINER_RESOLUTION_FAILED: Resolution script returned empty container identifier" >&2
  exit 1
fi
CONTAINER_IMAGE="$(docker inspect --format '{{ .Config.Image }}' "$CONTAINER_ID" 2>/dev/null || true)"
echo "Disposable database container verified unambiguously (ID: $CONTAINER_ID, Project: $DISPOSABLE_PROJECT_ID, Image: $CONTAINER_IMAGE)"

docker exec "$CONTAINER_ID" psql -U supabase_admin -d postgres -c 'ALTER ROLE postgres WITH SUPERUSER; CREATE ROLE pgbouncer; GRANT supabase_admin, supabase_auth_admin, supabase_storage_admin, supabase_functions_admin, pgbouncer TO postgres WITH ADMIN OPTION;' || true
docker exec "$CONTAINER_ID" psql -U supabase_admin -d mk9_backup_restore -c 'GRANT USAGE ON SCHEMA public TO postgres; GRANT ALL ON DATABASE mk9_backup_restore TO postgres; GRANT supabase_admin, supabase_auth_admin, supabase_storage_admin, supabase_functions_admin, pgbouncer TO postgres WITH ADMIN OPTION;' || true
docker cp "$ROOT/export/database.dump" "$CONTAINER_ID:/tmp/database.dump"

# Filter out Supabase internal roles from roles.sql before local restore
node scripts/filter-roles.mjs "$ROOT/export/roles.sql" "$ROOT/restore/roles-filtered.sql"

PGPASSWORD=postgres psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable' -v ON_ERROR_STOP=1 -f "$ROOT/restore/roles-filtered.sql" > /dev/null 2> "$ROOT/logs/restore-roles.log" || (cat "$ROOT/logs/restore-roles.log" >&2 && exit 1)
PGPASSWORD=postgres psql 'postgresql://postgres:postgres@127.0.0.1:54322/mk9_backup_restore?sslmode=disable' -v ON_ERROR_STOP=1 -f "$ROOT/restore/roles-filtered.sql" > /dev/null 2> "$ROOT/logs/restore-roles-target.log" || true
docker exec "$CONTAINER_ID" pg_restore --exit-on-error --username=supabase_admin --dbname=mk9_backup_restore /tmp/database.dump > /dev/null 2> "$ROOT/logs/restore-database.log" || (cat "$ROOT/logs/restore-database.log" >&2 && exit 1)
docker exec "$CONTAINER_ID" rm -f /tmp/database.dump || true
PGPASSWORD=postgres psql 'postgresql://postgres:postgres@127.0.0.1:54322/mk9_backup_restore?sslmode=disable' -v ON_ERROR_STOP=1 --quiet --tuples-only --no-align --file=scripts/backup-inventory.sql > "$ROOT/restore/inventory-after.json" 2> "$ROOT/logs/inventory-restore.log" || (cat "$ROOT/logs/inventory-restore.log" >&2 && exit 1)
node scripts/compare-inventory.mjs "$ROOT/export/inventory-before.json" "$ROOT/restore/inventory-after.json"
echo 'Disposable PostgreSQL database restore verified independently in database mk9_backup_restore.'

# Reconcile database migration history against repository migrations bundle
# ABORTS WITH EXIT CODE 1 IF ANY UNMATCHED MIGRATION EXISTS IN DATABASE LEDGER
node scripts/reconcile-migrations.mjs "$ROOT/export/migration-history-data.sql" "$ROOT/export/migrations-bundle/manifest.json"

node scripts/production-storage-backup.mjs verify "$ROOT/export/storage"

# Rebuild disposable Storage API and verify object bytes
node scripts/production-storage-backup.mjs restore-local "$ROOT/export/storage" "$ROOT/restore/storage-metadata.sql"
PGPASSWORD=postgres psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 --file="$ROOT/restore/storage-metadata.sql" > /dev/null 2> "$ROOT/logs/restore-storage-metadata.log" || (cat "$ROOT/logs/restore-storage-metadata.log" >&2 && exit 1)
node scripts/production-storage-backup.mjs verify-local "$ROOT/export/storage"

STAGE=package-encrypt-upload
(
  cd "$ROOT/export"
  find . -type f -print0 | sort -z | xargs -0 sha256sum > "$ROOT/SHA256SUMS"
)
mv "$ROOT/SHA256SUMS" "$ROOT/export/SHA256SUMS"
(cd "$ROOT/export" && sha256sum --check SHA256SUMS) >/dev/null 2> "$ROOT/logs/checksum-before-encryption.log"
pg_restore --list "$ROOT/export/database.dump" > /dev/null 2> "$ROOT/logs/archive-list.log"

tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner -C "$ROOT/export" -czf "$ROOT/backup.tar.gz" .
gpg --batch --yes --pinentry-mode loopback --passphrase-file "$ROOT/passphrase" --symmetric --cipher-algo AES256 --output "$ROOT/backup.tar.gz.gpg" "$ROOT/backup.tar.gz"
gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$ROOT/passphrase" --decrypt "$ROOT/backup.tar.gz.gpg" > "$ROOT/decrypted.tar.gz"
mkdir -m 700 "$ROOT/decrypted-check"
tar -xzf "$ROOT/decrypted.tar.gz" -C "$ROOT/decrypted-check" 2> "$ROOT/logs/archive-extract.log"
(cd "$ROOT/decrypted-check" && sha256sum --check SHA256SUMS) >/dev/null 2> "$ROOT/logs/checksum-after-encryption.log"
pg_restore --list "$ROOT/decrypted-check/database.dump" > /dev/null 2> "$ROOT/logs/archive-list-after-encryption.log"
node scripts/production-storage-backup.mjs verify "$ROOT/decrypted-check/storage"

install -m 0600 "$ROOT/backup.tar.gz.gpg" "$ARTIFACT_PATH"
test -s "$ARTIFACT_PATH"
BACKUP_COMPLETE=true
echo 'Encrypted production backup artifact prepared after separate disposable PostgreSQL and Storage validations.'
