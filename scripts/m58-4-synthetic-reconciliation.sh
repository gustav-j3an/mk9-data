#!/usr/bin/env bash
set -Eeuo pipefail

for name in SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_PROJECT_REF SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL SUPABASE_ANON_KEY SUPABASE_TEST_ANON_KEY SUPABASE_TEST_SERVICE_KEY ANON_KEY SERVICE_ROLE_KEY; do
  if [[ -n "${!name:-}" ]]; then
    echo 'REMOTE_SUPABASE_CONFIGURATION_PRESENT' >&2
    exit 1
  fi
done

ROOT="$RUNNER_TEMP/m58-4"
mkdir -m 700 -p "$ROOT"
NONCE="$(node -e 'import("node:crypto").then(c => console.log(c.randomBytes(14).toString("hex")))')"
PROJECT_ID="mk9_synth_${NONCE}"
STACK="$ROOT/stack"
mkdir -m 700 -p "$STACK"
cleanup() {
  status=$?
  if [[ -f "$STACK/supabase/config.toml" ]]; then
    (cd "$STACK" && supabase stop --no-backup >/dev/null 2>&1) || status=1
    if docker ps --filter "name=^/supabase_db_${PROJECT_ID}$" --quiet | grep -q .; then
      echo 'DISPOSABLE_CONTAINER_STOP_FAILED' >&2
      status=1
    fi
  fi
  rm -rf "$ROOT"
  if [[ -e "$ROOT" ]]; then
    echo 'TEMPORARY_DATA_CLEANUP_FAILED' >&2
    status=1
  fi
  exit "$status"
}
trap cleanup EXIT

curl -fsSL https://github.com/supabase/cli/releases/download/v3.0.0/supabase_3.0.0_linux_amd64.tar.gz -o "$RUNNER_TEMP/supabase-cli.tar.gz"
tar -xzf "$RUNNER_TEMP/supabase-cli.tar.gz" -C "$RUNNER_TEMP" supabase
sudo install "$RUNNER_TEMP/supabase" /usr/local/bin/supabase
rm -f "$RUNNER_TEMP/supabase-cli.tar.gz" "$RUNNER_TEMP/supabase"
test "$(supabase --version)" = 3.0.0
(cd "$STACK" && supabase init --force >/dev/null)
sed -i 's/^major_version = .*/major_version = 17/' "$STACK/supabase/config.toml"
sed -i "s/^project_id = .*/project_id = \"${PROJECT_ID}\"/" "$STACK/supabase/config.toml"
(cd "$STACK" && supabase start -x realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor >/dev/null)

CONTAINER_NAME="supabase_db_${PROJECT_ID}"
mapfile -t FOUND < <(docker ps --filter "name=^/${CONTAINER_NAME}$" --format '{{.ID}}')
if [[ ${#FOUND[@]} -ne 1 ]]; then echo 'DISPOSABLE_CONTAINER_COUNT_INVALID' >&2; exit 1; fi
CONTAINER_ID="${FOUND[0]}"
IMAGE="$(docker inspect --format '{{.Config.Image}}' "$CONTAINER_ID")"
CLI_LABEL="$(docker inspect --format '{{ index .Config.Labels "com.supabase.cli.project" }}' "$CONTAINER_ID")"
COMPOSE_LABEL="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$CONTAINER_ID")"
[[ "$CONTAINER_ID" =~ ^[0-9a-fA-F]{12,64}$ ]]
[[ "$IMAGE" =~ ^(public\.ecr\.aws/)?supabase/postgres:[a-zA-Z0-9_.-]+$ ]]
[[ "$CLI_LABEL" == "$PROJECT_ID" && "$COMPOSE_LABEL" == "$PROJECT_ID" ]]
echo 'Container metadata verified: unique ephemeral project, official PostgreSQL image, matching labels.'

DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable'
unset PGHOST PGPORT PGDATABASE PGUSER PGSSLMODE PGSSLROOTCERT PGHOSTADDR PGOPTIONS PGSERVICE PGSERVICEFILE
export PGPASSWORD=postgres
node scripts/m58-4-disposable-target.mjs "$DB_URL" "$PROJECT_ID" "$NONCE"
# Only after project name, exact count, image, and labels match do we write a nonce challenge.
psql "$DB_URL" -v ON_ERROR_STOP=1 -c 'CREATE TABLE public.mk9_disposable_nonce(token text);' >/dev/null
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO public.mk9_disposable_nonce VALUES ('${NONCE}');" >/dev/null
CONTAINER_NETWORKS="$(docker inspect --format '{{json .NetworkSettings.Networks}}' "$CONTAINER_ID")"
[[ -n "$CONTAINER_NETWORKS" && "$CONTAINER_NETWORKS" != 'null' ]]
PROBE="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -F '|' -Atc "SELECT current_database(), inet_server_addr()::text, inet_server_port(), current_setting('server_version_num'), (SELECT count(*) FROM public.mk9_disposable_nonce WHERE token='${NONCE}');")"
node scripts/m58-4-disposable-target.mjs "$DB_URL" "$PROJECT_ID" "$NONCE" "$PROBE" "$CONTAINER_NETWORKS"
RESOLVED="$(node scripts/resolve-disposable-container.mjs "$PROJECT_ID" "$NONCE" public.mk9_disposable_nonce)"
[[ "${RESOLVED,,}" == "${CONTAINER_ID,,}" ]]
echo 'Database nonce challenge verified the exact container.'

psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/m58-4-synthetic-fixture.sql >/dev/null
for migration in \
  supabase/migrations/20261009144200_add_visits_unique_constraint.sql \
  supabase/migrations/20261010_create_system_settings_and_audit.sql \
  supabase/migrations/20261011120000_create_promoter_authorizations.sql \
  supabase/migrations/20261011140000_auto_generate_industry_code.sql \
  supabase/migrations/20261017120000_create_contratos_lojas_table.sql \
  supabase/migrations/20261017_create_avatars_storage_policies.sql; do
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
done
psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/m58-4-assert-migration-objects.sql >/dev/null
node scripts/m58-4-verify-function-bodies.mjs "$DB_URL"

# Prove the catalog assertions reject a divergent column and policy; each failed check
# terminates its transaction, and a clean assertion pass immediately proves rollback.
if psql "$DB_URL" -v ON_ERROR_STOP=1 -c 'BEGIN; ALTER TABLE public.system_settings RENAME COLUMN value TO value_mismatch;' -f scripts/m58-4-assert-migration-objects.sql >/dev/null 2>&1; then
  echo 'M58_4_NEGATIVE_COLUMN_ASSERTION_FAILED' >&2
  exit 1
fi
psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/m58-4-assert-migration-objects.sql >/dev/null
if psql "$DB_URL" -v ON_ERROR_STOP=1 -c 'BEGIN; ALTER POLICY system_settings_select_authenticated ON public.system_settings USING (false);' -f scripts/m58-4-assert-migration-objects.sql >/dev/null 2>&1; then
  echo 'M58_4_NEGATIVE_POLICY_ASSERTION_FAILED' >&2
  exit 1
fi
psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/m58-4-assert-migration-objects.sql >/dev/null
echo 'Negative catalog probes rejected altered column and policy definitions; rollback was verified.'

# Synthetic fixture ledger has exactly 17 pre-existing versions; none is a candidate version.
node scripts/bundle-repository-migrations.mjs "$ROOT/migrations-bundle" >/dev/null
node scripts/m58-4-ledger-setup.mjs "$ROOT/migrations-bundle/manifest.json" > "$ROOT/ledger-setup.sql"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$ROOT/ledger-setup.sql" >/dev/null
psql "$DB_URL" -v ON_ERROR_STOP=1 --tuples-only --no-align --file=scripts/backup-inventory.sql > "$ROOT/inventory-before.json"
psql "$DB_URL" -v ON_ERROR_STOP=1 -Atc "SELECT COALESCE(json_agg(json_build_object('version',version,'statements',statements,'name',name) ORDER BY version), '[]'::json) FROM supabase_migrations.schema_migrations" > "$ROOT/ledger-before.json"
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO supabase_migrations.schema_migrations(version, statements) VALUES ('20261009144200', ARRAY['synthetic ledger simulation']), ('20261010', ARRAY['synthetic ledger simulation']), ('20261011120000', ARRAY['synthetic ledger simulation']), ('20261011140000', ARRAY['synthetic ledger simulation']), ('20261017120000', ARRAY['synthetic ledger simulation']), ('20261017', ARRAY['synthetic ledger simulation']);" >/dev/null
psql "$DB_URL" -v ON_ERROR_STOP=1 --tuples-only --no-align --file=scripts/backup-inventory.sql > "$ROOT/inventory-after.json"
psql "$DB_URL" -v ON_ERROR_STOP=1 -Atc "SELECT COALESCE(json_agg(json_build_object('version',version,'statements',statements,'name',name) ORDER BY version), '[]'::json) FROM supabase_migrations.schema_migrations" > "$ROOT/ledger-after.json"
node scripts/m58-4-assert-invariance.mjs "$ROOT/inventory-before.json" "$ROOT/inventory-after.json"
node scripts/m58-4-assert-ledger-transition.mjs "$ROOT/ledger-before.json" "$ROOT/ledger-after.json"
pg_dump --data-only --schema=supabase_migrations "$DB_URL" > "$ROOT/migration-history-data.sql"
node scripts/reconcile-migrations.mjs "$ROOT/migration-history-data.sql" "$ROOT/migrations-bundle/manifest.json"
[[ "$(psql "$DB_URL" -Atc 'SELECT count(*) FROM supabase_migrations.schema_migrations')" == 23 ]]
echo 'Synthetic PostgreSQL 17 validation passed: six object assertions, ledger 17→23, and non-ledger inventory invariant.'
