import { ALLOWED_BACKUP_BRANCH, HOMOLOGATION_REF, parseHomologationPoolerUrl } from './pooler-connection.mjs';

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
  if (env.GITHUB_REF !== `refs/heads/${ALLOWED_BACKUP_BRANCH}`) throw new Error('BRANCH_NOT_ALLOWED');
  if (env.INPUT_PROJECT_REF !== HOMOLOGATION_REF || env.SUPABASE_PROJECT_REF !== HOMOLOGATION_REF) throw new Error('PROJECT_REF_MISMATCH');
  const api = new URL(env.SUPABASE_PROJECT_URL ?? '');
  if (api.protocol !== 'https:' || api.hostname !== `${HOMOLOGATION_REF}.supabase.co`
      || api.username || api.password || api.port || api.pathname !== '/' || api.search || api.hash) throw new Error('PROJECT_URL_MISMATCH');
  if (!env.SUPABASE_DB_URL || !env.SUPABASE_POOLER_HOST || !env.SUPABASE_SERVICE_ROLE_KEY || !env.BACKUP_GPG_PASSPHRASE) {
    throw new Error('REQUIRED_SECRET_MISSING');
  }
  if (!validServiceRoleKey(env.SUPABASE_SERVICE_ROLE_KEY)) throw new Error('SERVICE_ROLE_KEY_PROJECT_MISMATCH');
  if (Buffer.byteLength(env.BACKUP_GPG_PASSPHRASE, 'utf8') < 32 || /[\r\n]/.test(env.BACKUP_GPG_PASSPHRASE)) {
    throw new Error('PASSPHRASE_INVALID');
  }
  if (env.INPUT_CONFIRM_ARTIFACT_ACCESS !== 'true') throw new Error('ARTIFACT_ACCESS_CONFIRMATION_REQUIRED');
  parseHomologationPoolerUrl(env.SUPABASE_DB_URL, env.SUPABASE_POOLER_HOST);
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
