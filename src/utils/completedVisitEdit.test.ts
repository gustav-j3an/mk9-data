import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validatePromoterEditPermission,
  computeVisitEditDiff
} from './completedVisitEdit';
import type { Visit } from '../types';

const baseMockVisit: Visit = {
  id: 'visit-123',
  data_visita: '2026-11-15',
  promotor_matricula: 'PROM001',
  loja_codigo: 'LOJA01',
  industria_codigo: 'IND01',
  status: 'concluida',
  started_at: '2026-11-15T09:00:00Z',
  completed_at: '2026-11-15T10:00:00Z',
  observacao_geral: 'Atendimento inicial',
  checklist_items: [
    {
      id: 'chk-1',
      visit_id: 'visit-123',
      item_key: 'qtd_produtos_venda',
      item_label: 'Quantidade na área de vendas',
      checked: true,
      valor_texto: '15',
      observacao: ''
    }
  ],
  validity_items: [
    {
      id: 'val-1',
      visit_id: 'visit-123',
      produto_nome: 'Refrigerante 2L',
      quantidade: 10,
      data_vencimento: '2026-12-01',
      lote: 'L123'
    }
  ]
};

test('completedVisitEdit: validates promoter permissions correctly', () => {
  // Mesmo promotor, visita concluída -> OK
  const permOwn = validatePromoterEditPermission(baseMockVisit, 'PROM001', 'promotor');
  assert.equal(permOwn.canEdit, true);

  // Outro promotor -> Negado
  const permOther = validatePromoterEditPermission(baseMockVisit, 'PROM999', 'promotor');
  assert.equal(permOther.canEdit, false);
  assert.match(permOther.reason!, /você só pode editar visitas realizadas por você mesmo/i);

  // Admin ou Gestor -> Permitido para qualquer promotor
  const permAdmin = validatePromoterEditPermission(baseMockVisit, 'OUTRA_MATR', 'admin');
  assert.equal(permAdmin.canEdit, true);

  // Visita não concluída (ex: em_andamento) -> Negado neste fluxo
  const openVisit = { ...baseMockVisit, status: 'em_andamento' as const };
  const permOpen = validatePromoterEditPermission(openVisit, 'PROM001', 'promotor');
  assert.equal(permOpen.canEdit, false);
  assert.match(permOpen.reason!, /apenas visitas concluídas/i);
});

test('completedVisitEdit: computes diff and isolates sensitive fields', () => {
  const diffResult = computeVisitEditDiff(baseMockVisit, {
    observacao_geral: 'Observação revisada após contagem',
    checklist_items: [
      {
        item_key: 'qtd_produtos_venda',
        valor_texto: '20',
        observacao: 'Reposição feita'
      }
    ],
    validity_items: [
      {
        id: 'val-1',
        produto_nome: 'Refrigerante 2L',
        quantidade: 12,
        data_vencimento: '2026-12-01',
        lote: 'L123'
      },
      {
        produto_nome: 'Suco 1L',
        quantidade: 5,
        data_vencimento: '2026-12-10'
      }
    ]
  });

  assert.equal(diffResult.changed, true);
  assert.equal(diffResult.changes.length, 4); // obs, checklist qtd, validity edit, validity new

  // Valida que o payload gerado tem os valores normalizados
  assert.equal(diffResult.sanitizedPayload.observacao_geral, 'Observação revisada após contagem');
  assert.equal(diffResult.sanitizedPayload.checklist_items[0].valor_texto, '20');
  assert.equal(diffResult.sanitizedPayload.validity_items.length, 2);
  assert.equal(diffResult.sanitizedPayload.validity_items[1].produto_nome, 'Suco 1L');
});

test('completedVisitEdit: detects no changes when values are identical', () => {
  const diffResult = computeVisitEditDiff(baseMockVisit, {
    observacao_geral: '  Atendimento inicial  ',
    checklist_items: [
      {
        item_key: 'qtd_produtos_venda',
        checked: true,
        valor_texto: '15',
        observacao: ''
      }
    ],
    validity_items: [
      {
        id: 'val-1',
        produto_nome: 'Refrigerante 2L',
        quantidade: 10,
        data_vencimento: '2026-12-01',
        lote: 'L123'
      }
    ]
  });

  assert.equal(diffResult.changed, false);
  assert.equal(diffResult.changes.length, 0);
});
