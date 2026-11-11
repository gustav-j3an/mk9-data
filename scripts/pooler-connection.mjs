export const HOMOLOGATION_REF = 'tafjceemuetqjyngresg';
export const ALLOWED_BACKUP_BRANCH = 'codex/m42.2-m39-session-pooler';
export const SUPABASE_CA_CERT_PATH = 'certs/supabase-prod-ca-2021.crt';
export const SUPABASE_CA_SHA256 = '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA';

const HOST_FORMAT = /^[a-z0-9]+(?:-[a-z0-9]+)*\.pooler\.supabase\.com$/;

/**
 * Normalizes a database connection URL by ensuring exact TLS parameters:
 * sslmode=verify-full&sslrootcert=<path-to-supabase-ca> (or system).
 *
 * If no query parameters are present, it safely appends sslmode=verify-full&sslrootcert=certs/supabase-prod-ca-2021.crt.
 * If query parameters are present, it validates that only sslmode=verify-full
 * and an approved sslrootcert are supplied (rejecting arbitrary, unknown, duplicated or incompatible parameters).
 */
export function normalizeHomologationPoolerUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (err) {
    throw new Error('DATABASE_URL_INVALID');
  }

  const allParams = [...url.searchParams.entries()];

  // If query parameters are completely absent (count === 0), add mandatory secure TLS params
  if (allParams.length === 0) {
    url.searchParams.set('sslmode', 'verify-full');
    url.searchParams.set('sslrootcert', SUPABASE_CA_CERT_PATH);
    return url.toString();
  }

  // If query parameters are present, strictly validate them
  const inspection = inspectHomologationTlsPolicy(url.toString());
  if (!inspection.valid) {
    const err = new Error(`DATABASE_TLS_POLICY_MISMATCH: ${inspection.summary}`);
    err.code = 'DATABASE_TLS_POLICY_MISMATCH';
    err.issues = inspection.issues;
    throw err;
  }

  return url.toString();
}

export function inspectHomologationTlsPolicy(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (err) {
    return {
      valid: false,
      reason: 'URL_PARSE_ERROR',
      message: err.message,
    };
  }

  const issues = [];
  const sslmodeCount = url.searchParams.getAll('sslmode').length;
  const sslrootcertCount = url.searchParams.getAll('sslrootcert').length;
  const sslmode = url.searchParams.get('sslmode');
  const sslrootcert = url.searchParams.get('sslrootcert');
  const allParams = [...url.searchParams.entries()];

  // 1. Validate sslmode
  if (sslmodeCount === 0) {
    issues.push('sslmode parameter is missing (expected "sslmode=verify-full")');
  } else if (sslmodeCount > 1) {
    issues.push(`sslmode parameter is duplicated (${sslmodeCount} occurrences)`);
  } else if (sslmode !== 'verify-full') {
    issues.push('sslmode parameter is incompatible (expected "verify-full")');
  }

  // 2. Validate sslrootcert (accepts verified local cert path or system)
  const isApprovedRootCert = sslrootcert === SUPABASE_CA_CERT_PATH || sslrootcert === 'system' || sslrootcert === './' + SUPABASE_CA_CERT_PATH;
  if (sslrootcertCount === 0) {
    issues.push(`sslrootcert parameter is missing (expected "sslrootcert=${SUPABASE_CA_CERT_PATH}")`);
  } else if (sslrootcertCount > 1) {
    issues.push(`sslrootcert parameter is duplicated (${sslrootcertCount} occurrences)`);
  } else if (!isApprovedRootCert) {
    issues.push(`sslrootcert parameter is incompatible (expected "${SUPABASE_CA_CERT_PATH}" or "system")`);
  }

  // 3. Count additional unauthorized query parameters (WITHOUT revealing any values)
  const additionalParams = allParams.filter(([k]) => k !== 'sslmode' && k !== 'sslrootcert');
  if (additionalParams.length > 0) {
    issues.push(`found ${additionalParams.length} additional unauthorized query parameter(s)`);
  }

  // 4. Check total parameter count
  if (allParams.length !== 2 && additionalParams.length === 0 && !issues.some(i => i.includes('duplicated'))) {
    issues.push(`total query parameter count is ${allParams.length} (expected exactly 2)`);
  }

  return {
    valid: issues.length === 0,
    issues,
    summary: issues.length === 0 ? 'TLS policy compliant' : issues.join('; '),
  };
}

export function parseHomologationPoolerUrl(rawUrl, configuredHost) {
  if (typeof configuredHost !== 'string'
      || configuredHost !== configuredHost.trim()
      || !HOST_FORMAT.test(configuredHost)) {
    throw new Error('POOLER_HOST_CONFIG_INVALID');
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('DATABASE_URL_INVALID');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || url.hostname !== configuredHost
      || url.port !== '5432'
      || decodeURIComponent(url.username) !== `postgres.${HOMOLOGATION_REF}`
      || url.pathname !== '/postgres'
      || !url.password
      || url.hash) {
    throw new Error('DATABASE_TARGET_MISMATCH');
  }

  // Normalize TLS parameters (accepts clean URL without query, appends verify-full & system)
  const normalizedUrl = normalizeHomologationPoolerUrl(rawUrl);

  // Re-verify normalized URL
  const verifiedUrl = new URL(normalizedUrl);
  const inspection = inspectHomologationTlsPolicy(normalizedUrl);
  if (!inspection.valid) {
    const err = new Error(`DATABASE_TLS_POLICY_MISMATCH: ${inspection.summary}`);
    err.code = 'DATABASE_TLS_POLICY_MISMATCH';
    err.issues = inspection.issues;
    throw err;
  }

  return {
    host: verifiedUrl.hostname,
    port: '5432',
    user: decodeURIComponent(verifiedUrl.username),
    password: decodeURIComponent(verifiedUrl.password),
    database: 'postgres',
  };
}
