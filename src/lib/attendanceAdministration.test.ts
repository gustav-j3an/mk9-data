import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journeyRequest, automaticAbsenceApproved, type JourneyInput } from './attendanceAdministration';
import { buildRoster, filterRoster, parseRules, resolveSupervisor, type Promoter } from '../utils/attendanceEngine';
import { attendanceErrorMessage } from './attendanceService';

const input: JourneyInput = {matriculas:['LOCAL_A'],days:['segunda'],start:'08:00',end:'17:00',from:'2026-10-19',until:'2026-11-30',interval:'60',tolerance:'',timezone:'America/Sao_Paulo',modalidade:'CLT parcial',reason:'Configuração sintética aprovada para teste',exception:false,workUf:'SP',workCity:'Cidade sintética'};
test('individual and bulk requests preserve explicit dates, days and unconfigured tolerance',()=>{
  assert.equal(journeyRequest(input).p_tolerance,null);
  assert.deepEqual(journeyRequest({...input,matriculas:['LOCAL_A','LOCAL_B','LOCAL_A'],days:['segunda','terca']}).p_matriculas,['LOCAL_A','LOCAL_B']);
  assert.equal(journeyRequest(input).p_to,'2026-11-30');
  assert.equal(journeyRequest({...input,until:''}).p_to,null);
  assert.equal(journeyRequest(input).p_modalidade,'CLT parcial');
});
test('journey form never creates default hours or tolerances and rejects invalid periods',()=>{
  for(const changes of [{start:''},{end:''},{days:[]},{matriculas:[]},{until:'2026-10-18'},{interval:'1.5'},{tolerance:'-1'},{reason:'x'},{exception:true,days:['segunda','terca']}]) {
    assert.throws(()=>journeyRequest({...input,...changes}));
  }
  assert.doesNotThrow(()=>journeyRequest({...input,exception:true,until:input.from}));
});
test('absence automation requires explicit boolean administrative approval',()=>{
  for(const value of [null,{}, {automatic_absence_approved:false},{automatic_absence_approved:'true'}]) assert.equal(automaticAbsenceApproved(value),false);
  assert.equal(automaticAbsenceApproved({automatic_absence_approved:true}),true);
});
test('valid configured journey makes promoter eligible and updates the shared filtered population',()=>{
  const promoter:Promoter={id:'local',matricula:'LOCAL_A',nome:'Teste local',equipe:'EQ_LOCAL',supervisor:null,status:'ativo'};
  const common={promoters:[promoter],routes:[],visits:[],teams:[],supervisors:[],overrides:[],absences:[],date:'2026-10-19',now:'2026-10-19T22:00:00Z',rules:parseRules({day_close_time:'18:00',late_tolerance_minutes:10}),official:automaticAbsenceApproved({}),officialStart:'2026-10-01'};
  assert.equal(buildRoster({...common,schedules:[]})[0].eligible,false);
  const request=journeyRequest(input);
  const rows=buildRoster({...common,schedules:[{promotor_matricula:'LOCAL_A',dia_semana:request.p_days[0],hora_inicio:request.p_start,hora_fim:request.p_end,valid_from:request.p_from,valid_to:request.p_to,ativo:true}]});
  assert.equal(rows[0].eligible,true);
  assert.equal(rows[0].operationalStatus,'sem_registro');
  assert.equal(filterRoster(rows,{search:'LOCAL_A',supervisor:'',squad:'EQ_LOCAL',quick:'sem_registro'}).length,1);
});
test('canonical active team resolves supervisor without arbitrary text assignment',()=>{
  const promoter:Promoter={id:'local',matricula:'LOCAL_A',nome:'Teste',equipe:'EQ_LOCAL',supervisor:null,status:'ativo'};
  assert.equal(resolveSupervisor(promoter,[],[]),'Não atribuído');
  assert.equal(resolveSupervisor(promoter,[{codigo:'EQ_LOCAL',nome:'Equipe local',status:'ativa',supervisor_id:'sup',supervisor_nome:null}],[{id:'sup',nome:'Responsável escolhido',status:'ativo'}]),'Responsável escolhido');
});
test('diagnostics distinguish missing schema, denied permissions and query failures',()=>{
  assert.match(attendanceErrorMessage({code:'42501',message:'denied'}),/Permissão negada/);
  assert.match(attendanceErrorMessage({code:'PGRST202',message:'missing RPC'}),/migrations/);
  assert.equal(attendanceErrorMessage({code:'57014',message:'consulta interrompida'}),'consulta interrompida');
});
