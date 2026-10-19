import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import type { StoreItem, ToastMessage } from '../types';
import { StatCard, StatusBadge, DataTable, Column } from '../components/ui';

interface StoresViewProps {
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const StoresView: React.FC<StoresViewProps> = ({ onShowToast }) => {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission(['admin', 'gestor']);

  const [stores, setStores] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros e busca
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'ativo' | 'inativo'>('todos');
  const [ufFilter, setUfFilter] = useState<string>('todas');

  // Modais
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<StoreItem | null>(null);
  const [viewingItem, setViewingItem] = useState<StoreItem | null>(null);
  const [saving, setSaving] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    codigo: '',
    nome: '',
    cnpj: '',
    cidade: '',
    uf: 'SP',
    endereco: '',
    rede: '',
    status: 'ativo' as 'ativo' | 'inativo'
  });

  const validUFs = [
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
    'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
    'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
  ];

  // Busca dados de public.lojas
  const fetchStores = async () => {
    setLoading(true);
    setError(null);

    if (!supabase) {
      setError('Cliente Supabase não inicializado.');
      setLoading(false);
      return;
    }

    try {
      const { data, error: fetchErr } = await supabase
        .from('lojas')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchErr) throw fetchErr;

      setStores((data as StoreItem[]) || []);
    } catch (err: any) {
      console.error('Erro ao carregar lojas:', err);
      setError(err.message || 'Falha ao carregar lista de lojas/PDVs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStores();
  }, []);

  // UFs disponíveis para filtro
  const availableUFs = useMemo(() => {
    const ufs = new Set<string>();
    stores.forEach((s) => {
      if (s.uf) ufs.add(s.uf.toUpperCase());
    });
    return Array.from(ufs).sort();
  }, [stores]);

  // Filtragem local
  const filteredStores = useMemo(() => {
    return stores.filter((s) => {
      const term = searchTerm.toLowerCase().trim();
      const matchesSearch =
        !term ||
        s.codigo.toLowerCase().includes(term) ||
        s.nome.toLowerCase().includes(term) ||
        s.cidade.toLowerCase().includes(term) ||
        (s.rede && s.rede.toLowerCase().includes(term)) ||
        (s.uf && s.uf.toLowerCase().includes(term));

      const matchesStatus =
        statusFilter === 'todos' || s.status === statusFilter;

      const matchesUf =
        ufFilter === 'todas' || s.uf.toUpperCase() === ufFilter;

      return matchesSearch && matchesStatus && matchesUf;
    });
  }, [stores, searchTerm, statusFilter, ufFilter]);

  // Colunas padronizadas para o DataTable compartilhado
  const columns: Column<StoreItem>[] = useMemo(() => [
    {
      key: 'codigo',
      header: 'Código',
      sortable: true,
      className: 'font-mono font-bold text-[#286FF5]',
      accessor: (s) => s.codigo
    },
    {
      key: 'nome',
      header: 'Nome da Loja',
      sortable: true,
      className: 'font-bold text-[#171717]',
      accessor: (s) => s.nome
    },
    {
      key: 'rede',
      header: 'Rede',
      sortable: true,
      className: 'text-[#525252]',
      render: (s) => s.rede || '—',
      accessor: (s) => s.rede || ''
    },
    {
      key: 'cidade_uf',
      header: 'Cidade / UF',
      sortable: true,
      accessor: (s) => `${s.cidade} ${s.uf}`,
      render: (s) => (
        <span>
          {s.cidade} / <strong className="text-[#171717]">{s.uf}</strong>
        </span>
      )
    },
    {
      key: 'cnpj',
      header: 'CNPJ',
      className: 'font-mono text-[#737373]',
      render: (s) => s.cnpj || '—'
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      accessor: (s) => s.status,
      render: (s) => (
        <StatusBadge
          status={s.status}
          variant={s.status === 'ativo' ? 'ativo' : 'inativo'}
          label={s.status.toUpperCase()}
        />
      )
    },
    {
      key: 'acoes',
      header: 'Ações',
      headerClassName: 'text-right',
      className: 'text-right space-x-1.5',
      render: (store) => (
        <div className="inline-flex items-center justify-end gap-1.5">
          <button
            onClick={() => setViewingItem(store)}
            className="p-1.5 rounded-lg bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] cursor-pointer transition-colors"
            title="Ver Detalhes"
          >
            <span className="material-symbols-outlined text-[16px]">visibility</span>
          </button>

          {canEdit && (
            <>
              <button
                onClick={() => handleOpenEdit(store)}
                className="p-1.5 rounded-lg bg-[#EBF2FE] hover:bg-blue-100 text-[#286FF5] border border-[#C3D9FD] cursor-pointer transition-colors"
                title="Editar"
              >
                <span className="material-symbols-outlined text-[16px]">edit</span>
              </button>
              <button
                onClick={() => handleToggleStatus(store)}
                className={`p-1.5 rounded-lg border cursor-pointer transition-colors ${
                  store.status === 'ativo'
                    ? 'bg-[#FDF2F2] hover:bg-rose-100 text-[#D93636] border-[#F8C8C8]'
                    : 'bg-[#E8F5EE] hover:bg-emerald-100 text-[#16845B] border-[#B9E5D0]'
                }`}
                title={store.status === 'ativo' ? 'Inativar' : 'Ativar'}
              >
                <span className="material-symbols-outlined text-[16px]">
                  {store.status === 'ativo' ? 'block' : 'check_circle'}
                </span>
              </button>
            </>
          )}
        </div>
      )
    }
  ], [canEdit]);

  // Abrir Modal Criar
  const handleOpenCreate = async () => {
    setEditingItem(null);

    let nextCode = '';
    try {
      if (supabase) {
        const { data, error: rpcErr } = await supabase.rpc('get_next_store_code');
        if (!rpcErr && data) {
          nextCode = data;
        }
      }
    } catch (err) {
      console.error('Erro ao consultar próximo código da loja:', err);
    }

    setFormData({
      codigo: nextCode,
      nome: '',
      cnpj: '',
      cidade: '',
      uf: 'SP',
      endereco: '',
      rede: '',
      status: 'ativo'
    });
    setShowModal(true);
  };

  // Abrir Modal Editar
  const handleOpenEdit = (item: StoreItem) => {
    setEditingItem(item);
    setFormData({
      codigo: item.codigo,
      nome: item.nome,
      cnpj: item.cnpj || '',
      cidade: item.cidade,
      uf: item.uf,
      endereco: item.endereco || '',
      rede: item.rede || '',
      status: item.status
    });
    setShowModal(true);
  };

  // Alternar Status (Ativar / Inativar)
  const handleToggleStatus = async (item: StoreItem) => {
    if (!canEdit) return;
    const newStatus = item.status === 'ativo' ? 'inativo' : 'ativo';

    try {
      if (!supabase) throw new Error('Cliente Supabase indisponível.');

      const { error: err } = await supabase
        .from('lojas')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', item.id);

      if (err) throw err;

      onShowToast({
        title: `Loja ${newStatus === 'ativo' ? 'Ativada' : 'Inativada'}`,
        message: `Status da loja ${item.nome} alterado com sucesso.`,
        type: 'info'
      });

      setStores((prev) =>
        prev.map((s) => (s.id === item.id ? { ...s, status: newStatus } : s))
      );
    } catch (err: any) {
      onShowToast({
        title: 'Erro de Atualização',
        message: err.message || 'Falha ao alterar status da loja.',
        type: 'error'
      });
    }
  };

  // Salvar
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.nome.trim() || !formData.cidade.trim() || !formData.uf.trim()) {
      onShowToast({
        title: 'Campos Obrigatórios',
        message: 'Nome, Cidade e UF são obrigatórios.',
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
        cidade: formData.cidade.trim(),
        uf: formData.uf.trim().toUpperCase(),
        endereco: formData.endereco.trim() || null,
        rede: formData.rede.trim() || null,
        status: formData.status,
        updated_at: new Date().toISOString()
      };

      if (editingItem) {
        const { error: updateErr } = await supabase
          .from('lojas')
          .update(payload)
          .eq('id', editingItem.id);

        if (updateErr) throw updateErr;

        onShowToast({
          title: 'Loja Atualizada',
          message: `Loja ${payload.nome} atualizada com sucesso.`,
          type: 'success'
        });
      } else {
        const { error: insertErr } = await supabase
          .from('lojas')
          .insert([payload]);

        if (insertErr) throw insertErr;

        onShowToast({
          title: 'Loja Cadastrada',
          message: `Loja ${payload.nome} cadastrada com sucesso.`,
          type: 'success'
        });
      }

      setShowModal(false);
      fetchStores();
    } catch (err: any) {
      console.error(err);
      onShowToast({
        title: 'Falha ao Salvar',
        message: err.message || 'Não foi possível salvar a loja.',
        type: 'error'
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full px-4 lg:px-8 py-6 max-w-[1720px] mx-auto space-y-8 font-sans">
      {/* HEADER */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#CFCDC5] pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center font-bold text-white shadow-[0_0_14px_rgba(6,182,212,0.5)]">
              <span className="material-symbols-outlined text-[20px]">store</span>
            </div>
            <h1 className="text-3xl font-extrabold text-[#171717] tracking-tight">
              Cadastro de Lojas / PDVs
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-[#77766F] mt-1 max-w-3xl">
            Gestão dos pontos de venda, redes de supermercados e localizações geográficas atendidas.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchStores}
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] text-xs font-semibold text-[#171717] hover:text-white hover:border-cyan-500/40 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>
              refresh
            </span>
            <span>Atualizar</span>
          </button>

          {canEdit && (
            <button
              onClick={handleOpenCreate}
              className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-all shadow-[0_0_15px_rgba(6,182,212,0.3)]"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              <span>Nova Loja / PDV</span>
            </button>
          )}
        </div>
      </section>

      {/* METRICAS PADRONIZADAS COM STATCARD */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <StatCard
          title="TOTAL DE LOJAS"
          value={stores.length}
          icon="store"
          variant="default"
          description="PDVs cadastrados no sistema"
        />
        <StatCard
          title="LOJAS ATIVAS"
          value={stores.filter((s) => s.status === 'ativo').length}
          icon="check_circle"
          variant="success"
          description="Em operação na malha de roteiros"
        />
        <StatCard
          title="UFS ATENDIDAS"
          value={availableUFs.length}
          icon="map"
          variant="info"
          description="Estados com cobertura ativa"
        />
      </div>

      {/* FILTROS ADICIONAIS DE STATUS E UF */}
      <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs font-mono font-bold text-[#737373] uppercase tracking-wider flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">filter_list</span>
            Filtros Avançados
          </div>
          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="h-9 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-lg text-xs text-[#171717] focus:outline-none focus:border-[#111114] font-mono"
            >
              <option value="todos">Status: Todos</option>
              <option value="ativo">Ativas</option>
              <option value="inativo">Inativas</option>
            </select>

            <select
              value={ufFilter}
              onChange={(e) => setUfFilter(e.target.value)}
              className="h-9 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-lg text-xs text-[#171717] focus:outline-none focus:border-[#111114] font-mono"
            >
              <option value="todas">UF: Todas</option>
              {availableUFs.map((uf) => (
                <option key={uf} value={uf}>{uf}</option>
              ))}
            </select>

            {(statusFilter !== 'todos' || ufFilter !== 'todas' || searchTerm) && (
              <button
                onClick={() => {
                  setStatusFilter('todos');
                  setUfFilter('todas');
                  setSearchTerm('');
                }}
                className="text-xs text-[#D93636] hover:underline font-mono px-2 py-1"
              >
                Limpar Filtros
              </button>
            )}
          </div>
        </div>
      </div>

      {/* TABELA PADRONIZADA COM DATATABLE REUTILIZÁVEL */}
      <DataTable<StoreItem>
        title="Lojas Cadastradas"
        titleIcon="store"
        badgeCount={filteredStores.length}
        data={filteredStores}
        columns={columns}
        keyExtractor={(item) => item.id}
        loading={loading}
        loadingMessage="Carregando lojas do banco de dados..."
        error={error}
        emptyTitle="Nenhuma Loja Encontrada"
        emptyMessage="Não há registros de lojas/PDVs correspondentes aos filtros aplicados."
        searchPlaceholder="Buscar por código, nome, cidade, rede..."
        searchFilter={(store, query) =>
          store.codigo.toLowerCase().includes(query) ||
          store.nome.toLowerCase().includes(query) ||
          store.cidade.toLowerCase().includes(query) ||
          (store.rede && store.rede.toLowerCase().includes(query)) ||
          store.uf.toLowerCase().includes(query)
        }
        defaultPageSize={10}
      />

      {/* MODAL DETALHES */}
      {viewingItem && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-3">
              <h3 className="text-sm font-bold text-[#171717] font-mono flex items-center gap-2">
                <span className="material-symbols-outlined text-cyan-400">store</span>
                Detalhes da Loja / PDV
              </h3>
              <button onClick={() => setViewingItem(null)} className="text-[#77766F] hover:text-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-3 text-xs font-mono">
              <div>
                <span className="text-[#5F5F5F] block">CÓDIGO DA LOJA:</span>
                <span className="text-cyan-400 font-bold text-sm">{viewingItem.codigo}</span>
              </div>
              <div>
                <span className="text-[#5F5F5F] block">NOME DA LOJA:</span>
                <span className="text-[#171717] font-bold">{viewingItem.nome}</span>
              </div>
              <div>
                <span className="text-[#5F5F5F] block">REDE:</span>
                <span className="text-[#171717]">{viewingItem.rede || '—'}</span>
              </div>
              <div>
                <span className="text-[#5F5F5F] block">CIDADE / UF:</span>
                <span className="text-[#171717]">{viewingItem.cidade} - {viewingItem.uf}</span>
              </div>
              <div>
                <span className="text-[#5F5F5F] block">ENDEREÇO:</span>
                <span className="text-[#171717]">{viewingItem.endereco || '—'}</span>
              </div>
              <div>
                <span className="text-[#5F5F5F] block">CNPJ:</span>
                <span className="text-[#171717]">{viewingItem.cnpj || '—'}</span>
              </div>
              <div>
                <span className="text-[#5F5F5F] block">STATUS:</span>
                <span className={`font-bold uppercase ${viewingItem.status === 'ativo' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {viewingItem.status}
                </span>
              </div>
            </div>

            <div className="pt-3 border-t border-[#CFCDC5] flex justify-end">
              <button
                onClick={() => setViewingItem(null)}
                className="px-4 py-2 rounded-xl bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] text-xs font-semibold"
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
            className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5"
          >
            <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-3">
              <h3 className="text-sm font-bold text-[#171717] font-mono flex items-center gap-2">
                <span className="material-symbols-outlined text-cyan-400">
                  {editingItem ? 'edit' : 'add'}
                </span>
                {editingItem ? 'Editar Loja / PDV' : 'Nova Loja / PDV'}
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-[#77766F] hover:text-white"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
              <div className="sm:col-span-2">
                <label className="text-[#171717] block mb-1">CÓDIGO DA LOJA</label>
                <input
                  type="text"
                  readOnly
                  disabled
                  value={formData.codigo || 'Gerando...'}
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-cyan-400 font-bold focus:outline-none disabled:opacity-70 cursor-not-allowed"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-[#171717] block mb-1">NOME DA LOJA / ESTABELECIMENTO (*)</label>
                <input
                  type="text"
                  required
                  value={formData.nome}
                  onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                  placeholder="Ex: Supermercado Carrefour Centro"
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-[#171717] block mb-1">REDE (OPCIONAL)</label>
                <input
                  type="text"
                  value={formData.rede}
                  onChange={(e) => setFormData({ ...formData, rede: e.target.value })}
                  placeholder="Ex: Carrefour"
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-[#171717] block mb-1">CNPJ (OPCIONAL)</label>
                <input
                  type="text"
                  value={formData.cnpj}
                  onChange={(e) => setFormData({ ...formData, cnpj: e.target.value })}
                  placeholder="Ex: 12345678000195"
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-[#171717] block mb-1">CIDADE (*)</label>
                <input
                  type="text"
                  required
                  value={formData.cidade}
                  onChange={(e) => setFormData({ ...formData, cidade: e.target.value })}
                  placeholder="Ex: São Paulo"
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-[#171717] block mb-1">UF (*)</label>
                <select
                  value={formData.uf}
                  onChange={(e) => setFormData({ ...formData, uf: e.target.value })}
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-cyan-500"
                >
                  {validUFs.map((uf) => (
                    <option key={uf} value={uf}>{uf}</option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="text-[#171717] block mb-1">ENDEREÇO COMPLETO</label>
                <input
                  type="text"
                  value={formData.endereco}
                  onChange={(e) => setFormData({ ...formData, endereco: e.target.value })}
                  placeholder="Ex: Av. Paulista, 1000 - Bela Vista"
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-[#171717] block mb-1">STATUS</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-cyan-500"
                >
                  <option value="ativo">ATIVO</option>
                  <option value="inativo">INATIVO</option>
                </select>
              </div>
            </div>

            <div className="pt-3 border-t border-[#CFCDC5] flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-xl bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
              >
                {saving ? (
                  <span>Salvando...</span>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm">save</span>
                    <span>Salvar Loja</span>
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
