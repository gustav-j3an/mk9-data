import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../supabase/migrations/20261108160835_m37_integral_weekly_recovery.sql', import.meta.url),
  'utf8'
);
const rpcStart = migration.indexOf('CREATE OR REPLACE FUNCTION attendance_private.attendance_start_scheduled_occurrence(');
const rpcEnd = migration.indexOf('\n$$;', rpcStart);
assert.ok(rpcStart >= 0 && rpcEnd > rpcStart, 'scheduled occurrence RPC must be present');
const rpc = migration.slice(rpcStart, rpcEnd);

const lockPromoter = rpc.indexOf('pg_advisory_xact_lock(hashtextextended(v_matricula, 1))');
const identifyIndustry = rpc.indexOf('SELECT r.industria_codigo INTO v_industry_code');
const lockIndustry = rpc.indexOf('FOR SHARE;', identifyIndustry);
const lockRoute = rpc.indexOf('FOR UPDATE;', lockIndustry);
assert.ok(lockPromoter >= 0 && lockPromoter < identifyIndustry, 'promoter advisory lock must precede industry/route locks');
assert.ok(identifyIndustry < lockIndustry && lockIndustry < lockRoute, 'industry FOR SHARE must precede route FOR UPDATE');
assert.match(rpc, /v_ind_status <> 'ativo'/, 'industry must be explicitly active');
assert.match(rpc, /p_lat NOT BETWEEN -90 AND 90[\s\S]*p_lng NOT BETWEEN -180 AND 180[\s\S]*p_accuracy IN \('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric\)/,
  'GPS coordinates and accuracy must be validated');
assert.match(rpc, /a\.route_id = p_route\s+AND a\.scheduled_date = p_scheduled_date/, 'same occurrence must be deduplicated by route and scheduled date');
assert.match(rpc, /v\.rota_id = p_route\s+AND \(v\.scheduled_date = p_scheduled_date/, 'existing occurrence lookup must retain original scheduled date');
assert.match(rpc, /v\.status = 'em_andamento'[\s\S]*Another visit is in progress/, 'simultaneous visits must be blocked');
assert.match(rpc, /scheduled_date = p_scheduled_date,[\s\S]*data_visita = v_effective_date/, 'recovery must preserve planned date and set effective date');
assert.match(rpc, /INSERT INTO public\.visit_schedule_actions[\s\S]*auth\.uid\(\)/, 'audit action must be recorded transactionally with actor identity');
assert.doesNotMatch(rpc, /public\.attendance_check_in\s*\(/, 'scheduled occurrence must bypass legacy store/day upsert');
assert.match(migration, /ON CONFLICT \(promotor_matricula, loja_codigo, industria_codigo, data_visita\) WHERE scheduled_date IS NULL/,
  'regular check-in must target only the partial unscheduled-visit index');
assert.match(migration, /AND scheduled_date IS NULL/, 'regular check-in lookup must not reuse scheduled occurrences');
assert.match(migration, /visits_promoter_route_scheduled_date_unique[\s\S]*ON public\.visits \(promotor_matricula, rota_id, scheduled_date\)/,
  'scheduled uniqueness must be scoped to route and planned date');

console.log('PASS M37 recovery migration preserves lock order, industry/GPS guards, occurrence uniqueness, visit serialization, planned date and audit');
