import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const migrationPath = new URL('../../supabase/migrations/20261120152233_m39_retry_legacy_scheduled_visits.sql', import.meta.url);

test('migration usa data_visita somente como fallback de scheduled_date nulo nas três proteções', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  const fallback = /v\.scheduled_date = (p_scheduled_date|v_scheduled_date) OR \(v\.scheduled_date IS NULL AND v\.data_visita = \1\)/g;
  const matches = [...sql.matchAll(fallback)];
  assert.equal(matches.length, 6, 'wrapper, retry e trigger cobrem as seleções e validações dependentes da ocorrência');
  assert.match(sql, /attendance_private\.attendance_start_scheduled_occurrence\([\s\S]*?attendance_retry_closed_scheduled_occurrence\(/);
  assert.match(sql, /v\.status = 'nao_realizada' AND v\.started_at IS NOT NULL/);
  assert.match(sql, /a\.action IN \('promoter_cancelled','auto_closed_at_day_end'\)/);
});

test('migration mantém tentativas protegidas e não reabre nem atualiza a visita anterior', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(v_matricula, 1\)\)/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /scheduled_attempt_authorizations/);
  assert.match(sql, /occurrence_root_visit_id/);
  assert.doesNotMatch(sql, /UPDATE\s+public\.visits/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION attendance_private\.attendance_retry_closed_scheduled_occurrence/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION attendance_private\.attendance_start_scheduled_occurrence[\s\S]*?TO authenticated/);
});
