import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTHORIZED_MIGRATIONS,
  EXPECTED_HOMOLOGATION_LEDGER,
  EXPECTED_PRE_M38_SCHEMA,
  REQUIRED_CONFIRMATION,
  validateAuthorizedMigrationsIntegrity,
  validateRemoteLedgerPreconditions,
  validateSchemaPreconditions,
  evaluateSafeExecutionPlan
} from './safe-homolog-executor.mjs';
import { ALLOWED_HOMOLOG_PROJECT_REF, FORBIDDEN_PRODUCTION_PROJECT_REF } from './guard-homolog-env.mjs';

const currentLedger = () => EXPECTED_HOMOLOGATION_LEDGER.map(row => ({ ...row }));
const matchingSchema = () => ({
  postgresMajorVersion: EXPECTED_PRE_M38_SCHEMA.postgresMajorVersion,
  catalogFactCount: EXPECTED_PRE_M38_SCHEMA.catalogFactCount,
  catalogFingerprint: EXPECTED_PRE_M38_SCHEMA.catalogFingerprint,
  pgCronInstalled: true
});

test('integrity pins the six applied dependencies and only three pending M38 files', () => {
  const result = validateAuthorizedMigrationsIntegrity();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.count, 3);
  assert.equal(result.migrations.length, 3);
  assert.equal(result.verifiedPrerequisites.length, 6);
  assert.deepEqual(result.migrations.map(item => item.version), [
    '20261110150000', '20261110160000', '20261110170000'
  ]);
});

test('the approved IDs are monotonic after the live 53-version ledger', () => {
  const latestApplied = EXPECTED_HOMOLOGATION_LEDGER.at(-1).version;
  const versions = AUTHORIZED_MIGRATIONS.map(migration => migration.version);
  assert.ok(versions.every(version => version > latestApplied));
  assert.deepEqual([...versions].sort(), versions);
});

test('accepts the exact 53-row remote ledger including the applied weekly M37 version', () => {
  const result = validateRemoteLedgerPreconditions(currentLedger());
  assert.equal(result.ok, true, result.error);
  assert.equal(result.ledgerCount, 53);
  assert.equal(result.appliedM37WeeklyVersion, '20261108160835');
  assert.deepEqual(result.pendingM38Versions, AUTHORIZED_MIGRATIONS.map(m => m.version));
});

test('ledger matching is order-independent but requires exact version/name pairs', () => {
  const shuffled = currentLedger().reverse();
  assert.equal(validateRemoteLedgerPreconditions(shuffled).ok, true);
  const wrongName = currentLedger();
  wrongName[52].name = 'm37_wrong_name';
  assert.match(validateRemoteLedgerPreconditions(wrongName).error, /name mismatch/);
});

test('refuses missing, extra, duplicate, nameless, and old-ID ledger states', () => {
  assert.match(validateRemoteLedgerPreconditions(currentLedger().slice(0, 52)).error, /53-version/);
  const extra = currentLedger();
  extra.push({ version: '20261108100000', name: 'm37_integral_weekly_recovery' });
  assert.match(validateRemoteLedgerPreconditions(extra).error, /53-version/);
  const duplicate = currentLedger();
  duplicate.push({ ...duplicate[0] });
  assert.match(validateRemoteLedgerPreconditions(duplicate).error, /duplicate/);
  const nameless = currentLedger();
  delete nameless[0].name;
  assert.match(validateRemoteLedgerPreconditions(nameless).error, /exact version and name/);
});

test('M38 schema preflight requires the audited catalog and pg_cron', () => {
  assert.equal(validateSchemaPreconditions(matchingSchema()).ok, true);
  assert.match(validateSchemaPreconditions({ ...matchingSchema(), pgCronInstalled: false }).error, /pg_cron/);
  assert.match(validateSchemaPreconditions({ ...matchingSchema(), postgresMajorVersion: 16 }).error, /PostgreSQL 17/);
  assert.match(validateSchemaPreconditions({ ...matchingSchema(), catalogFingerprint: 'different' }).error, /fingerprint/);
});

test('preflight returns a plan for exactly M38 only after project, ledger, schema, and typed confirmation', () => {
  const plan = evaluateSafeExecutionPlan({
    targetProject: ALLOWED_HOMOLOG_PROJECT_REF,
    linkedProject: FORBIDDEN_PRODUCTION_PROJECT_REF,
    isTempWorkdir: true,
    confirmationText: REQUIRED_CONFIRMATION,
    ledgerList: currentLedger(),
    schemaFacts: matchingSchema()
  });
  assert.equal(plan.ok, true, plan.error);
  assert.equal(plan.targetProject, ALLOWED_HOMOLOG_PROJECT_REF);
  assert.equal(plan.ledgerCount, 53);
  assert.equal(plan.alreadyAppliedM37WeeklyVersion, '20261108160835');
  assert.deepEqual(plan.migrationsToApply.map(m => m.version), AUTHORIZED_MIGRATIONS.map(m => m.version));
  assert.equal(plan.readyForAuthorizedOperator, true);
});

test('preflight blocks until explicit confirmation names the project and all migration IDs', () => {
  const base = {
    targetProject: ALLOWED_HOMOLOG_PROJECT_REF,
    isTempWorkdir: true,
    ledgerList: currentLedger(),
    schemaFacts: matchingSchema()
  };
  assert.equal(evaluateSafeExecutionPlan(base).step, 'EXPLICIT_CONFIRMATION');
  assert.equal(evaluateSafeExecutionPlan({ ...base, confirmationText: REQUIRED_CONFIRMATION.replace('20261110170000', 'wrong') }).ok, false);
});

test('preflight blocks the live homologation state until pg_cron is enabled there', () => {
  const plan = evaluateSafeExecutionPlan({
    targetProject: ALLOWED_HOMOLOG_PROJECT_REF,
    isTempWorkdir: true,
    confirmationText: REQUIRED_CONFIRMATION,
    ledgerList: currentLedger(),
    schemaFacts: { ...matchingSchema(), pgCronInstalled: false }
  });
  assert.equal(plan.step, 'SCHEMA_PRECONDITIONS');
  assert.match(plan.error, /pg_cron/);
});

test('preflight never plans production or an unisolated workspace linked to production', () => {
  const options = { isTempWorkdir: true, ledgerList: currentLedger(), schemaFacts: matchingSchema(), confirmationText: REQUIRED_CONFIRMATION };
  assert.equal(evaluateSafeExecutionPlan({ ...options, targetProject: FORBIDDEN_PRODUCTION_PROJECT_REF }).step, 'VALIDATE_PROJECT');
  assert.equal(evaluateSafeExecutionPlan({ ...options, targetProject: ALLOWED_HOMOLOG_PROJECT_REF, linkedProject: FORBIDDEN_PRODUCTION_PROJECT_REF, isTempWorkdir: false }).step, 'ISOLATION_CHECK');
});
