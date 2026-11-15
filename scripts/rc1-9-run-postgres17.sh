#!/usr/bin/env bash
set -Eeuo pipefail

readonly EXPECTED_APP_SHA='f8df53b1ffd77ea255fda1c7a663946a0b25607c'
readonly APP_DIR="${APP_DIR:-${GITHUB_WORKSPACE:-}/app-under-test}"
readonly STACK_DIR="${SUPABASE_TEST_WORKDIR:?SUPABASE_TEST_WORKDIR is required}"
readonly EXPECTED_STACK_DIR="${RUNNER_TEMP:?RUNNER_TEMP is required}/mk9-date-rc1-9-postgres17"

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

[[ "${APP_SHA:-}" == "$EXPECTED_APP_SHA" ]] || fail 'APP_SHA does not match the published RC1 commit.'
[[ "$(git -C "$APP_DIR" rev-parse HEAD)" == "$EXPECTED_APP_SHA" ]] || fail 'Application checkout is not the published RC1 commit.'
[[ "$STACK_DIR" == "$EXPECTED_STACK_DIR" ]] || fail 'Refusing to use a non-designated disposable work directory.'

for name in SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_PROJECT_REF SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL SUPABASE_ANON_KEY SUPABASE_TEST_ANON_KEY SUPABASE_TEST_SERVICE_KEY ANON_KEY SERVICE_ROLE_KEY DATABASE_URL DB_URL POSTGRES_URL API_URL; do
  [[ -z "${!name:-}" ]] || fail "Remote Supabase credential/configuration is present: $name"
done

[[ "$(supabase --version)" == '3.0.0' ]] || fail 'Unexpected Supabase CLI version.'
command -v psql >/dev/null || fail 'PostgreSQL client is unavailable.'
command -v python3 >/dev/null || fail 'Python 3 is required to patch only the temporary Supabase config.'

rm -rf "$STACK_DIR"
mkdir -p "$STACK_DIR/supabase"
cp "$APP_DIR/supabase/config.toml" "$STACK_DIR/supabase/config.toml"
cp -R "$APP_DIR/supabase/migrations" "$STACK_DIR/supabase/migrations"

# The source repository deliberately disables db reset and seeds. Enable migrations
# only in this disposable copy; never mutate app-under-test or a linked project.
python3 - "$STACK_DIR/supabase/config.toml" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
lines = path.read_text(encoding="utf-8").splitlines()
section = None
updated = {"project_id": False, "db.major_version": False, "db.migrations": False, "db.seed": False}
for index, line in enumerate(lines):
    if line.startswith("[") and line.endswith("]"):
        section = line[1:-1]
        continue
    if section is None and line.strip().startswith("project_id ="):
        lines[index] = 'project_id = "mk9-date-rc1-9-postgres17-disposable"'
        updated["project_id"] = True
    elif section == "db" and line.strip().startswith("major_version ="):
        lines[index] = "major_version = 17"
        updated["db.major_version"] = True
    elif section == "db.migrations" and line.strip().startswith("enabled ="):
        lines[index] = "enabled = true"
        updated[section] = True
    elif section == "db.seed" and line.strip().startswith("enabled ="):
        lines[index] = "enabled = false"
        updated[section] = True
if not all(updated.values()):
    raise SystemExit("Expected project_id, [db].major_version, [db.migrations], and [db.seed] in temporary config")
path.write_text("\n".join(lines) + "\n", encoding="utf-8")
PY

# This harness-only migration enables pg_cron before the unchanged RC1 M38 files.
cat > "$STACK_DIR/supabase/migrations/20260929000000_rc1_9_test_enable_pg_cron.sql" <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
SQL

test "$(grep -c '^project_id = "mk9-date-rc1-9-postgres17-disposable"$' "$STACK_DIR/supabase/config.toml")" -eq 1

mapfile -t migration_files < <(find "$APP_DIR/supabase/migrations" -maxdepth 1 -type f -name '*.sql' -print | sort)
test "${#migration_files[@]}" -gt 0 || fail 'No application migrations found.'
sha256sum "${migration_files[@]}" > "$STACK_DIR/application-migrations.sha256"
sha256sum "$STACK_DIR/supabase/migrations/20260929000000_rc1_9_test_enable_pg_cron.sql" > "$STACK_DIR/harness-bootstrap.sha256"
{
  echo '### RC1.9 isolated migration identity'
  echo "- Application SHA: \`$EXPECTED_APP_SHA\`"
  echo "- Harness SHA: \`${GITHUB_SHA:-local-uncommitted}\`"
  echo "- Supabase CLI: \`$(supabase --version)\`"
  echo "- Application migration count: ${#migration_files[@]}"
  echo '- Application migration SHA-256 entries:'
  sed 's#^.*/##' "$STACK_DIR/application-migrations.sha256" | sed 's/^/  - /'
  echo '- Harness bootstrap SHA-256:'
  cat "$STACK_DIR/harness-bootstrap.sha256" | sed 's/^/  - /'
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

cd "$STACK_DIR"
supabase start -x realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor >/dev/null

status_env="$(supabase status -o env)"
get_status_value() {
  local name="$1" value
  value="$(printf '%s\n' "$status_env" | sed -n "s/^${name}=//p" | head -n 1)"
  value="${value%\"}"
  value="${value#\"}"
  printf '%s' "$value"
}
api_url="$(get_status_value API_URL)"
anon_key="$(get_status_value ANON_KEY)"
service_key="$(get_status_value SERVICE_ROLE_KEY)"
[[ "$api_url" == 'http://127.0.0.1:54321' || "$api_url" == 'http://localhost:54321' ]] || fail 'Supabase API_URL is not the local loopback endpoint.'
[[ -n "$anon_key" && -n "$service_key" ]] || fail 'Local Auth keys were not returned by supabase status.'
printf '::add-mask::%s\n' "$anon_key"
printf '::add-mask::%s\n' "$service_key"
export SUPABASE_TEST_API_URL="$api_url"
export SUPABASE_TEST_ANON_KEY="$anon_key"
export SUPABASE_TEST_SERVICE_KEY="$service_key"
unset PGSERVICE PGSERVICEFILE PGHOST PGHOSTADDR PGPORT PGUSER PGPASSWORD PGDATABASE PGPASSFILE
export PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres
export PGSERVICEFILE=/dev/null PGPASSFILE=/dev/null

[[ "$PGHOST" == '127.0.0.1' && "$PGPORT" == '54322' ]] || fail 'PostgreSQL is not configured for local loopback.'
[[ "$SUPABASE_TEST_API_URL" == 'http://127.0.0.1:54321' || "$SUPABASE_TEST_API_URL" == 'http://localhost:54321' ]] || fail 'Refusing a non-local Supabase API URL.'
psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT current_setting('server_version_num')::int BETWEEN 170000 AND 179999" | grep -qx t || fail 'Disposable database is not PostgreSQL 17.'
echo "Disposable PostgreSQL version: $(psql -X -Atqc 'SHOW server_version')"

supabase db reset --local --no-seed

echo 'Running M37 database/API integration suite.'
cd "$GITHUB_WORKSPACE"
node scripts/m37-functional-tests.mjs
echo 'Running M38 database/API integration suite.'
node scripts/m38-functional-tests.mjs
echo 'Checking pg_cron execution and idempotent job registration.'
psql -X -v ON_ERROR_STOP=1 -f scripts/m38-cron-idempotence.sql >/dev/null

echo 'PASS: disposable PostgreSQL 17 M37/M38 suites completed.'
