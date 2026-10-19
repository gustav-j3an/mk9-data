import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { SearchableSelect, type SearchableSelectOption } from '../components/SearchableSelect';
import { StatCard, StatusBadge } from '../components/ui';
import { supabase } from '../lib/supabase';
import type { RouteItem, ToastMessage } from '../types';

interface RoutesViewProps {
  onNavigate?: (screen: any) => void;
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

type GroupByOption = 'none' | 'promotor' | 'industria' | 'loja' | 'frequencia';
type SortByOption = 'promotor' | 'industria' | 'loja' | 'frequencia' | 'codigo';

const OPTIONS_PAGE_SIZE = 1000;

const fetchAllPages = async <T,>(
  fetchPage: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>
): Promise<T[]> => {
  const rows: T[] = [];

  for (let from = 0; ; from += OPTIONS_PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + OPTIONS_PAGE_SIZE - 1);
    if (error) throw error;

    const page = data || [];
    rows.push(...page);
    if (page.length < OPTIONS_PAGE_SIZE) return rows;
  }
};

export const RoutesView: React.FC<RoutesViewProps> = ({ onShowToast }) => {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission(['admin', 'gestor']);

  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFrequencia, setSelectedFrequencia] = useState<string>('TODAS');
  const [selectedDay, setSelectedDay] = useState<string>('TODOS');
  const [selectedUF, setSelectedUF] = useState<string>('TODAS');
  const [selectedIndustria, setSelectedIndustria] = useState<string>('TODAS');
  const [selectedLoja, setSelectedLoja] = useState<string>('TODAS');
  const [selectedPromotor, setSelectedPromotor] = useState<string>('TODOS');

  // Agrupamento & Ordenação
  const [groupBy, setGroupBy] = useState<GroupByOption>('none');
  const [sortBy, setSortBy] = useState<SortByOption>('promotor');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  // Paginação inteligente (25, 50, 100)
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Modais de Visualização, Edição e Criação
  const [viewingRoute, setViewingRoute] = useState<RouteItem | null>(null);
  const [editingRoute, setEditingRoute] = useState<RouteItem | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // State para nova rota
  const [newRouteForm, setNewRouteForm] = useState({
    codigo_rota: '',
    industria_codigo: '',
    loja_codigo: '',
    promotor_matricula: '',
    uf: 'SP',
    frequencia: 'SEMANAL' as 'SEMANAL' | 'QUINZENAL',
    segunda: false,
    terca: false,
    quarta: false,
    quinta: false,
    sexta: false,
    sabado: false,
    domingo: false,
    observacao: ''
  });

  // Opções para select na criação
  const [industriasList, setIndustriasList] = useState<{ codigo: string; nome: string }[]>([]);
  const [lojasList, setLojasList] = useState<
    { codigo: string; nome: string; cidade: string | null; uf: string | null }[]
  >([]);
  const [promotoresList, setPromotoresList] = useState<{ matricula: string; nome: string }[]>([]);

  // Carregar dados de public.rotas com joins para industrias, lojas e promotores
  const fetchRoutes = async () => {
    setLoading(true);
    setError(null);

    const client = supabase;
    if (!client) {
      setError('Cliente Supabase não inicializado.');
      setLoading(false);
      return;
    }

    try {
      const [rotasRes, industrias, lojas, promotores] = await Promise.all([
        client
          .from('rotas')
          .select(`
            *,
            industria:industrias(codigo, nome),
            loja:lojas(codigo, nome, cidade, uf),
            promotor:promotores(matricula, nome, supervisor, equipe)
          `)
          .order('created_at', { ascending: false }),
        fetchAllPages((from, to) =>
          client
            .from('industrias')
            .select('codigo, nome')
            .eq('status', 'ativo')
            .order('nome')
            .range(from, to)
        ),
        fetchAllPages((from, to) =>
          client
            .from('lojas')
            .select('codigo, nome, cidade, uf')
            .eq('status', 'ativo')
            .order('nome')
            .range(from, to)
        ),
        fetchAllPages((from, to) =>
          client
            .from('promotores')
            .select('matricula, nome')
            .eq('status', 'ativo')
            .order('nome')
            .range(from, to)
        )
      ]);

      if (rotasRes.error) throw rotasRes.error;

      setRoutes((rotasRes.data as unknown as RouteItem[]) || []);
      setIndustriasList(industrias);
      setLojasList(lojas);
      setPromotoresList(promotores);
    } catch (err: any) {
      console.error('Erro ao carregar rotas:', err);
      setError(err.message || 'Falha ao carregar rotas fixas do servidor.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoutes();
  }, []);

  // Listas para filtros encadeados
  const availableUFs = useMemo(() => {
    const set = new Set<string>();
    routes.forEach((r) => {
      const uf = r.uf || r.loja?.uf;
      if (uf) set.add(uf.toUpperCase());
    });
    return Array.from(set).sort();
  }, [routes]);

  const industriaOptions = useMemo<SearchableSelectOption[]>(
    () =>
      industriasList.map((industry) => ({
        value: industry.codigo,
        label: `${industry.nome} (${industry.codigo})`,
        searchText: `${industry.nome} ${industry.codigo}`
      })),
    [industriasList]
  );

  const lojaOptions = useMemo<SearchableSelectOption[]>(
    () =>
      lojasList.map((store) => ({
        value: store.codigo,
        label: `${store.nome} (${store.codigo})`,
        detail: [store.cidade, store.uf].filter(Boolean).join(' - '),
        searchText: `${store.nome} ${store.codigo} ${store.cidade || ''} ${store.uf || ''}`
      })),
    [lojasList]
  );

  const promotorOptions = useMemo<SearchableSelectOption[]>(
    () =>
      promotoresList.map((promoter) => ({
        value: promoter.matricula,
        label: `${promoter.nome} (${promoter.matricula})`,
        searchText: `${promoter.nome} ${promoter.matricula}`
      })),
    [promotoresList]
  );

  const availableIndustrias = useMemo(() => {
    const map = new Map<string, string>();
    routes.forEach((r) => {
      if (r.industria_codigo) {
        map.set(r.industria_codigo, r.industria?.nome || r.industria_codigo);
      }
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [routes]);

  const availableLojas = useMemo(() => {
    const map = new Map<string, string>();
    routes.forEach((r) => {
      if (r.loja_codigo) {
        map.set(r.loja_codigo, r.loja?.nome || r.loja_codigo);
      }
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [routes]);

  const availablePromotores = useMemo(() => {
    const map = new Map<string, string>();
    routes.forEach((r) => {
      if (r.promotor_matricula) {
        map.set(r.promotor_matricula, r.promotor?.nome || r.promotor_matricula);
      }
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [routes]);

  // Filtragem e Ordenação
  const filteredAndSortedRoutes = useMemo(() => {
    let result = routes.filter((r) => {
      const term = searchTerm.toLowerCase().trim();
      if (term) {
        const indName = (r.industria?.nome || '').toLowerCase();
        const indCode = (r.industria_codigo || '').toLowerCase();
        const lojName = (r.loja?.nome || '').toLowerCase();
        const lojCode = (r.loja_codigo || '').toLowerCase();
        const prmName = (r.promotor?.nome || '').toLowerCase();
        const prmCode = (r.promotor_matricula || '').toLowerCase();
        const rCode = (r.codigo_rota || '').toLowerCase();

        const matchesSearch =
          indName.includes(term) ||
          indCode.includes(term) ||
          lojName.includes(term) ||
          lojCode.includes(term) ||
          prmName.includes(term) ||
          prmCode.includes(term) ||
          rCode.includes(term);

        if (!matchesSearch) return false;
      }

      if (selectedFrequencia !== 'TODAS' && r.frequencia !== selectedFrequencia) return false;
      if (selectedIndustria !== 'TODAS' && r.industria_codigo !== selectedIndustria) return false;
      if (selectedLoja !== 'TODAS' && r.loja_codigo !== selectedLoja) return false;
      if (selectedPromotor !== 'TODOS' && r.promotor_matricula !== selectedPromotor) return false;

      if (selectedDay !== 'TODOS') {
        const dayKey = selectedDay as keyof Pick<
          RouteItem,
          'segunda' | 'terca' | 'quarta' | 'quinta' | 'sexta' | 'sabado' | 'domingo'
        >;
        if (!r[dayKey]) return false;
      }

      if (selectedUF !== 'TODAS') {
        const routeUf = r.uf || r.loja?.uf || '';
        if (routeUf.toUpperCase() !== selectedUF) return false;
      }

      return true;
    });

    // Ordenação
    result.sort((a, b) => {
      if (sortBy === 'promotor') {
        const nameA = a.promotor?.nome || a.promotor_matricula;
        const nameB = b.promotor?.nome || b.promotor_matricula;
        return nameA.localeCompare(nameB);
      }
      if (sortBy === 'industria') {
        const nameA = a.industria?.nome || a.industria_codigo;
        const nameB = b.industria?.nome || b.industria_codigo;
        return nameA.localeCompare(nameB);
      }
      if (sortBy === 'loja') {
        const nameA = a.loja?.nome || a.loja_codigo;
        const nameB = b.loja?.nome || b.loja_codigo;
        return nameA.localeCompare(nameB);
      }
      if (sortBy === 'frequencia') {
        return a.frequencia.localeCompare(b.frequencia);
      }
      return a.codigo_rota.localeCompare(b.codigo_rota);
    });

    return result;
  }, [routes, searchTerm, selectedFrequencia, selectedDay, selectedUF, selectedIndustria, selectedLoja, selectedPromotor, sortBy]);

  // Resumo de métricas no topo (Geral vs Individual por Promotor selecionado)
  const metrics = useMemo(() => {
    const isPromotorSelected = selectedPromotor !== 'TODOS';

    // Quando nenhum promotor estiver selecionado, preserva os indicadores gerais da base carregada
    if (!isPromotorSelected) {
      const totalRotas = routes.length;
      const semanais = routes.filter((r) => r.frequencia === 'SEMANAL').length;
      const quinzenais = routes.filter((r) => r.frequencia === 'QUINZENAL').length;
      const promotoresUnicos = new Set(routes.map((r) => r.promotor_matricula)).size;
      const lojasUnicas = new Set(routes.map((r) => r.loja_codigo)).size;

      return {
        isIndividual: false,
        totalRotas,
        semanais,
        quinzenais,
        promotoresUnicos,
        lojasUnicas,
        visitasSemanais: 0,
        visitasQuinzenais: 0,
        promotorNome: null
      };
    }

    // Quando um promotor específico estiver selecionado, calcula métricas individuais respeitando os filtros ativos
    const targetRoutes = filteredAndSortedRoutes;
    const totalRotas = targetRoutes.length;
    const lojasUnicas = new Set(targetRoutes.map((r) => r.loja_codigo)).size;

    // Função auxiliar para contar dias ativos em uma rota
    const countActiveDays = (r: RouteItem): number => {
      let count = 0;
      if (r.segunda) count++;
      if (r.terca) count++;
      if (r.quarta) count++;
      if (r.quinta) count++;
      if (r.sexta) count++;
      if (r.sabado) count++;
      if (r.domingo) count++;
      return count;
    };

    let visitasSemanais = 0;
    let visitasQuinzenais = 0;

    targetRoutes.forEach((r) => {
      const activeDays = countActiveDays(r);
      if (r.frequencia === 'SEMANAL') {
        visitasSemanais += activeDays;
      } else if (r.frequencia === 'QUINZENAL') {
        visitasQuinzenais += activeDays;
      }
    });

    // Nome do promotor selecionado para exibição contextual
    const promotorName =
      targetRoutes[0]?.promotor?.nome ||
      availablePromotores.find(([mat]) => mat === selectedPromotor)?.[1] ||
      selectedPromotor;

    return {
      isIndividual: true,
      totalRotas,
      lojasUnicas,
      visitasSemanais,
      visitasQuinzenais,
      promotoresUnicos: 1,
      semanais: targetRoutes.filter((r) => r.frequencia === 'SEMANAL').length,
      quinzenais: targetRoutes.filter((r) => r.frequencia === 'QUINZENAL').length,
      promotorNome: promotorName
    };
  }, [routes, filteredAndSortedRoutes, selectedPromotor, availablePromotores]);

  // Paginação inteligente por rotas
  const totalItems = filteredAndSortedRoutes.length;
  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  const paginatedRoutes = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredAndSortedRoutes.slice(start, start + pageSize);
  }, [filteredAndSortedRoutes, currentPage, pageSize]);

  // Contagem total de itens por grupo no universo filtrado completo (para exibir "X rotas" no cabeçalho)
  const groupTotals = useMemo(() => {
    if (groupBy === 'none') return {};
    const counts: Record<string, number> = {};
    filteredAndSortedRoutes.forEach((r) => {
      let key = 'Outros';
      if (groupBy === 'promotor') {
        key = r.promotor?.nome ? `${r.promotor.nome} (${r.promotor_matricula})` : `Promotor ${r.promotor_matricula}`;
      } else if (groupBy === 'industria') {
        key = r.industria?.nome ? `${r.industria.nome} (${r.industria_codigo})` : `Indústria ${r.industria_codigo}`;
      } else if (groupBy === 'loja') {
        key = r.loja?.nome ? `${r.loja.nome} (${r.loja_codigo})` : `Loja ${r.loja_codigo}`;
      } else if (groupBy === 'frequencia') {
        key = `Frequência ${r.frequencia}`;
      }
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [filteredAndSortedRoutes, groupBy]);

  // Agrupamento sobre a página ativa (preserva continuidade e paginação consistente)
  const paginatedGroupedRoutes = useMemo(() => {
    if (groupBy === 'none') {
      return { 'Todas as Rotas': paginatedRoutes };
    }

    const groups: Record<string, RouteItem[]> = {};

    paginatedRoutes.forEach((r) => {
      let groupKey = 'Outros';

      if (groupBy === 'promotor') {
        groupKey = r.promotor?.nome ? `${r.promotor.nome} (${r.promotor_matricula})` : `Promotor ${r.promotor_matricula}`;
      } else if (groupBy === 'industria') {
        groupKey = r.industria?.nome ? `${r.industria.nome} (${r.industria_codigo})` : `Indústria ${r.industria_codigo}`;
      } else if (groupBy === 'loja') {
        groupKey = r.loja?.nome ? `${r.loja.nome} (${r.loja_codigo})` : `Loja ${r.loja_codigo}`;
      } else if (groupBy === 'frequencia') {
        groupKey = `Frequência ${r.frequencia}`;
      }

      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(r);
    });

    return groups;
  }, [paginatedRoutes, groupBy]);

  // Salvar Edição
  const handleSaveEdit = async () => {
    if (!editingRoute) return;

    const { segunda, terca, quarta, quinta, sexta, sabado, domingo } = editingRoute;
    if (!segunda && !terca && !quarta && !quinta && !sexta && !sabado && !domingo) {
      onShowToast({
        title: 'Sem Dias Marcados',
        message: 'Atenção: A rota continuará salva, porém está sem nenhum dia de visita marcado.',
        type: 'warning'
      });
    }

    setSaving(true);

    try {
      if (!supabase) throw new Error('Cliente Supabase não inicializado.');

      const { error: updateErr } = await supabase
        .from('rotas')
        .update({
          frequencia: editingRoute.frequencia,
          segunda: editingRoute.segunda,
          terca: editingRoute.terca,
          quarta: editingRoute.quarta,
          quinta: editingRoute.quinta,
          sexta: editingRoute.sexta,
          sabado: editingRoute.sabado,
          domingo: editingRoute.domingo,
          observacao: editingRoute.observacao || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingRoute.id);

      if (updateErr) throw updateErr;

      onShowToast({
        title: 'Rota Salva',
        message: `Escala da rota ${editingRoute.codigo_rota} atualizada no Supabase!`,
        type: 'success'
      });

      setEditingRoute(null);
      fetchRoutes();
    } catch (err: any) {
      console.error('Erro ao atualizar rota:', err);
      onShowToast({
        title: 'Falha ao Salvar Rota',
        message: err.message || 'Ocorreu um erro ao atualizar a rota.',
        type: 'error'
      });
    } finally {
      setSaving(false);
    }
  };

  // Salvar Nova Rota
  const handleSaveNewRoute = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newRouteForm.industria_codigo || !newRouteForm.loja_codigo || !newRouteForm.promotor_matricula) {
      onShowToast({
        title: 'Campos Obrigatórios',
        message: 'Indústria, Loja e Promotor são campos obrigatórios.',
        type: 'warning'
      });
      return;
    }

    setSaving(true);

    try {
      if (!supabase) throw new Error('Cliente Supabase indisponível.');

      const code = newRouteForm.codigo_rota.trim() || `ROT-${newRouteForm.promotor_matricula}`;
      const payload = {
        codigo_rota: code,
        industria_codigo: newRouteForm.industria_codigo,
        loja_codigo: newRouteForm.loja_codigo,
        promotor_matricula: newRouteForm.promotor_matricula,
        uf: newRouteForm.uf,
        frequencia: newRouteForm.frequencia,
        segunda: newRouteForm.segunda,
        terca: newRouteForm.terca,
        quarta: newRouteForm.quarta,
        quinta: newRouteForm.quinta,
        sexta: newRouteForm.sexta,
        sabado: newRouteForm.sabado,
        domingo: newRouteForm.domingo,
        observacao: newRouteForm.observacao.trim() || null
      };

      const { error: insertErr } = await supabase.from('rotas').insert([payload]);
      if (insertErr) throw insertErr;

      onShowToast({
        title: 'Rota Criada',
        message: `Rota ${code} cadastrada com sucesso!`,
        type: 'success'
      });

      setShowCreateModal(false);
      fetchRoutes();
    } catch (err: any) {
      console.error(err);
      onShowToast({
        title: 'Falha ao Criar Rota',
        message: err.message || 'Não foi possível cadastrar a nova rota.',
        type: 'error'
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full px-4 lg:px-8 py-6 max-w-[1720px] mx-auto space-y-8 font-sans">
      {/* HEADER PRINCIPAL */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#CFCDC5] pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-amber-500 to-orange-600 flex items-center justify-center font-bold text-white shadow-[0_0_14px_rgba(245,158,11,0.5)]">
              <span className="material-symbols-outlined text-[20px]">alt_route</span>
            </div>
            <h1 className="text-3xl font-extrabold text-[#171717] tracking-tight">
              Escala Operacional de Rotas Fixas
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-[#77766F] mt-1 max-w-3xl">
            Grade semanal de atendimento em campo por indústria, loja/PDV e promotor responsável.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchRoutes}
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] text-xs font-semibold text-[#171717] hover:text-white hover:border-amber-500/40 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>
              refresh
            </span>
            <span>Atualizar Dados</span>
          </button>

          {canEdit && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-all shadow-[0_0_15px_rgba(245,158,11,0.3)]"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              <span>Nova Rota Fixa</span>
            </button>
          )}
        </div>
      </section>

      {/* CARDS DE RESUMO NO TOPO */}
      {metrics.isIndividual ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs font-mono text-[#77766F] bg-[#EAE8E2] px-4 py-2 rounded-xl border border-[#CFCDC5]">
            <span className="flex items-center gap-1.5 text-amber-700 font-bold">
              <span className="material-symbols-outlined text-[16px]">person</span>
              Indicadores Individuais do Promotor: {metrics.promotorNome} ({selectedPromotor})
            </span>
            <span className="text-[11px] text-[#5F5F5F] hidden sm:inline">
              *Métricas calculadas conforme filtros ativos da grade
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="ROTAS FILTRADAS"
              value={metrics.totalRotas}
              description={`${metrics.semanais} semanais • ${metrics.quinzenais} quinzenais`}
              icon="alt_route"
              variant="warning"
            />
            <StatCard
              title="LOJAS / PDVS DISTINTOS"
              value={metrics.lojasUnicas}
              description="Pontos de venda atendidos"
              icon="storefront"
              variant="success"
            />
            <StatCard
              title="VISITAS SEMANAIS PREVISTAS"
              value={metrics.visitasSemanais}
              description="Soma dos dias ativos (semanal)"
              icon="event_repeat"
              variant="info"
            />
            <StatCard
              title="VISITAS QUINZENAIS PREVISTAS"
              value={metrics.visitasQuinzenais}
              description="Soma dos dias ativos (quinzenal)"
              icon="date_range"
              variant="default"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-[#5F5F5F] px-1">
            <span>Visão Consolidada de Toda a Operação</span>
            <span className="text-[11px] text-[#77766F] hidden sm:inline">
              Total geral na base: {routes.length} rotas cadastradas
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <StatCard
              title="TOTAL DE ROTAS"
              value={metrics.totalRotas}
              description="Cadastradas na base"
              icon="alt_route"
              variant="default"
            />
            <StatCard
              title="ROTAS SEMANAIS"
              value={metrics.semanais}
              description="Frequência semanal"
              icon="event_repeat"
              variant="info"
            />
            <StatCard
              title="ROTAS QUINZENAIS"
              value={metrics.quinzenais}
              description="Frequência quinzenal"
              icon="date_range"
              variant="warning"
            />
            <StatCard
              title="PROMOTORES ATIVOS"
              value={metrics.promotoresUnicos}
              description="Com rotas vinculadas"
              icon="badge"
              variant="warning"
            />
            <StatCard
              title="LOJAS / PDVS ATENDIDOS"
              value={metrics.lojasUnicas}
              description="Pontos de venda com escala"
              icon="storefront"
              variant="success"
              className="col-span-2 sm:col-span-1"
            />
          </div>
        </div>
      )}

      {/* PAINEL DE CONTROLES: FILTROS COMBINÁVEIS, BUSCA, AGRUPAMENTO & ORDENAÇÃO */}
      <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl p-5 shadow-2xl space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 text-xs font-mono">
          {/* Busca Rápida */}
          <div className="lg:col-span-4 relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#77766F] text-base">
              search
            </span>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Buscar rota, indústria, loja ou promotor..."
              className="w-full h-9 pl-9 pr-8 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] placeholder:text-[#5F5F5F] focus:outline-none focus:border-amber-600 focus:bg-[#F7F6F2] transition-colors"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setCurrentPage(1);
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#77766F] hover:text-[#171717] cursor-pointer"
                title="Limpar busca"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            )}
          </div>

          {/* Filtro Indústria */}
          <div className="lg:col-span-2">
            <select
              value={selectedIndustria}
              onChange={(e) => {
                setSelectedIndustria(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-9 px-2 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-amber-600 cursor-pointer"
            >
              <option value="TODAS">Indústria: Todas</option>
              {availableIndustrias.map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </div>

          {/* Filtro Loja */}
          <div className="lg:col-span-2">
            <select
              value={selectedLoja}
              onChange={(e) => {
                setSelectedLoja(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-9 px-2 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-amber-600 cursor-pointer"
            >
              <option value="TODAS">Loja: Todas</option>
              {availableLojas.map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </div>

          {/* Filtro Promotor */}
          <div className="lg:col-span-2">
            <select
              value={selectedPromotor}
              onChange={(e) => {
                setSelectedPromotor(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-9 px-2 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-amber-600 cursor-pointer"
            >
              <option value="TODOS">Promotor: Todos</option>
              {availablePromotores.map(([mat, name]) => (
                <option key={mat} value={mat}>{name}</option>
              ))}
            </select>
          </div>

          {/* Filtro UF */}
          <div className="lg:col-span-2">
            <select
              value={selectedUF}
              onChange={(e) => {
                setSelectedUF(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-9 px-2 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-amber-600 cursor-pointer"
            >
              <option value="TODAS">UF: Todas</option>
              {availableUFs.map((uf) => (
                <option key={uf} value={uf}>{uf}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Segunda Linha de Controles: Frequência, Dia, Agrupamento & Ordenação */}
        <div className="pt-3 border-t border-[#CFCDC5] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 text-xs font-mono">
          <div className="lg:col-span-3">
            <select
              value={selectedFrequencia}
              onChange={(e) => {
                setSelectedFrequencia(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-9 px-2 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-amber-600 cursor-pointer"
            >
              <option value="TODAS">Frequência: Todas</option>
              <option value="SEMANAL">Semanal</option>
              <option value="QUINZENAL">Quinzenal</option>
            </select>
          </div>

          <div className="lg:col-span-3">
            <select
              value={selectedDay}
              onChange={(e) => {
                setSelectedDay(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-9 px-2 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-amber-600 cursor-pointer"
            >
              <option value="TODOS">Dia: Qualquer dia</option>
              <option value="segunda">Segunda-feira</option>
              <option value="terca">Terça-feira</option>
              <option value="quarta">Quarta-feira</option>
              <option value="quinta">Quinta-feira</option>
              <option value="sexta">Sexta-feira</option>
              <option value="sabado">Sábado</option>
              <option value="domingo">Domingo</option>
            </select>
          </div>

          <div className="lg:col-span-3">
            <select
              value={groupBy}
              onChange={(e) => {
                setGroupBy(e.target.value as GroupByOption);
                setCollapsedGroups({});
                setCurrentPage(1);
              }}
              className="w-full h-9 px-2 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] font-bold focus:outline-none focus:border-amber-600 cursor-pointer"
            >
              <option value="none">Agrupar por: Nenhum</option>
              <option value="promotor">Agrupar por Promotor</option>
              <option value="industria">Agrupar por Indústria</option>
              <option value="loja">Agrupar por Loja</option>
              <option value="frequencia">Agrupar por Frequência</option>
            </select>
          </div>

          <div className="lg:col-span-3">
            <select
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value as SortByOption);
                setCurrentPage(1);
              }}
              className="w-full h-9 px-2 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-amber-600 cursor-pointer"
            >
              <option value="promotor">Ordenar por: Promotor</option>
              <option value="industria">Ordenar por: Indústria</option>
              <option value="loja">Ordenar por: Loja</option>
              <option value="frequencia">Ordenar por: Frequência</option>
              <option value="codigo">Ordenar por: Código Rota</option>
            </select>
          </div>
        </div>
      </div>

      {/* MATRIZ / GRADE SEMANAL OPERACIONAL DE ROTAS */}
      <section className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl p-6 shadow-2xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-[#171717] uppercase tracking-wider font-mono flex items-center gap-2">
            <span className="material-symbols-outlined text-amber-400">grid_on</span>
            Grade Semanal de Rotas ({filteredAndSortedRoutes.length} filtradas)
          </h3>

          <div className="flex items-center gap-3 text-xs font-mono text-[#77766F]">
            <div className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <span>Visita Agendada</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-slate-600 font-bold">—</span>
              <span>Sem Visita</span>
            </div>
          </div>
        </div>

        {/* LOADING */}
        {loading && (
          <div className="py-16 text-center space-y-3">
            <div className="w-10 h-10 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin mx-auto"></div>
            <p className="text-xs font-mono text-[#77766F]">Carregando dados da grade semanal...</p>
          </div>
        )}

        {/* ERRO */}
        {!loading && error && (
          <div className="p-6 bg-rose-500/10 border border-rose-500/30 rounded-xl text-center space-y-3">
            <span className="material-symbols-outlined text-rose-400 text-3xl">warning</span>
            <h4 className="text-sm font-bold text-rose-300">Erro de Carregamento</h4>
            <p className="text-xs text-[#77766F] font-mono">{error}</p>
            <button
              onClick={fetchRoutes}
              className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs cursor-pointer"
            >
              Tentar Novamente
            </button>
          </div>
        )}

        {/* VAZIO */}
        {!loading && !error && filteredAndSortedRoutes.length === 0 && (
          <div className="py-16 text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-[#EAE8E2] border border-[#CFCDC5] flex items-center justify-center text-[#5F5F5F] mx-auto">
              <span className="material-symbols-outlined text-3xl">search_off</span>
            </div>
            <h4 className="text-sm font-bold text-[#171717]">Nenhuma Rota Encontrada</h4>
            <p className="text-xs text-[#77766F] max-w-sm mx-auto">
              Não há rotas cadastradas correspondentes aos critérios selecionados.
            </p>
          </div>
        )}

        {/* TABELA / GRADE COM DESIGN COMPACTO E RESPONSIVO */}
        {!loading && !error && filteredAndSortedRoutes.length > 0 && (
          <div className="space-y-6">
            {/* BARRA SUPERIOR DE RESUMO DA PÁGINA E SELETOR DE ITENS POR PÁGINA */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono text-[#5F5F5F] px-1 pb-1 border-b border-[#EAE8E2]">
              <div className="flex items-center gap-2">
                <span>
                  Exibindo <strong className="text-[#171717]">{paginatedRoutes.length}</strong> de <strong className="text-[#171717]">{totalItems}</strong> rotas
                  {searchTerm && ` (filtrado por "${searchTerm}")`}
                </span>
                {groupBy !== 'none' && (
                  <span className="text-amber-800 font-semibold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                    Agrupado por: {groupBy.toUpperCase()}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span>Itens por pág:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="bg-[#EAE8E2] border border-[#CFCDC5] rounded px-2 py-1 text-xs text-[#171717] focus:outline-none focus:border-amber-600 cursor-pointer"
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className="px-2 py-1 rounded bg-[#EAE8E2] border border-[#CFCDC5] text-[#171717] hover:bg-[#D5D3CB] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-xs"
                    >
                      Anterior
                    </button>
                    <span>
                      Pág. {currentPage} de {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={currentPage >= totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      className="px-2 py-1 rounded bg-[#EAE8E2] border border-[#CFCDC5] text-[#171717] hover:bg-[#D5D3CB] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-xs"
                    >
                      Próxima
                    </button>
                  </div>
                )}
              </div>
            </div>

            {Object.entries(paginatedGroupedRoutes).map(([groupTitle, routeList]) => {
              const isCollapsed = Boolean(collapsedGroups[groupTitle]);
              const totalInGroup = groupTotals[groupTitle] ?? routeList.length;

              return (
                <div key={groupTitle} className="space-y-2">
                  {/* CABEÇALHO DO GRUPO (EXPANSÍVEL / RECOLHÍVEL COM CONTRASTE ESCURO) */}
                  {groupBy !== 'none' && (
                    <div
                      onClick={() =>
                        setCollapsedGroups((prev) => ({
                          ...prev,
                          [groupTitle]: !prev[groupTitle]
                        }))
                      }
                      className="px-3.5 py-2 rounded-xl bg-[#EAE8E2] hover:bg-[#E2DFD7] border border-[#CFCDC5] text-xs font-bold font-mono text-[#171717] flex items-center justify-between cursor-pointer transition-colors shadow-xs"
                      title={isCollapsed ? 'Clique para expandir o grupo' : 'Clique para recolher o grupo'}
                    >
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[18px] text-amber-700">
                          {isCollapsed ? 'folder' : 'folder_open'}
                        </span>
                        <span className="tracking-tight uppercase">
                          {groupTitle} — <span className="text-amber-800 font-extrabold">{totalInGroup} {totalInGroup === 1 ? 'ROTA' : 'ROTAS'}</span>
                        </span>
                        {routeList.length < totalInGroup && (
                          <span className="text-[11px] font-normal text-[#5F5F5F]">
                            ({routeList.length} nesta página)
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-[#5F5F5F]">
                        <span className="text-[11px] font-sans font-normal hidden sm:inline">
                          {isCollapsed ? 'Expandir' : 'Recolher'}
                        </span>
                        <span className="material-symbols-outlined text-[18px]">
                          {isCollapsed ? 'expand_more' : 'expand_less'}
                        </span>
                      </div>
                    </div>
                  )}

                  {!isCollapsed && (
                    <>
                      {/* VISUALIZAÇÃO EM GRADE DESKTOP (A PARTIR DE MD: 768PX) */}
                      <div className="hidden md:block overflow-x-auto rounded-xl border border-[#CFCDC5]">
                        <table className="w-full text-left text-xs border-collapse font-sans table-fixed">
                          <thead className="bg-[#E3E1DA]">
                            <tr className="border-b border-[#CFCDC5] text-[11px] font-bold text-[#171717] uppercase tracking-wider font-mono">
                              <th className="py-2.5 px-3 w-[20%]">Indústria</th>
                              <th className="py-2.5 px-3 w-[24%]">Loja / PDV</th>
                              <th className="py-2.5 px-2 w-[4%] text-center">UF</th>
                              <th className="py-2.5 px-3 w-[22%]">Promotor</th>
                              <th className="py-2.5 px-2 w-[9%] text-center">Frequência</th>
                              {/* GRADE SEMANAL DE SEGUNDA A DOMINGO */}
                              <th className="py-2 px-1 text-center w-[2.7%] bg-[#DCD9D0]">SEG</th>
                              <th className="py-2 px-1 text-center w-[2.7%] bg-[#DCD9D0]">TER</th>
                              <th className="py-2 px-1 text-center w-[2.7%] bg-[#DCD9D0]">QUA</th>
                              <th className="py-2 px-1 text-center w-[2.7%] bg-[#DCD9D0]">QUI</th>
                              <th className="py-2 px-1 text-center w-[2.7%] bg-[#DCD9D0]">SEX</th>
                              <th className="py-2 px-1 text-center w-[2.7%] bg-[#F5EED9] text-[#986000]">SÁB</th>
                              <th className="py-2 px-1 text-center w-[2.7%] bg-[#FCE8E8] text-[#C62828]">DOM</th>
                              <th className="py-2.5 px-2 text-right w-[6%]">Ações</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#CFCDC5] bg-[#F7F6F2]">
                            {routeList.map((r) => {
                              const hasNoDays =
                                !r.segunda && !r.terca && !r.quarta && !r.quinta && !r.sexta && !r.sabado && !r.domingo;
                              const missingRel = !r.industria || !r.loja || !r.promotor;
                              const ufVal = r.uf || r.loja?.uf || '-';

                              return (
                                <tr
                                  key={r.id}
                                  className={`hover:bg-[#EAE8E2] transition-colors ${
                                    hasNoDays ? 'bg-rose-500/10 border-l-4 border-l-rose-500' : ''
                                  } ${missingRel ? 'bg-amber-500/10' : ''}`}
                                >
                                  {/* Indústria (com truncamento e código secundário) */}
                                  <td className="py-2 px-3">
                                    <div
                                      className="font-bold text-[#171717] truncate"
                                      title={`${r.industria?.nome || r.industria_codigo} (${r.industria_codigo})`}
                                    >
                                      {r.industria?.nome || (
                                        <span className="text-amber-700 italic">{r.industria_codigo}</span>
                                      )}
                                    </div>
                                    <span className="text-[10px] text-[#5F5F5F] font-mono block">
                                      {r.industria_codigo}
                                    </span>
                                  </td>

                                  {/* Loja / PDV (com truncamento e código secundário) */}
                                  <td className="py-2 px-3">
                                    <div
                                      className="font-bold text-[#171717] truncate"
                                      title={`${r.loja?.nome || r.loja_codigo} (${r.loja_codigo})`}
                                    >
                                      {r.loja?.nome || (
                                        <span className="text-amber-700 italic">{r.loja_codigo}</span>
                                      )}
                                    </div>
                                    <span className="text-[10px] text-[#5F5F5F] font-mono block">
                                      {r.loja_codigo}
                                    </span>
                                  </td>

                                  {/* UF */}
                                  <td className="py-2 px-2 font-mono font-bold text-[#171717] text-center">
                                    {ufVal}
                                  </td>

                                  {/* Promotor */}
                                  <td className="py-2 px-3">
                                    <div
                                      className="font-bold text-[#171717] truncate"
                                      title={`${r.promotor?.nome || r.promotor_matricula} (${r.promotor_matricula})`}
                                    >
                                      {r.promotor?.nome || (
                                        <span className="text-[#986000] italic">{r.promotor_matricula}</span>
                                      )}
                                    </div>
                                    <span className="text-[10px] text-[#5F5F5F] font-mono block">
                                      Mat: {r.promotor_matricula}
                                    </span>
                                  </td>

                                  {/* Frequência com StatusBadge */}
                                  <td className="py-2 px-2 text-center">
                                    <StatusBadge
                                      status={r.frequencia}
                                      variant={r.frequencia === 'SEMANAL' ? 'semanal' : 'quinzenal'}
                                      className="text-[10px] px-1.5 py-0.5 uppercase font-mono font-bold"
                                    />
                                  </td>

                                  {/* GRADE SEMANAL DE 7 DIAS */}
                                  {[
                                    { dayKey: 'segunda', label: 'SEG' },
                                    { dayKey: 'terca', label: 'TER' },
                                    { dayKey: 'quarta', label: 'QUA' },
                                    { dayKey: 'quinta', label: 'QUI' },
                                    { dayKey: 'sexta', label: 'SEX' },
                                    { dayKey: 'sabado', label: 'SÁB' },
                                    { dayKey: 'domingo', label: 'DOM' }
                                  ].map((day) => {
                                    const marked = Boolean(r[day.dayKey as keyof RouteItem]);
                                    return (
                                      <td key={day.dayKey} className="py-2 px-1 text-center border-l border-[#CFCDC5]">
                                        {marked ? (
                                          <div
                                            className="w-5 h-5 rounded bg-emerald-100 border border-emerald-300 text-[#16794F] flex items-center justify-center mx-auto"
                                            title={`Visita agendada na ${day.label}`}
                                          >
                                            <span className="material-symbols-outlined text-[14px] font-black">
                                              check
                                            </span>
                                          </div>
                                        ) : (
                                          <span className="text-[#AAA79E] font-bold text-xs">—</span>
                                        )}
                                      </td>
                                    );
                                  })}

                                  {/* Ações */}
                                  <td className="py-2 px-2 text-right">
                                    <div className="flex items-center justify-end gap-1">
                                      <button
                                        type="button"
                                        onClick={() => setViewingRoute(r)}
                                        className="p-1 rounded-md bg-[#EAE8E2] hover:bg-[#D5D3CB] text-[#171717] border border-[#CFCDC5] cursor-pointer transition-colors"
                                        title="Ver Ficha Completa da Rota"
                                        aria-label="Ver detalhes da rota"
                                      >
                                        <span className="material-symbols-outlined text-[15px]">visibility</span>
                                      </button>

                                      {canEdit && (
                                        <button
                                          type="button"
                                          onClick={() => setEditingRoute({ ...r })}
                                          className="p-1 rounded-md bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 border border-amber-500/30 cursor-pointer transition-colors"
                                          title="Editar Escala"
                                          aria-label="Editar escala da rota"
                                        >
                                          <span className="material-symbols-outlined text-[15px]">edit</span>
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* VISUALIZAÇÃO ADAPTATIVA MOBILE/TABLET COMPACTA (< 768PX) */}
                      <div className="md:hidden space-y-3">
                        {routeList.map((r) => {
                          const ufVal = r.uf || r.loja?.uf || '-';
                          const hasNoDays =
                            !r.segunda && !r.terca && !r.quarta && !r.quinta && !r.sexta && !r.sabado && !r.domingo;

                          return (
                            <div
                              key={r.id}
                              className={`p-3.5 rounded-xl border border-[#CFCDC5] bg-[#F7F6F2] shadow-xs space-y-3 ${
                                hasNoDays ? 'border-l-4 border-l-rose-500' : ''
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="space-y-0.5">
                                  <div className="font-bold text-[#171717] text-sm leading-tight">
                                    {r.loja?.nome || r.loja_codigo}
                                  </div>
                                  <div className="text-xs text-[#5F5F5F] font-mono">
                                    {r.industria?.nome || r.industria_codigo} • UF: {ufVal}
                                  </div>
                                </div>
                                <StatusBadge
                                  status={r.frequencia}
                                  variant={r.frequencia === 'SEMANAL' ? 'semanal' : 'quinzenal'}
                                  className="text-[10px] px-2 py-0.5 font-mono"
                                />
                              </div>

                              <div className="text-xs text-[#171717] font-mono flex items-center justify-between border-t border-[#EAE8E2] pt-2">
                                <div className="flex items-center gap-1.5 truncate">
                                  <span className="material-symbols-outlined text-[16px] text-amber-700">person</span>
                                  <span className="truncate">{r.promotor?.nome || r.promotor_matricula}</span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => setViewingRoute(r)}
                                    className="p-1 rounded bg-[#EAE8E2] border border-[#CFCDC5] text-[#171717] cursor-pointer"
                                    title="Ver Detalhes"
                                  >
                                    <span className="material-symbols-outlined text-[16px]">visibility</span>
                                  </button>
                                  {canEdit && (
                                    <button
                                      type="button"
                                      onClick={() => setEditingRoute({ ...r })}
                                      className="p-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-800 cursor-pointer"
                                      title="Editar"
                                    >
                                      <span className="material-symbols-outlined text-[16px]">edit</span>
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* GRADE DIÁRIA COMPACTA EM CHIPS */}
                              <div className="grid grid-cols-7 gap-1 font-mono text-[10px] text-center pt-1 border-t border-[#EAE8E2]">
                                {[
                                  { dayKey: 'segunda', label: 'SEG' },
                                  { dayKey: 'terca', label: 'TER' },
                                  { dayKey: 'quarta', label: 'QUA' },
                                  { dayKey: 'quinta', label: 'QUI' },
                                  { dayKey: 'sexta', label: 'SEX' },
                                  { dayKey: 'sabado', label: 'SÁB' },
                                  { dayKey: 'domingo', label: 'DOM' }
                                ].map((day) => {
                                  const marked = Boolean(r[day.dayKey as keyof RouteItem]);
                                  return (
                                    <div
                                      key={day.dayKey}
                                      className={`py-1 rounded flex flex-col items-center justify-center ${
                                        marked
                                          ? 'bg-emerald-100 border border-emerald-300 text-[#16794F] font-bold'
                                          : 'bg-[#EAE8E2] text-[#AAA79E]'
                                      }`}
                                    >
                                      <span className="text-[9px]">{day.label}</span>
                                      <span className="material-symbols-outlined text-[12px] leading-none mt-0.5">
                                        {marked ? 'check' : 'remove'}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            {/* CONTROLES DE PAGINAÇÃO NO RODAPÉ */}
            {totalPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-[#CFCDC5] font-mono text-xs text-[#5F5F5F]">
                <div>
                  Mostrando página <strong className="text-[#171717]">{currentPage}</strong> de <strong className="text-[#171717]">{totalPages}</strong> ({totalItems} rotas no total)
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1.5 rounded-lg bg-[#EAE8E2] border border-[#CFCDC5] text-[#171717] hover:bg-[#D5D3CB] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    Anterior
                  </button>
                  <span className="px-2">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    className="px-3 py-1.5 rounded-lg bg-[#EAE8E2] border border-[#CFCDC5] text-[#171717] hover:bg-[#D5D3CB] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* MODAL DETALHES DA ROTA */}
      {viewingRoute && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-700 text-xl">alt_route</span>
                <div>
                  <h3 className="text-base font-bold text-[#171717] font-mono">
                    Ficha Operacional da Rota
                  </h3>
                  <span className="text-xs font-mono text-[#5F5F5F]">Código Interno: {viewingRoute.codigo_rota}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingRoute(null)}
                className="text-[#77766F] hover:text-[#171717] cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs font-mono">
              <div className="p-3 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] space-y-1">
                <span className="text-[#5F5F5F] block text-[10px] font-bold uppercase">INDÚSTRIA</span>
                <span className="text-[#171717] font-bold block">{viewingRoute.industria?.nome || viewingRoute.industria_codigo}</span>
                <span className="text-amber-800 block text-[10px]">Código: {viewingRoute.industria_codigo}</span>
              </div>

              <div className="p-3 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] space-y-1">
                <span className="text-[#5F5F5F] block text-[10px] font-bold uppercase">LOJA / PDV</span>
                <span className="text-[#171717] font-bold block">{viewingRoute.loja?.nome || viewingRoute.loja_codigo}</span>
                <span className="text-cyan-800 block text-[10px]">Código: {viewingRoute.loja_codigo} • UF: {viewingRoute.uf || viewingRoute.loja?.uf || '-'}</span>
              </div>

              <div className="p-3 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] space-y-1">
                <span className="text-[#5F5F5F] block text-[10px] font-bold uppercase">PROMOTOR RESPONSÁVEL</span>
                <span className="text-[#171717] font-bold block">{viewingRoute.promotor?.nome || viewingRoute.promotor_matricula}</span>
                <span className="text-purple-800 block text-[10px]">Matrícula: {viewingRoute.promotor_matricula}</span>
              </div>

              <div className="p-3 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] space-y-1">
                <span className="text-[#5F5F5F] block text-[10px] font-bold uppercase">FREQUÊNCIA DE VISITA</span>
                <div className="pt-0.5">
                  <StatusBadge
                    status={viewingRoute.frequencia}
                    variant={viewingRoute.frequencia === 'SEMANAL' ? 'semanal' : 'quinzenal'}
                    className="text-xs px-2 py-0.5 uppercase font-mono font-bold"
                  />
                </div>
              </div>
            </div>

            {/* Escala semanal em 7 blocos */}
            <div className="space-y-2 font-mono">
              <span className="text-xs font-bold text-[#171717] uppercase tracking-wider block">
                Escala Semanal de Visitas:
              </span>
              <div className="grid grid-cols-7 gap-1.5 text-center">
                {[
                  { key: 'segunda', label: 'Seg' },
                  { key: 'terca', label: 'Ter' },
                  { key: 'quarta', label: 'Qua' },
                  { key: 'quinta', label: 'Qui' },
                  { key: 'sexta', label: 'Sex' },
                  { key: 'sabado', label: 'Sáb' },
                  { key: 'domingo', label: 'Dom' }
                ].map((day) => {
                  const marked = Boolean(viewingRoute[day.key as keyof RouteItem]);
                  return (
                    <div
                      key={day.key}
                      className={`p-2.5 rounded-xl border flex flex-col items-center justify-center space-y-1 ${
                        marked
                          ? 'bg-emerald-100 border-emerald-300 text-[#16794F] font-bold'
                          : 'bg-[#EAE8E2] border-[#CFCDC5] text-[#AAA79E]'
                      }`}
                    >
                      <span className="text-[10px]">{day.label}</span>
                      <span className="material-symbols-outlined text-sm">
                        {marked ? 'check_circle' : 'cancel'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {viewingRoute.observacao && (
              <div className="p-3 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] space-y-1 font-mono text-xs">
                <span className="text-[#5F5F5F] text-[10px] font-bold uppercase block">Observações</span>
                <p className="text-[#171717]">{viewingRoute.observacao}</p>
              </div>
            )}

            <div className="pt-3 border-t border-[#CFCDC5] flex justify-end">
              <button
                type="button"
                onClick={() => setViewingRoute(null)}
                className="px-5 py-2 rounded-xl bg-[#EAE8E2] hover:bg-[#D5D3CB] text-[#171717] border border-[#CFCDC5] text-xs font-semibold cursor-pointer transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EDITAR ESCALA DA ROTA */}
      {editingRoute && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-700 text-xl">edit</span>
                <div>
                  <h3 className="text-base font-bold text-[#171717] font-mono">
                    Editar Escala da Rota
                  </h3>
                  <span className="text-xs font-mono text-[#5F5F5F]">Código: {editingRoute.codigo_rota}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingRoute(null)}
                className="text-[#77766F] hover:text-[#171717] cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4 text-xs font-mono">
              <div className="p-3 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] text-[#171717] space-y-1">
                <div><span className="text-[#5F5F5F]">Indústria:</span> <strong className="text-[#171717]">{editingRoute.industria?.nome || editingRoute.industria_codigo}</strong></div>
                <div><span className="text-[#5F5F5F]">Loja:</span> <strong className="text-[#171717]">{editingRoute.loja?.nome || editingRoute.loja_codigo}</strong></div>
                <div><span className="text-[#5F5F5F]">Promotor:</span> <strong className="text-amber-800">{editingRoute.promotor?.nome || editingRoute.promotor_matricula}</strong></div>
              </div>

              <div>
                <label className="text-[#171717] block mb-1 font-bold">FREQUÊNCIA DE VISITA</label>
                <select
                  value={editingRoute.frequencia}
                  onChange={(e) =>
                    setEditingRoute({ ...editingRoute, frequencia: e.target.value as any })
                  }
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-amber-600 cursor-pointer"
                >
                  <option value="SEMANAL">SEMANAL</option>
                  <option value="QUINZENAL">QUINZENAL</option>
                </select>
              </div>

              {/* Checkboxes de dias */}
              <div className="space-y-2">
                <label className="text-[#171717] block font-bold uppercase">
                  DIAS DA SEMANA COM VISITA:
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { key: 'segunda', label: 'Segunda' },
                    { key: 'terca', label: 'Terça' },
                    { key: 'quarta', label: 'Quarta' },
                    { key: 'quinta', label: 'Quinta' },
                    { key: 'sexta', label: 'Sexta' },
                    { key: 'sabado', label: 'Sábado' },
                    { key: 'domingo', label: 'Domingo' }
                  ].map((day) => {
                    const checked = Boolean(editingRoute[day.key as keyof RouteItem]);
                    return (
                      <label
                        key={day.key}
                        className={`p-2.5 rounded-xl border flex items-center gap-2 cursor-pointer transition-colors ${
                          checked
                            ? 'bg-amber-500/20 border-amber-500/50 text-amber-900 font-bold'
                            : 'bg-[#EAE8E2] border-[#CFCDC5] text-[#5F5F5F] hover:text-[#171717]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setEditingRoute({ ...editingRoute, [day.key]: e.target.checked })
                          }
                          className="rounded border-[#CFCDC5] text-amber-600 focus:ring-amber-500 w-4 h-4 cursor-pointer"
                        />
                        <span>{day.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-[#171717] block mb-1 font-bold">OBSERVAÇÕES DA ESCALA</label>
                <textarea
                  value={editingRoute.observacao || ''}
                  onChange={(e) => setEditingRoute({ ...editingRoute, observacao: e.target.value })}
                  placeholder="Observações da rota..."
                  className="w-full p-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-amber-600 h-20 resize-none"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-[#CFCDC5] flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditingRoute(null)}
                className="px-5 py-2 rounded-xl bg-[#EAE8E2] hover:bg-[#D5D3CB] text-[#171717] border border-[#CFCDC5] text-xs font-semibold cursor-pointer transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50 transition-colors shadow-xs"
              >
                {saving ? (
                  <span>Salvando no Supabase...</span>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm">save</span>
                    <span>Salvar Alterações</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CRIAR NOVA ROTA FIXA */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveNewRoute}
            className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl max-w-lg w-full max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 shadow-2xl space-y-5"
          >
            <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-3">
              <h3 className="text-sm font-bold text-[#171717] font-mono flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-700">add</span>
                Cadastrar Nova Rota Fixa
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-[#77766F] hover:text-[#171717] cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
              <div className="sm:col-span-2">
                <label className="text-[#171717] block mb-1 font-bold">CÓDIGO DA ROTA (OPCIONAL)</label>
                <input
                  type="text"
                  value={newRouteForm.codigo_rota}
                  onChange={(e) => setNewRouteForm({ ...newRouteForm, codigo_rota: e.target.value })}
                  placeholder="Ex: ROT-PRM-001 (Gerado automaticamente se vazio)"
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-amber-600"
                />
              </div>

              <div>
                <label htmlFor="new-route-industry" className="text-[#171717] block mb-1 font-bold">INDÚSTRIA (*)</label>
                <SearchableSelect
                  id="new-route-industry"
                  required
                  value={newRouteForm.industria_codigo}
                  options={industriaOptions}
                  placeholder="Selecione a Indústria"
                  onChange={(industria_codigo) => setNewRouteForm({ ...newRouteForm, industria_codigo })}
                />
              </div>

              <div>
                <label htmlFor="new-route-store" className="text-[#171717] block mb-1 font-bold">LOJA / PDV (*)</label>
                <SearchableSelect
                  id="new-route-store"
                  required
                  value={newRouteForm.loja_codigo}
                  options={lojaOptions}
                  placeholder="Selecione a Loja"
                  onChange={(loja_codigo) => {
                    const selected = lojasList.find((store) => store.codigo === loja_codigo);
                    setNewRouteForm({
                      ...newRouteForm,
                      loja_codigo,
                      uf: selected?.uf || newRouteForm.uf
                    });
                  }}
                />
              </div>

              <div>
                <label htmlFor="new-route-promoter" className="text-[#171717] block mb-1 font-bold">PROMOTOR (*)</label>
                <SearchableSelect
                  id="new-route-promoter"
                  required
                  value={newRouteForm.promotor_matricula}
                  options={promotorOptions}
                  placeholder="Selecione o Promotor"
                  onChange={(promotor_matricula) => setNewRouteForm({ ...newRouteForm, promotor_matricula })}
                />
              </div>

              <div>
                <label className="text-[#171717] block mb-1 font-bold">FREQUÊNCIA (*)</label>
                <select
                  value={newRouteForm.frequencia}
                  onChange={(e) => setNewRouteForm({ ...newRouteForm, frequencia: e.target.value as any })}
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-amber-600 cursor-pointer"
                >
                  <option value="SEMANAL">SEMANAL</option>
                  <option value="QUINZENAL">QUINZENAL</option>
                </select>
              </div>

              <div className="sm:col-span-2 space-y-2">
                <label className="text-[#171717] block font-bold uppercase">DIAS DE ATENDIMENTO:</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { key: 'segunda', label: 'Segunda' },
                    { key: 'terca', label: 'Terça' },
                    { key: 'quarta', label: 'Quarta' },
                    { key: 'quinta', label: 'Quinta' },
                    { key: 'sexta', label: 'Sexta' },
                    { key: 'sabado', label: 'Sábado' },
                    { key: 'domingo', label: 'Domingo' }
                  ].map((day) => {
                    const checked = Boolean(newRouteForm[day.key as keyof typeof newRouteForm]);
                    return (
                      <label
                        key={day.key}
                        className={`p-2.5 rounded-xl border flex items-center gap-2 cursor-pointer transition-colors ${
                          checked
                            ? 'bg-amber-500/20 border-amber-500/50 text-amber-900 font-bold'
                            : 'bg-[#EAE8E2] border-[#CFCDC5] text-[#5F5F5F] hover:text-[#171717]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => setNewRouteForm({ ...newRouteForm, [day.key]: e.target.checked })}
                          className="rounded border-[#CFCDC5] text-amber-600 focus:ring-amber-500 w-4 h-4 cursor-pointer"
                        />
                        <span>{day.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-[#CFCDC5] flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 rounded-xl bg-[#EAE8E2] hover:bg-[#D5D3CB] text-[#171717] border border-[#CFCDC5] text-xs font-semibold cursor-pointer transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50 transition-colors shadow-xs"
              >
                {saving ? (
                  <span>Cadastrando...</span>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm">save</span>
                    <span>Criar Rota</span>
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
