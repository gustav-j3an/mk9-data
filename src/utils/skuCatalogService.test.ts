import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateSkuImportRows,
  createPromoterSkuSuggestion,
  resolveSkuApproval
} from './skuCatalogService';

test('skuCatalogService: validateSkuImportRows validates mandatory fields and formats', () => {
  const rawRows = [
    { sku: 'SKU-001', produto: 'Arroz 5kg', ean: '7891234567890', industria: 'IND01' },
    { sku: 'SKU-002', produto: 'Feijão 1kg', ean: 'invalid-ean', industria: 'IND01' },
    { sku: '', produto: 'Macarrão', industria: 'IND01' },
    { sku: 'SKU-001', produto: 'Arroz Duplicado', industria: 'IND01' }
  ];

  const result = validateSkuImportRows(rawRows);

  assert.equal(result.validRows.length, 1);
  assert.equal(result.validRows[0].codigo_sku, 'SKU-001');
  assert.equal(result.validRows[0].nome_produto, 'Arroz 5kg');
  assert.equal(result.validRows[0].status, 'ativo');

  assert.equal(result.invalidRows.length, 3);
  // Row 2: invalid EAN
  assert.match(result.invalidRows[0].errors[0], /EAN deve conter/);
  // Row 3: empty SKU
  assert.match(result.invalidRows[1].errors[0], /Código SKU é obrigatório/);
  // Row 4: duplicate SKU
  assert.match(result.invalidRows[2].errors[0], /SKU duplicado/);
});

test('skuCatalogService: createPromoterSkuSuggestion creates pending item with promoter tracking', () => {
  const suggestion = createPromoterSkuSuggestion(
    'IND01',
    'SKU-NOVO-99',
    'Biscoito Recheado 140g',
    'PROM001',
    '7899999999999'
  );

  assert.equal(suggestion.status, 'pendente');
  assert.equal(suggestion.origem_cadastro, 'promotor_sugestao');
  assert.equal(suggestion.sugerido_por_matricula, 'PROM001');
  assert.equal(suggestion.codigo_sku, 'SKU-NOVO-99');
  assert.equal(suggestion.nome_produto, 'Biscoito Recheado 140g');
});

test('skuCatalogService: resolveSkuApproval approves or rejects with audit record', () => {
  const suggestion = createPromoterSkuSuggestion(
    'IND01',
    'SKU-NOVO-99',
    'Biscoito Recheado 140g',
    'PROM001'
  );

  // Aprovação
  const approved = resolveSkuApproval(suggestion, true, 'admin-uuid-123');
  assert.equal(approved.status, 'ativo');
  assert.equal(approved.aprovado_por_user_id, 'admin-uuid-123');
  assert.ok(approved.aprovado_em);

  // Rejeição
  const rejected = resolveSkuApproval(suggestion, false, 'admin-uuid-123');
  assert.equal(rejected.status, 'rejeitado');
  assert.equal(rejected.aprovado_por_user_id, 'admin-uuid-123');
});
