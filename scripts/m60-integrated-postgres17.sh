#!/usr/bin/env bash
set -Eeuo pipefail

for name in SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SUPABASE_PROJECT_REF SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL SUPABASE_ANON_KEY SUPABASE_TEST_ANON_KEY SUPABASE_TEST_SERVICE_KEY ANON_KEY SERVICE_ROLE_KEY; do
  if [[ -n "${!name:-}" ]]; then
    echo 'M60_REMOTE_SUPABASE_CONFIGURATION_PRESENT' >&2
    exit 1
  fi
done

psql -X -v ON_ERROR_STOP=1 -f scripts/m60-prepare-industry-seed.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261113190000_m59_contract_acl_and_industry_codes.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -f scripts/m60-assert-integrated-schema.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261114014936_m65_secure_visits_insert_policy.sql >/dev/null
psql -X -v ON_ERROR_STOP=1 -f scripts/m65-visits-policy-regression.sql >/dev/null

if psql -X -v ON_ERROR_STOP=1 -c "INSERT INTO public.industrias(codigo,nome) VALUES ('bad code','M60 invalid');" >/dev/null 2>&1; then
  echo 'M60_INVALID_INDUSTRY_CODE_WAS_ACCEPTED' >&2
  exit 1
fi
if psql -X -v ON_ERROR_STOP=1 -c "INSERT INTO public.industrias(codigo,nome) VALUES ('IND-9000000000000000000','M60 duplicate');" >/dev/null 2>&1; then
  echo 'M60_DUPLICATE_INDUSTRY_CODE_WAS_ACCEPTED' >&2
  exit 1
fi

seq 1 25 | xargs -P 10 -I '{}' psql -X -v ON_ERROR_STOP=1 -q \
  -c "INSERT INTO public.industrias(codigo,nome) VALUES (NULL,'M60 concurrent synthetic {}');" >/dev/null

psql -X -v ON_ERROR_STOP=1 -Atqc "
  SELECT count(*) = count(DISTINCT codigo)
     AND count(*) FILTER (WHERE codigo ~ '^IND-[0-9]+$') >= 27
  FROM public.industrias
" | grep -qx t

echo 'M60 integrated M37/M38 then M59 PostgreSQL 17 checks passed.'

# Restore smoke test with synthetic content in a second disposable database.
probe_db='mk9_m65_restore_probe'
psql -X -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS m65_restore_probe CASCADE; CREATE SCHEMA m65_restore_probe; CREATE TABLE m65_restore_probe.synthetic_snapshot(id integer PRIMARY KEY, payload text NOT NULL); INSERT INTO m65_restore_probe.synthetic_snapshot VALUES (1, '\''synthetic-only'\''), (2, '\''never-production-data'\'');' >/dev/null
restore_dump="${RUNNER_TEMP:-/tmp}/mk9-m65-restore-probe.dump"
pg_dump --format=custom --no-owner --no-privileges --dbname="${PGDATABASE:-postgres}" --schema=m65_restore_probe --file="$restore_dump" >/dev/null
created_db=0
cleanup_restore_probe() {
  if [ "$created_db" -eq 1 ]; then dropdb --if-exists "$probe_db" >/dev/null 2>&1 || true; fi
  rm -f -- "$restore_dump"
}
trap cleanup_restore_probe EXIT
createdb "$probe_db"
created_db=1
pg_restore --exit-on-error --no-owner --no-privileges --dbname="$probe_db" "$restore_dump"
psql -X -v ON_ERROR_STOP=1 -d "$probe_db" -Atqc "SELECT count(*) = 2 AND count(DISTINCT payload) = 2 FROM m65_restore_probe.synthetic_snapshot" | grep -qx t
cleanup_restore_probe
created_db=0
psql -X -v ON_ERROR_STOP=1 -c 'DROP SCHEMA m65_restore_probe CASCADE' >/dev/null
trap - EXIT
echo 'M65 synthetic PostgreSQL 17 dump/restore smoke test passed.'
