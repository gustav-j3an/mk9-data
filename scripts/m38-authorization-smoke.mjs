import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY;
const base = process.env.SUPABASE_TEST_API_URL || 'http://127.0.0.1:54321';
const visitId = process.env.M38_SMOKE_VISIT_ID;
assert.ok(anonKey && serviceKey && visitId, 'Only run against a local synthetic fixture');

const request = async (path, key, token, method = 'GET', body) => {
  const response = await fetch(base + path, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${token || key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let data;
  try { data = await response.json(); } catch { data = null; }
  return { status: response.status, data };
};
const pg = sql => execFileSync('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();
const before = pg(`SELECT status FROM public.visits WHERE id='${visitId}'`);
assert.equal(before, 'em_andamento', 'Selected local synthetic visit is no longer active');

const anonymous = await request(`/rest/v1/rpc/attendance_cancel_visit`, anonKey, null, 'POST', {
  p_visit_id: visitId, p_reason: 'Unauthorized anonymous cancellation attempt'
});
assert.ok(anonymous.status >= 400, 'Anonymous cancellation was accepted');

const email = `m38-manager-${randomBytes(8).toString('hex')}@example.test`;
const password = randomBytes(24).toString('hex');
const created = await request('/auth/v1/admin/users', serviceKey, serviceKey, 'POST', { email, password, email_confirm: true });
assert.ok([200, 201].includes(created.status), 'Synthetic manager account could not be created');
pg(`UPDATE public.profiles SET role='gestor', status='ativo', promotor_matricula=NULL WHERE id='${created.data.id}'`);
const login = await request('/auth/v1/token?grant_type=password', anonKey, anonKey, 'POST', { email, password });
assert.equal(login.status, 200, 'Synthetic manager login failed');
const manager = await request('/rest/v1/rpc/attendance_cancel_visit', anonKey, login.data.access_token, 'POST', {
  p_visit_id: visitId, p_reason: 'Unauthorized manager cancellation attempt'
});
assert.ok(manager.status >= 400, 'Manager used the promoter cancellation RPC');
assert.equal(pg(`SELECT status FROM public.visits WHERE id='${visitId}'`), before, 'Unauthorized request changed visit status');
assert.equal(pg(`SELECT count(*) FROM public.visit_lifecycle_audit WHERE visit_id='${visitId}'`), '0', 'Unauthorized request created lifecycle audit');
console.log('PASS anonymous and manager callers are denied promoter cancellation without changing the visit.');
