import type { VisitChecklistItem } from '../types';

export const DEFAULT_CHECKLIST_ITEMS = [
  { item_key: 'qtd_produtos_venda', item_label: 'Quantidade na área de vendas' },
  { item_key: 'qtd_produtos_deposito', item_label: 'Quantidade disponível no depósito' }
];

export const CHECKLIST_GROUPS = [
  {
    title: '1. Estoque e área de vendas',
    itemKeys: ['qtd_produtos_venda']
  },
  {
    title: '2. Produto no depósito',
    itemKeys: ['qtd_produtos_deposito']
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
          answered: CHECKLIST_QUANTITY_KEYS.has(definition.item_key)
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
