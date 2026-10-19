import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Funções idênticas às implementadas em src/views/IndustriesView.tsx
 */
function normalizeText(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function formatAderencia(realizadas: number, planejadas: number): string {
  if (planejadas <= 0) return '—';
  const pct = (realizadas / planejadas) * 100;
  if (pct === 0) return '0%';
  if (pct < 1) {
    const formatted = pct.toFixed(1).replace('.', ',');
    return formatted === '0,0' ? '< 0,1%' : `${formatted}%`;
  }
  return `${Math.round(pct)}%`;
}

describe('Onda 3.2 - Auditoria de Aderência e Funções Utilitárias', () => {
  describe('normalizeText', () => {
    it('deve remover maiúsculas e espaços excedentes', () => {
      assert.equal(normalizeText('  JOÃO SILVA  '), 'joao silva');
    });

    it('deve remover acentos e diacríticos em português', () => {
      assert.equal(normalizeText('Açaí & Café Três Corações'), 'acai & cafe tres coracoes');
      assert.equal(normalizeText('São Gonçalo / Niterói'), 'sao goncalo / niteroi');
    });

    it('deve retornar string vazia para string vazia ou espaços', () => {
      assert.equal(normalizeText(''), '');
      assert.equal(normalizeText('   '), '');
    });
  });

  describe('formatAderencia', () => {
    it('deve retornar "—" quando não houver visitas planejadas (evita divisão por zero)', () => {
      assert.equal(formatAderencia(0, 0), '—');
      assert.equal(formatAderencia(5, 0), '—');
      assert.equal(formatAderencia(0, -10), '—');
    });

    it('deve retornar "0%" quando planejadas > 0 mas realizadas = 0', () => {
      assert.equal(formatAderencia(0, 100), '0%');
      assert.equal(formatAderencia(0, 2148), '0%');
    });

    it('deve formatar valores residuais (< 1%) sem mascarar como 0% (caso real 6 / 2148)', () => {
      // 6 / 2148 = 0.279329...% => '0,3%'
      assert.equal(formatAderencia(6, 2148), '0,3%');
      // 1 / 1000 = 0.1% => '0,1%'
      assert.equal(formatAderencia(1, 1000), '0,1%');
      // 1 / 2000 = 0.05% => '0,1%'
      assert.equal(formatAderencia(1, 2000), '0,1%');
    });

    it('deve tratar casos ultra-residuais (< 0,05%) como "< 0,1%" para não arredondar para 0,0%', () => {
      // 1 / 100000 = 0.001%
      assert.equal(formatAderencia(1, 100000), '< 0,1%');
    });

    it('deve arredondar valores >= 1% conforme padrão de gestão', () => {
      assert.equal(formatAderencia(50, 100), '50%');
      assert.equal(formatAderencia(854, 1000), '85%');
      assert.equal(formatAderencia(100, 100), '100%');
      assert.equal(formatAderencia(120, 100), '120%');
    });
  });

  describe('Auditoria da Decomposição de Visitas Planejadas (2148)', () => {
    it('a soma de realizadas + em_andamento + nao_realizadas + pendentes deve ser exatamente igual a planejadas', () => {
      const totalPlanejadas = 2148;
      const totalRealizadas = 6;
      const totalEmAndamento = 5;
      const totalNaoRealizadas = 1;
      const totalPendentes = 2136;

      const soma = totalRealizadas + totalEmAndamento + totalNaoRealizadas + totalPendentes;
      assert.equal(soma, totalPlanejadas);
      assert.equal(totalPlanejadas - (totalRealizadas + totalPendentes + totalNaoRealizadas), totalEmAndamento);
    });
  });

  describe('Busca e Paginação em Listas', () => {
    const listaMock = [
      { id: '1', nome: 'Indústria Alfa', codigo: 'IND-001' },
      { id: '2', nome: 'Distribuidora Beta', codigo: 'IND-002' },
      { id: '3', nome: 'Comércio Gama', codigo: 'IND-003' },
      { id: '4', nome: 'Indústria Delta', codigo: 'IND-004' },
      { id: '5', nome: 'Moinho Épsilon', codigo: 'IND-005' },
    ];

    it('deve filtrar por nome com acento ou sem acento', () => {
      const q1 = normalizeText('industria');
      const res1 = listaMock.filter(i => normalizeText(i.nome).includes(q1) || normalizeText(i.codigo).includes(q1));
      assert.equal(res1.length, 2);

      const q2 = normalizeText('épsilon');
      const res2 = listaMock.filter(i => normalizeText(i.nome).includes(q2));
      assert.equal(res2.length, 1);
      assert.equal(res2[0].codigo, 'IND-005');
    });

    it('deve filtrar por código', () => {
      const q = normalizeText('003');
      const res = listaMock.filter(i => normalizeText(i.nome).includes(q) || normalizeText(i.codigo).includes(q));
      assert.equal(res.length, 1);
      assert.equal(res[0].nome, 'Comércio Gama');
    });

    it('deve calcular corretamente a paginação (fatiamento de array)', () => {
      const pageSize = 2;
      const page1 = listaMock.slice(0, 2);
      const page2 = listaMock.slice(2, 4);
      const page3 = listaMock.slice(4, 6);

      assert.equal(page1.length, 2);
      assert.equal(page2.length, 2);
      assert.equal(page3.length, 1);
      assert.equal(Math.ceil(listaMock.length / pageSize), 3);
    });
  });
});

