import dns from 'node:dns/promises';
import { HOMOLOGATION_REF, parseHomologationPoolerUrl } from './pooler-connection.mjs';

export const ALLOWED_CONNECTION_TEST_BRANCH = 'codex/m42.5-homologation-connection-test';

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
  // and strict TLS parameters sslmode=verify-full&sslrootcert=system
  const parsed = parseHomologationPoolerUrl(env.SUPABASE_DB_URL, env.SUPABASE_POOLER_HOST);

  return {
    parsed,
    projectRef: HOMOLOGATION_REF,
    poolerHost: env.SUPABASE_POOLER_HOST,
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
