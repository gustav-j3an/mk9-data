import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const pg = (sql) => execFileSync('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();
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
const snapshot = () => pg(`SELECT id || '|' || coalesce(status,'') || '|' || coalesce(regularization_status,'')
  FROM public.visits WHERE id IN ('37000000-0000-4000-8000-000000000101','37000000-0000-4000-8000-000000000102')
  ORDER BY id`);
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
for (const [n, label] of [[2,'closed before'],[3,'closed on'],[4,'closed after']])
  await denied(label, () => scheduled(users[0], n, yesterday), '42501');
await denied('inactive industry', () => scheduled(users[0], 5, yesterday), '42501');
await denied('missing industry', () => checkin(users[0], 'M37L1', 'M37MISSING', route(1)), '42501');
await denied('other promoter route', () => scheduled(users[1], 1, yesterday), '42501');
await denied('completed visit', () => scheduled(users[0], 6, yesterday), '23505');
await denied('regularized visit', () => scheduled(users[0], 7, yesterday), '23505');
await denied('route-less check-in with closed route', () => checkin(users[0], 'M37L2','M37IA'), '42501');
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
const pendingRecovery = await scheduled(users[3], 10, yesterday);
assert.equal(pendingRecovery.status, 200,
  `Materialized pending recovery failed: ${pendingRecovery.data?.code ?? pendingRecovery.status}`);
assert.equal(pendingRecovery.data?.scheduled_date, iso(yesterday));
assert.equal(pendingRecovery.data?.data_visita, iso(today));
assert.equal(pendingRecovery.data?.id, '37000000-0000-4000-8000-000000000103');
assert.equal(count('visits', `rota_id='${route(10)}'`), 1);
assert.equal(count('visit_schedule_actions', `route_id='${route(10)}' AND scheduled_date='${iso(yesterday)}'`), 1);
console.log('PASS materialized pending visit recovery'); cases++;
assert.equal(snapshot(), historyBefore, 'Unrelated historical visits changed');
console.log('PASS unrelated historical visits unchanged'); cases++;
console.log(`Functional cases passed: ${cases}`);

