import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import type { IndustryItem, ToastMessage } from '../types';

interface IndustriesViewProps {
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const IndustriesView: React.FC<IndustriesViewProps> = ({ onShowToast }) => {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission(['admin', 'gestor']);

  const [industries, setIndustries] = useState<IndustryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros e busca
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'ativo' | 'inativo'>('todos');

  // Modais de Criação / Edição / Visualização
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<IndustryItem | null>(null);
  const [viewingItem, setViewingItem] = useState<IndustryItem | null>(null);
  const [saving, setSaving] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    codigo: '',
    nome: '',
    cnpj: '',
    status: 'ativo' as 'ativo' | 'inativo',
    observacao: ''
  });

  // Busca dados de public.industrias
  const fetchIndustries = async () => {
    setLoading(true);
    setError(null);

    if (!supabase) {
      setError('Cliente Supabase não inicializado.');
      setLoading(false);
      return;
    }

    try {
      const { data, error: fetchErr } = await supabase
        .from('industrias')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchErr) throw fetchErr;

      setIndustries((data as IndustryItem[]) || []);
    } catch (err: any) {
      console.error('Erro ao carregar indústrias:', err);
      setError(err.message || 'Falha ao carregar lista de indústrias.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIndustries();
  }, []);

  // Filtragem local
  const filteredIndustries = useMemo(() => {
    return industries.filter((ind) => {
      const term = searchTerm.toLowerCase().trim();
      const matchesSearch =
        !term ||
        ind.codigo.toLowerCase().includes(term) ||
        ind.nome.toLowerCase().includes(term) ||
        (ind.cnpj && ind.cnpj.toLowerCase().includes(term));

      const matchesStatus =
        statusFilter === 'todos' || ind.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [industries, searchTerm, statusFilter]);

  // Abrir Modal de Adição
  const handleOpenCreate = () => {
    setEditingItem(null);
    setFormData({
      codigo: '',
      nome: '',
      cnpj: '',
      status: 'ativo',
      observacao: ''
    });
    setShowModal(true);
  };

  // Abrir Modal de Edição
  const handleOpenEdit = (item: IndustryItem) => {
    setEditingItem(item);
    setFormData({
      codigo: item.codigo,
      nome: item.nome,
      cnpj: item.cnpj || '',
      status: item.status,
      observacao: item.observacao || ''
    });
    setShowModal(true);
  };

  // Alternar Status (Ativar / Inativar)
  const handleToggleStatus = async (item: IndustryItem) => {
    if (!canEdit) return;
    const newStatus = item.status === 'ativo' ? 'inativo' : 'ativo';

    try {
      if (!supabase) throw new Error('Cliente Supabase indisponível.');

      const { error: err } = await supabase
        .from('industrias')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', item.id);

      if (err) throw err;

      onShowToast({
        title: `Indústria ${newStatus === 'ativo' ? 'Ativada' : 'Inativada'}`,
        message: `Status da indústria ${item.nome} alterado com sucesso.`,
        type: 'info'
      });

      setIndustries((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: newStatus } : i))
      );
    } catch (err: any) {
      onShowToast({
        title: 'Erro de Atualização',
        message: err.message || 'Falha ao alterar status da indústria.',
        type: 'error'
      });
    }
  };

  // Salvar (Criar ou Editar)
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.codigo.trim() || !formData.nome.trim()) {
      onShowToast({
        title: 'Campos Obrigatórios',
        message: 'Código e Nome da Indústria são obrigatórios.',
        type: 'warning'
      });
      return;
    }

    setSaving(true);

    try {
      if (!supabase) throw new Error('Cliente Supabase indisponível.');

      const payload = {
        codigo: formData.codigo.trim(),
        nome: formData.nome.trim(),
        cnpj: formData.cnpj.trim() || null,
        status: formData.status,
        observacao: formData.observacao.trim() || null,
        updated_at: new Date().toISOString()
      };

      if (editingItem) {
        // Atualizar
        const { error: updateErr } = await supabase
          .from('industrias')
          .update(payload)
          .eq('id', editingItem.id);

        if (updateErr) throw updateErr;

        onShowToast({
          title: 'Indústria Atualizada',
          message: `Cadastro da indústria ${payload.nome} atualizado com sucesso.`,
          type: 'success'
        });
      } else {
        // Criar
        const { error: insertErr } = await supabase
          .from('industrias')
          .insert([payload]);

        if (insertErr) throw insertErr;

        onShowToast({
          title: 'Indústria Cadastrada',
          message: `Indústria ${payload.nome} cadastrada com sucesso.`,
          type: 'success'
        });
      }

      setShowModal(false);
      fetchIndustries();
    } catch (err: any) {
      console.error(err);
      onShowToast({
        title: 'Falha ao Salvar',
        message: err.message || 'Não foi possível salvar o registro da indústria.',
        type: 'error'
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full px-4 lg:px-8 py-6 max-w-[1720px] mx-auto space-y-8 font-sans">
      {/* HEADER */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1e2433] pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center font-bold text-white shadow-[0_0_14px_rgba(147,51,234,0.6)]">
              <span className="material-symbols-outlined text-[20px]">factory</span>
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Cadastro de Indústrias
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-3xl">
            Gestão das marcas e fabricantes parceiros atendidos pela operação de trade marketing.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchIndustries}
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-[#171b26] border border-[#1e2433] text-xs font-semibold text-slate-300 hover:text-white hover:border-purple-500/40 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>
              refresh
            </span>
            <span>Atualizar</span>
          </button>

          {canEdit && (
            <button
              onClick={handleOpenCreate}
              className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs neon-purple-glow flex items-center gap-2 cursor-pointer transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              <span>Nova Indústria</span>
            </button>
          )}
        </div>
      </section>

      {/* CARDS DE METRICAS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="p-5 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-xl">
          <div className="flex items-center justify-between text-slate-400 font-mono text-xs">
            <span>TOTAL DE INDÚSTRIAS</span>
            <span className="material-symbols-outlined text-purple-400">factory</span>
          </div>
          <div className="text-3xl font-extrabold text-white font-mono mt-2">{industries.length}</div>
        </div>

        <div className="p-5 rounded-2xl bg-[#171b26] border border-emerald-500/30 shadow-xl">
          <div className="flex items-center justify-between text-emerald-400 font-mono text-xs font-bold">
            <span>INDÚSTRIAS ATIVAS</span>
            <span className="material-symbols-outlined">check_circle</span>
          </div>
          <div className="text-3xl font-extrabold text-emerald-400 font-mono mt-2">
            {industries.filter((i) => i.status === 'ativo').length}
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-xl">
          <div className="flex items-center justify-between text-slate-400 font-mono text-xs">
            <span>INATIVAS / ARQUIVADAS</span>
            <span className="material-symbols-outlined text-rose-400">block</span>
          </div>
          <div className="text-3xl font-extrabold text-rose-400 font-mono mt-2">
            {industries.filter((i) => i.status === 'inativo').length}
          </div>
        </div>
      </div>

      {/* BARRA DE BUSCA E FILTRO */}
      <div className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-5 shadow-2xl space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
          <div className="sm:col-span-8 relative">
            <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-lg">
              search
            </span>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por código ou nome da indústria..."
              className="w-full h-10 pl-10 pr-4 bg-[#131722] border border-[#1e2433] rounded-xl text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-purple-500 transition-all font-sans"
            />
          </div>

          <div className="sm:col-span-4">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
            >
              <option value="todos">Status: Todos</option>
              <option value="ativo">Ativas</option>
              <option value="inativo">Inativas</option>
            </select>
          </div>
        </div>
      </div>

      {/* TABELA DE REGISTROS */}
      <section className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
            <span className="material-symbols-outlined text-purple-400">table_chart</span>
            Indústrias Cadastradas ({filteredIndustries.length})
          </h3>
        </div>

        {/* LOADING */}
        {loading && (
          <div className="py-16 text-center space-y-3">
            <div className="w-10 h-10 border-4 border-purple-500/20 border-t-purple-500 rounded-full animate-spin mx-auto"></div>
            <p className="text-xs font-mono text-slate-400">Carregando indústrias do Supabase...</p>
          </div>
        )}

        {/* ERRO */}
        {!loading && error && (
          <div className="p-6 bg-rose-500/10 border border-rose-500/30 rounded-xl text-center space-y-3">
            <span className="material-symbols-outlined text-rose-400 text-3xl">warning</span>
            <h4 className="text-sm font-bold text-rose-300">Erro de Carregamento</h4>
            <p className="text-xs text-slate-400 font-mono">{error}</p>
          </div>
        )}

        {/* VAZIO */}
        {!loading && !error && filteredIndustries.length === 0 && (
          <div className="py-16 text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-[#131722] border border-[#1e2433] flex items-center justify-center text-slate-500 mx-auto">
              <span className="material-symbols-outlined text-3xl">search_off</span>
            </div>
            <h4 className="text-sm font-bold text-white">Nenhuma Indústria Encontrada</h4>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Não há registros de indústrias correspondentes aos filtros aplicados.
            </p>
          </div>
        )}

        {/* LISTA */}
        {!loading && !error && filteredIndustries.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-[#1e2433]">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#131722] border-b border-[#1e2433] text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                  <th className="py-3.5 px-4">Código</th>
                  <th className="py-3.5 px-4">Nome da Indústria</th>
                  <th className="py-3.5 px-4">CNPJ</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Observação</th>
                  <th className="py-3.5 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e2433] text-slate-300 font-mono">
                {filteredIndustries.map((ind) => (
                  <tr key={ind.id} className="hover:bg-[#131722]/60 transition-colors">
                    <td className="py-3.5 px-4 font-bold text-purple-400">{ind.codigo}</td>
                    <td className="py-3.5 px-4 font-bold text-white">{ind.nome}</td>
                    <td className="py-3.5 px-4 text-slate-400">{ind.cnpj || '—'}</td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                          ind.status === 'ativo'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                        }`}
                      >
                        {ind.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-400 max-w-xs truncate">
                      {ind.observacao || '—'}
                    </td>
                    <td className="py-3.5 px-4 text-right space-x-2">
                      <button
                        onClick={() => setViewingItem(ind)}
                        className="p-1.5 rounded-lg bg-[#131722] hover:bg-[#1f2433] text-slate-300 border border-[#1e2433] cursor-pointer"
                        title="Ver Detalhes"
                      >
                        <span className="material-symbols-outlined text-[16px]">visibility</span>
                      </button>

                      {canEdit && (
                        <>
                          <button
                            onClick={() => handleOpenEdit(ind)}
                            className="p-1.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 cursor-pointer"
                            title="Editar"
                          >
                            <span className="material-symbols-outlined text-[16px]">edit</span>
                          </button>
                          <button
                            onClick={() => handleToggleStatus(ind)}
                            className={`p-1.5 rounded-lg border cursor-pointer ${
                              ind.status === 'ativo'
                                ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border-rose-500/30'
                                : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                            }`}
                            title={ind.status === 'ativo' ? 'Inativar' : 'Ativar'}
                          >
                            <span className="material-symbols-outlined text-[16px]">
                              {ind.status === 'ativo' ? 'block' : 'check_circle'}
                            </span>
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* MODAL VER DETALHES */}
      {viewingItem && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#171b26] border border-[#1e2433] rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-[#1e2433] pb-3">
              <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                <span className="material-symbols-outlined text-purple-400">factory</span>
                Detalhes da Indústria
              </h3>
              <button onClick={() => setViewingItem(null)} className="text-slate-400 hover:text-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-3 text-xs font-mono">
              <div>
                <span className="text-slate-500 block">CÓDIGO:</span>
                <span className="text-purple-400 font-bold text-sm">{viewingItem.codigo}</span>
              </div>
              <div>
                <span className="text-slate-500 block">NOME DA INDÚSTRIA:</span>
                <span className="text-white font-bold">{viewingItem.nome}</span>
              </div>
              <div>
                <span className="text-slate-500 block">CNPJ:</span>
                <span className="text-slate-300">{viewingItem.cnpj || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">STATUS:</span>
                <span className={`font-bold uppercase ${viewingItem.status === 'ativo' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {viewingItem.status}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">OBSERVAÇÃO:</span>
                <span className="text-slate-300">{viewingItem.observacao || '—'}</span>
              </div>
            </div>

            <div className="pt-3 border-t border-[#1e2433] flex justify-end">
              <button
                onClick={() => setViewingItem(null)}
                className="px-4 py-2 rounded-xl bg-[#131722] hover:bg-[#1f2433] text-slate-300 border border-[#1e2433] text-xs font-semibold"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CRIAR / EDITAR */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSave}
            className="bg-[#171b26] border border-[#1e2433] rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5"
          >
            <div className="flex items-center justify-between border-b border-[#1e2433] pb-3">
              <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                <span className="material-symbols-outlined text-purple-400">
                  {editingItem ? 'edit' : 'add'}
                </span>
                {editingItem ? 'Editar Indústria' : 'Nova Indústria'}
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4 text-xs font-mono">
              <div>
                <label className="text-slate-300 block mb-1">CÓDIGO DA INDÚSTRIA (*)</label>
                <input
                  type="text"
                  required
                  value={formData.codigo}
                  onChange={(e) => setFormData({ ...formData, codigo: e.target.value })}
                  placeholder="Ex: IND-001"
                  disabled={Boolean(editingItem)}
                  className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-purple-500 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="text-slate-300 block mb-1">NOME / RAZÃO SOCIAL (*)</label>
                <input
                  type="text"
                  required
                  value={formData.nome}
                  onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                  placeholder="Ex: Nestle Brasil Ltda"
                  className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="text-slate-300 block mb-1">CNPJ (OPCIONAL)</label>
                <input
                  type="text"
                  value={formData.cnpj}
                  onChange={(e) => setFormData({ ...formData, cnpj: e.target.value })}
                  placeholder="Ex: 12345678000195"
                  className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="text-slate-300 block mb-1">STATUS</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-purple-500"
                >
                  <option value="ativo">ATIVO</option>
                  <option value="inativo">INATIVO</option>
                </select>
              </div>

              <div>
                <label className="text-slate-300 block mb-1">OBSERVAÇÕES</label>
                <textarea
                  value={formData.observacao}
                  onChange={(e) => setFormData({ ...formData, observacao: e.target.value })}
                  placeholder="Anotações gerais..."
                  className="w-full p-3 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-purple-500 h-20 resize-none"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-[#1e2433] flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-xl bg-[#131722] hover:bg-[#1f2433] text-slate-300 border border-[#1e2433] text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {saving ? (
                  <span>Salvando...</span>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm">save</span>
                    <span>Salvar Indústria</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
