import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import {
  HOMOLOGATION_REF,
  normalizeHomologationPoolerUrl,
  parseHomologationPoolerUrl,
  SUPABASE_CA_CERT_PATH,
  SUPABASE_CA_SHA256,
} from './pooler-connection.mjs';

export const ALLOWED_CONNECTION_TEST_BRANCH = 'codex/m42.5-homologation-connection-test';

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

export function validateConnectionTestConfig(env) {
  if (env.GITHUB_REF !== `refs/heads/${ALLOWED_CONNECTION_TEST_BRANCH}`) {
    throw new Error('BRANCH_NOT_ALLOWED');
  }

  if (env.INPUT_PROJECT_REF !== HOMOLOGATION_REF || env.SUPABASE_PROJECT_REF !== HOMOLOGATION_REF) {
    throw new Error('PROJECT_REF_MISMATCH');
  }

  if (!env.SUPABASE_DB_URL || !env.SUPABASE_POOLER_HOST) {
    throw new Error('REQUIRED_CONFIG_MISSING');
  }

  // Preflight URL check: validates protocol, host === configuredHost, port === 5432,
  // username === postgres.tafjceemuetqjyngresg, pathname === /postgres,
  // normalizes TLS if absent and enforces strict TLS parameters sslmode=verify-full&sslrootcert=system
  const parsed = parseHomologationPoolerUrl(env.SUPABASE_DB_URL, env.SUPABASE_POOLER_HOST);
  const normalizedUrl = normalizeHomologationPoolerUrl(env.SUPABASE_DB_URL);

  return {
    parsed,
    projectRef: HOMOLOGATION_REF,
    poolerHost: env.SUPABASE_POOLER_HOST,
    normalizedUrl,
  };
}

export async function verifyPoolerDnsResolution(host) {
  if (!host || typeof host !== 'string') {
    throw new Error('INVALID_HOST');
  }
  // Lookup IPv4 address strictly to confirm DNS resolution
  const res = await dns.lookup(host, { family: 4 });
  if (!res || !res.address) {
    throw new Error('DNS_LOOKUP_FAILED');
  }
  return res.address;
}

export function parseSessionInspectionResult(rawStdout) {
  const line = String(rawStdout ?? '').trim();
  if (!line) {
    throw new Error('EMPTY_DATABASE_RESPONSE');
  }

  // Expected format: <current_database>|<current_user>|<server_version_num>
  const parts = line.split('|').map(s => s.trim());
  if (parts.length !== 3) {
    throw new Error('UNEXPECTED_DATABASE_RESPONSE_FORMAT');
  }

  const [db, user, versionNumStr] = parts;

  if (db !== 'postgres') {
    throw new Error('DATABASE_MISMATCH');
  }

  // Under Supavisor session pooler, the effective current_user may be 'postgres'
  // or 'postgres.<ref>'. It MUST NOT match production or empty.
  if (user !== 'postgres' && user !== `postgres.${HOMOLOGATION_REF}`) {
    throw new Error('USER_MISMATCH');
  }

  const versionNum = parseInt(versionNumStr, 10);
  if (!Number.isInteger(versionNum) || versionNum < 170000 || versionNum >= 180000) {
    throw new Error('POSTGRESQL_VERSION_MISMATCH');
  }

  return {
    currentDatabase: db,
    currentUser: user,
    serverVersionNum: versionNum,
    isPostgres17: true,
  };
}
