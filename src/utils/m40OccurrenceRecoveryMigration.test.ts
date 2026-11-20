import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const migrationPath = new URL('../../supabase/migrations/20261120190000_m40_distinct_scheduled_occurrence_recovery.sql', import.meta.url);
const rollbackPath = new URL('../../docs/releases/RC1.25.64_M40_rollback.sql', import.meta.url);

test('M40 limita o conflito diário à mesma ocorrência e traduz a mensagem', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /coalesce\(v\.scheduled_date, v\.data_visita\)\s*=\s*coalesce\(v_latest\.scheduled_date, v_latest\.data_visita\)/);
  assert.match(sql, /v\.data_visita = v_effective_date/);
  assert.match(sql, /Já existe um atendimento para esta loja e indústria na data operacional atual\./);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(v_matricula, 1\)\)/);
  assert.match(sql, /v\.status = 'em_andamento'/);
  assert.match(sql, /REVOKE ALL ON FUNCTION attendance_private\.attendance_retry_closed_scheduled_occurrence/);
  assert.doesNotMatch(sql, /UPDATE\s+public\.visits/i);
});

test('rollback M40 restaura o bloqueio diário da M39 sem alterar outras funções', async () => {
  const [migration, rollback] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(rollbackPath, 'utf8'),
  ]);
  assert.match(migration, /attendance_private\.attendance_retry_closed_scheduled_occurrence/);
  assert.match(rollback, /A visit for this store and industry already exists today/);
  assert.doesNotMatch(rollback, /Já existe um atendimento para esta loja e indústria na data operacional atual\./);
  assert.doesNotMatch(rollback, /UPDATE\s+public\.visits/i);
});
