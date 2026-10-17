import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CHECKLIST_QUANTITY_KEYS } from './visitExecution';
import { buildGoogleMapsDirectionsUrl } from './googleMaps';

describe('Operational Dashboard Logic & Consistency', () => {
  it('diferencia itens de quantidade do novo checklist de itens históricos legados', () => {
    const rawItems = [
      { item_key: 'qtd_produtos_venda', item_label: 'Quantidade na área de vendas', checked: false, valor_texto: '15' },
      { item_key: 'qtd_produtos_deposito', item_label: 'Quantidade disponível no depósito', checked: false, valor_texto: '30' },
      { item_key: 'loja_aberta', item_label: 'Loja aberta em funcionamento', checked: true, valor_texto: null },
      { item_key: 'preco_correto', item_label: 'Preço etiquetado visível ao consumidor?', checked: true, valor_texto: null }
    ];

    const currentItems = rawItems.filter(item => CHECKLIST_QUANTITY_KEYS.has(item.item_key));
    const legacyItems = rawItems.filter(item => !CHECKLIST_QUANTITY_KEYS.has(item.item_key));

    assert.equal(currentItems.length, 2);
    assert.equal(legacyItems.length, 2);
    assert.equal(currentItems[0].valor_texto, '15');
    assert.equal(currentItems[1].valor_texto, '30');
  });

  it('calcula itens concluídos no checklist considerando valores numéricos e checks legados', () => {
    const visits = [
      {
        id: 'visit-new',
        checklist_items: [
          { item_key: 'qtd_produtos_venda', checked: false, valor_texto: '10' },
          { item_key: 'qtd_produtos_deposito', checked: false, valor_texto: '20' }
        ]
      },
      {
        id: 'visit-legacy',
        checklist_items: [
          { item_key: 'loja_aberta', checked: true, valor_texto: null },
          { item_key: 'produto_venda', checked: false, valor_texto: null }
        ]
      }
    ];

    let totalItems = 0;
    let totalChecked = 0;

    visits.forEach(v => {
      totalItems += v.checklist_items.length;
      totalChecked += v.checklist_items.filter(c => {
        if (CHECKLIST_QUANTITY_KEYS.has(c.item_key)) {
          return Boolean(c.valor_texto && c.valor_texto.trim() !== '');
        }
        return Boolean(c.checked);
      }).length;
    });

    assert.equal(totalItems, 4);
    assert.equal(totalChecked, 3); // 2 da visita nova (preenchidos) + 1 da legada (checked=true)
  });

  it('gera URL de rota para o destino da loja sem usar coordenadas do promotor', () => {
    const loja = {
      nome: 'ASSAI - TAGUATINGA SHOPPING',
      endereco: 'QS 01 Rua 210 Lote 40',
      cidade: 'Taguatinga',
      uf: 'DF'
    };

    const url = buildGoogleMapsDirectionsUrl({
      name: loja.nome,
      address: loja.endereco,
      city: loja.cidade,
      uf: loja.uf
    });

    assert.ok(url);
    assert.match(url, /api=1/);
    assert.match(url, /destination=ASSAI(\+|\%20)-(\+|\%20)TAGUATINGA(\+|\%20)SHOPPING/);
    assert.match(url, /Taguatinga/);
    assert.match(url, /DF/);
  });

  it('alinha os contadores de ruptura ao contexto selecionado preservando total geral', () => {
    const todasRupturas = [
      { id: '1', lojaCodigo: 'LOJA_A', industriaCodigo: 'KING', resolvido: false },
      { id: '2', lojaCodigo: 'LOJA_B', industriaCodigo: 'DON_CREAM', resolvido: false },
      { id: '3', lojaCodigo: 'LOJA_A', industriaCodigo: 'KING', resolvido: true }
    ];

    const filterIndustria: string = 'DON_CREAM';
    const filterLoja: string = 'all';

    const rupturasFiltradasContexto = todasRupturas.filter(r => {
      const matchInd = filterIndustria === 'all' || r.industriaCodigo === filterIndustria;
      const matchLoja = filterLoja === 'all' || r.lojaCodigo === filterLoja;
      return matchInd && matchLoja;
    });

    const totalGeral = todasRupturas.length;
    const abertasContexto = rupturasFiltradasContexto.filter(r => !r.resolvido).length;
    const resolvidasContexto = rupturasFiltradasContexto.filter(r => r.resolvido).length;

    assert.equal(totalGeral, 3);
    assert.equal(rupturasFiltradasContexto.length, 1);
    assert.equal(abertasContexto, 1);
    assert.equal(resolvidasContexto, 0);
  });
});
