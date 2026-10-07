import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import type { IndustryItem, StoreItem, RouteItem, Visit, ToastMessage } from '../types';

interface IndustriesViewProps {
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const IndustriesView: React.FC<IndustriesViewProps> = ({ onShowToast }) => {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission(['admin', 'gestor']);

  // Aba selecionada ('frequencia' | 'cadastro')
  const [activeTab, setActiveTab] = useState<'frequencia' | 'cadastro'>('frequencia');

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

  // ESTADOS DO CONTROLE DE FREQUÊNCIA OPERACIONAL
  const [freqLoading, setFreqLoading] = useState(false);
  const [periodFilter, setPeriodFilter] = useState<'today' | 'week' | 'month'>('month');
  const [selectedIndustria, setSelectedIndustria] = useState<string>('todas');
  const [selectedLoja, setSelectedLoja] = useState<string>('todas');
  const [selectedPromotor, setSelectedPromotor] = useState<string>('todos');

  const [lojasList, setLojasList] = useState<StoreItem[]>([]);
  const [promotoresList, setPromotoresList] = useState<any[]>([]);
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);

  // Visualização expandida no detalhamento por loja e por promotor
  const [expandedIndustria, setExpandedIndustria] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'industria' | 'promotor'>('industria');

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

  // Busca dados para o Controle de Frequência Operacional
  const fetchFrequencyData = useCallback(async () => {
    setFreqLoading(true);

    if (!supabase) {
      setFreqLoading(false);
      return;
    }

    try {
      const now = new Date();
      let startDateStr = now.toISOString().split('T')[0];

      if (periodFilter === 'week') {
        const weekAgo = new Date();
        weekAgo.setDate(now.getDate() - 7);
        startDateStr = weekAgo.toISOString().split('T')[0];
      } else if (periodFilter === 'month') {
        const monthAgo = new Date();
        monthAgo.setDate(now.getDate() - 30);
        startDateStr = monthAgo.toISOString().split('T')[0];
      }

      let visitsQuery = supabase
        .from('visits')
        .select(`
          *,
          promotor:promotores(matricula, nome),
          loja:lojas(codigo, nome, cidade, uf),
          industria:industrias(codigo, nome),
          occurrences:visit_occurrences(*)
        `)
        .order('created_at', { ascending: false });

      if (periodFilter === 'today') {
        visitsQuery = visitsQuery.eq('data_visita', startDateStr);
      } else {
        visitsQuery = visitsQuery.gte('data_visita', startDateStr);
      }

      const [rotasRes, visitsRes, lojasRes, promotoresRes] = await Promise.all([
        supabase.from('rotas').select(`
          *,
          industria:industrias(codigo, nome),
          loja:lojas(codigo, nome, cidade, uf),
          promotor:promotores(matricula, nome)
        `),
        visitsQuery,
        supabase.from('lojas').select('*').order('nome'),
        supabase.from('promotores').select('*').order('nome')
      ]);

      if (rotasRes.error) throw rotasRes.error;
      if (visitsRes.error) throw visitsRes.error;

      setRoutes((rotasRes.data as unknown as RouteItem[]) || []);
      setVisits((visitsRes.data as unknown as Visit[]) || []);
      setLojasList((lojasRes.data as unknown as StoreItem[]) || []);
      setPromotoresList(promotoresRes.data || []);
    } catch (err: any) {
      console.error('Erro ao carregar telemetria de frequência operacional:', err);
      onShowToast({
        title: 'Erro de Carga',
        message: err.message || 'Falha ao carregar dados operacionais.',
        type: 'error'
      });
    } finally {
      setFreqLoading(false);
    }
  }, [periodFilter, onShowToast]);

  useEffect(() => {
    fetchIndustries();
  }, []);

  useEffect(() => {
    if (activeTab === 'frequencia') {
      fetchFrequencyData();
    }
  }, [activeTab, fetchFrequencyData]);

  // -------------------------------------------------------------
  // LÓGICA DE PLANEJAMENTO E ADERÊNCIA OPERACIONAL (ETAPA 7A)
  // -------------------------------------------------------------
  const processedData = useMemo(() => {
    const now = new Date();
    const dayKeys = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
    const datesInPeriod: Array<{ dateStr: string; dayKey: string }> = [];

    if (periodFilter === 'today') {
      const todayStr = now.toISOString().split('T')[0];
      const currentDayKey = dayKeys[now.getDay()];
      datesInPeriod.push({ dateStr: todayStr, dayKey: currentDayKey });
    } else if (periodFilter === 'week') {
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(now.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const dayKey = dayKeys[d.getDay()];
        datesInPeriod.push({ dateStr, dayKey });
      }
    } else if (periodFilter === 'month') {
      for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(now.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const dayKey = dayKeys[d.getDay()];
        datesInPeriod.push({ dateStr, dayKey });
      }
    }

    const filteredRoutes = routes.filter((r) => {
      if (selectedIndustria !== 'todas' && r.industria_codigo !== selectedIndustria) return false;
      if (selectedLoja !== 'todas' && r.loja_codigo !== selectedLoja) return false;
      if (selectedPromotor !== 'todos' && r.promotor_matricula !== selectedPromotor) return false;
      return true;
    });

    const plannedOccurrencesMap = new Map<string, {
      routeId: string;
      promotorMatricula: string;
      lojaCodigo: string;
      industriaCodigo: string;
      dataStr: string;
      frequencia: string;
    }>();

    filteredRoutes.forEach((r) => {
      datesInPeriod.forEach(({ dateStr, dayKey }) => {
        const isDayActive = Boolean(r[dayKey as keyof RouteItem]);
        if (isDayActive) {
          const uniqueKey = `${r.promotor_matricula}|${r.loja_codigo}|${r.industria_codigo}|${dateStr}`;
          if (!plannedOccurrencesMap.has(uniqueKey)) {
            plannedOccurrencesMap.set(uniqueKey, {
              routeId: r.id,
              promotorMatricula: r.promotor_matricula,
              lojaCodigo: r.loja_codigo,
              industriaCodigo: r.industria_codigo,
              dataStr: dateStr,
              frequencia: r.frequencia
            });
          }
        }
      });
    });

    const plannedList = Array.from(plannedOccurrencesMap.values());

    const filteredVisits = visits.filter((v) => {
      if (selectedIndustria !== 'todas' && v.industria_codigo !== selectedIndustria) return false;
      if (selectedLoja !== 'todas' && v.loja_codigo !== selectedLoja) return false;
      if (selectedPromotor !== 'todos' && v.promotor_matricula !== selectedPromotor) return false;
      return true;
    });

    const visitsMap = new Map<string, Visit>();
    filteredVisits.forEach((v) => {
      const key = `${v.promotor_matricula}|${v.loja_codigo}|${v.industria_codigo}|${v.data_visita}`;
      visitsMap.set(key, v);
    });

    let totalOccurrencesCount = 0;
    filteredVisits.forEach((v) => {
      if (v.occurrences && Array.isArray(v.occurrences)) {
        totalOccurrencesCount += v.occurrences.length;
      }
    });

    let totalPlanejadas = plannedList.length;
    let totalRealizadas = 0;
    let totalEmAndamento = 0;
    let totalNaoRealizadas = 0;
    let totalPendentes = 0;
    let temRotasQuinzenais = false;

    plannedList.forEach((p) => {
      if (p.frequencia === 'QUINZENAL') {
        temRotasQuinzenais = true;
      }

      const key = `${p.promotorMatricula}|${p.lojaCodigo}|${p.industriaCodigo}|${p.dataStr}`;
      const v = visitsMap.get(key);

      if (v) {
        if (v.status === 'concluida') {
          totalRealizadas++;
        } else if (v.status === 'em_andamento') {
          totalEmAndamento++;
        } else if (v.status === 'nao_realizada') {
          totalNaoRealizadas++;
        } else {
          totalPendentes++;
        }
      } else {
        totalPendentes++;
      }
    });

    const taxaAderenciaGeral = totalPlanejadas > 0
      ? Math.round((totalRealizadas / totalPlanejadas) * 100)
      : (filteredVisits.length > 0 ? Math.round((totalRealizadas / filteredVisits.length) * 100) : 0);

    const industriaGroupMap = new Map<string, {
      codigo: string;
      nome: string;
      planejadas: number;
      realizadas: number;
      emAndamento: number;
      naoRealizadas: number;
      pendentes: number;
      ocorrenciasCount: number;
      temQuinzenal: boolean;
      lojasDetalhamento: Map<string, {
        lojaCodigo: string;
        lojaNome: string;
        promotorMatricula: string;
        promotorNome: string;
        frequencia: string;
        planejadas: number;
        realizadas: number;
        pendentes: number;
        naoRealizadas: number;
      }>;
    }>();

    industries.forEach((ind) => {
      if (selectedIndustria === 'todas' || selectedIndustria === ind.codigo) {
        industriaGroupMap.set(ind.codigo, {
          codigo: ind.codigo,
          nome: ind.nome,
          planejadas: 0,
          realizadas: 0,
          emAndamento: 0,
          naoRealizadas: 0,
          pendentes: 0,
          ocorrenciasCount: 0,
          temQuinzenal: false,
          lojasDetalhamento: new Map()
        });
      }
    });

    plannedList.forEach((p) => {
      let g = industriaGroupMap.get(p.industriaCodigo);
      if (!g) {
        const indObj = industries.find((i) => i.codigo === p.industriaCodigo);
        g = {
          codigo: p.industriaCodigo,
          nome: indObj?.nome || p.industriaCodigo,
          planejadas: 0,
          realizadas: 0,
          emAndamento: 0,
          naoRealizadas: 0,
          pendentes: 0,
          ocorrenciasCount: 0,
          temQuinzenal: false,
          lojasDetalhamento: new Map()
        };
        industriaGroupMap.set(p.industriaCodigo, g);
      }

      g.planejadas++;
      if (p.frequencia === 'QUINZENAL') g.temQuinzenal = true;

      const key = `${p.promotorMatricula}|${p.lojaCodigo}|${p.industriaCodigo}|${p.dataStr}`;
      const v = visitsMap.get(key);

      let status = 'pendente';
      if (v) {
        if (v.status === 'concluida') {
          g.realizadas++;
          status = 'concluida';
        } else if (v.status === 'em_andamento') {
          g.emAndamento++;
          status = 'em_andamento';
        } else if (v.status === 'nao_realizada') {
          g.naoRealizadas++;
          status = 'nao_realizada';
        } else {
          g.pendentes++;
        }

        if (v.occurrences && Array.isArray(v.occurrences)) {
          g.ocorrenciasCount += v.occurrences.length;
        }
      } else {
        g.pendentes++;
      }

      const subKey = `${p.lojaCodigo}|${p.promotorMatricula}`;
      let sub = g.lojasDetalhamento.get(subKey);
      if (!sub) {
        const lojaObj = lojasList.find((l) => l.codigo === p.lojaCodigo);
        const promObj = promotoresList.find((pr) => pr.matricula === p.promotorMatricula);
        sub = {
          lojaCodigo: p.lojaCodigo,
          lojaNome: lojaObj?.nome || p.lojaCodigo,
          promotorMatricula: p.promotorMatricula,
          promotorNome: promObj?.nome || p.promotorMatricula,
          frequencia: p.frequencia,
          planejadas: 0,
          realizadas: 0,
          pendentes: 0,
          naoRealizadas: 0
        };
        g.lojasDetalhamento.set(subKey, sub);
      }

      sub.planejadas++;
      if (status === 'concluida') sub.realizadas++;
      else if (status === 'nao_realizada') sub.naoRealizadas++;
      else sub.pendentes++;
    });

    const tabelaIndustrias = Array.from(industriaGroupMap.values()).map((g) => {
      const aderencia = g.planejadas > 0 ? Math.round((g.realizadas / g.planejadas) * 100) : 0;
      const detalhamentoLojas = Array.from(g.lojasDetalhamento.values()).map((d) => ({
        ...d,
        aderencia: d.planejadas > 0 ? Math.round((d.realizadas / d.planejadas) * 100) : 0
      }));

      return {
        ...g,
        aderencia,
        detalhamentoLojas
      };
    });

    tabelaIndustrias.sort((a, b) => a.aderencia - b.aderencia);

    const promotorGroupMap = new Map<string, {
      matricula: string;
      nome: string;
      lojasUnicas: Set<string>;
      industriasUnicas: Set<string>;
      planejadas: number;
      realizadas: number;
      pendentes: number;
      naoRealizadas: number;
    }>();

    plannedList.forEach((p) => {
      let pg = promotorGroupMap.get(p.promotorMatricula);
      if (!pg) {
        const promObj = promotoresList.find((pr) => pr.matricula === p.promotorMatricula);
        pg = {
          matricula: p.promotorMatricula,
          nome: promObj?.nome || p.promotorMatricula,
          lojasUnicas: new Set(),
          industriasUnicas: new Set(),
          planejadas: 0,
          realizadas: 0,
          pendentes: 0,
          naoRealizadas: 0
        };
        promotorGroupMap.set(p.promotorMatricula, pg);
      }

      pg.planejadas++;
      pg.lojasUnicas.add(p.lojaCodigo);
      pg.industriasUnicas.add(p.industriaCodigo);

      const key = `${p.promotorMatricula}|${p.lojaCodigo}|${p.industriaCodigo}|${p.dataStr}`;
      const v = visitsMap.get(key);
      if (v) {
        if (v.status === 'concluida') pg.realizadas++;
        else if (v.status === 'nao_realizada') pg.naoRealizadas++;
        else pg.pendentes++;
      } else {
        pg.pendentes++;
      }
    });

    const tabelaPromotores = Array.from(promotorGroupMap.values()).map((pg) => {
      const aderencia = pg.planejadas > 0 ? Math.round((pg.realizadas / pg.planejadas) * 100) : 0;
      return {
        matricula: pg.matricula,
        nome: pg.nome,
        qtdLojas: pg.lojasUnicas.size,
        qtdIndustrias: pg.industriasUnicas.size,
        planejadas: pg.planejadas,
        realizadas: pg.realizadas,
        pendentes: pg.pendentes,
        naoRealizadas: pg.naoRealizadas,
        aderencia
      };
    });

    tabelaPromotores.sort((a, b) => a.aderencia - b.aderencia);

    return {
      totalPlanejadas,
      totalRealizadas,
      totalEmAndamento,
      totalNaoRealizadas,
      totalPendentes,
      taxaAderenciaGeral,
      totalOccurrencesCount,
      temRotasQuinzenais,
      tabelaIndustrias,
      tabelaPromotores
    };
  }, [routes, visits, industries, lojasList, promotoresList, periodFilter, selectedIndustria, selectedLoja, selectedPromotor]);

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
      {/* HEADER PRINCIPAL */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1e2433] pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center font-bold text-white shadow-[0_0_14px_rgba(147,51,234,0.6)]">
              <span className="material-symbols-outlined text-[20px]">factory</span>
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Gestão de Indústrias
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-3xl">
            Aderência operacional de visitas e cadastro das marcas parceiras atendidas pela operação de trade marketing.
          </p>
        </div>

        {/* NAVEGAÇÃO DE ABAS */}
        <div className="flex items-center gap-3 bg-[#131722] p-1.5 rounded-xl border border-[#1e2433]">
          <button
            onClick={() => setActiveTab('frequencia')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'frequencia'
                ? 'bg-purple-600 text-white shadow-[0_0_12px_rgba(147,51,234,0.5)]'
                : 'text-slate-400 hover:text-white hover:bg-[#1e2433]'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">analytics</span>
            <span>Aderência Operacional</span>
          </button>

          <button
            onClick={() => setActiveTab('cadastro')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'cadastro'
                ? 'bg-purple-600 text-white shadow-[0_0_12px_rgba(147,51,234,0.5)]'
                : 'text-slate-400 hover:text-white hover:bg-[#1e2433]'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">list_alt</span>
            <span>Cadastro das Indústrias</span>
          </button>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* ABA 1: CONTROLE DE FREQUÊNCIA OPERACIONAL POR INDÚSTRIA (ETAPA 7A)        */}
      {/* ========================================================================= */}
      {activeTab === 'frequencia' && (
        <div className="space-y-8 animate-fadeIn">
          {/* BARRA DE FILTROS */}
          <section className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#1e2433] pb-3">
              <div className="flex items-center gap-2 text-xs font-mono font-bold text-slate-300">
                <span className="material-symbols-outlined text-purple-400 text-[18px]">filter_alt</span>
                <span>FILTROS OPERACIONAIS</span>
              </div>
              <button
                onClick={fetchFrequencyData}
                disabled={freqLoading}
                className="px-3 py-1.5 rounded-lg bg-[#131722] border border-[#1e2433] text-xs font-semibold text-slate-300 hover:text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <span className={`material-symbols-outlined text-[16px] ${freqLoading ? 'animate-spin' : ''}`}>
                  refresh
                </span>
                <span>Recarregar Dados</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* FILTRO PERÍODO */}
              <div>
                <label className="text-[11px] font-mono font-bold text-slate-400 block mb-1.5 uppercase">
                  Período
                </label>
                <select
                  value={periodFilter}
                  onChange={(e) => setPeriodFilter(e.target.value as any)}
                  className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
                >
                  <option value="today">Hoje</option>
                  <option value="week">Últimos 7 dias</option>
                  <option value="month">Este mês</option>
                </select>
              </div>

              {/* FILTRO INDÚSTRIA */}
              <div>
                <label className="text-[11px] font-mono font-bold text-slate-400 block mb-1.5 uppercase">
                  Indústria
                </label>
                <select
                  value={selectedIndustria}
                  onChange={(e) => setSelectedIndustria(e.target.value)}
                  className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
                >
                  <option value="todas">Indústria: Todas ({industries.length})</option>
                  {industries.map((ind) => (
                    <option key={ind.id} value={ind.codigo}>
                      {ind.nome} ({ind.codigo})
                    </option>
                  ))}
                </select>
              </div>

              {/* FILTRO LOJA */}
              <div>
                <label className="text-[11px] font-mono font-bold text-slate-400 block mb-1.5 uppercase">
                  Loja
                </label>
                <select
                  value={selectedLoja}
                  onChange={(e) => setSelectedLoja(e.target.value)}
                  className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
                >
                  <option value="todas">Loja: Todas ({lojasList.length})</option>
                  {lojasList.map((st) => (
                    <option key={st.id} value={st.codigo}>
                      {st.nome} ({st.codigo})
                    </option>
                  ))}
                </select>
              </div>

              {/* FILTRO PROMOTOR */}
              <div>
                <label className="text-[11px] font-mono font-bold text-slate-400 block mb-1.5 uppercase">
                  Promotor
                </label>
                <select
                  value={selectedPromotor}
                  onChange={(e) => setSelectedPromotor(e.target.value)}
                  className="w-full h-10 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
                >
                  <option value="todos">Promotor: Todos ({promotoresList.length})</option>
                  {promotoresList.map((pr) => (
                    <option key={pr.id || pr.matricula} value={pr.matricula}>
                      {pr.nome} ({pr.matricula})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* ALERTA DE RESTRIÇÃO DE ROTAS QUINZENAIS */}
          {processedData.temRotasQuinzenais && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3 text-amber-300 text-xs">
              <span className="material-symbols-outlined text-[20px] text-amber-400 shrink-0 mt-0.5">
                warning
              </span>
              <div>
                <span className="font-bold block uppercase tracking-wide">Atenção sobre Rotas Quinzenais:</span>
                <span>
                  As rotas com frequência quinzenal dependem de referência de semana A/B ou data-base não cadastrada no modelo atual. As ocorrências foram calculadas considerando os dias ativos no período.
                </span>
              </div>
            </div>
          )}

          {/* CARDS DE KPI (TOP BAR) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* PLANEJADAS */}
            <div className="p-5 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-xl">
              <div className="flex items-center justify-between text-slate-400 font-mono text-[11px] font-bold">
                <span>PLANEJADAS</span>
                <span className="material-symbols-outlined text-purple-400">calendar_month</span>
              </div>
              <div className="text-3xl font-extrabold text-white font-mono mt-2">
                {processedData.totalPlanejadas}
              </div>
              <p className="text-[10px] text-slate-500 mt-1">Ocorrências geradas por rotas</p>
            </div>

            {/* REALIZADAS */}
            <div className="p-5 rounded-2xl bg-[#171b26] border border-emerald-500/30 shadow-xl">
              <div className="flex items-center justify-between text-emerald-400 font-mono text-[11px] font-bold">
                <span>REALIZADAS</span>
                <span className="material-symbols-outlined">task_alt</span>
              </div>
              <div className="text-3xl font-extrabold text-emerald-400 font-mono mt-2">
                {processedData.totalRealizadas}
              </div>
              <p className="text-[10px] text-slate-500 mt-1">Visitas com status concluída</p>
            </div>

            {/* PENDENTES */}
            <div className="p-5 rounded-2xl bg-[#171b26] border border-amber-500/30 shadow-xl">
              <div className="flex items-center justify-between text-amber-400 font-mono text-[11px] font-bold">
                <span>PENDENTES</span>
                <span className="material-symbols-outlined">pending_actions</span>
              </div>
              <div className="text-3xl font-extrabold text-amber-400 font-mono mt-2">
                {processedData.totalPendentes}
              </div>
              <p className="text-[10px] text-slate-500 mt-1">Visitas sem execução no dia</p>
            </div>

            {/* NÃO REALIZADAS */}
            <div className="p-5 rounded-2xl bg-[#171b26] border border-rose-500/30 shadow-xl">
              <div className="flex items-center justify-between text-rose-400 font-mono text-[11px] font-bold">
                <span>NÃO REALIZADAS</span>
                <span className="material-symbols-outlined">cancel</span>
              </div>
              <div className="text-3xl font-extrabold text-rose-400 font-mono mt-2">
                {processedData.totalNaoRealizadas}
              </div>
              <p className="text-[10px] text-slate-500 mt-1">Com justificativa / ocorrência</p>
            </div>

            {/* ADERÊNCIA OPERACIONAL */}
            <div className="p-5 rounded-2xl bg-[#171b26] border border-indigo-500/30 shadow-xl">
              <div className="flex items-center justify-between text-indigo-400 font-mono text-[11px] font-bold">
                <span>ADERÊNCIA OPERACIONAL</span>
                <span className="material-symbols-outlined">trending_up</span>
              </div>
              <div className="text-3xl font-extrabold text-indigo-400 font-mono mt-2">
                {processedData.taxaAderenciaGeral}%
              </div>
              <p className="text-[10px] text-slate-500 mt-1">Realizadas / Planejadas</p>
            </div>
          </div>

          {/* ALTERNADOR DE VISUALIZAÇÃO (POR INDÚSTRIA OU POR PROMOTOR) */}
          <div className="flex items-center justify-between border-b border-[#1e2433] pb-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setViewMode('industria')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                  viewMode === 'industria'
                    ? 'bg-purple-600 text-white shadow-lg'
                    : 'bg-[#171b26] text-slate-400 hover:text-white border border-[#1e2433]'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">factory</span>
                <span>Visão por Indústria</span>
              </button>

              <button
                onClick={() => setViewMode('promotor')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                  viewMode === 'promotor'
                    ? 'bg-purple-600 text-white shadow-lg'
                    : 'bg-[#171b26] text-slate-400 hover:text-white border border-[#1e2433]'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">badge</span>
                <span>Visão por Promotor</span>
              </button>
            </div>

            <div className="text-xs font-mono text-slate-400 hidden sm:block">
              {viewMode === 'industria'
                ? `${processedData.tabelaIndustrias.length} Indústrias Analisadas`
                : `${processedData.tabelaPromotores.length} Promotores Analisados`}
            </div>
          </div>

          {/* TABELA DE VISÃO POR INDÚSTRIA & DETALHAMENTO POR LOJA */}
          {viewMode === 'industria' && (
            <section className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                    <span className="material-symbols-outlined text-purple-400">table_chart</span>
                    Frequência e Aderência Operacional por Indústria
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Ordenado inicialmente por menor aderência para identificação rápida de desvios. Clique na linha para detalhar por loja.
                  </p>
                </div>
              </div>

              {processedData.tabelaIndustrias.length === 0 ? (
                <div className="p-12 text-center text-slate-500 font-mono text-xs border border-dashed border-[#1e2433] rounded-xl">
                  Nenhum registro encontrado para os filtros selecionados.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-sans border-collapse">
                    <thead>
                      <tr className="border-b border-[#1e2433] text-slate-400 font-mono text-[11px] uppercase bg-[#131722]">
                        <th className="py-3 px-4 font-semibold">Indústria</th>
                        <th className="py-3 px-4 font-semibold text-right">Planejadas</th>
                        <th className="py-3 px-4 font-semibold text-right">Realizadas</th>
                        <th className="py-3 px-4 font-semibold text-right">Pendentes</th>
                        <th className="py-3 px-4 font-semibold text-right">Não Realiz.</th>
                        <th className="py-3 px-4 font-semibold text-right">Ocorrências</th>
                        <th className="py-3 px-4 font-semibold text-center">Aderência</th>
                        <th className="py-3 px-4 font-semibold text-center">Detalhamento</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e2433]">
                      {processedData.tabelaIndustrias.map((ind) => {
                        const isExpanded = expandedIndustria === ind.codigo;
                        return (
                          <React.Fragment key={ind.codigo}>
                            <tr
                              onClick={() => setExpandedIndustria(isExpanded ? null : ind.codigo)}
                              className="hover:bg-[#1d2230]/60 transition-colors cursor-pointer"
                            >
                              <td className="py-3.5 px-4 font-bold text-white flex items-center gap-2">
                                <span className="material-symbols-outlined text-slate-400 text-[18px]">
                                  factory
                                </span>
                                <div>
                                  <span className="block">{ind.nome}</span>
                                  <span className="text-[10px] font-mono text-slate-500">{ind.codigo}</span>
                                </div>
                                {ind.temQuinzenal && (
                                  <span
                                    title="Possui rotas quinzenais"
                                    className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[9px] border border-amber-500/30"
                                  >
                                    QZN
                                  </span>
                                )}
                              </td>
                              <td className="py-3.5 px-4 font-mono font-semibold text-slate-200 text-right">
                                {ind.planejadas}
                              </td>
                              <td className="py-3.5 px-4 font-mono font-bold text-emerald-400 text-right">
                                {ind.realizadas}
                              </td>
                              <td className="py-3.5 px-4 font-mono text-amber-400 text-right">
                                {ind.pendentes}
                              </td>
                              <td className="py-3.5 px-4 font-mono text-rose-400 text-right">
                                {ind.naoRealizadas}
                              </td>
                              <td className="py-3.5 px-4 font-mono text-purple-300 text-right">
                                {ind.ocorrenciasCount}
                              </td>
                              <td className="py-3.5 px-4 text-center">
                                <span
                                  className={`px-2.5 py-1 rounded-lg font-mono font-bold text-xs inline-block ${
                                    ind.aderencia >= 80
                                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                      : ind.aderencia >= 50
                                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                                      : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                                  }`}
                                >
                                  {ind.aderencia}%
                                </span>
                              </td>
                              <td className="py-3.5 px-4 text-center">
                                <button className="text-slate-400 hover:text-white transition-colors">
                                  <span className="material-symbols-outlined text-[20px]">
                                    {isExpanded ? 'expand_less' : 'expand_more'}
                                  </span>
                                </button>
                              </td>
                            </tr>

                            {/* LINHA EXPANDIDA COM DETALHAMENTO POR LOJA */}
                            {isExpanded && (
                              <tr>
                                <td colSpan={8} className="p-0 bg-[#121622] border-b border-[#1e2433]">
                                  <div className="p-4 space-y-3">
                                    <div className="text-xs font-mono font-bold text-slate-300 flex items-center justify-between border-b border-[#1e2433] pb-2">
                                      <span>DETALHAMENTO POR LOJA — {ind.nome.toUpperCase()}</span>
                                      <span className="text-slate-500 font-normal">
                                        {ind.detalhamentoLojas.length} Lojas Atendidas
                                      </span>
                                    </div>

                                    {ind.detalhamentoLojas.length === 0 ? (
                                      <div className="p-4 text-slate-500 font-mono text-xs">
                                        Sem detalhamento de lojas para esta indústria no período.
                                      </div>
                                    ) : (
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-left text-xs font-sans">
                                          <thead>
                                            <tr className="text-slate-400 font-mono text-[10px] uppercase border-b border-[#1e2433]">
                                              <th className="py-2 px-3">Loja</th>
                                              <th className="py-2 px-3">Promotor</th>
                                              <th className="py-2 px-3">Frequência</th>
                                              <th className="py-2 px-3 text-right">Planejadas</th>
                                              <th className="py-2 px-3 text-right">Realizadas</th>
                                              <th className="py-2 px-3 text-right">Pendentes</th>
                                              <th className="py-2 px-3 text-center">Aderência</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-[#1e2433]">
                                            {ind.detalhamentoLojas.map((d, idx) => (
                                              <tr key={idx} className="hover:bg-[#181d2c]">
                                                <td className="py-2.5 px-3 font-semibold text-slate-200">
                                                  {d.lojaNome}
                                                  <span className="block text-[10px] font-mono text-slate-500">
                                                    {d.lojaCodigo}
                                                  </span>
                                                </td>
                                                <td className="py-2.5 px-3 text-slate-300">
                                                  {d.promotorNome}
                                                  <span className="block text-[10px] font-mono text-slate-500">
                                                    {d.promotorMatricula}
                                                  </span>
                                                </td>
                                                <td className="py-2.5 px-3 font-mono text-[11px] uppercase">
                                                  <span className="px-2 py-0.5 rounded bg-[#1e2433] text-purple-300 font-bold border border-purple-500/20">
                                                    {d.frequencia}
                                                  </span>
                                                </td>
                                                <td className="py-2.5 px-3 font-mono text-slate-300 text-right">
                                                  {d.planejadas}
                                                </td>
                                                <td className="py-2.5 px-3 font-mono text-emerald-400 font-bold text-right">
                                                  {d.realizadas}
                                                </td>
                                                <td className="py-2.5 px-3 font-mono text-amber-400 text-right">
                                                  {d.pendentes}
                                                </td>
                                                <td className="py-2.5 px-3 text-center">
                                                  <span className="font-mono font-bold text-xs text-indigo-300">
                                                    {d.aderencia}%
                                                  </span>
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* TABELA DE VISÃO POR PROMOTOR */}
          {viewMode === 'promotor' && (
            <section className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                    <span className="material-symbols-outlined text-purple-400">badge</span>
                    Aderência Operacional por Promotor
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Métricas acumuladas de cumprimento do roteiro individual.
                  </p>
                </div>
              </div>

              {processedData.tabelaPromotores.length === 0 ? (
                <div className="p-12 text-center text-slate-500 font-mono text-xs border border-dashed border-[#1e2433] rounded-xl">
                  Nenhum promotor encontrado para os filtros selecionados.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-sans border-collapse">
                    <thead>
                      <tr className="border-b border-[#1e2433] text-slate-400 font-mono text-[11px] uppercase bg-[#131722]">
                        <th className="py-3 px-4 font-semibold">Promotor</th>
                        <th className="py-3 px-4 font-semibold text-center">Indústrias</th>
                        <th className="py-3 px-4 font-semibold text-center">Lojas</th>
                        <th className="py-3 px-4 font-semibold text-right">Planejadas</th>
                        <th className="py-3 px-4 font-semibold text-right">Realizadas</th>
                        <th className="py-3 px-4 font-semibold text-right">Pendentes</th>
                        <th className="py-3 px-4 font-semibold text-center">Aderência</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e2433]">
                      {processedData.tabelaPromotores.map((prm) => (
                        <tr key={prm.matricula} className="hover:bg-[#1d2230]/60 transition-colors">
                          <td className="py-3.5 px-4 font-bold text-white flex items-center gap-2">
                            <span className="material-symbols-outlined text-purple-400 text-[18px]">
                              person
                            </span>
                            <div>
                              <span className="block">{prm.nome}</span>
                              <span className="text-[10px] font-mono text-slate-500">{prm.matricula}</span>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-center font-mono text-slate-300">
                            {prm.qtdIndustrias}
                          </td>
                          <td className="py-3.5 px-4 text-center font-mono text-slate-300">
                            {prm.qtdLojas}
                          </td>
                          <td className="py-3.5 px-4 font-mono font-semibold text-slate-200 text-right">
                            {prm.planejadas}
                          </td>
                          <td className="py-3.5 px-4 font-mono font-bold text-emerald-400 text-right">
                            {prm.realizadas}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-amber-400 text-right">
                            {prm.pendentes}
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <span
                              className={`px-2.5 py-1 rounded-lg font-mono font-bold text-xs inline-block ${
                                prm.aderencia >= 80
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                  : prm.aderencia >= 50
                                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                                  : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                              }`}
                            >
                              {prm.aderencia}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* ABA 2: CADASTRO DAS INDÚSTRIAS (TELA ORIGINAL PRESERVADA INTEGRAMENTE)    */}
      {/* ========================================================================= */}
      {activeTab === 'cadastro' && (
        <div className="space-y-8 animate-fadeIn">
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
