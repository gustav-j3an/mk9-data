import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ScreenId, ToastMessage, Visit, RouteItem, VisitPhoto, SystemSettingsState } from '../types';
import { supabase } from '../lib/supabase';
import { fetchSystemSettings } from '../lib/systemSettings';
import { useAuth } from '../auth/AuthProvider';
import { equipesService } from '../lib/equipesService';
import { supervisoresService } from '../lib/supervisoresService';
import { buildGoogleMapsDirectionsUrl } from '../utils/googleMaps';
import {
  calculateOperationalVisits,
  getLocalDateString,
  OperationalVisitItem,
  DayOfWeekDate
} from '../utils/routePlanner';
import { ShareWhatsAppModal } from '../components/ShareWhatsAppModal';
import { isWhatsAppShareableVisit } from '../utils/whatsappShare';
import { canManageOldOpenVisits, filterOldOpenVisits, getAdministrativeResolutionLabel, getVisitDurationLabel, getVisitResolutionCounts } from '../utils/oldOpenVisitManagement';
import { isRegularizationReasonValid, regularizeOldOpenVisit, VISIT_REGULARIZATION_BACKEND_VERIFIED, type VisitRegularizationAction } from '../lib/visitRegularizationService';
import { filterPromoterDailySummaries, paginateVisits, sortVisitsForDisplay, type VisitPageSize } from '../utils/visitsTrackingPresentation';
import { parseVisitsTrackingQuery, updateVisitsTrackingQuery } from './visitsTrackingQuery';

interface VisitsTrackingViewProps {
  onNavigate: (screen: ScreenId) => void;
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const VisitsTrackingView: React.FC<VisitsTrackingViewProps> = ({
  onNavigate,
  onShowToast
}) => {
  const { profile, role } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = parseVisitsTrackingQuery(searchParams);

  // Escopo de Supervisor:
  // Para admin e gestor, preserva visualização global ('all').
  // Para os demais usuários, localiza o supervisor autenticado de forma inequívoca por user_id ou e-mail normalizado.
  const isGlobalManager = role === 'admin' || role === 'gestor';
  const hasInitializedSupervisorFilterRef = useRef(false);

  // 1. Estados de Data Operacional
  const [selectedDate, setSelectedDate] = useState<string>(() => initialQuery.date || getLocalDateString(new Date()));

  // 2. Estados de Carregamento e Dados
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncText, setLastSyncText] = useState('—');

  // Entidades Brutas
  const [visits, setVisits] = useState<Visit[]>([]);
  const [oldOpenVisits, setOldOpenVisits] = useState<Visit[]>([]);
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [promotoresList, setPromotoresList] = useState<any[]>([]);
  const [industriasList, setIndustriasList] = useState<any[]>([]);
  const [equipesList, setEquipesList] = useState<any[]>([]);
  const [supervisoresList, setSupervisoresList] = useState<any[]>([]);

  // Configurações do Sistema
  const [systemSettings, setSystemSettings] = useState<SystemSettingsState>({
    mode: 'IMPLANTACAO',
    officialStartDate: null,
    status: 'loading',
    error: null
  });

  // 3. Filtros
  const [filterSupervisor, setFilterSupervisor] = useState<string>(() => initialQuery.supervisor || 'all');
  const [filterEquipe, setFilterEquipe] = useState<string>(() => initialQuery.team || 'all');
  const [filterPromotor, setFilterPromotor] = useState<string>(() => initialQuery.promoter || 'all');
  const [filterLoja, setFilterLoja] = useState<string>(() => initialQuery.store || 'all');
  const [filterIndustria, setFilterIndustria] = useState<string>(() => initialQuery.industry || 'all');
  const [filterStatus, setFilterStatus] = useState<string>(() => initialQuery.status || 'all');
  const [filterOcorrencia, setFilterOcorrencia] = useState<string>(() => initialQuery.occurrence || 'all');
  const [searchQuery, setSearchQuery] = useState(() => initialQuery.search || '');
  const [visitPage, setVisitPage] = useState(() => initialQuery.page || 1);
  const [visitPageSize, setVisitPageSize] = useState<VisitPageSize>(() => initialQuery.pageSize || 15);
  const [summarySearch, setSummarySearch] = useState('');
  const [summaryOnlyPending, setSummaryOnlyPending] = useState(false);

  // 4. Modal / Drawer de Detalhes da Visita (Somente Leitura)
  const [selectedVisitItem, setSelectedVisitItem] = useState<OperationalVisitItem | null>(null);
  const [signedPhotoUrls, setSignedPhotoUrls] = useState<Record<string, string>>({});
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [zoomedPhotoUrl, setZoomedPhotoUrl] = useState<string | null>(null);
  const [shareWhatsAppVisit, setShareWhatsAppVisit] = useState<Visit | null>(null);
  const [regularizationVisit, setRegularizationVisit] = useState<Visit | null>(null);
  const [regularizationAction, setRegularizationAction] = useState<VisitRegularizationAction>('closed_without_execution_proof');
  const [regularizationReason, setRegularizationReason] = useState('');
  const [regularizingVisit, setRegularizingVisit] = useState(false);
  const [visitRegularizationHistory, setVisitRegularizationHistory] = useState<any[]>([]);
  const [oldFilterPromoter, setOldFilterPromoter] = useState('all');
  const [oldFilterStore, setOldFilterStore] = useState('all');
  const [oldFilterIndustry, setOldFilterIndustry] = useState('all');
  const [oldFilterFrom, setOldFilterFrom] = useState('');
  const [oldFilterTo, setOldFilterTo] = useState('');

  // Controle de concorrência e identificador sequencial de requisição
  const reqSeqRef = useRef<number>(0);
  const isFetchingRef = useRef<boolean>(false);
  const didInitializeVisitFiltersRef = useRef(false);

  // 5. Carga de Dados do Supabase com Paginação Segura de Rotas e Proteção de Concorrência
  const loadTrackingData = useCallback(async (isSilent = false) => {
    // Para auto-refresh silencioso em segundo plano: ignora se já houver uma busca em andamento
    if (isSilent && isFetchingRef.current) {
      return;
    }

    isFetchingRef.current = true;
    const currentSeq = ++reqSeqRef.current;

    if (!isSilent) {
      setLoading(true);
    }
    setError(null);

    if (!supabase) {
      if (currentSeq === reqSeqRef.current) {
        setError('Cliente Supabase não inicializado.');
        isFetchingRef.current = false;
        setLoading(false);
      }
      return;
    }

    try {
      // visits: busca apenas do dia operacional selecionado
      const visitsPromise = supabase
        .from('visits')
        .select(`
          *,
          promotor:promotores(matricula, nome, equipe, supervisor),
          loja:lojas(codigo, nome, cidade, uf, endereco),
          industria:industrias(codigo, nome),
          checklist_items:visit_checklist_items(*),
          photos:visit_photos(*),
          occurrences:visit_occurrences(*),
          validity_items:visit_product_validity(*)
        `)
        .eq('data_visita', selectedDate)
        .order('created_at', { ascending: false });

      // Consulta separada da grade do dia: fila administrativa de visitas antigas ainda abertas.
      // As políticas RLS continuam determinando quais promotores cada perfil pode consultar.
      const oldOpenVisitsPromise = canManageOldOpenVisits(role) ? supabase
        .from('visits')
        .select(`
          *,
          promotor:promotores(matricula, nome, equipe, supervisor),
          loja:lojas(codigo, nome, cidade, uf),
          industria:industrias(codigo, nome),
          checklist_items:visit_checklist_items(*),
          photos:visit_photos(*),
          occurrences:visit_occurrences(*),
          validity_items:visit_product_validity(*)
        `)
        .lt('data_visita', getLocalDateString(new Date()))
        .eq('status', 'em_andamento')
        .order('data_visita', { ascending: true }) : Promise.resolve({ data: [], error: null });

      // rotas: busca com paginação defensiva por lotes de 1.000 registros
      const fetchAllRoutes = async (): Promise<RouteItem[]> => {
        const allRoutes: RouteItem[] = [];
        const PAGE_SIZE = 1000;
        let page = 0;
        let hasMore = true;

        while (hasMore) {
          const from = page * PAGE_SIZE;
          const to = from + PAGE_SIZE - 1;

          const { data, error: rErr } = await supabase!
            .from('rotas')
            .select(`
              *,
              industria:industrias(codigo, nome),
              loja:lojas(codigo, nome, cidade, uf),
              promotor:promotores(matricula, nome, equipe, supervisor)
            `)
            .range(from, to);

          if (rErr) throw rErr;

          if (data && data.length > 0) {
            allRoutes.push(...(data as unknown as RouteItem[]));
            if (data.length < PAGE_SIZE) {
              hasMore = false;
            } else {
              page++;
            }
          } else {
            hasMore = false;
          }
        }

        return allRoutes.filter((r) => !r.encerrada_em);
      };

      const promotoresPromise = supabase.from('promotores').select('*');
      const industriasPromise = supabase.from('industrias').select('*');
      const settingsPromise = fetchSystemSettings();
      const equipesPromise = equipesService.listEquipes();
      const supervisoresPromise = supervisoresService.listSupervisores();

      const [
        visitsRes,
        oldOpenVisitsRes,
        allRoutesData,
        promotoresRes,
        industriasRes,
        settingsData,
        equipesRes,
        supervisoresRes
      ] = await Promise.all([
        visitsPromise,
        oldOpenVisitsPromise,
        fetchAllRoutes(),
        promotoresPromise,
        industriasPromise,
        settingsPromise,
        equipesPromise,
        supervisoresPromise
      ]);

      if (visitsRes.error) throw visitsRes.error;
      if (oldOpenVisitsRes.error) throw oldOpenVisitsRes.error;

      // Descarta resposta se uma requisição mais recente já foi iniciada
      if (currentSeq !== reqSeqRef.current) return;

      setVisits((visitsRes.data as unknown as Visit[]) || []);
      setOldOpenVisits((oldOpenVisitsRes.data as unknown as Visit[]) || []);
      setRoutes(allRoutesData || []);
      setPromotoresList(promotoresRes.data || []);
      setIndustriasList(industriasRes.data || []);
      setSystemSettings(settingsData);
      setEquipesList(equipesRes.data || []);
      setSupervisoresList(supervisoresRes.data || []);

      setLastSyncText(
        new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
    } catch (err: any) {
      if (currentSeq === reqSeqRef.current) {
        console.error('Erro ao carregar telemetria de visitas:', err);
        setError(err?.message || 'Falha ao consultar visitas no Supabase.');
      }
    } finally {
      // Libera o estado de carregamento e o semáforo de auto-refresh apenas se esta requisição ainda for a mais recente
      if (currentSeq === reqSeqRef.current) {
        isFetchingRef.current = false;
        setLoading(false);
      }
    }
  }, [selectedDate, role]);

  // Carga inicial e agendamento de atualização periódica a cada 60 segundos
  useEffect(() => {
    // 1. Carga imediata
    loadTrackingData(false);

    // 2. Intervalo a cada 60 segundos
    const intervalId = window.setInterval(() => {
      loadTrackingData(true);
    }, 60000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadTrackingData]);

  // 5.1 Inicialização segura do escopo padrão para supervisor autenticado
  useEffect(() => {
    // Gestores globais (admin e gestor) sempre iniciam com visualização irrestrita ('all')
    if (isGlobalManager) return;

    // Executa apenas uma vez na primeira carga para não sobrescrever filtros manuais do usuário
    if (hasInitializedSupervisorFilterRef.current) return;
    if (!supervisoresList || supervisoresList.length === 0 || !profile) return;

    const userAuthId = profile.id;
    const userAuthEmail = (profile.email || '').trim().toLowerCase();

    // 1. Prioridade máxima: correspondência por user_id vinculado na tabela public.supervisores
    let matchedSupervisor = supervisoresList.find(
      (s) => s.user_id && s.user_id === userAuthId
    );

    // 2. Alternativa segura: correspondência por e-mail normalizado único
    if (!matchedSupervisor && userAuthEmail) {
      matchedSupervisor = supervisoresList.find(
        (s) => s.email && s.email.trim().toLowerCase() === userAuthEmail
      );
    }

    if (matchedSupervisor && matchedSupervisor.nome) {
      setFilterSupervisor(matchedSupervisor.nome);
      hasInitializedSupervisorFilterRef.current = true;
    }
  }, [isGlobalManager, supervisoresList, profile]);

  // 6. Geração de URLs Assinadas Sob Demanda para a Visita Selecionada
  useEffect(() => {
    if (!selectedVisitItem?.visitObj?.photos || selectedVisitItem.visitObj.photos.length === 0) {
      setSignedPhotoUrls({});
      return;
    }

    const photos = selectedVisitItem.visitObj.photos;
    let isCancelled = false;
    setLoadingPhotos(true);

    const generateSignedUrls = async () => {
      const urlMap: Record<string, string> = {};
      for (const photo of photos) {
        if (photo.storage_path && supabase) {
          try {
            const { data } = await supabase.storage
              .from('visit-photos')
              .createSignedUrl(photo.storage_path, 3600);
            if (data?.signedUrl) {
              urlMap[photo.id || photo.storage_path] = data.signedUrl;
            }
          } catch (err) {
            console.warn('Erro ao gerar signed URL para foto:', err);
          }
        }
      }
      if (!isCancelled) {
        setSignedPhotoUrls(urlMap);
        setLoadingPhotos(false);
      }
    };

    generateSignedUrls();

    return () => {
      isCancelled = true;
    };
  }, [selectedVisitItem]);

  useEffect(() => {
    const visitId = selectedVisitItem?.visitObj?.regularization_status
      ? selectedVisitItem.visitObj.id
      : null;
    if (!visitId || !supabase || !canManageOldOpenVisits(role)) {
      setVisitRegularizationHistory([]);
      return;
    }
    let cancelled = false;
    supabase.from('visit_regularization_audit').select('*').eq('visit_id', visitId)
      .order('acted_at', { ascending: false }).then(({ data, error: auditError }) => {
        if (!cancelled) setVisitRegularizationHistory(auditError ? [] : data || []);
      });
    return () => { cancelled = true; };
  }, [selectedVisitItem, role]);

  // 7. Cálculo das Visitas Operacionais do Dia via routePlanner (calculateOperationalVisits)
  // Constrói o daysRange exclusivo para o dia selecionado
  const operationalVisits = useMemo(() => {
    const parts = selectedDate.split('-');
    if (parts.length !== 3) return [];

    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const d = new Date(year, month, day);

    const dayKeys: Array<DayOfWeekDate['dayKey']> = [
      'domingo',
      'segunda',
      'terca',
      'quarta',
      'quinta',
      'sexta',
      'sabado'
    ];
    const dayLabels = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const dayShorts = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

    const dayIdx = d.getDay();
    const todayStr = getLocalDateString(new Date());

    const singleDayRange: DayOfWeekDate[] = [
      {
        dateStr: selectedDate,
        dayKey: dayKeys[dayIdx],
        dayLabel: dayLabels[dayIdx],
        dayShort: dayShorts[dayIdx],
        isToday: selectedDate === todayStr,
        isPast: selectedDate < todayStr,
        isFuture: selectedDate > todayStr
      }
    ];

    return calculateOperationalVisits({
      routes,
      visits,
      promotoresList,
      industriasList,
      daysRange: singleDayRange,
      todayStr,
      operationMode: systemSettings.mode,
      officialStartDate: systemSettings.officialStartDate
    });
  }, [selectedDate, routes, visits, promotoresList, industriasList, systemSettings]);

  // Mapeamento Promotor -> Equipe e Supervisor
  const promoterMetaMap = useMemo(() => {
    const map = new Map<string, { equipe?: string; supervisor?: string; nome: string }>();
    promotoresList.forEach((p) => {
      map.set(p.matricula, {
        nome: p.nome,
        equipe: p.equipe || undefined,
        supervisor: p.supervisor || undefined
      });
    });
    return map;
  }, [promotoresList]);

  // Enriquecer cada OperationalVisitItem com Equipe e Supervisor
  const enrichedVisits = useMemo(() => {
    return operationalVisits.map((item) => {
      const meta = promoterMetaMap.get(item.promotorMatricula);
      // Se não houver no mapa, tenta pegar do objeto visitObj ou da rota associada
      const supervisor =
        meta?.supervisor ||
        item.visitObj?.promotor && (item.visitObj.promotor as any).supervisor ||
        'Não informado';
      const equipe =
        meta?.equipe ||
        item.visitObj?.promotor && (item.visitObj.promotor as any).equipe ||
        'Geral';

      const hasOccurrences = Boolean(
        item.visitObj?.occurrences && item.visitObj.occurrences.length > 0
      );

      return {
        ...item,
        supervisor,
        equipe,
        hasOccurrences
      };
    });
  }, [operationalVisits, promoterMetaMap]);

  // Listas Dinâmicas de Opções para Filtros
  const supervisorOptions = useMemo(() => {
    const set = new Set<string>();
    enrichedVisits.forEach((v) => {
      if (v.supervisor && v.supervisor !== 'Não informado') set.add(v.supervisor);
    });
    supervisoresList.forEach((s) => {
      if (s.nome) set.add(s.nome);
    });
    return Array.from(set).sort();
  }, [enrichedVisits, supervisoresList]);

  const equipeOptions = useMemo(() => {
    const set = new Set<string>();
    enrichedVisits.forEach((v) => {
      if (v.equipe && v.equipe !== 'Geral') set.add(v.equipe);
    });
    equipesList.forEach((e) => {
      if (e.nome) set.add(e.nome);
    });
    return Array.from(set).sort();
  }, [enrichedVisits, equipesList]);

  const industriaOptions = useMemo(() => {
    const set = new Set<string>();
    industriasList.forEach((ind) => {
      if (ind.codigo) set.add(ind.codigo);
    });
    return Array.from(set).sort();
  }, [industriasList]);

  const promotorOptions = useMemo(() => {
    const set = new Map<string, string>();
    enrichedVisits.forEach((v) => {
      if (v.promotorMatricula) {
        set.set(v.promotorMatricula, v.promotorNome || v.promotorMatricula);
      }
    });
    return Array.from(set.entries()).map(([matricula, nome]) => ({ matricula, nome }));
  }, [enrichedVisits]);

  const lojaOptions = useMemo(() => {
    const set = new Map<string, string>();
    enrichedVisits.forEach((v) => {
      if (v.lojaCodigo) {
        set.set(v.lojaCodigo, v.lojaNome || v.lojaCodigo);
      }
    });
    return Array.from(set.entries())
      .map(([codigo, nome]) => ({ codigo, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [enrichedVisits]);

  // 8. Filtragem das Visitas Enriquecidas
  const filteredVisits = useMemo(() => {
    return enrichedVisits.filter((item) => {
      // Filtro Supervisor
      if (filterSupervisor !== 'all') {
        if (item.supervisor.toLowerCase() !== filterSupervisor.toLowerCase()) return false;
      }
      // Filtro Equipe
      if (filterEquipe !== 'all') {
        if (item.equipe.toLowerCase() !== filterEquipe.toLowerCase()) return false;
      }
      // Filtro Promotor
      if (filterPromotor !== 'all') {
        if (item.promotorMatricula !== filterPromotor) return false;
      }
      // Filtro Loja
      if (filterLoja !== 'all') {
        if (item.lojaCodigo !== filterLoja) return false;
      }
      // Filtro Indústria
      if (filterIndustria !== 'all') {
        if (item.industriaCodigo !== filterIndustria) return false;
      }
      // Filtro Status
      if (filterStatus !== 'all') {
        if (filterStatus === 'administratively_completed' && item.visitObj?.regularization_status !== 'administratively_completed_with_proof') return false;
        else if (filterStatus === 'closed_without_proof' && item.visitObj?.regularization_status !== 'closed_without_execution_proof') return false;
        else if (filterStatus === 'pendente' && item.status !== 'pendente' && item.status !== 'planejada') return false;
        else if (!['administratively_completed', 'closed_without_proof', 'pendente'].includes(filterStatus) && item.status !== filterStatus) return false;
      }
      // Filtro Ocorrências
      if (filterOcorrencia === 'com_ocorrencia' && !item.hasOccurrences) return false;
      if (filterOcorrencia === 'sem_ocorrencia' && item.hasOccurrences) return false;

      // Busca Textual
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchLoja = (item.lojaNome || '').toLowerCase().includes(q) || item.lojaCodigo.toLowerCase().includes(q);
        const matchProm = (item.promotorNome || '').toLowerCase().includes(q) || item.promotorMatricula.toLowerCase().includes(q);
        const matchInd = (item.industriaNome || '').toLowerCase().includes(q) || item.industriaCodigo.toLowerCase().includes(q);
        const matchSup = item.supervisor.toLowerCase().includes(q);
        const matchEq = item.equipe.toLowerCase().includes(q);
        if (!matchLoja && !matchProm && !matchInd && !matchSup && !matchEq) return false;
      }

      return true;
    });
  }, [
    enrichedVisits,
    filterSupervisor,
    filterEquipe,
    filterPromotor,
    filterLoja,
    filterIndustria,
    filterStatus,
    filterOcorrencia,
    searchQuery
  ]);

  useEffect(() => {
    if (!didInitializeVisitFiltersRef.current) {
      didInitializeVisitFiltersRef.current = true;
      return;
    }
    setVisitPage(1);
  }, [selectedDate, filterSupervisor, filterEquipe, filterPromotor, filterLoja, filterIndustria, filterStatus, filterOcorrencia, searchQuery, visitPageSize]);
  useEffect(() => {
    setSearchParams(current => updateVisitsTrackingQuery(current, {
      date: selectedDate, supervisor: filterSupervisor, team: filterEquipe, promoter: filterPromotor,
      store: filterLoja, industry: filterIndustria, status: filterStatus, occurrence: filterOcorrencia,
      search: searchQuery, page: visitPage, pageSize: visitPageSize
    }), { replace: true });
  }, [selectedDate, filterSupervisor, filterEquipe, filterPromotor, filterLoja, filterIndustria, filterStatus, filterOcorrencia, searchQuery, visitPage, visitPageSize, setSearchParams]);
  const orderedFilteredVisits = useMemo(() => sortVisitsForDisplay(filteredVisits), [filteredVisits]);
  const totalVisitPages = Math.max(1, Math.ceil(orderedFilteredVisits.length / visitPageSize));
  useEffect(() => {
    if (visitPage > totalVisitPages) setVisitPage(totalVisitPages);
  }, [visitPage, totalVisitPages]);
  const visibleVisits = useMemo(() => paginateVisits(orderedFilteredVisits, visitPage, visitPageSize), [orderedFilteredVisits, visitPage, visitPageSize]);
  const toggleStatusIndicator = (status: string) => {
    if (status === 'all') setFilterOcorrencia('all');
    setFilterStatus((current) => current === status ? 'all' : status);
  };
  const toggleOccurrenceIndicator = () => setFilterOcorrencia((current) => current === 'com_ocorrencia' ? 'all' : 'com_ocorrencia');

  const filteredOldOpenVisits = useMemo(() => filterOldOpenVisits(oldOpenVisits, {
    promoter: oldFilterPromoter,
    store: oldFilterStore,
    industry: oldFilterIndustry,
    from: oldFilterFrom,
    to: oldFilterTo,
    before: getLocalDateString(new Date())
  }), [oldOpenVisits, oldFilterPromoter, oldFilterStore, oldFilterIndustry, oldFilterFrom, oldFilterTo]);

  const oldVisitFilterOptions = useMemo(() => ({
    promoters: Array.from(new Map(oldOpenVisits.map((visit) => [
      visit.promotor_matricula,
      visit.promotor?.nome || visit.promotor_matricula
    ])).entries()).sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
    stores: Array.from(new Map(oldOpenVisits.map((visit) => [
      visit.loja_codigo,
      visit.loja?.nome || visit.loja_codigo
    ])).entries()).sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
    industries: Array.from(new Map(oldOpenVisits.map((visit) => [
      visit.industria_codigo,
      visit.industria?.nome || visit.industria_codigo
    ])).entries()).sort((a, b) => String(a[1]).localeCompare(String(b[1])))
  }), [oldOpenVisits]);

  const storeMapUrl = selectedVisitItem
    ? buildGoogleMapsDirectionsUrl({
        name:
          selectedVisitItem.visitObj?.loja?.nome ||
          (selectedVisitItem.lojaNome !== selectedVisitItem.lojaCodigo
            ? selectedVisitItem.lojaNome
            : null),
        address: selectedVisitItem.visitObj?.loja?.endereco,
        city: selectedVisitItem.lojaCidade || selectedVisitItem.visitObj?.loja?.cidade,
        uf: selectedVisitItem.lojaUf || selectedVisitItem.visitObj?.loja?.uf
      })
    : null;

  // 9. Indicadores Consolidados (KPIs)
  const kpis = useMemo(() => {
    // Calculados sobre o universo total previsto do dia (ou sobre a filtragem atual de escopo)
    const baseList = filteredVisits;
    const resolutionCounts = getVisitResolutionCounts(baseList.map((v) => ({
      status: v.status,
      regularization_status: v.visitObj?.regularization_status || null
    })));
    const totalPrevistas = baseList.length;
    const emAndamento = resolutionCounts.inProgress;
    const concluidas = resolutionCounts.operationallyCompleted;
    const concluidasAdministrativamente = resolutionCounts.administrativelyCompleted;
    const encerradasSemComprovacao = resolutionCounts.closedWithoutProof;
    const naoRealizadas = baseList.filter((v) => v.status === 'nao_realizada').length;
    const pendentes = baseList.filter((v) => v.status === 'pendente' || v.status === 'planejada').length;
    const comOcorrencias = baseList.filter((v) => v.hasOccurrences).length;

    // Promotores escalados únicos
    const promotoresEscaladosSet = new Set<string>();
    baseList.forEach((v) => {
      if (v.promotorMatricula) promotoresEscaladosSet.add(v.promotorMatricula);
    });

    const aderencia = totalPrevistas > 0 ? Math.round((concluidas / totalPrevistas) * 100) : 0;

    return {
      totalPrevistas,
      promotoresEscalados: promotoresEscaladosSet.size,
      emAndamento,
      concluidas,
      concluidasAdministrativamente,
      encerradasSemComprovacao,
      naoRealizadas,
      pendentes,
      comOcorrencias,
      aderencia
    };
  }, [filteredVisits]);

  // 10. Resumo por Promotor
  const promotoresSummary = useMemo(() => {
    const map = new Map<
      string,
      {
        matricula: string;
        nome: string;
        equipe: string;
        supervisor: string;
        previstas: number;
        concluidas: number;
        concluidasAdministrativamente: number;
        encerradasSemComprovacao: number;
        emAndamento: number;
        naoRealizadas: number;
        pendentes: number;
      }
    >();

    filteredVisits.forEach((v) => {
      if (!map.has(v.promotorMatricula)) {
        map.set(v.promotorMatricula, {
          matricula: v.promotorMatricula,
          nome: v.promotorNome || v.promotorMatricula,
          equipe: v.equipe,
          supervisor: v.supervisor,
          previstas: 0,
          concluidas: 0,
          concluidasAdministrativamente: 0,
          encerradasSemComprovacao: 0,
          emAndamento: 0,
          naoRealizadas: 0,
          pendentes: 0
        });
      }
      const p = map.get(v.promotorMatricula)!;
      p.previstas++;
      if (v.status === 'concluida') p.concluidas++;
      else if (v.visitObj?.regularization_status === 'administratively_completed_with_proof') p.concluidasAdministrativamente++;
      else if (v.visitObj?.regularization_status === 'closed_without_execution_proof') p.encerradasSemComprovacao++;
      else if (v.status === 'em_andamento') p.emAndamento++;
      else if (v.status === 'nao_realizada') p.naoRealizadas++;
      else p.pendentes++;
    });

    return Array.from(map.values()).sort((a, b) => {
      const aProg = a.previstas > 0 ? a.concluidas / a.previstas : 0;
      const bProg = b.previstas > 0 ? b.concluidas / b.previstas : 0;
      return aProg - bProg; // Promotores com menor progresso aparecem primeiro
    });
  }, [filteredVisits]);
  const visiblePromoterSummaries = useMemo(
    () => filterPromoterDailySummaries(promotoresSummary, summarySearch, summaryOnlyPending),
    [promotoresSummary, summarySearch, summaryOnlyPending]
  );

  // Helper de badges de status
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'concluida':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#E8F5EE] text-[#16845B] border border-[#B9E5D0]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#16845B]" />
            Concluída
          </span>
        );
      case 'em_andamento':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#EBF2FE] text-[#286FF5] border border-[#C3D9FD] animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-[#286FF5]" />
            Em Andamento
          </span>
        );
      case 'nao_realizada':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#FDEEEE] text-[#DD3838] border border-[#F9BCBC]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#DD3838]" />
            Não Realizada
          </span>
        );
      case 'pendente':
      case 'planejada':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#F7F7F6] text-[#73726C] border border-[#E4E2DB]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#A09E96]" />
            Pendente
          </span>
        );
    }
  };

  // Helper para formatação de horário amigável
  const formatTime = (isoString?: string | null) => {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '—';
    }
  };

  const handleRegularizationSubmit = async () => {
    if (!regularizationVisit || regularizingVisit || !VISIT_REGULARIZATION_BACKEND_VERIFIED) return;
    setRegularizingVisit(true);
    try {
      await regularizeOldOpenVisit(regularizationVisit.id, regularizationAction, regularizationReason);
      setRegularizationVisit(null);
      onShowToast({ title: 'Regularização registrada', message: 'A decisão foi registrada e auditada.', type: 'success' });
      await loadTrackingData(false);
    } catch (error) {
      onShowToast({ title: 'Não foi possível regularizar', message: error instanceof Error ? error.message : 'O backend recusou a operação.', type: 'error' });
    } finally {
      setRegularizingVisit(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* 1. Header do Painel */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-[#E4E2DB] shadow-xs">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center justify-center p-2 rounded-lg bg-[#EBF2FE] text-[#286FF5]">
              <span className="material-symbols-outlined text-xl">travel_explore</span>
            </span>
            <h1 className="text-2xl font-bold text-[#171717]">Acompanhamento de Visitas</h1>
          </div>
          <p className="text-sm text-[#73726C]">
            Monitoramento em tempo real da execução em campo, fotos de evidência, checklist e aderência à grade.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-[#F7F7F6] px-3 py-2 rounded-xl border border-[#E4E2DB]">
            <span className="material-symbols-outlined text-sm text-[#73726C]">calendar_today</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-sm font-semibold text-[#171717] focus:outline-hidden cursor-pointer"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#73726C] hidden sm:inline-block font-mono" title="Atualização automática a cada 60s">
              Sincronizado: <strong className="text-[#171717]">{lastSyncText}</strong>
            </span>
            <button
              onClick={() => loadTrackingData(false)}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-[#171717] hover:bg-[#2C2C2C] text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer"
              title="Atualizar dados agora"
            >
              <span className={`material-symbols-outlined text-sm ${loading ? 'animate-spin' : ''}`}>sync</span>
              <span>Atualizar</span>
            </button>
          </div>
        </div>
      </div>

      {/* Alerta de Erro se houver */}
      {error && (
        <div className="p-4 bg-[#FDEEEE] border border-[#F9BCBC] rounded-xl flex items-center gap-3 text-sm text-[#DD3838]">
          <span className="material-symbols-outlined text-base">error</span>
          <span>{error}</span>
        </div>
      )}

      {/* 2. Cards de Indicadores Operacionais (4 Indicadores Prioritários + Apoio) */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 sm:gap-3">
        {/* 1. Visitas Previstas (Prioritário) */}
        <div role="button" tabIndex={0} onClick={() => toggleStatusIndicator('all')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleStatusIndicator('all'); } }} aria-pressed={filterStatus === 'all'} className="bg-white p-3 rounded-xl border-2 border-[#E4E2DB] shadow-xs cursor-pointer hover:border-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
          <div className="flex items-center justify-between text-[#73726C] text-xs font-semibold mb-1">
            <span>Visitas Previstas</span>
            <span className="material-symbols-outlined text-base text-[#171717]">event</span>
          </div>
          <div className="text-2xl font-extrabold text-[#171717]">{kpis.totalPrevistas}</div>
          <div className="text-[11px] text-[#73726C] mt-1">{kpis.promotoresEscalados} promotores na escala</div>
        </div>

        {/* 2. Em Andamento (Prioritário) */}
        <div role="button" tabIndex={0} onClick={() => toggleStatusIndicator('em_andamento')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleStatusIndicator('em_andamento'); } }} aria-pressed={filterStatus === 'em_andamento'} className="bg-white p-3 rounded-xl border-2 border-[#C3D9FD] shadow-xs bg-[#EBF2FE]/20 cursor-pointer hover:border-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
          <div className="flex items-center justify-between text-[#286FF5] text-xs font-semibold mb-1">
            <span>Em Andamento</span>
            <span className="material-symbols-outlined text-base">timelapse</span>
          </div>
          <div className="text-2xl font-extrabold text-[#286FF5]">{kpis.emAndamento}</div>
          <div className="text-[11px] text-[#73726C] mt-1">visitas em campo agora</div>
        </div>

        {/* 3. Concluídas (Prioritário) */}
        <div role="button" tabIndex={0} onClick={() => toggleStatusIndicator('concluida')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleStatusIndicator('concluida'); } }} aria-pressed={filterStatus === 'concluida'} className="bg-white p-3 rounded-xl border-2 border-[#B9E5D0] shadow-xs bg-[#E8F5EE]/20 cursor-pointer hover:border-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
          <div className="flex items-center justify-between text-[#16845B] text-xs font-semibold mb-1">
            <span>Concluídas</span>
            <span className="material-symbols-outlined text-base">task_alt</span>
          </div>
          <div className="text-2xl font-extrabold text-[#16845B]">{kpis.concluidas}</div>
          <div className="text-[11px] text-[#16845B] font-semibold mt-1">{kpis.aderencia}% de aderência</div>
        </div>

        {/* 4. Pendentes (Prioritário) */}
        <div role="button" tabIndex={0} onClick={() => toggleStatusIndicator('pendente')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleStatusIndicator('pendente'); } }} aria-pressed={filterStatus === 'pendente'} className="bg-white p-3 rounded-xl border-2 border-[#E4E2DB] shadow-xs cursor-pointer hover:border-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
          <div className="flex items-center justify-between text-[#73726C] text-xs font-semibold mb-1">
            <span>Pendentes</span>
            <span className="material-symbols-outlined text-base text-[#A09E96]">schedule</span>
          </div>
          <div className="text-2xl font-extrabold text-[#73726C]">{kpis.pendentes}</div>
          <div className="text-[11px] text-[#73726C] mt-1">a iniciar na grade</div>
        </div>

        {/* 5. Não Realizadas */}
        <div role="button" tabIndex={0} onClick={() => toggleStatusIndicator('nao_realizada')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleStatusIndicator('nao_realizada'); } }} aria-pressed={filterStatus === 'nao_realizada'} className="bg-white p-3 rounded-xl border border-[#F9BCBC] shadow-xs bg-[#FDEEEE]/15 cursor-pointer hover:border-rose-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
          <div className="flex items-center justify-between text-[#DD3838] text-xs font-medium mb-1">
            <span>Não Realizadas</span>
            <span className="material-symbols-outlined text-base">cancel</span>
          </div>
          <div className="text-2xl font-bold text-[#DD3838]">{kpis.naoRealizadas}</div>
          <div className="text-[11px] text-[#DD3838] mt-1">com justificativa</div>
        </div>

        {/* 6. Com Ocorrências */}
        <div role="button" tabIndex={0} onClick={toggleOccurrenceIndicator} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleOccurrenceIndicator(); } }} aria-pressed={filterOcorrencia === 'com_ocorrencia'} className="bg-white p-3 rounded-xl border border-[#FCE19B] shadow-xs bg-[#FFF8E6]/15 cursor-pointer hover:border-amber-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
          <div className="flex items-center justify-between text-[#D98A00] text-xs font-medium mb-1">
            <span>Ocorrências</span>
            <span className="material-symbols-outlined text-base">warning</span>
          </div>
          <div className="text-2xl font-bold text-[#D98A00]">{kpis.comOcorrencias}</div>
          <div className="text-[11px] text-[#73726C] mt-1">rupturas ou desvios</div>
        </div>

        <div role="button" tabIndex={0} onClick={() => toggleStatusIndicator('administratively_completed')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleStatusIndicator('administratively_completed'); } }} aria-pressed={filterStatus === 'administratively_completed'} className="bg-white p-3 rounded-xl border border-purple-200 shadow-xs bg-purple-50/30 cursor-pointer hover:border-purple-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
          <div className="text-xs font-semibold text-purple-900 mb-1">Conclusões administrativas</div>
          <div className="text-2xl font-bold text-purple-950">{kpis.concluidasAdministrativamente}</div>
          <div className="text-[11px] text-purple-900 mt-1">com comprovação; métricas separadas</div>
        </div>

        <div role="button" tabIndex={0} onClick={() => toggleStatusIndicator('closed_without_proof')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleStatusIndicator('closed_without_proof'); } }} aria-pressed={filterStatus === 'closed_without_proof'} className="bg-white p-3 rounded-xl border border-amber-200 shadow-xs bg-amber-50/30 cursor-pointer hover:border-amber-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
          <div className="text-xs font-semibold text-amber-900 mb-1">Encerradas sem comprovação</div>
          <div className="text-2xl font-bold text-amber-950">{kpis.encerradasSemComprovacao}</div>
          <div className="text-[11px] text-amber-900 mt-1">não entram como concluídas</div>
        </div>
      </div>

      {/* 3. Barra de Filtros Operacionais */}
      <div className="bg-white p-4 rounded-2xl border border-[#E4E2DB] shadow-xs space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
          {/* Filtro Supervisor */}
          <div>
            <label className="block text-xs font-semibold text-[#73726C] mb-1">Supervisor</label>
            <select
              value={filterSupervisor}
              onChange={(e) => setFilterSupervisor(e.target.value)}
              className="w-full bg-[#F7F7F6] border border-[#E4E2DB] rounded-xl px-3 py-2 text-xs font-medium text-[#171717] focus:outline-hidden"
            >
              <option value="all">Todos os Supervisores</option>
              {supervisorOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro Equipe */}
          <div>
            <label className="block text-xs font-semibold text-[#73726C] mb-1">Equipe</label>
            <select
              value={filterEquipe}
              onChange={(e) => setFilterEquipe(e.target.value)}
              className="w-full bg-[#F7F7F6] border border-[#E4E2DB] rounded-xl px-3 py-2 text-xs font-medium text-[#171717] focus:outline-hidden"
            >
              <option value="all">Todas as Equipes</option>
              {equipeOptions.map((eq) => (
                <option key={eq} value={eq}>
                  {eq}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro Promotor */}
          <div>
            <label className="block text-xs font-semibold text-[#73726C] mb-1">Promotor</label>
            <select
              value={filterPromotor}
              onChange={(e) => setFilterPromotor(e.target.value)}
              className="w-full bg-[#F7F7F6] border border-[#E4E2DB] rounded-xl px-3 py-2 text-xs font-medium text-[#171717] focus:outline-hidden"
            >
              <option value="all">Todos os Promotores</option>
              {promotorOptions.map((p) => (
                <option key={p.matricula} value={p.matricula}>
                  {p.nome} ({p.matricula})
                </option>
              ))}
            </select>
          </div>

          {/* Filtro Loja */}
          <div>
            <label className="block text-xs font-semibold text-[#73726C] mb-1">Loja / PDV</label>
            <select
              value={filterLoja}
              onChange={(e) => setFilterLoja(e.target.value)}
              className="w-full bg-[#F7F7F6] border border-[#E4E2DB] rounded-xl px-3 py-2 text-xs font-medium text-[#171717] focus:outline-hidden"
            >
              <option value="all">Todas as Lojas</option>
              {lojaOptions.map((lj) => (
                <option key={lj.codigo} value={lj.codigo}>
                  {lj.nome}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro Indústria */}
          <div>
            <label className="block text-xs font-semibold text-[#73726C] mb-1">Indústria</label>
            <select
              value={filterIndustria}
              onChange={(e) => setFilterIndustria(e.target.value)}
              className="w-full bg-[#F7F7F6] border border-[#E4E2DB] rounded-xl px-3 py-2 text-xs font-medium text-[#171717] focus:outline-hidden"
            >
              <option value="all">Todas as Indústrias</option>
              {industriaOptions.map((ind) => (
                <option key={ind} value={ind}>
                  {ind}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro Status */}
          <div>
            <label className="block text-xs font-semibold text-[#73726C] mb-1">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full bg-[#F7F7F6] border border-[#E4E2DB] rounded-xl px-3 py-2 text-xs font-medium text-[#171717] focus:outline-hidden"
            >
              <option value="all">Todos os Status</option>
              <option value="em_andamento">Em Andamento</option>
              <option value="concluida">Concluída</option>
              <option value="nao_realizada">Não Realizada</option>
              <option value="pendente">Pendente</option>
            </select>
          </div>

          {/* Filtro Ocorrências */}
          <div>
            <label className="block text-xs font-semibold text-[#73726C] mb-1">Ocorrências</label>
            <select
              value={filterOcorrencia}
              onChange={(e) => setFilterOcorrencia(e.target.value)}
              className="w-full bg-[#F7F7F6] border border-[#E4E2DB] rounded-xl px-3 py-2 text-xs font-medium text-[#171717] focus:outline-hidden"
            >
              <option value="all">Todas as Visitas</option>
              <option value="com_ocorrencia">Com Ocorrência / Ruptura</option>
              <option value="sem_ocorrencia">Sem Ocorrência</option>
            </select>
          </div>
        </div>

        {/* Linha de Busca Textual e Limpeza */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-[#F2F1ED]">
          <div className="relative w-full sm:w-96">
            <span className="material-symbols-outlined absolute left-3 top-2.5 text-sm text-[#73726C]">search</span>
            <input
              type="text"
              placeholder="Buscar por loja, promotor, indústria..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#F7F7F6] border border-[#E4E2DB] rounded-xl pl-9 pr-4 py-2 text-xs font-medium text-[#171717] focus:outline-hidden"
            />
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto text-xs text-[#73726C]">
            <span>Exibindo <strong>{filteredVisits.length}</strong> de {enrichedVisits.length} visitas</span>
            {(filterSupervisor !== 'all' ||
              filterEquipe !== 'all' ||
              filterPromotor !== 'all' ||
              filterLoja !== 'all' ||
              filterIndustria !== 'all' ||
              filterStatus !== 'all' ||
              filterOcorrencia !== 'all' ||
              searchQuery) && (
              <button
                onClick={() => {
                  setFilterSupervisor('all');
                  setFilterEquipe('all');
                  setFilterPromotor('all');
                  setFilterLoja('all');
                  setFilterIndustria('all');
                  setFilterStatus('all');
                  setFilterOcorrencia('all');
                  setSearchQuery('');
                }}
                className="text-[#286FF5] hover:underline font-medium ml-2"
              >
                Limpar filtros
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 4. Tabela de Visitas */}
      <div className="bg-white rounded-2xl border border-[#E4E2DB] shadow-xs overflow-hidden">
        <div className="px-4 sm:px-6 py-3 border-b border-[#E4E2DB] flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-[#FCFCFB]">
          <h2 className="text-base font-bold text-[#171717] flex items-center gap-2">
            <span>Registro de Visitas da Grade</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#F7F7F6] border border-[#E4E2DB] font-normal text-[#73726C]">
              {selectedDate}
            </span>
          </h2>
          <span className="text-xs text-[#73726C]">Última sync: {lastSyncText}</span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-[#73726C] flex flex-col items-center justify-center gap-3">
            <span className="material-symbols-outlined text-3xl animate-spin text-[#286FF5]">sync</span>
            <p className="text-sm">Carregando dados da grade e registros de campo...</p>
          </div>
        ) : filteredVisits.length === 0 ? (
          <div className="p-12 text-center text-[#73726C]">
            <span className="material-symbols-outlined text-4xl text-[#A09E96] mb-2">event_busy</span>
            <p className="text-base font-semibold text-[#171717]">Nenhuma visita encontrada</p>
            <p className="text-xs text-[#73726C] mt-1">
              Verifique a data selecionada ou ajuste os filtros acima.
            </p>
          </div>
        ) : (
          <>
          <div className="px-4 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#E4E2DB] bg-[#FCFCFB] text-xs text-[#5F5F5F]">
            <span aria-live="polite">{filteredVisits.length} resultados filtrados · página {visitPage} de {totalVisitPages}</span>
            <label className="flex items-center gap-2">Por página
              <select aria-label="Visitas por página" value={visitPageSize} onChange={(event) => setVisitPageSize(Number(event.target.value) as VisitPageSize)} className="rounded-lg border border-[#CFCDC5] bg-white px-2 py-1 text-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
                <option value={15}>15</option><option value={25}>25</option><option value={50}>50</option>
              </select>
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left border-collapse">
              <thead>
                <tr className="bg-[#F7F7F6] text-[11px] font-bold text-[#73726C] uppercase tracking-wider border-b border-[#E4E2DB]">
                  <th className="px-6 py-3">Loja / PDV</th>
                  <th className="px-4 py-3">Indústria</th>
                  <th className="px-4 py-3">Promotor</th>
                  <th className="px-4 py-3">Equipe / Supervisor</th>
                  <th className="px-4 py-3">Horários</th>
                  <th className="px-4 py-3">Evidências</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E2DB] text-xs">
                {visibleVisits.map((item) => {
                  const v = item.visitObj;
                  const photoCount = v?.photos?.length || 0;
                  const checkCount = v?.checklist_items?.filter((c) => c.checked)?.length || 0;
                  const occCount = v?.occurrences?.length || 0;
                  const valCount = v?.validity_items?.length || 0;

                  return (
                    <tr
                      key={item.key}
                      className="hover:bg-[#FCFCFB] transition-colors cursor-pointer"
                      onClick={() => setSelectedVisitItem(item)}
                    >
                      {/* Loja */}
                      <td className="px-6 py-4">
                        <div className="font-semibold text-[#171717]">{item.lojaNome}</div>
                        <div className="text-[11px] text-[#73726C] mt-0.5">
                          Cód: {item.lojaCodigo} {item.lojaCidade ? `• ${item.lojaCidade}/${item.lojaUf}` : ''}
                        </div>
                      </td>

                      {/* Indústria */}
                      <td className="px-4 py-4">
                        <span className="font-medium text-[#171717]">{item.industriaNome}</span>
                        <div className="text-[11px] text-[#73726C]">{item.industriaCodigo}</div>
                      </td>

                      {/* Promotor */}
                      <td className="px-4 py-4">
                        <span className="font-medium text-[#171717]">{item.promotorNome}</span>
                        <div className="text-[11px] text-[#73726C]">Matrícula: {item.promotorMatricula}</div>
                      </td>

                      {/* Equipe / Supervisor */}
                      <td className="px-4 py-4">
                        <div className="font-medium text-[#171717]">{item.equipe}</div>
                        <div className="text-[11px] text-[#73726C]">Sup: {item.supervisor}</div>
                      </td>

                      {/* Horários */}
                      <td className="px-4 py-4">
                        {v?.started_at ? (
                          <div>
                            <div className="text-[#171717]">
                              Início: <strong>{formatTime(v.started_at)}</strong>
                            </div>
                            <div className="text-[#73726C] text-[11px]">
                              {v.completed_at ? `Fim: ${formatTime(v.completed_at)}` : 'Em andamento'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[#A09E96]">Não iniciada</span>
                        )}
                      </td>

                      {/* Evidências */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2 text-[11px] text-[#73726C]">
                          {photoCount > 0 && (
                            <span
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#F7F7F6] border border-[#E4E2DB]"
                              title={`${photoCount} fotos anexadas`}
                            >
                              <span className="material-symbols-outlined text-xs">photo_camera</span>
                              {photoCount}
                            </span>
                          )}
                          {occCount > 0 && (
                            <span
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#FFF8E6] text-[#D98A00] border border-[#FCE19B]"
                              title={`${occCount} ocorrências/rupturas`}
                            >
                              <span className="material-symbols-outlined text-xs">warning</span>
                              {occCount}
                            </span>
                          )}
                          {valCount > 0 && (
                            <span
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#F7F7F6] border border-[#E4E2DB]"
                              title={`${valCount} produtos com validade`}
                            >
                              <span className="material-symbols-outlined text-xs">event</span>
                              {valCount}
                            </span>
                          )}
                          {photoCount === 0 && occCount === 0 && valCount === 0 && (
                            <span className="text-[#A09E96]">Nenhum registro</span>
                          )}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-4">{item.visitObj?.regularization_status ? (
                        <span className="inline-flex rounded-full border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-950">
                          {getAdministrativeResolutionLabel(item.visitObj.regularization_status)}
                        </span>
                      ) : renderStatusBadge(item.status)}</td>

                      {/* Ação */}
                      <td className="px-4 py-4 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedVisitItem(item);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-[#F7F7F6] hover:bg-[#EBF2FE] text-[#171717] hover:text-[#286FF5] border border-[#E4E2DB] font-medium transition-colors"
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
          <nav aria-label="Paginação das visitas" className="px-4 py-3 border-t border-[#E4E2DB] flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#FCFCFB]">
            <span className="text-xs text-[#5F5F5F]">Página {visitPage} de {totalVisitPages} · {filteredVisits.length} resultados</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setVisitPage((page) => Math.max(1, page - 1))} disabled={visitPage === 1} className="rounded-lg border border-[#CFCDC5] px-3 py-2 text-xs font-semibold text-[#171717] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">Anterior</button>
              <button type="button" onClick={() => setVisitPage((page) => Math.min(totalVisitPages, page + 1))} disabled={visitPage === totalVisitPages} className="rounded-lg border border-[#CFCDC5] px-3 py-2 text-xs font-semibold text-[#171717] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">Próxima</button>
            </div>
          </nav>
          </>
        )}
      </div>

      {canManageOldOpenVisits(role) && (
        <details className="bg-white rounded-2xl border border-amber-300 shadow-xs overflow-hidden">
          <summary className="cursor-pointer list-none px-5 py-4 border-b border-amber-200 bg-amber-50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-700">
            <div>
              <h2 id="old-open-visits-title" className="text-base font-bold text-[#171717]">VISITAS ANTIGAS EM ABERTO</h2>
              <p className="mt-1 text-xs text-[#5F5F5F]">Fila administrativa separada da escala diária. Dados limitados pelo escopo autorizado no banco.</p>
            </div>
            <span className="text-sm font-bold text-amber-900">{filteredOldOpenVisits.length} registro(s)</span>
          </summary>
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
              <label className="text-xs font-semibold text-[#5F5F5F]">Promotor
                <select value={oldFilterPromoter} onChange={(e) => setOldFilterPromoter(e.target.value)} className="mt-1 w-full bg-[#F7F7F6] border border-[#CFCDC5] rounded-lg px-3 py-2 text-sm text-[#171717]">
                  <option value="all">Todos</option>{oldVisitFilterOptions.promoters.map(([id, name]) => <option key={id} value={id}>{name} ({id})</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-[#5F5F5F]">Loja
                <select value={oldFilterStore} onChange={(e) => setOldFilterStore(e.target.value)} className="mt-1 w-full bg-[#F7F7F6] border border-[#CFCDC5] rounded-lg px-3 py-2 text-sm text-[#171717]">
                  <option value="all">Todas</option>{oldVisitFilterOptions.stores.map(([id, name]) => <option key={id} value={id}>{name} ({id})</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-[#5F5F5F]">Indústria
                <select value={oldFilterIndustry} onChange={(e) => setOldFilterIndustry(e.target.value)} className="mt-1 w-full bg-[#F7F7F6] border border-[#CFCDC5] rounded-lg px-3 py-2 text-sm text-[#171717]">
                  <option value="all">Todas</option>{oldVisitFilterOptions.industries.map(([id, name]) => <option key={id} value={id}>{name} ({id})</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-[#5F5F5F]">Desde
                <input type="date" value={oldFilterFrom} onChange={(e) => setOldFilterFrom(e.target.value)} className="mt-1 w-full bg-[#F7F7F6] border border-[#CFCDC5] rounded-lg px-3 py-2 text-sm text-[#171717]" />
              </label>
              <label className="text-xs font-semibold text-[#5F5F5F]">Até
                <input type="date" value={oldFilterTo} onChange={(e) => setOldFilterTo(e.target.value)} className="mt-1 w-full bg-[#F7F7F6] border border-[#CFCDC5] rounded-lg px-3 py-2 text-sm text-[#171717]" />
              </label>
            </div>
            {filteredOldOpenVisits.length === 0 ? (
              <p className="rounded-xl border border-[#E4E2DB] bg-[#FCFCFB] p-5 text-center text-sm text-[#5F5F5F]">Nenhuma visita antiga em aberto encontrada com estes filtros.</p>
            ) : (
              <div className="space-y-2">
                {filteredOldOpenVisits.map((visit) => (
                  <article key={visit.id} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-xl border border-[#E4E2DB] bg-[#FCFCFB] p-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-4 gap-y-2 text-xs">
                      <div><div className="text-[#73726C]">Promotor / matrícula</div><div className="font-bold text-[#171717]">{visit.promotor?.nome || 'Promotor não identificado'} <span className="font-normal">({visit.promotor_matricula})</span></div></div>
                      <div><div className="text-[#73726C]">Loja</div><div className="font-bold text-[#171717]">{visit.loja?.nome || visit.loja_codigo} <span className="font-normal">({visit.loja_codigo})</span></div></div>
                      <div><div className="text-[#73726C]">Indústria</div><div className="font-bold text-[#171717]">{visit.industria?.nome || visit.industria_codigo} <span className="font-normal">({visit.industria_codigo})</span></div></div>
                      <div><div className="text-[#73726C]">Data / início / duração</div><div className="font-bold text-[#171717]">{visit.data_visita} · {formatTime(visit.started_at)} · {getVisitDurationLabel(visit.started_at)}</div></div>
                      <div className="sm:col-span-2 xl:col-span-4 flex flex-wrap gap-2 text-[11px] text-[#5F5F5F]">
                        <span className="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5">Em andamento</span>
                        <span>Checklist: {visit.checklist_items?.length || 0}</span><span>Fotos: {visit.photos?.length || 0}</span>
                        <span>Ocorrências: {visit.occurrences?.length || 0}</span><span>Validades: {visit.validity_items?.length || 0}</span>
                      </div>
                    </div>
                  <button type="button" onClick={() => { setRegularizationVisit(visit); setRegularizationAction('closed_without_execution_proof'); setRegularizationReason(''); }} className="self-center rounded-lg bg-[#171717] px-4 py-2 text-xs font-bold text-white hover:bg-[#333]">REGULARIZAR VISITA</button>
                  </article>
                ))}
              </div>
            )}
            <p className="text-[11px] text-[#73726C]">A regularização administrativa está disponível para usuários autorizados. Cada decisão exige justificativa e é registrada em auditoria, preservando os dados originais da visita.</p>
          </div>
        </details>
      )}

      {/* 5. Resumo Operacional por Promotor */}
      <details className="bg-white rounded-2xl border border-[#E4E2DB] shadow-xs overflow-hidden">
        <summary className="cursor-pointer list-none p-4 flex items-center justify-between gap-3 bg-[#FCFCFB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
          <strong className="text-base text-[#171717]">Resumo Diário por Promotor</strong>
          <span className="rounded-full border border-[#CFCDC5] px-2.5 py-1 text-xs font-semibold text-[#171717]">{promotoresSummary.length} promotores</span>
        </summary>
      <div className="bg-white p-4 sm:p-6">
        <div className="mb-4 flex flex-col sm:flex-row gap-3 sm:items-center">
          <label className="flex-1"><span className="sr-only">Buscar promotor no resumo</span><input type="search" value={summarySearch} onChange={(event) => setSummarySearch(event.target.value)} placeholder="Buscar promotor pelo nome" className="w-full rounded-lg border border-[#CFCDC5] bg-white px-3 py-2 text-sm text-[#171717] placeholder:text-[#5F5F5F] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600" /></label>
          <label className="flex items-center gap-2 text-sm text-[#171717]"><input type="checkbox" checked={summaryOnlyPending} onChange={(event) => setSummaryOnlyPending(event.target.checked)} className="size-4 accent-blue-700" />Somente com pendências</label>
        </div>
        {visiblePromoterSummaries.length === 0 ? (
          <div className="text-center py-6 text-xs text-[#73726C]">Nenhum promotor escalado no filtro atual.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {visiblePromoterSummaries.map((p) => {
              const perc = p.previstas > 0 ? Math.round((p.concluidas / p.previstas) * 100) : 0;
              return (
                <div
                  key={p.matricula}
                  className="p-4 rounded-xl border border-[#E4E2DB] bg-[#FCFCFB] space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-sm text-[#171717]">{p.nome}</div>
                      <div className="text-[11px] text-[#73726C]">
                        {p.equipe} • Sup: {p.supervisor}
                      </div>
                    </div>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-white border border-[#E4E2DB] text-[#171717]">
                      {perc}%
                    </span>
                  </div>

                  {/* Barra de Progresso */}
                  <div className="w-full bg-[#E4E2DB] rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-[#16845B] h-2 rounded-full transition-all duration-300"
                      style={{ width: `${perc}%` }}
                    />
                  </div>

                  {/* Detalhes de Contagem */}
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 text-center text-[10px]">
                    <div className="bg-white p-1.5 rounded-lg border border-[#E4E2DB]"><div className="font-bold text-[#171717]">{p.previstas}</div><div className="text-[#73726C]">Prev.</div></div>
                    <div className="bg-white p-1.5 rounded-lg border border-[#E4E2DB]"><div className="font-bold text-[#286FF5]">{p.emAndamento}</div><div className="text-[#73726C]">Andam.</div></div>
                    <div className="bg-white p-1.5 rounded-lg border border-[#E4E2DB]"><div className="font-bold text-[#16845B]">{p.concluidas}</div><div className="text-[#73726C]">Concl.</div></div>
                    <div className="bg-white p-1.5 rounded-lg border border-[#E4E2DB]"><div className="font-bold text-[#DD3838]">{p.naoRealizadas}</div><div className="text-[#73726C]">Nao realizadas</div></div>
                    <div className="bg-purple-50 p-1.5 rounded-lg border border-purple-200"><div className="font-bold text-purple-950">{p.concluidasAdministrativamente}</div><div className="text-purple-900">Conclusao adm.</div></div>
                    <div className="bg-amber-50 p-1.5 rounded-lg border border-amber-200"><div className="font-bold text-amber-950">{p.encerradasSemComprovacao}</div><div className="text-amber-900">Sem comprovacao</div></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </details>

      {regularizationVisit && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="regularization-title">
          <div className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl bg-white border border-[#E4E2DB] shadow-2xl p-4 sm:p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div><h3 id="regularization-title" className="text-lg font-bold text-[#171717]">Regularizar visita antiga</h3><p className="text-xs text-[#5F5F5F] mt-1">A decisão será registrada com o motivo e a auditoria.</p></div>
              <button type="button" onClick={() => setRegularizationVisit(null)} aria-label="Fechar" className="rounded-lg px-2 py-1 text-xl text-[#5F5F5F] hover:bg-[#F2F1ED]">×</button>
            </div>
            <div className="rounded-xl bg-[#F7F7F6] p-3 text-sm space-y-1">
              <div><span className="text-[#73726C]">Loja:</span> <strong>{regularizationVisit.loja?.nome || regularizationVisit.loja_codigo}</strong></div>
              <div><span className="text-[#73726C]">Indústria:</span> <strong>{regularizationVisit.industria?.nome || regularizationVisit.industria_codigo}</strong></div>
              <div><span className="text-[#73726C]">Promotor:</span> <strong>{regularizationVisit.promotor?.nome || 'Promotor não identificado'} · {regularizationVisit.promotor_matricula}</strong></div>
              <div><span className="text-[#73726C]">Data e início:</span> <strong>{regularizationVisit.data_visita} · {regularizationVisit.started_at ? new Date(regularizationVisit.started_at).toLocaleString('pt-BR') : 'Não registrado'}</strong></div>
            </div>
            <fieldset className="space-y-2 text-sm">
              <legend className="mb-1 text-xs font-bold text-[#5F5F5F]">Ação administrativa</legend>
              {([
                ['closed_without_execution_proof', 'Encerrar sem execução comprovada'],
                ['administratively_completed_with_proof', 'Concluir administrativamente com comprovação adequada']
              ] as const).map(([value, label]) => <label key={value} className="flex gap-2 items-start rounded-lg border border-[#E4E2DB] p-3"><input type="radio" name="regularization-action" value={value} checked={regularizationAction === value} onChange={() => setRegularizationAction(value)} className="mt-1" /><span>{label}</span></label>)}
            </fieldset>
            {regularizationAction === 'administratively_completed_with_proof' && <p className="rounded-lg bg-purple-50 p-3 text-xs text-purple-950">Critério preparado: pelo menos uma foto existente e um item de checklist respondido. O servidor valida essas evidências.</p>}
            <label className="block text-xs font-bold text-[#5F5F5F]">Motivo obrigatório
              <textarea value={regularizationReason} onChange={(e) => setRegularizationReason(e.target.value)} rows={3} maxLength={1000} className="mt-1 w-full rounded-xl border border-[#CFCDC5] bg-white p-3 text-sm font-normal text-[#171717]" placeholder="Registre o motivo da análise administrativa." />
            </label>
            <details className="rounded-xl border border-[#E4E2DB] p-3 text-xs">
              <summary className="cursor-pointer font-bold text-[#171717]">Ver registros existentes (somente leitura)</summary>
              <div className="mt-3 space-y-2 text-[#5F5F5F]">
                <p>Checklist ({regularizationVisit.checklist_items?.length || 0})</p>
                {!!regularizationVisit.checklist_items?.length && <ul className="list-disc pl-5">{regularizationVisit.checklist_items.map((item) => <li key={item.id || item.item_key}>{item.item_label}: {item.checked ? 'marcado' : 'não marcado'}{item.valor_texto ? ` · ${item.valor_texto}` : ''}{item.observacao ? ` — ${item.observacao}` : ''}</li>)}</ul>}
                <p>Fotos ({regularizationVisit.photos?.length || 0})</p>
                {!!regularizationVisit.photos?.length && <ul className="list-disc pl-5">{regularizationVisit.photos.map((photo) => <li key={photo.id || photo.storage_path}>{photo.tipo_foto}{photo.legenda ? ` — ${photo.legenda}` : ''}{photo.created_at ? ` · ${new Date(photo.created_at).toLocaleString('pt-BR')}` : ''}</li>)}</ul>}
                <p>Ocorrências ({regularizationVisit.occurrences?.length || 0})</p>
                {!!regularizationVisit.occurrences?.length && <ul className="list-disc pl-5">{regularizationVisit.occurrences.map((item) => <li key={item.id}>{item.tipo}: {item.descricao} ({item.resolvido ? 'resolvida' : 'pendente'})</li>)}</ul>}
                <p>Controle de validade ({regularizationVisit.validity_items?.length || 0})</p>
                {!!regularizationVisit.validity_items?.length && <ul className="list-disc pl-5">{regularizationVisit.validity_items.map((item) => <li key={item.id}>{item.produto_nome}: {item.quantidade} · vencimento {item.data_vencimento}{item.lote ? ` · lote ${item.lote}` : ''}</li>)}</ul>}
                <p>Os registros originais não são alterados pela regularização.</p>
              </div>
            </details>
            {!VISIT_REGULARIZATION_BACKEND_VERIFIED && <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">Confirmação indisponível até a migration e a RPC serem implantadas e validadas no ambiente.</div>}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button type="button" onClick={() => setRegularizationVisit(null)} className="rounded-lg border border-[#CFCDC5] px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button type="button" onClick={handleRegularizationSubmit} disabled={!VISIT_REGULARIZATION_BACKEND_VERIFIED || regularizingVisit || !isRegularizationReasonValid(regularizationReason)} title={!VISIT_REGULARIZATION_BACKEND_VERIFIED ? 'Aguardando validação do backend' : undefined} className="rounded-lg bg-[#171717] px-4 py-2 text-sm font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed">{regularizingVisit ? 'Registrando…' : 'Confirmar regularização'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Modal / Drawer de Detalhes da Visita (Somente Leitura) */}
      {selectedVisitItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl border border-[#E4E2DB] shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header Modal */}
            <div className="px-6 py-4 border-b border-[#E4E2DB] flex items-center justify-between bg-[#FCFCFB]">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-[#171717]">
                    Detalhes da Visita: {selectedVisitItem.lojaNome}
                  </h3>
                  {selectedVisitItem.visitObj?.regularization_status ? (
                    <span className="inline-flex rounded-full border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-950">
                      {getAdministrativeResolutionLabel(selectedVisitItem.visitObj.regularization_status)}
                    </span>
                  ) : renderStatusBadge(selectedVisitItem.status)}
                </div>
                <p className="text-xs text-[#73726C] mt-0.5">
                  {selectedVisitItem.industriaNome} ({selectedVisitItem.industriaCodigo}) • Data: {selectedVisitItem.dataStr}
                </p>
              </div>
              <button
                onClick={() => setSelectedVisitItem(null)}
                className="p-1 rounded-lg hover:bg-[#E4E2DB] text-[#73726C] transition-colors"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            {/* Conteúdo com Scroll */}
            <div className="p-6 overflow-y-auto space-y-6 text-xs text-[#171717]">
              {/* Informações da Escala e Promotor */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-[#F7F7F6] rounded-xl border border-[#E4E2DB]">
                <div>
                  <div className="text-[#73726C] font-medium">Promotor</div>
                  <div className="font-bold mt-0.5">{selectedVisitItem.promotorNome}</div>
                  <div className="text-[11px] text-[#73726C]">Matrícula: {selectedVisitItem.promotorMatricula}</div>
                </div>
                <div>
                  <div className="text-[#73726C] font-medium">Equipe / Supervisor</div>
                  <div className="font-bold mt-0.5">
                    {promoterMetaMap.get(selectedVisitItem.promotorMatricula)?.equipe || 'Geral'}
                  </div>
                  <div className="text-[11px] text-[#73726C]">
                    Sup: {promoterMetaMap.get(selectedVisitItem.promotorMatricula)?.supervisor || 'Não informado'}
                  </div>
                </div>
                <div>
                  <div className="text-[#73726C] font-medium">Horário Início</div>
                  <div className="font-bold mt-0.5">{formatTime(selectedVisitItem.startedAt)}</div>
                  <div className="text-[11px] text-[#73726C]">
                    {selectedVisitItem.visitObj?.latitude && selectedVisitItem.visitObj?.longitude
                      ? `GPS: ${selectedVisitItem.visitObj.latitude.toFixed(4)}, ${selectedVisitItem.visitObj.longitude.toFixed(4)}`
                      : 'GPS: não registrado'}
                  </div>
                </div>
                <div>
                  <div className="text-[#73726C] font-medium">Horário Conclusão</div>
                  <div className="font-bold mt-0.5">{formatTime(selectedVisitItem.completedAt)}</div>
                  <div className="text-[11px] text-[#73726C]">
                    {selectedVisitItem.duracaoFormatada ? `Duração: ${selectedVisitItem.duracaoFormatada}` : '—'}
                  </div>
                </div>
              </div>

              {selectedVisitItem.visitObj?.regularization_status && (
                <section className="rounded-xl border border-purple-200 bg-purple-50 p-4">
                  <h4 className="font-bold text-purple-950">Histórico da regularização</h4>
                  <p className="mt-1 text-xs text-purple-900">
                    {selectedVisitItem.visitObj.regularization_status === 'closed_without_execution_proof'
                      ? 'Encerrada administrativamente — sem execução comprovada.'
                      : 'Concluída administrativamente com comprovação. Não altera os horários originais.'}
                  </p>
                  {visitRegularizationHistory.map((event) => <div key={event.id} className="mt-2 border-t border-purple-200 pt-2 text-xs text-purple-950">
                    <div className="font-semibold">{event.action === 'closed_without_execution_proof' ? 'Encerramento sem comprovação' : 'Conclusão administrativa com comprovação'}</div>
                    <div>{new Date(event.acted_at).toLocaleString('pt-BR')} · Usuário: {event.acted_by}</div>
                    <div>Motivo: {event.reason}</div>
                    <div>Referências de evidência registradas: {Array.isArray(event.evidence_refs) ? event.evidence_refs.length : 0}</div>
                  </div>)}
                </section>
              )}

              {/* Endereço e Localização da Loja */}
              <div className="p-3.5 bg-[#F7F7F6] rounded-xl border border-[#E4E2DB] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="text-[#73726C] font-medium flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm text-[#286FF5]">location_on</span>
                    <span>Localização / Endereço do PDV:</span>
                  </div>
                  <div className="font-semibold text-[#171717] mt-0.5">
                    {selectedVisitItem.lojaNome} (Cód: {selectedVisitItem.lojaCodigo})
                    {selectedVisitItem.visitObj?.loja?.endereco ? ` — ${selectedVisitItem.visitObj.loja.endereco}` : ''}
                    {selectedVisitItem.lojaCidade ? ` • ${selectedVisitItem.lojaCidade}/${selectedVisitItem.lojaUf || ''}` : ''}
                  </div>
                </div>
                {storeMapUrl ? (
                  <a
                    href={storeMapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#286FF5] hover:underline self-start sm:self-auto shrink-0"
                  >
                    <span className="material-symbols-outlined text-xs">open_in_new</span>
                    <span>Traçar rota</span>
                  </a>
                ) : (
                  <span className="text-[11px] text-[#73726C] self-start sm:self-auto shrink-0">
                    Nome da loja indisponível para traçar rota.
                  </span>
                )}
              </div>

              {/* Justificativa se Não Realizada */}
              {selectedVisitItem.status === 'nao_realizada' && (
                <div className="p-4 bg-[#FDEEEE] border border-[#F9BCBC] rounded-xl">
                  <div className="flex items-center gap-1.5 font-bold text-[#DD3838] mb-1">
                    <span className="material-symbols-outlined text-base">report</span>
                    <span>Justificativa de Não Realização</span>
                  </div>
                  <p className="text-xs text-[#73726C]">
                    {selectedVisitItem.motivoNaoRealizada ||
                      selectedVisitItem.visitObj?.motivo_nao_realizada ||
                      'Nenhum motivo detalhado foi registrado pelo promotor.'}
                  </p>
                </div>
              )}

              {/* Observação Geral */}
              {selectedVisitItem.visitObj?.observacao_geral && (
                <div className="p-3 bg-[#F7F7F6] border border-[#E4E2DB] rounded-xl">
                  <div className="font-semibold text-[#73726C] mb-1">Observação do Promotor:</div>
                  <p>{selectedVisitItem.visitObj.observacao_geral}</p>
                </div>
              )}

              {/* Galeria de Fotos */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-bold text-sm text-[#171717] flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-base text-[#286FF5]">photo_library</span>
                    <span>Fotos de Evidência ({selectedVisitItem.visitObj?.photos?.length || 0})</span>
                  </h4>
                  {loadingPhotos && <span className="text-[11px] text-[#73726C]">Gerando links seguros...</span>}
                </div>

                {!selectedVisitItem.visitObj?.photos || selectedVisitItem.visitObj.photos.length === 0 ? (
                  <div className="p-6 text-center bg-[#F7F7F6] rounded-xl border border-[#E4E2DB] text-[#73726C]">
                    Nenhuma foto registrada nesta visita.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {selectedVisitItem.visitObj.photos.map((photo) => {
                      const url = signedPhotoUrls[photo.id || photo.storage_path];
                      return (
                        <div
                          key={photo.id || photo.storage_path}
                          className="group relative bg-[#F7F7F6] rounded-xl border border-[#E4E2DB] overflow-hidden flex flex-col"
                        >
                          <div className="aspect-square w-full bg-[#E4E2DB] relative overflow-hidden flex items-center justify-center">
                            {url ? (
                              <img
                                src={url}
                                alt={photo.tipo_foto}
                                className="w-full h-full object-cover cursor-pointer group-hover:scale-105 transition-transform duration-200"
                                onClick={() => setZoomedPhotoUrl(url)}
                              />
                            ) : (
                              <span className="material-symbols-outlined text-2xl text-[#A09E96]">
                                photo_camera
                              </span>
                            )}
                          </div>
                          <div className="p-2 text-[10px] bg-white border-t border-[#E4E2DB]">
                            <div className="font-bold uppercase text-[#286FF5]">{photo.tipo_foto}</div>
                            {photo.legenda && (
                              <div className="text-[#73726C] truncate mt-0.5">{photo.legenda}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Checklist */}
              <div>
                <h4 className="font-bold text-sm text-[#171717] mb-2 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-base text-[#16845B]">checklist</span>
                  <span>Checklist da Visita</span>
                </h4>

                {!selectedVisitItem.visitObj?.checklist_items ||
                selectedVisitItem.visitObj.checklist_items.length === 0 ? (
                  <div className="p-4 text-center bg-[#F7F7F6] rounded-xl border border-[#E4E2DB] text-[#73726C]">
                    Checklist não preenchido ou não iniciado.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {selectedVisitItem.visitObj.checklist_items.map((item) => (
                      <div
                        key={item.id || item.item_key}
                        className={`p-2.5 rounded-xl border flex items-start gap-2 ${
                          item.checked
                            ? 'bg-[#E8F5EE] border-[#B9E5D0] text-[#16845B]'
                            : 'bg-[#F7F7F6] border-[#E4E2DB] text-[#73726C]'
                        }`}
                      >
                        <span className="material-symbols-outlined text-base mt-0.5">
                          {item.checked ? 'check_box' : 'check_box_outline_blank'}
                        </span>
                        <div>
                          <div className="font-medium text-[#171717]">{item.item_label}</div>
                          {item.observacao && (
                            <div className="text-[11px] text-[#73726C] mt-0.5">{item.observacao}</div>
                          )}
                          {item.valor_texto && (
                            <div className="text-[11px] text-[#171717] font-semibold mt-0.5">
                              Valor: {item.valor_texto}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Ocorrências e Rupturas */}
              <div>
                <h4 className="font-bold text-sm text-[#171717] mb-2 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-base text-[#D98A00]">warning</span>
                  <span>Ocorrências e Rupturas</span>
                </h4>

                {!selectedVisitItem.visitObj?.occurrences ||
                selectedVisitItem.visitObj.occurrences.length === 0 ? (
                  <div className="p-4 text-center bg-[#F7F7F6] rounded-xl border border-[#E4E2DB] text-[#73726C]">
                    Nenhuma ocorrência ou ruptura reportada nesta visita.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedVisitItem.visitObj.occurrences.map((occ) => (
                      <div
                        key={occ.id}
                        className="p-3 bg-[#FFF8E6] border border-[#FCE19B] rounded-xl flex items-start justify-between"
                      >
                        <div>
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-[#D98A00] text-white mr-2">
                            {occ.tipo}
                          </span>
                          <span className="font-medium text-[#171717]">{occ.descricao}</span>
                        </div>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            occ.resolvido ? 'bg-[#E8F5EE] text-[#16845B]' : 'bg-[#FDEEEE] text-[#DD3838]'
                          }`}
                        >
                          {occ.resolvido ? 'Resolvido' : 'Pendente'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Validade de Produtos (FIFO) */}
              <div>
                <h4 className="font-bold text-sm text-[#171717] mb-2 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-base text-[#286FF5]">event</span>
                  <span>Controle de Validade de Produtos</span>
                </h4>

                {!selectedVisitItem.visitObj?.validity_items ||
                selectedVisitItem.visitObj.validity_items.length === 0 ? (
                  <div className="p-4 text-center bg-[#F7F7F6] rounded-xl border border-[#E4E2DB] text-[#73726C]">
                    Nenhum apontamento de validade registrado.
                  </div>
                ) : (
                  <div className="border border-[#E4E2DB] rounded-xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#F7F7F6] text-[#73726C] uppercase text-[10px] font-bold border-b border-[#E4E2DB]">
                        <tr>
                          <th className="px-4 py-2">Produto</th>
                          <th className="px-3 py-2">Qtd</th>
                          <th className="px-3 py-2">Vencimento</th>
                          <th className="px-3 py-2">Lote</th>
                          <th className="px-3 py-2">Observação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E4E2DB]">
                        {selectedVisitItem.visitObj.validity_items.map((val) => (
                          <tr key={val.id}>
                            <td className="px-4 py-2 font-medium">{val.produto_nome}</td>
                            <td className="px-3 py-2">{val.quantidade}</td>
                            <td className="px-3 py-2 font-bold text-[#DD3838]">{val.data_vencimento}</td>
                            <td className="px-3 py-2 text-[#73726C]">{val.lote || '—'}</td>
                            <td className="px-3 py-2 text-[#73726C]">{val.observacao || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Footer Modal */}
            <div className="px-6 py-3 border-t border-[#E4E2DB] bg-[#FCFCFB] flex items-center justify-between">
              {selectedVisitItem.visitObj && isWhatsAppShareableVisit(selectedVisitItem.visitObj) ? (
                <button
                  type="button"
                  onClick={() => setShareWhatsAppVisit(selectedVisitItem.visitObj!)}
                  className="px-4 py-2 bg-emerald-600/20 text-emerald-800 border border-emerald-500/40 rounded-xl text-xs font-bold hover:bg-emerald-600/30 transition-colors flex items-center gap-1.5 cursor-pointer"
                  title="Compartilhar relatório desta visita via WhatsApp"
                >
                  <span className="material-symbols-outlined text-sm">share</span>
                  <span>Compartilhar WhatsApp</span>
                </button>
              ) : <div />}

              <button
                onClick={() => setSelectedVisitItem(null)}
                className="px-4 py-2 bg-[#171717] text-white rounded-xl text-xs font-semibold hover:bg-[#2C2C2C] transition-colors cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6.1 Modal Compartilhar WhatsApp */}
      {shareWhatsAppVisit && (
        <ShareWhatsAppModal
          visit={shareWhatsAppVisit}
          onClose={() => setShareWhatsAppVisit(null)}
          onShowToast={onShowToast}
        />
      )}

      {/* 7. Modal de Zoom de Foto */}
      {zoomedPhotoUrl && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setZoomedPhotoUrl(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] overflow-hidden rounded-xl">
            <img src={zoomedPhotoUrl} alt="Foto Ampliada" className="w-full h-full object-contain" />
            <button
              onClick={() => setZoomedPhotoUrl(null)}
              className="absolute top-3 right-3 p-2 rounded-full bg-black/60 text-white hover:bg-black"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
