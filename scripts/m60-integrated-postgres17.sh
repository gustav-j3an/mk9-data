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
