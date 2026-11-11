#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

echo "==> [MK9 DATE M42.5] Validating connection test preflight configuration and normalizing TLS..."
NORMALIZED_DB_URL="$(node -e '
import { validateConnectionTestConfig, verifySupabaseCaCertificate } from "./scripts/homologation-connection-test.mjs";
verifySupabaseCaCertificate();
const config = validateConnectionTestConfig(process.env);
process.stderr.write("::add-mask::" + config.normalizedUrl + "\n");
process.stdout.write(config.normalizedUrl);
')"
echo ""
echo "Configuration preflight passed safely with strong TLS policy enforced."

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

echo "==> [MK9 DATE M42.5] Checking client psql tool..."
psql --version | grep -q '^psql (PostgreSQL) 17\.'

echo "==> [MK9 DATE M42.5] Querying database identity (current_database, current_user, version)..."
PROBE_OUTPUT="$(psql --no-password --quiet --tuples-only --no-align --command="SELECT current_database() || '|' || current_user || '|' || current_setting('server_version_num');" 2> /tmp/psql-probe-error.log || (cat /tmp/psql-probe-error.log >&2 && exit 1))"
if [ -s /tmp/psql-probe-error.log ]; then
  cat /tmp/psql-probe-error.log >&2
fi

echo "==> [MK9 DATE M42.5] Validating response integrity..."
export PROBE_OUTPUT
node -e '
import { parseSessionInspectionResult } from "./scripts/homologation-connection-test.mjs";
const raw = process.env.PROBE_OUTPUT;
const res = parseSessionInspectionResult(raw);
console.log("Successfully connected to PostgreSQL homologation database:");
console.log("  - Database: " + res.currentDatabase);
console.log("  - Current User: " + res.currentUser);
console.log("  - Engine Version Num: " + res.serverVersionNum + " (PostgreSQL 17 verified)");
'

echo "==> [MK9 DATE M42.5] Connection test completed successfully with ZERO writes, dumps or schema changes."
