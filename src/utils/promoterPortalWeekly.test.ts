import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculateOperationalVisits,
  getWeekDaysRange,
} from './routePlanner.js';
import type { RouteItem, Visit } from '../types.js';

describe('Portal do Promotor - Visualizacao Semanal e Escala Fixa', () => {
  const baseDate = new Date('2026-10-14T12:00:00Z'); // Quarta-feira
  const weekDays = getWeekDaysRange(baseDate, 0);

  const mockRouteSegQua: RouteItem = {
    id: 'route-1',
    codigo_rota: 'R-001',
    promotor_matricula: 'PROM01',
    loja_codigo: 'LJ01',
    industria_codigo: 'IND01',
    uf: 'SP',
    frequencia: 'SEMANAL',
    segunda: true,
    terca: false,
    quarta: true,
    quinta: false,
    sexta: false,
    sabado: false,
    domingo: false,
    loja: { codigo: 'LJ01', nome: 'Supermercado Central', cidade: 'São Paulo', uf: 'SP' },
    industria: { codigo: 'IND01', nome: 'Indústria Alfa' }
  };

  const mockRouteTerSex: RouteItem = {
    id: 'route-2',
    codigo_rota: 'R-002',
    promotor_matricula: 'PROM01',
    loja_codigo: 'LJ02',
    industria_codigo: 'IND02',
    uf: 'SP',
    frequencia: 'SEMANAL',
    segunda: false,
    terca: true,
    quarta: false,
    quinta: false,
    sexta: true,
    sabado: false,
    domingo: false,
    loja: { codigo: 'LJ02', nome: 'Hipermercado Sul', cidade: 'São Paulo', uf: 'SP' },
    industria: { codigo: 'IND02', nome: 'Indústria Beta' }
  };

  it('1. Deve gerar os 7 dias da semana corretamente de domingo a sabado ou segunda a domingo', () => {
    assert.strictEqual(weekDays.length, 7);
    const dayKeys = weekDays.map((d) => d.dayKey);
    assert.ok(dayKeys.includes('segunda'));
    assert.ok(dayKeys.includes('domingo'));
    assert.ok(dayKeys.includes('quarta'));
  });

  it('2. Navegacao entre semanas (weekOffset) deve mover a grade em blocos de 7 dias', () => {
    const prevWeek = getWeekDaysRange(baseDate, -1);
    const nextWeek = getWeekDaysRange(baseDate, 1);

    const currentStart = new Date(weekDays[0].dateStr);
    const prevStart = new Date(prevWeek[0].dateStr);
    const nextStart = new Date(nextWeek[0].dateStr);

    const diffPrev = Math.round((currentStart.getTime() - prevStart.getTime()) / (1000 * 60 * 60 * 24));
    const diffNext = Math.round((nextStart.getTime() - currentStart.getTime()) / (1000 * 60 * 60 * 24));

    assert.strictEqual(diffPrev, 7);
    assert.strictEqual(diffNext, 7);
  });

  it('3. Selecao de dia: filtra os registros da semana para exibir apenas o dia selecionado', () => {
    const allVisits = calculateOperationalVisits({
      routes: [mockRouteSegQua, mockRouteTerSex],
      visits: [],
      daysRange: weekDays,
      todayStr: '2026-10-14'
    });

    const wednesday = weekDays.find((d) => d.dayKey === 'quarta')!;
    const tuesday = weekDays.find((d) => d.dayKey === 'terca')!;
    const sunday = weekDays.find((d) => d.dayKey === 'domingo')!;

    const wednesdayVisits = allVisits.filter((v) => v.dataStr === wednesday.dateStr);
    const tuesdayVisits = allVisits.filter((v) => v.dataStr === tuesday.dateStr);
    const sundayVisits = allVisits.filter((v) => v.dataStr === sunday.dateStr);

    assert.strictEqual(wednesdayVisits.length, 1);
    assert.strictEqual(wednesdayVisits[0].lojaCodigo, 'LJ01');

    assert.strictEqual(tuesdayVisits.length, 1);
    assert.strictEqual(tuesdayVisits[0].lojaCodigo, 'LJ02');

    // Domingo sem atendimentos: deve retornar lista vazia
    assert.strictEqual(sundayVisits.length, 0);
  });

  it('4. Preservacao de atendimentos concluidos ao alterar a escala futura', () => {
    const wednesday = weekDays.find((d) => d.dayKey === 'quarta')!;

    const completedVisit: Visit = {
      id: 'visit-completed-1',
      promotor_matricula: 'PROM01',
      loja_codigo: 'LJ01',
      industria_codigo: 'IND01',
      data_visita: wednesday.dateStr,
      status: 'concluida',
      started_at: `${wednesday.dateStr}T09:00:00Z`,
      completed_at: `${wednesday.dateStr}T10:00:00Z`,
      checklist_items: [{ id: 'chk-1', visit_id: 'visit-completed-1', item_key: 'ruptura', item_label: 'Ruptura', checked: true }],
      photos: [{ id: 'p-1', visit_id: 'visit-completed-1', file_url: 'https://ex.com/p1.jpg', storage_path: 'photos/p1.jpg', tipo_foto: 'fachada' }],
      occurrences: [],
      validity_items: []
    };

    // Cenario: Rota e alterada para desativar Quarta-feira (segunda=true, quarta=false)
    const modifiedRoute: RouteItem = {
      ...mockRouteSegQua,
      quarta: false
    };

    const operationalVisits = calculateOperationalVisits({
      routes: [modifiedRoute],
      visits: [completedVisit],
      daysRange: weekDays,
      todayStr: '2026-10-14'
    });

    const visitOnWednesday = operationalVisits.find((v) => v.dataStr === wednesday.dateStr);
    assert.ok(visitOnWednesday, 'Visita concluida deve ser preservada mesmo que a rota nao inclua mais a quarta-feira');
    assert.strictEqual(visitOnWednesday?.status, 'concluida');
    assert.strictEqual(visitOnWednesday?.completedAt, `${wednesday.dateStr}T10:00:00Z`);
  });

  it('5. Escala encerrada preserva dias validos anteriores e nao projeta datas posteriores', () => {
    const wednesday = weekDays.find((d) => d.dayKey === 'quarta')!;
    const completedVisit: Visit = {
      id: 'visit-closed-route',
      promotor_matricula: 'PROM01',
      loja_codigo: 'LJ01',
      industria_codigo: 'IND01',
      data_visita: wednesday.dateStr,
      status: 'concluida',
      started_at: `${wednesday.dateStr}T09:00:00Z`,
      completed_at: `${wednesday.dateStr}T10:00:00Z`,
      checklist_items: [],
      photos: [{
        id: 'photo-preserved',
        visit_id: 'visit-closed-route',
        file_url: 'https://ex.com/preserved.jpg',
        storage_path: 'photos/preserved.jpg',
        tipo_foto: 'fachada'
      }],
      occurrences: [],
      validity_items: []
    };

    const operationalVisits = calculateOperationalVisits({
      routes: [{ ...mockRouteSegQua, encerrada_em: `${wednesday.dateStr}T08:00:00Z` }],
      visits: [completedVisit],
      daysRange: weekDays,
      todayStr: wednesday.dateStr
    });

    assert.ok(operationalVisits.length > 1, 'dias programados anteriores ao encerramento continuam no histórico');
    assert.ok(operationalVisits.every(item => item.dataStr <= wednesday.dateStr), 'a rota encerrada não projeta datas posteriores ao encerramento');
    const preservedVisit = operationalVisits.find(item => item.visitObj?.id === completedVisit.id);
    assert.ok(preservedVisit, 'a visita real permanece preservada');
    assert.strictEqual(preservedVisit?.status, 'concluida');
    assert.strictEqual(preservedVisit?.isRealExecution, true);
    assert.strictEqual(preservedVisit?.visitObj?.photos?.[0]?.id, 'photo-preserved');
  });

  it('6. Escala Fixa da Semana: agrupa lojas por dia de segunda a domingo', () => {
    const routesList = [mockRouteSegQua, mockRouteTerSex];

    const segLojas = routesList.filter((r) => r.segunda).length;
    const terLojas = routesList.filter((r) => r.terca).length;
    const quaLojas = routesList.filter((r) => r.quarta).length;
    const quiLojas = routesList.filter((r) => r.quinta).length;
    const sexLojas = routesList.filter((r) => r.sexta).length;
    const sabLojas = routesList.filter((r) => r.sabado).length;
    const domLojas = routesList.filter((r) => r.domingo).length;

    assert.strictEqual(segLojas, 1);
    assert.strictEqual(terLojas, 1);
    assert.strictEqual(quaLojas, 1);
    assert.strictEqual(quiLojas, 0);
    assert.strictEqual(sexLojas, 1);
    assert.strictEqual(sabLojas, 0);
    assert.strictEqual(domLojas, 0);
  });
});
