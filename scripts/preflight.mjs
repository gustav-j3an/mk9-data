import { HOMOLOGATION_REF } from './storage-backup.mjs';

function validServiceRoleKey(value) {
  const parts = String(value ?? '').split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload.role === 'service_role' && payload.ref === HOMOLOGATION_REF;
  } catch {
    return false;
  }
}

export function validateBackupConfig(env) {
  if (env.GITHUB_REF !== 'refs/heads/codex/m38-backup-actions') throw new Error('BRANCH_NOT_ALLOWED');
  if (env.INPUT_PROJECT_REF !== HOMOLOGATION_REF || env.SUPABASE_PROJECT_REF !== HOMOLOGATION_REF) throw new Error('PROJECT_REF_MISMATCH');
  const api = new URL(env.SUPABASE_PROJECT_URL ?? '');
  if (api.protocol !== 'https:' || api.hostname !== `${HOMOLOGATION_REF}.supabase.co`) throw new Error('PROJECT_URL_MISMATCH');
  if (!env.SUPABASE_DB_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.BACKUP_GPG_PASSPHRASE
      || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) throw new Error('REQUIRED_SECRET_MISSING');
  if (!validServiceRoleKey(env.SUPABASE_SERVICE_ROLE_KEY)) throw new Error('SERVICE_ROLE_KEY_PROJECT_MISMATCH');
  if (env.BACKUP_GPG_PASSPHRASE.length < 32) throw new Error('PASSPHRASE_TOO_SHORT');
  if (env.INPUT_CONFIRM_PRIVATE_DESTINATION !== 'true') throw new Error('DESTINATION_CONFIRMATION_REQUIRED');
  const endpoint = new URL(env.BACKUP_S3_ENDPOINT_URL ?? '');
  if (endpoint.protocol !== 'https:' || !endpoint.hostname || endpoint.username || endpoint.password
      || endpoint.search || endpoint.hash || endpoint.pathname !== '/'
      || endpoint.hostname === 'supabase.co' || endpoint.hostname.endsWith('.supabase.co')) throw new Error('DESTINATION_ENDPOINT_INVALID');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.BACKUP_S3_BUCKET ?? '')) throw new Error('DESTINATION_BUCKET_INVALID');
  if (!/^[a-z0-9-]{3,63}$/.test(env.BACKUP_S3_REGION ?? '')) throw new Error('DESTINATION_REGION_INVALID');
  if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(env.BACKUP_S3_PREFIX ?? '') || env.BACKUP_S3_PREFIX.length > 180) throw new Error('DESTINATION_PREFIX_INVALID');
  const parsedDb = new URL(env.SUPABASE_DB_URL);
  if (!['postgres:', 'postgresql:'].includes(parsedDb.protocol)
      || parsedDb.hostname !== `db.${HOMOLOGATION_REF}.supabase.co`
      || decodeURIComponent(parsedDb.username) !== 'postgres'
      || !parsedDb.password
      || parsedDb.pathname !== '/postgres'
      || !['require', 'verify-ca', 'verify-full'].includes((parsedDb.searchParams.get('sslmode') ?? '').toLowerCase())) {
    throw new Error('DATABASE_TARGET_MISMATCH');
  }
  return true;
}

if (process.argv[1]?.endsWith('/preflight.mjs')) {
  try {
    validateBackupConfig(process.env);
    console.log('Backup configuration accepted. No connection was made.');
  } catch (error) {
    console.error(`Backup preflight blocked (${String(error.message).replace(/[^A-Z0-9_:-]/gi, '')}).`);
    process.exitCode = 1;
  }
}
