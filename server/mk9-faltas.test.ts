import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rhHandler } from './rh-handler.ts';
import rhAccessHandler from './rh-access-handler.ts';
import { normalizeAbsence, queryMk9, queryMk9Window } from './mk9-faltas.ts';
import { validateAllocations, type RhAllocation, type RhView } from './rh-authorization.ts';
import { friendlyStatus } from '../shared/mk9.ts';
const GO = '65f7e80f-f615-4ceb-9b8d-80db170735dc';
const MT = '89bccfec-5f8e-4925-8702-6af0d984d5bf';
const id = (n: number) => `30000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const allocation = (n = 1, project = GO, external = '0000042', person = 1): RhAllocation => ({ alocacao_id: id(n), promotor_id: id(person+100), matricula_local: `PRM-${person}`, nome_local: `Pessoa ${person}`, projeto_id: project, matricula_externa: external, ocorrencias_desde: '2026-10-01', ocorrencias_ate: null, supervisor_nome: 'Responsável sintético RH', promotor_ativo: true, versao: '1:approved' });
const row = (a = allocation(), protocol = 'KNOWN-1') => ({ id: protocol, protocolo: protocol, colaborador: { matricula: a.matricula_externa, nome: 'External name' }, projeto: { id: a.projeto_id, nome: a.projeto_id === GO ? 'COMPARTILHADO GO' : 'COMPARTILHADO MT' }, tipo: { categoria: 'FALTA' }, periodo: { inicio: '2026-10-18', fim: '2026-10-18', dias: 1 }, status: 'PENDENTE', cid: 'PRIVATE_CID', documento: 'PRIVATE_DOCUMENT', observacoes: 'PRIVATE_NOTES' });

test('Explicit allocation validation rejects duplicate external identities, malformed dates and truncated scopes', () => {
  assert.equal(validateAllocations([allocation()]).length, 1);
  assert.throws(() => validateAllocations([allocation(), { ...allocation(2), promotor_id: id(222) }]));
  assert.throws(() => validateAllocations([{ ...allocation(), ocorrencias_desde: '2026-02-30' }]));
  assert.throws(() => validateAllocations(Array(500).fill(allocation())));
});
test('Projection strips medical fields, tolerates optional fields and maps unknown statuses', () => {
  const normalized = normalizeAbsence(row())!;
  assert.equal(normalized.retorno, null);
  assert.ok(!JSON.stringify(normalized).includes('PRIVATE_'));
  assert.equal(normalizeAbsence({}), null);
  assert.equal(friendlyStatus('FUTURE'), 'Em processamento');
  assert.equal(friendlyStatus('PENDENTE'), 'Em análise');
  assert.equal(friendlyStatus('PENDENTE','PROCESSADO'), 'Processado');
  assert.equal(friendlyStatus('REJEITADO'), 'Necessita atenção');
  assert.equal(friendlyStatus('CANCELADO','PROCESSADO'), 'Cancelado');
});
test('Missing/invalid credentials, malformed response and network failure are isolated', async () => {
  await assert.rejects(queryMk9({}, {}, async () => { throw new Error('must not call'); }));
  const env = { MK9_FALTAS_API_KEY: 'synthetic-invalid' };
  await assert.rejects(queryMk9({}, env, async () => new Response('',{status:401})));
  await assert.rejects(queryMk9({}, env, async () => { throw new Error('sensitive error'); }));
  await assert.rejects(queryMk9({}, env, async () => Response.json({ok:true,data:[{}]})));
});
test('Slow provider is aborted by timeout', async () => {
  let aborted = false;
  await assert.rejects(queryMk9({}, {MK9_FALTAS_API_KEY:'synthetic-timeout'}, async (_, init) => new Promise((_,reject) => {
    init!.signal!.addEventListener('abort', () => {aborted=true;reject(new Error('aborted'));},{once:true});
  })));
  assert.equal(aborted,true);
});
test('Date pagination retains the approved pair, deduplicates spanning records and refuses saturated single days', async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url.search);
    assert.equal(url.searchParams.get('projeto_id'),GO); assert.equal(url.searchParams.get('matricula'),'0000042');
    assert.equal((init!.headers as any).Authorization,'Bearer synthetic-pagination');
    if (url.searchParams.get('data_inicio') !== url.searchParams.get('data_fim')) return Response.json({ok:true,data:Array(100).fill(row())});
    return Response.json({ok:true,data:[row()],meta:{count:1,limit:100}});
  };
  const result = await queryMk9Window({projeto_id:GO,matricula:'0000042',data_inicio:'2026-10-18',data_fim:'2026-10-19'},{deadline:Date.now()+10_000,requests:0},45_000,{MK9_FALTAS_API_KEY:'synthetic-pagination'},fetcher);
  assert.equal(calls.length,3);assert.equal(result.data.length,1);
  await assert.rejects(queryMk9Window({projeto_id:GO,matricula:'0000042',data_inicio:'2026-10-18',data_fim:'2026-10-18'},{deadline:Date.now()+10_000,requests:0},45_000,{MK9_FALTAS_API_KEY:'synthetic-saturated'},async () => Response.json({ok:true,data:Array(100).fill(row())})));
});

test('Actual route handlers enforce RH capabilities independently of operational roles and cached data', async t => {
  const savedEnv = {...process.env};
  process.env.SUPABASE_URL='https://application.invalid';process.env.SUPABASE_PUBLISHABLE_KEY='synthetic-public';
  process.env.MK9_FALTAS_API_URL='https://provider.invalid';process.env.MK9_FALTAS_API_KEY='synthetic-routes';
  // A former broad team map must never be used as fallback.
  process.env.MK9_FALTAS_PROJECT_TEAMS=JSON.stringify({[GO]:['EQP-001'],[MT]:['EQP-001']});
  let scopes: Record<RhView,RhAllocation[]> = {mine:[],team:[],management:[]};
  let providerCalls=0; let unavailable=false; let revokeDuring=false; let rpcError=false;
  let recordFactory = (a: RhAllocation) => [row(a)];
  t.mock.method(globalThis,'fetch',async (input: any, init: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname==='provider.invalid') {
      providerCalls++;
      if (unavailable) return new Response('',{status:503});
      const a = Object.values(scopes).flat().find(a => a.projeto_id===url.searchParams.get('projeto_id') && a.matricula_externa===url.searchParams.get('matricula'));
      assert.ok(a,'Every provider query must use an explicit approved external identity');
      const data=recordFactory(a);
      if(revokeDuring) scopes={mine:[],team:[],management:[]};
      return Response.json({ok:true,data});
    }
    assert.equal(url.hostname,'application.invalid');
    if(url.pathname==='/auth/v1/user') return Response.json({id:id(999),user_metadata:{role:'admin',promotor_matricula:'OTHER'}});
    if(url.pathname==='/rest/v1/rpc/mk9_rh_scope') {
      if(rpcError) return Response.json({message:'private database details'},{status:500});
      const view=JSON.parse(String(init.body)).p_view as RhView;
      return Response.json(scopes[view]||[]);
    }
    throw new Error('Unexpected operational table access');
  });
  async function request(view: RhView, extra='', method='GET', authenticated=true) {
    let body='';const headers:Record<string,string>={};
    const res={statusCode:0,setHeader(k:string,v:string){headers[k]=v;},end(v:string){body=v;}};
    await rhHandler(view)({method,headers:authenticated?{authorization:'Bearer synthetic-session'}:{},url:`/api/rh/test?data_inicio=2026-10-01&data_fim=2026-10-19${extra}`} as any,res as any);
    return {status:res.statusCode,json:JSON.parse(body),body,headers};
  }
  try {
    await t.test('No authenticated session or write method is accepted', async()=> {
      assert.equal((await request('mine','','GET',false)).status,401);
      assert.equal((await request('mine','','POST')).status,405);
    });
    await t.test('Unapproved, revoked or expired scope returned by DB denies, even with old team map', async()=> {
      for(const view of ['mine','team','management'] as RhView[]) assert.equal((await request(view)).status,403);
      assert.equal(providerCalls,0);
    });
    await t.test('Local and external matriculas differ; a person may have multiple projects',async()=> {
      scopes.mine=[allocation(),allocation(2,MT,'0000042')];
      const result=await request('mine');assert.equal(result.status,200);assert.equal(result.json.data.length,2);
      assert.ok(result.json.data.every((r:any)=>r.matricula==='PRM-1'));assert.equal(result.json.activePromoters,1);
      assert.equal(result.headers['Cache-Control'],'private, no-store');
      assert.ok(!result.body.includes('0000042'));assert.ok(!result.body.includes('PRIVATE_'));assert.ok(!result.body.includes('synthetic-session'));assert.ok(!result.body.includes('synthetic-routes'));assert.ok(!result.body.includes(GO));
    });
    await t.test('Same operational team does not confer project access; supervisor has partial explicit access',async()=> {
      scopes.team=[allocation(3,MT,'B-MT',2)];
      const result=await request('team');assert.equal(result.status,200);assert.equal(result.json.activePromoters,1);assert.equal(result.json.data[0].matricula,'PRM-2');
      assert.ok(!result.body.includes('PRM-1'));
    });
    await t.test('Management only receives its explicit allocation, never operational admin global scope',async()=> {
      scopes.management=[allocation()];const result=await request('management');assert.equal(result.status,200);assert.equal(result.json.data.length,1);
    });
    await t.test('Project, team, matricula and role manipulation are rejected before provider access',async()=> {
      const before=providerCalls;
      for(const query of ['&projeto_id='+MT,'&project_id='+MT,'&team_id='+id(55),'&matricula=OTHER','&role=admin','&data_inicio=2026-01-01']) assert.equal((await request('mine',query)).status,400);
      assert.equal(providerCalls,before);
    });
    await t.test('Response outside the approved project/matricula and history is discarded',async()=> {
      process.env.MK9_FALTAS_API_KEY='synthetic-outside';scopes.mine=[allocation()];
      recordFactory=a=>[row(a),row({...a,projeto_id:MT},'OTHER-PROJECT'),row({...a,matricula_externa:'OTHER'},'OTHER-PERSON'),{...row(a,'OUTSIDE-HISTORY'),periodo:{inicio:'2026-09-01',fim:'2026-10-18',dias:48}},{...row(a,'UNKNOWN-END'),periodo:{inicio:'2026-10-18',fim:null as any,dias:3}}];
      const result=await request('mine');assert.equal(result.status,200);assert.equal(result.json.data.length,1);
      recordFactory=a=>[row(a)];
    });
    await t.test('Revocation denies new reads even when provider result remains cached',async()=> {
      scopes.mine=[allocation()];const result=await request('mine');assert.equal(result.status,200);
      const before=providerCalls;scopes.mine=[];assert.equal((await request('mine')).status,403);assert.equal(providerCalls,before);
    });
    await t.test('Revocation during the provider request denies the in-flight response',async()=> {
      process.env.MK9_FALTAS_API_KEY='synthetic-race';scopes.mine=[allocation()];revokeDuring=true;
      assert.equal((await request('mine')).status,403);revokeDuring=false;
    });
    await t.test('Unavailable provider, missing credentials and missing migration stay isolated',async()=> {
      scopes.mine=[allocation()];process.env.MK9_FALTAS_API_KEY='synthetic-unavailable';unavailable=true;
      assert.equal((await request('mine')).status,503);unavailable=false;
      delete process.env.MK9_FALTAS_API_KEY;assert.equal((await request('mine')).status,503);
      process.env.MK9_FALTAS_API_KEY='synthetic-routes';rpcError=true;
      const result=await request('mine');assert.equal(result.status,503);assert.ok(!result.body.includes('database'));rpcError=false;
    });
    await t.test('Capability discovery contains booleans only and follows RH scopes',async()=> {
      scopes={mine:[],team:[allocation()],management:[]};let body='';const res={statusCode:200,setHeader(){},end(v:string){body=v;}};
      await rhAccessHandler({method:'GET',headers:{authorization:'Bearer synthetic-session'}} as any,res as any);
      assert.deepEqual(JSON.parse(body),{mine:false,team:true,management:false});
    });
  } finally { for(const key of Object.keys(process.env)) if(!(key in savedEnv)) delete process.env[key];Object.assign(process.env,savedEnv); }
});
