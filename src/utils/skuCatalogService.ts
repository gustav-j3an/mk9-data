export interface SkuCatalogItem {
  id?: string;
  industria_codigo: string;
  codigo_sku: string;
  nome_produto: string;
  ean?: string;
  status: 'ativo' | 'inativo' | 'pendente' | 'rejeitado';
  origem_cadastro: 'admin_import' | 'admin_manual' | 'promotor_sugestao';
  sugerido_por_matricula?: string;
  aprovado_por_user_id?: string;
  aprovado_em?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SkuImportRow {
  codigo_sku: string;
  nome_produto: string;
  ean?: string;
  industria_codigo: string;
  status?: string;
}

export interface SkuValidationResult {
  validRows: SkuCatalogItem[];
  invalidRows: Array<{ row: number; data: any; errors: string[] }>;
}

export const validateSkuImportRows = (
  rawRows: any[],
  targetIndustriaCodigo?: string
): SkuValidationResult => {
  const validRows: SkuCatalogItem[] = [];
  const invalidRows: Array<{ row: number; data: any; errors: string[] }> = [];
  const seenSkus = new Set<string>();

  rawRows.forEach((row, index) => {
    const rowNum = index + 1;
    const errors: string[] = [];

    const rawSku = String(row.codigo_sku || row.sku || row.codigo || '').trim();
    const rawNome = String(row.nome_produto || row.produto || row.descricao || '').trim();
    const rawEan = String(row.ean || row.codigo_barras || '').trim();
    const rawInd = String(row.industria_codigo || row.industria || targetIndustriaCodigo || '').trim();
    const rawStatus = String(row.status || 'ativo').toLowerCase().trim();

    if (!rawSku) {
      errors.push('Código SKU é obrigatório');
    }
    if (!rawNome) {
      errors.push('Nome / Descrição do produto é obrigatório');
    }
    if (!rawInd) {
      errors.push('Código da indústria responsável é obrigatório');
    }

    if (rawEan && !/^\d{8,14}$/.test(rawEan)) {
      errors.push('EAN deve conter entre 8 e 14 dígitos numéricos quando informado');
    }

    const uniqueKey = `${rawInd}_${rawSku}`.toUpperCase();
    if (seenSkus.has(uniqueKey)) {
      errors.push(`SKU duplicado na mesma indústria: ${rawSku}`);
    } else if (rawSku && rawInd) {
      seenSkus.add(uniqueKey);
    }

    if (errors.length > 0) {
      invalidRows.push({ row: rowNum, data: row, errors });
    } else {
      validRows.push({
        industria_codigo: rawInd,
        codigo_sku: rawSku,
        nome_produto: rawNome,
        ean: rawEan || undefined,
        status: rawStatus === 'inativo' ? 'inativo' : 'ativo',
        origem_cadastro: 'admin_import'
      });
    }
  });

  return { validRows, invalidRows };
};

export const createPromoterSkuSuggestion = (
  industriaCodigo: string,
  codigoSku: string,
  nomeProduto: string,
  promotorMatricula: string,
  ean?: string
): SkuCatalogItem => {
  const cleanSku = codigoSku.trim();
  const cleanNome = nomeProduto.trim();
  const cleanEan = (ean || '').trim();

  if (!cleanSku || !cleanNome || !industriaCodigo || !promotorMatricula) {
    throw new Error('Campos obrigatórios ausentes para sugestão de SKU');
  }

  return {
    industria_codigo: industriaCodigo,
    codigo_sku: cleanSku,
    nome_produto: cleanNome,
    ean: cleanEan || undefined,
    status: 'pendente', // Sempre pendente até aprovação administrativa
    origem_cadastro: 'promotor_sugestao',
    sugerido_por_matricula: promotorMatricula
  };
};

export const resolveSkuApproval = (
  sku: SkuCatalogItem,
  approved: boolean,
  adminUserId: string
): SkuCatalogItem => {
  if (!adminUserId) {
    throw new Error('Identificação do administrador é obrigatória para aprovar ou rejeitar SKU');
  }

  return {
    ...sku,
    status: approved ? 'ativo' : 'rejeitado',
    aprovado_por_user_id: adminUserId,
    aprovado_em: new Date().toISOString()
  };
};
