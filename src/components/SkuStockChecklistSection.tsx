import React, { useState } from 'react';
import type { SkuCatalogItem } from '../utils/skuCatalogService';
import type { StoreSkuChecklistState, VisitChecklistProgress } from '../utils/skuStockOperations';
import { calculateChecklistProgress } from '../utils/skuStockOperations';

interface SkuStockChecklistSectionProps {
  checklist: Record<string, StoreSkuChecklistState>;
  onUpdateSku: (skuCode: string, patch: Partial<StoreSkuChecklistState>) => void;
  onSuggestSku: (skuCode: string, nomeProduto: string, ean?: string) => Promise<void>;
  photosCount: number;
  disabled?: boolean;
}

export const SkuStockChecklistSection: React.FC<SkuStockChecklistSectionProps> = ({
  checklist,
  onUpdateSku,
  onSuggestSku,
  photosCount,
  disabled = false
}) => {
  const [showSuggestionModal, setShowSuggestionModal] = useState(false);
  const [sugSkuCode, setSugSkuCode] = useState('');
  const [sugNomeProduto, setSugNomeProduto] = useState('');
  const [sugEan, setSugEan] = useState('');
  const [submittingSug, setSubmittingSug] = useState(false);

  const items = Object.values(checklist);
  const progress: VisitChecklistProgress = calculateChecklistProgress(checklist, photosCount, 1);

  const handleOpenSuggest = () => {
    setSugSkuCode('');
    setSugNomeProduto('');
    setSugEan('');
    setShowSuggestionModal(true);
  };

  const handleConfirmSuggest = async () => {
    if (!sugSkuCode.trim() || !sugNomeProduto.trim()) return;
    setSubmittingSug(true);
    try {
      await onSuggestSku(sugSkuCode.trim().toUpperCase(), sugNomeProduto.trim(), sugEan.trim() || undefined);
      setShowSuggestionModal(false);
    } finally {
      setSubmittingSug(false);
    }
  };

  return (
    <div className="space-y-4 pt-3 border-t border-[#CFCDC5]">
      {/* HEADER DA SEÇÃO COM PROGRESSO */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h3 className="text-xs font-bold text-[#171717] uppercase tracking-wider font-mono flex items-center gap-2">
          <span className="material-symbols-outlined text-purple-700 text-sm">inventory</span>
          2. Conferência Obrigatória de SKUs da Indústria
        </h3>

        <div className="flex items-center gap-2 font-mono text-xs">
          <span
            className={`px-2.5 py-0.5 rounded-full font-bold border ${
              progress.isComplete
                ? 'bg-emerald-100 text-emerald-950 border-emerald-300'
                : 'bg-amber-100 text-amber-950 border-amber-300'
            }`}
          >
            {progress.confirmedCount + progress.justifiedCount} de {progress.totalSkus} SKUs conferidos
          </span>

          <button
            type="button"
            onClick={handleOpenSuggest}
            disabled={disabled}
            className="px-2.5 py-1 rounded-lg bg-[#EAE8E2] hover:bg-[#CFCDC5] text-[#171717] font-bold text-[11px] flex items-center gap-1 cursor-pointer transition-colors border border-[#CFCDC5]"
            title="Sugerir um novo SKU encontrado na loja para aprovação"
          >
            <span className="material-symbols-outlined text-xs text-purple-700">add_circle</span>
            <span>Sugerir Novo SKU</span>
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="p-4 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] text-xs font-mono text-[#5F5F5F] italic text-center">
          Esta indústria ainda não possui catálogo oficial de SKUs cadastrado. A finalização da visita seguirá as regras operacionais gerais.
        </div>
      ) : (
        <div className="space-y-3 font-mono text-xs">
          {items.map(({ sku, quantidade_venda, quantidade_deposito, quantidade_reposicao, quantidade_anterior_venda, conferido, justificativa, observacao }) => (
            <div
              key={sku.codigo_sku}
              className={`p-3 rounded-xl border transition-colors ${
                conferido
                  ? 'bg-emerald-50/60 border-emerald-300'
                  : justificativa
                  ? 'bg-amber-50/60 border-amber-300'
                  : 'bg-[#EAE8E2] border-[#CFCDC5]'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#CFCDC5] pb-2 mb-2">
                <div>
                  <span className="font-bold text-purple-950 text-xs block">
                    {sku.nome_produto} <span className="text-[#5F5F5F]">({sku.codigo_sku})</span>
                  </span>
                  {sku.ean && <span className="text-[10px] text-[#77766F] block">EAN: {sku.ean}</span>}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onUpdateSku(sku.codigo_sku, { conferido: !conferido, justificativa: undefined })}
                    className={`px-3 py-1 rounded-lg font-bold text-xs flex items-center gap-1 cursor-pointer transition-colors ${
                      conferido
                        ? 'bg-emerald-700 text-white shadow-xs'
                        : 'bg-[#F7F6F2] text-[#171717] border border-[#CFCDC5] hover:bg-[#E4E2DB]'
                    }`}
                  >
                    <span className="material-symbols-outlined text-sm">{conferido ? 'check_circle' : 'radio_button_unchecked'}</span>
                    <span>{conferido ? 'Confirmado' : 'Confirmar Presença'}</span>
                  </button>

                  <select
                    disabled={disabled || conferido}
                    value={justificativa || ''}
                    onChange={(e) => {
                      const val = e.target.value as any;
                      onUpdateSku(sku.codigo_sku, {
                        justificativa: val || undefined,
                        conferido: false
                      });
                    }}
                    className="h-8 px-2 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg text-xs text-[#171717] disabled:opacity-50"
                  >
                    <option value="">Status / Justificativa...</option>
                    <option value="nao_encontrado">Não Encontrado (Ruptura)</option>
                    <option value="nao_comercializado">Não Comercializado Nesta Loja</option>
                    <option value="inacessivel">Depósito Inacessível</option>
                    <option value="outro">Outro Motivo</option>
                  </select>
                </div>
              </div>

              {/* CAMPOS DE QUANTIDADES OPERACIONAIS */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-1 text-[11px]">
                <div className="p-2 rounded-lg bg-[#F7F6F2] border border-[#CFCDC5]">
                  <span className="text-[#77766F] block mb-0.5">Última Visita (Ref):</span>
                  <span className="font-bold text-[#171717]">
                    {quantidade_anterior_venda ?? 0} unid.
                  </span>
                </div>

                <div>
                  <label className="text-[#77766F] block mb-0.5">Área de Vendas:</label>
                  <input
                    type="number"
                    min="0"
                    disabled={disabled || Boolean(justificativa)}
                    value={quantidade_venda}
                    onChange={(e) => onUpdateSku(sku.codigo_sku, { quantidade_venda: Math.max(0, parseInt(e.target.value) || 0) })}
                    className="w-full h-8 px-2 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg text-xs text-[#171717] font-bold disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="text-[#77766F] block mb-0.5">Depósito / Estoque:</label>
                  <input
                    type="number"
                    min="0"
                    disabled={disabled || Boolean(justificativa)}
                    value={quantidade_deposito}
                    onChange={(e) => onUpdateSku(sku.codigo_sku, { quantidade_deposito: Math.max(0, parseInt(e.target.value) || 0) })}
                    className="w-full h-8 px-2 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg text-xs text-[#171717] font-bold disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="text-[#77766F] block mb-0.5">Reposição Efetuada:</label>
                  <input
                    type="number"
                    min="0"
                    disabled={disabled || Boolean(justificativa)}
                    value={quantidade_reposicao}
                    onChange={(e) => onUpdateSku(sku.codigo_sku, { quantidade_reposicao: Math.max(0, parseInt(e.target.value) || 0) })}
                    className="w-full h-8 px-2 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg text-xs text-[#171717] font-bold disabled:opacity-50"
                  />
                </div>
              </div>

              {justificativa && (
                <div className="mt-2 pt-2 border-t border-amber-200">
                  <input
                    type="text"
                    disabled={disabled}
                    value={observacao || ''}
                    onChange={(e) => onUpdateSku(sku.codigo_sku, { observacao: e.target.value })}
                    placeholder="Descreva o motivo da ausência ou justificativa..."
                    className="w-full h-8 px-2 bg-[#F7F6F2] border border-amber-300 rounded-lg text-xs text-[#171717]"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* MODAL DE SUGESTÃO DE NOVO SKU PELO PROMOTOR */}
      {showSuggestionModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl max-w-md w-full p-5 space-y-4 font-mono shadow-2xl">
            <h3 className="text-sm font-bold text-[#171717] uppercase flex items-center gap-2">
              <span className="material-symbols-outlined text-sm text-purple-700">add_circle</span>
              Sugerir Novo SKU para a Indústria
            </h3>
            <p className="text-xs text-[#5F5F5F]">
              O produto sugerido será encaminhado para análise da equipe administrativa e permanecerá como pendente até aprovação.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-[#77766F] block mb-1">CÓDIGO SKU (*)</label>
                <input
                  type="text"
                  value={sugSkuCode}
                  onChange={(e) => setSugSkuCode(e.target.value)}
                  placeholder="Ex: SKU-909"
                  className="w-full h-9 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-lg text-[#171717] uppercase"
                />
              </div>

              <div>
                <label className="text-[#77766F] block mb-1">NOME DO PRODUTO (*)</label>
                <input
                  type="text"
                  value={sugNomeProduto}
                  onChange={(e) => setSugNomeProduto(e.target.value)}
                  placeholder="Ex: Wafer Chocolate Branco 120g"
                  className="w-full h-9 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-lg text-[#171717]"
                />
              </div>

              <div>
                <label className="text-[#77766F] block mb-1">CÓDIGO DE BARRAS (EAN)</label>
                <input
                  type="text"
                  value={sugEan}
                  onChange={(e) => setSugEan(e.target.value.replace(/\D/g, ''))}
                  placeholder="Ex: 7891234567890"
                  className="w-full h-9 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-lg text-[#171717]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#CFCDC5]">
              <button
                type="button"
                onClick={() => setShowSuggestionModal(false)}
                className="px-3 py-1.5 rounded-lg bg-[#EAE8E2] text-[#171717] font-bold text-xs cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmSuggest}
                disabled={submittingSug || !sugSkuCode.trim() || !sugNomeProduto.trim()}
                className="px-4 py-1.5 rounded-lg bg-purple-700 hover:bg-purple-600 text-white font-bold text-xs cursor-pointer shadow-xs disabled:opacity-50"
              >
                {submittingSug ? 'Enviando...' : 'Enviar Sugestão'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
