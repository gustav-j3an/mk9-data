import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoster, canonicalCheckIn, exportRows, filterRoster, locationDetail, parseRules, resolveSupervisor, validDate, zoned, type Promoter, type Schedule, type Override } from './attendanceEngine';
import type { RouteItem, Visit } from '../types';

const promoter: Promoter = { id: 'p1', matricula: '001', nome: 'Ana Teste', equipe: 'Equipe A', supervisor: null, status: 'ativo' };
const route = { id: 'r1', promotor_matricula: '001', loja_codigo: 'L1', industria_codigo: 'I1', frequencia: 'SEMANAL', segunda: true } as RouteItem;
const shift: Schedule = { promotor_matricula: '001', dia_semana: 'segunda', hora_inicio: '08:00:00', hora_fim: '17:00:00', ativo: true };
const visit = { id: 'v1', promotor_matricula: '001', loja_codigo: 'L1', industria_codigo: 'I1', data_visita: '2026-10-19', status: 'em_andamento', started_at: '2026-10-19T11:00:00Z', latitude: -23.55, longitude: -46.63 } as Visit;
const base = () => ({ promoters: [promoter], routes: [route], visits: [] as Visit[], teams: [], supervisors: [], overrides: [] as Override[], schedules: [shift], absences: [], date: '2026-10-19', now: '2026-10-19T15:00:00Z', rules: parseRules({ day_close_time: '18:00', late_tolerance_minutes: 15 }), official: true, officialStart: '2026-10-01' });
const status = (changes: Partial<Parameters<typeof buildRoster>[0]> = {}) => buildRoster({ ...base(), ...changes })[0];

test('expediente com check-in real: presente e horário de São Paulo', () => {
  const item = status({ visits: [visit] });
  assert.equal(item.operationalStatus, 'presente');
  assert.equal(item.telemetryTime, '08:00');
  assert.match(item.telemetryDetail, /não validada/);
});
test('sem check-in e visita não realizada não confirmam falta durante expediente', () => {
  assert.equal(status().operationalStatus, 'sem_registro');
  assert.equal(status({ visits: [{ ...visit, started_at: null, status: 'nao_realizada' }] }).operationalStatus, 'sem_registro');
});
test('expediente futuro na data ou no mesmo dia aguarda início', () => {
  assert.equal(status({ now: '2026-10-18T15:00:00Z' }).operationalStatus, 'aguardando_expediente');
  assert.equal(status({ now: '2026-10-19T10:59:00Z' }).operationalStatus, 'aguardando_expediente');
});
test('folga aprovada e sem programação não são elegíveis', () => {
  assert.equal(status({ schedules: [], routes: [] }).operationalStatus, 'sem_expediente');
  const item = status({ absences: [{ promotor_matricula: '001', tipo: 'folga', data_inicio: '2026-10-19', data_fim: '2026-10-20', data_aprovacao: '2026-10-18' }] });
  assert.equal(item.operationalStatus, 'folga');
  assert.equal(item.eligible, false);
});
test('folga pendente não remove promotor da escala', () => {
  assert.equal(status({ absences: [{ promotor_matricula: '001', tipo: 'folga', data_inicio: '2026-10-19', data_fim: '2026-10-20', data_aprovacao: null }] }).eligible, true);
});
test('limite da tolerância: 08:15 presente e 08:16 atrasado', () => {
  assert.equal(status({ visits: [{ ...visit, started_at: '2026-10-19T11:15:00Z' }] }).operationalStatus, 'presente');
  assert.equal(status({ visits: [{ ...visit, started_at: '2026-10-19T11:16:00Z' }] }).operationalStatus, 'atrasado');
});
test('fechamento exige expediente, tolerância, operação oficial e configuração', () => {
  const now = '2026-10-19T21:00:00Z';
  assert.equal(status({ now }).operationalStatus, 'falta_confirmada');
  assert.equal(status({ now: '2026-10-19T20:59:00Z' }).operationalStatus, 'sem_registro');
  assert.equal(status({now,schedules:[]}).operationalStatus,'sem_expediente');
  for (const changes of [{ rules: parseRules(null) }, { official: false }, { officialStart: null }]) {
    assert.equal(status({ now, ...changes }).operationalStatus, 'sem_registro');
  }
});
test('regra de fechamento anterior ao fim nunca antecipa falta', () => {
  assert.equal(status({ now: '2026-10-19T19:59:00Z', rules: parseRules({ day_close_time: '12:00', late_tolerance_minutes: 15 }) }).operationalStatus, 'sem_registro');
});
test('atestados pendente/aprovado preservam telemetria original', () => {
  for (const override_status of ['atestado_pendente', 'atestado_aprovado'] as const) {
    const item = status({ visits: [visit], overrides: [{ promotor_matricula: '001', data_operacional: '2026-10-19', override_status, justification: 'Análise documentada', medical_days: 2 }] });
    assert.equal(item.operationalStatus, 'presente');
    assert.equal(item.medicalStatus, override_status==='atestado_aprovado'?'aprovado':'pendente');
    assert.equal(item.checkInAt, visit.started_at);
    assert.equal(item.telemetryTime, '08:00');
  }
});
test('sem_registro manual tem precedência e não apaga check-in', () => {
  const item = status({ visits: [visit], overrides: [{ promotor_matricula: '001', data_operacional: '2026-10-19', override_status: 'sem_registro', justification: 'Em análise', medical_days: null }] });
  assert.equal(item.operationalStatus, 'sem_registro');
  assert.equal(item.checkInAt, visit.started_at);
});
test('duplicatas e múltiplas visitas escolhem primeiro evento por instante', () => {
  const items = buildRoster({ ...base(), promoters: [promoter, promoter], visits: [{ ...visit, id: 'v2', started_at: '2026-10-19T12:00:00Z' }, visit, visit] });
  assert.equal(items.length, 1);
  assert.equal(items[0].telemetryTime, '08:00');
  assert.equal(canonicalCheckIn([{ ...visit, started_at: 'inválido' }, { ...visit, started_at: '2026-10-20T11:00:00Z' }], base().now), undefined);
});
test('sem started_at não inventa horário usando created_at nem status concluído', () => {
  assert.equal(status({ visits: [{ ...visit, started_at: null, status: 'concluida' }] }).checkInAt, null);
  assert.equal(status({ visits: [{ ...visit, started_at: null, status: 'concluida' }] }).status, 'sem_registro');
});
test('GPS ausente, parcial, inválido, capturado e validado com precisão', () => {
  assert.match(locationDetail({}), /não disponível/);
  assert.match(locationDetail({ latitude: 0 }), /inválida/);
  assert.match(locationDetail({ latitude: 100, longitude: 2 }), /inválida/);
  assert.match(locationDetail({ latitude: NaN, longitude: 2 }), /inválida/);
  const coords = { latitude: -23.55, longitude: -46.63, storeLatitude: -23.55, storeLongitude: -46.63, radius: 100 };
  assert.match(locationDetail(coords), /não validada/);
  assert.match(locationDetail({ ...coords, accuracy: 200 }), /insuficiente/);
  assert.match(locationDetail({ ...coords, accuracy: 5 }), /Localização validada/);
  assert.match(locationDetail({ ...coords, accuracy: -1 }), /inválida/);
  assert.match(locationDetail({ ...coords, latitude: -22, accuracy: 5 }), /fora da área/);
});
test('supervisor vem do vínculo estruturado e ambiguidades não atribuem alguém', () => {
  const team = { codigo: 'EQ1', nome: 'Equipe A', status: 'ativo', supervisor_id: 's1', supervisor_nome: 'Nome antigo' };
  assert.equal(resolveSupervisor(promoter, [team], [{ id: 's1', nome: 'Supervisora', status: 'ativo' }]), 'Supervisora');
  assert.equal(resolveSupervisor(promoter, [], []), 'Não atribuído');
  assert.equal(resolveSupervisor(promoter, [team, { ...team, codigo: 'EQ2' }], []), 'Vínculo de equipe ambíguo');
});
test('filtros combinados, elegibilidade e exportação compartilham as mesmas linhas', () => {
  const items = [status({ visits: [visit] }), { ...status(), id: 'p2', matricula: '002', name: 'Bia', squad: 'Outra' }];
  const filtered = filterRoster(items, { search: '001', supervisor: 'Não atribuído', squad: 'Equipe A', quick: 'presente' });
  assert.equal(filtered.length, 1);
  const rows = exportRows(filtered, '2026-10-19');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['Check-in original'], visit.started_at);
  assert.equal(filterRoster(items, { search: '', supervisor: 'Outro', squad: '', quick: 'all' }).length, 0);
  assert.equal(filterRoster([status({ routes: [], schedules: [] })], { search: '', supervisor: '', squad: '', quick: 'all' }).length, 0);
});
test('datas perto da meia-noite respeitam data operacional e offset do timestamp', () => {
  assert.equal(zoned('2026-10-20T02:59:00Z').date, '2026-10-19');
  assert.equal(zoned('2026-10-20T03:00:00Z').date, '2026-10-20');
  assert.equal(status({ visits: [{ ...visit, started_at: '2026-10-20T00:01:00-03:00' }], now: '2026-10-20T04:00:00Z' }).operationalStatus, 'atrasado');
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('2026-10-19'), true);
});
test('configuração não inventa horários, rejeita timezone/horários/tolerância inválidos', () => {
  assert.equal(parseRules(null).close, null);
  assert.equal(parseRules(null).tolerance, null);
  assert.throws(() => parseRules({ timezone: 'inexistente' }));
  assert.throws(() => parseRules({ day_close_time: '25:99' }));
  assert.throws(() => parseRules({ late_tolerance_minutes: -1 }));
});
test('expediente noturno só fecha após o fim no dia seguinte', () => {
  const schedules = [{ ...shift, hora_inicio: '22:00:00', hora_fim: '06:00:00' }];
  assert.equal(status({ schedules, now: '2026-10-20T02:00:00Z' }).operationalStatus, 'sem_registro');
  assert.equal(status({ schedules, now: '2026-10-20T08:59:00Z' }).operationalStatus, 'sem_registro');
  assert.equal(status({ schedules, now: '2026-10-20T09:00:00Z' }).operationalStatus, 'falta_confirmada');
});
test('licença médica aprovada usa indicador de atestado e não confirma falta', () => {
  const item = status({ now: '2026-10-20T15:00:00Z', absences: [{ promotor_matricula: '001', tipo: 'licenca_medica', data_inicio: '2026-10-19', data_fim: '2026-10-20', data_aprovacao: '2026-10-18' }] });
  assert.equal(item.operationalStatus, 'atestado_aprovado');
  assert.equal(item.status, 'atestado');
  assert.equal(item.eligible, true);
});
test('licença médica pendente permanece pendente e preserva evidência de check-in', () => {
  const item = status({ visits: [visit], absences: [{ promotor_matricula: '001', tipo: 'licenca_medica', data_inicio: '2026-10-19', data_fim: '2026-10-20', data_aprovacao: null }] });
  assert.equal(item.operationalStatus, 'presente');
  assert.equal(item.medicalStatus, 'pendente');
  assert.equal(item.checkInAt, visit.started_at);
});
test('visitas semanais ou quinzenais não criam uma jornada de trabalho', () => {
  const quinzenal = { ...route, frequencia: 'QUINZENAL' as const };
  const items = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'].map(date => status({ routes: [quinzenal], schedules: [], date }));
  assert.equal(items.filter(i => i.eligible).length, 0);
  assert.equal(status({ routes: [quinzenal], schedules: [], date: '2026-10-05', history: [{ ...visit, data_visita: '2026-09-28' }] }).eligible, false);
});
test('férias e afastamento aprovados têm estados próprios sem faltas',()=>{
  for(const tipo of ['ferias','afastamento']) {
    const item=status({now:'2026-10-21T12:00:00Z',absences:[{promotor_matricula:'001',tipo,data_inicio:'2026-10-19',data_fim:'2026-10-21',data_aprovacao:'2026-10-18'}]});
    assert.equal(item.operationalStatus,tipo);assert.equal(item.eligible,false);
  }
});
test('vigência histórica e exceção preservam jornada anterior',()=>{
  const schedules=[{...shift,valid_from:'2026-10-01',valid_to:'2026-10-31'},{...shift,valid_from:'2026-11-01',hora_inicio:'09:00:00'}];
  assert.equal(status({schedules,visits:[{...visit,started_at:'2026-10-19T11:16:00Z'}]}).operationalStatus,'atrasado');
  const exception={...shift,valid_from:'2026-10-19',valid_to:'2026-10-19',hora_inicio:'10:00:00',is_exception:true};
  assert.equal(status({schedules:[...schedules,exception],now:'2026-10-19T12:00:00Z'}).operationalStatus,'aguardando_expediente');
  assert.throws(()=>status({schedules:[shift,shift]}),/sobrepostos/);
});
test('tolerância individual não deriva da modalidade de contratação',()=>{
  assert.equal(status({schedules:[{...shift,modalidade:'Freelancer',tolerance_minutes:0}],visits:[{...visit,started_at:'2026-10-19T11:01:00Z'}]}).operationalStatus,'atrasado');
  assert.equal(status({schedules:[{...shift,modalidade:'CLT parcial',tolerance_minutes:10}],visits:[{...visit,started_at:'2026-10-19T11:01:00Z'}]}).operationalStatus,'presente');
});
test('feriados nacionais, estaduais e municipais têm comportamento explícito e prioridade local',()=>{
  const holiday={data:'2026-10-19',nome:'Teste',uf:null,cidade:null,behavior:'follow_schedule' as const};
  assert.equal(status({holidays:[holiday]}).operationalStatus,'sem_registro');
  assert.equal(status({holidays:[{...holiday,behavior:'off'}]}).operationalStatus,'feriado');
  assert.equal(status({holidays:[{...holiday,behavior:'work'}],schedules:[]}).operationalStatus,'sem_expediente');
  assert.equal(status({schedules:[{...shift,work_uf:'SP',work_city:'São Paulo'}],holidays:[{...holiday,behavior:'off'},{...holiday,uf:'SP',cidade:'São Paulo',behavior:'work'}]}).eligible,true);
  assert.equal(status({promoters:[{...promoter,uf:'RJ'}],holidays:[{...holiday,uf:'SP',behavior:'off'}]}).eligible,true);
});
test('feriado local usa localidade da jornada, sem presumir residência; sem localidade bloqueia falta',()=>{
  const holiday={data:'2026-10-19',nome:'Feriado municipal',uf:'SP',cidade:'Campinas',behavior:'off' as const};
  assert.equal(status({promoters:[{...promoter,uf:'RJ',cidade:'Rio'}],schedules:[{...shift,work_uf:'SP',work_city:'Campinas'}],holidays:[holiday]}).operationalStatus,'feriado');
  assert.equal(status({now:'2026-10-20T12:00:00Z',holidays:[holiday]}).operationalStatus,'sem_registro');
});
test('promotores sem jornada cadastrada são classificados como sem_expediente, 0 elegíveis e visíveis via quickFilter sem_expediente', () => {
  const p1 = { ...promoter, id: 'p1', matricula: '001', nome: 'Promotor 1' };
  const p2 = { ...promoter, id: 'p2', matricula: '002', nome: 'Promotor 2' };
  const roster = buildRoster({ ...base(), promoters: [p1, p2], schedules: [] });
  assert.equal(roster.length, 2);
  assert.equal(roster.filter(i => i.eligible).length, 0);
  assert.equal(roster.filter(i => i.operationalStatus === 'sem_expediente').length, 2);
  assert.equal(roster.filter(i => i.status === 'falta').length, 0);

  // Sem includeOffSchedule e quick=all: filteredRoster é vazio para evitar contaminação dos indicadores
  assert.equal(filterRoster(roster, { search: '', supervisor: '', squad: '', quick: 'all' }).length, 0);

  // Com quickFilter sem_expediente: lista imediatamente todos os 2 promotores sem expediente
  const semExpedienteFiltered = filterRoster(roster, { search: '', supervisor: '', squad: '', quick: 'sem_expediente' });
  assert.equal(semExpedienteFiltered.length, 2);

  // Com includeOffSchedule = true: lista todos os 2 promotores
  const allOffSchedule = filterRoster(roster, { search: '', supervisor: '', squad: '', quick: 'all', offSchedule: true });
  assert.equal(allOffSchedule.length, 2);
});
