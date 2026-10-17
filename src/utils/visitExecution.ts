import type { VisitChecklistItem } from '../types';

export const DEFAULT_CHECKLIST_ITEMS = [
  { item_key: 'loja_aberta', item_label: 'Loja aberta e em funcionamento' },
  { item_key: 'presenca_produto', item_label: 'Existe produto disponível para venda?' },
  { item_key: 'ruptura_gondola', item_label: 'Existe ruptura na gôndola?' },
  { item_key: 'qtd_frentes', item_label: 'Contagem e verificação da quantidade de frentes' },
  { item_key: 'qtd_produtos_venda', item_label: 'Quantidade na área de vendas' },
  { item_key: 'preco_encontrado', item_label: 'Preço etiquetado visível ao consumidor?' },
  { item_key: 'preco_conforme', item_label: 'Preço em conformidade com a tabela acordada?' },
  { item_key: 'ponto_extra', item_label: 'Produto exposto no PDC / ponto extra?' },
  { item_key: 'exposicao_organizada', item_label: 'Exposição abastecida e organizada?' },
  { item_key: 'material_pop', item_label: 'Material de merchandising e POP instalado?' },
  { item_key: 'validade_ok', item_label: 'Validade adequada dos lotes expostos (FIFO)?' },
  { item_key: 'estoque_disponivel', item_label: 'Existe produto no depósito?' },
  { item_key: 'qtd_produtos_deposito', item_label: 'Quantidade disponível no depósito' }
];

export const CHECKLIST_GROUPS = [
  {
    title: 'A. Estoque e ruptura',
    itemKeys: ['loja_aberta', 'presenca_produto', 'ruptura_gondola', 'qtd_frentes', 'qtd_produtos_venda']
  },
  {
    title: 'B. Produto no depósito',
    itemKeys: ['estoque_disponivel', 'qtd_produtos_deposito']
  },
  {
    title: 'C. PDC e exposição',
    itemKeys: ['ponto_extra', 'exposicao_organizada', 'material_pop', 'preco_encontrado', 'preco_conforme', 'validade_ok']
  }
];

export const CHECKLIST_QUANTITY_KEYS = new Set(['qtd_produtos_venda', 'qtd_produtos_deposito']);

export type ChecklistState = {
  checked: boolean;
  answered: boolean;
  obs: string;
  valTxt: string;
};

export const createChecklistState = (
  items?: VisitChecklistItem[]
): Record<string, ChecklistState> =>
  Object.fromEntries(
    DEFAULT_CHECKLIST_ITEMS.map((definition) => {
      const found = items?.find((item) => item.item_key === definition.item_key);
      return [
        definition.item_key,
        {
          checked: found?.checked ?? false,
          answered: CHECKLIST_QUANTITY_KEYS.has(definition.item_key) ||
            definition.item_key === 'qtd_frentes'
            ? Boolean(found?.valor_texto?.trim())
            : Boolean(found),
          obs: found?.observacao || '',
          valTxt: found?.valor_texto || ''
        }
      ];
    })
  );

export const findInvalidChecklistQuantity = (
  checklist: Record<string, ChecklistState>
): string | null => {
  for (const itemKey of CHECKLIST_QUANTITY_KEYS) {
    const value = checklist[itemKey]?.valTxt.trim();
    if (value && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) {
      return DEFAULT_CHECKLIST_ITEMS.find((item) => item.item_key === itemKey)?.item_label || itemKey;
    }
  }
  return null;
};

export interface ChecklistSyncPlan {
  updates: Array<{
    id: string;
    values: Pick<VisitChecklistItem, 'checked' | 'observacao' | 'valor_texto'>;
  }>;
  inserts: Array<{
    visit_id: string;
    item_key: string;
    item_label: string;
    checked: boolean;
    observacao: string | null;
    valor_texto: string | null;
  }>;
}

export const buildChecklistSyncPlan = (
  visitId: string,
  checklist: Record<string, ChecklistState>,
  existingRows: Array<Pick<VisitChecklistItem, 'id' | 'item_key'>>
): ChecklistSyncPlan => {
  const existingByKey = new Map(existingRows.map((row) => [row.item_key, row]));
  const updates: ChecklistSyncPlan['updates'] = [];
  const inserts: ChecklistSyncPlan['inserts'] = [];

  Object.entries(checklist).forEach(([key, item]) => {
    const values = {
      checked: item.checked,
      observacao: item.obs.trim() || null,
      valor_texto: item.valTxt.trim() || null
    };
    const existing = existingByKey.get(key);

    if (existing?.id) {
      updates.push({ id: existing.id, values });
    } else {
      const definition = DEFAULT_CHECKLIST_ITEMS.find((candidate) => candidate.item_key === key);
      inserts.push({
        visit_id: visitId,
        item_key: key,
        item_label: definition?.item_label || key,
        ...values
      });
    }
  });

  return { updates, inserts };
};

export const MAX_VISIT_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;

export const isSupportedVisitPhoto = (mimeType: string): boolean =>
  mimeType.toLowerCase().startsWith('image/') && mimeType.toLowerCase() !== 'image/svg+xml';

export const isWithinVisitPhotoLimit = (sizeInBytes: number): boolean =>
  sizeInBytes <= MAX_VISIT_PHOTO_SIZE_BYTES;
