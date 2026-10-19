import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ScreenId, ToastMessage, Visit, RouteItem, AlertItem, SystemSettingsState } from '../types';
import { supabase } from '../lib/supabase';
import { fetchSystemSettings } from '../lib/systemSettings';
import { useAuth } from '../auth/AuthProvider';
import {
  calculateOperationalVisits,
  getLocalDateString,
  OperationalVisitItem,
  DayOfWeekDate
} from '../utils/routePlanner';
import { buildGoogleMapsDirectionsUrl } from '../utils/googleMaps';
import { CHECKLIST_QUANTITY_KEYS } from '../utils/visitExecution';
import { StatCard, StatusBadge, DataTable, Column } from '../components/ui';

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

  // Configurações do Sistema (Modo Operacional e Data Oficial)
  const [systemSettings, setSystemSettings] = useState<SystemSettingsState>({
    mode: 'IMPLANTACAO',
    officialStartDate: null,
    status: 'loading',
    error: null
  });

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

  // Sub-abas de organização compacta
  const [centralTab, setCentralTab] = useState<'alertas' | 'pendencias' | 'visitas_hoje' | 'promotores'>('alertas');
  const [ocorrenciasTab, setOcorrenciasTab] = useState<'rupturas' | 'incidentes' | 'validades' | 'checklist'>('rupturas');

  // Buscas inteligentes nas sub-abas da Central
  const [searchAlerts, setSearchAlerts] = useState('');
  const [searchPendencias, setSearchPendencias] = useState('');
  const [searchAgenda, setSearchAgenda] = useState('');
  const [searchPromotores, setSearchPromotores] = useState('');
  const [searchRupturas, setSearchRupturas] = useState('');
  const [searchValidades, setSearchValidades] = useState('');

  const [tableSearch, setTableSearch] = useState('');
  const [tableStatus, setTableStatus] = useState<string>('all');
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);

  // Estado para Central de Pendências Operacionais
  const [pendenciaStatusFilter, setPendenciaStatusFilter] = useState<string>('pendente'); // 'pendente' | 'em_andamento' | 'nao_realizada' | 'concluida' | 'todas'
  const [selectedPendingItem, setSelectedPendingItem] = useState<OperationalVisitItem | null>(null);

  // Estado para URLs Assinadas de Fotos de Ruptura (visitId -> signedUrl)
  const [rupturePhotosSigned, setRupturePhotosSigned] = useState<Record<string, string>>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Estados Onda 4.4B: Confirmação de Resolução e Modal Detalhado de Ocorrência
  const [occurrenceToResolve, setOccurrenceToResolve] = useState<{
    id: string;
    titulo: string;
    lojaNome: string;
    descricao?: string;
  } | null>(null);

  const [selectedOccurrenceDetail, setSelectedOccurrenceDetail] = useState<{
    id: string;
    tipo: string;
    titulo: string;
    descricao: string;
    resolvido: boolean;
    data: string;
    lojaNome: string;
    lojaCodigo?: string;
    lojaEndereco?: string;
    industriaNome: string;
    industriaCodigo?: string;
    promotorNome: string;
    promotorMatricula?: string;
    photoSignedUrl?: string;
    visitObj?: Visit | null;
  } | null>(null);

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

      // 2. Rotas, Promotores, Indústrias e Configurações Operacionais
      const [visitsRes, rotasRes, promotoresRes, industriasRes, settingsData] = await Promise.all([
        visitsQuery,
        supabase.from('rotas').select(`
          *,
          industria:industrias(codigo, nome),
          loja:lojas(codigo, nome, cidade, uf),
          promotor:promotores(matricula, nome)
        `),
        supabase.from('promotores').select('*'),
        supabase.from('industrias').select('*'),
        fetchSystemSettings()
      ]);

      if (visitsRes.error) throw visitsRes.error;
      if (rotasRes.error) throw rotasRes.error;

      const realVisits = (visitsRes.data as unknown as Visit[]) || [];
      const realRoutes = (rotasRes.data as unknown as RouteItem[]) || [];

      setVisits(realVisits);
      setRoutes(realRoutes);
      setPromotoresList(promotoresRes.data || []);
      setIndustriasList(industriasRes.data || []);
      setSystemSettings(settingsData);

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

      // Atualizar selectedOccurrenceDetail se estiver aberto com esta ocorrência
      setSelectedOccurrenceDetail((prev) => {
        if (prev && prev.id === occurrenceId) {
          return { ...prev, resolvido: true };
        }
        return prev;
      });

      // Fechar modal de confirmação
      setOccurrenceToResolve(null);

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

  // Função de normalização segura para busca diacrítico-insensível
  const normalizeSafe = (str: string | null | undefined): string => {
    if (!str) return '';
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
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

  // 1.5. CÁLCULO UNIFICADO DA CENTRAL DE PENDÊNCIAS OPERACIONAIS
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
      todayStr,
      operationMode: systemSettings.mode,
      officialStartDate: systemSettings.officialStartDate
    });
  }, [routes, visits, promotoresList, industriasList, periodDaysRange, todayStr, systemSettings]);

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
    const term = normalizeSafe(searchPendencias);

    return allOperationalVisits.filter((item) => {
      const matchSearch =
        !term ||
        normalizeSafe(item.promotorNome).includes(term) ||
        normalizeSafe(item.promotorMatricula).includes(term) ||
        normalizeSafe(item.lojaNome).includes(term) ||
        normalizeSafe(item.lojaCodigo).includes(term) ||
        normalizeSafe(item.industriaNome).includes(term) ||
        normalizeSafe(item.industriaCodigo).includes(term);

      const matchInd = filterIndustria === 'all' || item.industriaCodigo === filterIndustria;
      const matchProm = filterPromotor === 'all' || item.promotorMatricula === filterPromotor;
      const matchLoja = filterLoja === 'all' || item.lojaCodigo === filterLoja;

      let matchStatus = true;
      if (pendenciaStatusFilter !== 'todas') {
        matchStatus = item.status === pendenciaStatusFilter;
      }

      return matchSearch && matchInd && matchProm && matchLoja && matchStatus;
    });
  }, [allOperationalVisits, searchPendencias, filterIndustria, filterPromotor, filterLoja, pendenciaStatusFilter]);

  // 2. EXPANDIR OCORRÊNCIAS DE PLANEJAMENTO REAL POR DATA E ROTA
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

  // Taxa de Execução Real
  const taxaExecucao = rotasPlanejadasCount > 0
    ? Math.round((concluidasCount / rotasPlanejadasCount) * 100)
    : (totalVisitas > 0 ? Math.round((concluidasCount / totalVisitas) * 100) : 0);

  // 4. Mapeamento de Lojas Sem Atendimento
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

  // 4.5. AGENDA OPERACIONAL DO DIA
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
    let priorityOrder = 2;

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
    const term = normalizeSafe(searchAgenda);

    const matchSearch =
      !term ||
      normalizeSafe(item.promotorNome).includes(term) ||
      normalizeSafe(item.promotorMatricula).includes(term) ||
      normalizeSafe(item.lojaNome).includes(term) ||
      normalizeSafe(item.lojaCodigo).includes(term) ||
      normalizeSafe(item.industriaNome).includes(term) ||
      normalizeSafe(item.industriaCodigo).includes(term);

    const matchInd = filterIndustria === 'all' || item.industriaCodigo === filterIndustria;
    const matchProm = filterPromotor === 'all' || item.promotorMatricula === filterPromotor;
    const matchLoja = filterLoja === 'all' || item.lojaCodigo === filterLoja;
    const matchStatus = filterAgendaStatus === 'all' || item.status === filterAgendaStatus;

    return matchSearch && matchInd && matchProm && matchLoja && matchStatus;
  }).sort((a, b) => {
    if (a.priorityOrder !== b.priorityOrder) {
      return a.priorityOrder - b.priorityOrder;
    }
    if (a.startedAt && b.startedAt) {
      return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
    }
    if (a.startedAt) return -1;
    if (b.startedAt) return 1;
    return a.lojaNome.localeCompare(b.lojaNome);
  });

  // 5. CONSOLIDAÇÃO DE RUPTURAS OPERACIONAIS
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
    visitObj?: Visit | null;
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
            photoSignedUrl: rupturePhotosSigned[v.id],
            visitObj: v
          });
        }
      });
    }
  });

  const rupturasFiltradasContexto = todasRupturas.filter((r) => {
    const matchInd = filterIndustria === 'all' || r.industriaCodigo === filterIndustria;
    const matchProm = filterPromotor === 'all' || r.promotorMatricula === filterPromotor;
    const matchLoja = filterLoja === 'all' || r.lojaCodigo === filterLoja;
    return matchInd && matchProm && matchLoja;
  });

  const totalRupturasCount = todasRupturas.length;
  const rupturasAbertasCount = todasRupturas.filter((r) => !r.resolvido).length;
  const rupturasResolvidasCount = todasRupturas.filter((r) => r.resolvido).length;

  const totalRupturasFiltradasContexto = rupturasFiltradasContexto.length;
  const rupturasAbertasFiltradasCount = rupturasFiltradasContexto.filter((r) => !r.resolvido).length;
  const rupturasResolvidasFiltradasCount = rupturasFiltradasContexto.filter((r) => r.resolvido).length;

  const rupturasFiltradas = rupturasFiltradasContexto.filter((r) => {
    const term = normalizeSafe(searchRupturas);
    const matchSearch =
      !term ||
      normalizeSafe(r.promotorNome).includes(term) ||
      normalizeSafe(r.promotorMatricula).includes(term) ||
      normalizeSafe(r.lojaNome).includes(term) ||
      normalizeSafe(r.lojaCodigo).includes(term) ||
      normalizeSafe(r.industriaNome).includes(term) ||
      normalizeSafe(r.industriaCodigo).includes(term) ||
      normalizeSafe(r.descricao).includes(term);

    const matchStatus =
      filterRupturaStatus === 'all'
        ? true
        : filterRupturaStatus === 'abertas'
        ? !r.resolvido
        : r.resolvido;

    return matchSearch && matchStatus;
  }).sort((a, b) => new Date(b.createdAt || b.dataVisita).getTime() - new Date(a.createdAt || a.dataVisita).getTime());

  // 6. CONSOLIDAÇÃO DE VALIDADES E VENCIMENTOS
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
    visitObj?: Visit | null;
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
          priority,
          visitObj: v
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
    const term = normalizeSafe(searchValidades);
    const matchSearch =
      !term ||
      normalizeSafe(v.produtoNome).includes(term) ||
      normalizeSafe(v.promotorNome).includes(term) ||
      normalizeSafe(v.promotorMatricula).includes(term) ||
      normalizeSafe(v.lojaNome).includes(term) ||
      normalizeSafe(v.lojaCodigo).includes(term) ||
      normalizeSafe(v.industriaNome).includes(term) ||
      normalizeSafe(v.industriaCodigo).includes(term) ||
      normalizeSafe(v.lote).includes(term) ||
      normalizeSafe(v.observacao).includes(term);

    const matchInd = filterIndustria === 'all' || v.industriaCodigo === filterIndustria;
    const matchProm = filterPromotor === 'all' || v.promotorMatricula === filterPromotor;
    const matchLoja = filterLoja === 'all' || v.lojaCodigo === filterLoja;
    const matchCat = filterValidadeStatus === 'all' || v.categoria === filterValidadeStatus;

    return matchSearch && matchInd && matchProm && matchLoja && matchCat;
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
    resolvido?: boolean;
    visitObj?: Visit | null;
  }> = [];

  visits.forEach((v) => {
    if (v.photos) totalFotos += v.photos.length;

    if (v.checklist_items) {
      totalChecklistItems += v.checklist_items.length;
      totalChecklistChecked += v.checklist_items.filter((c) => {
        if (CHECKLIST_QUANTITY_KEYS.has(c.item_key)) {
          return Boolean(c.valor_texto && c.valor_texto.trim() !== '');
        }
        return Boolean(c.checked);
      }).length;
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
          dataHora: occ.created_at,
          resolvido: Boolean(occ.resolvido),
          visitObj: v
        });
      });
    }
  });

  const checklistPerc = totalChecklistItems > 0 ? Math.round((totalChecklistChecked / totalChecklistItems) * 100) : 0;

  // 5.5. CENTRAL DE ALERTAS OPERACIONAIS
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

    // 5. Aderência por Promotor (Operação Oficial)
    if (systemSettings.mode === 'OPERACAO_OFICIAL' && systemSettings.status === 'loaded') {
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
    }

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
  }, [visits, routes, promotoresList, industriasList, totalPlannedItems, visitsMapByRouteKey, periodFilter, systemSettings]);

  // Filtragem dos Alertas da Central
  const centralAlertsFiltrados = useMemo(() => {
    const term = normalizeSafe(searchAlerts);

    return allCentralAlerts.filter((item) => {
      const matchSearch =
        !term ||
        normalizeSafe(item.promotor).includes(term) ||
        normalizeSafe(item.promotorMatricula).includes(term) ||
        normalizeSafe(item.loja).includes(term) ||
        normalizeSafe(item.lojaCodigo).includes(term) ||
        normalizeSafe(item.industria).includes(term) ||
        normalizeSafe(item.industriaCodigo).includes(term) ||
        normalizeSafe(item.titulo).includes(term) ||
        normalizeSafe(item.descricao).includes(term) ||
        normalizeSafe(item.tipo).includes(term) ||
        normalizeSafe(item.id).includes(term);

      const matchInd = filterIndustria === 'all' || item.industriaCodigo === filterIndustria;
      const matchProm = filterPromotor === 'all' || item.promotorMatricula === filterPromotor;
      const matchLoja = filterLoja === 'all' || item.lojaCodigo === filterLoja;

      let matchPriority = true;
      if (filterAlertPriority === 'active') {
        matchPriority = item.prioridade !== 'resolvido';
      } else if (filterAlertPriority !== 'all') {
        matchPriority = item.prioridade === filterAlertPriority;
      }

      return matchSearch && matchInd && matchProm && matchLoja && matchPriority;
    });
  }, [allCentralAlerts, searchAlerts, filterIndustria, filterPromotor, filterLoja, filterAlertPriority]);

  const promotoresPendingSummaryFiltrados = useMemo(() => {
    const term = normalizeSafe(searchPromotores);
    if (!term) return promotoresPendingSummary;

    return promotoresPendingSummary.filter((p) => {
      return (
        normalizeSafe(p.nome).includes(term) ||
        normalizeSafe(p.matricula).includes(term)
      );
    });
  }, [promotoresPendingSummary, searchPromotores]);

  const alertCounts = useMemo(() => {
    const criticos = allCentralAlerts.filter((a) => a.prioridade === 'critico').length;
    const atencao = allCentralAlerts.filter((a) => a.prioridade === 'atencao').length;
    const pendentes = allCentralAlerts.filter((a) => a.prioridade === 'pendente').length;
    const resolvidos = allCentralAlerts.filter((a) => a.prioridade === 'resolvido').length;
    const totalAtivos = criticos + atencao + pendentes;

    return { criticos, atencao, pendentes, resolvidos, totalAtivos, totalGeral: allCentralAlerts.length };
  }, [allCentralAlerts]);

  // 6. Agregação de Visitas por Promotor
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

  const promotoresCriticos = useMemo(() => {
    return rankingPromotores.filter((p) => p.planejadas > 0 && p.taxa < 50);
  }, [rankingPromotores]);

  // 9. Lojas Críticas
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

  const todasLojasOperacionais = useMemo(() => {
    const map = new Map<string, string>();
    routes.forEach((r) => {
      const code = r.loja_codigo;
      const name = r.loja?.nome || code;
      if (code && !map.has(code)) map.set(code, name);
    });
    visits.forEach((v) => {
      const code = v.loja_codigo;
      const name = v.loja?.nome || code;
      if (code && !map.has(code)) map.set(code, name);
    });
    return Array.from(map.entries())
      .map(([codigo, nome]) => ({ codigo, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [routes, visits]);

  const filteredVisits = useMemo(() => {
    const term = normalizeSafe(tableSearch);

    return visits.filter((v) => {
      const matchSearch =
        !term ||
        normalizeSafe(v.promotor?.nome).includes(term) ||
        normalizeSafe(v.promotor_matricula).includes(term) ||
        normalizeSafe(v.loja?.nome).includes(term) ||
        normalizeSafe(v.loja_codigo).includes(term) ||
        normalizeSafe(v.industria?.nome).includes(term) ||
        normalizeSafe(v.industria_codigo).includes(term) ||
        normalizeSafe(v.id).includes(term);

      const matchStatus = tableStatus === 'all' || v.status === tableStatus;
      const matchInd = filterIndustria === 'all' || v.industria_codigo === filterIndustria;
      const matchProm = filterPromotor === 'all' || v.promotor_matricula === filterPromotor;
      const matchLoja = filterLoja === 'all' || v.loja_codigo === filterLoja;

      return matchSearch && matchStatus && matchInd && matchProm && matchLoja;
    });
  }, [visits, tableSearch, tableStatus, filterIndustria, filterPromotor, filterLoja]);

  return (
    <div className="w-full px-4 lg:px-8 py-5 max-w-[1720px] mx-auto space-y-5 font-sans text-[#171717]">
      {/* 1. CABEÇALHO OPERACIONAL COMPACTO E TELEMETRIA */}
      <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 bg-[#F7F6F2] border border-[#CFCDC5] p-4 sm:p-5 rounded-2xl shadow-xs relative overflow-hidden">
        <div className="flex flex-col space-y-1.5 z-10">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-300 font-mono text-[11px] font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              TELEMETRIA OPERACIONAL REALTIME
            </span>
            <span className="text-xs text-[#737373] font-mono hidden sm:inline">• MK9 Date</span>
            <span className="text-xs text-[#737373] font-mono hidden md:inline">
              | Período: <strong className="text-[#171717]">{periodFilter === 'today' ? 'Hoje' : periodFilter === 'week' ? 'Últimos 7 dias' : 'Este mês'}</strong>
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#171717] tracking-tight">
            Painel Operacional
          </h1>
          <p className="text-xs sm:text-sm text-[#737373]">
            Acompanhamento centralizado em tempo real de rotas, visitas, rupturas e inconformidades em campo.
          </p>
        </div>

        {/* Controles de Período Rápido e Sincronização */}
        <div className="flex flex-wrap items-center gap-2.5 z-10 font-mono text-xs">
          <div className="flex items-center bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl p-1" role="group" aria-label="Filtro de período">
            <button
              onClick={() => setPeriodFilter('today')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                periodFilter === 'today'
                  ? 'bg-[#222222] text-white shadow-xs'
                  : 'text-[#5F5F5F] hover:text-[#171717] hover:bg-[#E4E2DB]'
              }`}
            >
              Hoje
            </button>
            <button
              onClick={() => setPeriodFilter('week')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                periodFilter === 'week'
                  ? 'bg-[#222222] text-white shadow-xs'
                  : 'text-[#5F5F5F] hover:text-[#171717] hover:bg-[#E4E2DB]'
              }`}
            >
              7 dias
            </button>
            <button
              onClick={() => setPeriodFilter('month')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                periodFilter === 'month'
                  ? 'bg-[#222222] text-white shadow-xs'
                  : 'text-[#5F5F5F] hover:text-[#171717] hover:bg-[#E4E2DB]'
              }`}
            >
              Mês
            </button>
          </div>

          <button
            onClick={fetchOperationalData}
            disabled={loading}
            className="flex items-center gap-1.5 bg-[#222222] hover:bg-black text-white font-bold px-3.5 py-2 rounded-xl shadow-xs transition-all active:scale-95 cursor-pointer disabled:opacity-50"
            title="Sincronizar telemetria com Supabase"
          >
            <span className={`material-symbols-outlined text-[16px] ${loading ? 'animate-spin' : ''}`}>
              refresh
            </span>
            <span>Atualizar</span>
          </button>

          <div className="px-3 py-2 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#737373] text-[11px] whitespace-nowrap">
            Sinc: <strong className="text-[#171717]">{lastUpdate}</strong>
          </div>
        </div>
      </header>

      {/* 1.1 BANNER DE MODO OPERACIONAL (COMPACTO E ACESSÍVEL) */}
      {systemSettings.status === 'loading' ? (
        <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-xl p-3 flex items-center gap-3 font-mono text-xs text-[#737373]">
          <span className="material-symbols-outlined text-purple-600 animate-spin text-sm">sync</span>
          <span>Carregando diretrizes operacionais de SLA...</span>
        </div>
      ) : systemSettings.mode === 'IMPLANTACAO' ? (
        <div className="bg-[#FFF8E6] border border-[#FCE19B] rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 font-mono text-xs shadow-2xs">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[#D98A00] text-xl">info</span>
            <div>
              <span className="font-bold text-[#945B00] bg-[#FEF0C7] px-2 py-0.5 rounded border border-[#FCE19B] text-[10px] mr-2">
                FASE DE IMPLANTAÇÃO
              </span>
              <span className="text-[#171717] font-sans text-xs">
                Período de calibração ativa. Rotas sem visita registrada <strong>não geram penalidades formais de SLA</strong>.
              </span>
            </div>
          </div>
          <StatusBadge status="neutro" label="Telemetria Pré-SLA" className="self-start sm:self-auto shrink-0" />
        </div>
      ) : (
        <div className="bg-[#E8F5EE] border border-[#B9E5D0] rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 font-mono text-xs shadow-2xs">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[#16845B] text-xl">verified</span>
            <div>
              <span className="font-bold text-[#16845B] bg-[#D1FADF] px-2 py-0.5 rounded border border-[#A6F4C5] text-[10px] mr-2">
                OPERAÇÃO OFICIAL ATIVA
              </span>
              <span className="text-[#171717] font-sans text-xs">
                SLA em vigor integral. Conformidade e aderência de rotas monitoradas oficialmente em tempo real.
              </span>
            </div>
          </div>
          <StatusBadge status="conforme" label="SLA Ativo" className="self-start sm:self-auto shrink-0" />
        </div>
      )}

      {/* 1.2 FILTROS GLOBAIS OPERACIONAIS */}
      <section className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-xl p-3 shadow-xs font-mono text-xs flex flex-wrap items-center gap-3">
        <span className="text-[#737373] font-bold uppercase text-[10px] flex items-center gap-1">
          <span className="material-symbols-outlined text-purple-600 text-[15px]">filter_alt</span>
          Filtros:
        </span>

        <div className="flex items-center gap-1.5">
          <label className="text-[#737373] text-[10px] uppercase">Indústria:</label>
          <select
            value={filterIndustria}
            onChange={(e) => setFilterIndustria(e.target.value)}
            className="h-7.5 px-2.5 bg-[#EAE8E2] border border-[#CFCDC5] rounded-lg text-[#171717] focus:outline-none focus:border-purple-600 text-xs"
          >
            <option value="all">Todas ({industriasList.length})</option>
            {industriasList.map((ind) => (
              <option key={ind.codigo} value={ind.codigo}>
                {ind.nome}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <label className="text-[#737373] text-[10px] uppercase">Promotor:</label>
          <select
            value={filterPromotor}
            onChange={(e) => setFilterPromotor(e.target.value)}
            className="h-7.5 px-2.5 bg-[#EAE8E2] border border-[#CFCDC5] rounded-lg text-[#171717] focus:outline-none focus:border-purple-600 text-xs"
          >
            <option value="all">Todos ({promotoresList.length})</option>
            {promotoresList.map((p) => (
              <option key={p.matricula} value={p.matricula}>
                {p.nome}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <label className="text-[#737373] text-[10px] uppercase">Loja / PDV:</label>
          <select
            value={filterLoja}
            onChange={(e) => setFilterLoja(e.target.value)}
            className="h-7.5 px-2.5 bg-[#EAE8E2] border border-[#CFCDC5] rounded-lg text-[#171717] focus:outline-none focus:border-purple-600 text-xs max-w-[190px]"
          >
            <option value="all">Todas ({todasLojasOperacionais.length})</option>
            {todasLojasOperacionais.map((l) => (
              <option key={l.codigo} value={l.codigo}>
                {l.nome}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <label className="text-[#737373] text-[10px] uppercase">Validade:</label>
          <select
            value={filterValidadeStatus}
            onChange={(e) => setFilterValidadeStatus(e.target.value)}
            className="h-7.5 px-2 bg-[#EAE8E2] border border-[#CFCDC5] rounded-lg text-[#171717] focus:outline-none focus:border-purple-600 text-xs font-semibold"
          >
            <option value="all">Todas ({todasValidades.length})</option>
            <option value="vencidos">🔴 Vencidos ({validadeCountVencidos})</option>
            <option value="ate3">🚨 Até 3 dias ({validadeCountAte3})</option>
            <option value="ate7">🟠 4–7 dias ({validadeCountAte7})</option>
            <option value="ate30">🟡 8–30 dias ({validadeCountAte30})</option>
            <option value="normal">🟢 Normal ({validadeCountNormal})</option>
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <label className="text-[#737373] text-[10px] uppercase">Agenda:</label>
          <select
            value={filterAgendaStatus}
            onChange={(e) => setFilterAgendaStatus(e.target.value)}
            className="h-7.5 px-2 bg-[#EAE8E2] border border-[#CFCDC5] rounded-lg text-[#171717] focus:outline-none focus:border-purple-600 text-xs font-semibold"
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
            className="px-2.5 py-1 rounded bg-[#E4E2DB] hover:bg-[#CFCDC5] text-[#171717] text-[10px] font-bold transition-all cursor-pointer border border-[#CFCDC5]"
          >
            Limpar Filtros
          </button>
        )}
      </section>

      {error && (
        <div className="p-3.5 bg-[#FDF2F2] border border-[#F8C8C8] rounded-xl text-xs font-mono text-[#D93636] flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#D93636] text-base">warning</span>
            <span>{error}</span>
          </div>
          <button onClick={fetchOperationalData} className="px-3 py-1 bg-[#D93636] text-white font-bold rounded-lg text-[11px] cursor-pointer hover:bg-red-700 transition-colors">
            Tentar Novamente
          </button>
        </div>
      )}

      {/* ========================================================= */}
      {/* 2. FAIXA MODERNA DE INDICADORES PRINCIPAIS (STATCARD)    */}
      {/* ========================================================= */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono">
        {/* Card 1: Visitas de Hoje */}
        <StatCard
          title="Visitas de Hoje"
          value={agendaDoDia.filter(a => a.status === 'concluida').length}
          description="visitas concluídas hoje"
          icon="calendar_today"
          variant="info"
          onClick={() => setCentralTab('visitas_hoje')}
          badge={
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-900 border border-cyan-300 font-bold">
              {plannedItemsToday.length} plan.
            </span>
          }
          subtitle={
            <div className="flex items-center justify-between text-[11px]">
              <span>🔵 {agendaDoDia.filter(a => a.status === 'em_andamento').length} andam.</span>
              <span>🟡 {agendaDoDia.filter(a => a.status === 'pendente').length} pend.</span>
              <span>🔴 {agendaDoDia.filter(a => a.status === 'nao_realizada').length} n/r</span>
            </div>
          }
        />

        {/* Card 2: Pendências Críticas */}
        <StatCard
          title="Pendências Críticas"
          value={pendenciasKpis.pendentesAtrasadas}
          description="atrasadas (fora do prazo)"
          icon="pending_actions"
          variant={pendenciasKpis.pendentesAtrasadas > 0 ? 'danger' : 'warning'}
          onClick={() => setCentralTab('pendencias')}
          badge={
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
              pendenciasKpis.pendentesAtrasadas > 0
                ? 'bg-rose-100 text-rose-900 border-rose-300'
                : 'bg-amber-100 text-amber-900 border-amber-300'
            }`}>
              {pendenciasKpis.pendentesTotal} no período
            </span>
          }
          subtitle={
            <div className="flex items-center justify-between text-[11px]">
              <span>{pendenciasKpis.pendentesHoje} hoje</span>
              <span className="text-amber-800 font-bold">{pendenciasKpis.naoRealizadas} não realizadas</span>
            </div>
          }
        />

        {/* Card 3: Rupturas Abertas */}
        <StatCard
          title="Rupturas Abertas"
          value={rupturasAbertasFiltradasCount}
          description="na gôndola (abertas)"
          icon="report_problem"
          variant={rupturasAbertasFiltradasCount > 0 ? 'danger' : 'success'}
          onClick={() => {
            setOcorrenciasTab('rupturas');
            setFilterRupturaStatus('abertas');
          }}
          badge={
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-900 border-rose-300 font-bold">
              {totalRupturasCount} total
            </span>
          }
          subtitle={
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#16845B] font-bold">🟢 {rupturasResolvidasFiltradasCount} resolvidas</span>
              <span>{totalRupturasFiltradasContexto} no filtro</span>
            </div>
          }
        />

        {/* Card 4: Vencimentos Críticos */}
        <StatCard
          title="Vencimentos Críticos"
          value={validadeCountVencidos + validadeCountAte3}
          description="itens em risco imediato"
          icon="inventory_2"
          variant={validadeCountVencidos + validadeCountAte3 > 0 ? 'danger' : 'success'}
          onClick={() => {
            setOcorrenciasTab('validades');
            setFilterValidadeStatus('vencidos');
          }}
          badge={
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-900 border border-purple-300 font-bold">
              {todasValidades.length} monitorados
            </span>
          }
          subtitle={
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#D93636] font-bold">🔴 {validadeCountVencidos} vencidos</span>
              <span className="text-[#D98A00] font-bold">🚨 {validadeCountAte3} até 3d</span>
            </div>
          }
        />
      </section>

      {/* ========================================================= */}
      {/* 3. CENTRAL DE ATENÇÃO OPERACIONAL (ABAS INTEGRADAS)       */}
      {/* ========================================================= */}
      <section className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl p-4 sm:p-5 shadow-sm space-y-4 font-mono">
        {/* Cabeçalho da Central + Abas de Navegação */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-[#CFCDC5] pb-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-purple-600 text-xl">tune</span>
              <h2 className="text-base font-black text-[#171717] tracking-tight">
                Central de Atenção Operacional
              </h2>
            </div>
            <p className="text-xs text-[#77766F] font-sans">
              Visão consolidada para ação gerencial rápida: alertas de inconformidade, pendências de agenda e visitas do dia.
            </p>
          </div>

          {/* Abas Rápidas da Central */}
          <div className="flex items-center gap-1.5 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl p-1 text-xs self-start lg:self-auto overflow-x-auto max-w-full">
            <button
              onClick={() => setCentralTab('alertas')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                centralTab === 'alertas'
                  ? 'bg-[#222222] text-white shadow-xs'
                  : 'text-[#5F5F5F] hover:text-[#171717] hover:bg-[#E4E2DB]'
              }`}
            >
              <span className="material-symbols-outlined text-sm">notifications_active</span>
              Alertas Ativos ({alertCounts.totalAtivos})
            </button>

            <button
              onClick={() => setCentralTab('pendencias')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                centralTab === 'pendencias'
                  ? 'bg-[#222222] text-white shadow-xs'
                  : 'text-[#5F5F5F] hover:text-[#171717] hover:bg-[#E4E2DB]'
              }`}
            >
              <span className="material-symbols-outlined text-sm">pending_actions</span>
              Pendências & Agendas ({pendenciasKpis.pendentesTotal})
            </button>

            <button
              onClick={() => setCentralTab('visitas_hoje')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                centralTab === 'visitas_hoje'
                  ? 'bg-[#222222] text-white shadow-xs'
                  : 'text-[#5F5F5F] hover:text-[#171717] hover:bg-[#E4E2DB]'
              }`}
            >
              <span className="material-symbols-outlined text-sm">calendar_today</span>
              Visitas de Hoje ({plannedItemsToday.length})
            </button>

            <button
              onClick={() => setCentralTab('promotores')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                centralTab === 'promotores'
                  ? 'bg-[#222222] text-white shadow-xs'
                  : 'text-[#5F5F5F] hover:text-[#171717] hover:bg-[#E4E2DB]'
              }`}
            >
              <span className="material-symbols-outlined text-sm">leaderboard</span>
              Resumo por Promotor ({promotoresPendingSummary.length})
            </button>
          </div>
        </div>

        {/* CONTEÚDO DA ABA 1: ALERTAS OPERACIONAIS */}
        {centralTab === 'alertas' && (() => {
          const alertColumns: Column<AlertItem>[] = [
            {
              key: 'prioridade',
              header: 'PRIORIDADE',
              sortable: true,
              className: 'w-[120px] text-center whitespace-nowrap',
              accessor: (item) => item.prioridade,
              render: (item) => {
                if (item.prioridade === 'critico') return <StatusBadge status="critico" label="CRÍTICO" />;
                if (item.prioridade === 'atencao') return <StatusBadge status="atencao" label="ATENÇÃO" />;
                if (item.prioridade === 'pendente') return <StatusBadge status="pendente" label="PENDENTE" />;
                return <StatusBadge status="concluida" label="RESOLVIDO" />;
              }
            },
            {
              key: 'tipo',
              header: 'TIPO',
              sortable: true,
              className: 'w-[100px] whitespace-nowrap text-[11px] font-bold uppercase text-[#5F5F5F]',
              accessor: (item) => item.tipo
            },
            {
              key: 'data',
              header: 'DATA',
              sortable: true,
              className: 'w-[100px] whitespace-nowrap text-[#77766F]',
              accessor: (item) => item.data,
              render: (item) => new Date(item.data + 'T00:00:00').toLocaleDateString('pt-BR')
            },
            {
              key: 'promotor',
              header: 'PROMOTOR',
              sortable: true,
              className: 'min-w-[150px]',
              accessor: (item) => item.promotor,
              render: (item) => (
                <div>
                  <div className="font-semibold text-[#171717]">{item.promotor}</div>
                  {item.promotorMatricula && (
                    <div className="text-[10px] text-[#737373] font-mono">Mat: {item.promotorMatricula}</div>
                  )}
                </div>
              )
            },
            {
              key: 'loja',
              header: 'LOJA / PDV',
              sortable: true,
              className: 'min-w-[170px]',
              accessor: (item) => item.loja,
              render: (item) => (
                <div>
                  <div className="font-semibold text-[#171717]">{item.loja}</div>
                  {item.lojaCodigo && (
                    <div className="text-[10px] text-[#737373] font-mono">Cód: {item.lojaCodigo}</div>
                  )}
                </div>
              )
            },
            {
              key: 'industria',
              header: 'INDÚSTRIA',
              sortable: true,
              className: 'min-w-[130px]',
              accessor: (item) => item.industria,
              render: (item) => (
                <span className="font-bold text-[#7E22CE]">{item.industria}</span>
              )
            },
            {
              key: 'descricao',
              header: 'DESCRIÇÃO DA OCORRÊNCIA',
              className: 'min-w-[240px] max-w-sm',
              render: (item) => (
                <div>
                  <div className="font-bold text-[#171717]">{item.titulo}</div>
                  <div className="text-[11px] text-[#77766F] truncate" title={item.descricao}>{item.descricao}</div>
                </div>
              )
            },
            {
              key: 'situacao',
              header: 'SITUAÇÃO',
              className: 'w-[130px] text-center whitespace-nowrap text-[11px] font-bold',
              render: (item) => item.statusVisual
            },
            {
              key: 'acoes',
              header: 'AÇÕES',
              className: 'w-[110px] text-right whitespace-nowrap',
              render: (item) => (
                <div className="flex items-center justify-end gap-1.5">
                  {item.occurrenceId && item.prioridade !== 'resolvido' && canResolve && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOccurrenceToResolve({
                          id: item.occurrenceId!,
                          titulo: item.titulo,
                          lojaNome: item.loja,
                          descricao: item.descricao
                        });
                      }}
                      disabled={resolvingId === item.occurrenceId}
                      className="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[10px] cursor-pointer shadow-xs transition-colors"
                      title="Marcar ruptura como resolvida"
                    >
                      {resolvingId === item.occurrenceId ? '...' : 'Resolver'}
                    </button>
                  )}
                  {item.occurrenceId && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedOccurrenceDetail({
                          id: item.occurrenceId!,
                          tipo: item.tipo,
                          titulo: item.titulo,
                          descricao: item.descricao,
                          resolvido: item.prioridade === 'resolvido',
                          data: item.data,
                          lojaNome: item.loja,
                          lojaCodigo: item.lojaCodigo,
                          lojaEndereco: item.visitObj?.loja?.endereco,
                          industriaNome: item.industria,
                          industriaCodigo: item.industriaCodigo,
                          promotorNome: item.promotor,
                          promotorMatricula: item.promotorMatricula,
                          photoSignedUrl: item.visitObj?.id ? rupturePhotosSigned[item.visitObj.id] : undefined,
                          visitObj: item.visitObj
                        });
                      }}
                      className="px-2.5 py-1 rounded-lg bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] font-bold text-[10px] border border-[#CFCDC5] cursor-pointer transition-colors"
                      title="Ver ficha detalhada da ocorrência"
                    >
                      Detalhes
                    </button>
                  )}
                  {item.visitObj && !item.occurrenceId && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedVisit(item.visitObj!);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] font-bold text-[10px] border border-[#CFCDC5] cursor-pointer transition-colors"
                      title="Ver ficha da visita"
                    >
                      Visita
                    </button>
                  )}
                </div>
              )
            }
          ];

          return (
            <div className="space-y-3">
              {/* Filtros de Prioridade dos Alertas */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl p-1">
                  <button
                    onClick={() => setFilterAlertPriority('active')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      filterAlertPriority === 'active' ? 'bg-[#222222] text-white' : 'text-[#5F5F5F] hover:text-[#171717]'
                    }`}
                  >
                    Ativos ({alertCounts.totalAtivos})
                  </button>
                  <button
                    onClick={() => setFilterAlertPriority('critico')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      filterAlertPriority === 'critico' ? 'bg-rose-700 text-white' : 'text-rose-700 hover:bg-rose-100'
                    }`}
                  >
                    🔴 Críticos ({alertCounts.criticos})
                  </button>
                  <button
                    onClick={() => setFilterAlertPriority('atencao')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      filterAlertPriority === 'atencao' ? 'bg-amber-700 text-white' : 'text-amber-800 hover:bg-amber-100'
                    }`}
                  >
                    🟠 Atenção ({alertCounts.atencao})
                  </button>
                  <button
                    onClick={() => setFilterAlertPriority('pendente')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      filterAlertPriority === 'pendente' ? 'bg-yellow-700 text-white' : 'text-yellow-800 hover:bg-yellow-100'
                    }`}
                  >
                    🟡 Pendentes ({alertCounts.pendentes})
                  </button>
                  <button
                    onClick={() => setFilterAlertPriority('resolvido')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      filterAlertPriority === 'resolvido' ? 'bg-emerald-700 text-white' : 'text-emerald-800 hover:bg-emerald-100'
                    }`}
                  >
                    🟢 Resolvidos ({alertCounts.resolvidos})
                  </button>
                  <button
                    onClick={() => setFilterAlertPriority('all')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      filterAlertPriority === 'all' ? 'bg-[#222222] text-white' : 'text-[#5F5F5F] hover:text-[#171717]'
                    }`}
                  >
                    Todos ({alertCounts.totalGeral})
                  </button>
                </div>

                <div className="relative">
                  <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-[#737373] pointer-events-none">
                    search
                  </span>
                  <input
                    type="text"
                    value={searchAlerts}
                    onChange={(e) => setSearchAlerts(e.target.value)}
                    placeholder="Buscar alertas por promotor, loja, indústria..."
                    className="h-8 pl-8 pr-3 bg-white border border-[#CFCDC5] rounded-xl text-xs text-[#171717] focus:outline-none focus:border-purple-600 w-[240px] sm:w-[280px]"
                    aria-label="Buscar alertas operacionais"
                  />
                  {searchAlerts && (
                    <button
                      onClick={() => setSearchAlerts('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[#737373] hover:text-[#171717] p-0.5 cursor-pointer"
                      title="Limpar busca"
                    >
                      <span className="material-symbols-outlined text-xs">close</span>
                    </button>
                  )}
                </div>
              </div>

              <DataTable<AlertItem>
                data={centralAlertsFiltrados}
                columns={alertColumns}
                keyExtractor={(item) => item.id}
                title="Alertas Operacionais Ativos"
                titleIcon="notifications_active"
                badgeCount={centralAlertsFiltrados.length}
                defaultPageSize={10}
                pageSizeOptions={[10, 25, 50]}
                emptyTitle="Nenhum alerta operacional para este filtro"
                emptyMessage="A operação está em plena conformidade com as diretrizes vigentes."
              />
            </div>
          );
        })()}

        {/* CONTEÚDO DA ABA 2: PENDÊNCIAS & AGENDAS */}
        {centralTab === 'pendencias' && (() => {
          const pendenciaColumns: Column<OperationalVisitItem>[] = [
            {
              key: 'data',
              header: 'DATA PREVISTA',
              sortable: true,
              className: 'w-[120px] whitespace-nowrap',
              accessor: (item) => item.dataStr,
              render: (item) => (
                <div>
                  <div className="font-bold text-[#171717]">{item.dataStr}</div>
                  <div className="text-[10px] text-[#77766F]">{item.dayOfWeekLabel}</div>
                </div>
              )
            },
            {
              key: 'promotor',
              header: 'PROMOTOR',
              sortable: true,
              className: 'min-w-[150px]',
              accessor: (item) => item.promotorNome,
              render: (item) => (
                <div>
                  <div className="font-semibold text-[#171717]">{item.promotorNome}</div>
                  <div className="text-[10px] text-[#737373] font-mono">Mat: {item.promotorMatricula}</div>
                </div>
              )
            },
            {
              key: 'loja',
              header: 'LOJA / PDV',
              sortable: true,
              className: 'min-w-[170px]',
              accessor: (item) => item.lojaNome,
              render: (item) => (
                <div>
                  <div className="font-semibold text-[#171717]">{item.lojaNome}</div>
                  {item.lojaCidade && (
                    <div className="text-[10px] text-[#77766F]">{item.lojaCidade} - {item.lojaUf}</div>
                  )}
                </div>
              )
            },
            {
              key: 'industria',
              header: 'INDÚSTRIA',
              sortable: true,
              className: 'min-w-[130px]',
              accessor: (item) => item.industriaNome,
              render: (item) => (
                <span className="text-[#7E22CE] font-bold">{item.industriaNome}</span>
              )
            },
            {
              key: 'frequencia',
              header: 'FREQUÊNCIA',
              className: 'w-[110px] text-[#77766F] whitespace-nowrap',
              render: (item) => item.frequencia
            },
            {
              key: 'situacao',
              header: 'SITUAÇÃO',
              sortable: true,
              className: 'w-[140px] text-center whitespace-nowrap',
              accessor: (item) => item.status,
              render: (item) => {
                if (item.isPastOverdue) {
                  return <StatusBadge status="critico" label="🚨 ATRASADA" />;
                }
                if (item.status === 'em_andamento') {
                  return <StatusBadge status="em_andamento" label="EM ANDAMENTO" />;
                }
                if (item.status === 'nao_realizada') {
                  return <StatusBadge status="falta" label="NÃO REALIZADA" />;
                }
                if (item.status === 'concluida') {
                  return <StatusBadge status="concluida" label="CONCLUÍDA" />;
                }
                return <StatusBadge status="pendente" label="PENDENTE" />;
              }
            },
            {
              key: 'acoes',
              header: 'AÇÕES',
              className: 'w-[90px] text-right whitespace-nowrap',
              render: (item) => (
                <button
                  onClick={() => setSelectedPendingItem(item)}
                  className="px-2.5 py-1.5 rounded-xl bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] font-bold text-xs transition-all active:scale-95 cursor-pointer shadow-2xs"
                  title="Ver detalhes da pendência"
                >
                  Detalhes
                </button>
              )
            }
          ];

          return (
            <div className="space-y-3">
              {/* Filtros da Tabela de Pendências */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl p-1">
                  <button
                    onClick={() => setPendenciaStatusFilter('pendente')}
                    className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      pendenciaStatusFilter === 'pendente' ? 'bg-rose-700 text-white' : 'text-[#5F5F5F] hover:text-[#171717]'
                    }`}
                  >
                    🔴 Pendentes ({pendenciasKpis.pendentesTotal})
                  </button>
                  <button
                    onClick={() => setPendenciaStatusFilter('em_andamento')}
                    className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      pendenciaStatusFilter === 'em_andamento' ? 'bg-blue-700 text-white' : 'text-[#5F5F5F] hover:text-[#171717]'
                    }`}
                  >
                    🔵 Em Andamento ({pendenciasKpis.emAndamento})
                  </button>
                  <button
                    onClick={() => setPendenciaStatusFilter('nao_realizada')}
                    className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      pendenciaStatusFilter === 'nao_realizada' ? 'bg-orange-700 text-white' : 'text-[#5F5F5F] hover:text-[#171717]'
                    }`}
                  >
                    🟠 Não Realizadas ({pendenciasKpis.naoRealizadas})
                  </button>
                  <button
                    onClick={() => setPendenciaStatusFilter('concluida')}
                    className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      pendenciaStatusFilter === 'concluida' ? 'bg-emerald-700 text-white' : 'text-[#5F5F5F] hover:text-[#171717]'
                    }`}
                  >
                    🟢 Concluídas ({pendenciasKpis.concluidas})
                  </button>
                  <button
                    onClick={() => setPendenciaStatusFilter('todas')}
                    className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      pendenciaStatusFilter === 'todas' ? 'bg-[#222222] text-white' : 'text-[#5F5F5F] hover:text-[#171717]'
                    }`}
                  >
                    Todas ({pendenciasKpis.totalPlanejadas})
                  </button>
                </div>

                <div className="relative">
                  <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-[#737373] pointer-events-none">
                    search
                  </span>
                  <input
                    type="text"
                    value={searchPendencias}
                    onChange={(e) => setSearchPendencias(e.target.value)}
                    placeholder="Buscar por promotor, loja, indústria..."
                    className="h-8 pl-8 pr-3 bg-white border border-[#CFCDC5] rounded-xl text-xs text-[#171717] focus:outline-none focus:border-purple-600 w-[240px] sm:w-[280px]"
                    aria-label="Buscar pendências de rotas"
                  />
                  {searchPendencias && (
                    <button
                      onClick={() => setSearchPendencias('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[#737373] hover:text-[#171717] p-0.5 cursor-pointer"
                      title="Limpar busca"
                    >
                      <span className="material-symbols-outlined text-xs">close</span>
                    </button>
                  )}
                </div>
              </div>

              <DataTable<OperationalVisitItem>
                data={pendenciasFiltradas}
                columns={pendenciaColumns}
                keyExtractor={(item) => item.key}
                title="Pendências e Agendas de Rotas"
                titleIcon="pending_actions"
                badgeCount={pendenciasFiltradas.length}
                defaultPageSize={10}
                pageSizeOptions={[10, 25, 50]}
                emptyTitle="Nenhuma pendência encontrada nesta visualização"
                emptyMessage="Todas as visitas do filtro selecionado estão em conformidade com o cronograma."
              />
            </div>
          );
        })()}

        {/* CONTEÚDO DA ABA 3: VISITAS DE HOJE */}
        {centralTab === 'visitas_hoje' && (() => {
          const agendaColumns: Column<typeof agendaFiltrada[0]>[] = [
            {
              key: 'status',
              header: 'STATUS',
              sortable: true,
              className: 'w-[130px] text-center whitespace-nowrap',
              accessor: (item) => item.status,
              render: (item) => {
                if (item.status === 'concluida') return <StatusBadge status="concluida" label="CONCLUÍDA" />;
                if (item.status === 'em_andamento') return <StatusBadge status="em_andamento" label="EM ANDAMENTO" />;
                if (item.status === 'nao_realizada') return <StatusBadge status="falta" label="NÃO REALIZADA" />;
                return <StatusBadge status="pendente" label="PENDENTE" />;
              }
            },
            {
              key: 'promotor',
              header: 'PROMOTOR',
              sortable: true,
              className: 'min-w-[150px]',
              accessor: (item) => item.promotorNome,
              render: (item) => (
                <div>
                  <div className="font-semibold text-[#171717]">{item.promotorNome}</div>
                  <div className="text-[10px] text-[#737373] font-mono">Mat: {item.promotorMatricula}</div>
                </div>
              )
            },
            {
              key: 'loja',
              header: 'LOJA / PDV',
              sortable: true,
              className: 'min-w-[170px]',
              accessor: (item) => item.lojaNome,
              render: (item) => (
                <div>
                  <div className="font-semibold text-[#171717]">{item.lojaNome}</div>
                  <div className="text-[10px] text-[#737373] font-mono">Cód: {item.lojaCodigo}</div>
                </div>
              )
            },
            {
              key: 'industria',
              header: 'INDÚSTRIA',
              sortable: true,
              className: 'min-w-[130px]',
              accessor: (item) => item.industriaNome,
              render: (item) => (
                <span className="font-bold text-[#7E22CE]">{item.industriaNome}</span>
              )
            },
            {
              key: 'inicio',
              header: 'INÍCIO',
              className: 'w-[90px] text-[#77766F] whitespace-nowrap',
              render: (item) => item.startedAt ? new Date(item.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'
            },
            {
              key: 'conclusao',
              header: 'CONCLUSÃO',
              className: 'w-[90px] text-[#77766F] whitespace-nowrap',
              render: (item) => item.completedAt ? new Date(item.completedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'
            },
            {
              key: 'duracao',
              header: 'DURAÇÃO',
              className: 'w-[90px] text-center font-bold text-emerald-700 whitespace-nowrap',
              render: (item) => item.duracaoFormatada || '—'
            },
            {
              key: 'acoes',
              header: 'AÇÕES',
              className: 'w-[80px] text-right whitespace-nowrap',
              render: (item) => item.visitObj ? (
                <button
                  onClick={() => setSelectedVisit(item.visitObj!)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] font-bold text-xs transition-all active:scale-95 cursor-pointer shadow-2xs"
                  title="Ver Ficha da Visita"
                >
                  <span className="material-symbols-outlined text-[15px]">visibility</span>
                  <span className="hidden sm:inline">Ficha</span>
                </button>
              ) : (
                <span className="text-[10px] text-[#77766F] italic">Aguardando</span>
              )
            }
          ];

          return (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-[#77766F]">
                  Agenda operacional de hoje ({new Date().toLocaleDateString('pt-BR')}) • <strong>{plannedItemsToday.length}</strong> roteirizada(s)
                </span>

                <div className="relative">
                  <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-[#737373] pointer-events-none">
                    search
                  </span>
                  <input
                    type="text"
                    value={searchAgenda}
                    onChange={(e) => setSearchAgenda(e.target.value)}
                    placeholder="Buscar agenda por promotor, loja, indústria..."
                    className="h-8 pl-8 pr-3 bg-white border border-[#CFCDC5] rounded-xl text-xs text-[#171717] focus:outline-none focus:border-purple-600 w-[240px] sm:w-[280px]"
                    aria-label="Buscar visitas do dia"
                  />
                  {searchAgenda && (
                    <button
                      onClick={() => setSearchAgenda('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[#737373] hover:text-[#171717] p-0.5 cursor-pointer"
                      title="Limpar busca"
                    >
                      <span className="material-symbols-outlined text-xs">close</span>
                    </button>
                  )}
                </div>
              </div>

              <DataTable<typeof agendaFiltrada[0]>
                data={agendaFiltrada}
                columns={agendaColumns}
                keyExtractor={(item) => item.key}
                title="Agenda Operacional de Hoje"
                titleIcon="calendar_today"
                badgeCount={agendaFiltrada.length}
                defaultPageSize={10}
                pageSizeOptions={[10, 25, 50]}
                emptyTitle="Nenhuma visita planejada para hoje no filtro atual"
                emptyMessage="Todas as rotas de hoje foram concluídas ou não há registros no filtro selecionado."
              />
            </div>
          );
        })()}

        {/* CONTEÚDO DA ABA 4: RESUMO POR PROMOTOR */}
        {centralTab === 'promotores' && (() => {
          const promotorColumns: Column<typeof promotoresPendingSummaryFiltrados[0]>[] = [
            {
              key: 'promotor',
              header: 'PROMOTOR',
              sortable: true,
              className: 'min-w-[180px]',
              accessor: (p) => p.nome,
              render: (p) => (
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[#77766F] text-sm">person</span>
                  <div>
                    <span className="font-bold text-[#171717]">{p.nome}</span>
                    <span className="text-[10px] text-[#737373] font-mono block">Mat: {p.matricula}</span>
                  </div>
                </div>
              )
            },
            {
              key: 'planejadas',
              header: 'PLANEJADAS',
              sortable: true,
              className: 'w-[100px] text-center font-semibold text-[#171717]',
              accessor: (p) => p.totalPlanned
            },
            {
              key: 'pendentes',
              header: 'PENDENTES',
              sortable: true,
              className: 'w-[100px] text-center font-bold',
              accessor: (p) => p.pendentes,
              render: (p) => (
                <span className={p.pendentes > 0 ? 'text-rose-700 font-black' : 'text-[#77766F]'}>
                  {p.pendentes}
                </span>
              )
            },
            {
              key: 'emAndamento',
              header: 'EM ANDAMENTO',
              sortable: true,
              className: 'w-[110px] text-center text-blue-700 font-semibold',
              accessor: (p) => p.emAndamento
            },
            {
              key: 'naoRealizadas',
              header: 'NÃO REALIZADAS',
              sortable: true,
              className: 'w-[120px] text-center text-orange-700 font-semibold',
              accessor: (p) => p.naoRealizadas
            },
            {
              key: 'concluidas',
              header: 'CONCLUÍDAS',
              sortable: true,
              className: 'w-[100px] text-center text-emerald-700 font-bold',
              accessor: (p) => p.concluidas
            },
            {
              key: 'aderencia',
              header: 'ADERÊNCIA',
              sortable: true,
              className: 'w-[110px] text-right font-bold',
              accessor: (p) => p.aderencia,
              render: (p) => {
                if (systemSettings.mode !== 'OPERACAO_OFICIAL' || systemSettings.status !== 'loaded') {
                  return <StatusBadge status="neutro" label="Pré-SLA" />;
                }
                const badgeStatus = p.aderencia < 50 ? 'critico' : p.aderencia < 80 ? 'atencao' : 'conforme';
                return <StatusBadge status={badgeStatus} label={`${p.aderencia}%`} />;
              }
            },
            {
              key: 'acoes',
              header: 'FILTRAR',
              className: 'w-[80px] text-right whitespace-nowrap',
              render: (p) => (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFilterPromotor(p.matricula);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-[#EAE8E2] hover:bg-[#222222] hover:text-white text-[#171717] border border-[#CFCDC5] font-bold text-[10px] transition-all cursor-pointer"
                  title={`Filtrar apenas o promotor ${p.nome}`}
                >
                  Filtrar
                </button>
              )
            }
          ];

          return (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-[#77766F]">
                  Resumo de rotas e execução por promotor ({promotoresPendingSummary.length} promotores com agendas)
                </span>

                <div className="relative">
                  <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-[#737373] pointer-events-none">
                    search
                  </span>
                  <input
                    type="text"
                    value={searchPromotores}
                    onChange={(e) => setSearchPromotores(e.target.value)}
                    placeholder="Buscar por nome ou matrícula..."
                    className="h-8 pl-8 pr-3 bg-white border border-[#CFCDC5] rounded-xl text-xs text-[#171717] focus:outline-none focus:border-purple-600 w-[240px] sm:w-[280px]"
                    aria-label="Buscar resumo de promotores"
                  />
                  {searchPromotores && (
                    <button
                      onClick={() => setSearchPromotores('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[#737373] hover:text-[#171717] p-0.5 cursor-pointer"
                      title="Limpar busca"
                    >
                      <span className="material-symbols-outlined text-xs">close</span>
                    </button>
                  )}
                </div>
              </div>

              <DataTable<typeof promotoresPendingSummaryFiltrados[0]>
                data={promotoresPendingSummaryFiltrados}
                columns={promotorColumns}
                keyExtractor={(p) => p.matricula}
                title="Resumo Operacional por Promotor"
                titleIcon="leaderboard"
                badgeCount={promotoresPendingSummaryFiltrados.length}
                defaultPageSize={10}
                pageSizeOptions={[10, 25, 50]}
                onRowClick={(p) => setFilterPromotor(p.matricula)}
                emptyTitle="Nenhum promotor encontrado"
                emptyMessage="Nenhum promotor com rotas planejadas foi encontrado no filtro selecionado."
              />
            </div>
          );
        })()}
      </section>

      {/* ========================================================= */}
      {/* 4. OCORRÊNCIAS & QUALIDADE EM CAMPO (BLOCO CONSOLIDADO)    */}
      {/* ========================================================= */}
      <section className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl p-4 sm:p-5 shadow-sm space-y-4 font-mono">
        {/* Cabeçalho do Bloco de Ocorrências e Abas */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-[#CFCDC5] pb-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-rose-600 text-xl">fact_check</span>
              <h2 className="text-base font-black text-[#171717] tracking-tight">
                Ocorrências &amp; Qualidade da Execução
              </h2>
            </div>
            <p className="text-xs text-[#77766F] font-sans">
              Consolidação técnica de rupturas na gôndola, vencimento de produtos, incidentes gerais e validação de checklist.
            </p>
          </div>

          {/* Abas de Ocorrências */}
          <div className="flex items-center gap-1.5 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl p-1 text-xs self-start lg:self-auto overflow-x-auto max-w-full">
            <button
              onClick={() => setOcorrenciasTab('rupturas')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                ocorrenciasTab === 'rupturas'
                  ? 'bg-[#222222] text-white shadow-xs'
                  : 'text-[#5F5F5F] hover:text-[#171717] hover:bg-[#E4E2DB]'
              }`}
            >
              <span className="material-symbols-outlined text-sm">report_problem</span>
              Rupturas ({totalRupturasCount})
            </button>

            <button
              onClick={() => setOcorrenciasTab('validades')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                ocorrenciasTab === 'validades'
                  ? 'bg-[#222222] text-white shadow-xs'
                  : 'text-[#5F5F5F] hover:text-[#171717] hover:bg-[#E4E2DB]'
              }`}
            >
              <span className="material-symbols-outlined text-sm">inventory_2</span>
              Validades ({todasValidades.length})
            </button>

            <button
              onClick={() => setOcorrenciasTab('incidentes')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                ocorrenciasTab === 'incidentes'
                  ? 'bg-[#222222] text-white shadow-xs'
                  : 'text-[#5F5F5F] hover:text-[#171717] hover:bg-[#E4E2DB]'
              }`}
            >
              <span className="material-symbols-outlined text-sm">warning</span>
              Incidentes Gerais ({totalOcorrencias})
            </button>

            <button
              onClick={() => setOcorrenciasTab('checklist')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                ocorrenciasTab === 'checklist'
                  ? 'bg-[#222222] text-white shadow-xs'
                  : 'text-[#5F5F5F] hover:text-[#171717] hover:bg-[#E4E2DB]'
              }`}
            >
              <span className="material-symbols-outlined text-sm">checklist</span>
              Checklist em Campo ({checklistPerc}%)
            </button>
          </div>
        </div>

        {/* SUB-ABA: RUPTURAS OPERACIONAIS */}
        {ocorrenciasTab === 'rupturas' && (() => {
          const rupturaColumns: Column<typeof rupturasFiltradas[0]>[] = [
            {
              key: 'data',
              header: 'DATA',
              sortable: true,
              className: 'w-[100px] whitespace-nowrap text-[#77766F]',
              accessor: (r) => r.createdAt || r.dataVisita,
              render: (r) => new Date(r.createdAt || r.dataVisita).toLocaleDateString('pt-BR')
            },
            {
              key: 'loja',
              header: 'LOJA / PDV',
              sortable: true,
              className: 'min-w-[170px]',
              accessor: (r) => r.lojaNome,
              render: (r) => (
                <div>
                  <div className="font-semibold text-[#171717]">{r.lojaNome}</div>
                  <div className="text-[10px] text-[#737373] font-mono">Cód: {r.lojaCodigo}</div>
                </div>
              )
            },
            {
              key: 'industria',
              header: 'INDÚSTRIA',
              sortable: true,
              className: 'min-w-[130px]',
              accessor: (r) => r.industriaNome,
              render: (r) => (
                <span className="font-bold text-[#7E22CE]">{r.industriaNome}</span>
              )
            },
            {
              key: 'promotor',
              header: 'PROMOTOR',
              sortable: true,
              className: 'min-w-[150px]',
              accessor: (r) => r.promotorNome,
              render: (r) => (
                <div>
                  <div className="font-semibold text-[#171717]">{r.promotorNome}</div>
                  {r.promotorMatricula && (
                    <div className="text-[10px] text-[#737373] font-mono">Mat: {r.promotorMatricula}</div>
                  )}
                </div>
              )
            },
            {
              key: 'descricao',
              header: 'DESCRIÇÃO DA FALTA',
              className: 'min-w-[200px] max-w-xs leading-relaxed text-[#171717]',
              render: (r) => r.descricao
            },
            {
              key: 'foto',
              header: 'FOTO',
              className: 'w-[90px] text-center whitespace-nowrap',
              render: (r) => r.photoSignedUrl ? (
                <a
                  href={r.photoSignedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-50 hover:bg-cyan-100 text-cyan-800 font-bold text-[10px] border border-cyan-300"
                >
                  <span className="material-symbols-outlined text-[13px]">photo_camera</span>
                  Ver Foto
                </a>
              ) : (
                <span className="text-[10px] text-[#77766F] italic">Sem foto</span>
              )
            },
            {
              key: 'status',
              header: 'STATUS',
              sortable: true,
              className: 'w-[110px] text-center whitespace-nowrap',
              accessor: (r) => r.resolvido ? 'resolvida' : 'aberta',
              render: (r) => r.resolvido ? (
                <StatusBadge status="concluida" label="RESOLVIDA" />
              ) : (
                <StatusBadge status="critico" label="ABERTA" />
              )
            },
            {
              key: 'acoes',
              header: 'AÇÕES',
              className: 'w-[120px] text-right whitespace-nowrap',
              render: (r) => (
                <div className="flex items-center justify-end gap-1.5">
                  {!r.resolvido ? (
                    canResolve ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOccurrenceToResolve({
                            id: r.id,
                            titulo: 'Ruptura na Gôndola',
                            lojaNome: r.lojaNome,
                            descricao: r.descricao
                          });
                        }}
                        disabled={resolvingId === r.id}
                        className="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[10px] cursor-pointer shadow-xs transition-colors"
                        title="Marcar ruptura como resolvida"
                      >
                        {resolvingId === r.id ? 'Salvando...' : 'Resolver'}
                      </button>
                    ) : (
                      <span className="text-[10px] text-[#77766F] italic">Apenas Gestor</span>
                    )
                  ) : (
                    <span className="text-[10px] text-emerald-700 font-bold">✓ Concluído</span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedOccurrenceDetail({
                        id: r.id,
                        tipo: 'ruptura',
                        titulo: 'Ruptura Operacional',
                        descricao: r.descricao,
                        resolvido: r.resolvido,
                        data: r.createdAt || r.dataVisita,
                        lojaNome: r.lojaNome,
                        lojaCodigo: r.lojaCodigo,
                        lojaEndereco: r.visitObj?.loja?.endereco,
                        industriaNome: r.industriaNome,
                        industriaCodigo: r.industriaCodigo,
                        promotorNome: r.promotorNome,
                        promotorMatricula: r.promotorMatricula,
                        photoSignedUrl: r.photoSignedUrl,
                        visitObj: r.visitObj
                      });
                    }}
                    className="px-2 py-1 rounded-lg bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] font-bold text-[10px] border border-[#CFCDC5] cursor-pointer transition-colors"
                    title="Ver ficha detalhada da ruptura"
                  >
                    Detalhes
                  </button>
                </div>
              )
            }
          ];

          return (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl p-1 text-xs">
                  <button
                    onClick={() => setFilterRupturaStatus('abertas')}
                    className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      filterRupturaStatus === 'abertas' ? 'bg-rose-700 text-white' : 'text-rose-700 hover:bg-rose-100'
                    }`}
                  >
                    🔴 Abertas ({rupturasAbertasFiltradasCount})
                  </button>
                  <button
                    onClick={() => setFilterRupturaStatus('resolvidas')}
                    className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      filterRupturaStatus === 'resolvidas' ? 'bg-emerald-700 text-white' : 'text-emerald-700 hover:bg-emerald-100'
                    }`}
                  >
                    🟢 Resolvidas ({rupturasResolvidasFiltradasCount})
                  </button>
                  <button
                    onClick={() => setFilterRupturaStatus('all')}
                    className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      filterRupturaStatus === 'all' ? 'bg-[#222222] text-white' : 'text-[#5F5F5F] hover:text-[#171717]'
                    }`}
                  >
                    Todas no Filtro ({totalRupturasFiltradasContexto})
                  </button>
                </div>

                <div className="relative">
                  <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-[#737373] pointer-events-none">
                    search
                  </span>
                  <input
                    type="text"
                    value={searchRupturas}
                    onChange={(e) => setSearchRupturas(e.target.value)}
                    placeholder="Buscar rupturas por promotor, loja, produto..."
                    className="h-8 pl-8 pr-3 bg-white border border-[#CFCDC5] rounded-xl text-xs text-[#171717] focus:outline-none focus:border-purple-600 w-[240px] sm:w-[280px]"
                    aria-label="Buscar ocorrências de ruptura"
                  />
                  {searchRupturas && (
                    <button
                      onClick={() => setSearchRupturas('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[#737373] hover:text-[#171717] p-0.5 cursor-pointer"
                      title="Limpar busca"
                    >
                      <span className="material-symbols-outlined text-xs">close</span>
                    </button>
                  )}
                </div>
              </div>

              <DataTable<typeof rupturasFiltradas[0]>
                data={rupturasFiltradas}
                columns={rupturaColumns}
                keyExtractor={(r) => r.id}
                title="Rupturas Operacionais Registradas"
                titleIcon="report_problem"
                badgeCount={rupturasFiltradas.length}
                defaultPageSize={10}
                pageSizeOptions={[10, 25, 50]}
                onRowClick={(r) => {
                  setSelectedOccurrenceDetail({
                    id: r.id,
                    tipo: 'ruptura',
                    titulo: 'Ruptura Operacional',
                    descricao: r.descricao,
                    resolvido: r.resolvido,
                    data: r.createdAt || r.dataVisita,
                    lojaNome: r.lojaNome,
                    lojaCodigo: r.lojaCodigo,
                    lojaEndereco: r.visitObj?.loja?.endereco,
                    industriaNome: r.industriaNome,
                    industriaCodigo: r.industriaCodigo,
                    promotorNome: r.promotorNome,
                    promotorMatricula: r.promotorMatricula,
                    photoSignedUrl: r.photoSignedUrl,
                    visitObj: r.visitObj
                  });
                }}
                emptyTitle="Nenhuma ruptura encontrada nesta visualização"
                emptyMessage="Todas as ocorrências registradas estão tratadas ou fora dos filtros aplicados."
              />
            </div>
          );
        })()}

        {/* SUB-ABA: VALIDADES E VENCIMENTOS */}
        {ocorrenciasTab === 'validades' && (() => {
          const validadeColumns: Column<typeof validadesFiltradas[0]>[] = [
            {
              key: 'validade',
              header: 'VALIDADE',
              sortable: true,
              className: 'w-[120px] whitespace-nowrap',
              accessor: (val) => val.dataVencimento,
              render: (val) => {
                const [vYear, vMonth, vDay] = val.dataVencimento.split('-').map(Number);
                const vencDate = new Date(vYear, vMonth - 1, vDay);
                return (
                  <div>
                    <span className="font-bold text-[#171717]">{new Date(vencDate).toLocaleDateString('pt-BR')}</span>
                    <span className="text-[10px] text-[#77766F] block font-normal">
                      {val.diffDays < 0 ? `${Math.abs(val.diffDays)}d atrás` : `em ${val.diffDays}d`}
                    </span>
                  </div>
                );
              }
            },
            {
              key: 'produto',
              header: 'PRODUTO',
              sortable: true,
              className: 'min-w-[170px]',
              accessor: (val) => val.produtoNome,
              render: (val) => (
                <div>
                  <div className="font-semibold text-[#171717]">{val.produtoNome}</div>
                  {val.observacao && <span className="text-[10px] text-[#77766F] block font-normal">{val.observacao}</span>}
                </div>
              )
            },
            {
              key: 'quantidade',
              header: 'QTD.',
              sortable: true,
              className: 'w-[70px] text-right font-black text-[#171717]',
              accessor: (val) => val.quantidade
            },
            {
              key: 'loja',
              header: 'LOJA / PDV',
              sortable: true,
              className: 'min-w-[160px]',
              accessor: (val) => val.lojaNome,
              render: (val) => (
                <div>
                  <div className="font-semibold text-[#171717]">{val.lojaNome}</div>
                  <div className="text-[10px] text-[#737373] font-mono">Cód: {val.lojaCodigo}</div>
                </div>
              )
            },
            {
              key: 'industria',
              header: 'INDÚSTRIA',
              sortable: true,
              className: 'min-w-[130px]',
              accessor: (val) => val.industriaNome,
              render: (val) => (
                <span className="font-bold text-[#7E22CE]">{val.industriaNome}</span>
              )
            },
            {
              key: 'promotor',
              header: 'PROMOTOR',
              sortable: true,
              className: 'min-w-[140px]',
              accessor: (val) => val.promotorNome,
              render: (val) => (
                <div>
                  <div className="text-[#171717]">{val.promotorNome}</div>
                  <div className="text-[10px] text-[#737373] font-mono">Mat: {val.promotorMatricula}</div>
                </div>
              )
            },
            {
              key: 'lote',
              header: 'LOTE',
              className: 'w-[90px] text-[#77766F] text-xs',
              render: (val) => val.lote || '—'
            },
            {
              key: 'situacao',
              header: 'SITUAÇÃO',
              sortable: true,
              className: 'w-[120px] text-center whitespace-nowrap',
              accessor: (val) => val.categoria,
              render: (val) => {
                if (val.categoria === 'vencidos') return <StatusBadge status="critico" label="🔴 Vencido" />;
                if (val.categoria === 'ate3') return <StatusBadge status="critico" label="🚨 Até 3 dias" />;
                if (val.categoria === 'ate7') return <StatusBadge status="atencao" label="🟠 4–7 dias" />;
                if (val.categoria === 'ate30') return <StatusBadge status="pendente" label="🟡 8–30 dias" />;
                return <StatusBadge status="conforme" label="🟢 Normal" />;
              }
            },
            {
              key: 'acoes',
              header: 'AÇÕES',
              className: 'w-[90px] text-right whitespace-nowrap',
              render: (val) => val.visitObj ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedVisit(val.visitObj!);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] font-bold text-[10px] border border-[#CFCDC5] cursor-pointer transition-colors"
                  title="Ver ficha da visita com este registro de validade"
                >
                  Visita
                </button>
              ) : (
                <span className="text-[10px] text-[#77766F] italic">—</span>
              )
            }
          ];

          return (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <div
                  onClick={() => setFilterValidadeStatus(filterValidadeStatus === 'vencidos' ? 'all' : 'vencidos')}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                    filterValidadeStatus === 'vencidos' ? 'bg-rose-100 border-rose-400' : 'bg-white border-[#CFCDC5] hover:bg-[#F7F6F2]'
                  }`}
                >
                  <span className="text-[10px] text-rose-700 block font-bold uppercase">🔴 Vencidos</span>
                  <span className="text-xl font-black text-rose-800 mt-0.5 block">{validadeCountVencidos}</span>
                  <span className="text-[10px] text-[#77766F]">Ação imediata</span>
                </div>

                <div
                  onClick={() => setFilterValidadeStatus(filterValidadeStatus === 'ate3' ? 'all' : 'ate3')}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                    filterValidadeStatus === 'ate3' ? 'bg-rose-50 border-rose-400' : 'bg-white border-[#CFCDC5] hover:bg-[#F7F6F2]'
                  }`}
                >
                  <span className="text-[10px] text-rose-600 block font-bold uppercase">🚨 Até 3 dias</span>
                  <span className="text-xl font-black text-rose-700 mt-0.5 block">{validadeCountAte3}</span>
                  <span className="text-[10px] text-[#77766F]">Urgência crítica</span>
                </div>

                <div
                  onClick={() => setFilterValidadeStatus(filterValidadeStatus === 'ate7' ? 'all' : 'ate7')}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                    filterValidadeStatus === 'ate7' ? 'bg-amber-100 border-amber-400' : 'bg-white border-[#CFCDC5] hover:bg-[#F7F6F2]'
                  }`}
                >
                  <span className="text-[10px] text-amber-700 block font-bold uppercase">🟠 4–7 dias</span>
                  <span className="text-xl font-black text-amber-800 mt-0.5 block">{validadeCountAte7}</span>
                  <span className="text-[10px] text-[#77766F]">Atenção semanal</span>
                </div>

                <div
                  onClick={() => setFilterValidadeStatus(filterValidadeStatus === 'ate30' ? 'all' : 'ate30')}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                    filterValidadeStatus === 'ate30' ? 'bg-yellow-100 border-yellow-400' : 'bg-white border-[#CFCDC5] hover:bg-[#F7F6F2]'
                  }`}
                >
                  <span className="text-[10px] text-yellow-700 block font-bold uppercase">🟡 8–30 dias</span>
                  <span className="text-xl font-black text-yellow-800 mt-0.5 block">{validadeCountAte30}</span>
                  <span className="text-[10px] text-[#77766F]">Prevenção</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-[11px] text-[#77766F]">
                  Exibindo <strong>{validadesFiltradas.length}</strong> registro(s) de produto sob monitoramento
                </span>

                <div className="relative">
                  <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-[#737373] pointer-events-none">
                    search
                  </span>
                  <input
                    type="text"
                    value={searchValidades}
                    onChange={(e) => setSearchValidades(e.target.value)}
                    placeholder="Buscar produto, loja, promotor, lote..."
                    className="h-8 pl-8 pr-3 bg-white border border-[#CFCDC5] rounded-xl text-xs text-[#171717] focus:outline-none focus:border-purple-600 w-[240px] sm:w-[280px]"
                    aria-label="Buscar produtos por validade"
                  />
                  {searchValidades && (
                    <button
                      onClick={() => setSearchValidades('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[#737373] hover:text-[#171717] p-0.5 cursor-pointer"
                      title="Limpar busca"
                    >
                      <span className="material-symbols-outlined text-xs">close</span>
                    </button>
                  )}
                </div>
              </div>

              <DataTable<typeof validadesFiltradas[0]>
                data={validadesFiltradas}
                columns={validadeColumns}
                keyExtractor={(val) => val.id}
                title="Monitoramento de Validades e Vencimentos"
                titleIcon="inventory_2"
                badgeCount={validadesFiltradas.length}
                defaultPageSize={10}
                pageSizeOptions={[10, 25, 50]}
                onRowClick={(val) => {
                  if (val.visitObj) {
                    setSelectedVisit(val.visitObj);
                  }
                }}
                emptyTitle="Nenhum produto com problema de validade no filtro selecionado"
                emptyMessage="Todos os produtos monitorados estão dentro do prazo normal ou fora dos filtros aplicados."
              />
            </div>
          );
        })()}

        {/* SUB-ABA: INCIDENTES GERAIS */}
        {ocorrenciasTab === 'incidentes' && (
          <div className="space-y-3">
            {/* Cards de distribuição por tipo de ocorrência — com cores de alto contraste e SEM fundos pretos */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-300">
                <span className="text-[10px] text-rose-800 block font-bold uppercase">Rupturas</span>
                <span className="text-xl font-black text-rose-900 mt-0.5 block">{ocorrenciasPorTipo.ruptura}</span>
                <span className="text-[10px] text-rose-700">Falta na gôndola</span>
              </div>

              <div className="p-3 rounded-xl bg-amber-50 border border-amber-300">
                <span className="text-[10px] text-amber-800 block font-bold uppercase">Preço Divergente</span>
                <span className="text-xl font-black text-amber-900 mt-0.5 block">{ocorrenciasPorTipo.preco_divergente}</span>
                <span className="text-[10px] text-amber-700">Inconformidade</span>
              </div>

              <div className="p-3 rounded-xl bg-cyan-50 border border-cyan-300">
                <span className="text-[10px] text-cyan-800 block font-bold uppercase">Falta Espaço</span>
                <span className="text-xl font-black text-cyan-900 mt-0.5 block">{ocorrenciasPorTipo.falta_espaco}</span>
                <span className="text-[10px] text-cyan-700">Ponto de venda</span>
              </div>

              {/* Card "Outros" Corrigido: Fundo claro neutro e texto legível */}
              <div className="p-3 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5]">
                <span className="text-[10px] text-[#5F5F5F] block font-bold uppercase">Outros Incidentes</span>
                <span className="text-xl font-black text-[#171717] mt-0.5 block">{ocorrenciasPorTipo.outro}</span>
                <span className="text-[10px] text-[#77766F]">Diversos em campo</span>
              </div>
            </div>

            {/* Lista resumida das ocorrências */}
            {listaOcorrenciasCriticas.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-[#CFCDC5]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#171717] uppercase tracking-wider block">
                    Últimos Registros Detalhados ({listaOcorrenciasCriticas.length}):
                  </span>
                  <span className="text-[11px] text-[#77766F]">
                    Clique em um card para ver a ficha completa
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
                  {listaOcorrenciasCriticas.slice(0, 6).map((occ) => (
                    <div
                      key={occ.id}
                      onClick={() => {
                        setSelectedOccurrenceDetail({
                          id: occ.id,
                          tipo: occ.tipo,
                          titulo: `Incidente: ${occ.tipo.replace('_', ' ').toUpperCase()}`,
                          descricao: occ.descricao,
                          resolvido: Boolean(occ.resolvido),
                          data: occ.dataHora || occ.visitObj?.data_visita || '—',
                          lojaNome: occ.loja,
                          lojaCodigo: occ.visitObj?.loja_codigo,
                          lojaEndereco: occ.visitObj?.loja?.endereco,
                          industriaNome: occ.industria,
                          industriaCodigo: occ.visitObj?.industria_codigo,
                          promotorNome: occ.promotor,
                          promotorMatricula: occ.visitObj?.promotor_matricula,
                          photoSignedUrl: occ.visitObj?.id ? rupturePhotosSigned[occ.visitObj.id] : undefined,
                          visitObj: occ.visitObj
                        });
                      }}
                      className="p-3 rounded-xl bg-white border border-[#CFCDC5] hover:border-purple-400 hover:shadow-xs space-y-1.5 transition-all cursor-pointer group"
                    >
                      <div className="flex justify-between items-center text-[10px]">
                        <span className={`px-1.5 py-0.5 rounded font-bold uppercase border ${
                          occ.tipo === 'ruptura'
                            ? 'bg-rose-50 text-rose-800 border-rose-200'
                            : occ.tipo === 'preco_divergente'
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : occ.tipo === 'falta_espaco'
                            ? 'bg-cyan-50 text-cyan-800 border-cyan-200'
                            : 'bg-[#EAE8E2] text-[#5F5F5F] border-[#CFCDC5]'
                        }`}>
                          {occ.tipo.replace('_', ' ')}
                        </span>
                        {occ.dataHora && (
                          <span className="text-[#77766F]">
                            {new Date(occ.dataHora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                      <div className="font-bold text-[#171717] group-hover:text-purple-700 transition-colors truncate">
                        {occ.loja}
                      </div>
                      <div className="text-[11px] text-[#77766F] truncate">
                        <span className="text-[#7E22CE] font-bold">{occ.industria}</span> • {occ.promotor}
                      </div>
                      <p className="text-[11px] text-[#171717] leading-tight line-clamp-2">{occ.descricao}</p>
                      <div className="pt-1 flex items-center justify-between text-[10px] text-purple-700 font-bold border-t border-[#CFCDC5]/40">
                        <span>Ver Ficha Completa</span>
                        <span className="material-symbols-outlined text-xs">arrow_forward</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* SUB-ABA: VALIDACAO DE CHECKLIST */}
        {ocorrenciasTab === 'checklist' && (
          <div className="space-y-3">
            <div className="p-4 rounded-xl bg-white border border-[#CFCDC5] space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-[#171717] uppercase tracking-wider">
                    Conformidade Geral de Checklist
                  </h3>
                  <p className="text-[11px] text-[#77766F]">
                    Percentual de checagem dos itens operacionais obrigatórios nas visitas auditadas.
                  </p>
                </div>
                <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-300 font-black text-sm">
                  {checklistPerc}% Conclusão
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2.5 text-center">
                <div className="p-2.5 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5]">
                  <span className="text-[10px] text-[#77766F] block font-bold uppercase">Total Itens</span>
                  <span className="text-lg font-black text-[#171717]">{totalChecklistItems}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-300">
                  <span className="text-[10px] text-emerald-800 block font-bold uppercase">Concluídos</span>
                  <span className="text-lg font-black text-emerald-900">{totalChecklistChecked}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-300">
                  <span className="text-[10px] text-amber-800 block font-bold uppercase">Pendentes</span>
                  <span className="text-lg font-black text-amber-900">{totalChecklistItems - totalChecklistChecked}</span>
                </div>
              </div>

              <div className="w-full bg-[#EAE8E2] h-2.5 rounded-full overflow-hidden p-0.5 border border-[#CFCDC5]">
                <div
                  className="bg-emerald-600 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${checklistPerc}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ========================================================= */}
      {/* 5. LOJAS CRÍTICAS (RISCOS POR PDV)                        */}
      {/* ========================================================= */}
      <section className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl p-4 sm:p-5 shadow-sm space-y-3 font-mono">
        <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-2.5">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-rose-600 text-lg">storefront</span>
            <h3 className="text-sm font-black text-[#171717] tracking-tight">
              Lojas Críticas &amp; Riscos por PDV ({lojasCriticas.length})
            </h3>
          </div>
          <span className="text-[10px] text-[#77766F]">Consolidação de rupturas, vencimentos e visitas pendentes</span>
        </div>

        {lojasCriticas.length === 0 ? (
          <p className="text-emerald-700 font-bold text-center py-4 text-xs">
            Nenhuma loja com problemas operacionais críticos identificados no período!
          </p>
        ) : (
          <div className="overflow-x-auto max-h-[260px] overflow-y-auto rounded-xl border border-[#CFCDC5] bg-white">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-[#EAE8E2] border-b border-[#CFCDC5] text-[10px] text-[#77766F] uppercase font-bold tracking-wider">
                <tr>
                  <th className="py-2 px-3">Loja / PDV</th>
                  <th className="py-2 px-3 text-center">Rupturas</th>
                  <th className="py-2 px-3 text-center">Validades</th>
                  <th className="py-2 px-3 text-center">Não Realizadas</th>
                  <th className="py-2 px-3 text-center">Pendentes</th>
                  <th className="py-2 px-3 text-right">Total Eventos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#CFCDC5]/60 text-[#171717]">
                {lojasCriticas.slice(0, 10).map((s) => (
                  <tr key={s.codigo} className="hover:bg-[#F7F6F2] transition-colors">
                    <td className="py-1.5 px-3 font-semibold text-[#171717]">
                      {s.nome}
                      <span className="text-[10px] text-[#77766F] block font-normal">Cód: {s.codigo}</span>
                    </td>
                    <td className="py-1.5 px-3 text-center font-bold text-rose-700">
                      {s.rupturasAbertas > 0 ? `🔴 ${s.rupturasAbertas}` : '—'}
                    </td>
                    <td className="py-1.5 px-3 text-center font-bold text-amber-700">
                      {s.produtosVencidos > 0 ? `⏰ ${s.produtosVencidos}` : '—'}
                    </td>
                    <td className="py-1.5 px-3 text-center font-bold text-orange-700">
                      {s.visitasNaoRealizadas > 0 ? `⛔ ${s.visitasNaoRealizadas}` : '—'}
                    </td>
                    <td className="py-1.5 px-3 text-center font-bold text-yellow-700">
                      {s.visitasPendentes > 0 ? `🟡 ${s.visitasPendentes}` : '—'}
                    </td>
                    <td className="py-1.5 px-3 text-right font-black text-purple-700">
                      <span className="px-2 py-0.5 rounded bg-purple-50 border border-purple-200">
                        {s.totalProblemas} evento(s)
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ========================================================= */}
      {/* 6. PERFORMANCE DA OPERAÇÃO (PROMOTORES & INDÚSTRIAS)       */}
      {/* ========================================================= */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 font-mono text-xs">
        {/* Desempenho dos Promotores */}
        <div className="lg:col-span-2 p-4 rounded-2xl bg-[#F7F6F2] border border-[#CFCDC5] shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-2">
            <h3 className="text-xs font-black text-[#171717] uppercase tracking-wider flex items-center gap-1.5">
              <span className="material-symbols-outlined text-purple-600 text-sm">badge</span>
              Desempenho dos Promotores
            </h3>
            <span className="text-[10px] text-[#77766F]">Ordenado por pendências</span>
          </div>

          <div className="overflow-x-auto max-h-[280px] overflow-y-auto rounded-xl border border-[#CFCDC5] bg-white">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-[#EAE8E2] border-b border-[#CFCDC5] text-[10px] text-[#77766F] uppercase font-bold">
                <tr>
                  <th className="py-2 px-3">Promotor</th>
                  <th className="py-2 px-2 text-center">Plan.</th>
                  <th className="py-2 px-2 text-center">Conc.</th>
                  <th className="py-2 px-2 text-center">Andam.</th>
                  <th className="py-2 px-2 text-center">N.Real.</th>
                  <th className="py-2 px-2 text-center">Pend.</th>
                  <th className="py-2 px-3 text-right">Aderência</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#CFCDC5]/60 text-[#171717]">
                {rankingPromotores.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-[#77766F]">
                      Nenhum promotor com rota no período.
                    </td>
                  </tr>
                ) : (
                  rankingPromotores.map((p) => {
                    let badgeColor = 'bg-emerald-50 text-emerald-800 border-emerald-300';
                    if (p.taxa < 50) badgeColor = 'bg-rose-50 text-rose-800 border-rose-300';
                    else if (p.taxa <= 80) badgeColor = 'bg-yellow-50 text-yellow-900 border-yellow-300';

                    return (
                      <tr key={p.matricula} className="hover:bg-[#F7F6F2] transition-colors">
                        <td className="py-1.5 px-3 font-semibold text-[#171717]">
                          {p.nome}
                        </td>
                        <td className="py-1.5 px-2 text-center">{p.planejadas}</td>
                        <td className="py-1.5 px-2 text-center font-bold text-emerald-700">{p.concluidas}</td>
                        <td className="py-1.5 px-2 text-center text-blue-700">{p.emAndamento}</td>
                        <td className="py-1.5 px-2 text-center text-rose-700">{p.naoRealizadas}</td>
                        <td className="py-1.5 px-2 text-center text-amber-700 font-bold">{p.pendentes}</td>
                        <td className="py-1.5 px-3 text-right font-bold">
                          {systemSettings.mode !== 'OPERACAO_OFICIAL' || systemSettings.status !== 'loaded' ? (
                            <span className="text-[10px] text-[#77766F] font-normal">Pré-SLA</span>
                          ) : (
                            <span className={`px-2 py-0.5 rounded border text-[10px] ${badgeColor}`}>
                              {p.taxa}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Cobertura por Indústria */}
        <div className="p-4 rounded-2xl bg-[#F7F6F2] border border-[#CFCDC5] shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-2">
            <h3 className="text-xs font-black text-[#171717] uppercase tracking-wider flex items-center gap-1.5">
              <span className="material-symbols-outlined text-purple-600 text-sm">factory</span>
              Cobertura por Indústria
            </h3>
            <span className="text-[10px] text-[#7E22CE] font-bold">Top Indústrias</span>
          </div>

          <div className="overflow-x-auto max-h-[280px] overflow-y-auto rounded-xl border border-[#CFCDC5] bg-white">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-[#EAE8E2] border-b border-[#CFCDC5] text-[10px] text-[#77766F] uppercase font-bold">
                <tr>
                  <th className="py-2 px-2">Indústria</th>
                  <th className="py-2 px-2 text-center">Plan.</th>
                  <th className="py-2 px-2 text-center">Conc.</th>
                  <th className="py-2 px-2 text-right">Ocorr.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#CFCDC5]/60 text-[#171717]">
                {rankingIndustrias.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-[#77766F]">
                      Nenhuma indústria no período.
                    </td>
                  </tr>
                ) : (
                  rankingIndustrias.map((ind) => {
                    const perc = ind.planejadas > 0 ? Math.round((ind.concluidas / ind.planejadas) * 100) : 0;
                    return (
                      <tr key={ind.codigo} className="hover:bg-[#F7F6F2] transition-colors">
                        <td className="py-1.5 px-2 font-bold text-[#7E22CE]">
                          {ind.nome}
                        </td>
                        <td className="py-1.5 px-2 text-center">{ind.planejadas}</td>
                        <td className="py-1.5 px-2 text-center font-bold text-emerald-700">
                          {ind.concluidas} <span className="text-[9px] text-[#77766F]">({perc}%)</span>
                        </td>
                        <td className="py-1.5 px-2 text-right font-bold text-rose-700">
                          {ind.ocorrencias}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ========================================================= */}
      {/* 7. VISITAS REGISTRADAS EM CAMPO                           */}
      {/* ========================================================= */}
      {/* ========================================================= */}
      {/* 7. VISITAS REGISTRADAS EM CAMPO (DATATABLE MODERNO)       */}
      {/* ========================================================= */}
      {(() => {
        const visitColumns: Column<Visit>[] = [
          {
            key: 'data',
            header: 'DATA',
            sortable: true,
            className: 'w-[110px] whitespace-nowrap',
            accessor: (v) => v.data_visita,
            render: (v) => (
              <div>
                <span className="font-bold text-[#171717]">
                  {new Date(v.data_visita + 'T00:00:00').toLocaleDateString('pt-BR')}
                </span>
                <span className="text-[10px] text-[#737373] block font-mono">
                  {v.id.substring(0, 8)}
                </span>
              </div>
            )
          },
          {
            key: 'promotor',
            header: 'PROMOTOR',
            sortable: true,
            className: 'min-w-[170px]',
            accessor: (v) => v.promotor?.nome || v.promotor_matricula,
            render: (v) => (
              <div>
                <div className="font-bold text-[#171717]">{v.promotor?.nome || v.promotor_matricula}</div>
                <div className="text-[10px] text-[#737373] font-mono">Mat: {v.promotor_matricula}</div>
              </div>
            )
          },
          {
            key: 'loja',
            header: 'LOJA / PDV',
            sortable: true,
            className: 'min-w-[180px]',
            accessor: (v) => v.loja?.nome || v.loja_codigo,
            render: (v) => (
              <div>
                <div className="font-semibold text-[#171717]">{v.loja?.nome || v.loja_codigo}</div>
                <div className="text-[10px] text-[#737373] font-mono">
                  {v.loja?.cidade ? `${v.loja.cidade}${v.loja.uf ? ` - ${v.loja.uf}` : ''}` : `Cód: ${v.loja_codigo}`}
                </div>
              </div>
            )
          },
          {
            key: 'industria',
            header: 'INDÚSTRIA',
            sortable: true,
            className: 'min-w-[140px]',
            accessor: (v) => v.industria?.nome || v.industria_codigo,
            render: (v) => (
              <span className="font-bold text-[#7E22CE]">
                {v.industria?.nome || v.industria_codigo}
              </span>
            )
          },
          {
            key: 'horarios',
            header: 'HORÁRIO',
            sortable: true,
            className: 'w-[140px] whitespace-nowrap text-[11px]',
            accessor: (v) => v.started_at || '',
            render: (v) => (
              <div className="space-y-0.5 text-[#737373] font-mono">
                <div>Início: <strong className="text-[#171717]">{v.started_at ? new Date(v.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}</strong></div>
                <div>Fim: <strong className="text-[#171717]">{v.completed_at ? new Date(v.completed_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}</strong></div>
              </div>
            )
          },
          {
            key: 'status',
            header: 'SITUAÇÃO',
            sortable: true,
            className: 'w-[130px] text-center whitespace-nowrap',
            accessor: (v) => v.status,
            render: (v) => {
              if (v.status === 'concluida') return <StatusBadge status="concluida" label="CONCLUÍDA" />;
              if (v.status === 'em_andamento') return <StatusBadge status="em_andamento" label="EM ANDAMENTO" />;
              if (v.status === 'nao_realizada') return <StatusBadge status="falta" label="NÃO REALIZADA" />;
              return <StatusBadge status="pendente" label={v.status ? v.status.toUpperCase() : 'PENDENTE'} />;
            }
          },
          {
            key: 'evidencias',
            header: 'CHECKLIST / FOTOS',
            className: 'w-[130px] whitespace-nowrap text-[11px]',
            render: (v) => {
              const checklistOk = v.checklist_items?.filter((c) => c.checked).length || 0;
              const photosCount = v.photos?.length || 0;
              return (
                <div className="font-mono text-[#737373] space-y-0.5">
                  <div className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px] text-emerald-600">check_circle</span>
                    <span>{checklistOk} item(ns)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px] text-cyan-600">photo_camera</span>
                    <span>{photosCount} foto(s)</span>
                  </div>
                </div>
              );
            }
          },
          {
            key: 'acoes',
            header: 'AÇÕES',
            className: 'w-[80px] text-right whitespace-nowrap',
            render: (v) => (
              <button
                onClick={() => setSelectedVisit(v)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] font-bold text-xs transition-all active:scale-95 cursor-pointer shadow-2xs"
                title="Ver Ficha Completa da Visita"
                aria-label={`Ver detalhes da visita ${v.id.substring(0, 8)}`}
              >
                <span className="material-symbols-outlined text-[15px]">visibility</span>
                <span className="hidden sm:inline">Ficha</span>
              </button>
            )
          }
        ];

        return (
          <DataTable<Visit>
            data={filteredVisits}
            columns={visitColumns}
            keyExtractor={(v) => v.id}
            title="Acompanhamento Inteligente de Visitas"
            titleIcon="checklist"
            badgeCount={filteredVisits.length}
            defaultPageSize={10}
            pageSizeOptions={[10, 25, 50]}
            emptyTitle="Nenhuma visita encontrada"
            emptyMessage="Não há registros de visitas correspondentes aos filtros operacionais aplicados."
            headerActions={
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-[#737373] pointer-events-none">
                    search
                  </span>
                  <input
                    type="text"
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    placeholder="Buscar promotor, loja, indústria ou código..."
                    className="h-8 pl-8 pr-3 bg-white border border-[#CFCDC5] rounded-xl text-xs text-[#171717] focus:outline-none focus:border-purple-600 w-[240px] sm:w-[280px]"
                    aria-label="Buscar visitas"
                  />
                  {tableSearch && (
                    <button
                      onClick={() => setTableSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[#737373] hover:text-[#171717] p-0.5"
                      title="Limpar busca"
                    >
                      <span className="material-symbols-outlined text-xs">close</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <label htmlFor="filter-status-select" className="text-[11px] text-[#737373] font-mono uppercase hidden sm:inline">
                    Status:
                  </label>
                  <select
                    id="filter-status-select"
                    value={tableStatus}
                    onChange={(e) => setTableStatus(e.target.value)}
                    className="h-8 px-2.5 bg-white border border-[#CFCDC5] rounded-xl text-xs text-[#171717] focus:outline-none focus:border-purple-600 font-mono"
                    aria-label="Filtrar por status da visita"
                  >
                    <option value="all">Todos os Status</option>
                    <option value="em_andamento">Em Andamento</option>
                    <option value="concluida">Concluída</option>
                    <option value="nao_realizada">Não Realizada</option>
                    <option value="pendente">Pendente</option>
                  </select>
                </div>
              </div>
            }
          />
        );
      })()}

      {/* ========================================================= */}
      {/* MODAL DETALHE COMPLETO DA VISITA                         */}
      {/* ========================================================= */}
      {selectedVisit && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl max-w-2xl w-full p-5 shadow-2xl space-y-4 max-h-[88vh] overflow-y-auto font-mono">
            <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-purple-600 text-lg">assignment</span>
                <h3 className="text-sm font-black text-[#171717]">
                  Ficha da Visita ({selectedVisit.id.substring(0, 8)})
                </h3>
              </div>
              <button
                onClick={() => setSelectedVisit(null)}
                className="text-[#77766F] hover:text-[#171717] p-1 rounded-lg hover:bg-[#EAE8E2] cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-white border border-[#CFCDC5]">
                <span className="text-[#77766F] text-[10px] block font-bold">PROMOTOR:</span>
                <span className="text-[#171717] font-bold">{selectedVisit.promotor?.nome || selectedVisit.promotor_matricula}</span>
              </div>

              <div className="p-2.5 rounded-xl bg-white border border-[#CFCDC5]">
                <span className="text-[#77766F] text-[10px] block font-bold">LOJA / PDV:</span>
                <span className="text-[#171717] font-bold">{selectedVisit.loja?.nome || selectedVisit.loja_codigo}</span>
              </div>

              <div className="p-2.5 rounded-xl bg-white border border-[#CFCDC5]">
                <span className="text-[#77766F] text-[10px] block font-bold">INDÚSTRIA:</span>
                <span className="text-[#7E22CE] font-bold">{selectedVisit.industria?.nome || selectedVisit.industria_codigo}</span>
              </div>

              <div className="p-2.5 rounded-xl bg-white border border-[#CFCDC5]">
                <span className="text-[#77766F] text-[10px] block font-bold">STATUS DA VISITA:</span>
                <span className="text-emerald-700 font-bold uppercase">{selectedVisit.status}</span>
              </div>
            </div>

            {/* Rota Google Maps */}
            <div className="p-2.5 rounded-xl bg-white border border-[#CFCDC5] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="space-y-0.5">
                <span className="text-[#77766F] text-[10px] font-bold uppercase block">Destino da Loja:</span>
                <span className="text-[#171717] font-semibold">
                  {selectedVisit.loja?.nome || selectedVisit.loja_codigo}
                  {selectedVisit.loja?.endereco ? ` — ${selectedVisit.loja.endereco}` : ''}
                  {selectedVisit.loja?.cidade ? ` (${selectedVisit.loja.cidade}${selectedVisit.loja?.uf ? ` - ${selectedVisit.loja.uf}` : ''})` : ''}
                </span>
              </div>
              <div>
                {(() => {
                  const directionsUrl = buildGoogleMapsDirectionsUrl({
                    name: selectedVisit.loja?.nome || (selectedVisit.loja_codigo ? `Loja ${selectedVisit.loja_codigo}` : null),
                    address: selectedVisit.loja?.endereco,
                    city: selectedVisit.loja?.cidade,
                    uf: selectedVisit.loja?.uf
                  });

                  if (directionsUrl) {
                    return (
                      <a
                        href={directionsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs shadow-xs transition-all active:scale-95 shrink-0"
                      >
                        <span className="material-symbols-outlined text-sm">directions</span>
                        Google Maps
                      </a>
                    );
                  }

                  return (
                    <span className="text-[10px] text-[#77766F] italic">Endereço indisponível</span>
                  );
                })()}
              </div>
            </div>

            {/* Checklist */}
            {(() => {
              const items = selectedVisit.checklist_items || [];
              const currentChecklistItems = items.filter((item) => CHECKLIST_QUANTITY_KEYS.has(item.item_key));
              const legacyChecklistItems = items.filter((item) => !CHECKLIST_QUANTITY_KEYS.has(item.item_key));

              return (
                <div className="space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[#171717] font-bold uppercase flex items-center gap-1">
                      <span className="material-symbols-outlined text-emerald-600 text-sm">fact_check</span>
                      Checklist Operacional:
                    </span>
                    <span className="text-[10px] text-[#77766F]">Modelo Simplificado</span>
                  </div>

                  {currentChecklistItems.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {currentChecklistItems.map((item, idx) => (
                        <div key={idx} className="p-2.5 rounded-xl bg-white border border-emerald-300 flex flex-col justify-between space-y-1">
                          <span className="text-[#5F5F5F] text-[11px] block">{item.item_label}</span>
                          <div className="flex items-center justify-between pt-1 border-t border-[#CFCDC5]/50">
                            <span className="text-[10px] text-emerald-700 font-bold uppercase">Quantidade:</span>
                            <span className="text-sm font-black text-[#171717]">
                              {item.valor_texto && item.valor_texto.trim() !== '' ? item.valor_texto : '0'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-white border border-[#CFCDC5] text-[#77766F] italic text-center">
                      Nenhum item do checklist operacional atual preenchido.
                    </div>
                  )}

                  {legacyChecklistItems.length > 0 && (
                    <details className="p-2.5 rounded-xl bg-white border border-amber-300 text-xs">
                      <summary className="cursor-pointer font-bold text-amber-800 uppercase flex items-center justify-between">
                        <span>Checklist Histórico ({legacyChecklistItems.length})</span>
                        <span className="text-[10px] text-[#77766F] lowercase">expandir/recolher</span>
                      </summary>
                      <div className="space-y-1 pt-2">
                        {legacyChecklistItems.map((item, idx) => (
                          <div key={idx} className="p-1.5 rounded bg-[#F7F6F2] border border-[#CFCDC5] flex justify-between items-center text-[11px]">
                            <span className={item.checked ? 'text-emerald-700 font-bold' : 'text-[#77766F]'}>
                              {item.checked ? '✓' : '✗'} {item.item_label}
                            </span>
                            {item.valor_texto && <span className="text-[#7E22CE] font-bold">{item.valor_texto}</span>}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              );
            })()}

            {/* Ocorrências */}
            {selectedVisit.occurrences && selectedVisit.occurrences.length > 0 && (
              <div className="space-y-2 text-xs">
                <span className="text-rose-700 font-bold uppercase block flex items-center gap-1">
                  <span className="material-symbols-outlined text-rose-600 text-sm">report_problem</span>
                  Ocorrências Registradas ({selectedVisit.occurrences.length}):
                </span>
                <div className="space-y-1.5">
                  {selectedVisit.occurrences.map((occ, idx) => (
                    <div key={idx} className="p-2 rounded-xl bg-white border border-rose-300 flex justify-between items-center">
                      <div>
                        <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-800 text-[9px] font-bold uppercase mr-1.5 border border-rose-200">
                          {occ.tipo}
                        </span>
                        <strong className="text-xs text-[#171717]">{occ.descricao}</strong>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        occ.resolvido ? 'bg-emerald-50 text-emerald-800 border border-emerald-300' : 'bg-rose-50 text-rose-800 border border-rose-300'
                      }`}>
                        {occ.resolvido ? 'Resolvido' : 'Pendente'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Validades */}
            {selectedVisit.validity_items && selectedVisit.validity_items.length > 0 && (
              <div className="space-y-1.5 text-xs">
                <span className="text-amber-800 font-bold uppercase block">Controle de Validade ({selectedVisit.validity_items.length}):</span>
                {selectedVisit.validity_items.map((val, idx) => (
                  <div key={idx} className="p-2 rounded bg-white border border-[#CFCDC5] flex justify-between items-center text-[#171717]">
                    <div>
                      <strong>{val.produto_nome}</strong> (Qtd: {val.quantidade})
                      {val.lote && <span className="text-[#77766F] text-[10px] block">Lote: {val.lote}</span>}
                    </div>
                    <span className="text-amber-800 font-bold">
                      Venc: {new Date(val.data_vencimento).toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Fotos */}
            {selectedVisit.photos && selectedVisit.photos.length > 0 && (
              <div className="space-y-1.5 text-xs">
                <span className="text-cyan-800 font-bold uppercase block">Galeria de Fotos ({selectedVisit.photos.length}):</span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {selectedVisit.photos.map((p, idx) => (
                    <div key={idx} className="p-2 rounded bg-white border border-[#CFCDC5] space-y-1">
                      <span className="px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-800 text-[9px] font-bold block uppercase border border-cyan-200">
                        {p.tipo_foto}
                      </span>
                      <a
                        href={p.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-purple-700 text-[10px] underline block truncate font-bold"
                      >
                        Abrir Foto Privada
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedVisit.motivo_nao_realizada && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-300 text-xs text-rose-800">
                <strong>Motivo de Não Realização:</strong> {selectedVisit.motivo_nao_realizada}
              </div>
            )}

            <div className="pt-2 border-t border-[#CFCDC5] flex justify-end">
              <button
                onClick={() => setSelectedVisit(null)}
                className="px-4 py-1.5 rounded-xl bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] text-xs font-bold cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL DETALHES DA PENDÊNCIA OPERACIONAL                   */}
      {/* ========================================================= */}
      {selectedPendingItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 font-mono">
            <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-2.5">
              <h3 className="text-sm font-black text-[#171717] flex items-center gap-1.5">
                <span className="material-symbols-outlined text-purple-600">pending_actions</span>
                VISITA PENDENTE — DETALHES
              </h3>
              <button onClick={() => setSelectedPendingItem(null)} className="text-[#77766F] hover:text-[#171717] p-1 rounded-lg">
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="p-2 rounded-lg bg-white border border-[#CFCDC5]">
                <span className="text-[#77766F] text-[10px] block font-bold">PROMOTOR:</span>
                <span className="text-[#171717] font-bold text-sm">{selectedPendingItem.promotorNome}</span>
                <span className="text-[10px] text-[#77766F] block">Matrícula: {selectedPendingItem.promotorMatricula}</span>
              </div>
              <div className="p-2 rounded-lg bg-white border border-[#CFCDC5]">
                <span className="text-[#77766F] text-[10px] block font-bold">LOJA / PDV:</span>
                <span className="text-[#171717] font-bold">{selectedPendingItem.lojaNome}</span>
                {selectedPendingItem.lojaCidade && (
                  <span className="text-[10px] text-[#77766F] block">{selectedPendingItem.lojaCidade} - {selectedPendingItem.lojaUf}</span>
                )}
              </div>
              <div className="p-2 rounded-lg bg-white border border-[#CFCDC5]">
                <span className="text-[#77766F] text-[10px] block font-bold">INDÚSTRIA:</span>
                <span className="text-[#7E22CE] font-bold">{selectedPendingItem.industriaNome}</span>
              </div>
              <div className="p-2 rounded-lg bg-white border border-[#CFCDC5]">
                <span className="text-[#77766F] text-[10px] block font-bold">DATA PREVISTA / FREQUÊNCIA:</span>
                <span className="text-[#171717] font-bold">{selectedPendingItem.dataStr} ({selectedPendingItem.dayOfWeekLabel}) • {selectedPendingItem.frequencia}</span>
              </div>
              <div className="p-2 rounded-lg bg-white border border-[#CFCDC5]">
                <span className="text-[#77766F] text-[10px] block font-bold">SITUAÇÃO ATUAL:</span>
                <span className="font-black text-rose-700 uppercase">
                  {selectedPendingItem.isPastOverdue ? '🚨 Pendente (Atrasada)' : selectedPendingItem.status}
                </span>
              </div>
              {selectedPendingItem.motivoNaoRealizada && (
                <div className="p-2 rounded-lg bg-rose-50 border border-rose-300 text-rose-800">
                  <span className="text-[10px] font-bold uppercase block">Motivo Informado:</span>
                  <span>{selectedPendingItem.motivoNaoRealizada}</span>
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-[#CFCDC5] flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={() => setSelectedPendingItem(null)}
                className="px-3.5 py-1.5 rounded-xl bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] text-xs font-bold cursor-pointer"
              >
                Fechar
              </button>
              {(() => {
                const pendingDirectionsUrl = buildGoogleMapsDirectionsUrl({
                  name: selectedPendingItem.lojaNome || (selectedPendingItem.lojaCodigo ? `Loja ${selectedPendingItem.lojaCodigo}` : null),
                  city: selectedPendingItem.lojaCidade,
                  uf: selectedPendingItem.lojaUf
                });

                if (pendingDirectionsUrl) {
                  return (
                    <a
                      href={pendingDirectionsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3.5 py-1.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs flex items-center gap-1 shadow-xs cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-sm">directions</span>
                      Google Maps
                    </a>
                  );
                }
                return null;
              })()}
              <button
                onClick={() => {
                  setSelectedPendingItem(null);
                  setFilterPromotor(selectedPendingItem.promotorMatricula);
                  setFilterLoja(selectedPendingItem.lojaCodigo);
                }}
                className="px-3.5 py-1.5 rounded-xl bg-[#222222] hover:bg-black text-white font-bold text-xs flex items-center gap-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">filter_alt</span>
                Filtrar no Painel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL DE CONFIRMAÇÃO DE RESOLUÇÃO (ONDA 4.4B)              */}
      {/* ========================================================= */}
      {occurrenceToResolve && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 font-mono">
            <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-700 text-xl">task_alt</span>
                <h3 className="text-sm font-black text-[#171717]">
                  CONFIRMAR RESOLUÇÃO
                </h3>
              </div>
              <button
                onClick={() => setOccurrenceToResolve(null)}
                className="text-[#77766F] hover:text-[#171717] p-1 rounded-lg hover:bg-[#EAE8E2] cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 leading-relaxed font-sans">
                <strong>Atenção:</strong> Você está prestes a marcar esta ocorrência como <strong>RESOLVIDA</strong>.
                Esta ação atualizará o status operacional no Supabase e informará os supervisores.
              </div>

              <div className="p-2.5 rounded-xl bg-white border border-[#CFCDC5] space-y-1">
                <span className="text-[10px] text-[#77766F] block font-bold uppercase">Item:</span>
                <span className="text-[#171717] font-bold block">{occurrenceToResolve.titulo}</span>
                <span className="text-[11px] text-[#7E22CE] font-semibold block">{occurrenceToResolve.lojaNome}</span>
                {occurrenceToResolve.descricao && (
                  <p className="text-[11px] text-[#171717] pt-1 border-t border-[#CFCDC5]/50 leading-tight">
                    {occurrenceToResolve.descricao}
                  </p>
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-[#CFCDC5] flex items-center justify-end gap-2">
              <button
                onClick={() => setOccurrenceToResolve(null)}
                disabled={resolvingId === occurrenceToResolve.id}
                className="px-4 py-2 rounded-xl bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] text-xs font-bold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleResolveRupture(occurrenceToResolve.id)}
                disabled={resolvingId === occurrenceToResolve.id}
                className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm cursor-pointer transition-colors"
              >
                {resolvingId === occurrenceToResolve.id ? (
                  <>
                    <span className="material-symbols-outlined text-sm animate-spin">refresh</span>
                    Salvando...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm">check</span>
                    Sim, Marcar Resolvida
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL DETALHES RICOS DA OCORRÊNCIA (ONDA 4.4B)            */}
      {/* ========================================================= */}
      {selectedOccurrenceDetail && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl max-w-lg w-full p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto font-mono">
            {/* Cabeçalho */}
            <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-rose-600 text-xl">report_problem</span>
                <div>
                  <h3 className="text-sm font-black text-[#171717]">
                    FICHA DA OCORRÊNCIA
                  </h3>
                  <span className="text-[10px] text-[#77766F] font-mono">
                    ID: {selectedOccurrenceDetail.id.substring(0, 12)}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedOccurrenceDetail(null)}
                className="text-[#77766F] hover:text-[#171717] p-1 rounded-lg hover:bg-[#EAE8E2] cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* Status e Identificação */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-white border border-[#CFCDC5]">
                <span className="text-[#77766F] text-[10px] block font-bold uppercase">SITUAÇÃO:</span>
                <div className="mt-1">
                  {selectedOccurrenceDetail.resolvido ? (
                    <StatusBadge status="concluida" label="RESOLVIDA" />
                  ) : (
                    <StatusBadge status="critico" label="EM ABERTO" />
                  )}
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-white border border-[#CFCDC5]">
                <span className="text-[#77766F] text-[10px] block font-bold uppercase">TIPO:</span>
                <span className="font-bold text-[#171717] text-sm uppercase block mt-1">
                  {selectedOccurrenceDetail.tipo.replace('_', ' ')}
                </span>
              </div>
            </div>

            {/* Detalhes do Local e Agentes */}
            <div className="space-y-2 text-xs">
              <div className="p-2.5 rounded-xl bg-white border border-[#CFCDC5]">
                <span className="text-[#77766F] text-[10px] block font-bold uppercase">LOJA / PDV:</span>
                <span className="text-[#171717] font-bold text-sm block">{selectedOccurrenceDetail.lojaNome}</span>
                {selectedOccurrenceDetail.lojaCodigo && (
                  <span className="text-[10px] text-[#77766F] block font-mono">Código: {selectedOccurrenceDetail.lojaCodigo}</span>
                )}
                {selectedOccurrenceDetail.lojaEndereco && (
                  <span className="text-[10px] text-[#77766F] block font-sans">{selectedOccurrenceDetail.lojaEndereco}</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="p-2.5 rounded-xl bg-white border border-[#CFCDC5]">
                  <span className="text-[#77766F] text-[10px] block font-bold uppercase">INDÚSTRIA:</span>
                  <span className="text-[#7E22CE] font-bold block">{selectedOccurrenceDetail.industriaNome}</span>
                  {selectedOccurrenceDetail.industriaCodigo && (
                    <span className="text-[10px] text-[#77766F] block font-mono">Cód: {selectedOccurrenceDetail.industriaCodigo}</span>
                  )}
                </div>

                <div className="p-2.5 rounded-xl bg-white border border-[#CFCDC5]">
                  <span className="text-[#77766F] text-[10px] block font-bold uppercase">PROMOTOR RESPONSÁVEL:</span>
                  <span className="text-[#171717] font-bold block">{selectedOccurrenceDetail.promotorNome}</span>
                  {selectedOccurrenceDetail.promotorMatricula && (
                    <span className="text-[10px] text-[#77766F] block font-mono">Matrícula: {selectedOccurrenceDetail.promotorMatricula}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Descrição Detalhada */}
            <div className="p-3 rounded-xl bg-white border border-[#CFCDC5] space-y-1 text-xs">
              <span className="text-[#77766F] text-[10px] block font-bold uppercase">DESCRIÇÃO REGISTRADA:</span>
              <p className="text-[#171717] leading-relaxed font-sans">{selectedOccurrenceDetail.descricao}</p>
            </div>

            {/* Evidência Fotográfica Segura */}
            <div className="p-3 rounded-xl bg-white border border-[#CFCDC5] space-y-2 text-xs">
              <span className="text-[#77766F] text-[10px] block font-bold uppercase flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">photo_camera</span>
                EVIDÊNCIA FOTOGRÁFICA REGISTRADA:
              </span>
              {selectedOccurrenceDetail.photoSignedUrl ? (
                <div className="space-y-2">
                  <div className="rounded-xl overflow-hidden border border-[#CFCDC5] bg-black/5 max-h-48 flex items-center justify-center">
                    <img
                      src={selectedOccurrenceDetail.photoSignedUrl}
                      alt="Evidência da Ocorrência"
                      className="max-h-48 object-contain w-full"
                    />
                  </div>
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-emerald-700 font-bold flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs">verified</span>
                      URL Assinada Segura (1h de validade)
                    </span>
                    <a
                      href={selectedOccurrenceDetail.photoSignedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-purple-700 underline font-bold"
                    >
                      Abrir em Alta Resolução
                    </a>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-[#F7F6F2] border border-[#CFCDC5] text-center text-[#77766F] italic">
                  Nenhuma foto anexada a esta ocorrência ou permissão de acesso restrita.
                </div>
              )}
            </div>

            {/* Histórico Factual Auditável */}
            <div className="p-2.5 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] space-y-1 text-[11px]">
              <span className="text-[#77766F] text-[10px] block font-bold uppercase">HISTÓRICO FACTUAL:</span>
              <div className="flex items-center justify-between text-[#171717]">
                <span>Data do Registro:</span>
                <strong>{new Date(selectedOccurrenceDetail.data).toLocaleString('pt-BR')}</strong>
              </div>
              {selectedOccurrenceDetail.visitObj && (
                <div className="flex items-center justify-between text-[#171717]">
                  <span>Visita Vinculada:</span>
                  <span className="font-mono text-[10px]">ID {selectedOccurrenceDetail.visitObj.id.substring(0, 8)}</span>
                </div>
              )}
            </div>

            {/* Ações Autorizadas */}
            <div className="pt-2 border-t border-[#CFCDC5] flex flex-wrap items-center justify-between gap-2">
              <button
                onClick={() => setSelectedOccurrenceDetail(null)}
                className="px-3.5 py-1.5 rounded-xl bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] text-xs font-bold cursor-pointer"
              >
                Fechar
              </button>

              <div className="flex items-center gap-2">
                {selectedOccurrenceDetail.visitObj && (
                  <button
                    onClick={() => {
                      const v = selectedOccurrenceDetail.visitObj!;
                      setSelectedOccurrenceDetail(null);
                      setSelectedVisit(v);
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] text-xs font-bold cursor-pointer"
                  >
                    Ver Ficha da Visita
                  </button>
                )}

                {!selectedOccurrenceDetail.resolvido && canResolve && (
                  <button
                    onClick={() => {
                      const target = {
                        id: selectedOccurrenceDetail.id,
                        titulo: selectedOccurrenceDetail.titulo,
                        lojaNome: selectedOccurrenceDetail.lojaNome,
                        descricao: selectedOccurrenceDetail.descricao
                      };
                      setOccurrenceToResolve(target);
                    }}
                    className="px-4 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs flex items-center gap-1 shadow-xs cursor-pointer transition-colors"
                  >
                    <span className="material-symbols-outlined text-sm">check_circle</span>
                    Marcar como Resolvida
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
