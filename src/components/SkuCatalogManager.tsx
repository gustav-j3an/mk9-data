import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import type { IndustryItem } from '../types';
import {
  validateSkuImportRows,
  resolveSkuApproval,
  type SkuCatalogItem,
  type SkuValidationResult
} from '../utils/skuCatalogService';

interface SkuCatalogManagerProps {
  industries: IndustryItem[];
  userRole?: string;
  currentUserId?: string;
  onShowToast: (toast: { title: string; message: string; type: 'success' | 'warning' | 'error' | 'info' }) => void;
}

export const SkuCatalogManager: React.FC<SkuCatalogManagerProps> = ({
  industries,
  userRole = 'admin',
  currentUserId,
  onShowToast
}) => {
  const isAdminOrGestor = userRole === 'admin' || userRole === 'gestor';

  const [selectedIndCode, setSelectedIndCode] = useState<string>(industries[0]?.codigo || '');
  const [skus, setSkus] = useState<SkuCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'todos' | 'ativo' | 'inativo' | 'pendente' | 'rejeitado'>('todos');
  const [searchTerm, setSearchTerm] = useState('');

  // Estados de Importação Excel
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<SkuValidationResult | null>(null);

  // Estados de Criação / Edição Manual
  const [showManualModal, setShowManualModal] = useState(false);
  const [editingSku, setEditingSku] = useState<SkuCatalogItem | null>(null);
  const [manualSkuCode, setManualSkuCode] = useState('');
  const [manualSkuNome, setManualSkuNome] = useState('');
  const [manualSkuEan, setManualSkuEan] = useState('');
  const [manualSkuStatus, setManualSkuStatus] = useState<'ativo' | 'inativo'>('ativo');

  // Carregar catálogo de SKUs da indústria selecionada
  const loadSkus = async () => {
    if (!selectedIndCode || !supabase) return;
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from('industria_skus')
        .select('*')
        .eq('industria_codigo', selectedIndCode)
        .order('nome_produto', { ascending: true });

      if (error) {
        if (error.code === '42P01' || error.message?.includes('industria_skus')) {
          setSkus([]);
          return;
        }
        throw error;
      }

      setSkus((data as SkuCatalogItem[]) || []);
    } catch (err: any) {
      console.warn('Aviso ao carregar SKUs:', err);
      setSkus([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSkus();
  }, [selectedIndCode]);

  // Handler para Upload de Planilha Excel
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);

        const result = validateSkuImportRows(data, selectedIndCode);
        setImportPreview(result);

        if (result.validRows.length === 0) {
          onShowToast({
            title: 'Planilha Sem Registros Válidos',
            message: 'Nenhum SKU válido encontrado no arquivo.',
            type: 'warning'
          });
        }
      } catch (parseErr: any) {
        console.error('Erro ao ler planilha Excel:', parseErr);
        onShowToast({
          title: 'Erro na Planilha',
          message: 'Não foi possível ler o arquivo Excel selecionado.',
          type: 'error'
        });
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  // Confirmar Importação em Lote
  const handleConfirmImport = async () => {
    if (!importPreview || importPreview.validRows.length === 0 || !supabase) return;
    setImporting(true);

    try {
      const { error } = await supabase.from('industria_skus').upsert(
        importPreview.validRows.map((r) => ({
          industria_codigo: r.industria_codigo,
          codigo_sku: r.codigo_sku,
          nome_produto: r.nome_produto,
          ean: r.ean || null,
          status: r.status,
          origem_cadastro: 'admin_import',
          updated_at: new Date().toISOString()
        })),
        { onConflict: 'industria_codigo,codigo_sku' }
      );

      if (error) {
        if (error.code === '42P01') {
          throw new Error('A tabela industria_skus ainda não existe no banco (migração pendente).');
        }
        throw error;
      }

      onShowToast({
        title: 'SKUs Importados',
        message: `${importPreview.validRows.length} SKUs cadastrados/atualizados com sucesso!`,
        type: 'success'
      });

      setImportPreview(null);
      await loadSkus();
    } catch (err: any) {
      console.error('Erro ao persistir SKUs importados:', err);
      onShowToast({
        title: 'Falha na Importação',
        message: err.message || 'Erro ao salvar os SKUs no banco de dados.',
        type: 'error'
      });
    } finally {
      setImporting(false);
    }
  };

  // Salvar SKU Manual
  const handleSaveManualSku = async () => {
    if (!manualSkuCode.trim() || !manualSkuNome.trim() || !selectedIndCode || !supabase) return;

    try {
      const payload: Partial<SkuCatalogItem> = {
        industria_codigo: selectedIndCode,
        codigo_sku: manualSkuCode.trim().toUpperCase(),
        nome_produto: manualSkuNome.trim(),
        ean: manualSkuEan.trim() || undefined,
        status: manualSkuStatus,
        origem_cadastro: editingSku ? editingSku.origem_cadastro : 'admin_manual',
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase.from('industria_skus').upsert([payload], {
        onConflict: 'industria_codigo,codigo_sku'
      });

      if (error) throw error;

      onShowToast({
        title: 'Catálogo Atualizado',
        message: `SKU ${manualSkuCode} salvo com sucesso!`,
        type: 'success'
      });

      setShowManualModal(false);
      setEditingSku(null);
      setManualSkuCode('');
      setManualSkuNome('');
      setManualSkuEan('');
      await loadSkus();
    } catch (err: any) {
      console.error('Erro ao salvar SKU:', err);
      onShowToast({
        title: 'Erro ao Salvar SKU',
        message: err.message || 'Falha ao gravar SKU no catálogo.',
        type: 'error'
      });
    }
  };

  // Aprovar ou Rejeitar Sugestão de Promotor
  const handleResolveSuggestion = async (sku: SkuCatalogItem, approve: boolean) => {
    if (!supabase || !currentUserId) return;

    try {
      const resolved = resolveSkuApproval(sku, approve, currentUserId);
      const { error } = await supabase
        .from('industria_skus')
        .update({
          status: resolved.status,
          aprovado_por_user_id: resolved.aprovado_por_user_id,
          aprovado_em: resolved.aprovado_em,
          updated_at: new Date().toISOString()
        })
        .eq('industria_codigo', sku.industria_codigo)
        .eq('codigo_sku', sku.codigo_sku);

      if (error) throw error;

      onShowToast({
        title: approve ? 'SKU Aprovado' : 'SKU Rejeitado',
        message: `Sugestão de SKU ${sku.codigo_sku} foi ${approve ? 'incorporada ao catálogo' : 'rejeitada'}.`,
        type: approve ? 'success' : 'info'
      });

      await loadSkus();
    } catch (err: any) {
      console.error('Erro ao resolver sugestão de SKU:', err);
      onShowToast({
        title: 'Falha na Operação',
        message: err.message || 'Erro ao processar sugestão de SKU.',
        type: 'error'
      });
    }
  };

  // Filtragem dos SKUs em memória
  const filteredSkus = skus.filter((item) => {
    if (statusFilter !== 'todos' && item.status !== statusFilter) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const matchCode = item.codigo_sku.toLowerCase().includes(q);
      const matchName = item.nome_produto.toLowerCase().includes(q);
      const matchEan = item.ean?.includes(q);
      return matchCode || matchName || matchEan;
    }
    return true;
  });

  return (
    <div className="space-y-5 font-sans">
      {/* SELETOR DE INDÚSTRIA E BARRA DE CONTROLES */}
      <div className="p-4 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="text-xs font-bold text-[#171717] font-mono uppercase">Indústria:</label>
          <select
            value={selectedIndCode}
            onChange={(e) => setSelectedIndCode(e.target.value)}
            className="h-9 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-lg text-xs font-bold text-[#171717]"
          >
            {industries.map((ind) => (
              <option key={ind.codigo} value={ind.codigo}>
                {ind.nome} ({ind.codigo})
              </option>
            ))}
          </select>
        </div>

        {isAdminOrGestor && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
            >
              <span className="material-symbols-outlined text-sm">upload_file</span>
              <span>Importar Excel</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setEditingSku(null);
                setManualSkuCode('');
                setManualSkuNome('');
                setManualSkuEan('');
                setManualSkuStatus('ativo');
                setShowManualModal(true);
              }}
              className="px-3 py-1.5 rounded-lg bg-[#222222] hover:bg-black text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              <span>Novo SKU</span>
            </button>
          </div>
        )}
      </div>

      {/* MODAL DE PREVIEW DA IMPORTAÇÃO EXCEL */}
      {importPreview && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 space-y-3 font-mono text-xs shadow-md">
          <div className="flex items-center justify-between border-b border-amber-200 pb-2">
            <span className="font-bold text-amber-950 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm">preview</span>
              Prévia da Importação: {importPreview.validRows.length} SKUs válidos | {importPreview.invalidRows.length} erros
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setImportPreview(null)}
                className="px-2.5 py-1 rounded bg-[#EAE8E2] text-[#171717] font-bold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmImport}
                disabled={importing || importPreview.validRows.length === 0}
                className="px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-xs">{importing ? 'sync' : 'check'}</span>
                <span>{importing ? 'Salvando...' : 'Confirmar Importação'}</span>
              </button>
            </div>
          </div>

          {importPreview.invalidRows.length > 0 && (
            <div className="p-2 rounded bg-rose-50 border border-rose-200 text-rose-900 text-[11px] space-y-1">
              <span className="font-bold block">Linhas com inconsistência (não serão importadas):</span>
              {importPreview.invalidRows.slice(0, 5).map((inv, idx) => (
                <div key={idx}>Linha {inv.row}: {inv.errors.join(', ')}</div>
              ))}
              {importPreview.invalidRows.length > 5 && (
                <div className="italic">...e mais {importPreview.invalidRows.length - 5} linha(s).</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* FILTROS E BUSCA DO CATÁLOGO */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-mono text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[#77766F] font-bold">Status:</span>
          {(['todos', 'ativo', 'inativo', 'pendente', 'rejeitado'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-2.5 py-1 rounded-lg font-bold uppercase transition-colors cursor-pointer ${
                statusFilter === st
                  ? 'bg-[#171717] text-white'
                  : 'bg-[#EAE8E2] text-[#5F5F5F] hover:text-[#171717]'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        <div className="w-full sm:w-64">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por código, produto, EAN..."
            className="w-full h-8 px-2.5 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg text-xs text-[#171717]"
          />
        </div>
      </div>

      {/* GRADE DE SKUs DO CATÁLOGO */}
      <div className="overflow-x-auto rounded-xl border border-[#CFCDC5] bg-[#F7F6F2]">
        <table className="w-full text-left text-xs border-collapse font-mono">
          <thead>
            <tr className="bg-[#EAE8E2] border-b border-[#CFCDC5] text-[11px] font-bold text-[#171717] uppercase">
              <th className="py-2.5 px-3">Código SKU</th>
              <th className="py-2.5 px-3">Nome / Descrição</th>
              <th className="py-2.5 px-3">EAN</th>
              <th className="py-2.5 px-3">Origem</th>
              <th className="py-2.5 px-3 text-center">Status</th>
              {isAdminOrGestor && <th className="py-2.5 px-3 text-center">Ações</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#CFCDC5] text-[#171717]">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-[#77766F] italic">
                  Carregando catálogo de SKUs...
                </td>
              </tr>
            ) : filteredSkus.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-[#77766F] italic">
                  Nenhum SKU encontrado para os filtros selecionados.
                </td>
              </tr>
            ) : (
              filteredSkus.map((sku) => (
                <tr key={sku.codigo_sku} className="hover:bg-[#EAE8E2] transition-colors">
                  <td className="py-2.5 px-3 font-bold text-purple-900">{sku.codigo_sku}</td>
                  <td className="py-2.5 px-3 font-semibold">{sku.nome_produto}</td>
                  <td className="py-2.5 px-3 text-[#5F5F5F]">{sku.ean || '—'}</td>
                  <td className="py-2.5 px-3 text-[10px] text-[#77766F]">
                    {sku.origem_cadastro === 'promotor_sugestao'
                      ? `Sugestão (${sku.sugerido_por_matricula || 'Promotor'})`
                      : sku.origem_cadastro === 'admin_import'
                      ? 'Planilha'
                      : 'Manual'}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        sku.status === 'ativo'
                          ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                          : sku.status === 'pendente'
                          ? 'bg-amber-100 text-amber-950 border border-amber-300'
                          : sku.status === 'rejeitado'
                          ? 'bg-rose-100 text-rose-950 border border-rose-300'
                          : 'bg-slate-200 text-slate-800 border border-slate-300'
                      }`}
                    >
                      {sku.status}
                    </span>
                  </td>
                  {isAdminOrGestor && (
                    <td className="py-2.5 px-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {sku.status === 'pendente' ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleResolveSuggestion(sku, true)}
                              className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] cursor-pointer"
                              title="Aprovar e adicionar ao catálogo oficial"
                            >
                              Aprovar
                            </button>
                            <button
                              type="button"
                              onClick={() => handleResolveSuggestion(sku, false)}
                              className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold text-[10px] cursor-pointer"
                              title="Rejeitar sugestão"
                            >
                              Rejeitar
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingSku(sku);
                              setManualSkuCode(sku.codigo_sku);
                              setManualSkuNome(sku.nome_produto);
                              setManualSkuEan(sku.ean || '');
                              setManualSkuStatus(sku.status === 'inativo' ? 'inativo' : 'ativo');
                              setShowManualModal(true);
                            }}
                            className="p-1 rounded hover:bg-[#CFCDC5] text-[#171717] cursor-pointer"
                            title="Editar SKU"
                          >
                            <span className="material-symbols-outlined text-sm">edit</span>
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* MODAL MANUAL DE CRIAR / EDITAR SKU */}
      {showManualModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl max-w-md w-full p-5 space-y-4 font-mono shadow-2xl">
            <h3 className="text-sm font-bold text-[#171717] uppercase flex items-center gap-2">
              <span className="material-symbols-outlined text-sm text-purple-700">inventory_2</span>
              {editingSku ? 'Editar SKU' : 'Novo SKU no Catálogo'}
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-[#77766F] block mb-1">CÓDIGO SKU (*)</label>
                <input
                  type="text"
                  value={manualSkuCode}
                  onChange={(e) => setManualSkuCode(e.target.value)}
                  disabled={Boolean(editingSku)}
                  placeholder="Ex: SKU-1001"
                  className="w-full h-9 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-lg text-[#171717] uppercase disabled:opacity-60"
                />
              </div>

              <div>
                <label className="text-[#77766F] block mb-1">NOME / DESCRIÇÃO DO PRODUTO (*)</label>
                <input
                  type="text"
                  value={manualSkuNome}
                  onChange={(e) => setManualSkuNome(e.target.value)}
                  placeholder="Ex: Biscoito Recheado Chocolate 130g"
                  className="w-full h-9 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-lg text-[#171717]"
                />
              </div>

              <div>
                <label className="text-[#77766F] block mb-1">CÓDIGO DE BARRAS (EAN)</label>
                <input
                  type="text"
                  value={manualSkuEan}
                  onChange={(e) => setManualSkuEan(e.target.value.replace(/\D/g, ''))}
                  placeholder="Ex: 7891234567890"
                  className="w-full h-9 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-lg text-[#171717]"
                />
              </div>

              <div>
                <label className="text-[#77766F] block mb-1">STATUS</label>
                <select
                  value={manualSkuStatus}
                  onChange={(e) => setManualSkuStatus(e.target.value as any)}
                  className="w-full h-9 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-lg text-[#171717]"
                >
                  <option value="ativo">ATIVO</option>
                  <option value="inativo">INATIVO</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#CFCDC5]">
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="px-3 py-1.5 rounded-lg bg-[#EAE8E2] text-[#171717] font-bold text-xs cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveManualSku}
                className="px-4 py-1.5 rounded-lg bg-[#222222] hover:bg-black text-white font-bold text-xs cursor-pointer shadow-xs"
              >
                Salvar SKU
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
