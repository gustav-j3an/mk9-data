import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolveSupabaseTestApiUrl } from './m37-supabase-test-api-url.mjs';

const pg = sql => execFileSync('psql', ['-X','-A','-t','-v','ON_ERROR_STOP=1','-c',sql], { encoding:'utf8' }).trim();
const status = process.env.SUPABASE_TEST_API_URL
  && process.env.SUPABASE_TEST_ANON_KEY
  && process.env.SUPABASE_TEST_SERVICE_KEY
  ? ''
  : execFileSync('supabase', ['status', '-o', 'env'], { cwd: process.env.SUPABASE_TEST_WORKDIR, encoding: 'utf8' });
const localEnv = Object.fromEntries(status.split(/\r?\n/).map(line => {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  return match ? [match[1], match[2].replace(/^["']|["']$/g, '')] : [];
}).filter(([key]) => key));
const anonKey = process.env.SUPABASE_TEST_ANON_KEY ?? localEnv.ANON_KEY ?? localEnv.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY ?? localEnv.SERVICE_ROLE_KEY ?? localEnv.SUPABASE_SERVICE_ROLE_KEY;
const base = resolveSupabaseTestApiUrl(process.env.SUPABASE_TEST_API_URL, status);
const testTag = randomBytes(2).toString('hex').toUpperCase();
const m38 = `M38${testTag}`;
const testUuidPrefix = `38000000-${testTag.toLowerCase()}-4000-8000`;
assert.ok(anonKey && serviceKey, 'Set synthetic local Supabase keys before running this isolated integration suite');

const request = async (path, key, token, method='GET', body, headers={}) => {
  const response = await fetch(base + path, {
    method,
    headers: {
      apikey:key,
      Authorization:`Bearer ${token || key}`,
      ...(body ? {'Content-Type':'application/json'} : {}),
      ...headers
    },
    body:body ? JSON.stringify(body) : undefined
  });
  let data;
  try { data = await response.json(); } catch { data = null; }
  return { status:response.status, data };
};
const rpc = (user, args) => request('/rest/v1/rpc/attendance_start_scheduled_occurrence', anonKey, user.token, 'POST', args);
const cancel = (user, visitId, reason='Teste funcional M38: interrupção justificada.') =>
  request('/rest/v1/rpc/attendance_cancel_visit', anonKey, user.token, 'POST', {p_visit_id:visitId,p_reason:reason});
const route = n => `${testUuidPrefix}-${String(n).padStart(12,'0')}`;
const visit = n => `${testUuidPrefix}-${String(n).padStart(12,'0')}`;
const count = (table, where) => Number(pg(`SELECT count(*) FROM public.${table} WHERE ${where}`));
const readVisit = id => JSON.parse(pg(`SELECT row_to_json(v)::text FROM public.visits v WHERE v.id='${id}'`));
const today = (() => {
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const value = type => Number(parts.find(part => part.type===type).value);
  return new Date(Date.UTC(value('year'),value('month')-1,value('day')));
})();
const dateString = value => value.toISOString().slice(0,10);
const yesterday = new Date(today.getTime()-86400000);
const scheduledDate = dateString(yesterday);

const users=[];
for(let i=1;i<=7;i++){
  const email=`mission38-${i}-${randomBytes(8).toString('hex')}@example.test`;
  const password=randomBytes(24).toString('hex');
  const created=await request('/auth/v1/admin/users',serviceKey,serviceKey,'POST',{email,password,email_confirm:true});
  assert.ok([200,201].includes(created.status),`Synthetic auth user ${i} creation failed: ${created.status}`);
  const login=async()=>request('/auth/v1/token?grant_type=password',anonKey,anonKey,'POST',{email,password});
  const first=await login();
  assert.equal(first.status,200,`Synthetic auth user ${i} login failed`);
  const second=i===2 ? await login() : null;
  if(second) assert.equal(second.status,200,'Second independent authenticated session failed');
  users.push({id:created.data.id,token:first.data.access_token,secondToken:second?.data.access_token});
}
console.log('PASS local GoTrue authentication for six synthetic promoters and one manager.');

const fixtureSql = readFileSync('scripts/m38-functional-fixtures.sql','utf8')
  .replaceAll('M38',m38)
  .replaceAll('38000000-0000-4000-8000',testUuidPrefix);
execFileSync('psql',[
  '-X','-v','ON_ERROR_STOP=1',
  ...users.flatMap((user,index)=>['-v',`user${index+1}=${user.id}`]),
  '-f','-'
],{input:fixtureSql,stdio:['pipe','pipe','pipe']});
console.log('PASS isolated promoter, route, attempt, evidence and day-boundary fixtures.');

// Promoter ownership, atomic cancellation and evidence/audit preservation.
const otherOwnerBefore=readVisit(visit(103));
const firstBeforeCancel=readVisit(visit(101));
const anonymousCancel=await cancel({},visit(101));
assert.ok(anonymousCancel.status>=400,'Anonymous caller cancelled a visit');
assert.deepEqual(readVisit(visit(101)),firstBeforeCancel,'Anonymous cancellation changed a visit');
const managerCancel=await cancel(users[6],visit(101));
assert.ok(managerCancel.status>=400,'Manager used promoter cancellation RPC');
assert.deepEqual(readVisit(visit(101)),firstBeforeCancel,'Manager cancellation changed a visit');
const foreignCancel=await cancel(users[0],visit(103));
assert.ok(foreignCancel.status>=400,'Promoter cancelled another promoter visit');
assert.deepEqual(readVisit(visit(103)),otherOwnerBefore,'Foreign cancellation changed another promoter visit');

const cancelSecondRoute=await cancel(users[0],visit(102));
assert.equal(cancelSecondRoute.status,200,`Own cancellation failed: ${cancelSecondRoute.data?.message||cancelSecondRoute.status}`);
const cancelFirstRoute=await cancel(users[0],visit(101));
assert.equal(cancelFirstRoute.status,200,`Own cancellation failed: ${cancelFirstRoute.data?.message||cancelFirstRoute.status}`);
assert.equal(cancelFirstRoute.data.status,'nao_realizada');
assert.equal(cancelFirstRoute.data.completed_at,null);
assert.equal(cancelFirstRoute.data.started_at,firstBeforeCancel.started_at);
assert.match(cancelFirstRoute.data.motivo_nao_realizada,/Teste funcional M38/);
assert.equal(count('visit_lifecycle_audit',`visit_id='${visit(101)}' AND action='promoter_cancelled' AND actor_id='${users[0].id}'`),1);
assert.equal(count('visit_checklist_items',`visit_id='${visit(101)}'`),1,'Cancellation removed existing evidence');
const ownerAudit=await request(`/rest/v1/visit_lifecycle_audit?select=visit_id&visit_id=eq.${visit(101)}`,anonKey,users[0].token);
assert.equal(ownerAudit.status,200);
assert.equal(ownerAudit.data.length,1,'Owner cannot read their lifecycle audit');
const foreignAudit=await request(`/rest/v1/visit_lifecycle_audit?select=visit_id&visit_id=eq.${visit(101)}`,anonKey,users[1].token);
assert.equal(foreignAudit.status,200);
assert.deepEqual(foreignAudit.data,[],'Other promoter can read lifecycle audit');
const foreignVisit=await request(`/rest/v1/visits?select=id&id=eq.${visit(101)}`,anonKey,users[1].token);
assert.equal(foreignVisit.status,200);
assert.deepEqual(foreignVisit.data,[],'Other promoter can read visit');
console.log('PASS cancellation ownership, immutable history, audit RLS and evidence preservation.');

// A closed occurrence creates a new attempt linked to the root; its first row stays unchanged.
const oldBeforeRecovery=readVisit(visit(101));
const recovered=await rpc(users[0],{p_route:route(1),p_scheduled_date:scheduledDate,p_action:'recover',p_lat:null,p_lng:null,p_accuracy:null});
assert.equal(recovered.status,200,`Cancelled attempt recovery failed: ${recovered.data?.message||recovered.status}`);
assert.notEqual(recovered.data.id,visit(101));
assert.equal(recovered.data.attempt_number,2);
assert.equal(recovered.data.occurrence_root_visit_id,visit(101));
assert.equal(recovered.data.status,'em_andamento');
assert.equal(recovered.data.scheduled_date,scheduledDate);
assert.equal(recovered.data.data_visita,dateString(today));
assert.deepEqual(readVisit(visit(101)),oldBeforeRecovery,'Recovery changed or reopened the original cancelled attempt');
assert.equal(count('visit_schedule_actions',`route_id='${route(1)}' AND scheduled_date='${scheduledDate}' AND visit_id='${recovered.data.id}'`),1);
const directAttemptPatch=await request(`/rest/v1/visits?id=eq.${recovered.data.id}`,anonKey,users[0].token,'PATCH',{attempt_number:3},{Prefer:'return=representation'});
assert.ok(directAttemptPatch.status>=400,'Direct attempt identity modification was accepted');
assert.equal(readVisit(recovered.data.id).attempt_number,2);
const retryDuplicate=await rpc(users[0],{p_route:route(1),p_scheduled_date:scheduledDate,p_action:'recover',p_lat:null,p_lng:null,p_accuracy:null});
assert.ok(retryDuplicate.status>=400,'Active recovery attempt was duplicated');
const blockedByActive=await rpc(users[0],{p_route:route(2),p_scheduled_date:scheduledDate,p_action:'recover',p_lat:null,p_lng:null,p_accuracy:null});
assert.ok(blockedByActive.status>=400,'A second active visit was started for the same promoter');
assert.equal(count('visits',`rota_id='${route(2)}' AND attempt_number>1`),0);
console.log('PASS weekly recovery creates a linked attempt, retains original audit/evidence and enforces one active visit.');

// Concurrent retries from separate authenticated sessions serialize to exactly one new attempt.
const cancelConcurrent=await cancel(users[1],visit(103));
assert.equal(cancelConcurrent.status,200);
const concurrentCalls=await Promise.all([
  rpc(users[1],{p_route:route(3),p_scheduled_date:scheduledDate,p_action:'recover',p_lat:null,p_lng:null,p_accuracy:null}),
  rpc({token:users[1].secondToken},{p_route:route(3),p_scheduled_date:scheduledDate,p_action:'recover',p_lat:null,p_lng:null,p_accuracy:null})
]);
assert.equal(concurrentCalls.filter(result=>result.status===200).length,1,'Concurrent retry did not have exactly one winner');
assert.equal(concurrentCalls.filter(result=>result.status>=400).length,1,'Concurrent retry did not reject the duplicate');
assert.equal(count('visits',`rota_id='${route(3)}' AND attempt_number=2`),1);
assert.equal(count('visit_schedule_actions',`route_id='${route(3)}' AND scheduled_date='${scheduledDate}'`),1);
console.log('PASS concurrent weekly retries serialize to one new attempt and one action.');

// Check-in fallback closes old visits, the worker uses the Sao Paulo midnight boundary,
// and completed rows are not touched.
const completedSnapshot=readVisit(visit(105));
const fallback=await request('/rest/v1/rpc/attendance_check_in',anonKey,users[5].token,'POST',
  {p_store:`${m38}L8`,p_industry:`${m38}IA`,p_route:route(8),p_lat:null,p_lng:null,p_accuracy:null});
assert.equal(fallback.status,200,`Check-in fallback failed: ${fallback.data?.message||fallback.status}`);
assert.equal(readVisit(visit(107)).status,'nao_realizada');
assert.equal(readVisit(visit(107)).completed_at,null);
assert.equal(count('visit_lifecycle_audit',`visit_id='${visit(107)}' AND action='auto_closed_at_day_end' AND actor_type='system'`),1);
assert.equal(count('visit_checklist_items',`visit_id='${visit(107)}'`),1);
pg('SELECT attendance_private.expire_old_open_visits()');
const autoClosed=readVisit(visit(104));
assert.equal(autoClosed.status,'nao_realizada');
assert.equal(autoClosed.completed_at,null);
assert.equal(autoClosed.motivo_nao_realizada,'Não finalizada até o encerramento do dia operacional');
assert.equal(count('visit_lifecycle_audit',`visit_id='${visit(104)}' AND action='auto_closed_at_day_end' AND actor_type='system'`),1);
assert.equal(count('visit_checklist_items',`visit_id='${visit(104)}'`),1);
assert.equal(readVisit(visit(106)).status,'em_andamento','Visit started exactly at Sao Paulo midnight was closed too early');
assert.deepEqual(readVisit(visit(105)),completedSnapshot,'Automatic closure changed a completed visit');
const autoRetry=await rpc(users[2],{p_route:route(4),p_scheduled_date:scheduledDate,p_action:'recover',p_lat:null,p_lng:null,p_accuracy:null});
assert.equal(autoRetry.status,200,`Automatically closed attempt recovery failed: ${autoRetry.data?.message||autoRetry.status}`);
assert.equal(autoRetry.data.attempt_number,2);
assert.equal(autoRetry.data.occurrence_root_visit_id,visit(104));
console.log('PASS day-end closure, midnight boundary, check-in fallback, evidence retention and completed-visit protection.');

// A completed attempt permanently blocks recovery of its original occurrence.
pg(`UPDATE public.visits SET status='concluida',completed_at=clock_timestamp() WHERE id='${autoRetry.data.id}'`);
const completedRetrySnapshot=readVisit(autoRetry.data.id);
const afterCompleteRetry=await rpc(users[2],{p_route:route(4),p_scheduled_date:scheduledDate,p_action:'recover',p_lat:null,p_lng:null,p_accuracy:null});
assert.ok(afterCompleteRetry.status>=400,'Completed occurrence was recovered again');
assert.deepEqual(readVisit(autoRetry.data.id),completedRetrySnapshot,'Rejected recovery modified completed attempt');
const outsideWeek=await rpc(users[2],{p_route:route(4),p_scheduled_date:dateString(new Date(today.getTime()-9*86400000)),p_action:'recover',p_lat:null,p_lng:null,p_accuracy:null});
assert.ok(outsideWeek.status>=400,'Recovery outside original operational week was accepted');
console.log('PASS completed occurrences remain final and recovery stays within the operational week.');

const cron=pg("SELECT count(*) FROM cron.job WHERE jobname='m38-expire-old-open-visits' AND schedule='* * * * *'");
assert.equal(cron,'1','Server-side one-minute cleanup job is missing');
console.log('PASS server-side pg_cron job registered at one-minute cadence.');

console.log('All Mission 38 PostgreSQL integration scenarios passed.');
