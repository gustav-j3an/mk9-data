import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const directory = new URL('../homologation/rh/', import.meta.url);
const { url, key } = JSON.parse(readFileSync(new URL('.env.backend.json', directory), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(url, 'http://127.0.0.1:55321');
const backend = 'http://127.0.0.1:55300';
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  assert.ok([url, backend].includes(new URL(String(input)).origin), 'Nonlocal request blocked');
  return nativeFetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(10000) });
};
const db = sql => execFileSync('docker', ['exec','-i','supabase_db_mk9-rh-homolog','psql','-X','-q','-A','-t','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim();
const report = { environment: 'mk9-rh-homolog', at: new Date().toISOString(), checks: [] };
let phase = 'startup';
const check = (name, fn) => { fn(); report.checks.push(name); console.log('PASS '+name); };
async function request(path, token, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch((path.startsWith('/api/') || path === '/health' ? backend : url) + path, {
    method, headers: { apikey: key, ...(token ? { Authorization: 'Bearer '+token } : {}), 'Content-Type':'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}
try {
  const sources = JSON.parse(readFileSync(new URL('sources.json', directory), 'utf8'));
  check('Canonical migration sources unchanged', () => {
    for (const source of sources) assert.equal(createHash('sha256').update(readFileSync(new URL('../'+source.file, new URL('../', directory)))).digest('hex'), source.sha256);
    assert.equal(readFileSync(new URL('supabase/migrations/20261019155012_rh_explicit_bindings.sql', directory), 'utf8'), readFileSync(new URL('../supabase/migrations/20261019151754_mk9_rh_explicit_bindings.sql', new URL('../', directory)), 'utf8'));
  });
  const health = await request('/health');
  check('Backend local only; external API disabled', () => { assert.equal(health.data.supabase, url); assert.equal(health.data.externalApiEnabled, false); assert.equal(health.data.blockedRequests, 0); });
  const sqlFacts = JSON.parse(db(`SELECT json_build_object('database',current_database(),'migrations',(SELECT count(*) FROM supabase_migrations.schema_migrations),'rh_tables',(SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('mk9_identidades','mk9_alocacoes','mk9_acessos') AND relrowsecurity AND relforcerowsecurity),'deny_policies',(SELECT count(*) FROM pg_policies WHERE tablename IN ('mk9_identidades','mk9_alocacoes','mk9_acessos') AND permissive='RESTRICTIVE'),'anon_rpc',has_function_privilege('anon','public.mk9_rh_scope(text)','EXECUTE'),'authenticated_rpc',has_function_privilege('authenticated','public.mk9_rh_scope(text)','EXECUTE'),'table_grants',(SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name LIKE 'mk9_%' AND grantee IN ('anon','authenticated','PUBLIC')));`));
  check('Three RH tables: forced RLS, restrictive policies and no direct grants; RPC authenticated only', () => { assert.equal(sqlFacts.database,'postgres'); assert.equal(sqlFacts.migrations,2); assert.equal(sqlFacts.rh_tables,3); assert.equal(sqlFacts.deny_policies,3); assert.equal(sqlFacts.anon_rpc,false); assert.equal(sqlFacts.authenticated_rpc,true); assert.equal(sqlFacts.table_grants,0); });
  const accountFile = new URL('.env.synthetic-accounts.json', directory);
  const accounts = existsSync(accountFile) ? JSON.parse(readFileSync(accountFile, 'utf8')) : ['mine','team','management','ungranted'].map(name => ({name,email:`rh-${name}@homolog.invalid`,password: randomBytes(24).toString('base64url')}));
  if (!existsSync(accountFile)) writeFileSync(accountFile, JSON.stringify(accounts), { mode: 0o600 });
  for (const account of accounts) {
    let login = await request('/auth/v1/token?grant_type=password', null, {email:account.email,password:account.password});
    if (login.status !== 200) {
      const signup = await request('/auth/v1/signup', null, {email:account.email,password:account.password,data:{full_name:'SINTETICO RH '+account.name,role:'admin'}});
      assert.equal(signup.status,200,'Synthetic signup failed');
      assert.equal(db(`SELECT role FROM profiles WHERE id='${signup.data.user.id}';`),'operador','Signup must ignore role metadata');
      login = await request('/auth/v1/token?grant_type=password', null, {email:account.email,password:account.password});
    }
    assert.equal(login.status,200,'Local password authentication failed');
    account.token=login.data.access_token; account.id=login.data.user.id;
    const user = await request('/auth/v1/user',account.token);
    assert.equal(user.data.id,account.id);
  }
  check('Real local Auth password login and getUser; new signups ignore role metadata', () => assert.equal(accounts.length,4));
  const [mine,team,management,ungranted] = accounts;
  // Only synthetic rows, no route/team/supervisor changes. No external API invocation.
  db(`BEGIN;
    UPDATE profiles SET role='admin' WHERE id IN ('${management.id}','${ungranted.id}');
    INSERT INTO promotores(id,matricula,nome,cidade,uf) VALUES
     ('00000000-0000-4000-8000-000000000101','QA-RH-A','SINTETICO A','Cidade teste','GO'),
     ('00000000-0000-4000-8000-000000000102','QA-RH-B','SINTETICO B','Cidade teste','GO'),
     ('00000000-0000-4000-8000-000000000103','QA-RH-C','SINTETICO C','Cidade teste','MT') ON CONFLICT DO NOTHING;
    INSERT INTO mk9_identidades(promotor_id,usuario_id,estado,aprovado_por,aprovado_em,referencia) VALUES
     ('00000000-0000-4000-8000-000000000101','${mine.id}','aprovado','${management.id}',now(),'SOMENTE SINTETICO LOCAL'),
     ('00000000-0000-4000-8000-000000000102',NULL,'aprovado','${management.id}',now(),'SOMENTE SINTETICO LOCAL'),
     ('00000000-0000-4000-8000-000000000103',NULL,'aprovado','${management.id}',now(),'SOMENTE SINTETICO LOCAL') ON CONFLICT DO NOTHING;
    INSERT INTO mk9_alocacoes(id,promotor_id,projeto_externo_id,matricula_externa,ocorrencias_desde,valido_desde,estado,aprovado_por,aprovado_em,referencia) VALUES
     ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000101','65f7e80f-f615-4ceb-9b8d-80db170735dc','EXTERNA-QA-A','2026-01-01',now()-interval '1 day','aprovado','${management.id}',now(),'SOMENTE SINTETICO LOCAL'),
     ('00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000102','65f7e80f-f615-4ceb-9b8d-80db170735dc','EXTERNA-QA-B','2026-01-01',now()-interval '1 day','aprovado','${management.id}',now(),'SOMENTE SINTETICO LOCAL'),
     ('00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000103','89bccfec-5f8e-4925-8702-6af0d984d5bf','EXTERNA-QA-C','2026-01-01',now()-interval '1 day','aprovado','${management.id}',now(),'SOMENTE SINTETICO LOCAL') ON CONFLICT DO NOTHING;
    INSERT INTO mk9_acessos(usuario_id,alocacao_id,tipo,estado,valido_desde,aprovado_por,aprovado_em,referencia) VALUES
     ('${team.id}','00000000-0000-4000-8000-000000000201','supervisao','aprovado',now()-interval '1 day','${management.id}',now(),'SOMENTE SINTETICO LOCAL'),
     ('${management.id}','00000000-0000-4000-8000-000000000201','gestao','aprovado',now()-interval '1 day','${management.id}',now(),'SOMENTE SINTETICO LOCAL') ON CONFLICT DO NOTHING;
    COMMIT;`);
  for (const account of accounts) {
    for (const view of ['mine','team','management']) {
      const result = await request('/rest/v1/rpc/mk9_rh_scope',account.token,{p_view:view});
      check(`RPC ${account.name}/${view}: explicit allocation only`, () => { assert.equal(result.status,200); assert.equal(result.data.length, account.name===view?1:0); if(result.data.length) { assert.equal(result.data[0].matricula_local,'QA-RH-A'); assert.equal(result.data[0].matricula_externa,'EXTERNA-QA-A'); assert.equal(result.data[0].alocacao_id,'00000000-0000-4000-8000-000000000201'); } });
    }
    const capabilities=await request('/api/rh/acessos',account.token);
    check(`Backend capabilities ${account.name}`,()=>{ assert.equal(capabilities.status,200); assert.deepEqual(capabilities.data,{mine:account.name==='mine',team:account.name==='team',management:account.name==='management'}); });
    for(const table of ['mk9_identidades','mk9_alocacoes','mk9_acessos']) {
      for(const method of ['GET','POST','PATCH','DELETE']) {
        phase=`REST ${account.name}/${table}/${method}`;
        const filter=table==='mk9_identidades'?'promotor_id=eq.00000000-0000-4000-8000-000000000101':'id=eq.00000000-0000-4000-8000-000000000201';
        const result=await request('/rest/v1/'+table+(method==='DELETE'||method==='PATCH'?'?'+filter:''),account.token,['POST','PATCH'].includes(method)?{}:undefined,method);
        phase+=` status=${result.status}`;
        assert.ok([401,403].includes(result.status),`${account.name}/${table}/${method}: direct access must be denied`);
      }
    }
  }
  check('REST denies SELECT/INSERT/UPDATE/DELETE for all three RH tables, including operational admin',()=>{});
  check('RLS denies rows and writes even with temporary table grants (rollback)',()=>assert.equal(db(`BEGIN;
    GRANT SELECT,INSERT,UPDATE,DELETE ON mk9_identidades,mk9_alocacoes,mk9_acessos TO authenticated;
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims','{"sub":"${management.id}","role":"authenticated"}',true) IS NOT NULL;
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM public.mk9_identidades) OR EXISTS(SELECT 1 FROM public.mk9_alocacoes) OR EXISTS(SELECT 1 FROM public.mk9_acessos) THEN RAISE EXCEPTION 'RLS leak'; END IF;
      UPDATE public.mk9_acessos SET referencia='RLS write should see no rows';
      IF FOUND THEN RAISE EXCEPTION 'RLS update leak'; END IF;
      DELETE FROM public.mk9_acessos;
      IF FOUND THEN RAISE EXCEPTION 'RLS delete leak'; END IF;
      BEGIN
        INSERT INTO public.mk9_identidades(promotor_id,referencia) VALUES('00000000-0000-4000-8000-000000000101','RLS TEST');
        RAISE EXCEPTION 'RLS insert leak';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;
    SELECT 'rls-denied'; ROLLBACK;`).split('\n').at(-1),'rls-denied'));
  const anon=await request('/rest/v1/rpc/mk9_rh_scope',null,{p_view:'mine'});
  check('Anonymous RPC denied',()=>assert.ok([401,403].includes(anon.status)));
  const paths={mine:'/api/rh/minhas-ausencias',team:'/api/rh/equipe/ausencias',management:'/api/rh/gestao/ausencias'};
  for(const [view,path] of Object.entries(paths)) {
    const unauth=await request(path+'?data_inicio=2026-10-01&data_fim=2026-10-19');
    assert.equal(unauth.status,401);
    for(const account of accounts) {
      const response=await request(path+'?data_inicio=2026-10-01&data_fim=2026-10-19',account.token);
      check(`Route ${view}/${account.name}`,()=>assert.equal(response.status,account.name===view?503:403));
    }
    const injection=await request(path+'?data_inicio=2026-10-01&data_fim=2026-10-19&matricula=EXTERNA-QA-B',accounts.find(a=>a.name===view).token);
    assert.equal(injection.status,400);
  }
  // A transaction tests revocation under an authenticated role, then restores synthetic grants.
  check('Immediate revocation removes supervisor scope (rollback)',()=>assert.equal(db(`BEGIN; UPDATE mk9_acessos SET estado='revogado' WHERE usuario_id='${team.id}'; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"${team.id}","role":"authenticated"}',true) IS NOT NULL; SELECT count(*) FROM public.mk9_rh_scope('team'); ROLLBACK;`).split('\n').at(-1),'0'));
  const finalHealth=await request('/health');
  check('No external request attempted; routes and teams remain empty',()=>{ assert.equal(finalHealth.data.blockedRequests,0); assert.equal(db('SELECT count(*) FROM rotas;'),'0'); });
  report.result='passed';
  writeFileSync(new URL('verification.json',directory),JSON.stringify(report,null,2)+'\n');
  console.log(`PASS ${report.checks.length} local environment checks. External API was not invoked.`);
} catch {
  // Do not emit HTTP bodies, account data, tokens or raw child-process errors.
  report.result='failed';
  writeFileSync(new URL('verification.json',directory),JSON.stringify(report,null,2)+'\n');
  console.error('Local RH verification failed at '+phase+' after: '+(report.checks.at(-1)||'startup')+'. Inspect the corresponding local check without printing credentials.');
  process.exitCode=1;
}
