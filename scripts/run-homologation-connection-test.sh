#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

echo "==> [MK9 DATE M42.5] Validating connection test preflight configuration..."
node -e '
import { validateConnectionTestConfig } from "./scripts/homologation-connection-test.mjs";
validateConnectionTestConfig(process.env);
console.log("Configuration preflight passed safely without credentials leak.");
'

echo "==> [MK9 DATE M42.5] Verifying IPv4 DNS resolution for Session Pooler..."
POOLER_HOST="${SUPABASE_POOLER_HOST:?}"
RESOLVED_IP="$(node -e '
import { verifyPoolerDnsResolution } from "./scripts/homologation-connection-test.mjs";
const host = process.env.SUPABASE_POOLER_HOST;
verifyPoolerDnsResolution(host).then(ip => {
  console.log(ip);
}).catch(err => {
  console.error("DNS Resolution Error:", err.message);
  process.exit(1);
});
')"
echo "DNS resolution verified for pooler host (IPv4: ${RESOLVED_IP})."

echo "==> [MK9 DATE M42.5] Extracting connection parameters for read-only probe..."
export PGPASSWORD="$(node -e 'const u=new URL(process.env.SUPABASE_DB_URL); process.stdout.write(decodeURIComponent(u.password))')"
export PGHOST="$(node -e 'process.stdout.write(new URL(process.env.SUPABASE_DB_URL).hostname)')"
export PGPORT="$(node -e 'process.stdout.write(new URL(process.env.SUPABASE_DB_URL).port||"5432")')"
export PGUSER="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.SUPABASE_DB_URL).username))')"
export PGDATABASE="postgres"
export PGSSLMODE="verify-full"
export PGSSLROOTCERT="system"

echo "==> [MK9 DATE M42.5] Checking client psql tool..."
psql --version | grep -q '^psql (PostgreSQL) 17\.'

echo "==> [MK9 DATE M42.5] Querying database identity (current_database, current_user, version)..."
PROBE_OUTPUT="$(psql --no-password --quiet --tuples-only --no-align --command="SELECT current_database() || '|' || current_user || '|' || current_setting('server_version_num')" 2> /tmp/psql-probe-error.log || (cat /tmp/psql-probe-error.log >&2 && exit 1))"

echo "==> [MK9 DATE M42.5] Validating response integrity..."
node -e '
import { parseSessionInspectionResult } from "./scripts/homologation-connection-test.mjs";
const raw = process.env.PROBE_OUTPUT;
const res = parseSessionInspectionResult(raw);
console.log("Successfully connected to PostgreSQL homologation database:");
console.log("  - Database: " + res.currentDatabase);
console.log("  - Current User: " + res.currentUser);
console.log("  - Engine Version Num: " + res.serverVersionNum + " (PostgreSQL 17 verified)");
' PROBE_OUTPUT="$PROBE_OUTPUT"

echo "==> [MK9 DATE M42.5] Connection test completed successfully with ZERO writes, dumps or schema changes."
