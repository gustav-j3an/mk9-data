export const HOMOLOGATION_REF = 'tafjceemuetqjyngresg';
export const ALLOWED_BACKUP_BRANCH = 'codex/m42.2-m39-session-pooler';

const HOST_FORMAT = /^[a-z0-9]+(?:-[a-z0-9]+)*\.pooler\.supabase\.com$/;

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

  // 2. Validate sslrootcert
  if (sslrootcertCount === 0) {
    issues.push('sslrootcert parameter is missing (expected "sslrootcert=system")');
  } else if (sslrootcertCount > 1) {
    issues.push(`sslrootcert parameter is duplicated (${sslrootcertCount} occurrences)`);
  } else if (sslrootcert !== 'system') {
    issues.push('sslrootcert parameter is incompatible (expected "system")');
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

  const inspection = inspectHomologationTlsPolicy(rawUrl);
  if (!inspection.valid) {
    // Provide safe, non-sensitive categories of what failed
    const err = new Error(`DATABASE_TLS_POLICY_MISMATCH: ${inspection.summary}`);
    err.code = 'DATABASE_TLS_POLICY_MISMATCH';
    err.issues = inspection.issues;
    throw err;
  }

  return {
    host: url.hostname,
    port: '5432',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: 'postgres',
  };
}
