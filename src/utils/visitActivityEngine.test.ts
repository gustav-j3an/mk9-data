import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateOperationalActivity, type DayActivityInput } from './visitActivityEngine';
import type { RouteItem, Visit } from '../types';

const promotorA = { id: 'p1', matricula: '001', nome: 'Lucas Silva', equipe: 'Equipe Alpha', supervisor: 'Carlos', status: 'ativo' };
const promotorB = { id: 'p2', matricula: '002', nome: 'Breno Costa', equipe: 'Equipe Alpha', supervisor: 'Carlos', status: 'ativo' };
const promotorC = { id: 'p3', matricula: '003', nome: 'Franklin Lima', equipe: 'Equipe Beta', supervisor: 'Mariana', status: 'ativo' };
const promotorD = { id: 'p4', matricula: '004', nome: 'Alexandre Souza', equipe: 'Equipe Beta', supervisor: 'Mariana', status: 'ativo' };

const rotaL1: RouteItem = { id: 'r1', promotor_matricula: '001', loja_codigo: 'L01', industria_codigo: 'IND1', frequencia: 'SEMANAL', segunda: true } as RouteItem;
const rotaL2: RouteItem = { id: 'r2', promotor_matricula: '001', loja_codigo: 'L02', industria_codigo: 'IND1', frequencia: 'SEMANAL', segunda: true } as RouteItem;
const rotaL3: RouteItem = { id: 'r3', promotor_matricula: '001', loja_codigo: 'L03', industria_codigo: 'IND1', frequencia: 'SEMANAL', segunda: true } as RouteItem;

// 2026-10-19 é uma segunda-feira
const baseDate = '2026-10-19';

test('1. Três visitas programadas e três concluídas gera presença e COMPLETO', () => {
  const visits: Visit[] = [
    { id: 'v1', promotor_matricula: '001', loja_codigo: 'L01', industria_codigo: 'IND1', data_visita: baseDate, status: 'concluida', started_at: '2026-10-19T11:00:00Z', completed_at: '2026-10-19T12:00:00Z' } as Visit,
    { id: 'v2', promotor_matricula: '001', loja_codigo: 'L02', industria_codigo: 'IND1', data_visita: baseDate, status: 'concluida', started_at: '2026-10-19T12:30:00Z', completed_at: '2026-10-19T13:30:00Z' } as Visit,
    { id: 'v3', promotor_matricula: '001', loja_codigo: 'L03', industria_codigo: 'IND1', data_visita: baseDate, status: 'concluida', started_at: '2026-10-19T14:00:00Z', completed_at: '2026-10-19T15:00:00Z' } as Visit,
  ];

  const result = calculateOperationalActivity({
    date: baseDate,
    promoters: [promotorA],
    routes: [rotaL1, rotaL2, rotaL3],
    visits,
    now: '2026-10-20T10:00:00Z' // dia encerrado
  });

  assert.equal(result.length, 1);
  const item = result[0];
  assert.equal(item.presenceStatus, 'presente');
  assert.equal(item.scheduledVisitsCount, 3);
  assert.equal(item.completedVisitsCount, 3);
  assert.equal(item.pendingVisitsCount, 0);
  assert.equal(item.routeStatus, 'COMPLETO');
  assert.equal(item.firstActivityTime, '08:00'); // 11:00 UTC em America/Sao_Paulo (UTC-3)
});

test('2. Três programadas e duas concluídas após o dia encerrado gera PARCIAL com 1 pendência', () => {
  const visits: Visit[] = [
    { id: 'v1', promotor_matricula: '001', loja_codigo: 'L01', industria_codigo: 'IND1', data_visita: baseDate, status: 'concluida', started_at: '2026-10-19T11:00:00Z', completed_at: '2026-10-19T12:00:00Z' } as Visit,
    { id: 'v2', promotor_matricula: '001', loja_codigo: 'L02', industria_codigo: 'IND1', data_visita: baseDate, status: 'concluida', started_at: '2026-10-19T12:30:00Z', completed_at: '2026-10-19T13:30:00Z' } as Visit,
  ];

  const result = calculateOperationalActivity({
    date: baseDate,
    promoters: [promotorA],
    routes: [rotaL1, rotaL2, rotaL3],
    visits,
    now: '2026-10-20T10:00:00Z' // dia encerrado
  });

  const item = result[0];
  assert.equal(item.presenceStatus, 'presente');
  assert.equal(item.scheduledVisitsCount, 3);
  assert.equal(item.completedVisitsCount, 2);
  assert.equal(item.pendingVisitsCount, 1);
  assert.equal(item.routeStatus, 'PARCIAL');
});

test('3. Três programadas e nenhuma concluída após fechamento gera NAO_REALIZADO sem falta automática', () => {
  const result = calculateOperationalActivity({
    date: baseDate,
    promoters: [promotorA],
    routes: [rotaL1, rotaL2, rotaL3],
    visits: [],
    now: '2026-10-20T10:00:00Z' // dia encerrado
  });

  const item = result[0];
  assert.equal(item.presenceStatus, 'sem_atividade');
  assert.equal(item.scheduledVisitsCount, 3);
  assert.equal(item.completedVisitsCount, 0);
  assert.equal(item.pendingVisitsCount, 3);
  assert.equal(item.routeStatus, 'NAO_REALIZADO');
});

test('4. Primeira visita iniciada sem conclusão durante o dia confirma presença e EM_ATIVIDADE', () => {
  const visits: Visit[] = [
    { id: 'v1', promotor_matricula: '001', loja_codigo: 'L01', industria_codigo: 'IND1', data_visita: baseDate, status: 'em_andamento', started_at: '2026-10-19T11:15:00Z' } as Visit
  ];

  const result = calculateOperationalActivity({
    date: baseDate,
    promoters: [promotorA],
    routes: [rotaL1, rotaL2, rotaL3],
    visits,
    now: '2026-10-19T13:00:00Z' // mesmo dia em andamento
  });

  const item = result[0];
  assert.equal(item.presenceStatus, 'presente');
  assert.equal(item.firstActivityTime, '08:15');
  assert.equal(item.scheduledVisitsCount, 3);
  assert.equal(item.completedVisitsCount, 0);
  assert.equal(item.inProgressVisitsCount, 1);
  assert.equal(item.pendingVisitsCount, 3);
  assert.equal(item.routeStatus, 'EM_ATIVIDADE');
});

test('4b. Possui visitas programadas para hoje mas nenhuma iniciada resulta em AGUARDANDO_INICIO', () => {
  const result = calculateOperationalActivity({
    date: baseDate,
    promoters: [promotorA],
    routes: [rotaL1, rotaL2],
    visits: [],
    now: '2026-10-19T10:00:00Z' // dia de hoje em curso, sem visita iniciada
  });

  const item = result[0];
  assert.equal(item.presenceStatus, 'sem_atividade');
  assert.equal(item.scheduledVisitsCount, 2);
  assert.equal(item.completedVisitsCount, 0);
  assert.equal(item.pendingVisitsCount, 2);
  assert.equal(item.routeStatus, 'AGUARDANDO_INICIO');
});

test('5. Sem programação cadastrada resulta em SEM_PROGRAMACAO e não gera falta', () => {
  const result = calculateOperationalActivity({
    date: baseDate,
    promoters: [promotorA],
    routes: [], // nenhuma rota
    visits: [],
    now: '2026-10-20T10:00:00Z'
  });

  const item = result[0];
  assert.equal(item.presenceStatus, 'sem_atividade');
  assert.equal(item.scheduledVisitsCount, 0);
  assert.equal(item.pendingVisitsCount, 0);
  assert.equal(item.routeStatus, 'SEM_PROGRAMACAO');
});

test('6. Visita não realizada sem started_at não confirma presença', () => {
  const visits: Visit[] = [
    { id: 'v1', promotor_matricula: '001', loja_codigo: 'L01', industria_codigo: 'IND1', data_visita: baseDate, status: 'nao_realizada', started_at: null, motivo_nao_realizada: 'Loja fechada' } as Visit
  ];

  const result = calculateOperationalActivity({
    date: baseDate,
    promoters: [promotorA],
    routes: [rotaL1],
    visits,
    now: '2026-10-20T10:00:00Z'
  });

  const item = result[0];
  assert.equal(item.presenceStatus, 'sem_atividade');
  assert.equal(item.firstActivityTime, null);
  assert.equal(item.routeStatus, 'NAO_REALIZADO');
});

test('7. Múltiplas visitas e atendimentos geram apenas uma confirmação diária de presença', () => {
  const visits: Visit[] = [
    { id: 'v1', promotor_matricula: '001', loja_codigo: 'L01', industria_codigo: 'IND1', data_visita: baseDate, status: 'concluida', started_at: '2026-10-19T11:00:00Z', completed_at: '2026-10-19T12:00:00Z' } as Visit,
    { id: 'v2', promotor_matricula: '001', loja_codigo: 'L02', industria_codigo: 'IND1', data_visita: baseDate, status: 'concluida', started_at: '2026-10-19T13:00:00Z', completed_at: '2026-10-19T14:00:00Z' } as Visit
  ];

  const result = calculateOperationalActivity({
    date: baseDate,
    promoters: [promotorA],
    routes: [rotaL1, rotaL2],
    visits,
    now: '2026-10-19T15:00:00Z'
  });

  const item = result[0];
  assert.equal(item.presenceStatus, 'presente');
  assert.equal(item.firstActivityTime, '08:00');
});

test('8. Visitas de outros promotores não interferem no resultado', () => {
  const visits: Visit[] = [
    // Promotor B fez visita
    { id: 'v2', promotor_matricula: '002', loja_codigo: 'L01', industria_codigo: 'IND1', data_visita: baseDate, status: 'concluida', started_at: '2026-10-19T11:00:00Z', completed_at: '2026-10-19T12:00:00Z' } as Visit
  ];

  const result = calculateOperationalActivity({
    date: baseDate,
    promoters: [promotorA, promotorB],
    routes: [
      rotaL1, // Rota do promotor A
      { ...rotaL1, id: 'rB', promotor_matricula: '002' } // Rota do promotor B
    ],
    visits,
    now: '2026-10-20T10:00:00Z'
  });

  const itemA = result.find(p => p.matricula === '001')!;
  const itemB = result.find(p => p.matricula === '002')!;

  assert.equal(itemA.presenceStatus, 'sem_atividade');
  assert.equal(itemA.routeStatus, 'NAO_REALIZADO');

  assert.equal(itemB.presenceStatus, 'presente');
  assert.equal(itemB.routeStatus, 'COMPLETO');
});

test('9. Rotas encerradas (não ativas no dia da semana) não entram na programação da data', () => {
  // Rota ativa somente na terça-feira
  const rotaTerca: RouteItem = { id: 'rT', promotor_matricula: '001', loja_codigo: 'L04', industria_codigo: 'IND1', frequencia: 'SEMANAL', segunda: false, terca: true } as RouteItem;

  const result = calculateOperationalActivity({
    date: baseDate, // Segunda-feira
    promoters: [promotorA],
    routes: [rotaTerca],
    visits: [],
    now: '2026-10-19T10:00:00Z'
  });

  const item = result[0];
  assert.equal(item.scheduledVisitsCount, 0);
  assert.equal(item.routeStatus, 'SEM_PROGRAMACAO');
});

test('10. Desduplicação de rotas com mesma loja e indústria na mesma data', () => {
  const rotaDuplicada: RouteItem = { id: 'rDupl', promotor_matricula: '001', loja_codigo: 'L01', industria_codigo: 'IND1', frequencia: 'SEMANAL', segunda: true } as RouteItem;

  const result = calculateOperationalActivity({
    date: baseDate,
    promoters: [promotorA],
    routes: [rotaL1, rotaDuplicada], // Duas rotas para mesma loja e indústria
    visits: [],
    now: '2026-10-19T10:00:00Z'
  });

  const item = result[0];
  assert.equal(item.scheduledVisitsCount, 1);
});

test('11. Cenário do exemplo do usuário: Lucas, Breno, Franklin e Alexandre', () => {
  // Lucas | Presente | 3/3 | COMPLETO
  // Breno | Presente | 2/3 | PARCIAL (dia fechado)
  // Franklin | Sem atividade | 0/4 | NÃO REALIZADO
  // Alexandre | Presente | 1/3 | EM ATIVIDADE (dia atual)

  const routes: RouteItem[] = [
    // Lucas 3 rotas
    { id: 'r1', promotor_matricula: '001', loja_codigo: 'L1', industria_codigo: 'I1', frequencia: 'SEMANAL', segunda: true } as RouteItem,
    { id: 'r2', promotor_matricula: '001', loja_codigo: 'L2', industria_codigo: 'I1', frequencia: 'SEMANAL', segunda: true } as RouteItem,
    { id: 'r3', promotor_matricula: '001', loja_codigo: 'L3', industria_codigo: 'I1', frequencia: 'SEMANAL', segunda: true } as RouteItem,
    // Breno 3 rotas
    { id: 'r4', promotor_matricula: '002', loja_codigo: 'L1', industria_codigo: 'I1', frequencia: 'SEMANAL', segunda: true } as RouteItem,
    { id: 'r5', promotor_matricula: '002', loja_codigo: 'L2', industria_codigo: 'I1', frequencia: 'SEMANAL', segunda: true } as RouteItem,
    { id: 'r6', promotor_matricula: '002', loja_codigo: 'L3', industria_codigo: 'I1', frequencia: 'SEMANAL', segunda: true } as RouteItem,
    // Franklin 4 rotas
    { id: 'r7', promotor_matricula: '003', loja_codigo: 'L1', industria_codigo: 'I1', frequencia: 'SEMANAL', segunda: true } as RouteItem,
    { id: 'r8', promotor_matricula: '003', loja_codigo: 'L2', industria_codigo: 'I1', frequencia: 'SEMANAL', segunda: true } as RouteItem,
    { id: 'r9', promotor_matricula: '003', loja_codigo: 'L3', industria_codigo: 'I1', frequencia: 'SEMANAL', segunda: true } as RouteItem,
    { id: 'r10', promotor_matricula: '003', loja_codigo: 'L4', industria_codigo: 'I1', frequencia: 'SEMANAL', segunda: true } as RouteItem,
    // Alexandre 3 rotas
    { id: 'r11', promotor_matricula: '004', loja_codigo: 'L1', industria_codigo: 'I1', frequencia: 'SEMANAL', segunda: true } as RouteItem,
    { id: 'r12', promotor_matricula: '004', loja_codigo: 'L2', industria_codigo: 'I1', frequencia: 'SEMANAL', segunda: true } as RouteItem,
    { id: 'r13', promotor_matricula: '004', loja_codigo: 'L3', industria_codigo: 'I1', frequencia: 'SEMANAL', segunda: true } as RouteItem,
  ];

  const visits: Visit[] = [
    // Lucas concluiu 3
    { id: 'v1', promotor_matricula: '001', loja_codigo: 'L1', industria_codigo: 'I1', data_visita: baseDate, status: 'concluida', started_at: '2026-10-19T11:00:00Z', completed_at: '2026-10-19T12:00:00Z' } as Visit,
    { id: 'v2', promotor_matricula: '001', loja_codigo: 'L2', industria_codigo: 'I1', data_visita: baseDate, status: 'concluida', started_at: '2026-10-19T12:30:00Z', completed_at: '2026-10-19T13:30:00Z' } as Visit,
    { id: 'v3', promotor_matricula: '001', loja_codigo: 'L3', industria_codigo: 'I1', data_visita: baseDate, status: 'concluida', started_at: '2026-10-19T14:00:00Z', completed_at: '2026-10-19T15:00:00Z' } as Visit,
    // Breno concluiu 2
    { id: 'v4', promotor_matricula: '002', loja_codigo: 'L1', industria_codigo: 'I1', data_visita: baseDate, status: 'concluida', started_at: '2026-10-19T11:00:00Z', completed_at: '2026-10-19T12:00:00Z' } as Visit,
    { id: 'v5', promotor_matricula: '002', loja_codigo: 'L2', industria_codigo: 'I1', data_visita: baseDate, status: 'concluida', started_at: '2026-10-19T12:30:00Z', completed_at: '2026-10-19T13:30:00Z' } as Visit,
    // Franklin nenhuma visita
    // Alexandre concluiu 1
    { id: 'v6', promotor_matricula: '004', loja_codigo: 'L1', industria_codigo: 'I1', data_visita: baseDate, status: 'concluida', started_at: '2026-10-19T11:00:00Z', completed_at: '2026-10-19T12:00:00Z' } as Visit,
  ];

  // Caso A: Dia encerrado (Breno fica PARCIAL, Franklin NAO_REALIZADO)
  const resPast = calculateOperationalActivity({
    date: baseDate,
    promoters: [promotorA, promotorB, promotorC],
    routes,
    visits,
    now: '2026-10-20T10:00:00Z' // passado
  });

  const lucas = resPast.find(p => p.matricula === '001')!;
  const breno = resPast.find(p => p.matricula === '002')!;
  const franklin = resPast.find(p => p.matricula === '003')!;

  assert.equal(lucas.presenceStatus, 'presente');
  assert.equal(`${lucas.completedVisitsCount}/${lucas.scheduledVisitsCount}`, '3/3');
  assert.equal(lucas.pendingVisitsCount, 0);
  assert.equal(lucas.routeStatus, 'COMPLETO');

  assert.equal(breno.presenceStatus, 'presente');
  assert.equal(`${breno.completedVisitsCount}/${breno.scheduledVisitsCount}`, '2/3');
  assert.equal(breno.pendingVisitsCount, 1);
  assert.equal(breno.routeStatus, 'PARCIAL');

  assert.equal(franklin.presenceStatus, 'sem_atividade');
  assert.equal(`${franklin.completedVisitsCount}/${franklin.scheduledVisitsCount}`, '0/4');
  assert.equal(franklin.pendingVisitsCount, 4);
  assert.equal(franklin.routeStatus, 'NAO_REALIZADO');

  // Caso B: Alexandre no dia atual em andamento (fica EM_ATIVIDADE)
  const resToday = calculateOperationalActivity({
    date: baseDate,
    promoters: [promotorD],
    routes,
    visits,
    now: '2026-10-19T13:00:00Z' // mesmo dia operacional
  });

  const alexandre = resToday.find(p => p.matricula === '004')!;
  assert.equal(alexandre.presenceStatus, 'presente');
  assert.equal(`${alexandre.completedVisitsCount}/${alexandre.scheduledVisitsCount}`, '1/3');
  assert.equal(alexandre.pendingVisitsCount, 2);
  assert.equal(alexandre.routeStatus, 'EM_ATIVIDADE');
});

test('12. Rejeição com erro para formato de data inválido', () => {
  assert.throws(() => {
    calculateOperationalActivity({
      date: '19/10/2026',
      promoters: [promotorA],
      routes: [],
      visits: []
    });
  }, /Data operacional inválida/);
});
