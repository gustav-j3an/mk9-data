#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() { echo "M65_BACKUP_PREFLIGHT_FAILED:$1" >&2; exit 1; }
[[ "${GITHUB_ACTIONS:-}" == true ]] || fail "github-hosted-runner-required"
[[ "${GITHUB_REF:-}" == refs/heads/main ]] || fail "main-ref-required"
[[ "${INPUT_CONFIRM_PRODUCTION_BACKUP:-}" == BACKUP_PRODUCTION ]] || fail "explicit-confirmation-required"
[[ "${SUPABASE_PROJECT_REF:-}" == xzmbesqhxcnuokjwrbnw ]] || fail "production-project-ref-mismatch"
[[ -n "${SUPABASE_DB_URL:-}" && -n "${SUPABASE_SERVICE_ROLE_KEY:-}" && -n "${SUPABASE_PROJECT_URL:-}" && -n "${AGE_RECIPIENT:-}" ]] || fail "required-secrets-missing"
[[ "$AGE_RECIPIENT" =~ ^age1[0-9a-z]+$ ]] || fail "invalid-age-recipient"
python3 - <<'PY' || fail "project-url-does-not-identify-production"
import os, sys, urllib.parse
u = urllib.parse.urlsplit(os.environ['SUPABASE_PROJECT_URL'])
sys.exit(0 if u.scheme == 'https' and u.hostname == os.environ['SUPABASE_PROJECT_REF'] + '.supabase.co' else 1)
PY

work="$RUNNER_TEMP/mk9-prod-backup-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
archive="$RUNNER_TEMP/mk9-production-backup-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT.tar.gz.age"
mkdir -m 0700 "$work"
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT

# Ensure the PostgreSQL URL targets only the configured production ref; never print it.
db_data="$(python3 - <<'PY'
import base64, os, sys, urllib.parse
url = urllib.parse.urlsplit(os.environ['SUPABASE_DB_URL'])
ref = os.environ['SUPABASE_PROJECT_REF']
if url.scheme not in ('postgres', 'postgresql') or url.hostname != f'db.{ref}.supabase.co':
    sys.exit(2)
password = urllib.parse.unquote(url.password or '').encode()
host = url.hostname
safe = urllib.parse.urlunsplit((url.scheme, f'{url.username or "postgres"}@{host}:{url.port or 5432}', url.path or '/postgres', url.query, ''))
print(base64.b64encode(password).decode())
print(safe)
PY
)" || fail "database-url-does-not-identify-production"
password_b64="${db_data%%$'\n'*}"
safe_db_url="${db_data#*$'\n'}"
PGPASSWORD="$(printf '%s' "$password_b64" | base64 --decode)"
export PGPASSWORD
unset db_data password_b64
[[ -n "$PGPASSWORD" ]] || fail "database-url-password-missing"

# Full logical database export (includes relational rows and Auth/Storage metadata),
# plus separate Auth and Storage schema snapshots for independent verification.
pg_dump --dbname="$safe_db_url" --format=custom --no-owner --no-privileges \
  --file="$work/database.dump" 2>/dev/null || fail "database-export-failed"
pg_dump --dbname="$safe_db_url" --format=custom --schema-only --schema=auth --no-owner --no-privileges \
  --file="$work/auth-schema.dump" 2>/dev/null || fail "auth-schema-export-failed"
pg_dump --dbname="$safe_db_url" --format=custom --schema-only --schema=storage --no-owner --no-privileges \
  --file="$work/storage-schema.dump" 2>/dev/null || fail "storage-schema-export-failed"

# Storage object bytes are fetched via API without printing bucket/object names.
# Auth user records and Storage bytes are production data; archive is encrypted below.
node scripts/mk9-export-auth.mjs "$work/auth-users.jsonl"
node scripts/mk9-export-storage.mjs "$work/storage-objects"
unset PGPASSWORD safe_db_url SUPABASE_DB_URL SUPABASE_SERVICE_ROLE_KEY

(cd "$work" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
tar -C "$work" -czf - . | age -r "$AGE_RECIPIENT" -o "$archive"
test -s "$archive" || fail "encrypted-archive-missing"
age -d -r "$AGE_RECIPIENT" "$archive" >/dev/null 2>&1 && fail "recipient-key-is-not-private"
echo "M65_BACKUP_ENCRYPTED archive_created=true; bytes=$(wc -c < "$archive")"
echo "Archive is only on the ephemeral runner. Retain it securely outside this workflow before the runner exits."
