import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ScreenId, ToastMessage, Visit, RouteItem, SystemSettingsState } from '../types';
import { supabase } from '../lib/supabase';
import { fetchSystemSettings } from '../lib/systemSettings';
import { useAuth } from '../auth/AuthProvider';
import { equipesService } from '../lib/equipesService';
import { supervisoresService } from '../lib/supervisoresService';
import {
  calculateOperationalVisits,
  getLocalDateString,
  OperationalVisitItem,
  DayOfWeekDate
} from '../utils/routePlanner';
import { CHECKLIST_QUANTITY_KEYS } from '../utils/visitExecution';
import { ShareWhatsAppModal } from '../components/ShareWhatsAppModal';

interface VisitsTrackingViewProps {
  onNavigate: (screen: ScreenId) => void;
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

const ITEMS_PER_PAGE = 20;

export const VisitsTrackingView: React.FC<VisitsTrackingViewProps> = ({
  onNavigate,
  onShowToast
}) => {
  const { profile, role } = useAuth();

  // Escopo de Supervisor:
  // Para admin e gestor, preserva visualização global ('all').
  // Para os demais usuários, localiza o supervisor autenticado de forma inequívoca por user_id ou e-mail normalizado.
  const isGlobalManager = role === 'admin' || role === 'gestor';
  const hasInitializedSupervisorFilterRef = useRef(false);

  // 1. Estados de Data Operacional
  const [selectedDate, setSelectedDate] = useState<string>(() => getLocalDateString(new Date()));

  // 2. Estados de Carregamento e Dados
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncText, setLastSyncText] = useState('—');

  // Entidades Brutas
  const [visits, setVisits] = useState<Visit[]>([]);
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
  const [filterSupervisor, setFilterSupervisor] = useState<string>('all');
  const [filterEquipe, setFilterEquipe] = useState<string>('all');
  const [filterPromotor, setFilterPromotor] = useState<string>('all');
  const [filterLoja, setFilterLoja] = useState<string>('all');
  const [filterIndustria, setFilterIndustria] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all'); // 'all' | 'em_andamento' | 'concluida' | 'nao_realizada' | 'pendente'
  const [filterUf, setFilterUf] = useState<string>('all');
  const [filterOcorrencia, setFilterOcorrencia] = useState<string>('all'); // 'all' | 'com_ocorrencia' | 'sem_ocorrencia'
  const [searchQuery, setSearchQuery] = useState('');
  const [showMoreFilters, setShowMoreFilters] = useState(false);

  // 4. Paginação
  const [currentPage, setCurrentPage] = useState<number>(1);

  // 5. Modal de Detalhes da Visita (Somente Leitura)
  const [selectedVisitItem, setSelectedVisitItem] = useState<OperationalVisitItem | null>(null);
  const [signedPhotoUrls, setSignedPhotoUrls] = useState<Record<string, string>>({});
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [photoErrors, setPhotoErrors] = useState<Record<string, boolean>>({});
  const [zoomedPhotoUrl, setZoomedPhotoUrl] = useState<string | null>(null);
  const [sharingVisit, setSharingVisit] = useState<Visit | null>(null);

  // Controle de concorrência e identificador sequencial de requisição
  const reqSeqRef = useRef<number>(0);
  const isFetchingRef = useRef<boolean>(false);

  // 6. Carga de Dados do Supabase com Paginação Segura de Rotas e Proteção de Concorrência
  const loadTrackingData = useCallback(async (isSilent = false) => {
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

        return allRoutes;
      };

      const promotoresPromise = supabase.from('promotores').select('*');
      const industriasPromise = supabase.from('industrias').select('*');
      const settingsPromise = fetchSystemSettings();
      const equipesPromise = equipesService.listEquipes();
      const supervisoresPromise = supervisoresService.listSupervisores();

      const [
        visitsRes,
        allRoutesData,
        promotoresRes,
        industriasRes,
        settingsData,
        equipesRes,
        supervisoresRes
      ] = await Promise.all([
        visitsPromise,
        fetchAllRoutes(),
        promotoresPromise,
        industriasPromise,
        settingsPromise,
        equipesPromise,
        supervisoresPromise
      ]);

      if (visitsRes.error) throw visitsRes.error;

      // Descarta resposta se uma requisição mais recente já foi iniciada
      if (currentSeq !== reqSeqRef.current) return;

      setVisits((visitsRes.data as unknown as Visit[]) || []);
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
      if (currentSeq === reqSeqRef.current) {
        isFetchingRef.current = false;
        setLoading(false);
      }
    }
  }, [selectedDate]);

  // Carga inicial e agendamento de atualização periódica a cada 60 segundos
  useEffect(() => {
    loadTrackingData(false);

    const intervalId = window.setInterval(() => {
      loadTrackingData(true);
    }, 60000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadTrackingData]);

  // Inicialização segura do escopo padrão para supervisor autenticado
  useEffect(() => {
    if (isGlobalManager) return;
    if (hasInitializedSupervisorFilterRef.current) return;
    if (!supervisoresList || supervisoresList.length === 0 || !profile) return;

    const userAuthId = profile.id;
    const userAuthEmail = (profile.email || '').trim().toLowerCase();

    let matchedSupervisor = supervisoresList.find(
      (s) => s.user_id && s.user_id === userAuthId
    );

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

  // Geração de URLs Assinadas Sob Demanda para a Visita Selecionada
  useEffect(() => {
    if (!selectedVisitItem?.visitObj?.photos || selectedVisitItem.visitObj.photos.length === 0) {
      setSignedPhotoUrls({});
      setPhotoErrors({});
      return;
    }

    const photos = selectedVisitItem.visitObj.photos;
    let isCancelled = false;
    setLoadingPhotos(true);
    setPhotoErrors({});

    const generateSignedUrls = async () => {
      const urlMap: Record<string, string> = {};
      const errMap: Record<string, boolean> = {};

      for (const photo of photos) {
        const photoKey = photo.id || photo.storage_path;
        if (photo.storage_path && supabase) {
          try {
            const { data, error: signErr } = await supabase.storage
              .from('visit-photos')
              .createSignedUrl(photo.storage_path, 3600);
            if (signErr || !data?.signedUrl) {
              errMap[photoKey] = true;
            } else {
              urlMap[photoKey] = data.signedUrl;
            }
          } catch (err) {
            console.warn('Erro ao gerar signed URL para foto:', err);
            errMap[photoKey] = true;
          }
        } else {
          errMap[photoKey] = true;
        }
      }

      if (!isCancelled) {
        setSignedPhotoUrls(urlMap);
        setPhotoErrors(errMap);
        setLoadingPhotos(false);
      }
    };

    generateSignedUrls();

    return () => {
      isCancelled = true;
    };
  }, [selectedVisitItem]);

  // Cálculo das Visitas Operacionais do Dia via routePlanner
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

  // Enriquecer cada OperationalVisitItem com Equipe, Supervisor e UF
  const enrichedVisits = useMemo(() => {
    return operationalVisits.map((item) => {
      const meta = promoterMetaMap.get(item.promotorMatricula);
      const supervisor =
        meta?.supervisor ||
        item.visitObj?.promotor && (item.visitObj.promotor as any).supervisor ||
        'Não informado';
      const equipe =
        meta?.equipe ||
        item.visitObj?.promotor && (item.visitObj.promotor as any).equipe ||
        'Geral';
      const uf = item.lojaUf || item.visitObj?.loja?.uf || '';

      const hasOccurrences = Boolean(
        item.visitObj?.occurrences && item.visitObj.occurrences.length > 0
      );

      return {
        ...item,
        supervisor,
        equipe,
        uf,
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
    return Array.from(set.entries())
      .map(([matricula, nome]) => ({ matricula, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
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

  const ufOptions = useMemo(() => {
    const set = new Set<string>();
    enrichedVisits.forEach((v) => {
      if (v.uf) set.add(v.uf.toUpperCase());
    });
    return Array.from(set).sort();
  }, [enrichedVisits]);

  // Filtragem das Visitas Enriquecidas
  const filteredVisits = useMemo(() => {
    return enrichedVisits.filter((item) => {
      if (filterSupervisor !== 'all') {
        if (item.supervisor.toLowerCase() !== filterSupervisor.toLowerCase()) return false;
      }
      if (filterEquipe !== 'all') {
        if (item.equipe.toLowerCase() !== filterEquipe.toLowerCase()) return false;
      }
      if (filterPromotor !== 'all') {
        if (item.promotorMatricula !== filterPromotor) return false;
      }
      if (filterLoja !== 'all') {
        if (item.lojaCodigo !== filterLoja) return false;
      }
      if (filterIndustria !== 'all') {
        if (item.industriaCodigo !== filterIndustria) return false;
      }
      if (filterStatus !== 'all') {
        if (item.status !== filterStatus) return false;
      }
      if (filterUf !== 'all') {
        if ((item.uf || '').toUpperCase() !== filterUf.toUpperCase()) return false;
      }
      if (filterOcorrencia === 'com_ocorrencia' && !item.hasOccurrences) return false;
      if (filterOcorrencia === 'sem_ocorrencia' && item.hasOccurrences) return false;

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
    filterUf,
    filterOcorrencia,
    searchQuery
  ]);

  // Reiniciar página para 1 sempre que os filtros ou busca mudarem
  useEffect(() => {
    setCurrentPage(1);
  }, [
    selectedDate,
    filterSupervisor,
    filterEquipe,
    filterPromotor,
    filterLoja,
    filterIndustria,
    filterStatus,
    filterUf,
    filterOcorrencia,
    searchQuery
  ]);

  // Indicadores Operacionais (Linha Única Compacta)
  const kpis = useMemo(() => {
    const baseList = filteredVisits;
    const programadas = baseList.length;
    const concluidas = baseList.filter((v) => v.status === 'concluida').length;
    const emAndamento = baseList.filter((v) => v.status === 'em_andamento').length;
    const pendentes = baseList.filter((v) => v.status === 'pendente' || v.status === 'planejada').length;
    const naoRealizadas = baseList.filter((v) => v.status === 'nao_realizada').length;

    return {
      programadas,
      concluidas,
      emAndamento,
      pendentes,
      naoRealizadas
    };
  }, [filteredVisits]);

  // Ordenação prioritária: Pendentes e Em Andamento primeiro, seguidas de Concluídas e Não Realizadas
  const sortedVisits = useMemo(() => {
    const statusPriority: Record<string, number> = {
      em_andamento: 1,
      pendente: 2,
      planejada: 2,
      nao_realizada: 3,
      concluida: 4
    };

    return [...filteredVisits].sort((a, b) => {
      const pA = statusPriority[a.status] || 99;
      const pB = statusPriority[b.status] || 99;
      if (pA !== pB) return pA - pB;
      return a.lojaNome.localeCompare(b.lojaNome);
    });
  }, [filteredVisits]);

  // Paginação: fatiamento de 20 itens por página
  const totalPages = Math.max(1, Math.ceil(sortedVisits.length / ITEMS_PER_PAGE));
  const paginatedVisits = useMemo(() => {
    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
    return sortedVisits.slice(startIdx, startIdx + ITEMS_PER_PAGE);
  }, [sortedVisits, currentPage]);

  // Badges de status compactos
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'concluida':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
            Concluída
          </span>
        );
      case 'em_andamento':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-800 border border-blue-300 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
            Em Andamento
          </span>
        );
      case 'nao_realizada':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-800 border border-rose-300">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
            Não Realizada
          </span>
        );
      case 'pendente':
      case 'planejada':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />
            Pendente
          </span>
        );
    }
  };

  const formatTime = (isoString?: string | null) => {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '—';
    }
  };

  const handleResetFilters = () => {
    setFilterSupervisor('all');
    setFilterEquipe('all');
    setFilterPromotor('all');
    setFilterLoja('all');
    setFilterIndustria('all');
    setFilterStatus('all');
    setFilterUf('all');
    setFilterOcorrencia('all');
    setSearchQuery('');
    setCurrentPage(1);
  };

  const hasActiveFilters =
    filterSupervisor !== 'all' ||
    filterEquipe !== 'all' ||
    filterPromotor !== 'all' ||
    filterLoja !== 'all' ||
    filterIndustria !== 'all' ||
    filterStatus !== 'all' ||
    filterUf !== 'all' ||
    filterOcorrencia !== 'all' ||
    searchQuery.trim() !== '';

  return (
    <div className="w-full px-4 lg:px-8 py-6 max-w-[1400px] mx-auto space-y-6">
      {/* 1. CABEÇALHO SIMPLES */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[#CFCDC5]">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#171717] tracking-tight">
              Acompanhamento de Visitas
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#F7F6F2] border border-[#CFCDC5] text-[#171717] font-mono text-[11px]">
              <span className={`w-1.5 h-1.5 rounded-full ${loading ? 'bg-amber-500 animate-ping' : 'bg-emerald-500'}`} />
              {loading ? 'Consultando…' : `Atualizado às ${lastSyncText}`}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-[#77766F] mt-0.5">
            Monitore a execução dos atendimentos e consulte as evidências de campo.
          </p>
        </div>

        {/* Data Operacional + Botão Atualizar + Link Controle Diário */}
        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
          <div className="flex items-center bg-[#F7F6F2] border border-[#CFCDC5] px-3 py-1.5 rounded-xl shadow-xs">
            <span className="material-symbols-outlined text-[#77766F] mr-2 text-[18px]">calendar_today</span>
            <input
              type="date"
              aria-label="Data operacional"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent font-semibold text-xs text-[#171717] focus:outline-hidden cursor-pointer"
            />
          </div>

          <button
            onClick={() => loadTrackingData(false)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#F7F6F2] hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] text-xs font-semibold shadow-xs transition-all cursor-pointer disabled:opacity-50"
            title="Atualizar dados agora"
          >
            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>sync</span>
            <span className="hidden sm:inline">Atualizar</span>
          </button>

          <button
            onClick={() => onNavigate('presenca')}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#171717] hover:bg-[#2C2C2C] text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
            title="Ir para o Controle Diário"
          >
            <span className="material-symbols-outlined text-[18px]">assignment_turned_in</span>
            <span>Ver Controle Diário</span>
          </button>
        </div>
      </div>

      {/* Alerta de Erro se houver */}
      {error && (
        <div className="p-3.5 bg-rose-50 border border-rose-300 rounded-xl flex items-center gap-2.5 text-xs text-rose-800">
          <span className="material-symbols-outlined text-base">error</span>
          <span>{error}</span>
        </div>
      )}

      {/* 2. INDICADORES OPERACIONAIS COMPACTOS (LINHA ÚNICA) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* 1. Programadas (Neutro) */}
        <div className="p-3.5 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] flex items-center justify-between shadow-xs">
          <div>
            <span className="text-[10px] font-bold text-[#77766F] uppercase tracking-wider font-mono">Programadas</span>
            <div className="text-2xl font-black text-[#171717] font-mono mt-0.5">
              {loading ? '—' : kpis.programadas}
            </div>
            <p className="text-[10px] text-[#77766F] mt-0.5">Total de visitas previstas</p>
          </div>
          <div className="p-2 rounded-lg bg-white text-[#171717] border border-[#CFCDC5]">
            <span className="material-symbols-outlined text-xl">event</span>
          </div>
        </div>

        {/* 2. Concluídas (Verde) */}
        <div className="p-3.5 rounded-xl bg-emerald-50/40 border border-emerald-300 flex items-center justify-between shadow-xs">
          <div>
            <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider font-mono">Concluídas</span>
            <div className="text-2xl font-black text-emerald-700 font-mono mt-0.5">
              {loading ? '—' : kpis.concluidas}
            </div>
            <p className="text-[10px] text-emerald-800 mt-0.5">Visitas finalizadas</p>
          </div>
          <div className="p-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="material-symbols-outlined text-xl">task_alt</span>
          </div>
        </div>

        {/* 3. Em Andamento (Azul) */}
        <div className="p-3.5 rounded-xl bg-blue-50/40 border border-blue-300 flex items-center justify-between shadow-xs">
          <div>
            <span className="text-[10px] font-bold text-blue-800 uppercase tracking-wider font-mono">Em Andamento</span>
            <div className="text-2xl font-black text-blue-700 font-mono mt-0.5">
              {loading ? '—' : kpis.emAndamento}
            </div>
            <p className="text-[10px] text-blue-800 mt-0.5">Em atendimento agora</p>
          </div>
          <div className="p-2 rounded-lg bg-blue-50 text-blue-700 border border-blue-200">
            <span className="material-symbols-outlined text-xl">timelapse</span>
          </div>
        </div>

        {/* 4. Pendentes (Âmbar) */}
        <div className="p-3.5 rounded-xl bg-amber-50/40 border border-amber-300 flex items-center justify-between shadow-xs">
          <div>
            <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider font-mono">Pendentes</span>
            <div className="text-2xl font-black text-amber-700 font-mono mt-0.5">
              {loading ? '—' : kpis.pendentes}
            </div>
            <p className="text-[10px] text-amber-800 mt-0.5">Ainda não iniciadas</p>
          </div>
          <div className="p-2 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
            <span className="material-symbols-outlined text-xl">schedule</span>
          </div>
        </div>

        {/* 5. Não Realizadas (Vermelho) */}
        <div className="p-3.5 rounded-xl bg-rose-50/40 border border-rose-300 flex items-center justify-between shadow-xs col-span-2 sm:col-span-1">
          <div>
            <span className="text-[10px] font-bold text-rose-800 uppercase tracking-wider font-mono">Não Realizadas</span>
            <div className="text-2xl font-black text-rose-700 font-mono mt-0.5">
              {loading ? '—' : kpis.naoRealizadas}
            </div>
            <p className="text-[10px] text-rose-800 mt-0.5">Com justificativa</p>
          </div>
          <div className="p-2 rounded-lg bg-rose-50 text-rose-700 border border-rose-200">
            <span className="material-symbols-outlined text-xl">cancel</span>
          </div>
        </div>
      </div>

      {/* 3. ÁREA DE FILTROS COMPACTA */}
      <div className="p-4 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] space-y-3 shadow-xs">
        {/* Filtros Principais Sempre Visíveis */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5">
          {/* Busca por Loja, Promotor ou Indústria */}
          <div className="lg:col-span-4 flex items-center bg-[#EAE8E2] border border-[#CFCDC5] px-3 py-1.5 rounded-lg">
            <span className="material-symbols-outlined text-[#77766F] mr-2 text-[18px]">search</span>
            <input
              type="text"
              aria-label="Buscar loja, promotor ou indústria"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por loja, promotor, indústria..."
              className="w-full bg-transparent text-xs text-[#171717] placeholder:text-[#77766F] focus:outline-hidden"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-[#77766F] hover:text-[#171717] p-1 cursor-pointer">
                ✕
              </button>
            )}
          </div>

          {/* Supervisor */}
          <div className="lg:col-span-3 flex items-center bg-[#EAE8E2] border border-[#CFCDC5] px-3 py-1.5 rounded-lg">
            <span className="material-symbols-outlined text-[#77766F] mr-2 text-[18px]">supervisor_account</span>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[9px] uppercase font-mono font-bold text-[#77766F]">Supervisor</span>
              <select
                aria-label="Filtrar por supervisor"
                value={filterSupervisor}
                onChange={(e) => setFilterSupervisor(e.target.value)}
                className="bg-transparent text-xs text-[#171717] focus:outline-hidden cursor-pointer font-medium"
              >
                <option value="all" className="bg-[#F7F6F2]">Todos os supervisores</option>
                {supervisorOptions.map((s) => (
                  <option key={s} value={s} className="bg-[#F7F6F2]">
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Status da Visita */}
          <div className="lg:col-span-3 flex items-center bg-[#EAE8E2] border border-[#CFCDC5] px-3 py-1.5 rounded-lg">
            <span className="material-symbols-outlined text-[#77766F] mr-2 text-[18px]">fact_check</span>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[9px] uppercase font-mono font-bold text-[#77766F]">Status</span>
              <select
                aria-label="Filtrar por status"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-transparent text-xs text-[#171717] focus:outline-hidden cursor-pointer font-medium"
              >
                <option value="all" className="bg-[#F7F6F2]">Todos os status</option>
                <option value="concluida" className="bg-[#F7F6F2]">Concluída</option>
                <option value="em_andamento" className="bg-[#F7F6F2]">Em Andamento</option>
                <option value="pendente" className="bg-[#F7F6F2]">Pendente</option>
                <option value="nao_realizada" className="bg-[#F7F6F2]">Não Realizada</option>
              </select>
            </div>
          </div>

          {/* Ações de Filtro: Mais Filtros e Limpar */}
          <div className="lg:col-span-2 flex items-center justify-end gap-2">
            <button
              onClick={() => setShowMoreFilters(!showMoreFilters)}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-1 px-3 py-2 rounded-lg border text-xs font-bold transition-all cursor-pointer ${
                showMoreFilters
                  ? 'bg-[#171717] text-white border-black'
                  : 'bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] border-[#CFCDC5]'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">tune</span>
              <span>{showMoreFilters ? 'Menos filtros' : 'Mais filtros'}</span>
            </button>

            {hasActiveFilters && (
              <button
                onClick={handleResetFilters}
                className="px-2.5 py-2 rounded-lg bg-[#EAE8E2] hover:bg-rose-100 text-rose-700 border border-[#CFCDC5] text-xs font-bold transition-all cursor-pointer"
                title="Limpar todos os filtros"
              >
                Limpar
              </button>
            )}
          </div>
        </div>

        {/* Bloco Expansível: Mais Filtros */}
        {showMoreFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 pt-3 border-t border-[#CFCDC5] animate-in fade-in duration-150">
            {/* Equipe */}
            <div className="flex flex-col bg-[#EAE8E2] border border-[#CFCDC5] px-3 py-1.5 rounded-lg">
              <span className="text-[9px] uppercase font-mono font-bold text-[#77766F]">Equipe</span>
              <select
                value={filterEquipe}
                onChange={(e) => setFilterEquipe(e.target.value)}
                className="bg-transparent text-xs text-[#171717] focus:outline-hidden cursor-pointer font-medium"
              >
                <option value="all" className="bg-[#F7F6F2]">Todas as equipes</option>
                {equipeOptions.map((eq) => (
                  <option key={eq} value={eq} className="bg-[#F7F6F2]">
                    {eq}
                  </option>
                ))}
              </select>
            </div>

            {/* Promotor Específico */}
            <div className="flex flex-col bg-[#EAE8E2] border border-[#CFCDC5] px-3 py-1.5 rounded-lg">
              <span className="text-[9px] uppercase font-mono font-bold text-[#77766F]">Promotor</span>
              <select
                value={filterPromotor}
                onChange={(e) => setFilterPromotor(e.target.value)}
                className="bg-transparent text-xs text-[#171717] focus:outline-hidden cursor-pointer font-medium"
              >
                <option value="all" className="bg-[#F7F6F2]">Todos os promotores</option>
                {promotorOptions.map((p) => (
                  <option key={p.matricula} value={p.matricula} className="bg-[#F7F6F2]">
                    {p.nome}
                  </option>
                ))}
              </select>
            </div>

            {/* Loja */}
            <div className="flex flex-col bg-[#EAE8E2] border border-[#CFCDC5] px-3 py-1.5 rounded-lg">
              <span className="text-[9px] uppercase font-mono font-bold text-[#77766F]">Loja / PDV</span>
              <select
                value={filterLoja}
                onChange={(e) => setFilterLoja(e.target.value)}
                className="bg-transparent text-xs text-[#171717] focus:outline-hidden cursor-pointer font-medium"
              >
                <option value="all" className="bg-[#F7F6F2]">Todas as lojas</option>
                {lojaOptions.map((lj) => (
                  <option key={lj.codigo} value={lj.codigo} className="bg-[#F7F6F2]">
                    {lj.nome}
                  </option>
                ))}
              </select>
            </div>

            {/* Indústria */}
            <div className="flex flex-col bg-[#EAE8E2] border border-[#CFCDC5] px-3 py-1.5 rounded-lg">
              <span className="text-[9px] uppercase font-mono font-bold text-[#77766F]">Indústria</span>
              <select
                value={filterIndustria}
                onChange={(e) => setFilterIndustria(e.target.value)}
                className="bg-transparent text-xs text-[#171717] focus:outline-hidden cursor-pointer font-medium"
              >
                <option value="all" className="bg-[#F7F6F2]">Todas as indústrias</option>
                {industriaOptions.map((ind) => (
                  <option key={ind} value={ind} className="bg-[#F7F6F2]">
                    {ind}
                  </option>
                ))}
              </select>
            </div>

            {/* UF / Região */}
            <div className="flex flex-col bg-[#EAE8E2] border border-[#CFCDC5] px-3 py-1.5 rounded-lg">
              <span className="text-[9px] uppercase font-mono font-bold text-[#77766F]">UF / Região</span>
              <select
                value={filterUf}
                onChange={(e) => setFilterUf(e.target.value)}
                className="bg-transparent text-xs text-[#171717] focus:outline-hidden cursor-pointer font-medium"
              >
                <option value="all" className="bg-[#F7F6F2]">Todos os Estados</option>
                {ufOptions.map((uf) => (
                  <option key={uf} value={uf} className="bg-[#F7F6F2]">
                    {uf}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* 4. TABELA PRINCIPAL DE VISITAS (CENTRAL DA PÁGINA) */}
      <div className="bg-white rounded-xl border border-[#CFCDC5] shadow-xs overflow-hidden">
        {/* Barra superior de contagem e data */}
        <div className="px-5 py-3 border-b border-[#CFCDC5] flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-[#F7F6F2]">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-[#171717]">Atendimentos da Grade</span>
            <span className="px-2 py-0.5 rounded-full bg-[#EAE8E2] border border-[#CFCDC5] text-xs font-mono font-semibold text-[#5F5F5F]">
              {selectedDate}
            </span>
          </div>

          <div className="text-xs text-[#77766F]">
            Exibindo <strong className="text-[#171717]">{paginatedVisits.length}</strong> de{' '}
            <strong className="text-[#171717]">{filteredVisits.length}</strong> visitas filtradas
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-[#77766F] flex flex-col items-center justify-center gap-3">
            <span className="material-symbols-outlined text-3xl animate-spin text-[#171717]">sync</span>
            <p className="text-xs font-semibold">Carregando visitas operacionais...</p>
          </div>
        ) : filteredVisits.length === 0 ? (
          <div className="p-12 text-center text-[#77766F]">
            <span className="material-symbols-outlined text-4xl text-[#CFCDC5] mb-2">event_busy</span>
            <p className="text-sm font-bold text-[#171717]">Nenhuma visita encontrada</p>
            <p className="text-xs text-[#77766F] mt-1">
              Verifique a data selecionada ou ajuste os filtros aplicados.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#F7F6F2] text-[10px] font-bold text-[#77766F] uppercase tracking-wider border-b border-[#CFCDC5]">
                  <th className="px-5 py-3">Loja / PDV</th>
                  <th className="px-4 py-3">Indústria</th>
                  <th className="px-4 py-3">Promotor</th>
                  <th className="px-4 py-3">Horário</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#CFCDC5] text-xs">
                {paginatedVisits.map((item) => {
                  const v = item.visitObj;
                  const photoCount = v?.photos?.length || 0;
                  const occCount = v?.occurrences?.length || 0;

                  return (
                    <tr
                      key={item.key}
                      className="hover:bg-[#F7F6F2]/60 transition-colors"
                    >
                      {/* Loja / PDV */}
                      <td className="px-5 py-3.5">
                        <div className="font-bold text-[#171717] text-xs">{item.lojaNome}</div>
                        <div className="text-[11px] text-[#77766F] mt-0.5">
                          {item.lojaCidade ? `${item.lojaCidade}${item.uf ? `/${item.uf}` : ''}` : `Cód: ${item.lojaCodigo}`}
                          {item.lojaCidade && item.lojaCodigo ? ` • Cód: ${item.lojaCodigo}` : ''}
                        </div>
                      </td>

                      {/* Indústria */}
                      <td className="px-4 py-3.5">
                        <span className="font-semibold text-[#171717]">{item.industriaNome}</span>
                        <div className="text-[10px] text-[#77766F] font-mono">{item.industriaCodigo}</div>
                      </td>

                      {/* Promotor */}
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-[#171717]">{item.promotorNome}</div>
                        <div className="text-[11px] text-[#77766F]">
                          {item.equipe !== 'Geral' ? `${item.equipe} • ` : ''}Sup: {item.supervisor}
                        </div>
                      </td>

                      {/* Horário */}
                      <td className="px-4 py-3.5">
                        {v?.started_at ? (
                          <div className="space-y-0.5">
                            <div className="text-[#171717] font-semibold">
                              Início: {formatTime(v.started_at)}
                            </div>
                            <div className="text-[11px] text-[#77766F]">
                              {v.completed_at ? `Fim: ${formatTime(v.completed_at)}` : 'Em andamento'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[#77766F] italic">Não iniciada</span>
                        )}
                      </td>

                      {/* Status + Evidências */}
                      <td className="px-4 py-3.5">
                        <div className="flex flex-col gap-1 items-start">
                          {renderStatusBadge(item.status)}
                          <div className="flex items-center gap-1.5 text-[10px] text-[#77766F]">
                            {photoCount > 0 && (
                              <span
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-[#EAE8E2] border border-[#CFCDC5]"
                                title={`${photoCount} fotos anexadas`}
                              >
                                <span className="material-symbols-outlined text-[12px]">photo_camera</span>
                                {photoCount}
                              </span>
                            )}
                            {occCount > 0 && (
                              <span
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-amber-50 text-amber-800 border border-amber-300"
                                title={`${occCount} ocorrências`}
                              >
                                <span className="material-symbols-outlined text-[12px]">warning</span>
                                {occCount}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Ação */}
                      <td className="px-4 py-3.5 text-right">
                        <button
                          onClick={() => setSelectedVisitItem(item)}
                          className="px-3 py-1.5 rounded-lg bg-[#F7F6F2] hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] font-bold text-xs shadow-xs transition-all cursor-pointer"
                        >
                          Ver detalhes
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Rodapé de Paginação */}
        {!loading && filteredVisits.length > 0 && (
          <div className="px-5 py-3 border-t border-[#CFCDC5] flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#F7F6F2]">
            <div className="text-xs text-[#77766F]">
              Página <strong className="text-[#171717]">{currentPage}</strong> de{' '}
              <strong className="text-[#171717]">{totalPages}</strong> ({filteredVisits.length} resultados)
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-[#CFCDC5] text-xs font-semibold text-[#171717] hover:bg-[#E4E2DB] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title="Primeira página"
              >
                «
              </button>
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded-lg bg-white border border-[#CFCDC5] text-xs font-semibold text-[#171717] hover:bg-[#E4E2DB] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                Anterior
              </button>
              <span className="px-3 py-1.5 text-xs font-mono font-bold text-[#171717]">
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 rounded-lg bg-white border border-[#CFCDC5] text-xs font-semibold text-[#171717] hover:bg-[#E4E2DB] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                Próxima
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-[#CFCDC5] text-xs font-semibold text-[#171717] hover:bg-[#E4E2DB] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title="Última página"
              >
                »
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 5. MODAL REFORMULADO "VER DETALHES" */}
      {selectedVisitItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4">
          <div className="bg-white rounded-2xl border border-[#CFCDC5] shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Cabeçalho do Modal */}
            <div className="px-5 py-3.5 border-b border-[#CFCDC5] flex items-center justify-between bg-[#F7F6F2]">
              <div className="min-w-0 pr-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-extrabold text-[#171717] truncate">
                    {selectedVisitItem.lojaNome}
                  </h3>
                  {renderStatusBadge(selectedVisitItem.status)}
                </div>
                <p className="text-[11px] text-[#77766F] mt-0.5 truncate">
                  {selectedVisitItem.lojaCidade
                    ? `${selectedVisitItem.lojaCidade}${
                        selectedVisitItem.lojaUf || selectedVisitItem.visitObj?.loja?.uf
                          ? `/${selectedVisitItem.lojaUf || selectedVisitItem.visitObj?.loja?.uf}`
                          : ''
                      } • `
                    : ''}
                  {selectedVisitItem.industriaNome} ({selectedVisitItem.industriaCodigo}) • Promotor: {selectedVisitItem.promotorNome}
                </p>
              </div>
              <button
                onClick={() => setSelectedVisitItem(null)}
                className="p-1 rounded-lg hover:bg-[#E4E2DB] text-[#77766F] hover:text-[#171717] transition-colors cursor-pointer shrink-0"
                title="Fechar"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            {/* Conteúdo com Scroll */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs text-[#171717]">
              {/* Grade de Informações Operacionais */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5]">
                <div>
                  <span className="text-[10px] text-[#77766F] font-bold uppercase block">Data</span>
                  <span className="font-semibold">{selectedVisitItem.dataStr}</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#77766F] font-bold uppercase block">Início</span>
                  <span className="font-semibold">{formatTime(selectedVisitItem.startedAt)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#77766F] font-bold uppercase block">Conclusão</span>
                  <span className="font-semibold">{formatTime(selectedVisitItem.completedAt)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#77766F] font-bold uppercase block">Duração</span>
                  <span className="font-semibold">{selectedVisitItem.duracaoFormatada || '—'}</span>
                </div>
              </div>

              {/* Justificativa de Não Realização */}
              {(selectedVisitItem.status === 'nao_realizada' || selectedVisitItem.motivoNaoRealizada) && (
                <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-rose-800">
                  <div className="font-bold flex items-center gap-1.5 mb-1">
                    <span className="material-symbols-outlined text-sm">report</span>
                    <span>Motivo da Não Realização:</span>
                  </div>
                  <p className="text-xs">
                    {selectedVisitItem.motivoNaoRealizada ||
                      selectedVisitItem.visitObj?.motivo_nao_realizada ||
                      'Não informado pelo promotor.'}
                  </p>
                </div>
              )}

              {/* Checklist Operacional Simplificado */}
              {(() => {
                const items = selectedVisitItem.visitObj?.checklist_items || [];
                const currentQtyItems = items.filter((item) => CHECKLIST_QUANTITY_KEYS.has(item.item_key));
                const legacyItems = items.filter((item) => !CHECKLIST_QUANTITY_KEYS.has(item.item_key));

                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold uppercase text-[11px] text-[#171717] flex items-center gap-1">
                        <span className="material-symbols-outlined text-emerald-600 text-sm">fact_check</span>
                        Checklist Operacional:
                      </span>
                    </div>

                    {currentQtyItems.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {currentQtyItems.map((item, idx) => (
                          <div key={idx} className="p-2.5 rounded-xl bg-white border border-emerald-300 flex justify-between items-center shadow-2xs">
                            <span className="text-[#5F5F5F] text-xs">{item.item_label}</span>
                            <span className="text-sm font-black text-[#171717] px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200">
                              {item.valor_texto && item.valor_texto.trim() !== '' ? item.valor_texto : '0'}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-3 text-center bg-[#F7F6F2] rounded-xl border border-[#CFCDC5] text-[#77766F] italic">
                        Nenhum item do checklist operacional preenchido.
                      </div>
                    )}

                    {legacyItems.length > 0 && (
                      <details className="p-2.5 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] text-xs">
                        <summary className="cursor-pointer font-bold text-[#5F5F5F] uppercase flex items-center justify-between">
                          <span>Outros Itens Históricos ({legacyItems.length})</span>
                          <span className="text-[10px] text-[#77766F] lowercase">expandir</span>
                        </summary>
                        <div className="space-y-1 pt-2">
                          {legacyItems.map((item, idx) => (
                            <div key={idx} className="p-1.5 rounded bg-white border border-[#CFCDC5] flex justify-between items-center text-[11px]">
                              <span className={item.checked ? 'text-emerald-700 font-bold' : 'text-[#77766F]'}>
                                {item.checked ? '✓' : '✗'} {item.item_label}
                              </span>
                              {item.valor_texto && <span className="font-bold text-[#171717]">{item.valor_texto}</span>}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })()}

              {/* Evidências Fotográficas */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold uppercase text-[11px] text-[#171717] flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-blue-600 text-sm">photo_library</span>
                    <span>Evidências Fotográficas ({selectedVisitItem.visitObj?.photos?.length || 0})</span>
                  </span>
                  {loadingPhotos && (
                    <span className="text-[10px] text-[#77766F] animate-pulse">Gerando links autorizados...</span>
                  )}
                </div>

                {!selectedVisitItem.visitObj?.photos || selectedVisitItem.visitObj.photos.length === 0 ? (
                  <div className="p-3 text-center bg-[#F7F6F2] rounded-xl border border-[#CFCDC5] text-[#77766F] italic">
                    Nenhuma foto registrada nesta visita.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {selectedVisitItem.visitObj.photos.map((photo) => {
                      const photoKey = photo.id || photo.storage_path;
                      const url = signedPhotoUrls[photoKey];
                      const isError = photoErrors[photoKey];

                      return (
                        <div
                          key={photoKey}
                          className="group relative bg-[#F7F6F2] rounded-xl border border-[#CFCDC5] overflow-hidden flex flex-col shadow-2xs"
                        >
                          <div className="aspect-square w-full bg-[#EAE8E2] relative overflow-hidden flex items-center justify-center">
                            {url ? (
                              <img
                                src={url}
                                alt={photo.tipo_foto}
                                className="w-full h-full object-cover cursor-pointer group-hover:scale-105 transition-transform duration-200"
                                onClick={() => setZoomedPhotoUrl(url)}
                                onError={() => {
                                  setPhotoErrors((prev) => ({ ...prev, [photoKey]: true }));
                                }}
                              />
                            ) : isError ? (
                              <div className="flex flex-col items-center justify-center p-2 text-center text-rose-600">
                                <span className="material-symbols-outlined text-xl">broken_image</span>
                                <span className="text-[9px] mt-0.5">Falha ao carregar</span>
                              </div>
                            ) : (
                              <span className="material-symbols-outlined text-2xl text-[#CFCDC5] animate-pulse">
                                photo_camera
                              </span>
                            )}
                          </div>
                          <div className="p-1.5 text-[10px] bg-white border-t border-[#CFCDC5]">
                            <div className="font-bold uppercase text-blue-700 truncate">{photo.tipo_foto}</div>
                            {photo.legenda && (
                              <div className="text-[#77766F] truncate mt-0.5">{photo.legenda}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Ocorrências */}
              <div className="space-y-2">
                <span className="font-bold uppercase text-[11px] text-[#171717] flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-amber-600 text-sm">warning</span>
                  <span>Ocorrências e Rupturas ({selectedVisitItem.visitObj?.occurrences?.length || 0})</span>
                </span>

                {!selectedVisitItem.visitObj?.occurrences || selectedVisitItem.visitObj.occurrences.length === 0 ? (
                  <div className="p-3 text-center bg-[#F7F6F2] rounded-xl border border-[#CFCDC5] text-[#77766F] italic">
                    Nenhuma ocorrência reportada nesta visita.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {selectedVisitItem.visitObj.occurrences.map((occ) => (
                      <div
                        key={occ.id}
                        className="p-2.5 bg-amber-50/50 border border-amber-300 rounded-xl flex items-center justify-between"
                      >
                        <div className="min-w-0 pr-2">
                          <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-600 text-white mr-1.5">
                            {occ.tipo}
                          </span>
                          <span className="font-semibold text-xs text-[#171717]">{occ.descricao}</span>
                        </div>
                        <span
                          className={`text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                            occ.resolvido ? 'bg-emerald-50 text-emerald-800 border border-emerald-300' : 'bg-rose-50 text-rose-800 border border-rose-300'
                          }`}
                        >
                          {occ.resolvido ? 'Resolvido' : 'Pendente'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Validade de Produtos */}
              {selectedVisitItem.visitObj?.validity_items && selectedVisitItem.visitObj.validity_items.length > 0 && (
                <div className="space-y-2">
                  <span className="font-bold uppercase text-[11px] text-[#171717] flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-purple-600 text-sm">event</span>
                    <span>Controle de Validade ({selectedVisitItem.visitObj.validity_items.length})</span>
                  </span>

                  <div className="border border-[#CFCDC5] rounded-xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#F7F6F2] text-[#77766F] uppercase text-[9px] font-bold border-b border-[#CFCDC5]">
                        <tr>
                          <th className="px-3 py-1.5">Produto</th>
                          <th className="px-2 py-1.5">Qtd</th>
                          <th className="px-2 py-1.5">Vencimento</th>
                          <th className="px-2 py-1.5">Lote</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#CFCDC5]">
                        {selectedVisitItem.visitObj.validity_items.map((val) => (
                          <tr key={val.id}>
                            <td className="px-3 py-1.5 font-medium">{val.produto_nome}</td>
                            <td className="px-2 py-1.5">{val.quantidade}</td>
                            <td className="px-2 py-1.5 font-bold text-rose-700">{val.data_vencimento}</td>
                            <td className="px-2 py-1.5 text-[#77766F]">{val.lote || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Rodapé do Modal */}
            <div className="px-5 py-3 border-t border-[#CFCDC5] bg-[#F7F6F2] flex items-center justify-between">
              {selectedVisitItem.visitObj ? (
                <button
                  type="button"
                  onClick={() => setSharingVisit(selectedVisitItem.visitObj!)}
                  className="px-3.5 py-2 bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-800 border border-emerald-600/30 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">share</span>
                  <span>Compartilhar WhatsApp</span>
                </button>
              ) : <div />}
              <button
                onClick={() => setSelectedVisitItem(null)}
                className="px-4 py-2 bg-[#171717] hover:bg-[#2C2C2C] text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. MODAL DE ZOOM DE FOTO */}
      {zoomedPhotoUrl && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setZoomedPhotoUrl(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] overflow-hidden rounded-xl">
            <img src={zoomedPhotoUrl} alt="Foto Ampliada" className="w-full h-full object-contain" />
            <button
              onClick={() => setZoomedPhotoUrl(null)}
              className="absolute top-3 right-3 p-2 rounded-full bg-black/60 text-white hover:bg-black cursor-pointer"
              title="Fechar visualização"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
        </div>
      )}

      {/* 7. MODAL DE COMPARTILHAMENTO WHATSAPP */}
      {sharingVisit && (
        <ShareWhatsAppModal
          visit={sharingVisit}
          industry={sharingVisit.industria ? ({ codigo: sharingVisit.industria.codigo, nome: sharingVisit.industria.nome } as any) : null}
          onClose={() => setSharingVisit(null)}
          onShowToast={onShowToast}
        />
      )}
    </div>
  );
};
