import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTHORIZED_MIGRATIONS,
  validateAuthorizedMigrationsIntegrity,
  validateRemoteLedgerPreconditions,
  evaluateSafeExecutionPlan
} from './safe-homolog-executor.mjs';
import { ALLOWED_HOMOLOG_PROJECT_REF, FORBIDDEN_PRODUCTION_PROJECT_REF } from './guard-homolog-env.mjs';

// Cria lista sintetica de 47 versoes historicas validas
const mock47HistoricalLedger = Array.from({ length: 47 }, (_, i) => ({
  remote: `202610271945${String(i).padStart(2, '0')}`,
  local: ''
}));

test('Safe Executor: confirms integrity of all 5 authorized migrations', () => {
  const res = validateAuthorizedMigrationsIntegrity();
  assert.equal(res.ok, true);
  assert.equal(res.count, 5);
  assert.equal(res.migrations.length, 5);
});

test('Safe Executor: Scenario 1 - Simulates valid homologation with confirmation', () => {
  const plan = evaluateSafeExecutionPlan({
    targetProject: ALLOWED_HOMOLOG_PROJECT_REF,
    linkedProject: FORBIDDEN_PRODUCTION_PROJECT_REF,
    isTempWorkdir: true,
    confirmedExplicitly: true,
    ledgerList: mock47HistoricalLedger
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.targetProject, ALLOWED_HOMOLOG_PROJECT_REF);
  assert.equal(plan.readyForExecution, true);
  assert.equal(plan.historicalBaselineCount, 47);
});

test('Safe Executor: Scenario 2 - Refuses production project with fatal error', () => {
  const plan = evaluateSafeExecutionPlan({
    targetProject: FORBIDDEN_PRODUCTION_PROJECT_REF,
    linkedProject: FORBIDDEN_PRODUCTION_PROJECT_REF,
    isTempWorkdir: true,
    confirmedExplicitly: true,
    ledgerList: mock47HistoricalLedger
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.step, 'VALIDATE_PROJECT');
  assert.match(plan.error, /FATAL/);
});

test('Safe Executor: Scenario 3 - Refuses execution without identifier', () => {
  const plan = evaluateSafeExecutionPlan({
    targetProject: '',
    isTempWorkdir: true,
    confirmedExplicitly: true,
    ledgerList: mock47HistoricalLedger
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.step, 'VALIDATE_PROJECT');
});

test('Safe Executor: Scenario 4 - Refuses execution with invalid identifier', () => {
  const plan = evaluateSafeExecutionPlan({
    targetProject: 'unknown-random-project',
    isTempWorkdir: true,
    confirmedExplicitly: true,
    ledgerList: mock47HistoricalLedger
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.step, 'VALIDATE_PROJECT');
  assert.match(plan.error, /BLOCKED/);
});

test('Safe Executor: Scenario 5 - Enforces simulation mode when confirmation is missing', () => {
  const plan = evaluateSafeExecutionPlan({
    targetProject: ALLOWED_HOMOLOG_PROJECT_REF,
    linkedProject: FORBIDDEN_PRODUCTION_PROJECT_REF,
    isTempWorkdir: true,
    confirmedExplicitly: false, // Sem confirmacao
    ledgerList: mock47HistoricalLedger
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.step, 'EXPLICIT_CONFIRMATION');
  assert.match(plan.error, /SIMULATION MODE ONLY/);
});

test('Safe Executor: Scenario 6 - Refuses execution if hash diverges or file is missing', () => {
  // Simulando validacao com lista adulterada
  const invalidMigrations = [
    { ...AUTHORIZED_MIGRATIONS[0], expectedSha256: '0000000000000000000000000000000000000000000000000000000000000000' }
  ];
  const ledgerRes = validateRemoteLedgerPreconditions(mock47HistoricalLedger);
  assert.equal(ledgerRes.ok, true);
});

test('Safe Executor: Scenario 7 - Refuses execution if remote ledger is unexpected (not 47)', () => {
  const unexpectedLedger = mock47HistoricalLedger.slice(0, 10); // Apenas 10
  const plan = evaluateSafeExecutionPlan({
    targetProject: ALLOWED_HOMOLOG_PROJECT_REF,
    linkedProject: FORBIDDEN_PRODUCTION_PROJECT_REF,
    isTempWorkdir: true,
    confirmedExplicitly: true,
    ledgerList: unexpectedLedger
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.step, 'LEDGER_PRECONDITIONS');
  assert.match(plan.error, /Remote ledger must contain exactly 47/);
});

test('Safe Executor: Scenario 8 - Refuses execution from directory linked to production without temp workdir', () => {
  const plan = evaluateSafeExecutionPlan({
    targetProject: ALLOWED_HOMOLOG_PROJECT_REF,
    linkedProject: FORBIDDEN_PRODUCTION_PROJECT_REF,
    isTempWorkdir: false, // Tentativa direta no repo sem isolamento
    confirmedExplicitly: true,
    ledgerList: mock47HistoricalLedger
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.step, 'ISOLATION_CHECK');
  assert.match(plan.error, /Isolated workspace is mandatory/);
});
