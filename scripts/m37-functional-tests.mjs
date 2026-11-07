import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const pg = (sql) => execFileSync('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();
const runAsyncPsql = (sql) => {
  const child = spawn('psql', ['-X', '-v', 'ON_ERROR_STOP=1'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', d => { stdout += d.toString(); });
  child.stderr.on('data', d => { stderr += d.toString(); });
  child.stdin.write(sql);
  child.stdin.end();
  return {
    child,
    done: new Promise((resolve, reject) => {
      child.on('close', code => {
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(`psql process exited with ${code}: ${stderr}`));
      });
    })
  };
};
const waitForCondition = async (fn, desc = 'condition', timeoutMs = 8000) => {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timeout after ${timeoutMs}ms waiting for: ${desc}`);
    await new Promise(r => setTimeout(r, 20));
  }
};
const status = execFileSync('supabase', ['status', '-o', 'env'], {
  cwd: process.env.SUPABASE_TEST_WORKDIR, encoding: 'utf8'
});
const env = Object.fromEntries(status.split(/\r?\n/).map(line => {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  return match ? [match[1], match[2].replace(/^["']|["']$/g, '')] : [];
}).filter(([key]) => key));
const anonKey = env.ANON_KEY ?? env.SUPABASE_ANON_KEY;
const serviceKey = env.SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(anonKey && serviceKey, 'Local Supabase keys missing from CLI status');
const base = 'http://127.0.0.1:54321';
const request = async (path, key, token, method = 'GET', body) => {
  const response = await fetch(base + path, {
    method,
    headers: {
      apikey: key, Authorization: `Bearer ${token ?? key}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let data;
  try { data = await response.json(); } catch { data = null; }
  return { status: response.status, data };
};
const users = [];
for (let i = 1; i <= 4; i++) {
  const email = `m37p${i}@example.test`;
  const password = randomBytes(18).toString('hex');
  const created = await request('/auth/v1/admin/users', serviceKey, serviceKey, 'POST',
    { email, password, email_confirm: true });
  assert.ok([200, 201].includes(created.status), `Auth user ${i} creation failed: ${created.status}`);
  const id = created.data?.id;
  assert.match(id, /^[0-9a-f-]{36}$/i);
  const login = await request('/auth/v1/token?grant_type=password', anonKey, anonKey, 'POST',
    { email, password });
  assert.equal(login.status, 200, `Auth user ${i} login failed: ${login.status}`);
  assert.ok(login.data?.access_token);
  let secondToken;
  if (i === 3) {
    const secondLogin = await request('/auth/v1/token?grant_type=password', anonKey, anonKey, 'POST',
      { email, password });
    assert.equal(secondLogin.status, 200);
    secondToken = secondLogin.data?.access_token;
    assert.ok(secondToken && secondToken !== login.data.access_token, 'Independent Auth sessions required');
  }
  users.push({ id, token: login.data.access_token, secondToken });
}
console.log('Four synthetic users authenticated via local GoTrue; promoter 3 has two sessions.');
execFileSync('psql', [
  '-X', '-v', 'ON_ERROR_STOP=1',
  '-v', `user1=${users[0].id}`, '-v', `user2=${users[1].id}`, '-v', `user3=${users[2].id}`,
  '-v', `user4=${users[3].id}`,
  '-f', 'scripts/m37-functional-fixtures.sql'
], { stdio: ['ignore', 'pipe', 'pipe'] });
console.log('Privileged synthetic fixture setup completed.');
assert.equal(pg("SELECT count(*) FROM public.profiles WHERE role='promotor' AND status='ativo' AND promotor_matricula IN ('M37P1','M37P2','M37P3','M37P4')"), '4');

const today = (() => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const get = type => Number(parts.find(p => p.type === type).value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
})();
const iso = date => date.toISOString().slice(0, 10);
const yesterday = new Date(today.getTime() - 86400000);
const weekStart = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * 86400000);
assert.ok(yesterday >= weekStart, 'No earlier date in current week; recovery case cannot run today');
const previousWeek = new Date(weekStart.getTime() - 86400000);
const route = n => `37000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const count = (table, where = 'true') => Number(pg(`SELECT count(*) FROM public.${table} WHERE ${where}`));
const snapshot = () => pg(`SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM public.visits v
  WHERE v.id IN ('37000000-0000-4000-8000-000000000101','37000000-0000-4000-8000-000000000102')`);
const historyBefore = snapshot();
const rpc = (user, name, args) => request(`/rest/v1/rpc/${name}`, anonKey, user.token, 'POST', args);
const scheduled = (user, n, date) => rpc(user, 'attendance_start_scheduled_occurrence',
  { p_route: route(n), p_scheduled_date: iso(date), p_action: 'recover',
    p_lat: null, p_lng: null, p_accuracy: null });
const checkin = (user, store, industry, routeId = null) => rpc(user, 'attendance_check_in',
  { p_store: store, p_industry: industry, p_route: routeId,
    p_lat: null, p_lng: null, p_accuracy: null });
let cases = 0;
const denied = async (label, call, expectedCode) => {
  const visitsBefore = count('visits');
  const auditBefore = count('visit_schedule_actions');
  const result = await call();
  assert.ok(result.status >= 400, `${label}: unexpectedly accepted`);
  if (expectedCode) assert.equal(result.data?.code, expectedCode, `${label}: code`);
  assert.equal(count('visits'), visitsBefore, `${label}: visits changed`);
  assert.equal(count('visit_schedule_actions'), auditBefore, `${label}: audit changed`);
  console.log(`PASS ${label}: rejected ${result.data?.code ?? result.status}; tables unchanged`);
  cases++;
};

await denied('outside current week', () => scheduled(users[0], 1, previousWeek), '22023');
for (const [n, label] of [[2,'closed before'],[3,'closed on'],[4,'closed after'],[14,'closed future']])
  await denied(label, () => scheduled(users[0], n, yesterday), '42501');

await denied('inactive industry', () => scheduled(users[0], 5, yesterday), '42501');
await denied('missing industry', () => checkin(users[0], 'M37L1', 'M37MISSING', route(1)), '42501');
await denied('other promoter route', () => scheduled(users[1], 1, yesterday), '42501');
await denied('completed visit', () => scheduled(users[0], 6, yesterday), '23505');
await denied('regularized visit', () => scheduled(users[0], 7, yesterday), '23505');
await denied('visit with checklist evidence', () => scheduled(users[3], 12, yesterday), '23505');
await denied('visit with product validity evidence', () => scheduled(users[3], 15, yesterday), '23505');
await denied('visit with prior check-in', () => scheduled(users[3], 13, yesterday), '23505');
await denied('route-less check-in with closed route', () => checkin(users[0], 'M37L2','M37IA'), '42501');

// Teste de concorrência real — Ordem 1: Inativação concorre com check-in
// Sessão B1 (Admin) inicia transação, atualiza status da indústria M37IC1 para 'inativo' e retém commit via advisory lock 99901.
// Sessão A1 (Promotor) tenta check-in e entra em lock wait comprovado no catálogo pg_locks (NOT granted).
// Liberação da Sessão B1 -> COMMIT -> Sessão A1 é desbloqueada e aborta com 42501 sem criar visita.
pg("SELECT pg_advisory_lock(99901)");
const sessionB1 = runAsyncPsql(`
  BEGIN;
  UPDATE public.industrias SET status = 'inativo' WHERE codigo = 'M37IC1';
  SELECT pg_advisory_lock(99901);
  COMMIT;
  SELECT pg_advisory_unlock(99901);
`);

await waitForCondition(
  () => Number(pg("SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = 99901 AND NOT granted")) > 0,
  'sessionB1 holding exclusive tuple lock on industry M37IC1'
);

const checkinOrder1Promise = scheduled(users[0], 17, yesterday);

await waitForCondition(
  () => Number(pg("SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE NOT l.granted AND a.query LIKE '%attendance_%'")) > 0,
  'sessionA1 blocked by sessionB1 tuple lock on industry'
);

pg("SELECT pg_advisory_unlock(99901)");
await sessionB1.done;

const resOrder1 = await checkinOrder1Promise;
assert.ok(resOrder1.status >= 400, 'Order 1: check-in was unexpectedly accepted during inactivation');
assert.equal(resOrder1.data?.code, '42501', 'Order 1: expected 42501 for inactivated industry');
assert.equal(count('visits', `rota_id='${route(17)}'`), 0, 'Order 1: no visit must be created');
assert.equal(count('visit_schedule_actions', `route_id='${route(17)}'`), 0, 'Order 1: no audit action must be created');
assert.equal(pg("SELECT status FROM public.industrias WHERE codigo = 'M37IC1'"), 'inativo', 'Order 1: industry must be inactive');
console.log('PASS concurrent industry inactivation order 1: lock contention verified in pg_locks, check-in denied (42501), no visits');
cases++;

// Teste de concorrência real — Ordem 2: Check-in inicia antes e segura lock FOR SHARE na indústria M37IC2
// Sessão B2 (Admin) tenta UPDATE public.industrias SET status='inativo' e entra em lock wait comprovado via pg_locks.
// Liberação da Sessão A2 -> COMMIT grava a visita -> Sessão B2 é desbloqueada e inativa a indústria.
// Check-in subsequente na indústria agora inativa é barrado com 42501.
pg("SELECT pg_advisory_lock(99902)");
const sessionA2 = runAsyncPsql(`
  BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL "request.jwt.claim.sub" = '${users[0].id}';
  SELECT public.attendance_start_scheduled_occurrence(
    '${route(18)}'::uuid,
    '${iso(yesterday)}'::date,
    'recover'
  );
  SELECT pg_advisory_lock(99902);
  COMMIT;
  SELECT pg_advisory_unlock(99902);
`);

await waitForCondition(
  () => Number(pg("SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = 99902 AND NOT granted")) > 0,
  'sessionA2 holding FOR SHARE lock on industry M37IC2'
);

const sessionB2 = runAsyncPsql(`
  UPDATE public.industrias SET status = 'inativo' WHERE codigo = 'M37IC2';
`);

await waitForCondition(
  () => Number(pg("SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE NOT l.granted AND a.query LIKE '%UPDATE public.industrias%M37IC2%'")) > 0,
  'sessionB2 blocked by sessionA2 FOR SHARE lock on industry M37IC2'
);

pg("SELECT pg_advisory_unlock(99902)");
await sessionA2.done;
await sessionB2.done;

assert.equal(count('visits', `rota_id='${route(18)}' AND scheduled_date='${iso(yesterday)}'`), 1, 'Order 2: visit must exist');
assert.equal(count('visit_schedule_actions', `route_id='${route(18)}' AND scheduled_date='${iso(yesterday)}'`), 1, 'Order 2: audit must exist');
assert.equal(pg("SELECT status FROM public.industrias WHERE codigo = 'M37IC2'"), 'inativo', 'Order 2: industry must be inactive');

const postInactivationCheckin = await scheduled(users[0], 18, yesterday);
assert.ok(postInactivationCheckin.status >= 400, 'Order 2: subsequent check-in must be rejected');
assert.equal(postInactivationCheckin.data?.code, '42501', 'Order 2: subsequent check-in code 42501');
console.log('PASS concurrent industry inactivation order 2: lock contention verified, serialization respected, check-in saved, subsequent check-in denied (42501)');
cases++;

// Validações do modo OPERACAO_OFICIAL
pg("UPDATE public.system_settings SET value='\"OPERACAO_OFICIAL\"'::jsonb WHERE key='operation_mode'");
pg("DELETE FROM public.system_settings WHERE key='official_start_date'");
await denied('official mode missing start date', () => scheduled(users[0], 1, yesterday), '22023');

pg("INSERT INTO public.system_settings(key, value) VALUES ('official_start_date', '\"invalid-date\"'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value");
await denied('official mode invalid start date', () => scheduled(users[0], 1, yesterday), '22023');

pg(`UPDATE public.system_settings SET value=to_jsonb('${iso(today)}'::text) WHERE key='official_start_date'`);
await denied('official mode visit prior to start', () => scheduled(users[0], 1, yesterday), '22023');

// Restauração do modo de operação para os demais testes
pg("UPDATE public.system_settings SET value='\"IMPLANTACAO\"'::jsonb WHERE key='operation_mode'");
pg("DELETE FROM public.system_settings WHERE key='official_start_date'");

const auditRead = await request('/rest/v1/visit_schedule_actions?select=id', anonKey, users[0].token);
assert.ok(auditRead.status >= 400, 'Direct audit SELECT was accepted');
console.log(`PASS direct audit SELECT denied: ${auditRead.status}`); cases++;

const recovered = await scheduled(users[0], 1, yesterday);
assert.equal(recovered.status, 200, `Recovery failed: ${recovered.data?.code ?? recovered.status}`);
assert.equal(recovered.data?.scheduled_date, iso(yesterday));
assert.equal(recovered.data?.data_visita, iso(today));
assert.equal(recovered.data?.status, 'em_andamento');
assert.equal(count('visits', `rota_id='${route(1)}' AND scheduled_date='${iso(yesterday)}'`), 1);
assert.equal(count('visit_schedule_actions', `route_id='${route(1)}' AND scheduled_date='${iso(yesterday)}'`), 1);
console.log('PASS current-week recovery, dates and single audit action'); cases++;

const foreignRead = await request(`/rest/v1/visits?select=id&id=eq.${recovered.data.id}`, anonKey, users[1].token);
assert.equal(foreignRead.status, 200);
assert.deepEqual(foreignRead.data, [], 'Other promoter could read recovered visit');
console.log('PASS other promoter cannot read visit through RLS'); cases++;

await denied('repeated recovery', () => scheduled(users[0], 1, yesterday), '23505');

const repeatCheckin = await checkin(users[0], 'M37L1','M37IA',route(1));
assert.equal(repeatCheckin.status, 200);
assert.equal(repeatCheckin.data?.id, recovered.data?.id);
assert.equal(count('visits', `rota_id='${route(1)}' AND scheduled_date='${iso(yesterday)}'`), 1);
console.log('PASS active-route check-in reused same in-progress visit'); cases++;

const routeLess = await checkin(users[1], 'M37L8','M37IA');
assert.equal(routeLess.status, 200, `Route-less active check-in failed: ${routeLess.data?.code ?? routeLess.status}`);
assert.equal(routeLess.data?.rota_id, null);
console.log('PASS route-less check-in with active assignment'); cases++;

const concurrent = await Promise.all([
  scheduled(users[2], 9, yesterday),
  scheduled({ token: users[2].secondToken }, 9, yesterday)
]);
assert.equal(concurrent.filter(r => r.status === 200).length, 1);
assert.equal(concurrent.filter(r => r.status >= 400).length, 1);
assert.equal(count('visits', `rota_id='${route(9)}' AND scheduled_date='${iso(yesterday)}'`), 1);
assert.equal(count('visit_schedule_actions', `route_id='${route(9)}' AND scheduled_date='${iso(yesterday)}'`), 1);
console.log('PASS concurrent independent authenticated requests: one visit and action'); cases++;

assert.equal(snapshot(), historyBefore, 'Unrelated historical visits changed');
console.log('PASS unrelated historical visits unchanged'); cases++;

const pendingRecovery = await scheduled(users[3], 10, yesterday);
assert.equal(pendingRecovery.status, 200,
  `Materialized pending recovery failed: ${pendingRecovery.data?.code ?? pendingRecovery.status}`);
assert.equal(pendingRecovery.data?.scheduled_date, iso(yesterday));
assert.equal(pendingRecovery.data?.data_visita, iso(today));
assert.equal(pendingRecovery.data?.id, '37000000-0000-4000-8000-000000000103');
assert.equal(count('visits', `rota_id='${route(10)}'`), 1);
assert.equal(count('visit_schedule_actions', `route_id='${route(10)}' AND scheduled_date='${iso(yesterday)}'`), 1);
console.log('PASS materialized pending visit recovery'); cases++;

const directPatchOwn = await request('/rest/v1/visits?id=eq.37000000-0000-4000-8000-000000000104',
  anonKey, users[3].token, 'PATCH', { data_visita: iso(today) });
assert.ok(directPatchOwn.status >= 400, 'Direct PATCH on data_visita unexpectedly accepted');
assert.equal(directPatchOwn.data?.code, '42501');
console.log('PASS direct promoter update of data_visita blocked (42501)'); cases++;

const directPatchOther = await request('/rest/v1/visits?id=eq.37000000-0000-4000-8000-000000000104',
  anonKey, users[0].token, 'PATCH', { data_visita: iso(today) });
assert.ok(directPatchOther.status >= 400, 'Direct PATCH on other promoter visit unexpectedly accepted');
console.log('PASS direct update of another promoter visit blocked'); cases++;

const unperformedRecovery = await scheduled(users[3], 11, yesterday);
assert.equal(unperformedRecovery.status, 200,
  `Materialized unperformed recovery failed: ${unperformedRecovery.data?.code ?? unperformedRecovery.status}`);
assert.equal(unperformedRecovery.data?.scheduled_date, iso(yesterday));
assert.equal(unperformedRecovery.data?.data_visita, iso(today));
assert.equal(unperformedRecovery.data?.id, '37000000-0000-4000-8000-000000000104');
assert.equal(count('visits', `rota_id='${route(11)}'`), 1);
assert.equal(count('visit_schedule_actions', `route_id='${route(11)}' AND scheduled_date='${iso(yesterday)}'`), 1);
console.log('PASS materialized unperformed visit recovery'); cases++;

const concurrentPending = await Promise.all([
  scheduled(users[2], 16, yesterday),
  scheduled({ token: users[2].secondToken }, 16, yesterday)
]);
assert.equal(concurrentPending.filter(r => r.status === 200).length, 1);
assert.equal(concurrentPending.filter(r => r.status >= 400).length, 1);
assert.equal(count('visits', `rota_id='${route(16)}' AND scheduled_date='${iso(yesterday)}'`), 1);
assert.equal(count('visit_schedule_actions', `route_id='${route(16)}' AND scheduled_date='${iso(yesterday)}'`), 1);
console.log('PASS concurrent materialized pending recovery: exactly one visit and action'); cases++;

assert.equal(cases, 32, `Expected exactly 32 functional scenarios, but got ${cases}`);
console.log(`All ${cases} functional scenarios passed successfully.`);
