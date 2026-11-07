import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import {
  ALLOWED_HOMOLOG_PROJECT_REF,
  FORBIDDEN_PRODUCTION_PROJECT_REF,
  validateTargetProject
} from './guard-homolog-env.mjs';

/**
 * scripts/safe-homolog-executor.mjs
 * Executor seguro supervisionado para a aplicacao das 5 migrations M30/M37 na homologacao.
 * Implementa 8 camadas de defesa contra execucoes acidentais ou divergencias de estado.
 */

export const AUTHORIZED_MIGRATIONS = [
  {
    version: '20261105165500',
    file: 'supabase/migrations/20261105165500_m30_harden_industry_active_checkin.sql',
    expectedSha256: '0E99C83168F8D7A9275B8EB37FF380D1E0C8371AE90910B3B24AEB7D768C51B8'
  },
  {
    version: '20261106131614',
    file: 'supabase/migrations/20261106131614_m30_serialize_industry_checkin.sql',
    expectedSha256: '5E6F0253848902E0CBA34F11AC40F981C46BC9DBEFD7FD05CDA86562CE9F6945'
  },
  {
    version: '20261106140000',
    file: 'supabase/migrations/20261106140000_m37_pending_visit_active_route_guard.sql',
    expectedSha256: '927A98CB2B13E2D9A64F5EA20096C4CD65BE8D767ECF74E95F0D4037378485B4'
  },
  {
    version: '20261106150000',
    file: 'supabase/migrations/20261106150000_m37_checkin_route_and_conflict_guard.sql',
    expectedSha256: 'FD6CFE4A5AC54E34CB426E3C1D0F9AA78228729FD0C51015FF169D235698CC80'
  },
  {
    version: '20261107140000',
    file: 'supabase/migrations/20261107140000_m37_reconcile_materialized_pending_recovery.sql',
    expectedSha256: 'DEF790F7B18EF9F7417A97F516D5424E91DC26A29CAC13A770F535E7D65BA46A'
  }
];

export function computeFileSha256(filePath) {
  const buf = readFileSync(filePath);
  return createHash('sha256').update(buf).digest('hex').toUpperCase();
}

export function validateAuthorizedMigrationsIntegrity() {
  const audited = [];
  for (const m of AUTHORIZED_MIGRATIONS) {
    if (!existsSync(m.file)) {
      return { ok: false, error: `CRITICAL: Migration file '${m.file}' does not exist on disk!` };
    }
    const actual = computeFileSha256(m.file);
    if (actual !== m.expectedSha256) {
      return {
        ok: false,
        error: `SECURITY HASH MISMATCH on ${m.file}! Expected ${m.expectedSha256}, got ${actual}`
      };
    }
    audited.push({ file: m.file, version: m.version, sha256: actual });
  }
  return { ok: true, count: audited.length, migrations: audited };
}

export function validateRemoteLedgerPreconditions(ledgerMigrationList) {
  if (!Array.isArray(ledgerMigrationList)) {
    return { ok: false, error: 'Ledger list must be an array of migration records.' };
  }
  const remoteVersions = ledgerMigrationList
    .map(m => m.remote)
    .filter(v => v && v.trim() !== '');

  // O ledger da homologacao deve ter exatamente as 47 versoes historicas
  if (remoteVersions.length !== 47) {
    return {
      ok: false,
      error: `Preflight failed: Remote ledger must contain exactly 47 historical migrations. Found ${remoteVersions.length}.`
    };
  }

  // Nenhuma das 5 novas migrations pode constar no ledger
  for (const m of AUTHORIZED_MIGRATIONS) {
    if (remoteVersions.includes(m.version)) {
      return {
        ok: false,
        error: `Preflight failed: Target migration ${m.version} is already present in remote ledger!`
      };
    }
  }

  return { ok: true, historicalCount: remoteVersions.length };
}

export function evaluateSafeExecutionPlan(opts = {}) {
  const {
    targetProject,
    linkedProject,
    isTempWorkdir = false,
    confirmedExplicitly = false,
    ledgerList = []
  } = opts;

  // 1. Validar projeto alvo
  const projRes = validateTargetProject(targetProject);
  if (!projRes.ok) {
    return { ok: false, step: 'VALIDATE_PROJECT', error: projRes.error };
  }

  // 2. Bloquear fallback de producao
  if (linkedProject === FORBIDDEN_PRODUCTION_PROJECT_REF && !isTempWorkdir) {
    return {
      ok: false,
      step: 'ISOLATION_CHECK',
      error: 'CRITICAL: Repository is linked to production and isTempWorkdir is false! Isolated workspace is mandatory.'
    };
  }

  // 3. Validar integridade dos arquivos autorizados
  const hashRes = validateAuthorizedMigrationsIntegrity();
  if (!hashRes.ok) {
    return { ok: false, step: 'HASH_INTEGRITY', error: hashRes.error };
  }

  // 4. Validar ledger remoto
  const ledgerRes = validateRemoteLedgerPreconditions(ledgerList);
  if (!ledgerRes.ok) {
    return { ok: false, step: 'LEDGER_PRECONDITIONS', error: ledgerRes.error };
  }

  // 5. Exigir confirmacao explicita para gravacao remota
  if (!confirmedExplicitly) {
    return {
      ok: false,
      step: 'EXPLICIT_CONFIRMATION',
      error: 'SIMULATION MODE ONLY: Execution requires explicit authorization confirmation (confirmedExplicitly: true). No write operation permitted.'
    };
  }

  return {
    ok: true,
    targetProject: projRes.projectRef,
    migrationsToApply: hashRes.migrations,
    historicalBaselineCount: ledgerRes.historicalCount,
    readyForExecution: true
  };
}
