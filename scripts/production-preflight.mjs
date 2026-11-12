import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  ALLOWED_BACKUP_BRANCH,
  PRODUCTION_REF,
  parseProductionPoolerUrl,
  SUPABASE_CA_CERT_PATH,
  SUPABASE_CA_SHA256,
} from './production-pooler-connection.mjs';

/**
 * Validates the currently checked-out Git commit against the approved commit SHA.
 * Rejects missing, empty, abbreviated SHAs, branch names, tags, or unapproved commit SHAs.
 */
export function verifyCheckedOutCommit(approvedSha, targetDir = process.cwd()) {
  const fullShaRegex = /^[0-9a-f]{40}$/i;
  if (!approvedSha || typeof approvedSha !== 'string' || !fullShaRegex.test(approvedSha.trim())) {
    throw new Error('APPROVED_COMMIT_SHA_FORMAT_INVALID: Approved commit must be a full 40-character hex SHA');
  }

  let actualSha;
  try {
    actualSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: targetDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    throw new Error(`EXECUTION_COMMIT_DETECTION_FAILED: ${err.message}`);
  }

  if (!fullShaRegex.test(actualSha)) {
    throw new Error(`EXECUTION_COMMIT_SHA_MALFORMED: "${actualSha}" is not a valid 40-character hex SHA`);
  }

  if (actualSha.toLowerCase() !== approvedSha.trim().toLowerCase()) {
    throw new Error(`COMMIT_SHA_MISMATCH: checked out commit "${actualSha}" does not match approved commit "${approvedSha}"`);
  }

  return {
    verified: true,
    commitSha: actualSha.toLowerCase(),
  };
}

export function verifySupabaseCaCertificate(certRelativePath = SUPABASE_CA_CERT_PATH) {
  const resolved = path.resolve(certRelativePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`CA_CERT_FILE_NOT_FOUND: ${certRelativePath}`);
  }
  const pem = fs.readFileSync(resolved, 'utf8');
  const cert = new crypto.X509Certificate(pem);
  if (cert.fingerprint256 !== SUPABASE_CA_SHA256) {
    throw new Error(`CA_CERT_FINGERPRINT_MISMATCH: expected ${SUPABASE_CA_SHA256}, got ${cert.fingerprint256}`);
  }
  const now = new Date();
  const validFrom = new Date(cert.validFrom);
  const validTo = new Date(cert.validTo);
  if (now < validFrom || now > validTo) {
    throw new Error(`CA_CERT_EXPIRED_OR_NOT_YET_VALID: valid between ${cert.validFrom} and ${cert.validTo}`);
  }
  return {
    verified: true,
    subject: cert.subject,
    fingerprint256: cert.fingerprint256,
    path: resolved,
  };
}

function validServiceRoleKey(value) {
  const parts = String(value ?? '').split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload.role === 'service_role' && payload.ref === PRODUCTION_REF;
  } catch {
    return false;
  }
}

export function validateProductionBackupConfig(env) {
  if (env.GITHUB_REF !== `refs/heads/${ALLOWED_BACKUP_BRANCH}`) throw new Error('BRANCH_NOT_ALLOWED');
  if (env.INPUT_PROJECT_REF !== PRODUCTION_REF || env.SUPABASE_PROJECT_REF !== PRODUCTION_REF) throw new Error('PROJECT_REF_MISMATCH');
  const api = new URL(env.SUPABASE_PROJECT_URL ?? '');
  if (api.protocol !== 'https:' || api.hostname !== `${PRODUCTION_REF}.supabase.co`
      || api.username || api.password || api.port || api.pathname !== '/' || api.search || api.hash) throw new Error('PROJECT_URL_MISMATCH');
  if (!env.SUPABASE_DB_URL || !env.SUPABASE_POOLER_HOST || !env.SUPABASE_SERVICE_ROLE_KEY || !env.BACKUP_GPG_PASSPHRASE) {
    throw new Error('REQUIRED_SECRET_MISSING');
  }
  if (!validServiceRoleKey(env.SUPABASE_SERVICE_ROLE_KEY)) throw new Error('SERVICE_ROLE_KEY_PROJECT_MISMATCH');
  if (Buffer.byteLength(env.BACKUP_GPG_PASSPHRASE, 'utf8') < 32 || /[\r\n]/.test(env.BACKUP_GPG_PASSPHRASE)) {
    throw new Error('PASSPHRASE_INVALID');
  }
  if (env.INPUT_CONFIRM_ARTIFACT_ACCESS !== 'true') throw new Error('ARTIFACT_ACCESS_CONFIRMATION_REQUIRED');
  if (!env.APPROVED_COMMIT_SHA) {
    throw new Error('APPROVED_COMMIT_SHA_MISSING: Environment variable APPROVED_COMMIT_SHA is required');
  }
  verifyCheckedOutCommit(env.APPROVED_COMMIT_SHA);
  verifySupabaseCaCertificate();
  parseProductionPoolerUrl(env.SUPABASE_DB_URL, env.SUPABASE_POOLER_HOST);
  return true;
}

if (process.argv[1]?.endsWith('/production-preflight.mjs')) {
  try {
    validateProductionBackupConfig(process.env);
    console.log('Production backup configuration accepted. No connection was made.');
  } catch (error) {
    console.error(`Production backup preflight blocked (${String(error.message).replace(/[^A-Z0-9_:-]/gi, '')}).`);
    process.exitCode = 1;
  }
}
