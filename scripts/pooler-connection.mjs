export const HOMOLOGATION_REF = 'tafjceemuetqjyngresg';
export const ALLOWED_BACKUP_BRANCH = 'codex/m42.2-m39-session-pooler';

const HOST_FORMAT = /^[a-z0-9]+(?:-[a-z0-9]+)*\.pooler\.supabase\.com$/;

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

  const params = [...url.searchParams.entries()];
  if (params.length !== 2
      || url.searchParams.getAll('sslmode').length !== 1
      || url.searchParams.get('sslmode') !== 'verify-full'
      || url.searchParams.getAll('sslrootcert').length !== 1
      || url.searchParams.get('sslrootcert') !== 'system') {
    throw new Error('DATABASE_TLS_POLICY_MISMATCH');
  }

  return {
    host: url.hostname,
    port: '5432',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: 'postgres',
  };
}
