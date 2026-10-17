import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { VisitChecklistItem } from '../types';
import {
  buildChecklistSyncPlan,
  CHECKLIST_GROUPS,
  createChecklistState,
  DEFAULT_CHECKLIST_ITEMS,
  findInvalidChecklistQuantity,
  isSupportedVisitPhoto,
  isWithinVisitPhotoLimit
} from './visitExecution';

describe('visit execution checklist and photo helpers', () => {
  it('organizes the operational questions in the three checklist groups and retains compact controls', () => {
    const groupedKeys = CHECKLIST_GROUPS.flatMap((group) => group.itemKeys);
    assert.equal(new Set(groupedKeys).size, DEFAULT_CHECKLIST_ITEMS.length);
    assert.ok(groupedKeys.includes('ruptura_gondola'));
    assert.ok(groupedKeys.includes('qtd_produtos_venda'));
    assert.ok(groupedKeys.includes('qtd_produtos_deposito'));
    assert.ok(groupedKeys.includes('ponto_extra'));
    assert.ok(groupedKeys.includes('exposicao_organizada'));
    assert.ok(groupedKeys.includes('validade_ok'));
    assert.ok(groupedKeys.includes('preco_conforme'));
  });

  it('preserves a numeric zero and leaves unanswered quantities blank when resuming', () => {
    const state = createChecklistState([
      {
        item_key: 'qtd_produtos_deposito',
        item_label: 'Quantidade disponível no depósito',
        checked: false,
        valor_texto: '0'
      } as VisitChecklistItem
    ]);

    assert.equal(state.qtd_produtos_deposito.valTxt, '0');
    assert.equal(state.qtd_produtos_deposito.answered, true);
    assert.equal(state.qtd_produtos_venda.valTxt, '');
    assert.equal(state.qtd_produtos_venda.answered, false);
  });

  it('accepts zero, permits an unanswered quantity, and rejects negative or fractional quantities', () => {
    const state = createChecklistState();
    assert.equal(findInvalidChecklistQuantity(state), null);

    state.qtd_produtos_deposito = { checked: false, answered: true, obs: '', valTxt: '0' };
    assert.equal(findInvalidChecklistQuantity(state), null);

    state.qtd_produtos_venda = { checked: false, answered: true, obs: '', valTxt: '-1' };
    assert.equal(findInvalidChecklistQuantity(state), 'Quantidade na área de vendas');

    state.qtd_produtos_venda.valTxt = '1.5';
    assert.equal(findInvalidChecklistQuantity(state), 'Quantidade na área de vendas');
  });

  it('plans checklist updates/inserts without deleting unknown historical rows', () => {
    const state = createChecklistState([
      {
        id: 'old-row',
        item_key: 'ruptura_gondola',
        item_label: 'Rótulo histórico',
        checked: true,
        observacao: 'Produto A: 2',
        valor_texto: null
      } as VisitChecklistItem,
      {
        id: 'legacy-row',
        item_key: 'controle_legado',
        item_label: 'Controle legado',
        checked: true
      } as VisitChecklistItem
    ]);
    state.qtd_produtos_deposito = {
      checked: false,
      answered: true,
      obs: '',
      valTxt: '0'
    };

    const plan = buildChecklistSyncPlan('visit-1', state, [
      { id: 'old-row', item_key: 'ruptura_gondola' },
      { id: 'legacy-row', item_key: 'controle_legado' }
    ]);

    assert.equal(plan.updates.length, 1);
    assert.equal(plan.updates[0].id, 'old-row');
    assert.equal(plan.updates[0].values.observacao, 'Produto A: 2');
    assert.equal(plan.inserts.find((row) => row.item_key === 'qtd_produtos_deposito')?.valor_texto, '0');
    assert.equal(plan.updates.some((row) => row.id === 'legacy-row'), false);
    assert.equal(plan.inserts.some((row) => row.item_key === 'controle_legado'), false);
  });

  it('aceita imagens até 5 MiB e rejeita arquivos inválidos ou acima do limite', () => {
    assert.equal(isSupportedVisitPhoto('image/jpeg'), true);
    assert.equal(isSupportedVisitPhoto('image/svg+xml'), false);
    assert.equal(isSupportedVisitPhoto('application/pdf'), false);
    assert.equal(isWithinVisitPhotoLimit(5 * 1024 * 1024), true);
    assert.equal(isWithinVisitPhotoLimit(5 * 1024 * 1024 + 1), false);
  });
});
