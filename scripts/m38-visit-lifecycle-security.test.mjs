import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../supabase/migrations/20261108130000_m38_visit_cancellation_and_day_end_close.sql', import.meta.url), 'utf8');
const portal = await readFile(new URL('../src/views/PromoterPortalView.tsx', import.meta.url), 'utf8');
const cancellationService = await readFile(new URL('../src/lib/visitCancellationService.ts', import.meta.url), 'utf8');
const recoveryMigration = await readFile(new URL('../supabase/migrations/20261108100000_m37_integral_weekly_recovery.sql', import.meta.url), 'utf8');

test('cancelamento exige sessão de promotor ativo, propriedade da visita e justificativa específica', () => {
  assert.match(migration, /p\.id = auth\.uid\(\) AND p\.role = 'promotor' AND p\.status = 'ativo'/);
  assert.match(migration, /v\.id = p_visit_id AND v\.promotor_matricula = v_matricula/);
  assert.match(migration, /length\(v_reason\) < 10 OR length\(v_reason\) > 1000/);
  assert.match(cancellationService, /attendance_cancel_visit/);
  assert.match(portal, /cancelVisit\(interruptModalVisit\.id, interruptReason\)/);
  assert.match(portal, /disabled=\{Boolean\(startingRouteId\)\}/);
  assert.doesNotMatch(portal, /disabled=\{[^}]*staleInProgressVisits\.length/);
  assert.match(portal, /Visita antiga: será encerrada como não realizada automaticamente/);
  const cancelHandler = portal.slice(portal.indexOf('const handleConfirmInterruptVisit = async'), portal.indexOf('// Server validates the schedule', portal.indexOf('const handleConfirmInterruptVisit = async')));
  assert.doesNotMatch(cancelHandler, /\.from\('visits'\)\s*\.update\(/);
});

test('cancelamento é atômico, registra ator e preserva evidências e horário original', () => {
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(v_matricula, 1\)\)/);
  assert.match(migration, /visit_id uuid NOT NULL UNIQUE REFERENCES public\.visits\(id\)/);
  assert.match(migration, /WHERE v\.id = p_visit_id AND v\.promotor_matricula = v_matricula\s+FOR UPDATE/);
  assert.match(migration, /visit_lifecycle_audit[\s\S]*actor_type, actor_id, reason, evidence_refs/);
  assert.match(migration, /SELECT jsonb_build_object\('type', 'photo'/);
  assert.match(migration, /SET status = 'nao_realizada',[\s\S]*motivo_nao_realizada = 'Cancelada pelo promotor: ' \|\| v_reason/);
  assert.match(migration, /OLD\.started_at IS NULL OR OLD\.completed_at IS NOT NULL/);
  assert.match(migration, /NEW\.started_at IS DISTINCT FROM OLD\.started_at/);
  assert.match(migration, /visit_occurrences\(visit_id, tipo, descricao\)/);
});

test('concluída não pode ser cancelada e transição rejeita update direto sem autorização transacional', () => {
  assert.match(migration, /IF v_visit\.status = 'concluida' OR v_visit\.completed_at IS NOT NULL THEN/);
  assert.match(migration, /Invalid authorised visit cancellation transition/);
  assert.match(migration, /OLD\.status='em_andamento' AND NEW\.status='concluida'/);
  assert.match(migration, /Invalid visit transition/);
  assert.match(migration, /visit_lifecycle_authorizations[\s\S]*REVOKE ALL[\s\S]*FROM PUBLIC, anon, authenticated/);
});

test('virada do dia usa data local de São Paulo, sem janela de 24 horas', () => {
  assert.match(migration, /v_cutoff timestamptz := \(\(\(clock_timestamp\(\) AT TIME ZONE 'America\/Sao_Paulo'\)::date\)::timestamp AT TIME ZONE 'America\/Sao_Paulo'\)/);
  assert.match(migration, /v\.started_at < v_cutoff/);
  assert.match(migration, /Não finalizada até o encerramento do dia operacional/);
  assert.doesNotMatch(migration, /started_at\s*<[^;]*interval '24 hours'/i);
  assert.match(migration, /SET status = 'nao_realizada',[\s\S]*motivo_nao_realizada = v_reason/);
  assert.match(migration, /UPDATE public\.visits[\s\S]*SET status = 'nao_realizada'[\s\S]*WHERE id = v_visit\.id AND status = 'em_andamento' AND completed_at IS NULL/);
});

test('cron roda no servidor e check-ins fecham vencidas mesmo se o cron atrasar', () => {
  assert.match(migration, /cron\.schedule\([\s\S]*'m38-expire-old-open-visits',[\s\S]*'\* \* \* \* \*'/);
  assert.match(migration, /attendance_private\.expire_old_open_visits\(\)/);
  assert.match(migration, /expire_old_visits_before_promoter_checkin/);
  assert.match(migration, /expire_old_open_visits_for_promoter\(v_matricula\)/);
  assert.match(migration, /RENAME TO attendance_start_scheduled_occurrence_m37_base/);
  assert.match(migration, /FOR SHARE[\s\S]*FOR UPDATE[\s\S]*expire_old_open_visits_for_promoter[\s\S]*attendance_start_scheduled_occurrence_m37_base/);
  assert.match(migration, /SELECT cron\.schedule\(/);
});

test('auditoria é append-only e legível apenas pelo promotor dono ou equipe autorizada', () => {
  assert.match(migration, /visit_lifecycle_audit ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /GRANT SELECT ON public\.visit_lifecycle_audit TO authenticated/);
  assert.match(migration, /promotor_matricula = public\.get_auth_promotor_matricula\(\)[\s\S]*attendance_private\.staff_can_access\(promotor_matricula\)/);
  assert.match(migration, /visit_lifecycle_audit_immutable[\s\S]*BEFORE UPDATE OR DELETE/);
  assert.match(migration, /NEW\.scheduled_date IS DISTINCT FROM OLD\.scheduled_date/);
  assert.match(recoveryMigration, /changed before check-in/);
  assert.match(recoveryMigration, /scheduled_date = p_scheduled_date/);
});

test('requisição agendada preserva implementação de recuperação semanal M37 após expirar antigas', () => {
  assert.match(migration, /RETURN attendance_private\.attendance_start_scheduled_occurrence_m37_base\(/);
  assert.match(recoveryMigration, /Scheduled date is outside the recoverable current week/);
  assert.match(recoveryMigration, /Another visit is in progress/);
  assert.match(recoveryMigration, /scheduled_date = p_scheduled_date/);
});
