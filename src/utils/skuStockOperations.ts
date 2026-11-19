import type { SkuCatalogItem } from './skuCatalogService';

export interface StoreSkuStockRecord {
  id?: string;
  industria_codigo: string;
  loja_codigo: string;
  codigo_sku: string;
  visit_id: string;
  data_conferencia: string;
  quantidade_venda: number;
  quantidade_deposito: number;
  quantidade_reposicao: number;
  quantidade_anterior_venda?: number;
  quantidade_anterior_deposito?: number;
  status_conferencia: 'conferido' | 'justificado' | 'pendente';
  justificativa?: 'nao_encontrado' | 'nao_comercializado' | 'inacessivel' | 'outro';
  observacao?: string;
  conferido_por_matricula: string;
  created_at?: string;
}

export interface StoreSkuChecklistState {
  sku: SkuCatalogItem;
  quantidade_venda: number;
  quantidade_deposito: number;
  quantidade_reposicao: number;
  quantidade_anterior_venda: number;
  quantidade_anterior_deposito: number;
  conferido: boolean;
  justificativa?: StoreSkuStockRecord['justificativa'];
  observacao?: string;
}

export interface VisitChecklistProgress {
  totalSkus: number;
  confirmedCount: number;
  justifiedCount: number;
  pendingCount: number;
  isComplete: boolean;
  canFinalize: boolean;
  pendingSkus: SkuCatalogItem[];
}

export const buildStoreSkuChecklist = (
  officialSkus: SkuCatalogItem[],
  previousRecords: StoreSkuStockRecord[] = []
): Record<string, StoreSkuChecklistState> => {
  const result: Record<string, StoreSkuChecklistState> = {};

  const previousMap = new Map<string, StoreSkuStockRecord>(
    previousRecords.map((r) => [r.codigo_sku, r])
  );

  for (const sku of officialSkus) {
    if (sku.status !== 'ativo') continue;

    const prev = previousMap.get(sku.codigo_sku);
    result[sku.codigo_sku] = {
      sku,
      quantidade_venda: prev ? prev.quantidade_venda : 0,
      quantidade_deposito: prev ? prev.quantidade_deposito : 0,
      quantidade_reposicao: 0,
      quantidade_anterior_venda: prev ? prev.quantidade_venda : 0,
      quantidade_anterior_deposito: prev ? prev.quantidade_deposito : 0,
      conferido: false, // O promotor DEVE confirmar na visita atual
      justificativa: undefined,
      observacao: ''
    };
  }

  return result;
};

export const calculateChecklistProgress = (
  checklistState: Record<string, StoreSkuChecklistState>,
  photosCount: number = 0,
  minRequiredPhotos: number = 1
): VisitChecklistProgress => {
  const items = Object.values(checklistState);
  const totalSkus = items.length;

  let confirmedCount = 0;
  let justifiedCount = 0;
  const pendingSkus: SkuCatalogItem[] = [];

  for (const item of items) {
    if (item.conferido) {
      confirmedCount++;
    } else if (item.justificativa) {
      justifiedCount++;
    } else {
      pendingSkus.push(item.sku);
    }
  }

  const pendingCount = pendingSkus.length;
  const isComplete = totalSkus > 0 && pendingCount === 0;
  const hasPhotos = photosCount >= minRequiredPhotos;
  const canFinalize = (totalSkus === 0 || isComplete) && hasPhotos;

  return {
    totalSkus,
    confirmedCount,
    justifiedCount,
    pendingCount,
    isComplete,
    canFinalize,
    pendingSkus
  };
};

export interface StockSkuReportFilter {
  industria_codigo?: string;
  loja_codigo?: string;
  promotor_matricula?: string;
  startDate?: string;
  endDate?: string;
  rupturaOnly?: boolean;
}

export const filterStockSkuReports = (
  records: StoreSkuStockRecord[],
  filter: StockSkuReportFilter
): StoreSkuStockRecord[] => {
  return records.filter((r) => {
    if (filter.industria_codigo && r.industria_codigo !== filter.industria_codigo) return false;
    if (filter.loja_codigo && r.loja_codigo !== filter.loja_codigo) return false;
    if (filter.promotor_matricula && r.conferido_por_matricula !== filter.promotor_matricula) return false;
    if (filter.startDate && r.data_conferencia < filter.startDate) return false;
    if (filter.endDate && r.data_conferencia > filter.endDate) return false;
    if (filter.rupturaOnly && r.quantidade_venda > 0) return false;
    return true;
  });
};
