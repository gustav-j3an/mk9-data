import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ScreenId, ToastMessage, Visit, RouteItem, AlertItem } from '../types';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import {
  calculateOperationalVisits,
  getLocalDateString,
  OperationalVisitItem,
  DayOfWeekDate
} from '../utils/routePlanner';

interface OperationalDashboardViewProps {
  onNavigate: (screen: ScreenId) => void;
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const OperationalDashboardView: React.FC<OperationalDashboardViewProps> = ({
  onNavigate,
  onShowToast
}) => {
  const { role } = useAuth();
  const canResolve = role === 'admin' || role === 'gestor';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtro de Período Simples (today | week | month)
  const [periodFilter, setPeriodFilter] = useState<'today' | 'week' | 'month'>('today');

  const [visits, setVisits] = useState<Visit[]>([]);
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [promotoresList, setPromotoresList] = useState<any[]>([]);
  const [industriasList, setIndustriasList] = useState<any[]>([]);

  // Filtros adicionais para Agenda, Rupturas, Validades e Visitas
  const [filterIndustria, setFilterIndustria] = useState<string>('all');
  const [filterPromotor, setFilterPromotor] = useState<string>('all');
  const [filterLoja, setFilterLoja] = useState<string>('all');
  const [filterRupturaStatus, setFilterRupturaStatus] = useState<string>('abertas');
  const [filterValidadeStatus, setFilterValidadeStatus] = useState<string>('all'); // 'all' | 'vencidos' | 'ate3' | 'ate7' | 'ate30' | 'normal'
  const [filterAgendaStatus, setFilterAgendaStatus] = useState<string>('all'); // 'all' | 'em_andamento' | 'pendente' | 'nao_realizada' | 'concluida'
  const [filterAlertPriority, setFilterAlertPriority] = useState<string>('active'); // 'active' | 'all' | 'critico' | 'atencao' | 'pendente' | 'resolvido'

  const [tableSearch, setTableSearch] = useState('');
  const [tableStatus, setTableStatus] = useState<string>('all');
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);

  // Estado para Central de Pendências Operacionais (Etapa 7.2)
  const [pendenciaStatusFilter, setPendenciaStatusFilter] = useState<string>('pendente'); // 'pendente' | 'em_andamento' | 'nao_realizada' | 'concluida' | 'todas'
  const [selectedPendingItem, setSelectedPendingItem] = useState<OperationalVisitItem | null>(null);

  // Estado para URLs Assinadas de Fotos de Ruptura (visitId -> signedUrl)
  const [rupturePhotosSigned, setRupturePhotosSigned] = useState<Record<string, string>>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Métrica de última atualização
  const [lastUpdate, setLastUpdate] = useState('—');

  // Carregar dados operacionais reais do Supabase
  const fetchOperationalData = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!supabase) {
      setError('Cliente Supabase não inicializado.');
      setLoading(false);
      return;
    }

    try {
      const getLocalDateString = (d: Date) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      const now = new Date();
      let startDateStr = getLocalDateString(now);

      if (periodFilter === 'week') {
        const weekAgo = new Date();
        weekAgo.setDate(now.getDate() - 7);
        startDateStr = getLocalDateString(weekAgo);
      } else if (periodFilter === 'month') {
        const monthAgo = new Date();
        monthAgo.setDate(now.getDate() - 30);
        startDateStr = getLocalDateString(monthAgo);
      }

      // 1. Query das Visitas no Período
      let visitsQuery = supabase
        .from('visits')
        .select(`
          *,
          promotor:promotores(matricula, nome),
          loja:lojas(codigo, nome, cidade, uf, endereco),
          industria:industrias(codigo, nome),
          checklist_items:visit_checklist_items(*),
          photos:visit_photos(*),
          occurrences:visit_occurrences(*),
          validity_items:visit_product_validity(*)
        `)
        .order('created_at', { ascending: false });

      if (periodFilter === 'today') {
        visitsQuery = visitsQuery.eq('data_visita', startDateStr);
      } else {
        visitsQuery = visitsQuery.gte('data_visita', startDateStr);
      }

      // 2. Rotas, Promotores e Indústrias
      const [visitsRes, rotasRes, promotoresRes, industriasRes] = await Promise.all([
        visitsQuery,
        supabase.from('rotas').select(`
          *,
          industria:industrias(codigo, nome),
          loja:lojas(codigo, nome, cidade, uf),
          promotor:promotores(matricula, nome)
        `),
        supabase.from('promotores').select('*'),
        supabase.from('industrias').select('*')
      ]);

      if (visitsRes.error) throw visitsRes.error;
      if (rotasRes.error) throw rotasRes.error;

      const realVisits = (visitsRes.data as unknown as Visit[]) || [];
      const realRoutes = (rotasRes.data as unknown as RouteItem[]) || [];

      setVisits(realVisits);
      setRoutes(realRoutes);
      setPromotoresList(promotoresRes.data || []);
      setIndustriasList(industriasRes.data || []);

      // Gerar URLs assinadas para fotos com tipo_foto = 'ruptura'
      const signedMap: Record<string, string> = {};
      for (const v of realVisits) {
        if (v.photos && v.photos.length > 0) {
          const rupturaPhoto = v.photos.find((p) => p.tipo_foto === 'ruptura');
          if (rupturaPhoto && rupturaPhoto.storage_path) {
            try {
              const { data: signData } = await supabase.storage
                .from('visit-photos')
                .createSignedUrl(rupturaPhoto.storage_path, 3600);
              if (signData?.signedUrl) {
                signedMap[v.id] = signData.signedUrl;
              }
            } catch (err) {
              console.warn('Erro ao gerar signed URL para foto de ruptura:', err);
            }
          }
        }
      }
      setRupturePhotosSigned(signedMap);

      setLastUpdate(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (err: any) {
      console.error('Erro ao carregar dados do Painel Operacional:', err);
      setError(err.message || 'Falha ao carregar telemetria de visitas do Supabase.');
    } finally {
      setLoading(false);
    }
  }, [periodFilter]);

  useEffect(() => {
    fetchOperationalData();
  }, [fetchOperationalData]);

  // Handler para Marcar Ruptura como Resolvida
  const handleResolveRupture = async (occurrenceId: string) => {
    if (!canResolve) {
      onShowToast({
        type: 'error',
        title: 'Acesso Negado',
        message: 'Apenas Administradores e Gestores podem marcar rupturas como resolvidas.'
      });
      return;
    }

    if (!supabase) return;

    try {
      setResolvingId(occurrenceId);
      const { error: updateErr } = await supabase
        .from('visit_occurrences')
        .update({ resolvido: true })
        .eq('id', occurrenceId);

      if (updateErr) throw updateErr;

      // Atualizar localmente sem recarregar tudo
      setVisits((prevVisits) =>
        prevVisits.map((v) => {
          if (!v.occurrences) return v;
          const hasOcc = v.occurrences.some((o) => o.id === occurrenceId);
          if (!hasOcc) return v;

          return {
            ...v,
            occurrences: v.occurrences.map((o) =>
              o.id === occurrenceId ? { ...o, resolvido: true } : o
            )
          };
        })
      );

      onShowToast({
        type: 'success',
        title: 'Ruptura Resolvida',
        message: 'A ruptura foi marcada como resolvida com sucesso.'
      });
    } catch (err: any) {
      console.error('Erro ao resolver ruptura:', err);
      onShowToast({
        type: 'error',
        title: 'Erro ao Resolver',
        message: err.message || 'Não foi possível atualizar o status da ruptura.'
      });
    } finally {
      setResolvingId(null);
    }
  };

  // 1. GERAR DATAS DO PERÍODO SELECIONADO (Hoje, 7 dias, Este mês)
  const getLocalStr = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const now = new Date();
  const dayKeys = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

  const datesInPeriod: Array<{ dateStr: string; dayKey: string }> = [];

  if (periodFilter === 'today') {
    const todayStr = getLocalStr(now);
    const currentDayKey = dayKeys[now.getDay()];
    datesInPeriod.push({ dateStr: todayStr, dayKey: currentDayKey });
  } else if (periodFilter === 'week') {
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const dateStr = getLocalStr(d);
      const dayKey = dayKeys[d.getDay()];
      datesInPeriod.push({ dateStr, dayKey });
    }
  } else if (periodFilter === 'month') {
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const dateStr = getLocalStr(d);
      const dayKey = dayKeys[d.getDay()];
      datesInPeriod.push({ dateStr, dayKey });
    }
  }
  // 1.5. CÁLCULO UNIFICADO DA CENTRAL DE PENDÊNCIAS OPERACIONAIS (Etapa 7.2)
  const todayStr = useMemo(() => getLocalDateString(new Date()), []);

  const periodDaysRange = useMemo(() => {
    const now = new Date();
    let numDays = 1;
    if (periodFilter === 'week') numDays = 7;
    if (periodFilter === 'month') numDays = 30;

    const days: DayOfWeekDate[] = [];
    const dayKeys: Array<'domingo' | 'segunda' | 'terca' | 'quarta' | 'quinta' | 'sexta' | 'sabado'> = [
      'domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'
    ];
    const dayLabels = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const dayShorts = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

    for (let i = numDays - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dateStr = getLocalDateString(d);
      const dayIdx = d.getDay();

      days.push({
        dateStr,
        dayKey: dayKeys[dayIdx],
        dayLabel: dayLabels[dayIdx],
        dayShort: dayShorts[dayIdx],
        isToday: dateStr === todayStr,
        isPast: dateStr < todayStr,
        isFuture: dateStr > todayStr
      });
    }
    return days;
  }, [periodFilter, todayStr]);

  const allOperationalVisits = useMemo(() => {
    return calculateOperationalVisits({
      routes,
      visits,
      promotoresList,
      industriasList,
      daysRange: periodDaysRange,
      todayStr
    });
  }, [routes, visits, promotoresList, industriasList, periodDaysRange, todayStr]);

  const pendenciasKpis = useMemo(() => {
    const pendentesHoje = allOperationalVisits.filter(v => v.status === 'pendente' && v.dataStr === todayStr).length;
    const pendentesTotal = allOperationalVisits.filter(v => v.status === 'pendente').length;
    const pendentesAtrasadas = allOperationalVisits.filter(v => v.status === 'pendente' && v.isPastOverdue).length;
    const naoRealizadas = allOperationalVisits.filter(v => v.status === 'nao_realizada').length;
    const emAndamento = allOperationalVisits.filter(v => v.status === 'em_andamento').length;
    const concluidas = allOperationalVisits.filter(v => v.status === 'concluida').length;
    const totalPlanejadas = allOperationalVisits.length;
    const aderencia = totalPlanejadas > 0 ? Math.round((concluidas / totalPlanejadas) * 100) : 0;

    return {
      pendentesHoje,
      pendentesTotal,
      pendentesAtrasadas,
      naoRealizadas,
      emAndamento,
      concluidas,
      totalPlanejadas,
      aderencia
    };
  }, [allOperationalVisits, todayStr]);

  const promotoresPendingSummary = useMemo(() => {
    const map = new Map<string, {
      matricula: string;
      nome: string;
      totalPlanned: number;
      pendentes: number;
      concluidas: number;
      naoRealizadas: number;
      emAndamento: number;
    }>();

    allOperationalVisits.forEach((item) => {
      if (!map.has(item.promotorMatricula)) {
        map.set(item.promotorMatricula, {
          matricula: item.promotorMatricula,
          nome: item.promotorNome,
          totalPlanned: 0,
          pendentes: 0,
          concluidas: 0,
          naoRealizadas: 0,
          emAndamento: 0
        });
      }
      const p = map.get(item.promotorMatricula)!;
      p.totalPlanned++;
      if (item.status === 'pendente') p.pendentes++;
      if (item.status === 'concluida') p.concluidas++;
      if (item.status === 'nao_realizada') p.naoRealizadas++;
      if (item.status === 'em_andamento') p.emAndamento++;
    });

    return Array.from(map.values())
      .map((p) => ({
        ...p,
        aderencia: p.totalPlanned > 0 ? Math.round((p.concluidas / p.totalPlanned) * 100) : 0
      }))
      .sort((a, b) => {
        if (b.pendentes !== a.pendentes) return b.pendentes - a.pendentes;
        return a.aderencia - b.aderencia;
      });
  }, [allOperationalVisits]);

  const pendenciasFiltradas = useMemo(() => {
    return allOperationalVisits.filter((item) => {
      const matchInd = filterIndustria === 'all' || item.industriaCodigo === filterIndustria;
      const matchProm = filterPromotor === 'all' || item.promotorMatricula === filterPromotor;
      const matchLoja = filterLoja === 'all' || item.lojaCodigo === filterLoja;

      let matchStatus = true;
      if (pendenciaStatusFilter !== 'todas') {
        matchStatus = item.status === pendenciaStatusFilter;
      }

      return matchInd && matchProm && matchLoja && matchStatus;
    });
  }, [allOperationalVisits, filterIndustria, filterPromotor, filterLoja, pendenciaStatusFilter]);

  // 2. EXPANDIR OCORRÊNCIAS DE PLANEJAMENTO REAL POR DATA E ROTA
  // Chave de desduplicação única: `promotor_matricula|loja_codigo|industria_codigo|dataStr`
  const plannedMap = new Map<string, {
    routeId: string;
    promotorMatricula: string;
    lojaCodigo: string;
    industriaCodigo: string;
    dataStr: string;
    frequencia: string;
  }>();

  routes.forEach((r) => {
    datesInPeriod.forEach(({ dateStr, dayKey }) => {
      // Verificar se o dia da semana está marcado na rota (segunda, terca, etc.)
      const isDayActive = Boolean(r[dayKey as keyof RouteItem]);
      if (isDayActive) {
        const uniqueKey = `${r.promotor_matricula}|${r.loja_codigo}|${r.industria_codigo}|${dateStr}`;
        if (!plannedMap.has(uniqueKey)) {
          plannedMap.set(uniqueKey, {
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

  const totalPlannedItems = Array.from(plannedMap.values());
  const rotasPlanejadasCount = totalPlannedItems.length;

  // 3. CRUZAMENTO DE VISITAS REALIZADAS COM PLANEJAMENTO NO PERÍODO
  const totalVisitas = visits.length;
  const concluidasCount = visits.filter((v) => v.status === 'concluida' && v.completed_at != null).length;
  const iniciadasCount = visits.filter((v) => v.status === 'em_andamento').length;
  const naoRealizadasCount = visits.filter((v) => v.status === 'nao_realizada').length;
  const pendentesCount = Math.max(0, rotasPlanejadasCount - concluidasCount - naoRealizadasCount - iniciadasCount);

  // Taxa de Execução Real (Visitas Concluídas / Ocorrências Planejadas no Período)
  const taxaExecucao = rotasPlanejadasCount > 0
    ? Math.round((concluidasCount / rotasPlanejadasCount) * 100)
    : (totalVisitas > 0 ? Math.round((concluidasCount / totalVisitas) * 100) : 0);

  // 4. Mapeamento de Lojas Sem Atendimento (Não Realizadas, Em Andamento ou Pendentes)
  const visitsMapByRouteKey = new Map<string, Visit>();
  visits.forEach((v) => {
    const k = `${v.promotor_matricula}|${v.loja_codigo}|${v.industria_codigo}`;
    visitsMapByRouteKey.set(k, v);
  });

  const lojasSemAtendimento = totalPlannedItems.map((pi) => {
    const k = `${pi.promotorMatricula}|${pi.lojaCodigo}|${pi.industriaCodigo}`;
    const v = visitsMapByRouteKey.get(k);

    const promotorObj = promotoresList.find((p) => p.matricula === pi.promotorMatricula);
    const industriaObj = industriasList.find((ind) => ind.codigo === pi.industriaCodigo);
    const routeObj = routes.find((r) => r.id === pi.routeId);

    let statusCalculado: 'concluida' | 'em_andamento' | 'nao_realizada' | 'pendente' = 'pendente';
    let motivo: string | undefined = undefined;

    if (v) {
      statusCalculado = v.status;
      motivo = v.motivo_nao_realizada || undefined;
    }

    return {
      key: k,
      routeId: pi.routeId,
      dataStr: pi.dataStr,
      promotorNome: promotorObj?.nome || pi.promotorMatricula,
      promotorMatricula: pi.promotorMatricula,
      lojaNome: routeObj?.loja?.nome || pi.lojaCodigo,
      lojaCodigo: pi.lojaCodigo,
      industriaNome: industriaObj?.nome || pi.industriaCodigo,
      status: statusCalculado,
      motivo
    };
  }).filter((item) => item.status !== 'concluida');

  // 4.5. ETAPA 4.5 — AGENDA OPERACIONAL DO DIA (Partindo de TODAS as rotas planejadas do dia)
  interface AgendaItem {
    key: string;
    routeId: string;
    dataStr: string;
    promotorMatricula: string;
    promotorNome: string;
    lojaCodigo: string;
    lojaNome: string;
    industriaCodigo: string;
    industriaNome: string;
    status: 'concluida' | 'em_andamento' | 'nao_realizada' | 'pendente';
    motivoNaoRealizada?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    duracaoFormatada?: string | null;
    visitObj?: Visit | null;
    priorityOrder: number;
  }

  const todayStrStr = getLocalStr(now);
  const plannedItemsToday = totalPlannedItems.filter((pi) => pi.dataStr === todayStrStr);

  const agendaDoDia: AgendaItem[] = plannedItemsToday.map((pi) => {
    const k = `${pi.promotorMatricula}|${pi.lojaCodigo}|${pi.industriaCodigo}`;
    const v = visitsMapByRouteKey.get(k);

    const promotorObj = promotoresList.find((p) => p.matricula === pi.promotorMatricula);
    const industriaObj = industriasList.find((ind) => ind.codigo === pi.industriaCodigo);
    const routeObj = routes.find((r) => r.id === pi.routeId);

    let status: 'concluida' | 'em_andamento' | 'nao_realizada' | 'pendente' = 'pendente';
    let startedAt: string | null = null;
    let completedAt: string | null = null;
    let motivoNaoRealizada: string | null = null;
    let duracaoFormatada: string | null = null;
    let priorityOrder = 2; // Default pendente

    if (v) {
      status = v.status;
      startedAt = v.started_at || null;
      completedAt = v.completed_at || null;
      motivoNaoRealizada = v.motivo_nao_realizada || null;

      if (v.status === 'em_andamento') {
        priorityOrder = 1;
      } else if (v.status === 'nao_realizada') {
        priorityOrder = 3;
      } else if (v.status === 'concluida') {
        priorityOrder = 4;
      }

      // Calcular Duração para Visitas Concluídas
      if (startedAt && completedAt) {
        const sTime = new Date(startedAt).getTime();
        const cTime = new Date(completedAt).getTime();
        const diffMs = cTime - sTime;
        if (diffMs > 0) {
          const totalMin = Math.floor(diffMs / 60000);
          const hours = Math.floor(totalMin / 60);
          const mins = totalMin % 60;
          if (hours > 0) {
            duracaoFormatada = `${hours}h ${mins}min`;
          } else {
            duracaoFormatada = `${mins}min`;
          }
        }
      }
    }

    return {
      key: k,
      routeId: pi.routeId,
      dataStr: pi.dataStr,
      promotorMatricula: pi.promotorMatricula,
      promotorNome: promotorObj?.nome || pi.promotorMatricula,
      lojaCodigo: pi.lojaCodigo,
      lojaNome: routeObj?.loja?.nome || pi.lojaCodigo,
      industriaCodigo: pi.industriaCodigo,
      industriaNome: industriaObj?.nome || pi.industriaCodigo,
      status,
      motivoNaoRealizada,
      startedAt,
      completedAt,
      duracaoFormatada,
      visitObj: v || null,
      priorityOrder
    };
  });

  const agendaFiltrada = agendaDoDia.filter((item) => {
    const matchInd = filterIndustria === 'all' || item.industriaCodigo === filterIndustria;
    const matchProm = filterPromotor === 'all' || item.promotorMatricula === filterPromotor;
    const matchLoja = filterLoja === 'all' || item.lojaCodigo === filterLoja;
    const matchStatus = filterAgendaStatus === 'all' || item.status === filterAgendaStatus;

    return matchInd && matchProm && matchLoja && matchStatus;
  }).sort((a, b) => {
    if (a.priorityOrder !== b.priorityOrder) {
      return a.priorityOrder - b.priorityOrder;
    }
    // Dentro do mesmo grupo, ordenar por horário de início (mais recente primeiro se houver)
    if (a.startedAt && b.startedAt) {
      return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
    }
    if (a.startedAt) return -1;
    if (b.startedAt) return 1;
    return a.lojaNome.localeCompare(b.lojaNome);
  });

  // 5. CONSOLIDAÇÃO DE RUPTURAS OPERACIONAIS (public.visit_occurrences onde tipo = 'ruptura')
  interface RupturaItem {
    id: string;
    visitId: string;
    dataVisita: string;
    createdAt?: string;
    lojaCodigo: string;
    lojaNome: string;
    industriaCodigo: string;
    industriaNome: string;
    promotorMatricula: string;
    promotorNome: string;
    descricao: string;
    resolvido: boolean;
    photoSignedUrl?: string;
  }

  const todasRupturas: RupturaItem[] = [];

  visits.forEach((v) => {
    if (v.occurrences && v.occurrences.length > 0) {
      v.occurrences.forEach((occ) => {
        if (occ.tipo === 'ruptura') {
          todasRupturas.push({
            id: occ.id || `ruptura-${Math.random()}`,
            visitId: v.id,
            dataVisita: v.data_visita,
            createdAt: occ.created_at || v.created_at,
            lojaCodigo: v.loja_codigo,
            lojaNome: v.loja?.nome || v.loja_codigo,
            industriaCodigo: v.industria_codigo,
            industriaNome: v.industria?.nome || v.industria_codigo,
            promotorMatricula: v.promotor_matricula,
            promotorNome: v.promotor?.nome || v.promotor_matricula,
            descricao: occ.descricao,
            resolvido: Boolean(occ.resolvido),
            photoSignedUrl: rupturePhotosSigned[v.id]
          });
        }
      });
    }
  });

  const totalRupturasCount = todasRupturas.length;
  const rupturasAbertasCount = todasRupturas.filter((r) => !r.resolvido).length;
  const rupturasResolvidasCount = todasRupturas.filter((r) => r.resolvido).length;

  // Filtrar rupturas conforme controles da interface
  const rupturasFiltradas = todasRupturas.filter((r) => {
    const matchInd = filterIndustria === 'all' || r.industriaCodigo === filterIndustria;
    const matchProm = filterPromotor === 'all' || r.promotorMatricula === filterPromotor;
    const matchLoja = filterLoja === 'all' || r.lojaCodigo === filterLoja;
    const matchStatus =
      filterRupturaStatus === 'all'
        ? true
        : filterRupturaStatus === 'abertas'
        ? !r.resolvido
        : r.resolvido;

    return matchInd && matchProm && matchLoja && matchStatus;
  }).sort((a, b) => new Date(b.createdAt || b.dataVisita).getTime() - new Date(a.createdAt || a.dataVisita).getTime());

  // 6. CONSOLIDAÇÃO DE VALIDADES E VENCIMENTOS (public.visit_product_validity)
  interface ValidadeItem {
    id: string;
    visitId: string;
    produtoNome: string;
    quantidade: number;
    dataVencimento: string;
    lote?: string | null;
    observacao?: string | null;
    lojaCodigo: string;
    lojaNome: string;
    industriaCodigo: string;
    industriaNome: string;
    promotorMatricula: string;
    promotorNome: string;
    diffDays: number;
    categoria: 'vencidos' | 'ate3' | 'ate7' | 'ate30' | 'normal';
    priority: number;
  }

  const todasValidades: ValidadeItem[] = [];

  visits.forEach((v) => {
    if (v.validity_items && v.validity_items.length > 0) {
      v.validity_items.forEach((valItem) => {
        const [vYear, vMonth, vDay] = valItem.data_vencimento.split('-').map(Number);
        const vencDate = new Date(vYear, vMonth - 1, vDay);
        const nDate = new Date();
        const todayLocal = new Date(nDate.getFullYear(), nDate.getMonth(), nDate.getDate());

        const diffTime = vencDate.getTime() - todayLocal.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        let categoria: 'vencidos' | 'ate3' | 'ate7' | 'ate30' | 'normal' = 'normal';
        let priority = 5;

        if (diffDays < 0) {
          categoria = 'vencidos';
          priority = 1;
        } else if (diffDays <= 3) {
          categoria = 'ate3';
          priority = 2;
        } else if (diffDays <= 7) {
          categoria = 'ate7';
          priority = 3;
        } else if (diffDays <= 30) {
          categoria = 'ate30';
          priority = 4;
        }

        todasValidades.push({
          id: valItem.id || `val-${Math.random()}`,
          visitId: v.id,
          produtoNome: valItem.produto_nome,
          quantidade: valItem.quantidade,
          dataVencimento: valItem.data_vencimento,
          lote: valItem.lote,
          observacao: valItem.observacao,
          lojaCodigo: v.loja_codigo,
          lojaNome: v.loja?.nome || v.loja_codigo,
          industriaCodigo: v.industria_codigo,
          industriaNome: v.industria?.nome || v.industria_codigo,
          promotorMatricula: v.promotor_matricula,
          promotorNome: v.promotor?.nome || v.promotor_matricula,
          diffDays,
          categoria,
          priority
        });
      });
    }
  });

  const validadeCountVencidos = todasValidades.filter((v) => v.categoria === 'vencidos').length;
  const validadeCountAte3 = todasValidades.filter((v) => v.categoria === 'ate3').length;
  const validadeCountAte7 = todasValidades.filter((v) => v.categoria === 'ate7').length;
  const validadeCountAte30 = todasValidades.filter((v) => v.categoria === 'ate30').length;
  const validadeCountNormal = todasValidades.filter((v) => v.categoria === 'normal').length;

  const validadesFiltradas = todasValidades.filter((v) => {
    const matchInd = filterIndustria === 'all' || v.industriaCodigo === filterIndustria;
    const matchProm = filterPromotor === 'all' || v.promotorMatricula === filterPromotor;
    const matchLoja = filterLoja === 'all' || v.lojaCodigo === filterLoja;
    const matchCat = filterValidadeStatus === 'all' || v.categoria === filterValidadeStatus;

    return matchInd && matchProm && matchLoja && matchCat;
  }).sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.diffDays - b.diffDays;
  });

  // Métricas de Fotos, Checklist e Ocorrências
  let totalFotos = 0;
  let totalChecklistItems = 0;
  let totalChecklistChecked = 0;

  let totalOcorrencias = 0;
  const ocorrenciasPorTipo = {
    ruptura: 0,
    preco_divergente: 0,
    falta_espaco: 0,
    outro: 0
  };

  const listaOcorrenciasCriticas: Array<{
    id: string;
    visitId: string;
    promotor: string;
    loja: string;
    industria: string;
    tipo: string;
    descricao: string;
    dataHora?: string;
  }> = [];

  visits.forEach((v) => {
    if (v.photos) totalFotos += v.photos.length;

    if (v.checklist_items) {
      totalChecklistItems += v.checklist_items.length;
      totalChecklistChecked += v.checklist_items.filter((c) => c.checked).length;
    }

    if (v.occurrences && v.occurrences.length > 0) {
      totalOcorrencias += v.occurrences.length;
      v.occurrences.forEach((occ) => {
        const t = occ.tipo as keyof typeof ocorrenciasPorTipo;
        if (ocorrenciasPorTipo[t] !== undefined) {
          ocorrenciasPorTipo[t]++;
        } else {
          ocorrenciasPorTipo.outro++;
        }

        listaOcorrenciasCriticas.push({
          id: occ.id || `occ-${Math.random()}`,
          visitId: v.id,
          promotor: v.promotor?.nome || v.promotor_matricula,
          loja: v.loja?.nome || v.loja_codigo,
          industria: v.industria?.nome || v.industria_codigo,
          tipo: occ.tipo,
          descricao: occ.descricao,
          dataHora: occ.created_at
        });
      });
    }
  });

  const checklistPerc = totalChecklistItems > 0 ? Math.round((totalChecklistChecked / totalChecklistItems) * 100) : 0;

  // 5.5. ETAPA 5 — CENTRAL DE ALERTAS OPERACIONAIS (Unificação dos alertas em memória)
  const allCentralAlerts = useMemo<AlertItem[]>(() => {
    const alerts: AlertItem[] = [];

    // 1. Rupturas (Abertas -> 🔴 CRÍTICO | Resolvidas -> 🟢 RESOLVIDO)
    visits.forEach((v) => {
      if (v.occurrences && v.occurrences.length > 0) {
        v.occurrences.forEach((occ) => {
          if (occ.tipo === 'ruptura') {
            const isResolvido = Boolean(occ.resolvido);
            const occDate = occ.created_at || v.created_at || v.data_visita;
            const ts = new Date(occDate).getTime() || 0;

            if (!isResolvido) {
              alerts.push({
                id: `alert-ruptura-${occ.id || Math.random()}`,
                prioridade: 'critico',
                tipo: 'ruptura',
                data: v.data_visita,
                loja: v.loja?.nome || v.loja_codigo,
                lojaCodigo: v.loja_codigo,
                industria: v.industria?.nome || v.industria_codigo,
                industriaCodigo: v.industria_codigo,
                promotor: v.promotor?.nome || v.promotor_matricula,
                promotorMatricula: v.promotor_matricula,
                titulo: 'Ruptura em aberto',
                descricao: occ.descricao || 'Falta de produto na gôndola registrada em campo.',
                origem: 'Visit Occurrences',
                statusVisual: '🔴 Aberta',
                visitObj: v,
                occurrenceId: occ.id,
                createdAtTimestamp: ts
              });
            } else {
              alerts.push({
                id: `alert-ruptura-resolvida-${occ.id || Math.random()}`,
                prioridade: 'resolvido',
                tipo: 'ruptura',
                data: v.data_visita,
                loja: v.loja?.nome || v.loja_codigo,
                lojaCodigo: v.loja_codigo,
                industria: v.industria?.nome || v.industria_codigo,
                industriaCodigo: v.industria_codigo,
                promotor: v.promotor?.nome || v.promotor_matricula,
                promotorMatricula: v.promotor_matricula,
                titulo: 'Ruptura Resolvida',
                descricao: occ.descricao || 'Ocorrência de ruptura tratada pelo gestor.',
                origem: 'Visit Occurrences',
                statusVisual: '🟢 Resolvida',
                visitObj: v,
                occurrenceId: occ.id,
                createdAtTimestamp: ts
              });
            }
          }
        });
      }
    });

    // 2. Validade de Produtos (🔴 CRÍTICO / 🟠 ATENÇÃO / 🟡 PENDENTE)
    visits.forEach((v) => {
      if (v.validity_items && v.validity_items.length > 0) {
        v.validity_items.forEach((valItem) => {
          const [vYear, vMonth, vDay] = valItem.data_vencimento.split('-').map(Number);
          const vencDate = new Date(vYear, vMonth - 1, vDay);
          const nDate = new Date();
          const todayLocal = new Date(nDate.getFullYear(), nDate.getMonth(), nDate.getDate());
          const diffTime = vencDate.getTime() - todayLocal.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          const ts = vencDate.getTime();

          const lojaNome = v.loja?.nome || v.loja_codigo;
          const indNome = v.industria?.nome || v.industria_codigo;
          const promNome = v.promotor?.nome || v.promotor_matricula;
          const loteStr = valItem.lote ? ` | Lote: ${valItem.lote}` : '';
          const baseDesc = `Produto: ${valItem.produto_nome} | Qtd: ${valItem.quantidade} | Validade: ${valItem.data_vencimento}${loteStr}`;

          if (diffDays < 0) {
            alerts.push({
              id: `alert-val-vencido-${valItem.id || Math.random()}`,
              prioridade: 'critico',
              tipo: 'validade',
              data: v.data_visita,
              loja: lojaNome,
              lojaCodigo: v.loja_codigo,
              industria: indNome,
              industriaCodigo: v.industria_codigo,
              promotor: promNome,
              promotorMatricula: v.promotor_matricula,
              titulo: 'Produto vencido',
              descricao: `${baseDesc} (${Math.abs(diffDays)} dia(s) vencido)`,
              origem: 'Product Validity',
              statusVisual: '🔴 Vencido',
              visitObj: v,
              createdAtTimestamp: ts
            });
          } else if (diffDays <= 3) {
            alerts.push({
              id: `alert-val-ate3-${valItem.id || Math.random()}`,
              prioridade: 'critico',
              tipo: 'validade',
              data: v.data_visita,
              loja: lojaNome,
              lojaCodigo: v.loja_codigo,
              industria: indNome,
              industriaCodigo: v.industria_codigo,
              promotor: promNome,
              promotorMatricula: v.promotor_matricula,
              titulo: 'Produto vencendo em até 3 dias',
              descricao: `${baseDesc} (${diffDays === 0 ? 'Vence Hoje' : 'Vence em ' + diffDays + 'd'})`,
              origem: 'Product Validity',
              statusVisual: '🚨 Até 3 dias',
              visitObj: v,
              createdAtTimestamp: ts
            });
          } else if (diffDays <= 7) {
            alerts.push({
              id: `alert-val-ate7-${valItem.id || Math.random()}`,
              prioridade: 'atencao',
              tipo: 'validade',
              data: v.data_visita,
              loja: lojaNome,
              lojaCodigo: v.loja_codigo,
              industria: indNome,
              industriaCodigo: v.industria_codigo,
              promotor: promNome,
              promotorMatricula: v.promotor_matricula,
              titulo: 'Produto vencendo em 4–7 dias',
              descricao: `${baseDesc} (Vence em ${diffDays}d)`,
              origem: 'Product Validity',
              statusVisual: '🟠 4–7 dias',
              visitObj: v,
              createdAtTimestamp: ts
            });
          } else if (diffDays <= 30) {
            alerts.push({
              id: `alert-val-ate30-${valItem.id || Math.random()}`,
              prioridade: 'pendente',
              tipo: 'validade',
              data: v.data_visita,
              loja: lojaNome,
              lojaCodigo: v.loja_codigo,
              industria: indNome,
              industriaCodigo: v.industria_codigo,
              promotor: promNome,
              promotorMatricula: v.promotor_matricula,
              titulo: 'Produto próximo do vencimento',
              descricao: `${baseDesc} (Vence em ${diffDays}d)`,
              origem: 'Product Validity',
              statusVisual: '🟡 8–30 dias',
              visitObj: v,
              createdAtTimestamp: ts
            });
          }
        });
      }
    });

    // 3. Visitas (Em andamento > 2h -> 🔴 CRÍTICO | Não Realizada -> 🟠 ATENÇÃO)
    visits.forEach((v) => {
      const ts = new Date(v.created_at || v.data_visita).getTime();
      const lojaNome = v.loja?.nome || v.loja_codigo;
      const indNome = v.industria?.nome || v.industria_codigo;
      const promNome = v.promotor?.nome || v.promotor_matricula;

      if (v.status === 'em_andamento' && v.started_at) {
        const sTime = new Date(v.started_at).getTime();
        const diffMs = Date.now() - sTime;
        const totalMinutes = Math.floor(diffMs / 60000);
        if (totalMinutes > 120) {
          alerts.push({
            id: `alert-visita-2h-${v.id}`,
            prioridade: 'critico',
            tipo: 'visita',
            data: v.data_visita,
            loja: lojaNome,
            lojaCodigo: v.loja_codigo,
            industria: indNome,
            industriaCodigo: v.industria_codigo,
            promotor: promNome,
            promotorMatricula: v.promotor_matricula,
            titulo: 'Visita em andamento há mais de 2h',
            descricao: `Visita em execução há ${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}min (excede limite recomendado de 120min)`,
            origem: 'Visitas',
            statusVisual: '🔵 Longa (> 2h)',
            visitObj: v,
            createdAtTimestamp: ts
          });
        }
      } else if (v.status === 'nao_realizada') {
        const motivoStr = v.motivo_nao_realizada ? `Motivo: ${v.motivo_nao_realizada}` : 'Atendimento finalizado sem conclusão.';
        alerts.push({
          id: `alert-visita-nao-realizada-${v.id}`,
          prioridade: 'atencao',
          tipo: 'visita',
          data: v.data_visita,
          loja: lojaNome,
          lojaCodigo: v.loja_codigo,
          industria: indNome,
          industriaCodigo: v.industria_codigo,
          promotor: promNome,
          promotorMatricula: v.promotor_matricula,
          titulo: 'Visita Não Realizada',
          descricao: motivoStr,
          origem: 'Visitas',
          statusVisual: '🔴 Não Realizada',
          visitObj: v,
          createdAtTimestamp: ts
        });
      }
    });

    // 4. Rotas Planejadas Sem Atendimento (🟡 PENDENTE)
    totalPlannedItems.forEach((pi) => {
      const k = `${pi.promotorMatricula}|${pi.lojaCodigo}|${pi.industriaCodigo}`;
      const v = visitsMapByRouteKey.get(k);
      if (!v || (v.status !== 'concluida' && v.status !== 'em_andamento' && v.status !== 'nao_realizada')) {
        const promotorObj = promotoresList.find((p) => p.matricula === pi.promotorMatricula);
        const industriaObj = industriasList.find((ind) => ind.codigo === pi.industriaCodigo);
        const routeObj = routes.find((r) => r.id === pi.routeId);

        alerts.push({
          id: `alert-rota-pendente-${pi.promotorMatricula}-${pi.lojaCodigo}-${pi.industriaCodigo}-${pi.dataStr}`,
          prioridade: 'pendente',
          tipo: 'visita',
          data: pi.dataStr,
          loja: routeObj?.loja?.nome || pi.lojaCodigo,
          lojaCodigo: pi.lojaCodigo,
          industria: industriaObj?.nome || pi.industriaCodigo,
          industriaCodigo: pi.industriaCodigo,
          promotor: promotorObj?.nome || pi.promotorMatricula,
          promotorMatricula: pi.promotorMatricula,
          titulo: 'Rota Planejada Sem Atendimento',
          descricao: `Visita planejada para ${pi.dataStr} ainda não foi iniciada ou registrada em campo.`,
          origem: 'Rotas Planejadas',
          statusVisual: '🟡 Pendente',
          createdAtTimestamp: new Date(pi.dataStr + 'T00:00:00').getTime()
        });
      }
    });

    // 5. Aderência por Promotor (🔴 CRÍTICO / 🟡 PENDENTE)
    promotoresList.forEach((p) => {
      const pPlanned = totalPlannedItems.filter((pi) => pi.promotorMatricula === p.matricula);
      if (pPlanned.length > 0) {
        const pConcluidas = visits.filter(
          (v) => v.promotor_matricula === p.matricula && v.status === 'concluida' && v.completed_at != null
        ).length;
        const pTaxa = Math.round((pConcluidas / pPlanned.length) * 100);

        if (pTaxa < 50) {
          alerts.push({
            id: `alert-aderencia-critica-${p.matricula}`,
            prioridade: 'critico',
            tipo: 'aderencia',
            data: getLocalStr(now),
            loja: 'Todas as Lojas do Promotor',
            industria: 'Geral',
            promotor: p.nome || p.matricula,
            promotorMatricula: p.matricula,
            titulo: 'Baixa Aderência (< 50%)',
            descricao: `Promotor ${p.nome} apresenta apenas ${pTaxa}% de aderência (${pConcluidas} de ${pPlanned.length} rotas concluídas no período).`,
            origem: 'Telemetria de Promotores',
            statusVisual: `🔴 ${pTaxa}% Aderência`,
            createdAtTimestamp: Date.now()
          });
        } else if (pTaxa <= 80) {
          alerts.push({
            id: `alert-aderencia-pendente-${p.matricula}`,
            prioridade: 'pendente',
            tipo: 'aderencia',
            data: getLocalStr(now),
            loja: 'Todas as Lojas do Promotor',
            industria: 'Geral',
            promotor: p.nome || p.matricula,
            promotorMatricula: p.matricula,
            titulo: 'Aderência Moderada (50%–80%)',
            descricao: `Promotor ${p.nome} apresenta ${pTaxa}% de aderência (${pConcluidas} de ${pPlanned.length} rotas concluídas no período).`,
            origem: 'Telemetria de Promotores',
            statusVisual: `🟡 ${pTaxa}% Aderência`,
            createdAtTimestamp: Date.now()
          });
        }
      }
    });

    const priorityWeight: Record<string, number> = {
      critico: 1,
      atencao: 2,
      pendente: 3,
      resolvido: 4
    };

    return alerts.sort((a, b) => {
      const wA = priorityWeight[a.prioridade] || 5;
      const wB = priorityWeight[b.prioridade] || 5;
      if (wA !== wB) return wA - wB;
      return (b.createdAtTimestamp || 0) - (a.createdAtTimestamp || 0);
    });
  }, [visits, routes, promotoresList, industriasList, totalPlannedItems, visitsMapByRouteKey, periodFilter]);

  // Filtragem dos Alertas da Central
  const centralAlertsFiltrados = useMemo(() => {
    return allCentralAlerts.filter((item) => {
      const matchInd = filterIndustria === 'all' || item.industriaCodigo === filterIndustria;
      const matchProm = filterPromotor === 'all' || item.promotorMatricula === filterPromotor;
      const matchLoja = filterLoja === 'all' || item.lojaCodigo === filterLoja;

      let matchPriority = true;
      if (filterAlertPriority === 'active') {
        matchPriority = item.prioridade !== 'resolvido';
      } else if (filterAlertPriority !== 'all') {
        matchPriority = item.prioridade === filterAlertPriority;
      }

      return matchInd && matchProm && matchLoja && matchPriority;
    });
  }, [allCentralAlerts, filterIndustria, filterPromotor, filterLoja, filterAlertPriority]);

  // Contadores reais de alertas da Central
  const alertCounts = useMemo(() => {
    const criticos = allCentralAlerts.filter((a) => a.prioridade === 'critico').length;
    const atencao = allCentralAlerts.filter((a) => a.prioridade === 'atencao').length;
    const pendentes = allCentralAlerts.filter((a) => a.prioridade === 'pendente').length;
    const resolvidos = allCentralAlerts.filter((a) => a.prioridade === 'resolvido').length;
    const totalAtivos = criticos + atencao + pendentes;

    return { criticos, atencao, pendentes, resolvidos, totalAtivos, totalGeral: allCentralAlerts.length };
  }, [allCentralAlerts]);

  // 6. Agregação de Visitas por Promotor (Ordenado por Maior Pendência / Menor Aderência)
  const rankingPromotores = promotoresList.map((p) => {
    const pPlannedItems = totalPlannedItems.filter((pi) => pi.promotorMatricula === p.matricula);
    const pPlannedCount = pPlannedItems.length;
    const pVisits = visits.filter((v) => v.promotor_matricula === p.matricula);
    const pConcluidas = pVisits.filter((v) => v.status === 'concluida' && v.completed_at != null).length;
    const pEmAndamento = pVisits.filter((v) => v.status === 'em_andamento').length;
    const pNaoRealizadas = pVisits.filter((v) => v.status === 'nao_realizada').length;
    const pPendentes = Math.max(0, pPlannedCount - pConcluidas - pNaoRealizadas - pEmAndamento);
    const pTaxa = pPlannedCount > 0 ? Math.round((pConcluidas / pPlannedCount) * 100) : 0;

    return {
      matricula: p.matricula,
      nome: p.nome,
      cidade: p.cidade,
      planejadas: pPlannedCount,
      concluidas: pConcluidas,
      emAndamento: pEmAndamento,
      naoRealizadas: pNaoRealizadas,
      pendentes: pPendentes,
      taxa: pTaxa
    };
  }).filter((p) => p.planejadas > 0 || p.concluidas > 0)
    .sort((a, b) => (b.pendentes + b.naoRealizadas) - (a.pendentes + a.naoRealizadas) || a.taxa - b.taxa);

  // 7. Agregação de Visitas por Indústria
  const rankingIndustrias = industriasList.map((ind) => {
    const iPlannedItems = totalPlannedItems.filter((pi) => pi.industriaCodigo === ind.codigo);
    const iPlannedCount = iPlannedItems.length;
    const iVisits = visits.filter((v) => v.industria_codigo === ind.codigo);
    const iConcluidas = iVisits.filter((v) => v.status === 'concluida').length;

    let iOcorrencias = 0;
    iVisits.forEach((v) => {
      if (v.occurrences) iOcorrencias += v.occurrences.length;
    });

    return {
      codigo: ind.codigo,
      nome: ind.nome,
      planejadas: iPlannedCount,
      concluidas: iConcluidas,
      ocorrencias: iOcorrencias
    };
  }).sort((a, b) => b.concluidas - a.concluidas).slice(0, 8);

  // 8. Promotores Críticos (Aderência < 50% e pelo menos 1 rota planejada no período)
  const promotoresCriticos = useMemo(() => {
    return rankingPromotores.filter((p) => p.planejadas > 0 && p.taxa < 50);
  }, [rankingPromotores]);

  // 9. Lojas Críticas (Consolidação objetiva de Rupturas Abertas + Validade Vencida/Próxima + Visitas Pendentes/Não Realizadas)
  const lojasCriticas = useMemo(() => {
    const storeMap = new Map<string, {
      codigo: string;
      nome: string;
      rupturasAbertas: number;
      produtosVencidos: number;
      visitasNaoRealizadas: number;
      visitasPendentes: number;
    }>();

    todasRupturas.forEach((r) => {
      if (!r.resolvido) {
        const existing = storeMap.get(r.lojaCodigo) || {
          codigo: r.lojaCodigo,
          nome: r.lojaNome,
          rupturasAbertas: 0,
          produtosVencidos: 0,
          visitasNaoRealizadas: 0,
          visitasPendentes: 0
        };
        existing.rupturasAbertas += 1;
        storeMap.set(r.lojaCodigo, existing);
      }
    });

    todasValidades.forEach((v) => {
      if (v.categoria === 'vencidos' || v.categoria === 'ate3') {
        const existing = storeMap.get(v.lojaCodigo) || {
          codigo: v.lojaCodigo,
          nome: v.lojaNome,
          rupturasAbertas: 0,
          produtosVencidos: 0,
          visitasNaoRealizadas: 0,
          visitasPendentes: 0
        };
        existing.produtosVencidos += 1;
        storeMap.set(v.lojaCodigo, existing);
      }
    });

    lojasSemAtendimento.forEach((l) => {
      const existing = storeMap.get(l.lojaCodigo) || {
        codigo: l.lojaCodigo,
        nome: l.lojaNome,
        rupturasAbertas: 0,
        produtosVencidos: 0,
        visitasNaoRealizadas: 0,
        visitasPendentes: 0
      };
      if (l.status === 'nao_realizada') {
        existing.visitasNaoRealizadas += 1;
      } else if (l.status === 'pendente') {
        existing.visitasPendentes += 1;
      }
      storeMap.set(l.lojaCodigo, existing);
    });

    return Array.from(storeMap.values()).map((store) => {
      const totalProblemas = store.rupturasAbertas + store.produtosVencidos + store.visitasNaoRealizadas + store.visitasPendentes;
      return {
        ...store,
        totalProblemas
      };
    }).filter((s) => s.totalProblemas > 0)
      .sort((a, b) => b.totalProblemas - a.totalProblemas);
  }, [todasRupturas, todasValidades, lojasSemAtendimento]);

  // Lista única de Lojas com rupturas para o filtro
  const lojasComRuptura = Array.from(new Set(todasRupturas.map((r) => r.lojaCodigo)))
    .map((code) => {
      const r = todasRupturas.find((item) => item.lojaCodigo === code);
      return { codigo: code, nome: r?.lojaNome || code };
    });

  // Filtragem da tabela de visitas
  const filteredVisits = visits.filter((v) => {
    const term = tableSearch.toLowerCase().trim();
    const matchesSearch =
      !term ||
      (v.promotor?.nome || '').toLowerCase().includes(term) ||
      (v.loja?.nome || '').toLowerCase().includes(term) ||
      (v.industria?.nome || '').toLowerCase().includes(term) ||
      (v.loja_codigo || '').toLowerCase().includes(term);

    const matchesStatus =
      tableStatus === 'all' || v.status === tableStatus;
    const matchesInd = filterIndustria === 'all' || v.industria_codigo === filterIndustria;
    const matchesProm = filterPromotor === 'all' || v.promotor_matricula === filterPromotor;
    const matchesLoja = filterLoja === 'all' || v.loja_codigo === filterLoja;

    return matchesSearch && matchesStatus && matchesInd && matchesProm && matchesLoja;
  });

  return (
    <div className="w-full px-4 lg:px-8 py-6 max-w-[1720px] mx-auto space-y-6 font-sans">
      {/* HEADER OPERACIONAL */}
      <section className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 bg-[#171b26] border border-[#1e2433] p-5 sm:p-6 rounded-2xl shadow-xl relative overflow-hidden">
        <div className="absolute -right-16 -top-16 w-80 h-80 rounded-full bg-gradient-to-br from-purple-600/15 via-cyan-500/10 to-transparent blur-3xl pointer-events-none" />
        <div className="flex flex-col space-y-1.5 z-10">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 font-mono text-[11px] font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              TELEMETRIA OPERACIONAL REALTIME
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Painel Operacional de Trade Marketing
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 max-w-3xl">
            Indicadores gerenciais consolidados em tempo real a partir da execução do Portal do Promotor.
          </p>
        </div>

        {/* Action Bar & Filtro de Período */}
        <div className="flex flex-wrap items-center gap-3 z-10 font-mono text-xs">
          <div className="flex items-center bg-[#131722] border border-[#1e2433] rounded-xl p-1">
            <button
              onClick={() => setPeriodFilter('today')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${periodFilter === 'today' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
            >
              Hoje
            </button>
            <button
              onClick={() => setPeriodFilter('week')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${periodFilter === 'week' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
            >
              Últimos 7 dias
            </button>
            <button
              onClick={() => setPeriodFilter('month')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${periodFilter === 'month' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}`}
            >
              Este Mês
            </button>
          </div>

          <button
            onClick={fetchOperationalData}
            disabled={loading}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white font-bold px-4 py-2 rounded-xl neon-purple-glow transition-all active:scale-95 shadow-md cursor-pointer disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>
              refresh
            </span>
            <span>Atualizar</span>
          </button>

          <div className="px-3 py-2 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-400">
            Sincronizado: <strong className="text-white">{lastUpdate}</strong>
          </div>
        </div>
      </section>

      {/* BARRA DE FILTROS GLOBAIS OPERACIONAIS */}
      <section className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-4 shadow-md font-mono text-xs flex flex-wrap items-center gap-4">
        <span className="text-slate-400 font-bold uppercase text-[11px] flex items-center gap-1">
          <span className="material-symbols-outlined text-purple-400 text-[16px]">filter_alt</span>
          Filtros Operacionais:
        </span>

        <div className="flex items-center gap-2">
          <label className="text-slate-500 text-[10px] uppercase">Indústria:</label>
          <select
            value={filterIndustria}
            onChange={(e) => setFilterIndustria(e.target.value)}
            className="h-8 px-3 bg-[#131722] border border-[#1e2433] rounded-lg text-slate-200 focus:outline-none focus:border-purple-500"
          >
            <option value="all">Todas ({industriasList.length})</option>
            {industriasList.map((ind) => (
              <option key={ind.codigo} value={ind.codigo}>
                {ind.nome}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-slate-500 text-[10px] uppercase">Promotor:</label>
          <select
            value={filterPromotor}
            onChange={(e) => setFilterPromotor(e.target.value)}
            className="h-8 px-3 bg-[#131722] border border-[#1e2433] rounded-lg text-slate-200 focus:outline-none focus:border-purple-500"
          >
            <option value="all">Todos ({promotoresList.length})</option>
            {promotoresList.map((p) => (
              <option key={p.matricula} value={p.matricula}>
                {p.nome}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-slate-500 text-[10px] uppercase">Loja / PDV:</label>
          <select
            value={filterLoja}
            onChange={(e) => setFilterLoja(e.target.value)}
            className="h-8 px-3 bg-[#131722] border border-[#1e2433] rounded-lg text-slate-200 focus:outline-none focus:border-purple-500 max-w-[200px]"
          >
            <option value="all">Todas as Lojas</option>
            {lojasComRuptura.map((l) => (
              <option key={l.codigo} value={l.codigo}>
                {l.nome}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-slate-500 text-[10px] uppercase">Situação Validade:</label>
          <select
            value={filterValidadeStatus}
            onChange={(e) => setFilterValidadeStatus(e.target.value)}
            className="h-8 px-3 bg-[#131722] border border-[#1e2433] rounded-lg text-slate-200 focus:outline-none focus:border-purple-500 font-bold"
          >
            <option value="all">Todas ({todasValidades.length})</option>
            <option value="vencidos">🔴 Vencidos ({validadeCountVencidos})</option>
            <option value="ate3">🚨 Até 3 dias ({validadeCountAte3})</option>
            <option value="ate7">🟠 4–7 dias ({validadeCountAte7})</option>
            <option value="ate30">🟡 8–30 dias ({validadeCountAte30})</option>
            <option value="normal">🟢 Normal ({validadeCountNormal})</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-slate-500 text-[10px] uppercase">Status Agenda:</label>
          <select
            value={filterAgendaStatus}
            onChange={(e) => setFilterAgendaStatus(e.target.value)}
            className="h-8 px-3 bg-[#131722] border border-[#1e2433] rounded-lg text-slate-200 focus:outline-none focus:border-purple-500 font-bold"
          >
            <option value="all">Status: Todos</option>
            <option value="em_andamento">🔵 Em andamento</option>
            <option value="pendente">🟡 Pendente</option>
            <option value="nao_realizada">🔴 Não realizada</option>
            <option value="concluida">🟢 Concluída</option>
          </select>
        </div>

        {(filterIndustria !== 'all' || filterPromotor !== 'all' || filterLoja !== 'all' || filterValidadeStatus !== 'all' || filterAgendaStatus !== 'all') && (
          <button
            onClick={() => {
              setFilterIndustria('all');
              setFilterPromotor('all');
              setFilterLoja('all');
              setFilterValidadeStatus('all');
              setFilterAgendaStatus('all');
            }}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold transition-all cursor-pointer"
          >
            Limpar Filtros
          </button>
        )}
      </section>

      {/* ERRO SUPABASE */}
      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs font-mono text-rose-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-rose-400">warning</span>
            <span>{error}</span>
          </div>
          <button onClick={fetchOperationalData} className="px-3 py-1 bg-rose-600 text-white font-bold rounded text-[11px]">
            Tentar Novamente
          </button>
        </div>
      )}

      {/* CARDS DE KPIS OPERACIONAIS REAIS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 font-mono">
        <div className="p-4 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-lg">
          <span className="text-[10px] text-slate-400 block font-bold uppercase">Planejadas</span>
          <span className="text-2xl font-extrabold text-white mt-1 block">{rotasPlanejadasCount}</span>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-emerald-500/30 shadow-lg">
          <span className="text-[10px] text-emerald-400 block font-bold uppercase">Concluídas</span>
          <span className="text-2xl font-extrabold text-emerald-400 mt-1 block">{concluidasCount}</span>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-amber-500/30 shadow-lg">
          <span className="text-[10px] text-amber-400 block font-bold uppercase">Em Andamento</span>
          <span className="text-2xl font-extrabold text-amber-400 mt-1 block">{iniciadasCount}</span>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-cyan-500/30 shadow-lg">
          <span className="text-[10px] text-cyan-400 block font-bold uppercase">Pendentes</span>
          <span className="text-2xl font-extrabold text-cyan-300 mt-1 block">{pendentesCount}</span>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-rose-500/30 shadow-lg">
          <span className="text-[10px] text-rose-400 block font-bold uppercase">Não Realizadas</span>
          <span className="text-2xl font-extrabold text-rose-400 mt-1 block">{naoRealizadasCount}</span>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-purple-500/40 shadow-lg">
          <span className="text-[10px] text-purple-300 block font-bold uppercase">% Aderência</span>
          <span className="text-2xl font-extrabold text-purple-300 mt-1 block">{taxaExecucao}%</span>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-slate-700 shadow-lg">
          <span className="text-[10px] text-slate-400 block font-bold uppercase">Fotos Enviadas</span>
          <span className="text-2xl font-extrabold text-slate-200 mt-1 block">{totalFotos}</span>
        </div>
      </div>

      {/* ========================================================= */}
      {/* ETAPA 7.2 — CENTRAL DE PENDÊNCIAS OPERACIONAIS             */}
      {/* ========================================================= */}
      <section className="bg-[#171b26] border border-cyan-500/40 rounded-2xl p-6 shadow-2xl space-y-6 font-mono">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#1e2433] pb-4">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span className="material-symbols-outlined text-cyan-400 text-2xl animate-pulse">pending_actions</span>
              🔔 Central de Pendências Operacionais
            </h2>
            <p className="text-xs text-slate-400">
              Acompanhamento unificado das visitas planejadas em aberto, atrasadas e pendentes de execução em campo.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-300 font-bold bg-[#131722] border border-[#1e2433] px-3 py-1.5 rounded-xl">
              Pendentes Hoje: <strong className="text-rose-400">{pendenciasKpis.pendentesHoje}</strong>
            </span>
            <span className="text-xs text-slate-300 font-bold bg-[#131722] border border-[#1e2433] px-3 py-1.5 rounded-xl">
              Total Pendentes: <strong className="text-amber-400">{pendenciasKpis.pendentesTotal}</strong>
            </span>
          </div>
        </div>

        {/* CARDS DE KPIS DE PENDÊNCIAS */}
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-xs">
          <div
            onClick={() => setPendenciaStatusFilter('pendente')}
            className={`p-4 rounded-xl border transition-all cursor-pointer ${
              pendenciaStatusFilter === 'pendente'
                ? 'bg-rose-950/60 border-rose-500 shadow-lg scale-[1.02]'
                : 'bg-[#131722] border-rose-500/30 hover:border-rose-500/60'
            }`}
          >
            <span className="text-[10px] text-rose-400 block font-bold uppercase">🔴 Pendentes Hoje</span>
            <span className="text-2xl font-extrabold text-rose-300 mt-1 block">{pendenciasKpis.pendentesHoje}</span>
            <span className="text-[10px] text-rose-400/80 block mt-1">Requer Ação</span>
          </div>

          <div
            onClick={() => setPendenciaStatusFilter('pendente')}
            className={`p-4 rounded-xl border transition-all cursor-pointer ${
              pendenciaStatusFilter === 'pendente'
                ? 'bg-amber-950/60 border-amber-500 shadow-lg scale-[1.02]'
                : 'bg-[#131722] border-amber-500/30 hover:border-amber-500/60'
            }`}
          >
            <span className="text-[10px] text-amber-400 block font-bold uppercase">🚨 Atrasadas</span>
            <span className="text-2xl font-extrabold text-amber-300 mt-1 block">{pendenciasKpis.pendentesAtrasadas}</span>
            <span className="text-[10px] text-amber-400/80 block mt-1">Dias Anteriores</span>
          </div>

          <div
            onClick={() => setPendenciaStatusFilter('em_andamento')}
            className={`p-4 rounded-xl border transition-all cursor-pointer ${
              pendenciaStatusFilter === 'em_andamento'
                ? 'bg-blue-950/60 border-blue-500 shadow-lg scale-[1.02]'
                : 'bg-[#131722] border-blue-500/30 hover:border-blue-500/60'
            }`}
          >
            <span className="text-[10px] text-blue-400 block font-bold uppercase">🔵 Em Andamento</span>
            <span className="text-2xl font-extrabold text-blue-300 mt-1 block">{pendenciasKpis.emAndamento}</span>
            <span className="text-[10px] text-blue-400/80 block mt-1">Em Campo</span>
          </div>

          <div
            onClick={() => setPendenciaStatusFilter('nao_realizada')}
            className={`p-4 rounded-xl border transition-all cursor-pointer ${
              pendenciaStatusFilter === 'nao_realizada'
                ? 'bg-orange-950/60 border-orange-500 shadow-lg scale-[1.02]'
                : 'bg-[#131722] border-orange-500/30 hover:border-orange-500/60'
            }`}
          >
            <span className="text-[10px] text-orange-400 block font-bold uppercase">🟠 Não Realizadas</span>
            <span className="text-2xl font-extrabold text-orange-300 mt-1 block">{pendenciasKpis.naoRealizadas}</span>
            <span className="text-[10px] text-orange-400/80 block mt-1">Com Justificativa</span>
          </div>

          <div
            onClick={() => setPendenciaStatusFilter('concluida')}
            className={`p-4 rounded-xl border transition-all cursor-pointer ${
              pendenciaStatusFilter === 'concluida'
                ? 'bg-emerald-950/60 border-emerald-500 shadow-lg scale-[1.02]'
                : 'bg-[#131722] border-emerald-500/30 hover:border-emerald-500/60'
            }`}
          >
            <span className="text-[10px] text-emerald-400 block font-bold uppercase">🟢 Concluídas</span>
            <span className="text-2xl font-extrabold text-emerald-300 mt-1 block">{pendenciasKpis.concluidas}</span>
            <span className="text-[10px] text-emerald-400/80 block mt-1">Finalizadas</span>
          </div>

          <div
            onClick={() => setPendenciaStatusFilter('todas')}
            className={`p-4 rounded-xl border transition-all cursor-pointer ${
              pendenciaStatusFilter === 'todas'
                ? 'bg-cyan-950/60 border-cyan-500 shadow-lg scale-[1.02]'
                : 'bg-[#131722] border-cyan-500/30 hover:border-cyan-500/60'
            }`}
          >
            <span className="text-[10px] text-cyan-300 block font-bold uppercase">📊 Aderência</span>
            <span className="text-2xl font-extrabold text-cyan-200 mt-1 block">{pendenciasKpis.aderencia}%</span>
            <span className="text-[10px] text-cyan-400/80 block mt-1">Taxa Geral</span>
          </div>
        </div>

        {/* VISÃO POR PROMOTOR (RANKING DE PENDÊNCIAS) */}
        <div className="bg-[#131722] border border-[#1e2433] rounded-xl p-4 space-y-3">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-cyan-400 text-sm">leaderboard</span>
              Resumo por Promotor — Ranking de Pendências
            </span>
            <span className="text-[10px] text-slate-400 font-normal">
              Ordenado por promotores com mais pendências
            </span>
          </h3>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#1e2433] text-slate-400 text-[10px] uppercase font-mono">
                  <th className="py-2 px-3">Promotor</th>
                  <th className="py-2 px-3 text-center">Planejadas</th>
                  <th className="py-2 px-3 text-center">Pendentes</th>
                  <th className="py-2 px-3 text-center">Em Andamento</th>
                  <th className="py-2 px-3 text-center">Não Realizadas</th>
                  <th className="py-2 px-3 text-center">Concluídas</th>
                  <th className="py-2 px-3 text-right">Aderência</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e2433]/50 text-slate-300">
                {promotoresPendingSummary.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-slate-500">
                      Nenhum promotor encontrado com rotas no período.
                    </td>
                  </tr>
                ) : (
                  promotoresPendingSummary.map((p) => (
                    <tr
                      key={p.matricula}
                      onClick={() => setFilterPromotor(p.matricula)}
                      className="hover:bg-[#1f2433]/60 cursor-pointer transition-colors"
                    >
                      <td className="py-2.5 px-3 font-bold text-white flex items-center gap-2">
                        <span className="material-symbols-outlined text-slate-400 text-base">person</span>
                        {p.nome}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono">{p.totalPlanned}</td>
                      <td className="py-2.5 px-3 text-center font-mono font-bold">
                        <span className={p.pendentes > 0 ? 'text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/30' : 'text-slate-400'}>
                          {p.pendentes}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono text-blue-400">{p.emAndamento}</td>
                      <td className="py-2.5 px-3 text-center font-mono text-orange-400">{p.naoRealizadas}</td>
                      <td className="py-2.5 px-3 text-center font-mono text-emerald-400 font-bold">{p.concluidas}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold">
                        <span className={p.aderencia < 50 ? 'text-rose-400' : p.aderencia < 80 ? 'text-amber-400' : 'text-emerald-400'}>
                          {p.aderencia}%
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* FILTROS E LISTA DE PENDÊNCIAS */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs pt-2 border-t border-[#1e2433]">
          <div className="flex flex-wrap items-center gap-1.5 bg-[#131722] border border-[#1e2433] rounded-xl p-1">
            <button
              onClick={() => setPendenciaStatusFilter('pendente')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                pendenciaStatusFilter === 'pendente' ? 'bg-rose-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              🔴 Pendentes ({pendenciasKpis.pendentesTotal})
            </button>
            <button
              onClick={() => setPendenciaStatusFilter('em_andamento')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                pendenciaStatusFilter === 'em_andamento' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              🔵 Em Andamento ({pendenciasKpis.emAndamento})
            </button>
            <button
              onClick={() => setPendenciaStatusFilter('nao_realizada')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                pendenciaStatusFilter === 'nao_realizada' ? 'bg-orange-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              🟠 Não Realizadas ({pendenciasKpis.naoRealizadas})
            </button>
            <button
              onClick={() => setPendenciaStatusFilter('concluida')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                pendenciaStatusFilter === 'concluida' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              🟢 Concluídas ({pendenciasKpis.concluidas})
            </button>
            <button
              onClick={() => setPendenciaStatusFilter('todas')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                pendenciaStatusFilter === 'todas' ? 'bg-slate-700 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              Todas ({pendenciasKpis.totalPlanejadas})
            </button>
          </div>

          <span className="text-[11px] text-slate-400">
            Exibindo <strong>{pendenciasFiltradas.length}</strong> registro(s)
          </span>
        </div>

        {/* TABELA / CARDS DA CENTRAL DE PENDÊNCIAS */}
        {pendenciasFiltradas.length === 0 ? (
          <div className="py-10 text-center space-y-2 bg-[#131722]/50 rounded-xl border border-[#1e2433]">
            <span className="material-symbols-outlined text-emerald-400 text-3xl">check_circle</span>
            <p className="text-xs text-slate-300 font-bold">Nenhuma pendência encontrada nesta visualização.</p>
            <p className="text-[11px] text-slate-500">Todas as visitas do filtro selecionado estão em conformidade.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#1e2433]">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-[#131722] border-b border-[#1e2433] text-slate-400 text-[10px] uppercase font-mono">
                  <th className="py-3 px-4">Data Prevista</th>
                  <th className="py-3 px-4">Promotor</th>
                  <th className="py-3 px-4">Loja / PDV</th>
                  <th className="py-3 px-4">Indústria</th>
                  <th className="py-3 px-4">Frequência</th>
                  <th className="py-3 px-4">Situação</th>
                  <th className="py-3 px-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e2433] text-slate-300 font-mono">
                {pendenciasFiltradas.map((item) => {
                  let badge = { label: '🔴 PENDENTE', style: 'bg-rose-500/10 text-rose-400 border-rose-500/30' };
                  if (item.isPastOverdue) {
                    badge = { label: '🚨 ATRASADA', style: 'bg-rose-950 text-rose-400 border-rose-500 font-bold animate-pulse' };
                  } else if (item.status === 'em_andamento') {
                    badge = { label: '🔵 EM ANDAMENTO', style: 'bg-blue-500/10 text-blue-400 border-blue-500/30' };
                  } else if (item.status === 'nao_realizada') {
                    badge = { label: '🟠 NÃO REALIZADA', style: 'bg-orange-500/10 text-orange-400 border-orange-500/30' };
                  } else if (item.status === 'concluida') {
                    badge = { label: '🟢 CONCLUÍDA', style: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' };
                  } else if (item.status === 'planejada') {
                    badge = { label: '⚪ PLANEJADA', style: 'bg-slate-700/50 text-slate-300 border-slate-600' };
                  }

                  return (
                    <tr key={item.key} className="hover:bg-[#131722]/80 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-bold text-white">{item.dataStr}</div>
                        <div className="text-[10px] text-slate-400">{item.dayOfWeekLabel}</div>
                      </td>
                      <td className="py-3 px-4 font-bold text-cyan-400">{item.promotorNome}</td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-white">{item.lojaNome}</div>
                        {item.lojaCidade && (
                          <div className="text-[10px] text-slate-400">{item.lojaCidade} - {item.lojaUf}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-purple-300 font-bold">{item.industriaNome}</td>
                      <td className="py-3 px-4 text-slate-400">{item.frequencia}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] border ${badge.style}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => setSelectedPendingItem(item)}
                          className="px-3 py-1.5 rounded-lg bg-[#131722] hover:bg-[#1f2433] text-cyan-400 border border-cyan-500/30 font-bold text-[11px] transition-all cursor-pointer"
                        >
                          Ver Detalhes
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* MODAL DETALHES DA PENDÊNCIA OPERACIONAL */}
      {selectedPendingItem && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#171b26] border border-[#1e2433] rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5 font-mono">
            <div className="flex items-center justify-between border-b border-[#1e2433] pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-cyan-400">pending_actions</span>
                VISITA PENDENTE — DETALHES
              </h3>
              <button onClick={() => setSelectedPendingItem(null)} className="text-slate-400 hover:text-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-slate-500 block">PROMOTOR:</span>
                <span className="text-cyan-400 font-bold text-sm">{selectedPendingItem.promotorNome}</span>
                <span className="text-[10px] text-slate-500 block">Matrícula: {selectedPendingItem.promotorMatricula}</span>
              </div>
              <div>
                <span className="text-slate-500 block">LOJA / PDV:</span>
                <span className="text-white font-bold">{selectedPendingItem.lojaNome}</span>
                {selectedPendingItem.lojaCidade && (
                  <span className="text-[10px] text-slate-400 block">{selectedPendingItem.lojaCidade} - {selectedPendingItem.lojaUf}</span>
                )}
              </div>
              <div>
                <span className="text-slate-500 block">INDÚSTRIA:</span>
                <span className="text-purple-300 font-bold">{selectedPendingItem.industriaNome}</span>
              </div>
              <div>
                <span className="text-slate-500 block">DATA PREVISTA / DIA:</span>
                <span className="text-white font-bold">{selectedPendingItem.dataStr} ({selectedPendingItem.dayOfWeekLabel})</span>
              </div>
              <div>
                <span className="text-slate-500 block">FREQUÊNCIA:</span>
                <span className="text-slate-300">{selectedPendingItem.frequencia}</span>
              </div>
              <div>
                <span className="text-slate-500 block">SITUAÇÃO ATUAL:</span>
                <span className={`font-bold uppercase ${
                  selectedPendingItem.status === 'concluida' ? 'text-emerald-400' :
                  selectedPendingItem.status === 'em_andamento' ? 'text-blue-400' :
                  selectedPendingItem.status === 'nao_realizada' ? 'text-orange-400' : 'text-rose-400'
                }`}>
                  {selectedPendingItem.isPastOverdue ? '🚨 Pendente (Atrasada)' : selectedPendingItem.status}
                </span>
              </div>
              {selectedPendingItem.motivoNaoRealizada && (
                <div>
                  <span className="text-slate-500 block">MOTIVO NÃO REALIZADA:</span>
                  <span className="text-orange-300">{selectedPendingItem.motivoNaoRealizada}</span>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-[#1e2433] flex justify-end gap-2">
              <button
                onClick={() => setSelectedPendingItem(null)}
                className="px-4 py-2 rounded-xl bg-[#131722] hover:bg-[#1f2433] text-slate-300 border border-[#1e2433] text-xs font-semibold"
              >
                Fechar
              </button>
              <button
                onClick={() => {
                  setSelectedPendingItem(null);
                  setFilterPromotor(selectedPendingItem.promotorMatricula);
                  setFilterLoja(selectedPendingItem.lojaCodigo);
                }}
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-sm">visibility</span>
                Ver rota / Ver atendimento
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* ETAPA 5 — CENTRAL DE ALERTAS OPERACIONAIS                 */}
      {/* ========================================================= */}
      <section className="bg-[#171b26] border border-purple-500/40 rounded-2xl p-6 shadow-2xl space-y-6 font-mono">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#1e2433] pb-4">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span className="material-symbols-outlined text-purple-400 text-2xl animate-pulse">notifications_active</span>
              🚨 Central de Alertas Operacionais
            </h2>
            <p className="text-xs text-slate-400">
              Consolidação em tempo real de situações que exigem ação preventiva ou corretiva do gestor.
            </p>
          </div>

          <span className="text-xs text-slate-400 font-bold bg-[#131722] border border-[#1e2433] px-3 py-1.5 rounded-xl">
            Alertas Ativos: <strong className="text-purple-300">{alertCounts.totalAtivos}</strong>
          </span>
        </div>

        {/* CARDS DE RESUMO DA CENTRAL */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div
            onClick={() => setFilterAlertPriority(filterAlertPriority === 'critico' ? 'active' : 'critico')}
            className={`p-4 rounded-xl border transition-all cursor-pointer ${
              filterAlertPriority === 'critico'
                ? 'bg-rose-950/60 border-rose-500 shadow-lg scale-[1.02]'
                : 'bg-[#131722] border-rose-500/30 hover:border-rose-500/60'
            }`}
          >
            <span className="text-[10px] text-rose-400 block font-bold uppercase">🔴 Críticos</span>
            <span className="text-2xl font-extrabold text-rose-300 mt-1 block">{alertCounts.criticos}</span>
            <span className="text-[10px] text-rose-400/80 block mt-1">Ação Imediata</span>
          </div>

          <div
            onClick={() => setFilterAlertPriority(filterAlertPriority === 'atencao' ? 'active' : 'atencao')}
            className={`p-4 rounded-xl border transition-all cursor-pointer ${
              filterAlertPriority === 'atencao'
                ? 'bg-amber-950/60 border-amber-500 shadow-lg scale-[1.02]'
                : 'bg-[#131722] border-amber-500/30 hover:border-amber-500/60'
            }`}
          >
            <span className="text-[10px] text-amber-400 block font-bold uppercase">🟠 Atenção</span>
            <span className="text-2xl font-extrabold text-amber-300 mt-1 block">{alertCounts.atencao}</span>
            <span className="text-[10px] text-amber-400/80 block mt-1">Acompanhamento</span>
          </div>

          <div
            onClick={() => setFilterAlertPriority(filterAlertPriority === 'pendente' ? 'active' : 'pendente')}
            className={`p-4 rounded-xl border transition-all cursor-pointer ${
              filterAlertPriority === 'pendente'
                ? 'bg-yellow-950/60 border-yellow-500 shadow-lg scale-[1.02]'
                : 'bg-[#131722] border-yellow-500/30 hover:border-yellow-500/60'
            }`}
          >
            <span className="text-[10px] text-yellow-400 block font-bold uppercase">🟡 Pendentes</span>
            <span className="text-2xl font-extrabold text-yellow-300 mt-1 block">{alertCounts.pendentes}</span>
            <span className="text-[10px] text-yellow-400/80 block mt-1">Execução Pendente</span>
          </div>

          <div
            onClick={() => setFilterAlertPriority(filterAlertPriority === 'active' ? 'all' : 'active')}
            className={`p-4 rounded-xl border transition-all cursor-pointer ${
              filterAlertPriority === 'active'
                ? 'bg-purple-950/60 border-purple-500 shadow-lg scale-[1.02]'
                : 'bg-[#131722] border-purple-500/30 hover:border-purple-500/60'
            }`}
          >
            <span className="text-[10px] text-purple-300 block font-bold uppercase">Total Ativos</span>
            <span className="text-2xl font-extrabold text-purple-200 mt-1 block">{alertCounts.totalAtivos}</span>
            <span className="text-[10px] text-purple-400/80 block mt-1">Exige Ação</span>
          </div>
        </div>

        {/* FILTROS ESPECÍFICOS DA CENTRAL */}
        <div className="flex items-center justify-between flex-wrap gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2 bg-[#131722] border border-[#1e2433] rounded-xl p-1">
            <button
              onClick={() => setFilterAlertPriority('active')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                filterAlertPriority === 'active' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              Ativos ({alertCounts.totalAtivos})
            </button>
            <button
              onClick={() => setFilterAlertPriority('critico')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                filterAlertPriority === 'critico' ? 'bg-rose-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              🔴 Críticos ({alertCounts.criticos})
            </button>
            <button
              onClick={() => setFilterAlertPriority('atencao')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                filterAlertPriority === 'atencao' ? 'bg-amber-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              🟠 Atenção ({alertCounts.atencao})
            </button>
            <button
              onClick={() => setFilterAlertPriority('pendente')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                filterAlertPriority === 'pendente' ? 'bg-yellow-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              🟡 Pendentes ({alertCounts.pendentes})
            </button>
            <button
              onClick={() => setFilterAlertPriority('resolvido')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                filterAlertPriority === 'resolvido' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              🟢 Resolvidos ({alertCounts.resolvidos})
            </button>
            <button
              onClick={() => setFilterAlertPriority('all')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                filterAlertPriority === 'all' ? 'bg-slate-700 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              Todos ({alertCounts.totalGeral})
            </button>
          </div>

          <span className="text-[11px] text-slate-400">
            Exibindo <strong>{centralAlertsFiltrados.length}</strong> alerta(s)
          </span>
        </div>

        {/* LISTA DE ALERTAS (MOBILE CARDS / DESKTOP TABLE) */}
        {centralAlertsFiltrados.length === 0 ? (
          <div className="py-12 text-center space-y-2 bg-[#131722]/50 rounded-xl border border-[#1e2433]">
            <span className="material-symbols-outlined text-emerald-400 text-3xl">verified_user</span>
            <p className="text-xs text-slate-300 font-bold">Nenhum alerta operacional encontrado nesta visualização.</p>
            <p className="text-[11px] text-slate-500 max-w-md mx-auto">
              Operação em conformidade ou nenhuma ocorrência correspondente aos filtros selecionados.
            </p>
          </div>
        ) : (
          <>
            {/* CARDS MOBILE (sm:hidden) */}
            <div className="grid grid-cols-1 gap-3 sm:hidden">
              {centralAlertsFiltrados.map((item) => {
                let prioBadge = { label: '🔴 CRÍTICO', color: 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse' };
                if (item.prioridade === 'atencao') {
                  prioBadge = { label: '🟠 ATENÇÃO', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
                } else if (item.prioridade === 'pendente') {
                  prioBadge = { label: '🟡 PENDENTE', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' };
                } else if (item.prioridade === 'resolvido') {
                  prioBadge = { label: '🟢 RESOLVIDO', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
                }

                return (
                  <div
                    key={item.id}
                    className="p-4 rounded-xl bg-[#131722] border border-[#1e2433] space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${prioBadge.color}`}>
                        {prioBadge.label}
                      </span>
                      <span className="text-[10px] text-slate-400 font-bold uppercase px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
                        {item.tipo}
                      </span>
                    </div>

                    <div>
                      <div className="font-extrabold text-white text-sm flex items-center gap-1.5">
                        {item.titulo}
                      </div>
                      <p className="text-xs text-slate-300 mt-1 leading-relaxed">{item.descricao}</p>
                    </div>

                    <div className="text-[11px] text-slate-400 space-y-1 font-mono pt-2 border-t border-[#1e2433]">
                      <div><strong>Loja:</strong> <span className="text-white">{item.loja}</span></div>
                      <div><strong>Indústria:</strong> <span className="text-purple-300 font-bold">{item.industria}</span></div>
                      <div><strong>Promotor:</strong> <span className="text-slate-300">{item.promotor}</span></div>
                      <div><strong>Data:</strong> <span className="text-slate-300">{new Date(item.data + 'T00:00:00').toLocaleDateString('pt-BR')}</span></div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-[#1e2433]">
                      <span className="text-[10px] text-slate-500 italic">Origem: {item.origem}</span>

                      <div className="flex items-center gap-2">
                        {item.occurrenceId && item.prioridade !== 'resolvido' && (
                          canResolve ? (
                            <button
                              onClick={() => handleResolveRupture(item.occurrenceId!)}
                              disabled={resolvingId === item.occurrenceId}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] cursor-pointer"
                            >
                              Resolver
                            </button>
                          ) : null
                        )}

                        {item.visitObj && (
                          <button
                            onClick={() => setSelectedVisit(item.visitObj!)}
                            className="px-3 py-1.5 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-300 border border-cyan-500/40 font-bold text-[11px] cursor-pointer"
                          >
                            Ver visita
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* TABELA DESKTOP & TABLET (hidden sm:block) */}
            <div className="hidden sm:block overflow-x-auto rounded-xl border border-[#1e2433]">
              <table className="w-full text-left text-xs border-collapse align-middle">
                <colgroup>
                  <col className="w-[110px]" />
                  <col className="w-[90px]" />
                  <col className="w-[95px]" />
                  <col className="w-[170px]" />
                  <col className="w-[170px]" />
                  <col className="w-[130px]" />
                  <col className="min-w-[280px]" />
                  <col className="w-[110px]" />
                  <col className="w-[125px]" />
                </colgroup>
                <thead>
                  <tr className="bg-[#131722] border-b border-[#1e2433] text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="py-3 px-3 text-center">Prioridade</th>
                    <th className="py-3 px-3">Tipo</th>
                    <th className="py-3 px-3">Data</th>
                    <th className="py-3 px-3">Promotor</th>
                    <th className="py-3 px-3">Loja</th>
                    <th className="py-3 px-3">Indústria</th>
                    <th className="py-3 px-4">Alerta / Descrição</th>
                    <th className="py-3 px-3 text-center">Situação</th>
                    <th className="py-3 px-3 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e2433] text-slate-300">
                  {centralAlertsFiltrados.map((item) => {
                    let prioBadge = { label: '🔴 CRÍTICO', color: 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse' };
                    if (item.prioridade === 'atencao') {
                      prioBadge = { label: '🟠 ATENÇÃO', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
                    } else if (item.prioridade === 'pendente') {
                      prioBadge = { label: '🟡 PENDENTE', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' };
                    } else if (item.prioridade === 'resolvido') {
                      prioBadge = { label: '🟢 RESOLVIDO', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
                    }

                    return (
                      <tr key={item.id} className="hover:bg-[#131722]/70 transition-colors">
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border uppercase ${prioBadge.color}`}>
                            {prioBadge.label}
                          </span>
                        </td>

                        <td className="py-3 px-3 font-bold text-slate-300 uppercase text-[11px] whitespace-nowrap">
                          {item.tipo}
                        </td>

                        <td className="py-3 px-3 text-slate-400 font-bold whitespace-nowrap">
                          {new Date(item.data + 'T00:00:00').toLocaleDateString('pt-BR')}
                        </td>

                        <td className="py-3 px-3">
                          <div className="font-bold text-white text-[12px] leading-snug whitespace-normal break-words">{item.promotor}</div>
                        </td>

                        <td className="py-3 px-3">
                          <div className="font-bold text-white text-[12px] leading-snug whitespace-normal break-words" title={item.loja}>{item.loja}</div>
                        </td>

                        <td className="py-3 px-3">
                          <div className="font-bold text-purple-300 text-[12px] leading-snug whitespace-normal break-words">{item.industria}</div>
                        </td>

                        <td className="py-3 px-4">
                          <div className="font-extrabold text-white text-[12px] leading-snug">{item.titulo}</div>
                          <div className="text-[11px] text-slate-400 leading-relaxed mt-1 line-clamp-2" title={item.descricao}>{item.descricao}</div>
                        </td>

                        <td className="py-3 px-3 text-center font-bold text-[11px] whitespace-nowrap">
                          {item.statusVisual}
                        </td>

                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            {item.occurrenceId && item.prioridade !== 'resolvido' && (
                              canResolve ? (
                                <button
                                  onClick={() => handleResolveRupture(item.occurrenceId!)}
                                  disabled={resolvingId === item.occurrenceId}
                                  className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] cursor-pointer shadow transition-all active:scale-95 disabled:opacity-50"
                                >
                                  Resolver
                                </button>
                              ) : null
                            )}

                            {item.visitObj ? (
                              <button
                                onClick={() => setSelectedVisit(item.visitObj!)}
                                className="px-2.5 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 font-bold text-[10px] border border-cyan-500/40 cursor-pointer transition-all active:scale-95"
                              >
                                Ver visita
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-500 italic">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* ========================================================= */}
      {/* ETAPA 4.5 — AGENDA OPERACIONAL DO DIA                     */}
      {/* ========================================================= */}
      <section className="bg-[#171b26] border border-cyan-500/40 rounded-2xl p-6 shadow-2xl space-y-6 font-mono">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#1e2433] pb-4">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span className="material-symbols-outlined text-cyan-400 text-2xl">calendar_today</span>
              📅 Visitas de Hoje
            </h2>
            <p className="text-xs text-slate-400">
              Agenda operacional de atendimento planejada para hoje ({new Date().toLocaleDateString('pt-BR')}) com status e tempo real de execução.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="px-3 py-1 rounded-lg bg-[#131722] border border-[#1e2433] text-slate-300 font-bold">
              Total Planejado: <strong className="text-white">{plannedItemsToday.length}</strong>
            </span>
          </div>
        </div>

        {/* AGENDA DESKTOP & TABLET / CARDS MOBILE */}
        {agendaFiltrada.length === 0 ? (
          <div className="py-12 text-center space-y-2 bg-[#131722]/50 rounded-xl border border-[#1e2433]">
            <span className="material-symbols-outlined text-cyan-400 text-3xl">event_busy</span>
            <p className="text-xs text-slate-300 font-bold">Nenhuma visita de hoje encontrada nesta visualização.</p>
            <p className="text-[11px] text-slate-500 max-w-md mx-auto">
              Não foram encontradas rotas planejadas ou visitas correspondentes aos filtros selecionados.
            </p>
          </div>
        ) : (
          <>
            {/* CARDS RESPONSIVOS PARA MOBILE (sm:hidden) */}
            <div className="grid grid-cols-1 gap-3 sm:hidden">
              {agendaFiltrada.map((item) => {
                let badge = { label: '🟡 Pendente', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
                if (item.status === 'em_andamento') {
                  badge = { label: '🔵 Em andamento', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 animate-pulse' };
                } else if (item.status === 'nao_realizada') {
                  badge = { label: '🔴 Não realizada', color: 'bg-rose-500/20 text-rose-300 border-rose-500/40' };
                } else if (item.status === 'concluida') {
                  badge = { label: '🟢 Concluída', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
                }

                return (
                  <div
                    key={item.key}
                    onClick={() => item.visitObj && setSelectedVisit(item.visitObj)}
                    className={`p-4 rounded-xl bg-[#131722] border border-[#1e2433] space-y-2.5 ${
                      item.visitObj ? 'cursor-pointer hover:border-cyan-500/50' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold border ${badge.color}`}>
                        {badge.label}
                      </span>
                      <span className="text-[10px] text-slate-500">{item.dataStr}</span>
                    </div>

                    <div>
                      <div className="font-bold text-white text-sm">{item.lojaNome}</div>
                      <div className="text-[11px] text-purple-300 font-bold">Ind: {item.industriaNome}</div>
                      <div className="text-[11px] text-slate-400">Promotor: {item.promotorNome}</div>
                    </div>

                    <div className="pt-2 border-t border-[#1e2433]/60 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                      <div>Início: <strong className="text-white">{item.startedAt ? new Date(item.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}</strong></div>
                      <div>Fim: <strong className="text-white">{item.completedAt ? new Date(item.completedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}</strong></div>
                      {item.duracaoFormatada && (
                        <div className="text-emerald-400 font-bold">Dur: {item.duracaoFormatada}</div>
                      )}
                    </div>

                    {item.motivoNaoRealizada && (
                      <div className="p-2 rounded bg-rose-500/10 border border-rose-500/30 text-[10px] text-rose-300">
                        <strong>Motivo:</strong> {item.motivoNaoRealizada}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* TABELA ESTRUTURADA PARA TABLET & DESKTOP (hidden sm:block) */}
            <div className="hidden sm:block overflow-x-auto rounded-xl border border-[#1e2433]">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#131722] border-b border-[#1e2433] text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="py-3.5 px-4 text-center">Status</th>
                    <th className="py-3.5 px-4">Promotor</th>
                    <th className="py-3.5 px-4">Loja / PDV</th>
                    <th className="py-3.5 px-4">Indústria</th>
                    <th className="py-3.5 px-4">Data</th>
                    <th className="py-3.5 px-4">Início</th>
                    <th className="py-3.5 px-4">Conclusão</th>
                    <th className="py-3.5 px-4 text-center">Duração</th>
                    <th className="py-3.5 px-4 text-right">Detalhe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e2433] text-slate-300">
                  {agendaFiltrada.map((item) => {
                    let badge = { label: '🟡 Pendente', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
                    if (item.status === 'em_andamento') {
                      badge = { label: '🔵 Em andamento', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 animate-pulse' };
                    } else if (item.status === 'nao_realizada') {
                      badge = { label: '🔴 Não realizada', color: 'bg-rose-500/20 text-rose-300 border-rose-500/40' };
                    } else if (item.status === 'concluida') {
                      badge = { label: '🟢 Concluída', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
                    }

                    return (
                      <tr key={item.key} className="hover:bg-[#131722]/70 transition-colors">
                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border uppercase ${badge.color}`}>
                            {badge.label}
                          </span>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="font-bold text-white">{item.promotorNome}</div>
                          <div className="text-[10px] text-slate-500 font-normal">Mat: {item.promotorMatricula}</div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="font-bold text-white">{item.lojaNome}</div>
                          <div className="text-[10px] text-slate-500 font-normal">Cód: {item.lojaCodigo}</div>
                        </td>

                        <td className="py-3.5 px-4 font-bold text-purple-300">
                          {item.industriaNome}
                        </td>

                        <td className="py-3.5 px-4 text-slate-400 font-bold whitespace-nowrap">
                          {new Date(item.dataStr + 'T00:00:00').toLocaleDateString('pt-BR')}
                        </td>

                        <td className="py-3.5 px-4 text-slate-300 font-mono whitespace-nowrap">
                          {item.startedAt ? new Date(item.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                        </td>

                        <td className="py-3.5 px-4 text-slate-300 font-mono whitespace-nowrap">
                          {item.completedAt ? new Date(item.completedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                        </td>

                        <td className="py-3.5 px-4 text-center font-mono font-bold text-emerald-400 whitespace-nowrap">
                          {item.duracaoFormatada || '—'}
                        </td>

                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          {item.visitObj ? (
                            <button
                              onClick={() => setSelectedVisit(item.visitObj!)}
                              className="p-1.5 rounded-lg bg-[#131722] hover:bg-[#1f2433] text-cyan-300 border border-[#1e2433] cursor-pointer"
                              title="Ver Detalhes da Visita"
                            >
                              <span className="material-symbols-outlined text-[16px]">visibility</span>
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-500 italic">Pendente</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* ========================================================= */}
      {/* ETAPA 3 — PAINEL OPERACIONAL DE RUPTURAS                  */}
      {/* ========================================================= */}
      <section className="bg-[#171b26] border border-rose-500/40 rounded-2xl p-6 shadow-2xl space-y-6 font-mono">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#1e2433] pb-4">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span className="material-symbols-outlined text-rose-500 text-2xl animate-pulse">report_problem</span>
              🚨 Rupturas Operacionais
            </h2>
            <p className="text-xs text-slate-400">
              Ocorrências de falta de produto na gôndola registradas pelos promotores em tempo real.
            </p>
          </div>

          {/* METRICAS DE RUPTURA CONSOLIDADA */}
          <div className="flex items-center gap-3 text-xs">
            <div className="px-3.5 py-2 rounded-xl bg-[#131722] border border-[#1e2433] text-center">
              <span className="text-[10px] text-slate-400 block font-bold uppercase">Total</span>
              <span className="text-base font-extrabold text-white">{totalRupturasCount} Rupturas</span>
            </div>

            <div className="px-3.5 py-2 rounded-xl bg-rose-950/40 border border-rose-500/40 text-center">
              <span className="text-[10px] text-rose-400 block font-bold uppercase">Abertas</span>
              <span className="text-base font-extrabold text-rose-300">{rupturasAbertasCount} 🔴 Abertas</span>
            </div>

            <div className="px-3.5 py-2 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-center">
              <span className="text-[10px] text-emerald-400 block font-bold uppercase">Resolvidas</span>
              <span className="text-base font-extrabold text-emerald-300">{rupturasResolvidasCount} 🟢 Resolvidas</span>
            </div>
          </div>
        </div>

        {/* FILTRO DE STATUS DA TABELA DE RUPTURAS */}
        <div className="flex items-center justify-between flex-wrap gap-3 text-xs">
          <div className="flex items-center gap-2 bg-[#131722] border border-[#1e2433] rounded-xl p-1">
            <button
              onClick={() => setFilterRupturaStatus('abertas')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                filterRupturaStatus === 'abertas' ? 'bg-rose-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              🔴 Abertas ({rupturasAbertasCount})
            </button>
            <button
              onClick={() => setFilterRupturaStatus('resolvidas')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                filterRupturaStatus === 'resolvidas' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              🟢 Resolvidas ({rupturasResolvidasCount})
            </button>
            <button
              onClick={() => setFilterRupturaStatus('all')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                filterRupturaStatus === 'all' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              Todas ({totalRupturasCount})
            </button>
          </div>

          <span className="text-[11px] text-slate-400">
            Exibindo <strong>{rupturasFiltradas.length}</strong> ocorrência(s)
          </span>
        </div>

        {/* TABELA DE RUPTURAS */}
        {rupturasFiltradas.length === 0 ? (
          <div className="py-12 text-center space-y-2 bg-[#131722]/50 rounded-xl border border-[#1e2433]">
            <span className="material-symbols-outlined text-emerald-400 text-3xl">check_circle</span>
            <p className="text-xs text-slate-300 font-bold">Nenhuma ruptura encontrada nesta visualização.</p>
            <p className="text-[11px] text-slate-500 max-w-md mx-auto">
              Todas as ocorrências registradas estao tratadas ou não correspondem aos filtros selecionados.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#1e2433]">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#131722] border-b border-[#1e2433] text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Data</th>
                  <th className="py-3 px-4">Loja</th>
                  <th className="py-3 px-4">Indústria</th>
                  <th className="py-3 px-4">Promotor</th>
                  <th className="py-3 px-4">Descrição</th>
                  <th className="py-3 px-4 text-center">Foto</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e2433] text-slate-300">
                {rupturasFiltradas.map((r) => (
                  <tr key={r.id} className="hover:bg-[#131722]/70 transition-colors">
                    <td className="py-3 px-4 text-slate-400 font-bold whitespace-nowrap">
                      {new Date(r.createdAt || r.dataVisita).toLocaleDateString('pt-BR')}
                      <span className="text-[10px] text-slate-500 block font-normal">
                        {r.createdAt ? new Date(r.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                    </td>

                    <td className="py-3 px-4 font-bold text-white">
                      {r.lojaNome}
                      <span className="text-[10px] text-slate-500 block font-normal">Cód: {r.lojaCodigo}</span>
                    </td>

                    <td className="py-3 px-4 font-bold text-purple-300">
                      {r.industriaNome}
                    </td>

                    <td className="py-3 px-4 text-slate-300">
                      {r.promotorNome}
                      <span className="text-[10px] text-slate-500 block font-normal">Mat: {r.promotorMatricula}</span>
                    </td>

                    <td className="py-3 px-4 text-slate-200 max-w-xs leading-relaxed">
                      {r.descricao}
                    </td>

                    <td className="py-3 px-4 text-center whitespace-nowrap">
                      {r.photoSignedUrl ? (
                        <a
                          href={r.photoSignedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 font-bold text-[10px] border border-cyan-500/40 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[14px]">photo_camera</span>
                          Ver Foto
                        </a>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-500 text-[10px]">
                          Sem foto
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-center whitespace-nowrap">
                      {r.resolvido ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-[10px] border border-emerald-500/40">
                          🟢 Resolvida
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-300 font-bold text-[10px] border border-rose-500/40 animate-pulse">
                          🔴 Aberta
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {!r.resolvido ? (
                        canResolve ? (
                          <button
                            onClick={() => handleResolveRupture(r.id)}
                            disabled={resolvingId === r.id}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] shadow transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                          >
                            {resolvingId === r.id ? 'Salvando...' : 'Marcar como resolvida'}
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-500 italic" title="Apenas ADM/GESTOR podem marcar como resolvida">
                            Apenas Gestor
                          </span>
                        )
                      ) : (
                        <span className="text-[10px] text-emerald-400/80 font-mono">✓ Concluído</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ========================================================= */}
      {/* ETAPA 4 — CONTROLE DE VALIDADE E VENCIMENTO DE PRODUTOS   */}
      {/* ========================================================= */}
      <section className="bg-[#171b26] border border-amber-500/40 rounded-2xl p-6 shadow-2xl space-y-6 font-mono">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#1e2433] pb-4">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-500 text-2xl">inventory_2</span>
              ⏰ Validade / Vencimentos
            </h2>
            <p className="text-xs text-slate-400">
              Produtos cadastrados pelos promotores agrupados por urgência e proximidade da data de vencimento.
            </p>
          </div>

          <div className="text-xs text-slate-400">
            Total Monitorado: <strong className="text-white font-bold">{todasValidades.length} produto(s)</strong>
          </div>
        </div>

        {/* CARDS DE MONITORAMENTO DE VALIDADE */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div
            onClick={() => setFilterValidadeStatus(filterValidadeStatus === 'vencidos' ? 'all' : 'vencidos')}
            className={`p-4 rounded-xl border transition-all cursor-pointer ${
              filterValidadeStatus === 'vencidos'
                ? 'bg-rose-950/60 border-rose-500 shadow-lg scale-[1.02]'
                : 'bg-[#131722] border-rose-500/30 hover:border-rose-500/60'
            }`}
          >
            <span className="text-[10px] text-rose-400 block font-bold uppercase">🔴 Vencidos</span>
            <span className="text-2xl font-extrabold text-rose-300 mt-1 block">{validadeCountVencidos}</span>
            <span className="text-[10px] text-rose-400/80 block mt-1">Ação imediata necessária</span>
          </div>

          <div
            onClick={() => setFilterValidadeStatus(filterValidadeStatus === 'ate3' ? 'all' : 'ate3')}
            className={`p-4 rounded-xl border transition-all cursor-pointer ${
              filterValidadeStatus === 'ate3'
                ? 'bg-rose-950/40 border-rose-400 shadow-lg scale-[1.02]'
                : 'bg-[#131722] border-rose-400/30 hover:border-rose-400/60'
            }`}
          >
            <span className="text-[10px] text-rose-300 block font-bold uppercase">🚨 Vence em até 3 dias</span>
            <span className="text-2xl font-extrabold text-rose-200 mt-1 block">{validadeCountAte3}</span>
            <span className="text-[10px] text-rose-300/80 block mt-1">Urgência crítica</span>
          </div>

          <div
            onClick={() => setFilterValidadeStatus(filterValidadeStatus === 'ate7' ? 'all' : 'ate7')}
            className={`p-4 rounded-xl border transition-all cursor-pointer ${
              filterValidadeStatus === 'ate7'
                ? 'bg-amber-950/40 border-amber-500 shadow-lg scale-[1.02]'
                : 'bg-[#131722] border-amber-500/30 hover:border-amber-500/60'
            }`}
          >
            <span className="text-[10px] text-amber-400 block font-bold uppercase">🟠 Vence em 4–7 dias</span>
            <span className="text-2xl font-extrabold text-amber-300 mt-1 block">{validadeCountAte7}</span>
            <span className="text-[10px] text-amber-400/80 block mt-1">Atenção semanal</span>
          </div>

          <div
            onClick={() => setFilterValidadeStatus(filterValidadeStatus === 'ate30' ? 'all' : 'ate30')}
            className={`p-4 rounded-xl border transition-all cursor-pointer ${
              filterValidadeStatus === 'ate30'
                ? 'bg-yellow-950/40 border-yellow-500 shadow-lg scale-[1.02]'
                : 'bg-[#131722] border-yellow-500/30 hover:border-yellow-500/60'
            }`}
          >
            <span className="text-[10px] text-yellow-400 block font-bold uppercase">🟡 Vence em 8–30 dias</span>
            <span className="text-2xl font-extrabold text-yellow-300 mt-1 block">{validadeCountAte30}</span>
            <span className="text-[10px] text-yellow-400/80 block mt-1">Planejamento preventivo</span>
          </div>
        </div>

        {/* TABELA DE VALIDADES E VENCIMENTOS */}
        {validadesFiltradas.length === 0 ? (
          <div className="py-12 text-center space-y-2 bg-[#131722]/50 rounded-xl border border-[#1e2433]">
            <span className="material-symbols-outlined text-emerald-400 text-3xl">verified</span>
            <p className="text-xs text-slate-300 font-bold">Nenhum registro de validade nesta visualização.</p>
            <p className="text-[11px] text-slate-500 max-w-md mx-auto">
              Não foram encontrados produtos com problemas de vencimento para os filtros selecionados.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#1e2433]">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#131722] border-b border-[#1e2433] text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Validade</th>
                  <th className="py-3 px-4">Produto</th>
                  <th className="py-3 px-4 text-right">Qtd.</th>
                  <th className="py-3 px-4">Loja</th>
                  <th className="py-3 px-4">Indústria</th>
                  <th className="py-3 px-4">Promotor</th>
                  <th className="py-3 px-4">Lote</th>
                  <th className="py-3 px-4 text-right">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e2433] text-slate-300">
                {validadesFiltradas.map((val) => {
                  const [vYear, vMonth, vDay] = val.dataVencimento.split('-').map(Number);
                  const vencDate = new Date(vYear, vMonth - 1, vDay);

                  let badge = { label: '🟢 Normal', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
                  if (val.categoria === 'vencidos') {
                    badge = { label: '🔴 Vencido', color: 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse' };
                  } else if (val.categoria === 'ate3') {
                    badge = { label: '🚨 Até 3 dias', color: 'bg-rose-500/20 text-rose-300 border-rose-500/40' };
                  } else if (val.categoria === 'ate7') {
                    badge = { label: '🟠 4–7 dias', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
                  } else if (val.categoria === 'ate30') {
                    badge = { label: '🟡 8–30 dias', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' };
                  }

                  return (
                    <tr key={val.id} className="hover:bg-[#131722]/70 transition-colors">
                      <td className="py-3 px-4 font-bold text-white whitespace-nowrap">
                        {new Date(vencDate).toLocaleDateString('pt-BR')}
                        <span className="text-[10px] text-slate-500 block font-normal">
                          {val.diffDays < 0 ? `${Math.abs(val.diffDays)} dia(s) atrás` : `em ${val.diffDays} dia(s)`}
                        </span>
                      </td>

                      <td className="py-3 px-4 font-bold text-white">
                        {val.produtoNome}
                        {val.observacao && <span className="text-[10px] text-slate-400 block font-normal">{val.observacao}</span>}
                      </td>

                      <td className="py-3 px-4 text-right font-bold text-amber-300">
                        {val.quantidade}
                      </td>

                      <td className="py-3 px-4 text-slate-300 font-bold">
                        {val.lojaNome}
                        <span className="text-[10px] text-slate-500 block font-normal">Cód: {val.lojaCodigo}</span>
                      </td>

                      <td className="py-3 px-4 font-bold text-purple-300">
                        {val.industriaNome}
                      </td>

                      <td className="py-3 px-4 text-slate-300">
                        {val.promotorNome}
                        <span className="text-[10px] text-slate-500 block font-normal">Mat: {val.promotorMatricula}</span>
                      </td>

                      <td className="py-3 px-4 text-slate-400 font-mono">
                        {val.lote || '—'}
                      </td>

                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <span className={`px-2.5 py-1 rounded text-[10px] font-bold border ${badge.color}`}>
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* SEÇÃO 2: CHECKLIST & DISTRIBUIÇÃO DE OCORRÊNCIAS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Desempenho de Checklist */}
        <div className="p-6 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-xl space-y-4 font-mono">
          <div className="flex items-center justify-between border-b border-[#1e2433] pb-3">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-400">fact_check</span>
              Validação de Checklist em Campo
            </h3>
            <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold border border-amber-500/30">
              {checklistPerc}% Conclusão
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433]">
              <span className="text-[10px] text-slate-400 block font-bold">TOTAL ITENS</span>
              <span className="text-xl font-extrabold text-white">{totalChecklistItems}</span>
            </div>
            <div className="p-3 rounded-xl bg-[#131722] border border-emerald-500/30">
              <span className="text-[10px] text-emerald-400 block font-bold">CONCLUÍDOS</span>
              <span className="text-xl font-extrabold text-emerald-400">{totalChecklistChecked}</span>
            </div>
            <div className="p-3 rounded-xl bg-[#131722] border border-slate-700">
              <span className="text-[10px] text-slate-400 block font-bold">PENDENTES</span>
              <span className="text-xl font-extrabold text-slate-300">{totalChecklistItems - totalChecklistChecked}</span>
            </div>
          </div>

          <div className="w-full bg-[#10141f] h-3 rounded-full overflow-hidden p-0.5 border border-[#1e2433]">
            <div
              className="bg-gradient-to-r from-amber-500 to-emerald-400 h-2 rounded-full transition-all duration-500"
              style={{ width: `${checklistPerc}%` }}
            />
          </div>
        </div>

        {/* Distribuição por Tipo de Ocorrência */}
        <div className="p-6 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-xl space-y-4 font-mono">
          <div className="flex items-center justify-between border-b border-[#1e2433] pb-3">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span className="material-symbols-outlined text-rose-400">report_problem</span>
              Incidentes &amp; Rupturas ({totalOcorrencias})
            </h3>
            <span className="text-xs text-rose-300 font-bold">Total Registrado</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="p-3 rounded-xl bg-rose-950/20 border border-rose-500/30">
              <span className="text-[10px] text-rose-400 block font-bold uppercase">Rupturas</span>
              <span className="text-xl font-extrabold text-rose-300">{ocorrenciasPorTipo.ruptura}</span>
            </div>

            <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-500/30">
              <span className="text-[10px] text-amber-400 block font-bold uppercase">Preço Div.</span>
              <span className="text-xl font-extrabold text-amber-300">{ocorrenciasPorTipo.preco_divergente}</span>
            </div>

            <div className="p-3 rounded-xl bg-cyan-950/20 border border-cyan-500/30">
              <span className="text-[10px] text-cyan-400 block font-bold uppercase">Falta Espaço</span>
              <span className="text-xl font-extrabold text-cyan-300">{ocorrenciasPorTipo.falta_espaco}</span>
            </div>

            <div className="p-3 rounded-xl bg-slate-900 border border-slate-700">
              <span className="text-[10px] text-slate-400 block font-bold uppercase">Outros</span>
              <span className="text-xl font-extrabold text-slate-300">{ocorrenciasPorTipo.outro}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* BLOCO 4 — PROBLEMAS OPERACIONAIS & LOJAS CRÍTICAS         */}
      {/* ========================================================= */}
      <section className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#1e2433] pb-3">
          <h2 className="text-lg font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
            <span className="material-symbols-outlined text-rose-500 text-2xl">grid_view</span>
            ⚠️ Problemas Operacionais &amp; Lojas Críticas
          </h2>
          <span className="text-xs font-mono text-slate-400">
            Lojas com pendências de atendimento, rupturas ou produtos em risco de vencimento
          </span>
        </div>

        {/* LOJAS CRÍTICAS */}
        <div className="p-6 rounded-2xl bg-[#171b26] border border-rose-500/30 shadow-xl space-y-4 font-mono text-xs">
          <div className="flex items-center justify-between border-b border-[#1e2433] pb-3">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span className="material-symbols-outlined text-rose-400">storefront</span>
              Lojas Críticas ({lojasCriticas.length})
            </h3>
            <span className="text-[10px] text-rose-300 font-bold">Consolidação de Riscos por PDV</span>
          </div>

          {lojasCriticas.length === 0 ? (
            <p className="text-emerald-400 font-bold italic text-center py-6">
              Nenhuma loja com problemas operacionais críticos identificados no momento!
            </p>
          ) : (
            <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-[#171b26] border-b border-[#1e2433] text-[10px] text-slate-400 uppercase">
                  <tr>
                    <th className="py-2.5 px-3">Loja / PDV</th>
                    <th className="py-2.5 px-3 text-center">Rupturas</th>
                    <th className="py-2.5 px-3 text-center">Validades em Risco</th>
                    <th className="py-2.5 px-3 text-center">Não Realizadas</th>
                    <th className="py-2.5 px-3 text-center">Pendentes</th>
                    <th className="py-2.5 px-3 text-right">Total Ocorrências</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e2433] text-slate-300">
                  {lojasCriticas.slice(0, 15).map((s) => (
                    <tr key={s.codigo} className="hover:bg-[#131722]/60 transition-colors">
                      <td className="py-2.5 px-3 font-bold text-white">
                        {s.nome}
                        <span className="text-[10px] text-slate-500 block font-normal">Cód: {s.codigo}</span>
                      </td>
                      <td className="py-2.5 px-3 text-center font-bold text-rose-400">
                        {s.rupturasAbertas > 0 ? `🔴 ${s.rupturasAbertas}` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-center font-bold text-amber-300">
                        {s.produtosVencidos > 0 ? `⏰ ${s.produtosVencidos}` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-center font-bold text-rose-300">
                        {s.visitasNaoRealizadas > 0 ? `⛔ ${s.visitasNaoRealizadas}` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-center font-bold text-yellow-400">
                        {s.visitasPendentes > 0 ? `🟡 ${s.visitasPendentes}` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-extrabold text-purple-300">
                        <span className="px-2 py-0.5 rounded bg-purple-500/20 border border-purple-500/30">
                          {s.totalProblemas} evento(s)
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ========================================================= */}
      {/* BLOCO 5 — PERFORMANCE DA OPERAÇÃO                         */}
      {/* ========================================================= */}
      <section className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#1e2433] pb-3">
          <h2 className="text-lg font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
            <span className="material-symbols-outlined text-purple-400 text-2xl">leaderboard</span>
            📊 Performance da Operação
          </h2>
          <span className="text-xs font-mono text-slate-400">
            Desempenho por equipe de promotores e marcas/indústrias
          </span>
        </div>

        {/* PROMOTORES CRÍTICOS (Aderência < 50%) */}
        {promotoresCriticos.length > 0 && (
          <div className="p-4 rounded-2xl bg-rose-950/20 border border-rose-500/30 font-mono text-xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-rose-400 font-extrabold uppercase flex items-center gap-1.5 text-xs">
                <span className="material-symbols-outlined text-rose-400 text-base">warning</span>
                Promotores Críticos (&lt; 50% Aderência) ({promotoresCriticos.length})
              </span>
              <span className="text-[10px] text-rose-300">Exige atenção gerencial</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {promotoresCriticos.slice(0, 8).map((p) => (
                <div key={p.matricula} className="p-3 rounded-xl bg-[#131722] border border-rose-500/30 space-y-1">
                  <div className="font-extrabold text-white truncate">{p.nome}</div>
                  <div className="text-[10px] text-slate-400">Mat: {p.matricula} • {p.cidade || '—'}</div>
                  <div className="flex items-center justify-between pt-1 border-t border-[#1e2433] text-[11px]">
                    <span className="text-slate-400">Rotas: <strong className="text-white">{p.concluidas}/{p.planejadas}</strong></span>
                    <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold border border-rose-500/40">
                      {p.taxa}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 font-mono text-xs">
          {/* TABELA RANKING DE PROMOTORES */}
          <div className="lg:col-span-2 p-6 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#1e2433] pb-3">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400">badge</span>
                Desempenho dos Promotores
              </h3>
              <span className="text-[10px] text-slate-400">Ordenado por pendências</span>
            </div>

            {rankingPromotores.length === 0 ? (
              <p className="text-slate-500 italic text-center py-6">Nenhum promotor com rota no período.</p>
            ) : (
              <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-[#171b26] border-b border-[#1e2433] text-[10px] text-slate-400 uppercase">
                    <tr>
                      <th className="py-2.5 px-3">Promotor</th>
                      <th className="py-2.5 px-2 text-center">Plan.</th>
                      <th className="py-2.5 px-2 text-center">Conc.</th>
                      <th className="py-2.5 px-2 text-center">Andam.</th>
                      <th className="py-2.5 px-2 text-center">N.Real.</th>
                      <th className="py-2.5 px-2 text-center">Pend.</th>
                      <th className="py-2.5 px-3 text-right">Aderência</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e2433]">
                    {rankingPromotores.map((p) => {
                      let badgeColor = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
                      if (p.taxa < 50) {
                        badgeColor = 'bg-rose-500/20 text-rose-300 border-rose-500/40';
                      } else if (p.taxa <= 80) {
                        badgeColor = 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40';
                      }

                      return (
                        <tr key={p.matricula} className="hover:bg-[#131722]/50 transition-colors">
                          <td className="py-2.5 px-3 font-bold text-white">
                            {p.nome}
                            <span className="text-[10px] text-slate-500 block font-normal">Mat: {p.matricula}</span>
                          </td>
                          <td className="py-2.5 px-2 text-center text-slate-300 font-bold">{p.planejadas}</td>
                          <td className="py-2.5 px-2 text-center font-bold text-emerald-400">{p.concluidas}</td>
                          <td className="py-2.5 px-2 text-center text-cyan-300">{p.emAndamento}</td>
                          <td className="py-2.5 px-2 text-center text-rose-400 font-bold">{p.naoRealizadas}</td>
                          <td className="py-2.5 px-2 text-center text-amber-300 font-bold">{p.pendentes}</td>
                          <td className="py-2.5 px-3 text-right font-bold">
                            <span className={`px-2 py-0.5 rounded border text-[11px] ${badgeColor}`}>
                              {p.taxa}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* TABELA COBERTURA POR INDÚSTRIA */}
          <div className="p-6 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#1e2433] pb-3">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-purple-400">factory</span>
                Cobertura por Indústria
              </h3>
              <span className="text-[10px] text-purple-300 font-bold">Top Indústrias</span>
            </div>

            {rankingIndustrias.length === 0 ? (
              <p className="text-slate-500 italic text-center py-6">Nenhuma indústria no período.</p>
            ) : (
              <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-[#171b26] border-b border-[#1e2433] text-[10px] text-slate-400 uppercase">
                    <tr>
                      <th className="py-2.5 px-2">Indústria</th>
                      <th className="py-2.5 px-2 text-center">Plan.</th>
                      <th className="py-2.5 px-2 text-center">Conc.</th>
                      <th className="py-2.5 px-2 text-right">Ocorr.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e2433]">
                    {rankingIndustrias.map((ind) => {
                      const perc = ind.planejadas > 0 ? Math.round((ind.concluidas / ind.planejadas) * 100) : 0;
                      return (
                        <tr key={ind.codigo} className="hover:bg-[#131722]/50 transition-colors">
                          <td className="py-2.5 px-2 font-bold text-purple-300">
                            {ind.nome}
                            <span className="text-[10px] text-slate-500 block font-normal">Cód: {ind.codigo}</span>
                          </td>
                          <td className="py-2.5 px-2 text-center text-slate-300 font-bold">{ind.planejadas}</td>
                          <td className="py-2.5 px-2 text-center font-bold text-emerald-400">
                            {ind.concluidas}
                            <span className="text-[9px] text-slate-500 block">({perc}%)</span>
                          </td>
                          <td className="py-2.5 px-2 text-right font-bold text-rose-400">
                            {ind.ocorrencias > 0 ? ind.ocorrencias : '0'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* SEÇÃO 4: OCORRÊNCIAS CRÍTICAS RECENTES */}
      {listaOcorrenciasCriticas.length > 0 && (
        <section className="bg-[#171b26] border border-rose-500/30 rounded-2xl p-6 shadow-2xl space-y-3 font-mono text-xs">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <span className="material-symbols-outlined text-rose-400">warning</span>
            Últimas Ocorrências Críticas Registradas em Campo ({listaOcorrenciasCriticas.length})
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {listaOcorrenciasCriticas.slice(0, 6).map((occ) => (
              <div key={occ.id} className="p-3.5 rounded-xl bg-[#131722] border border-rose-500/20 space-y-1">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold uppercase">
                    {occ.tipo.replace('_', ' ')}
                  </span>
                  {occ.dataHora && (
                    <span className="text-slate-500">
                      {new Date(occ.dataHora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
                <div className="font-bold text-white truncate">{occ.loja}</div>
                <div className="text-slate-400 text-[11px] truncate">Ind: {occ.industria} • Promotor: {occ.promotor}</div>
                <p className="text-slate-300 text-[11px] pt-1">{occ.descricao}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* FILTROS E TABELA DE VISITAS */}
      <section className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-6 shadow-2xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
            <span className="material-symbols-outlined text-purple-400">checklist</span>
            Visitas Registradas ({filteredVisits.length})
          </h3>

          <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
            <input
              type="text"
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              placeholder="Buscar por promotor, loja ou indústria..."
              className="h-9 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-purple-500 min-w-[240px]"
            />

            <select
              value={tableStatus}
              onChange={(e) => setTableStatus(e.target.value)}
              className="h-9 px-3 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-purple-500"
            >
              <option value="all">Status: Todos</option>
              <option value="em_andamento">Em Andamento</option>
              <option value="concluida">Concluída</option>
              <option value="nao_realizada">Não Realizada</option>
              <option value="pendente">Pendente</option>
            </select>
          </div>
        </div>

        {/* LOADING */}
        {loading && (
          <div className="py-16 text-center space-y-3 font-mono">
            <div className="w-10 h-10 border-4 border-purple-500/20 border-t-purple-500 rounded-full animate-spin mx-auto"></div>
            <p className="text-xs text-slate-400">Carregando telemetria de visitas do Supabase...</p>
          </div>
        )}

        {/* VAZIO */}
        {!loading && filteredVisits.length === 0 && (
          <div className="py-16 text-center space-y-3 font-mono">
            <div className="w-14 h-14 rounded-full bg-[#131722] border border-[#1e2433] flex items-center justify-center text-slate-500 mx-auto">
              <span className="material-symbols-outlined text-3xl">inbox</span>
            </div>
            <h4 className="text-sm font-bold text-white">Nenhuma Visita Encontrada</h4>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Não foram encontradas visitas de campo registradas. O promotor pode iniciar os atendimentos pelo <strong>Portal do Promotor</strong>.
            </p>
          </div>
        )}

        {/* TABELA REALS */}
        {!loading && filteredVisits.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-[#1e2433]">
            <table className="w-full text-left text-xs border-collapse font-mono">
              <thead>
                <tr className="bg-[#131722] border-b border-[#1e2433] text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3.5 px-4">Promotor</th>
                  <th className="py-3.5 px-4">Loja / PDV</th>
                  <th className="py-3.5 px-4">Indústria</th>
                  <th className="py-3.5 px-4">Início / Fim</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Checklist / Fotos</th>
                  <th className="py-3.5 px-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e2433] text-slate-300">
                {filteredVisits.map((v) => (
                  <tr key={v.id} className="hover:bg-[#131722]/60 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-white">{v.promotor?.nome || v.promotor_matricula}</div>
                      <div className="text-[10px] text-slate-500">Mat: {v.promotor_matricula}</div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-bold text-white">{v.loja?.nome || v.loja_codigo}</div>
                      <div className="text-[10px] text-slate-500">{v.loja?.cidade || '—'}</div>
                    </td>

                    <td className="py-3.5 px-4 font-bold text-purple-300">
                      {v.industria?.nome || v.industria_codigo}
                    </td>

                    <td className="py-3.5 px-4 text-slate-400 text-[11px]">
                      <div>Início: {v.started_at ? new Date(v.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}</div>
                      <div>Fim: {v.completed_at ? new Date(v.completed_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}</div>
                    </td>

                    <td className="py-3.5 px-4">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold border uppercase ${
                          v.status === 'concluida'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : v.status === 'em_andamento'
                            ? 'bg-amber-500/10 text-amber-300 border-amber-500/30 animate-pulse'
                            : v.status === 'nao_realizada'
                            ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {v.status.replace('_', ' ')}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-slate-300 text-[11px]">
                      <div>Checklist: {v.checklist_items?.filter((c) => c.checked).length || 0} ok</div>
                      <div>Fotos: {v.photos?.length || 0} anexadas</div>
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => setSelectedVisit(v)}
                        className="p-1.5 rounded-lg bg-[#131722] hover:bg-[#1f2433] text-cyan-300 border border-[#1e2433] cursor-pointer"
                        title="Ver Detalhes da Visita"
                      >
                        <span className="material-symbols-outlined text-[16px]">visibility</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* MODAL DETALHE COMPLETO DA VISITA */}
      {selectedVisit && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#171b26] border border-[#1e2433] rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-6 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#1e2433] pb-4">
              <div className="flex items-center gap-2 font-mono">
                <span className="material-symbols-outlined text-purple-400 text-xl">assignment</span>
                <h3 className="text-base font-bold text-white">
                  Ficha Completa da Visita ({selectedVisit.id.substring(0, 8)})
                </h3>
              </div>
              <button onClick={() => setSelectedVisit(null)} className="text-slate-400 hover:text-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs font-mono">
              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433]">
                <span className="text-slate-500 block">PROMOTOR:</span>
                <span className="text-white font-bold">{selectedVisit.promotor?.nome || selectedVisit.promotor_matricula}</span>
              </div>

              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433]">
                <span className="text-slate-500 block">LOJA / PDV:</span>
                <span className="text-white font-bold">{selectedVisit.loja?.nome || selectedVisit.loja_codigo}</span>
              </div>

              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433]">
                <span className="text-slate-500 block">INDÚSTRIA:</span>
                <span className="text-purple-300 font-bold">{selectedVisit.industria?.nome || selectedVisit.industria_codigo}</span>
              </div>

              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433]">
                <span className="text-slate-500 block">STATUS DA VISITA:</span>
                <span className="text-emerald-400 font-bold uppercase">{selectedVisit.status}</span>
              </div>
            </div>

            {/* Checklist */}
            {selectedVisit.checklist_items && selectedVisit.checklist_items.length > 0 && (
              <div className="space-y-2 font-mono text-xs">
                <span className="text-slate-400 font-bold uppercase block">Itens do Checklist Validados:</span>
                <div className="space-y-1">
                  {selectedVisit.checklist_items.map((item, idx) => (
                    <div key={idx} className="p-2 rounded bg-[#131722] border border-[#1e2433] flex justify-between items-center">
                      <span className={item.checked ? 'text-emerald-300 font-bold' : 'text-slate-400'}>
                        {item.checked ? '✓' : '✗'} {item.item_label}
                      </span>
                      {item.valor_texto && <span className="text-cyan-300 font-bold">{item.valor_texto}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Validades de Produtos */}
            {selectedVisit.validity_items && selectedVisit.validity_items.length > 0 && (
              <div className="space-y-2 font-mono text-xs">
                <span className="text-amber-400 font-bold uppercase block">Controle de Validade de Produtos:</span>
                <div className="space-y-1">
                  {selectedVisit.validity_items.map((val, idx) => (
                    <div key={idx} className="p-2.5 rounded bg-[#131722] border border-[#1e2433] flex justify-between items-center text-slate-200">
                      <div>
                        <strong>{val.produto_nome}</strong> (Qtd: {val.quantidade})
                        {val.lote && <span className="text-slate-400 text-[10px] block font-mono">Lote: {val.lote}</span>}
                      </div>
                      <span className="text-amber-300 font-bold">
                        Venc: {new Date(val.data_vencimento).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Fotos */}
            {selectedVisit.photos && selectedVisit.photos.length > 0 && (
              <div className="space-y-2 font-mono text-xs">
                <span className="text-cyan-400 font-bold uppercase block">Galeria de Fotos Anexadas:</span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {selectedVisit.photos.map((p, idx) => (
                    <div key={idx} className="p-2 rounded bg-[#131722] border border-[#1e2433] space-y-1">
                      <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 text-[9px] font-bold block uppercase">
                        {p.tipo_foto}
                      </span>
                      <a
                        href={p.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-purple-400 text-[10px] underline block truncate"
                      >
                        Abrir Foto Privada
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedVisit.motivo_nao_realizada && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs font-mono text-rose-300">
                <strong>Motivo de Não Realização:</strong> {selectedVisit.motivo_nao_realizada}
              </div>
            )}

            <div className="pt-3 border-t border-[#1e2433] flex justify-end font-mono">
              <button
                onClick={() => setSelectedVisit(null)}
                className="px-5 py-2 rounded-xl bg-[#131722] hover:bg-[#1f2433] text-slate-300 border border-[#1e2433] text-xs font-semibold"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
