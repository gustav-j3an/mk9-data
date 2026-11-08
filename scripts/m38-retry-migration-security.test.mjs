import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const retryMigration = await readFile(new URL('../supabase/migrations/20261108170619_m38_retry_attempt_history.sql', import.meta.url), 'utf8');
const closeMigration = await readFile(new URL('../supabase/migrations/20261108130000_m38_visit_cancellation_and_day_end_close.sql', import.meta.url), 'utf8');

test('recovery attempts keep the scheduled occurrence and create an immutable linked visit row', () => {
  assert.match(retryMigration, /ADD COLUMN attempt_number smallint NOT NULL DEFAULT 1/);
  assert.match(retryMigration, /occurrence_root_visit_id uuid[\s\S]*REFERENCES public\.visits\(id\) ON DELETE RESTRICT/);
  assert.match(retryMigration, /CREATE UNIQUE INDEX visits_promoter_route_scheduled_attempt_unique/);
  assert.match(retryMigration, /guard_scheduled_visit_attempt_insert/);
  assert.match(retryMigration, /scheduled_attempt_authorizations/);
  assert.match(retryMigration, /Scheduled visit attempt identity is immutable/);
  assert.match(retryMigration, /INSERT INTO public\.visits \([\s\S]*occurrence_root_visit_id, attempt_number/);
});

test('recovery only accepts audited cancellations or day-end closures and preserves single-active-visit serialization', () => {
  assert.match(retryMigration, /attendance_retry_closed_scheduled_occurrence/);
  assert.match(retryMigration, /a\.action IN \('promoter_cancelled','auto_closed_at_day_end'\)/);
  assert.match(retryMigration, /pg_advisory_xact_lock\(hashtextextended\(v_matricula, 1\)\)/);
  assert.match(retryMigration, /Another visit is in progress/);
  assert.match(retryMigration, /A completed occurrence cannot be recovered again/);
  assert.match(retryMigration, /visit_schedule_actions_visit_id_key UNIQUE \(visit_id\)/);
});

test('retry retains weekly, GPS, active-industry, route-lock and original schedule checks', () => {
  assert.match(retryMigration, /p_scheduled_date < v_week_start OR p_scheduled_date >= v_today/);
  assert.match(retryMigration, /Invalid GPS/);
  assert.match(retryMigration, /FROM public\.industrias i WHERE i\.codigo = v_industry_code FOR SHARE/);
  assert.match(retryMigration, /AND r\.encerrada_em IS NULL\s+FOR UPDATE/);
  assert.match(retryMigration, /v\.scheduled_date = p_scheduled_date/);
  assert.match(closeMigration, /LANGUAGE sql SECURITY INVOKER SET search_path = ''/);
});
