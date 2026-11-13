import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const retryMigration = await readFile(new URL('../supabase/migrations/20261108170619_m38_retry_attempt_history.sql', import.meta.url), 'utf8');
const closeMigration = await readFile(new URL('../supabase/migrations/20261108130000_m38_visit_cancellation_and_day_end_close.sql', import.meta.url), 'utf8');
const checkinMigration = await readFile(new URL('../supabase/migrations/20261108174150_m38_checkin_reuses_active_scheduled_attempt.sql', import.meta.url), 'utf8');

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

test('legacy check-in reuses only an active scheduled retry on the same effective date and route', () => {
  assert.match(checkinMigration, /scheduled_date IS NOT NULL[\s\S]*status = 'em_andamento'[\s\S]*started_at IS NOT NULL[\s\S]*completed_at IS NULL/);
  assert.match(checkinMigration, /regularization_status IS NULL/);
  assert.match(checkinMigration, /p_route IS NULL OR rota_id = p_route/);
  assert.match(checkinMigration, /IF FOUND THEN\s+RETURN result/);
  assert.match(checkinMigration, /pg_get_functiondef\([\s\S]*public\.attendance_check_in/);
  assert.match(checkinMigration, /Could not locate the M37 legacy visit lookup/);
  assert.match(checkinMigration, /expire_old_open_visits_for_promoter\(matricula\)/);
  assert.match(checkinMigration, /M38: reuse is safe only if the promoter has no other open visit/);
  assert.match(checkinMigration, /M38: enforce one active visit across effective dates/);
});

test('day-end cron migration replaces the named job before scheduling a single entry', () => {
  assert.match(closeMigration, /FOR v_job_id IN SELECT jobid FROM cron\.job WHERE jobname = 'm38-expire-old-open-visits'/);
  assert.match(closeMigration, /PERFORM cron\.unschedule\(v_job_id\)/);
  assert.match(closeMigration, /cron\.schedule\(\s+'m38-expire-old-open-visits'/);
});
