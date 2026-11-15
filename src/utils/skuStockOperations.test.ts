import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStoreSkuChecklist,
  calculateChecklistProgress,
  filterStockSkuReports,
  type StoreSkuStockRecord
} from './skuStockOperations';
import type { SkuCatalogItem } from './skuCatalogService';

const mockSkus: SkuCatalogItem[] = [
  { industria_codigo: 'IND01', codigo_sku: 'SKU-1', nome_produto: 'Sabão em Pó 1kg', status: 'ativo', origem_cadastro: 'admin_manual' },
  { industria_codigo: 'IND01', codigo_sku: 'SKU-2', nome_produto: 'Detergente 500ml', status: 'ativo', origem_cadastro: 'admin_manual' },
  { industria_codigo: 'IND01', codigo_sku: 'SKU-INATIVO', nome_produto: 'Desinfetante', status: 'inativo', origem_cadastro: 'admin_manual' }
];

test('skuStockOperations: buildStoreSkuChecklist loads previous quantities but requires confirmation', () => {
  const previousRecords: StoreSkuStockRecord[] = [
    {
      industria_codigo: 'IND01',
      loja_codigo: 'LOJA01',
      codigo_sku: 'SKU-1',
      visit_id: 'v-old',
      data_conferencia: '2026-11-08',
      quantidade_venda: 15,
      quantidade_deposito: 30,
      quantidade_reposicao: 10,
      status_conferencia: 'conferido',
      conferido_por_matricula: 'PROM001'
    }
  ];

  const checklist = buildStoreSkuChecklist(mockSkus, previousRecords);

  // SKU-INATIVO não deve entrar
  assert.equal(Object.keys(checklist).length, 2);

  // SKU-1 carrega as quantidades anteriores como referência mas começa NÃO CONFERIDO
  assert.equal(checklist['SKU-1'].quantidade_anterior_venda, 15);
  assert.equal(checklist['SKU-1'].quantidade_anterior_deposito, 30);
  assert.equal(checklist['SKU-1'].conferido, false);

  // SKU-2 sem histórico anterior começa com 0
  assert.equal(checklist['SKU-2'].quantidade_anterior_venda, 0);
  assert.equal(checklist['SKU-2'].conferido, false);
});

test('skuStockOperations: calculateChecklistProgress accurately calculates completion & photo gates', () => {
  const checklist = buildStoreSkuChecklist(mockSkus);

  // Inicialmente: 2 pendentes, 0 fotos -> não pode finalizar
  const initialProgress = calculateChecklistProgress(checklist, 0);
  assert.equal(initialProgress.totalSkus, 2);
  assert.equal(initialProgress.pendingCount, 2);
  assert.equal(initialProgress.isComplete, false);
  assert.equal(initialProgress.canFinalize, false);

  // Promotor confere SKU-1 e justifica SKU-2
  checklist['SKU-1'].conferido = true;
  checklist['SKU-2'].justificativa = 'nao_encontrado';

  // Checklist 100% resolvido mas sem foto -> canFinalize = false
  const progressNoPhotos = calculateChecklistProgress(checklist, 0);
  assert.equal(progressNoPhotos.pendingCount, 0);
  assert.equal(progressNoPhotos.isComplete, true);
  assert.equal(progressNoPhotos.canFinalize, false);

  // Checklist 100% resolvido com 1 foto anexada -> canFinalize = true
  const progressComplete = calculateChecklistProgress(checklist, 1);
  assert.equal(progressComplete.canFinalize, true);
});

test('skuStockOperations: filterStockSkuReports filters by store, date, rupture and promoter', () => {
  const records: StoreSkuStockRecord[] = [
    {
      industria_codigo: 'IND01',
      loja_codigo: 'LOJA01',
      codigo_sku: 'SKU-1',
      visit_id: 'v1',
      data_conferencia: '2026-11-10',
      quantidade_venda: 0, // Ruptura na área de vendas
      quantidade_deposito: 5,
      quantidade_reposicao: 0,
      status_conferencia: 'conferido',
      conferido_por_matricula: 'P1'
    },
    {
      industria_codigo: 'IND01',
      loja_codigo: 'LOJA02',
      codigo_sku: 'SKU-1',
      visit_id: 'v2',
      data_conferencia: '2026-11-12',
      quantidade_venda: 10,
      quantidade_deposito: 20,
      quantidade_reposicao: 5,
      status_conferencia: 'conferido',
      conferido_por_matricula: 'P2'
    }
  ];

  // Filtro por Loja 1
  const filterLoja1 = filterStockSkuReports(records, { loja_codigo: 'LOJA01' });
  assert.equal(filterLoja1.length, 1);
  assert.equal(filterLoja1[0].loja_codigo, 'LOJA01');

  // Filtro por Ruptura
  const filterRuptura = filterStockSkuReports(records, { rupturaOnly: true });
  assert.equal(filterRuptura.length, 1);
  assert.equal(filterRuptura[0].quantidade_venda, 0);

  // Filtro por Promotor P2
  const filterP2 = filterStockSkuReports(records, { promotor_matricula: 'P2' });
  assert.equal(filterP2.length, 1);
  assert.equal(filterP2[0].conferido_por_matricula, 'P2');
});
