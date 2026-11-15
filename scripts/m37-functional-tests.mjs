import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const pg = (sql) => execFileSync('psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();
const createPsqlSession = (name = 'session') => {
  const child = spawn('psql', ['-X', '-v', 'ON_ERROR_STOP=0', '-v', 'VERBOSITY=verbose', '-q', '-A', '-t'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env
  });

  let serverPid = null;
  let stdoutData = '';
  let stderrData = '';
  let activeQuery = null;
  let isClosed = false;
  let seq = 0;

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  child.stdout.on('data', (chunk) => {
    stdoutData += chunk;
    if (activeQuery && stdoutData.includes(activeQuery.sentinel)) {
      const idx = stdoutData.indexOf(activeQuery.sentinel);
      const output = stdoutData.slice(0, idx).trim();
      stdoutData = stdoutData.slice(idx + activeQuery.sentinel.length);
      const q = activeQuery;
      activeQuery = null;
      if (q.timer) clearTimeout(q.timer);
      setImmediate(() => {
        if (q.queryStderr.includes('ERROR:')) {
          const err = new Error(`PsqlSession [${name}] query failed: ${q.queryStderr.trim()}`);
          err.stderr = q.queryStderr.trim();
          err.stdout = output;
          const match = q.queryStderr.match(/ERROR:\s+([A-Z0-9]{5}):/);
          err.sqlstate = match ? match[1] : null;
          q.reject(err);
        } else {
          q.resolve(output);
        }
      });
    }
  });

  child.stderr.on('data', (chunk) => {
    stderrData += chunk;
    if (activeQuery) {
      activeQuery.queryStderr += chunk;
    }
  });

  child.on('close', (code) => {
    isClosed = true;
    if (activeQuery) {
      const q = activeQuery;
      activeQuery = null;
      if (q.timer) clearTimeout(q.timer);
      q.reject(new Error(`PsqlSession [${name}] terminated unexpectedly with code ${code}. Stderr: ${stderrData}`));
    }
  });

  child.on('error', (err) => {
    isClosed = true;
    if (activeQuery) {
      const q = activeQuery;
      activeQuery = null;
      if (q.timer) clearTimeout(q.timer);
      q.reject(new Error(`PsqlSession [${name}] process error: ${err.message}`));
    }
  });

  return {
    name,
    get pid() { return serverPid; },
    get proc() { return child; },
    get stderr() { return stderrData; },
    get isClosed() { return isClosed; },
    async init() {
      const out = await this.query('SELECT pg_backend_pid();');
      serverPid = Number(out);
      assert.ok(serverPid > 0, `PsqlSession [${name}]: invalid PID ${serverPid}`);
      return serverPid;
    },
    query(sql, timeoutMs = 8000) {
      return new Promise((resolve, reject) => {
        if (isClosed || child.exitCode !== null) {
          return reject(new Error(`PsqlSession [${name}] is closed`));
        }
        if (activeQuery) {
          return reject(new Error(`PsqlSession [${name}] busy with ongoing query: ${activeQuery.sql}`));
        }
        seq++;
        const sentinel = `__SENTINEL_${name}_${seq}__`;

        const timer = setTimeout(() => {
          if (activeQuery && activeQuery.id === seq) {
            const q = activeQuery;
            activeQuery = null;
            q.reject(new Error(`PsqlSession [${name}] query timed out after ${timeoutMs}ms: ${sql}`));
          }
        }, timeoutMs);

        activeQuery = {
          id: seq,
          sql,
          sentinel,
          timer,
          queryStderr: '',
          resolve,
          reject
        };

        child.stdin.write(`${sql.trim()};\n\\echo ${sentinel}\n`);
      });
    },
    async close() {
      if (isClosed) return;
      isClosed = true;
      if (activeQuery) {
        const q = activeQuery;
        activeQuery = null;
        if (q.timer) clearTimeout(q.timer);
        q.reject(new Error(`PsqlSession [${name}] closed while query was active: ${q.sql}`));
      }
      try {
        child.stdin.write('\\q\n');
        child.stdin.end();
      } catch {}
      await new Promise((resolve) => {
        const t = setTimeout(() => {
          try { child.kill('SIGKILL'); } catch {}
          resolve();
        }, 1500);
        child.on('close', () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  };
};

const waitForCondition = async (fn, desc = 'condition', timeoutMs = 8000) => {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timeout after ${timeoutMs}ms waiting for: ${desc}`);
    await new Promise(r => setTimeout(r, 20));
  }
};
const status = process.env.SUPABASE_TEST_ANON_KEY && process.env.SUPABASE_TEST_SERVICE_KEY
  ? ''
  : execFileSync('supabase', ['status', '-o', 'env'], {
    cwd: process.env.SUPABASE_TEST_WORKDIR, encoding: 'utf8'
  });
const env = Object.fromEntries(status.split(/\r?\n/).map(line => {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  return match ? [match[1], match[2].replace(/^["']|["']$/g, '')] : [];
}).filter(([key]) => key));
const anonKey = process.env.SUPABASE_TEST_ANON_KEY ?? env.ANON_KEY ?? env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY ?? env.SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(anonKey && serviceKey, 'Local Supabase keys missing from CLI status');
const base = process.env.SUPABASE_TEST_API_URL ?? 'http://127.0.0.1:54321';
const testTag = randomBytes(2).toString('hex').toUpperCase();
const m37 = `M37${testTag}`;
const testUuidPrefix = `37000000-${testTag.toLowerCase()}-4000-8000`;
const request = async (path, key, token, method = 'GET', body, extraHeaders = {}) => {
  const response = await fetch(base + path, {
    method,
    headers: {
      apikey: key, Authorization: `Bearer ${token ?? key}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let data;
  try { data = await response.json(); } catch { data = null; }
  return { status: response.status, data };
};
const users = [];
for (let i = 1; i <= 4; i++) {
  const email = `m37p${i}-${randomBytes(8).toString('hex')}@example.test`;
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
const fixtureSql = readFileSync('scripts/m37-functional-fixtures.sql', 'utf8')
  .replaceAll('M37', m37)
  .replaceAll('37000000-0000-4000-8000', testUuidPrefix);
execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1',
  '-v', `user1=${users[0].id}`, '-v', `user2=${users[1].id}`, '-v', `user3=${users[2].id}`, '-v', `user4=${users[3].id}`, '-f', '-'
], { input: fixtureSql, stdio: ['pipe', 'pipe', 'pipe'] });
console.log('Privileged synthetic fixture setup completed.');
assert.equal(pg(`SELECT count(*) FROM public.profiles WHERE role='promotor' AND status='ativo' AND promotor_matricula IN ('${m37}P1','${m37}P2','${m37}P3','${m37}P4')`), '4');

const assertTestClockMatchesDatabase = () => {
  if (process.env.MK9_TEST_CLOCK_SOURCE !== 'runner-host') return;
  const databaseNowMs = Number(pg('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint'));
  assert.ok(Math.abs(Date.now() - databaseNowMs) <= 120_000,
    'JavaScript and disposable PostgreSQL test clocks differ by more than two minutes');
  const databaseToday = pg("SELECT (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date::text");
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const part = type => parts.find(item => item.type === type).value;
  const javascriptToday = `${part('year')}-${part('month')}-${part('day')}`;
  assert.equal(databaseToday, javascriptToday,
    'JavaScript and disposable PostgreSQL do not share the same Sao Paulo test date');
};
assertTestClockMatchesDatabase();

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
// Caso especial de segunda-feira: em segundas-feiras (início da semana operacional), não existe dia anterior
// elegível para recuperação dentro da mesma semana por definição da regra de negócio semanal [segunda..domingo].
// A validação completa dos 32 cenários funcionais de recuperação exige execução entre terça e domingo.
assert.ok(yesterday >= weekStart, 'No earlier date in current week (Monday execution cannot test intra-week recovery); execution must run Tuesday through Sunday');
const previousWeek = new Date(weekStart.getTime() - 86400000);
const route = n => `${testUuidPrefix}-${String(n).padStart(12, '0')}`;
const visit = n => `${testUuidPrefix}-${String(n).padStart(12, '0')}`;
const count = (table, where = 'true') => Number(pg(`SELECT count(*) FROM public.${table} WHERE ${where}`));
const snapshot = () => pg(`SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM public.visits v
  WHERE v.id IN ('${visit(101)}','${visit(102)}')`);
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
await denied('missing industry', () => checkin(users[0], `${m37}L1`, `${m37}MISSING`, route(1)), '42501');
await denied('other promoter route', () => scheduled(users[1], 1, yesterday), '42501');
await denied('completed visit', () => scheduled(users[0], 6, yesterday), '23505');
await denied('regularized visit', () => scheduled(users[0], 7, yesterday), '23505');
await denied('visit with checklist evidence', () => scheduled(users[3], 12, yesterday), '23505');
await denied('visit with product validity evidence', () => scheduled(users[3], 15, yesterday), '23505');
const priorCheckinRetry = await scheduled(users[3], 13, yesterday);
assert.equal(priorCheckinRetry.status, 200,
  `Expired visit recovery failed: ${priorCheckinRetry.data?.code ?? priorCheckinRetry.status} - ${priorCheckinRetry.data?.message ?? ''}`);
assert.equal(priorCheckinRetry.data?.attempt_number, 2);
assert.equal(priorCheckinRetry.data?.occurrence_root_visit_id, visit(106));
assert.equal(pg(`SELECT status FROM public.visits WHERE id='${visit(106)}'`), 'nao_realizada');
assert.equal(count('visit_lifecycle_audit', `visit_id='${visit(106)}' AND action='auto_closed_at_day_end'`), 1);
pg(`UPDATE public.visits SET status='concluida', completed_at=clock_timestamp() WHERE id='${priorCheckinRetry.data.id}'`);
console.log('PASS prior check-in is auto-closed and recovered as a linked attempt'); cases++;
await denied('route-less check-in with closed route', () => checkin(users[0], `${m37}L2`,`${m37}IA`), '42501');

// ==============================================================================
// TESTES DE CONCORRÊNCIA REAL COM COORDENAÇÃO DE CONEXÕES PERSISTENTES
// ==============================================================================

// Ordem A — Inativação primeiro:
// Conexão administrativa (adminA) inicia transação e inativa indústria M37IC1, mantendo transação aberta.
// Conexão do promotor (promoterA) tenta attendance_start_scheduled_occurrence e é bloqueada pelo PostgreSQL.
// Comprovação formal via pg_blocking_pids e pg_locks do lock contention real entre as sessões.
// Conclusão da inativação via COMMIT em adminA.
// promoterA é desbloqueado e aborta com 42501 (indústria inativa).
// NOTA: O uso de SET LOCAL ROLE authenticated e claim de sub no promoterA simula o contexto
// de autorização diretamente no banco PostgreSQL; testes HTTP reais adicionais cobrem o GoTrue.
const adminA = createPsqlSession('adminA');
const promoterA = createPsqlSession('promoterA');

try {
  const adminPid = await adminA.init();
  const promoterPid = await promoterA.init();
  assert.ok(adminPid !== promoterPid, 'Independent PostgreSQL sessions required for Ordem A');

  // 1. Sessão administrativa inicia transação e inativa a indústria M37IC1
  await adminA.query('BEGIN;');
  await adminA.query(`UPDATE public.industrias SET status = 'inativo' WHERE codigo = '${m37}IC1';`);

  // 2. Sessão do promotor inicia transação autenticada e tenta atendimento
  await promoterA.query('BEGIN;');
  await promoterA.query('SET LOCAL ROLE authenticated;');
  await promoterA.query(`SET LOCAL "request.jwt.claim.sub" = '${users[0].id}';`);

  // Disparo assíncrono do check-in que entrará em lock wait no PostgreSQL
  const promoterPromise = promoterA.query(`
    SELECT public.attendance_start_scheduled_occurrence(
      '${route(17)}'::uuid,
      '${iso(yesterday)}'::date,
      'recover'
    );
  `);

  // 3. Sincronização explícita e verificação formal no catálogo do PostgreSQL:
  // Verifica que promoterA está com lock não concedido (NOT granted) especificamente bloqueado por adminA
  await waitForCondition(() => {
    const blockers = pg(`SELECT pg_blocking_pids(${promoterPid})::text`);
    return blockers.includes(String(adminPid));
  }, `promoterA (${promoterPid}) blocked by adminA (${adminPid}) in pg_blocking_pids`, 8000);

  const waitingLocks = pg(`
    SELECT count(*) FROM pg_locks
    WHERE pid = ${promoterPid} AND NOT granted
  `);
  assert.ok(Number(waitingLocks) > 0, 'promoterA must have ungranted lock in pg_locks');

  // 4. Conclui a inativação na sessão administrativa
  await adminA.query('COMMIT;');

  // 5. promoterA é liberado e aborta com erro 42501
  let promoterError = null;
  try {
    await promoterPromise;
  } catch (err) {
    promoterError = err;
  }
  assert.ok(promoterError, 'promoterA must reject with error');
  assert.equal(promoterError.sqlstate, '42501', 'promoterA must reject with SQLSTATE 42501');
  assert.match(promoterError.stderr || promoterError.message, /Industry is not active or does not exist/, 'promoterA error message');
  assert.match(promoterA.stderr, /Industry is not active or does not exist|42501/, 'promoterA must reject with 42501');
  await promoterA.query('ROLLBACK;');

  // 6. Verificações do estado final:
  assert.equal(count('visits', `rota_id='${route(17)}'`), 0, 'Ordem A: zero visits created');
  assert.equal(count('visit_schedule_actions', `route_id='${route(17)}'`), 0, 'Ordem A: zero audit actions created');
  assert.equal(pg(`SELECT status FROM public.industrias WHERE codigo = '${m37}IC1'`), 'inativo', 'Ordem A: industry must be inactive');

  console.log('PASS Ordem A (inativação primeiro): pg_blocking_pids comprovou bloqueio mútuo, check-in abortou com 42501, zero visitas');
  cases++;
} finally {
  await adminA.close();
  await promoterA.close();
}

// Ordem B — Check-in primeiro:
// Conexão do promotor (promoterB) inicia transação, autentica e executa attendance_start_scheduled_occurrence,
// mantendo a transação aberta e segurando o lock FOR SHARE na linha da indústria M37IC2.
// Conexão administrativa (adminB) tenta inativar M37IC2 e entra em lock wait no PostgreSQL.
// Comprovação formal via pg_blocking_pids e pg_locks.
// promoterB comita a transação (gravando a visita e a auditoria).
// adminB é desbloqueado e conclui a inativação.
// Chamada subsequente via HTTP REST GoTrue na indústria agora inativa é barrada com 42501.
const promoterB = createPsqlSession('promoterB');
const adminB = createPsqlSession('adminB');

try {
  const promoterPid = await promoterB.init();
  const adminPid = await adminB.init();
  assert.ok(promoterPid !== adminPid, 'Independent PostgreSQL sessions required for Ordem B');

  // 1. Sessão do promotor inicia transação autenticada e executa recuperação
  await promoterB.query('BEGIN;');
  await promoterB.query('SET LOCAL ROLE authenticated;');
  await promoterB.query(`SET LOCAL "request.jwt.claim.sub" = '${users[0].id}';`);

  const visitExec = await promoterB.query(`
    SELECT public.attendance_start_scheduled_occurrence(
      '${route(18)}'::uuid,
      '${iso(yesterday)}'::date,
      'recover'
    );
  `);
  assert.ok(visitExec.length > 0, 'promoterB: attendance_start_scheduled_occurrence must succeed');
  // Transação permanece ABERTA! O lock FOR SHARE na indústria M37IC2 está ativo.

  // 2. Sessão administrativa tenta inativar a indústria M37IC2
  const adminPromise = adminB.query(`UPDATE public.industrias SET status = 'inativo' WHERE codigo = '${m37}IC2';`);

  // 3. Sincronização explícita e verificação formal no catálogo do PostgreSQL:
  await waitForCondition(() => {
    const blockers = pg(`SELECT pg_blocking_pids(${adminPid})::text`);
    return blockers.includes(String(promoterPid));
  }, `adminB (${adminPid}) blocked by promoterB (${promoterPid}) in pg_blocking_pids`, 8000);

  const adminWaiting = pg(`
    SELECT count(*) FROM pg_locks
    WHERE pid = ${adminPid} AND NOT granted
  `);
  assert.ok(Number(adminWaiting) > 0, 'adminB must be waiting on ungranted lock in pg_locks');

  // 4. promoterB conclui a transação com sucesso (COMMIT)
  await promoterB.query('COMMIT;');

  // 5. adminB é desbloqueado e completa o UPDATE
  await adminPromise;

  // 6. Verificações do estado final:
  assert.equal(count('visits', `rota_id='${route(18)}' AND scheduled_date='${iso(yesterday)}'`), 1, 'Ordem B: visita deve existir');
  assert.equal(count('visit_schedule_actions', `route_id='${route(18)}' AND scheduled_date='${iso(yesterday)}'`), 1, 'Ordem B: auditoria deve existir');
  assert.equal(pg(`SELECT status FROM public.industrias WHERE codigo = '${m37}IC2'`), 'inativo', 'Ordem B: indústria deve estar inativa');

  // 7. Chamada HTTP REST real pós-inativação comprova que novas operações são rejeitadas
  const postInactivationCheckin = await scheduled(users[0], 18, yesterday);
  assert.ok(postInactivationCheckin.status >= 400, 'Ordem B: subsequent check-in must be rejected');
  assert.equal(postInactivationCheckin.data?.code, '42501', 'Ordem B: subsequent check-in code 42501');

  // Conclui a visita da rota 18 para restaurar o estado operacional do promotor para os próximos cenários
  pg(`UPDATE public.visits SET status = 'concluida', completed_at = clock_timestamp() WHERE rota_id = '${route(18)}' AND status = 'em_andamento'`);

  console.log('PASS Ordem B (check-in primeiro): pg_blocking_pids comprovou serialização, visita gravada, indústria inativada, subsequente rejeitado (42501)');
  cases++;
} finally {
  await promoterB.close();
  await adminB.close();
}

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
assert.equal(recovered.status, 200, `Recovery failed: ${recovered.data?.code ?? recovered.status} - ${recovered.data?.message ?? ''}`);
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

const repeatCheckin = await checkin(users[0], `${m37}L1`,`${m37}IA`,route(1));
assert.equal(repeatCheckin.status, 200, `Repeat check-in failed: ${repeatCheckin.data?.code ?? repeatCheckin.status} - ${repeatCheckin.data?.message ?? ''}`);
assert.equal(repeatCheckin.data?.id, recovered.data?.id);
assert.equal(count('visits', `rota_id='${route(1)}' AND scheduled_date='${iso(yesterday)}'`), 1);
console.log('PASS active-route check-in reused same in-progress visit'); cases++;

const routeLess = await checkin(users[1], `${m37}L8`,`${m37}IA`);
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
// Conclui a visita da rota 9 para restaurar o estado operacional do promotor para os próximos cenários
pg(`UPDATE public.visits SET status = 'concluida', completed_at = clock_timestamp() WHERE rota_id = '${route(9)}' AND status = 'em_andamento'`);
console.log('PASS concurrent independent authenticated requests: one visit and action'); cases++;

assert.equal(snapshot(), historyBefore, 'Unrelated historical visits changed');
console.log('PASS unrelated historical visits unchanged'); cases++;

const pendingRecovery = await scheduled(users[3], 10, yesterday);
assert.equal(pendingRecovery.status, 200,
  `Materialized pending recovery failed: ${pendingRecovery.data?.code ?? pendingRecovery.status} - ${pendingRecovery.data?.message ?? ''}`);
assert.equal(pendingRecovery.data?.scheduled_date, iso(yesterday));
assert.equal(pendingRecovery.data?.data_visita, iso(today));
assert.equal(pendingRecovery.data?.id, visit(103));
assert.equal(count('visits', `rota_id='${route(10)}'`), 1);
assert.equal(count('visit_schedule_actions', `route_id='${route(10)}' AND scheduled_date='${iso(yesterday)}'`), 1);
console.log('PASS materialized pending visit recovery'); cases++;

const directPatchOwn = await request(`/rest/v1/visits?id=eq.${visit(104)}`,
  anonKey, users[3].token, 'PATCH', { data_visita: iso(today) });
assert.ok(directPatchOwn.status >= 400, 'Direct PATCH on data_visita unexpectedly accepted');
assert.equal(directPatchOwn.data?.code, '42501');
console.log('PASS direct promoter update of data_visita blocked (42501)'); cases++;

const directPatchOther = await request(`/rest/v1/visits?id=eq.${visit(104)}`,
  anonKey, users[0].token, 'PATCH', { data_visita: iso(today) }, { Prefer: 'return=representation' });
// A política RLS (visits_update_policy) filtra a linha no WHERE implícito do UPDATE:
// O PostgREST retorna 200 com array vazio (zero linhas afetadas) ou erro >= 400.
if (directPatchOther.status < 400) {
  assert.deepEqual(directPatchOther.data, [], 'Other promoter PATCH affected rows via RLS');
}
const visit104After = pg(`SELECT data_visita FROM public.visits WHERE id = '${visit(104)}'`);
assert.equal(visit104After, iso(yesterday), 'Visit date was illegally modified by other promoter');
console.log('PASS direct update of another promoter visit blocked'); cases++;

// Conclui a visita da rota 10 para restaurar o estado operacional do promotor antes da próxima recuperação
pg(`UPDATE public.visits SET status = 'concluida', completed_at = clock_timestamp() WHERE rota_id = '${route(10)}' AND status = 'em_andamento'`);

const unperformedRecovery = await scheduled(users[3], 11, yesterday);
assert.equal(unperformedRecovery.status, 200,
  `Materialized unperformed recovery failed: ${unperformedRecovery.data?.code ?? unperformedRecovery.status} - ${unperformedRecovery.data?.message ?? ''}`);
assert.equal(unperformedRecovery.data?.scheduled_date, iso(yesterday));
assert.equal(unperformedRecovery.data?.data_visita, iso(today));
assert.equal(unperformedRecovery.data?.id, visit(104));
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
