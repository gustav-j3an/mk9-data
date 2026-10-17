import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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

interface VisitsTrackingViewProps {
  onNavigate: (screen: ScreenId) => void;
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

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
  const [filterOcorrencia, setFilterOcorrencia] = useState<string>('all'); // 'all' | 'com_ocorrencia' | 'sem_ocorrencia'
  const [searchQuery, setSearchQuery] = useState('');

  // 4. Modal / Drawer de Detalhes da Visita (Somente Leitura)
  const [selectedVisitItem, setSelectedVisitItem] = useState<OperationalVisitItem | null>(null);
  const [signedPhotoUrls, setSignedPhotoUrls] = useState<Record<string, string>>({});
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [zoomedPhotoUrl, setZoomedPhotoUrl] = useState<string | null>(null);

  // Controle de concorrência e identificador sequencial de requisição
  const reqSeqRef = useRef<number>(0);
  const isFetchingRef = useRef<boolean>(false);

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
      // Libera o estado de carregamento e o semáforo de auto-refresh apenas se esta requisição ainda for a mais recente
      if (currentSeq === reqSeqRef.current) {
        isFetchingRef.current = false;
        setLoading(false);
      }
    }
  }, [selectedDate]);

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
        if (item.status !== filterStatus) return false;
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
    const totalPrevistas = baseList.length;
    const emAndamento = baseList.filter((v) => v.status === 'em_andamento').length;
    const concluidas = baseList.filter((v) => v.status === 'concluida').length;
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
          emAndamento: 0,
          naoRealizadas: 0,
          pendentes: 0
        });
      }
      const p = map.get(v.promotorMatricula)!;
      p.previstas++;
      if (v.status === 'concluida') p.concluidas++;
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
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {/* 1. Visitas Previstas (Prioritário) */}
        <div className="bg-white p-4 rounded-xl border-2 border-[#E4E2DB] shadow-xs">
          <div className="flex items-center justify-between text-[#73726C] text-xs font-semibold mb-1">
            <span>Visitas Previstas</span>
            <span className="material-symbols-outlined text-base text-[#171717]">event</span>
          </div>
          <div className="text-2xl font-extrabold text-[#171717]">{kpis.totalPrevistas}</div>
          <div className="text-[11px] text-[#73726C] mt-1">{kpis.promotoresEscalados} promotores na escala</div>
        </div>

        {/* 2. Em Andamento (Prioritário) */}
        <div className="bg-white p-4 rounded-xl border-2 border-[#C3D9FD] shadow-xs bg-[#EBF2FE]/20">
          <div className="flex items-center justify-between text-[#286FF5] text-xs font-semibold mb-1">
            <span>Em Andamento</span>
            <span className="material-symbols-outlined text-base">timelapse</span>
          </div>
          <div className="text-2xl font-extrabold text-[#286FF5]">{kpis.emAndamento}</div>
          <div className="text-[11px] text-[#73726C] mt-1">visitas em campo agora</div>
        </div>

        {/* 3. Concluídas (Prioritário) */}
        <div className="bg-white p-4 rounded-xl border-2 border-[#B9E5D0] shadow-xs bg-[#E8F5EE]/20">
          <div className="flex items-center justify-between text-[#16845B] text-xs font-semibold mb-1">
            <span>Concluídas</span>
            <span className="material-symbols-outlined text-base">task_alt</span>
          </div>
          <div className="text-2xl font-extrabold text-[#16845B]">{kpis.concluidas}</div>
          <div className="text-[11px] text-[#16845B] font-semibold mt-1">{kpis.aderencia}% de aderência</div>
        </div>

        {/* 4. Pendentes (Prioritário) */}
        <div className="bg-white p-4 rounded-xl border-2 border-[#E4E2DB] shadow-xs">
          <div className="flex items-center justify-between text-[#73726C] text-xs font-semibold mb-1">
            <span>Pendentes</span>
            <span className="material-symbols-outlined text-base text-[#A09E96]">schedule</span>
          </div>
          <div className="text-2xl font-extrabold text-[#73726C]">{kpis.pendentes}</div>
          <div className="text-[11px] text-[#73726C] mt-1">a iniciar na grade</div>
        </div>

        {/* 5. Não Realizadas */}
        <div className="bg-white p-4 rounded-xl border border-[#F9BCBC] shadow-xs bg-[#FDEEEE]/15">
          <div className="flex items-center justify-between text-[#DD3838] text-xs font-medium mb-1">
            <span>Não Realizadas</span>
            <span className="material-symbols-outlined text-base">cancel</span>
          </div>
          <div className="text-2xl font-bold text-[#DD3838]">{kpis.naoRealizadas}</div>
          <div className="text-[11px] text-[#DD3838] mt-1">com justificativa</div>
        </div>

        {/* 6. Com Ocorrências */}
        <div className="bg-white p-4 rounded-xl border border-[#FCE19B] shadow-xs bg-[#FFF8E6]/15">
          <div className="flex items-center justify-between text-[#D98A00] text-xs font-medium mb-1">
            <span>Ocorrências</span>
            <span className="material-symbols-outlined text-base">warning</span>
          </div>
          <div className="text-2xl font-bold text-[#D98A00]">{kpis.comOcorrencias}</div>
          <div className="text-[11px] text-[#73726C] mt-1">rupturas ou desvios</div>
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
        <div className="px-6 py-4 border-b border-[#E4E2DB] flex items-center justify-between bg-[#FCFCFB]">
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
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
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
                {filteredVisits.map((item) => {
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
                      <td className="px-4 py-4">{renderStatusBadge(item.status)}</td>

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
        )}
      </div>

      {/* 5. Resumo Operacional por Promotor */}
      <div className="bg-white rounded-2xl border border-[#E4E2DB] shadow-xs p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-[#171717]">Resumo Diário por Promotor</h2>
            <p className="text-xs text-[#73726C]">
              Progresso individual de visitas concluídas em relação à grade prevista no dia.
            </p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#F7F7F6] text-[#73726C] border border-[#E4E2DB]">
            {promotoresSummary.length} promotores na escala
          </span>
        </div>

        {promotoresSummary.length === 0 ? (
          <div className="text-center py-6 text-xs text-[#73726C]">Nenhum promotor escalado no filtro atual.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {promotoresSummary.map((p) => {
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
                  <div className="grid grid-cols-4 gap-1 text-center text-[10px]">
                    <div className="bg-white p-1.5 rounded-lg border border-[#E4E2DB]">
                      <div className="font-bold text-[#171717]">{p.previstas}</div>
                      <div className="text-[#73726C]">Prev.</div>
                    </div>
                    <div className="bg-white p-1.5 rounded-lg border border-[#E4E2DB]">
                      <div className="font-bold text-[#286FF5]">{p.emAndamento}</div>
                      <div className="text-[#73726C]">Andam.</div>
                    </div>
                    <div className="bg-white p-1.5 rounded-lg border border-[#E4E2DB]">
                      <div className="font-bold text-[#16845B]">{p.concluidas}</div>
                      <div className="text-[#73726C]">Concl.</div>
                    </div>
                    <div className="bg-white p-1.5 rounded-lg border border-[#E4E2DB]">
                      <div className="font-bold text-[#DD3838]">{p.naoRealizadas}</div>
                      <div className="text-[#73726C]">Não Real.</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
                  {renderStatusBadge(selectedVisitItem.status)}
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
            <div className="px-6 py-3 border-t border-[#E4E2DB] bg-[#FCFCFB] flex justify-end">
              <button
                onClick={() => setSelectedVisitItem(null)}
                className="px-4 py-2 bg-[#171717] text-white rounded-xl text-xs font-semibold hover:bg-[#2C2C2C] transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
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
