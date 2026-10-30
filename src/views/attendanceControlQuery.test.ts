import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAttendanceControlQuery, updateAttendanceControlQuery } from './attendanceControlQuery';

describe('attendanceControlQuery', () => {
  it('faz parse seguro dos parâmetros da URL', () => {
    const params = new URLSearchParams('data=2026-10-30&busca=Carlos&supervisor=Maria&escopo=com_roteiro&status_roteiro=CONCLUIDO&equipe=Leste&filtro_rapido=falta&fora_grade=1');
    const parsed = parseAttendanceControlQuery(params);

    assert.equal(parsed.date, '2026-10-30');
    assert.equal(parsed.search, 'Carlos');
    assert.equal(parsed.supervisor, 'Maria');
    assert.equal(parsed.scope, 'com_roteiro');
    assert.equal(parsed.status, 'CONCLUIDO');
    assert.equal(parsed.squad, 'Leste');
    assert.equal(parsed.quick, 'falta');
    assert.equal(parsed.offSchedule, true);
  });

  it('ignora datas inválidas e valores desconhecidos', () => {
    const params = new URLSearchParams('data=invalid-date&escopo=hack&filtro_rapido=invalid');
    const parsed = parseAttendanceControlQuery(params);

    assert.equal(parsed.date, undefined);
    assert.equal(parsed.scope, undefined);
    assert.equal(parsed.quick, undefined);
  });

  it('atualiza parâmetros sem vazar senhas ou tokens', () => {
    const current = new URLSearchParams('token=secret123&data=2026-10-29');
    const updated = updateAttendanceControlQuery(current, {
      date: '2026-10-30',
      search: 'Ana',
      supervisor: 'Silva',
      scope: 'todos',
      status: 'PARCIAL',
      squad: 'Norte',
      quick: 'atestado',
      offSchedule: true
    });

    assert.equal(updated.get('token'), null);
    assert.equal(updated.get('data'), '2026-10-30');
    assert.equal(updated.get('busca'), 'Ana');
    assert.equal(updated.get('supervisor'), 'Silva');
    assert.equal(updated.get('escopo'), 'todos');
    assert.equal(updated.get('status_roteiro'), 'PARCIAL');
    assert.equal(updated.get('equipe'), 'Norte');
    assert.equal(updated.get('filtro_rapido'), 'atestado');
    assert.equal(updated.get('fora_grade'), '1');
  });

  it('remove chaves default para manter URL limpa', () => {
    const current = new URLSearchParams('busca=Ana&escopo=todos');
    const updated = updateAttendanceControlQuery(current, {
      date: '2026-10-30',
      search: '',
      supervisor: '',
      scope: 'com_roteiro',
      status: 'ALL',
      squad: '',
      quick: 'all',
      offSchedule: false
    });

    assert.equal(updated.get('busca'), null);
    assert.equal(updated.get('escopo'), null);
    assert.equal(updated.get('status_roteiro'), null);
    assert.equal(updated.get('filtro_rapido'), null);
    assert.equal(updated.get('fora_grade'), null);
    assert.equal(updated.get('data'), '2026-10-30');
  });
});
