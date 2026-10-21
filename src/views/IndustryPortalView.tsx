import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import * as XLSX from 'xlsx';
import type { Visit, RouteItem, ToastMessage, VisitPhoto, SystemSettingsState } from '../types';
import { fetchSystemSettings } from '../lib/systemSettings';
import {
  calculateOperationalVisits,
  getLocalDateString,
  OperationalVisitItem,
  DayOfWeekDate
} from '../utils/routePlanner';
import { ExecutiveReportDocument } from '../components/reports/ExecutiveReportDocument';
import { AuthorSignature } from '../components/AuthorSignature';
import { filterOperationalVisits, paginateOperationalVisits, type OperationalStatusFilter } from '../utils/industryPortalOperational';

interface IndustryPortalViewProps {
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const IndustryPortalView: React.FC<IndustryPortalViewProps> = ({ onShowToast }) => {
  const { profile } = useAuth();
  
  // Identificação do perfil autenticado e controle Admin/Gestor vs Client Industry
  const isAdminOrGestor = profile?.role === 'admin' || profile?.role === 'gestor';
  const isClientIndustry = profile?.role === 'client_industry';

  // Se for client_industry, trava estritamente na própria indústria do perfil
  const userIndCode = profile?.industria_codigo;

  // Estado de Indústrias disponíveis (carregado via Supabase para Admin/Gestor)
  const [industriasList, setIndustriasList] = useState<Array<{ codigo: string; nome: string }>>([]);
  const [selectedIndFilter, setSelectedIndFilter] = useState<string>(isClientIndustry ? (userIndCode || '') : ''); // '' = GLOBAL para admin

  // Determina o código e o nome da indústria ativa na visualização
  const activeIndCode = isClientIndustry ? userIndCode : selectedIndFilter;
  const activeIndName = useMemo(() => {
    if (isClientIndustry) {
      return profile?.industria_nome || userIndCode || 'Sua Indústria';
    }
    if (!selectedIndFilter) {
      return 'Todas as indústrias (GLOBAL)';
    }
    const found = industriasList.find((i) => i.codigo === selectedIndFilter);
    return found ? `${found.nome} (${found.codigo})` : selectedIndFilter;
  }, [isClientIndustry, profile, userIndCode, selectedIndFilter, industriasList]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Configurações Globais de Operação
  const [systemSettings, setSystemSettings] = useState<SystemSettingsState>({
    mode: 'IMPLANTACAO',
    officialStartDate: null,
    status: 'loading',
    error: null
  });

  const [periodFilter, setPeriodFilter] = useState<'today' | 'week' | 'month'>('today');

  const [visits, setVisits] = useState<Visit[]>([]);
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [promotoresList, setPromotoresList] = useState<any[]>([]);
  const [lojasList, setLojasList] = useState<any[]>([]);
  
  // Signed URLs para fotos da visita selecionada
  const [signedPhotoUrls, setSignedPhotoUrls] = useState<Record<string, string>>({});
  const [loadingPhotos, setLoadingPhotos] = useState(false);

  // Modal de Detalhes da Visita (Somente Leitura)
  const [selectedVisitItem, setSelectedVisitItem] = useState<OperationalVisitItem | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Modal / Drawer de Histórico por Loja
  const [selectedStoreCode, setSelectedStoreCode] = useState<string | null>(null);
  const [historyPeriodFilter, setHistoryPeriodFilter] = useState<'7' | '30' | '90' | 'all'>('30');
  const [historyVisitsData, setHistoryVisitsData] = useState<Visit[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  // Estado de Navegação das Abas do Portal ('operacional' | 'evidencias' | 'relatorio')
  const [activeTab, setActiveTab] = useState<'operacional' | 'evidencias' | 'relatorio'>('operacional');
  const [operationalStatusFilter, setOperationalStatusFilter] = useState<OperationalStatusFilter>('all');
  const [operationalSearch, setOperationalSearch] = useState('');
  const [operationalPage, setOperationalPage] = useState(1);

  // Estados da Central de Evidências
  const [evidenciasPage, setEvidenciasPage] = useState<number>(1);
  const [evidenciasPeriod, setEvidenciasPeriod] = useState<'7' | '30' | '90' | 'all'>('30');
  const [evidenciasLoja, setEvidenciasLoja] = useState<string>('all');
  const [evidenciasPromotor, setEvidenciasPromotor] = useState<string>('all');
  const [evidenciasTipo, setEvidenciasTipo] = useState<string>('all');

  const [evidenciasPhotos, setEvidenciasPhotos] = useState<any[]>([]);
  const [evidenciasTotalCount, setEvidenciasTotalCount] = useState<number>(0);
  const [loadingEvidencias, setLoadingEvidencias] = useState<boolean>(false);
  const [evidenciasSignedUrls, setEvidenciasSignedUrls] = useState<Record<string, string>>({});

  // Modal de Foto Ampliada da Central de Evidências
  const [zoomedEvidencia, setZoomedEvidencia] = useState<any | null>(null);

  // Registro de fotos com falha de carregamento (HTTP ou rede) para exibir fallback elegante sem quadro branco
  const [failedPhotoKeys, setFailedPhotoKeys] = useState<Set<string>>(new Set());

  // Função utilitária segura para resolver Signed URL (com sanitização de caminho no bucket visit-photos)
  const resolvePhotoUrl = useCallback(async (rawStoragePath: string): Promise<string> => {
    if (!supabase || !rawStoragePath) return '';

    let cleanPath = rawStoragePath.trim();
    if (cleanPath.startsWith('visit-photos/')) {
      cleanPath = cleanPath.replace(/^visit-photos\//, '');
    }
    cleanPath = cleanPath.replace(/^\/+/, '');

    try {
      const { data: signData, error: signErr } = await supabase.storage
        .from('visit-photos')
        .createSignedUrl(cleanPath, 3600);

      if (!signErr && signData?.signedUrl) {
        return signData.signedUrl;
      }
    } catch (e) {
      console.warn('Erro ao gerar signed URL para foto:', cleanPath, e);
    }

    return '';
  }, [supabase]);

  // Métrica de Última Atualização
  const [lastUpdate, setLastUpdate] = useState<string>('—');

  // Carregar Lista de Indústrias para Administrador/Gestor
  useEffect(() => {
    async function loadIndustrias() {
      if (!supabase || !isAdminOrGestor) return;
      try {
        const { data } = await supabase.from('industrias').select('codigo, nome').order('nome');
        if (data) setIndustriasList(data);
      } catch (err) {
        console.warn('Erro ao carregar lista de indústrias:', err);
      }
    }
    loadIndustrias();
  }, [isAdminOrGestor]);

  // Carregar Dados Operacionais do Portal
  const fetchIndustryData = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!supabase) {
      setError('Cliente Supabase não inicializado.');
      setLoading(false);
      return;
    }

    try {
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

      // Consulta das tabelas canônicas oficiais do Supabase
      let visitsQuery = supabase
        .from('visits')
        .select(`
          *,
          promotor:promotores(matricula, nome),
          loja:lojas(codigo, nome, cidade, uf, endereco),
          industria:industrias(codigo, nome),
          photos:visit_photos(*),
          occurrences:visit_occurrences(*),
          validity_items:visit_product_validity(*)
        `)
        .order('created_at', { ascending: false });

      if (activeIndCode) {
        visitsQuery = visitsQuery.eq('industria_codigo', activeIndCode);
      }

      if (periodFilter === 'today') {
        visitsQuery = visitsQuery.eq('data_visita', startDateStr);
      } else {
        visitsQuery = visitsQuery.gte('data_visita', startDateStr);
      }

      let rotasQuery = supabase.from('rotas').select(`
        *,
        industria:industrias(codigo, nome),
        loja:lojas(codigo, nome, cidade, uf),
        promotor:promotores(matricula, nome)
      `);

      if (activeIndCode) {
        rotasQuery = rotasQuery.eq('industria_codigo', activeIndCode);
      }

      // Executar consultas com RLS ativo no Supabase e buscar configurações operacionais
      const [visitsRes, rotasRes, promotoresRes, lojasRes, settingsData] = await Promise.all([
        visitsQuery,
        rotasQuery,
        supabase.from('promotores').select('id,matricula,nome'),
        supabase.from('lojas').select('*'),
        fetchSystemSettings()
      ]);

      if (visitsRes.error) throw visitsRes.error;
      if (rotasRes.error) throw rotasRes.error;
      if (promotoresRes.error) throw promotoresRes.error;

      const realVisits = (visitsRes.data as unknown as Visit[]) || [];
      const realRoutes = (rotasRes.data as unknown as RouteItem[]) || [];

      setVisits(realVisits);
      setRoutes(realRoutes);
      setPromotoresList(promotoresRes.data || []);
      setLojasList(lojasRes.data || []);
      setSystemSettings(settingsData);

      setLastUpdate(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (err: any) {
      console.error('Erro ao carregar dados do Portal da Indústria:', err);
      setError(err.message || 'Falha ao carregar telemetria de visitas da indústria.');
    } finally {
      setLoading(false);
    }
  }, [periodFilter, activeIndCode]);

  useEffect(() => {
    fetchIndustryData();
  }, [fetchIndustryData]);

  // Realtime Supabase Subscriptions para a Indústria
  useEffect(() => {
    if (!supabase) return;

    const channel = supabase
      .channel('public:industry_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visits' }, () => {
        fetchIndustryData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visit_photos' }, () => {
        fetchIndustryData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visit_occurrences' }, () => {
        fetchIndustryData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visit_product_validity' }, () => {
        fetchIndustryData();
      })
      .subscribe();

    return () => {
      if (supabase) {
        supabase.removeChannel(channel);
      }
    };
  }, [fetchIndustryData]);

  // Cálculo das datas do período
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

  // Motor Central de Cálculo de Visitas Operacionais
  const allOperationalVisits = useMemo(() => {
    return calculateOperationalVisits({
      routes,
      visits,
      promotoresList,
      industriasList: [],
      daysRange: periodDaysRange,
      todayStr,
      operationMode: systemSettings.mode,
      officialStartDate: systemSettings.officialStartDate
    }).filter((v) => !activeIndCode || v.industriaCodigo === activeIndCode);
  }, [routes, visits, promotoresList, periodDaysRange, todayStr, activeIndCode, systemSettings]);

  // Lojas contratadas únicas da indústria (ou de todas no modo GLOBAL)
  const contratadasLojasCount = useMemo(() => {
    const setLojas = new Set<string>();
    routes.forEach((r) => {
      if (!activeIndCode || r.industria_codigo === activeIndCode) {
        setLojas.add(r.loja_codigo);
      }
    });
    return setLojas.size;
  }, [routes, activeIndCode]);

  // PDVs únicos com pelo menos uma visita concluída no período selecionado (status = 'concluida' E completed_at IS NOT NULL)
  const lojasComVisitaRealizadaCount = useMemo(() => {
    const setLojasRealizadas = new Set<string>();
    allOperationalVisits.forEach((v) => {
      if (v.status === 'concluida' && v.visitObj && v.visitObj.completed_at) {
        setLojasRealizadas.add(v.lojaCodigo);
      }
    });
    return setLojasRealizadas.size;
  }, [allOperationalVisits]);

  // Definição dos indicadores: planejadas = total de itens operacionais previstos no período
  // (denominador da execução); os demais valores contam itens por status persistido/mapeado
  // pelo routePlanner e são categorias exclusivas entre si.
  const kpis = useMemo(() => {
    const planejadas = allOperationalVisits.length;
    const concluidas = allOperationalVisits.filter((v) => v.status === 'concluida').length;
    const emAndamento = allOperationalVisits.filter((v) => v.status === 'em_andamento').length;
    const pendentes = allOperationalVisits.filter((v) => v.status === 'pendente').length;
    const pendentesHoje = allOperationalVisits.filter((v) => v.status === 'pendente' && v.dataStr === todayStr && !v.isPastOverdue).length;
    const atrasadas = allOperationalVisits.filter((v) => v.status === 'pendente' && v.isPastOverdue).length;
    const naoRealizadas = allOperationalVisits.filter((v) => v.status === 'nao_realizada').length;
    const aderencia = planejadas > 0 ? Math.round((concluidas / planejadas) * 100) : 0;

    return {
      lojas: contratadasLojasCount,
      lojasComVisita: lojasComVisitaRealizadaCount,
      planejadas,
      concluidas,
      emAndamento,
      pendentes,
      pendentesHoje,
      atrasadas,
      naoRealizadas,
      aderencia
    };
  }, [allOperationalVisits, contratadasLojasCount, lojasComVisitaRealizadaCount, todayStr]);

  const filteredOperationalVisits = useMemo(() => {
    return filterOperationalVisits(allOperationalVisits, operationalStatusFilter, operationalSearch);
  }, [allOperationalVisits, operationalSearch, operationalStatusFilter]);
  const OPERATIONAL_PAGE_SIZE = 12;
  const operationalTotalPages = Math.max(1, Math.ceil(filteredOperationalVisits.length / OPERATIONAL_PAGE_SIZE));
  const paginatedOperationalVisits = useMemo(() => {
    return paginateOperationalVisits(filteredOperationalVisits, operationalPage, OPERATIONAL_PAGE_SIZE);
  }, [filteredOperationalVisits, operationalPage, operationalTotalPages]);

  useEffect(() => {
    setOperationalPage(1);
  }, [operationalSearch, operationalStatusFilter]);

  // --- CÁLCULOS DO RELATÓRIO EXECUTIVO ---
  const hasQuinzenalRoutes = useMemo(() => {
    return routes.some((r) => (!activeIndCode || r.industria_codigo === activeIndCode) && r.frequencia === 'QUINZENAL');
  }, [routes, activeIndCode]);

  const lojasPerformance = useMemo(() => {
    const map = new Map<string, {
      codigo: string;
      nome: string;
      cidade: string;
      uf: string;
      planejadas: number;
      concluidas: number;
      pendentes: number;
      atrasadas: number;
      naoRealizadas: number;
      ocorrencias: number;
    }>();

    routes.forEach((r) => {
      if (!activeIndCode || r.industria_codigo === activeIndCode) {
        if (!map.has(r.loja_codigo)) {
          map.set(r.loja_codigo, {
            codigo: r.loja_codigo,
            nome: r.loja?.nome || r.loja_codigo,
            cidade: r.loja?.cidade || '',
            uf: r.loja?.uf || '',
            planejadas: 0,
            concluidas: 0,
            pendentes: 0,
            atrasadas: 0,
            naoRealizadas: 0,
            ocorrencias: 0
          });
        }
      }
    });

    allOperationalVisits.forEach((v) => {
      let item = map.get(v.lojaCodigo);
      if (!item) {
        item = {
          codigo: v.lojaCodigo,
          nome: v.lojaNome,
          cidade: v.lojaCidade || '',
          uf: v.lojaUf || '',
          planejadas: 0,
          concluidas: 0,
          pendentes: 0,
          atrasadas: 0,
          naoRealizadas: 0,
          ocorrencias: 0
        };
        map.set(v.lojaCodigo, item);
      }

      item.planejadas += 1;
      if (v.status === 'concluida') item.concluidas += 1;
      if (v.status === 'pendente') item.pendentes += 1;
      if (v.status === 'pendente' && v.isPastOverdue) item.atrasadas += 1;
      if (v.status === 'nao_realizada') item.naoRealizadas += 1;
      if (v.visitObj?.occurrences && Array.isArray(v.visitObj.occurrences)) {
        item.ocorrencias += v.visitObj.occurrences.length;
      }
    });

    return Array.from(map.values()).map((l) => ({
      ...l,
      aderencia: l.planejadas > 0 ? Math.round((l.concluidas / l.planejadas) * 100) : 0
    })).sort((a, b) => {
      if (b.atrasadas !== a.atrasadas) return b.atrasadas - a.atrasadas;
      if (b.pendentes !== a.pendentes) return b.pendentes - a.pendentes;
      if (a.aderencia !== b.aderencia) return a.aderencia - b.aderencia;
      return a.nome.localeCompare(b.nome);
    });
  }, [routes, allOperationalVisits, activeIndCode]);

  const promotoresPerformance = useMemo(() => {
    const map = new Map<string, {
      matricula: string;
      nome: string;
      planejadas: number;
      concluidas: number;
      pendentes: number;
      atrasadas: number;
    }>();

    allOperationalVisits.forEach((v) => {
      let item = map.get(v.promotorMatricula);
      if (!item) {
        item = {
          matricula: v.promotorMatricula,
          nome: v.promotorNome,
          planejadas: 0,
          concluidas: 0,
          pendentes: 0,
          atrasadas: 0
        };
        map.set(v.promotorMatricula, item);
      }

      item.planejadas += 1;
      if (v.status === 'concluida') item.concluidas += 1;
      if (v.status === 'pendente') item.pendentes += 1;
      if (v.status === 'pendente' && v.isPastOverdue) item.atrasadas += 1;
    });

    return Array.from(map.values()).map((p) => ({
      ...p,
      aderencia: p.planejadas > 0 ? Math.round((p.concluidas / p.planejadas) * 100) : 0
    })).sort((a, b) => {
      if (a.aderencia !== b.aderencia) return a.aderencia - b.aderencia;
      if (b.atrasadas !== a.atrasadas) return b.atrasadas - a.atrasadas;
      return a.nome.localeCompare(b.nome);
    });
  }, [allOperationalVisits]);

  const topProblematicLojas = useMemo(() => {
    return lojasPerformance.slice(0, 10);
  }, [lojasPerformance]);

  const occurrencesSummary = useMemo(() => {
    let rupturas = 0;
    let preco = 0;
    let espaco = 0;
    let outros = 0;

    visits.forEach((v) => {
      if (v.occurrences && Array.isArray(v.occurrences)) {
        v.occurrences.forEach((occ: any) => {
          if (occ.tipo === 'ruptura') rupturas += 1;
          else if (occ.tipo === 'preco_divergente') preco += 1;
          else if (occ.tipo === 'falta_espaco') espaco += 1;
          else outros += 1;
        });
      }
    });

    return { rupturas, preco, espaco, outros, total: rupturas + preco + espaco + outros };
  }, [visits]);

  const validitySummary = useMemo(() => {
    let totalAuditados = 0;
    let vencidos = 0;
    let vencendo3d = 0;
    let vencendo7d = 0;
    let vencendo30d = 0;

    const now = new Date();
    const todayS = getLocalDateString(now);

    const in3Days = new Date(now); in3Days.setDate(now.getDate() + 3);
    const in3DaysS = getLocalDateString(in3Days);

    const in7Days = new Date(now); in7Days.setDate(now.getDate() + 7);
    const in7DaysS = getLocalDateString(in7Days);

    const in30Days = new Date(now); in30Days.setDate(now.getDate() + 30);
    const in30DaysS = getLocalDateString(in30Days);

    visits.forEach((v) => {
      if (v.validity_items && Array.isArray(v.validity_items)) {
        v.validity_items.forEach((item: any) => {
          const qty = item.quantidade || 1;
          totalAuditados += qty;
          if (item.data_vencimento < todayS) {
            vencidos += qty;
          } else {
            if (item.data_vencimento <= in3DaysS) vencendo3d += qty;
            else if (item.data_vencimento <= in7DaysS) vencendo7d += qty;
            else if (item.data_vencimento <= in30DaysS) vencendo30d += qty;
          }
        });
      }
    });

    return { totalAuditados, vencidos, vencendo3d, vencendo7d, vencendo30d };
  }, [visits, todayStr]);

  const photosSummary = useMemo(() => {
    let fachada = 0;
    let gondola = 0;
    let preco = 0;
    let ponto_extra = 0;
    let ruptura = 0;
    let outros = 0;

    visits.forEach((v) => {
      if (v.photos && Array.isArray(v.photos)) {
        v.photos.forEach((p: any) => {
          if (p.tipo_foto === 'fachada') fachada += 1;
          else if (p.tipo_foto === 'gondola') gondola += 1;
          else if (p.tipo_foto === 'preco') preco += 1;
          else if (p.tipo_foto === 'ponto_extra') ponto_extra += 1;
          else if (p.tipo_foto === 'ruptura') ruptura += 1;
          else outros += 1;
        });
      }
    });

    return { fachada, gondola, preco, ponto_extra, ruptura, outros, total: fachada + gondola + preco + ponto_extra + ruptura + outros };
  }, [visits]);

  const temporalEvolution = useMemo(() => {
    return periodDaysRange.map((d) => {
      const dayVisits = allOperationalVisits.filter((v) => v.dataStr === d.dateStr);
      const planejadas = dayVisits.length;
      const realizadas = dayVisits.filter((v) => v.status === 'concluida').length;
      const pendentes = dayVisits.filter((v) => v.status === 'pendente').length;
      return {
        dateStr: d.dateStr,
        dayShort: d.dayShort,
        planejadas,
        realizadas,
        pendentes
      };
    });
  }, [periodDaysRange, allOperationalVisits]);

  // Carregar histórico de visitas no Supabase de forma leve ao selecionar uma loja
  const fetchStoreHistory = useCallback(async (lojaCodigo: string, period: '7' | '30' | '90' | 'all') => {
    if (!supabase) return;
    setLoadingHistory(true);

    try {
      let query = supabase
        .from('visits')
        .select(`
          *,
          promotor:promotores(matricula, nome),
          loja:lojas(codigo, nome, cidade, uf),
          industria:industrias(codigo, nome),
          photos:visit_photos(*),
          occurrences:visit_occurrences(*),
          validity_items:visit_product_validity(*)
        `)
        .eq('loja_codigo', lojaCodigo)
        .order('data_visita', { ascending: false });

      if (activeIndCode) {
        query = query.eq('industria_codigo', activeIndCode);
      }

      if (period !== 'all') {
        const days = parseInt(period, 10);
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - days);
        const pastDateStr = getLocalDateString(pastDate);
        query = query.gte('data_visita', pastDateStr);
      }

      const { data, error: histErr } = await query;
      if (histErr) throw histErr;
      setHistoryVisitsData((data as unknown as Visit[]) || []);
    } catch (err) {
      console.error('Erro ao buscar histórico da loja:', err);
    } finally {
      setLoadingHistory(false);
    }
  }, [activeIndCode]);

  const handleOpenStoreHistory = (lojaCodigo: string) => {
    setSelectedStoreCode(lojaCodigo);
    fetchStoreHistory(lojaCodigo, historyPeriodFilter);
  };

  const handleHistoryPeriodChange = (newPeriod: '7' | '30' | '90' | 'all') => {
    setHistoryPeriodFilter(newPeriod);
    if (selectedStoreCode) {
      fetchStoreHistory(selectedStoreCode, newPeriod);
    }
  };

  // Objeto de dados da Loja selecionada no histórico
  const selectedStoreObj = useMemo(() => {
    if (!selectedStoreCode) return null;
    return lojasList.find((l) => l.codigo === selectedStoreCode) || {
      codigo: selectedStoreCode,
      nome: allOperationalVisits.find((v) => v.lojaCodigo === selectedStoreCode)?.lojaNome || selectedStoreCode,
      cidade: allOperationalVisits.find((v) => v.lojaCodigo === selectedStoreCode)?.lojaCidade || '',
      uf: allOperationalVisits.find((v) => v.lojaCodigo === selectedStoreCode)?.lojaUf || ''
    };
  }, [selectedStoreCode, lojasList, allOperationalVisits]);

  // Rotas da Loja Selecionada
  const selectedStoreRoutes = useMemo(() => {
    if (!selectedStoreCode) return [];
    return routes.filter((r) => r.loja_codigo === selectedStoreCode && (!activeIndCode || r.industria_codigo === activeIndCode));
  }, [routes, selectedStoreCode, activeIndCode]);

  // Faixa de Dias para o Período do Histórico
  const historyDaysRange = useMemo(() => {
    const now = new Date();
    let numDays = 30;
    if (historyPeriodFilter === '7') numDays = 7;
    if (historyPeriodFilter === '30') numDays = 30;
    if (historyPeriodFilter === '90') numDays = 90;
    if (historyPeriodFilter === 'all') numDays = 120; // limite de segurança para 'all'

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
  }, [historyPeriodFilter, todayStr]);

  // Todos os itens operacionais calculados do Histórico da Loja
  const storeHistoryOperationalItems = useMemo(() => {
    if (!selectedStoreCode) return [];
    const items = calculateOperationalVisits({
      routes: selectedStoreRoutes,
      visits: historyVisitsData,
      promotoresList,
      industriasList: [],
      daysRange: historyDaysRange,
      todayStr,
      operationMode: systemSettings.mode,
      officialStartDate: systemSettings.officialStartDate
    });
    // Ordenar do mais recente para o mais antigo
    return items.sort((a, b) => b.dataStr.localeCompare(a.dataStr));
  }, [selectedStoreCode, selectedStoreRoutes, historyVisitsData, promotoresList, historyDaysRange, todayStr, systemSettings]);

  // Resumo de KPIs do Histórico da Loja
  const storeHistoryKPIs = useMemo(() => {
    const planejadas = storeHistoryOperationalItems.length;
    const concluidas = storeHistoryOperationalItems.filter((v) => v.status === 'concluida').length;
    const pendentes = storeHistoryOperationalItems.filter((v) => v.status === 'pendente').length;
    const naoRealizadas = storeHistoryOperationalItems.filter((v) => v.status === 'nao_realizada').length;
    const aderencia = planejadas > 0 ? Math.round((concluidas / planejadas) * 100) : 0;

    return { planejadas, concluidas, pendentes, naoRealizadas, aderencia };
  }, [storeHistoryOperationalItems]);

  // Função de Busca Paginada de Evidências no Supabase (12 fotos por página)
  const fetchEvidencias = useCallback(async () => {
    if (!supabase) return;
    setLoadingEvidencias(true);

    try {
      const pageSize = 12;
      const from = (evidenciasPage - 1) * pageSize;
      const to = from + pageSize - 1;

      let query = supabase
        .from('visit_photos')
        .select(`
          id,
          tipo_foto,
          storage_path,
          created_at,
          legenda,
          visit:visits!inner(
            id,
            rota_id,
            data_visita,
            loja_codigo,
            industria_codigo,
            promotor_matricula,
            status,
            loja:lojas(codigo, nome, cidade, uf),
            promotor:promotores(matricula, nome),
            industria:industrias(codigo, nome)
          )
        `, { count: 'exact' });

      if (activeIndCode) {
        query = query.eq('visit.industria_codigo', activeIndCode);
      }

      if (evidenciasPeriod !== 'all') {
        const days = parseInt(evidenciasPeriod, 10);
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - days);
        const pastDateStr = getLocalDateString(pastDate);
        query = query.gte('visit.data_visita', pastDateStr);
      }

      if (evidenciasLoja !== 'all') {
        query = query.eq('visit.loja_codigo', evidenciasLoja);
      }

      if (evidenciasPromotor !== 'all') {
        query = query.eq('visit.promotor_matricula', evidenciasPromotor);
      }

      // Filtro de Tipo de Evidência
      if (evidenciasTipo !== 'all') {
        query = query.eq('tipo_foto', evidenciasTipo);
      }

      // Ordenar por data de atendimento mais recente e paginar
      query = query.order('created_at', { ascending: false }).range(from, to);

      const { data, count, error: photoErr } = await query;
      if (photoErr) throw photoErr;

      const rawPhotos = data || [];
      setEvidenciasPhotos(rawPhotos);
      setEvidenciasTotalCount(count || 0);

      // Gerar Signed URLs privadas de 3600s exclusivamente para os 12 itens da página visível
      if (rawPhotos.length > 0) {
        const urlMap: Record<string, string> = {};
        for (const p of rawPhotos) {
          if (p.storage_path) {
            const url = await resolvePhotoUrl(p.storage_path);
            if (url) {
              urlMap[p.storage_path] = url;
              if (p.id) {
                urlMap[p.id] = url;
              }
            }
          }
        }
        setEvidenciasSignedUrls(urlMap);
      } else {
        setEvidenciasSignedUrls({});
      }
    } catch (err) {
      console.error('Erro ao buscar Central de Evidências:', err);
    } finally {
      setLoadingEvidencias(false);
    }
  }, [evidenciasPage, evidenciasPeriod, evidenciasLoja, evidenciasPromotor, evidenciasTipo, activeIndCode, resolvePhotoUrl]);

  useEffect(() => {
    if (activeTab === 'evidencias') {
      fetchEvidencias();
    }
  }, [activeTab, fetchEvidencias]);

  const handleClearEvidenciasFilters = () => {
    setEvidenciasPeriod('30');
    setEvidenciasLoja('all');
    setEvidenciasPromotor('all');
    setEvidenciasTipo('all');
    setEvidenciasPage(1);
  };

  // Abrir o relatório completo a partir do modal de foto da Central de Evidências
  const handleOpenFullReportFromEvidencia = async (photoItem: any) => {
    if (!photoItem || !photoItem.visit) return;
    setZoomedEvidencia(null); // fechar o zoom da foto

    const visitData = photoItem.visit;
    const opItem: OperationalVisitItem = {
      key: `evidencia_${visitData.id}`,
      routeId: visitData.rota_id || '',
      dataStr: visitData.data_visita,
      dayOfWeekLabel: getLocalDateString(new Date(visitData.data_visita)),
      lojaCodigo: visitData.loja_codigo,
      lojaNome: visitData.loja?.nome || visitData.loja_codigo,
      lojaCidade: visitData.loja?.cidade || '',
      lojaUf: visitData.loja?.uf || '',
      promotorMatricula: visitData.promotor_matricula,
      promotorNome: visitData.promotor?.nome || visitData.promotor_matricula,
      industriaCodigo: visitData.industria_codigo,
      industriaNome: visitData.industria?.nome || visitData.industria_codigo,
      frequencia: 'SEMANAL',
      status: visitData.status,
      priorityOrder: 1,
      isPastOverdue: false,
      visitObj: visitData
    };

    await handleOpenVisitDetails(opItem);
  };

  // Carregar detalhes completos (checklist, fotos, ocorrências e validade) sob demanda ao abrir o relatório da visita
  const handleOpenVisitDetails = async (item: OperationalVisitItem) => {
    setSelectedVisitItem(item);
    setSignedPhotoUrls({});

    if (!item.visitObj || !supabase) return;
    setLoadingDetails(true);
    setLoadingPhotos(true);

    try {
      const visitId = item.visitObj.id;

      // Buscar tabelas filhas sob demanda
      const [checkRes, photosRes, occRes, valRes] = await Promise.all([
        supabase.from('visit_checklist_items').select('*').eq('visit_id', visitId),
        supabase.from('visit_photos').select('*').eq('visit_id', visitId),
        supabase.from('visit_occurrences').select('*').eq('visit_id', visitId),
        supabase.from('visit_product_validity').select('*').eq('visit_id', visitId)
      ]);
      const detailError = checkRes.error || photosRes.error || occRes.error || valRes.error;
      if (detailError) throw detailError;

      const fullPhotos = (photosRes.data as VisitPhoto[]) || [];

      // Atualizar objeto com tabelas filhas preenchidas
      const updatedVisitObj: Visit = {
        ...item.visitObj,
        checklist_items: checkRes.data || [],
        photos: fullPhotos,
        occurrences: occRes.data || [],
        validity_items: valRes.data || []
      };

      const updatedItem: OperationalVisitItem = {
        ...item,
        visitObj: updatedVisitObj
      };

      setSelectedVisitItem(updatedItem);

      // Gerar Signed URLs para fotos no bucket privado
      if (fullPhotos.length > 0) {
        const urlMap: Record<string, string> = {};
        for (const photo of fullPhotos) {
          if (photo.storage_path) {
            const url = await resolvePhotoUrl(photo.storage_path);
            if (url) {
              urlMap[photo.storage_path] = url;
              if (photo.id) {
                urlMap[photo.id] = url;
              }
            }
          }
        }
        setSignedPhotoUrls(urlMap);
      }
    } catch (err) {
      console.warn('Erro ao carregar detalhes completos da visita sob demanda:', err);
      onShowToast({
        title: 'Detalhes indisponíveis',
        message: err && typeof err === 'object' && 'message' in err ? String(err.message) : 'Não foi possível carregar as evidências da visita.',
        type: 'error'
      });
    } finally {
      setLoadingDetails(false);
      setLoadingPhotos(false);
    }
  };

  // --- EXPORTAÇÃO EXCEL (3 ABAS: RESUMO_EXECUTIVO, ATENDIMENTOS_DETALHADOS, OCORRENCIAS_E_VALIDADE) ---
  const handleExportExcel = () => {
    try {
      const wb = XLSX.utils.book_new();
      const periodLabel = periodFilter === 'today' ? 'Hoje' : periodFilter === 'week' ? 'Últimos 7 dias' : 'Últimos 30 dias';
      const indLabel = activeIndName;
      const indCodeLabel = activeIndCode || 'GLOBAL';
      const nowStr = new Date().toLocaleString('pt-BR');

      // 1. ABA RESUMO_EXECUTIVO
      const resumoRows: any[][] = [
        ['MK9 TRADE MARKETING — RELATÓRIO EXECUTIVO OPERACIONAL'],
        [''],
        ['IDENTIFICAÇÃO'],
        ['Indústria', indLabel],
        ['Código Indústria', indCodeLabel],
        ['Período Selecionado', periodLabel],
        ['Data/Hora de Geração', nowStr],
        [''],
        ['INDICADORES CHAVE DE DESEMPENHO (KPIS)'],
        ['PDVs Contratados', kpis.lojas, 'PDVs físicos distintos vinculados à indústria'],
        ['Visitas Planejadas', kpis.planejadas, 'Atendimentos previstos no período'],
        ['Visitas Concluídas', kpis.concluidas, 'Check-outs realizados'],
        ['Visitas Pendentes', kpis.pendentes, `${kpis.atrasadas} atrasadas • ${kpis.pendentesHoje} para hoje`],
        ['Visitas Atrasadas', kpis.atrasadas, 'Excederam a data limite de atendimento'],
        ['Não Realizadas', kpis.naoRealizadas, 'Visitas com justificativa registrada'],
        ['Aderência Operacional (%)', kpis.planejadas > 0 ? `${kpis.aderencia}%` : '—', systemSettings.mode !== 'OPERACAO_OFICIAL' ? 'Execução operacional (SLA contratual em fase de implantação)' : 'Taxa de execução em relação ao planejado'],
        ['Cobertura de PDVs (%)', `${kpis.lojas > 0 ? Math.round((kpis.lojasComVisita / kpis.lojas) * 100) : 0}%`, `${kpis.lojasComVisita} de ${kpis.lojas} PDVs atendidos no período`],
        [''],
        ['RESUMO DE CAMPO'],
        ['Rupturas de Estoque', occurrencesSummary.rupturas],
        ['Divergências de Preço', occurrencesSummary.preco],
        ['Falta de Espaço', occurrencesSummary.espaco],
        ['Outras Ocorrências', occurrencesSummary.outros],
        ['Produtos Vencidos', validitySummary.vencidos],
        ['Vencendo em ≤ 3 dias', validitySummary.vencendo3d],
        ['Vencendo em 4-7 dias', validitySummary.vencendo7d],
        ['Vencendo em 8-30 dias', validitySummary.vencendo30d]
      ];

      const wsResumo = XLSX.utils.aoa_to_sheet(resumoRows);
      wsResumo['!cols'] = [{ wch: 32 }, { wch: 30 }, { wch: 50 }];
      XLSX.utils.book_append_sheet(wb, wsResumo, 'RESUMO_EXECUTIVO');

      // 2. ABA ATENDIMENTOS_DETALHADOS
      const atendimentosData = allOperationalVisits.map((item) => ({
        'Data Prevista': item.dataStr,
        'Dia da Semana': item.dayOfWeekLabel,
        'Código Loja': item.lojaCodigo,
        'Nome da Loja': item.lojaNome,
        'Cidade': item.lojaCidade || '—',
        'UF': item.lojaUf || '—',
        'Indústria': item.industriaNome || indCodeLabel,
        'Promotor': item.promotorNome,
        'Matrícula Promotor': item.promotorMatricula,
        'Frequência': item.frequencia,
        'Status': item.status,
        'Situação': item.isPastOverdue ? 'ATRASADA' : item.status.toUpperCase(),
        'Data Check-in': item.visitObj?.started_at ? new Date(item.visitObj.started_at).toLocaleString('pt-BR') : '—',
        'Data Conclusão': item.visitObj?.completed_at ? new Date(item.visitObj.completed_at).toLocaleString('pt-BR') : '—',
        'Observações': item.visitObj?.observacao_geral || '—'
      }));

      const wsAtendimentos = XLSX.utils.json_to_sheet(atendimentosData);
      wsAtendimentos['!cols'] = [
        { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 20 },
        { wch: 6 }, { wch: 20 }, { wch: 25 }, { wch: 18 }, { wch: 14 },
        { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 20 }, { wch: 40 }
      ];
      if (atendimentosData.length > 0) {
        wsAtendimentos['!autofilter'] = { ref: `A1:O${atendimentosData.length + 1}` };
      }
      XLSX.utils.book_append_sheet(wb, wsAtendimentos, 'ATENDIMENTOS_DETALHADOS');

      // 3. ABA OCORRENCIAS_E_VALIDADE
      const ocorrRows: any[][] = [
        ['OCORRÊNCIAS DE CAMPO'],
        ['Data Visita', 'Loja', 'Cidade/UF', 'Promotor', 'Tipo Ocorrência', 'Descrição', 'Indústria']
      ];

      visits.forEach((v) => {
        if (v.occurrences && Array.isArray(v.occurrences)) {
          v.occurrences.forEach((occ: any) => {
            ocorrRows.push([
              v.data_visita,
              v.loja?.nome || v.loja_codigo,
              `${v.loja?.cidade || ''}/${v.loja?.uf || ''}`,
              v.promotor?.nome || v.promotor_matricula,
              occ.tipo,
              occ.descricao || '—',
              v.industria?.nome || v.industria_codigo
            ]);
          });
        }
      });

      ocorrRows.push(['']);
      ocorrRows.push(['AUDITORIA DE VALIDADE DE PRODUTOS']);
      ocorrRows.push(['Data Visita', 'Loja', 'Promotor', 'Produto', 'Quantidade', 'Data Vencimento', 'Classificação', 'Indústria']);

      const today = getLocalDateString(new Date());
      visits.forEach((v) => {
        if (v.validity_items && Array.isArray(v.validity_items)) {
          v.validity_items.forEach((val: any) => {
            let classif = 'Normal';
            if (val.data_vencimento < today) classif = 'VENCIDO';
            else if (val.data_vencimento === today) classif = 'Vence Hoje';
            else classif = 'A Vencer';

            ocorrRows.push([
              v.data_visita,
              v.loja?.nome || v.loja_codigo,
              v.promotor?.nome || v.promotor_matricula,
              val.produto_nome,
              val.quantidade,
              val.data_vencimento,
              classif,
              v.industria?.nome || v.industria_codigo
            ]);
          });
        }
      });

      const wsOcorrencias = XLSX.utils.aoa_to_sheet(ocorrRows);
      wsOcorrencias['!cols'] = [
        { wch: 14 }, { wch: 28 }, { wch: 20 }, { wch: 25 }, { wch: 20 }, { wch: 35 }, { wch: 16 }, { wch: 20 }
      ];
      XLSX.utils.book_append_sheet(wb, wsOcorrencias, 'OCORRENCIAS_E_VALIDADE');

      // Nome do Arquivo Seguro e Profissional
      const cleanInd = (indCodeLabel || 'GLOBAL').replace(/[^a-zA-Z0-9_-]/g, '_');
      const dateTag = today;
      const fileName = `MK9_Relatorio_Operacional_${cleanInd}_${dateTag}.xlsx`;

      XLSX.writeFile(wb, fileName);

      onShowToast({
        title: 'Exportação Concluída',
        message: `Relatório Excel gerado com sucesso: ${fileName}`,
        type: 'success'
      });
    } catch (err: any) {
      console.error('Erro ao exportar Excel:', err);
      onShowToast({
        title: 'Erro na Exportação',
        message: `Falha ao gerar arquivo Excel: ${err.message || err}`,
        type: 'error'
      });
    }
  };

  // --- IMPRESSÃO / SALVAR PDF (VIA WINDOW.PRINT NATIVO + CSS @MEDIA PRINT) ---
  const handlePrintPDF = () => {
    window.print();
  };

  return (
    <div className="w-full px-4 sm:px-6 py-6 max-w-7xl mx-auto space-y-6 font-sans">
      {/* 2. CABEÇALHO DO PORTAL DA INDÚSTRIA */}
      <section className="bg-[#F7F6F2] border border-indigo-500/40 rounded-2xl p-6 shadow-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 flex items-center justify-center font-bold text-2xl shadow-[0_0_15px_rgba(99,102,241,0.3)] shrink-0">
            <span className="material-symbols-outlined text-3xl">domain</span>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold text-[#171717] tracking-tight font-mono">
                Portal da Indústria
              </h1>

              {/* SELETOR DE INDÚSTRIA (VISÍVEL APENAS PARA ADMIN / GESTOR) */}
              {isAdminOrGestor ? (
                <div className="relative inline-block">
                  <select
                    value={selectedIndFilter}
                    onChange={(e) => setSelectedIndFilter(e.target.value)}
                    className="bg-[#E4E2DB] text-indigo-300 border border-indigo-500/40 rounded-xl px-3 py-1 font-mono font-bold text-xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-lg"
                  >
                    <option value="">GLOBAL (Todas as Indústrias)</option>
                    {industriasList.map((ind) => (
                      <option key={ind.codigo} value={ind.codigo}>
                        {ind.nome} ({ind.codigo})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] font-bold font-mono border border-indigo-500/30 uppercase">
                  {activeIndCode || 'GLOBAL'}
                </span>
              )}
            </div>

            <p className="text-xs text-[#171717] font-mono mt-1">
              Parceiro: <strong className="text-indigo-400 font-bold">{activeIndName}</strong> • Telemetria em Tempo Real MK9
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 self-end md:self-auto font-mono text-xs">
          <span className="text-[#77766F] bg-[#E4E2DB] border border-[#CFCDC5] px-3 py-2 rounded-xl">
            Atualizado às: <strong className="text-slate-200">{lastUpdate}</strong>
          </span>

          <button
            onClick={fetchIndustryData}
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center gap-1.5 transition-all shadow-md cursor-pointer disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-base ${loading ? 'animate-spin' : ''}`}>
              refresh
            </span>
            <span>Atualizar</span>
          </button>
        </div>
      </section>

      {/* 3. FILTRO DE ABAS E PERÍODO */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl p-4 font-mono text-xs">
        {/* NAVEGAÇÃO DE ABAS */}
        <div className="flex items-center gap-1.5 bg-[#E4E2DB] border border-[#CFCDC5] rounded-xl p-1 w-full md:w-auto">
          <button
            onClick={() => setActiveTab('operacional')}
            className={`flex-1 md:flex-initial px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === 'operacional'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-[#77766F] hover:text-white'
            }`}
          >
            <span className="material-symbols-outlined text-base">analytics</span>
            <span>Visão Operacional</span>
          </button>

          <button
            onClick={() => setActiveTab('evidencias')}
            className={`flex-1 md:flex-initial px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === 'evidencias'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-[#77766F] hover:text-white'
            }`}
          >
            <span className="material-symbols-outlined text-base">photo_library</span>
            <span>Central de Evidências</span>
          </button>

          <button
            onClick={() => setActiveTab('relatorio')}
            className={`flex-1 md:flex-initial px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === 'relatorio'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-[#77766F] hover:text-white'
            }`}
          >
            <span className="material-symbols-outlined text-base">assessment</span>
            <span>Relatório Executivo</span>
          </button>
        </div>

        {/* PERÍODO GLOBAL (EXIBIDO NA ABA OPERACIONAL E RELATÓRIO) */}
        {(activeTab === 'operacional' || activeTab === 'relatorio') && (
          <div className="flex items-center gap-1.5 bg-[#E4E2DB] border border-[#CFCDC5] rounded-xl p-1 w-full md:w-auto">
            {activeTab === 'operacional' && (
              <button
                onClick={() => setPeriodFilter('today')}
                className={`flex-1 md:flex-initial px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                  periodFilter === 'today'
                    ? 'bg-indigo-600/40 text-indigo-200 border border-indigo-500/40 shadow-sm'
                    : 'text-[#77766F] hover:text-white'
                }`}
              >
                Hoje
              </button>
            )}
            <button
              onClick={() => setPeriodFilter('week')}
              className={`flex-1 md:flex-initial px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                periodFilter === 'week'
                  ? 'bg-indigo-600/40 text-indigo-200 border border-indigo-500/40 shadow-sm'
                  : 'text-[#77766F] hover:text-white'
              }`}
            >
              7 Dias
            </button>
            <button
              onClick={() => setPeriodFilter('month')}
              className={`flex-1 md:flex-initial px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                periodFilter === 'month'
                  ? 'bg-indigo-600/40 text-indigo-200 border border-indigo-500/40 shadow-sm'
                  : 'text-[#77766F] hover:text-white'
              }`}
            >
              30 Dias
            </button>
          </div>
        )}
      </div>

      {/* Visão operacional consolidada: status e contadores usam allOperationalVisits. */}
      {activeTab === 'operacional' && (
        <section className="space-y-5 font-mono text-xs" aria-label="Visão operacional">
          {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border border-rose-300 bg-rose-50 px-4 py-3 text-rose-900"><span>Não foi possível carregar os dados. {error}</span><button onClick={fetchIndustryData} className="font-bold underline">Tentar novamente</button></div>}
          <div className="grid grid-cols-2 gap-x-5 border-y border-[#CFCDC5] py-4 sm:grid-cols-5">
            {([
              { label: 'Previstas', value: kpis.planejadas, status: 'all' as const },
              { label: 'Concluídas', value: kpis.concluidas, status: 'concluida' as const },
              { label: 'Em andamento', value: kpis.emAndamento, status: 'em_andamento' as const },
              { label: 'Pendentes', value: kpis.pendentes, status: 'pendente' as const },
              { label: 'Não realizadas', value: kpis.naoRealizadas, status: 'nao_realizada' as const }
            ]).map((item) => {
              const selected = operationalStatusFilter === item.status;
              return <button key={item.label} type="button" aria-pressed={selected} onClick={() => setOperationalStatusFilter(item.status)} className={`border-l-2 px-3 py-1 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 ${selected ? 'border-indigo-600 bg-indigo-50' : 'border-transparent hover:bg-slate-50'}`}>
                <span className="block text-[11px] font-semibold text-[#526176]">{item.label}</span>
                <span className={`mt-1 block text-2xl font-bold tabular-nums ${selected ? 'text-[#14243B]' : 'text-[#26364B]'}`}>{loading ? '—' : item.value}</span>
              </button>;
            })}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div><h2 className="text-base font-semibold text-[#14243B]">Atendimentos do período</h2><p className="mt-1 text-[#526176]">{filteredOperationalVisits.length} de {allOperationalVisits.length} visitas previstas</p></div>
            <label className="block w-full sm:max-w-sm"><span className="mb-1 block text-[#526176]">Buscar loja ou promotor</span><input value={operationalSearch} onChange={(event) => setOperationalSearch(event.target.value)} placeholder="Nome, código, cidade ou promotor" className="w-full border border-[#C7CFDA] bg-white px-3 py-2 text-sm text-[#14243B] placeholder:text-[#65748A] focus:border-indigo-600 focus:outline-none" /></label>
          </div>
          {loading ? <div className="py-12 text-center text-[#526176]" role="status">Carregando atendimentos…</div> : paginatedOperationalVisits.length === 0 ? <div className="border-y border-[#D5DAE2] py-10 text-center text-[#526176]">Nenhum atendimento encontrado para os filtros selecionados.</div> : <div className="divide-y divide-[#D5DAE2] border-y border-[#D5DAE2]">
            {paginatedOperationalVisits.map((item) => {
              const statusLabel = item.status === 'concluida' ? 'Concluída' : item.status === 'em_andamento' ? 'Em andamento' : item.status === 'nao_realizada' ? 'Não realizada' : item.isPastOverdue ? 'Atrasada' : item.status === 'planejada' ? 'Planejada' : 'Pendente';
              const statusTone = item.status === 'concluida' ? 'text-emerald-800' : item.status === 'em_andamento' ? 'text-sky-800' : item.status === 'nao_realizada' ? 'text-orange-800' : item.isPastOverdue ? 'text-rose-800' : 'text-amber-800';
              return <article key={item.key} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><strong className="truncate text-sm text-[#14243B]">{item.lojaNome}</strong><span className={`text-xs font-semibold ${statusTone}`}>{statusLabel}</span></div><p className="mt-1 truncate text-[#526176]">{item.lojaCidade || 'Cidade não informada'}{item.lojaUf ? ` / ${item.lojaUf}` : ''} · {item.promotorNome}</p><p className="mt-1 text-[#526176]">{item.dataStr} · {item.dayOfWeekLabel} · {item.frequencia}</p></div>
                <div className="flex gap-2 sm:justify-end"><button onClick={() => handleOpenStoreHistory(item.lojaCodigo)} className="border border-[#C7CFDA] px-3 py-2 text-[#26364B] hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600">Histórico</button><button onClick={() => handleOpenVisitDetails(item)} className="border border-[#AEB9C8] px-3 py-2 font-semibold text-[#14243B] hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600">Detalhes</button></div>
              </article>;
            })}
          </div>}
          {!loading && filteredOperationalVisits.length > OPERATIONAL_PAGE_SIZE && <div className="flex items-center justify-between gap-3 text-[#526176]"><span>Página {Math.min(operationalPage, operationalTotalPages)} de {operationalTotalPages}</span><div className="flex gap-2"><button disabled={operationalPage <= 1} onClick={() => setOperationalPage((page) => Math.max(1, page - 1))} className="border border-[#C7CFDA] px-3 py-2 text-[#14243B] disabled:opacity-40">Anterior</button><button disabled={operationalPage >= operationalTotalPages} onClick={() => setOperationalPage((page) => Math.min(operationalTotalPages, page + 1))} className="border border-[#C7CFDA] px-3 py-2 text-[#14243B] disabled:opacity-40">Próxima</button></div></div>}
        </section>
      )}

      {/* RENDERIZAÇÃO DA ABA CENTRAL DE EVIDÊNCIAS */}
      {activeTab === 'evidencias' && (
        <section className="bg-[#F7F6F2] border border-indigo-500/40 rounded-2xl p-6 shadow-2xl space-y-6 font-mono">
          {/* CABEÇALHO DA CENTRAL DE EVIDÊNCIAS E REINICIAR FILTROS */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-[#CFCDC5] pb-4 gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-indigo-400 text-2xl">photo_library</span>
                <h2 className="text-lg font-extrabold text-[#171717] tracking-wide">
                  Central de Evidências Fotográficas
                </h2>
              </div>
              <p className="text-xs text-[#77766F] mt-1">
                {activeIndCode ? `Exibindo evidências reais do parceiro ${activeIndName}` : 'Exibindo evidências consolidadas do ecossistema (GLOBAL)'}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="px-3 py-1 rounded-xl bg-indigo-500/20 text-indigo-300 text-xs font-bold border border-indigo-500/30">
                {evidenciasTotalCount} evidência(s) encontrada(s)
              </span>

              <button
                onClick={handleClearEvidenciasFilters}
                className="px-3 py-1.5 rounded-xl bg-[#E4E2DB] hover:bg-[#CFCDC5] text-[#171717] border border-[#CFCDC5] text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                title="Limpar todos os filtros"
              >
                <span className="material-symbols-outlined text-sm">filter_alt_off</span>
                <span>Limpar Filtros</span>
              </button>
            </div>
          </div>

          {/* BARRA DE FILTROS DA CENTRAL DE EVIDÊNCIAS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs bg-[#E4E2DB] p-4 rounded-xl border border-[#CFCDC5]">
            {/* FILTRO DE PERÍODO */}
            <div>
              <label className="text-[10px] text-[#77766F] font-bold uppercase block mb-1">Período da Visita</label>
              <select
                value={evidenciasPeriod}
                onChange={(e) => { setEvidenciasPeriod(e.target.value as any); setEvidenciasPage(1); }}
                className="w-full bg-[#F7F6F2] text-[#171717] border border-[#CFCDC5] rounded-lg px-2.5 py-1.5 font-bold cursor-pointer focus:outline-none focus:border-indigo-500"
              >
                <option value="7">Últimos 7 dias</option>
                <option value="30">Últimos 30 dias</option>
                <option value="90">Últimos 90 dias</option>
                <option value="all">Todos os períodos</option>
              </select>
            </div>

            {/* FILTRO DE LOJA */}
            <div>
              <label className="text-[10px] text-[#77766F] font-bold uppercase block mb-1">Loja / PDV</label>
              <select
                value={evidenciasLoja}
                onChange={(e) => { setEvidenciasLoja(e.target.value); setEvidenciasPage(1); }}
                className="w-full bg-[#F7F6F2] text-[#171717] border border-[#CFCDC5] rounded-lg px-2.5 py-1.5 font-bold cursor-pointer focus:outline-none focus:border-indigo-500"
              >
                <option value="all">Todas as Lojas</option>
                {lojasList
                  .filter((l) => !activeIndCode || routes.some((r) => r.loja_codigo === l.codigo && r.industria_codigo === activeIndCode))
                  .map((l) => (
                    <option key={l.codigo} value={l.codigo}>
                      {l.nome} ({l.codigo})
                    </option>
                  ))}
              </select>
            </div>

            {/* FILTRO DE PROMOTOR */}
            <div>
              <label className="text-[10px] text-[#77766F] font-bold uppercase block mb-1">Promotor Responsável</label>
              <select
                value={evidenciasPromotor}
                onChange={(e) => { setEvidenciasPromotor(e.target.value); setEvidenciasPage(1); }}
                className="w-full bg-[#F7F6F2] text-[#171717] border border-[#CFCDC5] rounded-lg px-2.5 py-1.5 font-bold cursor-pointer focus:outline-none focus:border-indigo-500"
              >
                <option value="all">Todos os Promotores</option>
                {promotoresList
                  .filter((p) => !activeIndCode || routes.some((r) => r.promotor_matricula === p.matricula && r.industria_codigo === activeIndCode))
                  .map((p) => (
                    <option key={p.matricula} value={p.matricula}>
                      {p.nome}
                    </option>
                  ))}
              </select>
            </div>

            {/* FILTRO DE TIPO DE EVIDÊNCIA */}
            <div>
              <label className="text-[10px] text-[#77766F] font-bold uppercase block mb-1">Tipo de Evidência</label>
              <select
                value={evidenciasTipo}
                onChange={(e) => { setEvidenciasTipo(e.target.value); setEvidenciasPage(1); }}
                className="w-full bg-[#F7F6F2] text-[#171717] border border-[#CFCDC5] rounded-lg px-2.5 py-1.5 font-bold cursor-pointer focus:outline-none focus:border-indigo-500"
              >
                <option value="all">Todos os Tipos</option>
                <option value="fachada">Fachada</option>
                <option value="gondola">Gôndola</option>
                <option value="preco">Etiqueta de Preço</option>
                <option value="ponto_extra">Ponto Extra</option>
                <option value="ruptura">Ruptura</option>
                <option value="outros">Outros</option>
              </select>
            </div>
          </div>

          {/* GRID RESPONSIVO DE EVIDÊNCIAS (2 colunas mobile / 3 tablet / 4 desktop) */}
          {loadingEvidencias ? (
            <div className="py-16 text-center space-y-3">
              <span className="material-symbols-outlined text-indigo-400 text-3xl animate-spin">sync</span>
              <p className="text-xs text-[#77766F]">Carregando galeria paginada da Central de Evidências...</p>
            </div>
          ) : evidenciasPhotos.length === 0 ? (
            <div className="py-16 text-center bg-[#E4E2DB]/50 rounded-xl border border-[#CFCDC5] space-y-2">
              <span className="material-symbols-outlined text-slate-600 text-4xl">no_photography</span>
              <p className="text-xs text-[#171717] font-bold">Nenhuma evidência encontrada para os filtros selecionados.</p>
              <p className="text-[11px] text-[#5F5F5F]">Tente ajustar o período ou selecionar outros critérios de pesquisa.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {evidenciasPhotos.map((photo) => {
                const signedUrl = evidenciasSignedUrls[photo.storage_path];
                const visitObj = photo.visit;
                const lojaNome = visitObj?.loja?.nome || visitObj?.loja_codigo || 'PDV';
                const promotorNome = visitObj?.promotor?.nome || visitObj?.promotor_matricula || 'Promotor';

                const tipoLabel = photo.tipo_foto?.toUpperCase() || 'EVIDÊNCIA';
                const photoTimestamp = visitObj?.completed_at || visitObj?.started_at;
                const photoTime = photoTimestamp
                  ? new Date(photoTimestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                  : null;

                return (
                  <button
                    key={photo.id}
                    type="button"
                    aria-label={`Abrir evidência ${tipoLabel} da loja ${lojaNome}, ${visitObj?.data_visita || 'data não informada'}${photoTime ? ` às ${photoTime}` : ''}`}
                    onClick={() => setZoomedEvidencia(photo)}
                    className="p-2.5 rounded-xl bg-[#E4E2DB] border border-[#CFCDC5] hover:border-indigo-700 transition-all cursor-pointer flex flex-col justify-between space-y-2 group text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700"
                  >
                    <div className="relative aspect-square rounded-lg bg-[#E4E2DB] overflow-hidden border border-[#CFCDC5] flex items-center justify-center">
                      {signedUrl && !failedPhotoKeys.has(photo.id || photo.storage_path) ? (
                        <img
                          src={signedUrl}
                          alt={photo.legenda || photo.tipo_foto}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          onError={() => {
                            setFailedPhotoKeys((prev) => new Set(prev).add(photo.id || photo.storage_path));
                          }}
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center p-3 text-center text-[#77766F] space-y-1">
                          <span className="material-symbols-outlined text-slate-500 text-3xl">broken_image</span>
                          <span className="text-[9px] font-bold text-[#5F5F5F] uppercase">Foto Indisponível</span>
                        </div>
                      )}

                      <span className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded bg-black/75 backdrop-blur-sm text-cyan-300 text-[9px] font-bold border border-cyan-500/30 uppercase">
                        {tipoLabel}
                      </span>
                    </div>

                    <div className="space-y-1 text-left">
                      <h4 className="text-xs font-bold text-[#171717] truncate" title={lojaNome}>
                        {lojaNome}
                      </h4>
                      <p className="text-[10px] text-[#526176]">
                        {visitObj?.data_visita || 'Data não informada'}{photoTime ? ` · ${photoTime}` : ''} · <strong className="text-[#0E7490]">{promotorNome}</strong>
                      </p>
                      {photo.legenda && (
                        <p className="text-[10px] text-[#171717] truncate italic" title={photo.legenda}>
                          "{photo.legenda}"
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* CONTROLES DE PAGINAÇÃO (12 EVIDÊNCIAS POR PÁGINA) */}
          {evidenciasTotalCount > 12 && (
            <div className="flex items-center justify-between pt-4 border-t border-[#CFCDC5]">
              <span className="text-xs text-[#77766F]">
                Página <strong>{evidenciasPage}</strong> de <strong>{Math.ceil(evidenciasTotalCount / 12)}</strong>
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEvidenciasPage((p) => Math.max(1, p - 1))}
                  disabled={evidenciasPage === 1}
                  className="px-3 py-1.5 rounded-lg bg-[#E4E2DB] border border-[#CFCDC5] text-[#171717] hover:text-white font-bold text-xs disabled:opacity-40 cursor-pointer"
                >
                  Anterior
                </button>
                <button
                  onClick={() => setEvidenciasPage((p) => (p * 12 < evidenciasTotalCount ? p + 1 : p))}
                  disabled={evidenciasPage * 12 >= evidenciasTotalCount}
                  className="px-3 py-1.5 rounded-lg bg-[#E4E2DB] border border-[#CFCDC5] text-[#171717] hover:text-white font-bold text-xs disabled:opacity-40 cursor-pointer"
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Relatório executivo compacto com os dados operacionais existentes. */}
      {activeTab === 'relatorio' && (
        <section className="space-y-6 font-mono text-xs" aria-label="Relatório executivo">
          <header className="flex flex-col gap-4 border-b border-[#D5DAE2] pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="text-[#526176]">{activeIndName} · {periodFilter === 'today' ? 'Hoje' : periodFilter === 'week' ? 'Últimos 7 dias' : 'Últimos 30 dias'}</p><h2 className="mt-1 text-xl font-semibold text-[#14243B]">Execução das visitas</h2><p className="mt-1 text-[#526176]">{kpis.concluidas} de {kpis.planejadas} visitas concluídas no período.</p></div>
            <div className="flex flex-wrap gap-2 no-print"><button onClick={handleExportExcel} className="border border-[#AEB9C8] px-3 py-2 font-semibold text-[#14243B] hover:bg-slate-50">Exportar Excel</button><button onClick={handlePrintPDF} className="bg-indigo-700 px-3 py-2 font-semibold text-white hover:bg-indigo-800">Imprimir / Salvar PDF</button></div>
          </header>
          <div className="grid gap-5 border-b border-[#D5DAE2] pb-5 sm:grid-cols-2 lg:grid-cols-4">
            <div><span className="text-[#526176]">Visitas planejadas</span><p className="mt-1 text-3xl font-semibold tabular-nums text-[#14243B]">{loading ? '—' : kpis.planejadas}</p></div>
            <div><span className="text-[#526176]">Visitas concluídas</span><p className="mt-1 text-3xl font-semibold tabular-nums text-emerald-800">{loading ? '—' : kpis.concluidas}</p></div>
            <div><span className="text-[#526176]">Taxa de execução</span><p className="mt-1 text-3xl font-semibold tabular-nums text-[#14243B]">{kpis.planejadas ? `${kpis.aderencia}%` : '—'}</p><span className="text-[#526176]">{kpis.pendentes} pendentes · {kpis.emAndamento} em andamento · {kpis.naoRealizadas} não realizadas</span></div>
            <div><span className="text-[#526176]">Lojas visitadas</span><p className="mt-1 text-3xl font-semibold tabular-nums text-[#14243B]">{loading ? '—' : kpis.lojasComVisita}<span className="text-base font-normal text-[#526176]"> / {kpis.lojas}</span></p><span className="text-[#526176]">{kpis.lojas ? Math.round((kpis.lojasComVisita / kpis.lojas) * 100) : 0}% de cobertura</span></div>
          </div>
          <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
            <section><div className="mb-4 flex items-baseline justify-between"><h3 className="text-sm font-semibold text-[#14243B]">Planejadas e concluídas por dia</h3><span className="text-[#526176]">{temporalEvolution.length} dias</span></div><div className="space-y-3">
              {temporalEvolution.slice(-10).map((item) => { const max = Math.max(1, ...temporalEvolution.map((day) => day.planejadas)); return <div key={item.dateStr} className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-3"><span className="text-[#526176]">{item.dateStr.slice(5)} · {item.dayShort}</span><div className="space-y-1"><div className="h-2 bg-[#E2E7EE]"><div className="h-full bg-indigo-700" style={{ width: `${(item.planejadas / max) * 100}%` }} /></div><div className="h-2 bg-[#E2E7EE]"><div className="h-full bg-emerald-700" style={{ width: `${(item.realizadas / max) * 100}%` }} /></div></div><span className="w-20 text-right tabular-nums text-[#26364B]">{item.realizadas}/{item.planejadas}</span></div>; })}
              {temporalEvolution.length === 0 && <p className="py-6 text-[#B8C4D6]">Sem dados para o período.</p>}
            </div><div className="mt-4 flex gap-4 text-[#526176]"><span><i className="mr-2 inline-block h-2 w-2 bg-indigo-700" />Planejadas</span><span><i className="mr-2 inline-block h-2 w-2 bg-emerald-700" />Concluídas</span></div></section>
            <section className="border-t border-[#D5DAE2] pt-4 lg:border-l lg:border-t-0 lg:border-[#D5DAE2] lg:pl-6 lg:pt-0"><h3 className="mb-3 text-sm font-semibold text-[#14243B]">Pontos de atenção</h3><ul className="space-y-3 text-[#26364B]">{kpis.atrasadas > 0 && <li><strong className="text-rose-800">{kpis.atrasadas} visitas atrasadas</strong><p className="mt-1 text-[#526176]">Requerem regularização pela equipe de campo.</p></li>}{kpis.lojas > kpis.lojasComVisita && <li><strong>{kpis.lojas - kpis.lojasComVisita} lojas ainda sem visita concluída</strong></li>}{occurrencesSummary.rupturas > 0 && <li><strong>{occurrencesSummary.rupturas} ocorrências de ruptura</strong></li>}{validitySummary.vencidos > 0 && <li><strong className="text-rose-800">{validitySummary.vencidos} produtos vencidos</strong></li>}{kpis.atrasadas === 0 && kpis.lojas <= kpis.lojasComVisita && occurrencesSummary.rupturas === 0 && validitySummary.vencidos === 0 && <li className="text-emerald-800">Nenhum alerta operacional neste período.</li>}</ul><button onClick={() => setActiveTab('evidencias')} className="mt-5 border border-[#AEB9C8] px-3 py-2 font-semibold text-[#14243B] hover:bg-slate-50">Abrir evidências ({photosSummary.total})</button></section>
          </div>
          <section className="border-t border-[#D5DAE2] pt-4"><div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold text-[#14243B]">Lojas que precisam de acompanhamento</h3><span className="text-[#526176]">{lojasPerformance.length} lojas no período</span></div>{lojasPerformance.length === 0 ? <p className="py-4 text-[#526176]">Sem lojas no período selecionado.</p> : <div className="divide-y divide-[#D5DAE2]">{lojasPerformance.slice(0, 5).map((loja) => <button key={loja.codigo} onClick={() => handleOpenStoreHistory(loja.codigo)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 py-3 text-left hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_5rem_5rem_6rem]"><span className="min-w-0"><strong className="block truncate text-[#14243B]">{loja.nome}</strong><small className="text-[#526176]">{loja.cidade}{loja.uf ? ` / ${loja.uf}` : ''}</small></span><span className="text-[#26364B]">{loja.concluidas}/{loja.planejadas} concluídas</span><span className="text-amber-800">{loja.pendentes} pendentes</span><span className="text-rose-800">{loja.atrasadas} atrasadas</span></button>)}</div>}<button onClick={() => setActiveTab('operacional')} className="mt-3 font-semibold text-indigo-800 underline underline-offset-4">Ver todos os atendimentos</button></section>
          <p className="text-[#526176]">Atualizado às {lastUpdate}</p>
        </section>
      )}

      {/* MODAL DE FOTO AMPLIADA DA CENTRAL DE EVIDÊNCIAS */}
      {zoomedEvidencia && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 font-mono">
          <div className="bg-[#F7F6F2] border border-indigo-500/40 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl space-y-4 p-5">
            <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-3">
              <div>
                <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 text-[10px] font-bold border border-cyan-500/30 uppercase">
                  {zoomedEvidencia.tipo_foto}
                </span>
                <h3 className="text-sm font-bold text-[#171717] mt-1">
                  {zoomedEvidencia.visit?.loja?.nome || 'PDV'}
                </h3>
              </div>
              <button
                onClick={() => setZoomedEvidencia(null)}
                className="p-1.5 rounded-xl bg-[#E4E2DB] text-[#77766F] hover:text-[#171717] cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* FOTO GRANDE */}
            <div className="relative aspect-video rounded-xl bg-[#E4E2DB] overflow-hidden border border-[#CFCDC5] flex items-center justify-center">
              {evidenciasSignedUrls[zoomedEvidencia.storage_path] && !failedPhotoKeys.has(zoomedEvidencia.id || zoomedEvidencia.storage_path) ? (
                <img
                  src={evidenciasSignedUrls[zoomedEvidencia.storage_path]}
                  alt={zoomedEvidencia.legenda || zoomedEvidencia.tipo_foto}
                  className="w-full h-full object-contain"
                  onError={() => {
                    setFailedPhotoKeys((prev) => new Set(prev).add(zoomedEvidencia.id || zoomedEvidencia.storage_path));
                  }}
                />
              ) : (
                <div className="flex flex-col items-center justify-center p-6 text-center text-[#77766F] space-y-2">
                  <span className="material-symbols-outlined text-slate-500 text-5xl">broken_image</span>
                  <p className="text-xs font-bold text-[#171717]">Imagem não pôde ser carregada pelo navegador</p>
                  <p className="text-[11px] text-[#5F5F5F]">O arquivo pode ter expirado ou estar protegido pelas regras de segurança de armazenamento.</p>
                </div>
              )}
            </div>

            {/* DADOS DA FOTO E BOTÃO DE ATENDIMENTO COMPLETO */}
            <div className="text-xs space-y-2 bg-[#E4E2DB] p-3 rounded-xl border border-[#CFCDC5]">
              <p className="text-[#171717]">
                Data do Atendimento: <strong className="text-[#171717]">{zoomedEvidencia.visit?.data_visita}</strong>
              </p>
              <p className="text-[#171717]">
                Promotor: <strong className="text-cyan-300">{zoomedEvidencia.visit?.promotor?.nome || zoomedEvidencia.visit?.promotor_matricula}</strong>
              </p>
              {zoomedEvidencia.legenda && (
                <p className="text-[#77766F] italic">
                  Legenda: "{zoomedEvidencia.legenda}"
                </p>
              )}
            </div>

            <div className="pt-2 flex justify-between items-center border-t border-[#CFCDC5]">
              <button
                onClick={() => handleOpenFullReportFromEvidencia(zoomedEvidencia)}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">fact_check</span>
                <span>Ver Atendimento Completo</span>
              </button>

              <button
                onClick={() => setZoomedEvidencia(null)}
                className="px-4 py-2 rounded-xl bg-[#E4E2DB] hover:bg-[#CFCDC5] text-[#171717] font-bold text-xs cursor-pointer"
              >
                Fechar Zoom
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedVisitItem && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto font-mono">
          <div className="bg-[#F7F6F2] border border-indigo-500/40 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-6">
            {/* CABEÇALHO DO MODAL */}
            <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-4">
              <div>
                <h3 className="text-lg font-extrabold text-[#171717]">
                  Relatório da Visita — {selectedVisitItem.lojaNome}
                </h3>
                <p className="text-xs text-[#77766F]">
                  Data Prevista: {selectedVisitItem.dataStr} • Promotor: {selectedVisitItem.promotorNome}
                </p>
              </div>

              <button
                onClick={() => setSelectedVisitItem(null)}
                className="p-1.5 rounded-xl bg-[#E4E2DB] border border-[#CFCDC5] text-[#77766F] hover:text-[#171717] cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* DADOS GERAIS DO ATENDIMENTO */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-[#E4E2DB] border border-[#CFCDC5]">
                <span className="text-[#5F5F5F] block">SITUAÇÃO</span>
                <span className="font-extrabold text-[#171717] uppercase">{selectedVisitItem.status}</span>
              </div>

              <div className="p-3 rounded-xl bg-[#E4E2DB] border border-[#CFCDC5]">
                <span className="text-[#5F5F5F] block">CHECK-IN</span>
                <span className="font-extrabold text-[#171717]">
                  {selectedVisitItem.startedAt ? new Date(selectedVisitItem.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-[#E4E2DB] border border-[#CFCDC5]">
                <span className="text-[#5F5F5F] block">CHECK-OUT</span>
                <span className="font-extrabold text-[#171717]">
                  {selectedVisitItem.completedAt ? new Date(selectedVisitItem.completedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-[#E4E2DB] border border-[#CFCDC5]">
                <span className="text-[#5F5F5F] block">DURAÇÃO</span>
                <span className="font-extrabold text-amber-300">{selectedVisitItem.duracaoFormatada || '—'}</span>
              </div>
            </div>

            {/* MOTIVO DE NÃO REALIZAÇÃO OU OBSERVAÇÃO GERAL */}
            {selectedVisitItem.motivoNaoRealizada && (
              <div className="p-4 rounded-xl bg-orange-950/30 border border-orange-500/40 text-xs space-y-1">
                <span className="text-orange-400 font-bold block uppercase">JUSTIFICATIVA DE NÃO REALIZAÇÃO:</span>
                <p className="text-slate-200">{selectedVisitItem.motivoNaoRealizada}</p>
              </div>
            )}

            {selectedVisitItem.visitObj?.observacao_geral && (
              <div className="p-4 rounded-xl bg-[#E4E2DB] border border-[#CFCDC5] text-xs space-y-1">
                <span className="text-[#77766F] font-bold block uppercase">OBSERVAÇÃO GERAL DO PROMOTOR:</span>
                <p className="text-slate-200">{selectedVisitItem.visitObj.observacao_geral}</p>
              </div>
            )}

            {/* 11. CHECKLIST OPERACIONAL */}
            <div className="space-y-3 pt-2 border-t border-[#CFCDC5]">
              <h4 className="text-xs font-bold text-slate-[#171717] uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400 text-base">fact_check</span>
                Checklist Operacional Registrado
              </h4>

              {selectedVisitItem.visitObj?.checklist_items && selectedVisitItem.visitObj.checklist_items.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {selectedVisitItem.visitObj.checklist_items.map((item, idx) => (
                    <div key={idx} className="p-2.5 rounded-xl bg-[#E4E2DB] border border-[#CFCDC5] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`material-symbols-outlined text-base ${item.checked ? 'text-emerald-400' : 'text-slate-600'}`}>
                          {item.checked ? 'check_circle' : 'cancel'}
                        </span>
                        <span className="text-slate-200 font-bold">{item.item_label}</span>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${item.checked ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-[#77766F]'}`}>
                        {item.checked ? 'Sim' : 'Não'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-[#5F5F5F] italic">Nenhum item de checklist registrado nesta visita.</p>
              )}
            </div>

            {/* 10. EVIDÊNCIAS FOTOGRÁFICAS DA VISITA (STORAGE PRIVADO) */}
            <div className="space-y-3 pt-2 border-t border-[#CFCDC5]">
              <h4 className="text-xs font-bold text-slate-[#171717] uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-cyan-400 text-base">photo_camera</span>
                Evidências Fotográficas do Ponto de Venda
              </h4>

              {loadingPhotos ? (
                <div className="py-4 text-center text-xs text-[#77766F] flex items-center justify-center gap-2">
                  <span className="material-symbols-outlined text-cyan-400 animate-spin">sync</span>
                  <span>Gerando Signed URLs seguras para fotos...</span>
                </div>
              ) : selectedVisitItem.visitObj?.photos && selectedVisitItem.visitObj.photos.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {selectedVisitItem.visitObj.photos.map((p, idx) => {
                    const signedUrl = signedPhotoUrls[p.storage_path];

                    return (
                      <div key={idx} className="p-2 rounded-xl bg-[#E4E2DB] border border-[#CFCDC5] space-y-1.5 flex flex-col justify-between">
                        <div className="relative aspect-video rounded-lg bg-[#F7F6F2] overflow-hidden border border-[#CFCDC5] flex items-center justify-center">
                          {signedUrl ? (
                            <img src={signedUrl} alt={p.legenda || p.tipo_foto} className="w-full h-full object-cover" />
                          ) : (
                            <span className="material-symbols-outlined text-slate-600 text-2xl">image</span>
                          )}
                          <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-sm text-cyan-300 text-[9px] font-bold uppercase border border-cyan-500/30">
                            {p.tipo_foto}
                          </span>
                        </div>
                        {p.legenda && <p className="text-[10px] text-[#171717] truncate" title={p.legenda}>{p.legenda}</p>}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] text-[#5F5F5F] italic">Nenhuma foto registrada nesta visita.</p>
              )}
            </div>

            {/* 12. OCORRÊNCIAS E RUPTURAS */}
            <div className="space-y-3 pt-2 border-t border-[#CFCDC5]">
              <h4 className="text-xs font-bold text-slate-[#171717] uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-rose-400 text-base">report</span>
                Ocorrências & Rupturas Registradas
              </h4>

              {selectedVisitItem.visitObj?.occurrences && selectedVisitItem.visitObj.occurrences.length > 0 ? (
                <div className="space-y-2 text-xs">
                  {selectedVisitItem.visitObj.occurrences.map((occ, idx) => (
                    <div key={idx} className="p-3 rounded-xl bg-[#E4E2DB] border border-[#CFCDC5] flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-bold uppercase border border-rose-500/30">
                            {occ.tipo}
                          </span>
                          <span className="text-[#77766F] text-[10px]">
                            {occ.created_at ? new Date(occ.created_at).toLocaleString('pt-BR') : ''}
                          </span>
                        </div>
                        <p className="text-slate-200 mt-1">{occ.descricao}</p>
                      </div>

                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${
                        occ.resolvido ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      }`}>
                        {occ.resolvido ? '🟢 Resolvido' : '🔴 Aberto'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-[#5F5F5F] italic">Nenhuma ocorrência ou ruptura identificada nesta visita.</p>
              )}
            </div>

            {/* 13. CONTROLE DE VALIDADE DE PRODUTOS */}
            <div className="space-y-3 pt-2 border-t border-[#CFCDC5]">
              <h4 className="text-xs font-bold text-slate-[#171717] uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400 text-base">event</span>
                Controle de Validade de Produtos (FIFO)
              </h4>

              {selectedVisitItem.visitObj?.validity_items && selectedVisitItem.visitObj.validity_items.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-[#CFCDC5]">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-[#E4E2DB] text-[#77766F] text-[10px] uppercase border-b border-[#CFCDC5]">
                        <th className="py-2 px-3">Produto</th>
                        <th className="py-2 px-3 text-right">Qtd.</th>
                        <th className="py-2 px-3">Vencimento</th>
                        <th className="py-2 px-3">Lote</th>
                        <th className="py-2 px-3 text-right">Situação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#CFCDC5] text-[#171717]">
                      {selectedVisitItem.visitObj.validity_items.map((val, idx) => {
                        const [vYear, vMonth, vDay] = val.data_vencimento.split('-').map(Number);
                        const vencDate = new Date(vYear, vMonth - 1, vDay);
                        const todayLocal = new Date();
                        const todayZero = new Date(todayLocal.getFullYear(), todayLocal.getMonth(), todayLocal.getDate());
                        const diffDays = Math.ceil((vencDate.getTime() - todayZero.getTime()) / (1000 * 60 * 60 * 24));

                        let statusBadge = { label: '🟢 Normal', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
                        if (diffDays < 0) {
                          statusBadge = { label: '🔴 Vencido', color: 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse' };
                        } else if (diffDays <= 3) {
                          statusBadge = { label: '🚨 ≤ 3 dias', color: 'bg-rose-500/20 text-rose-300 border-rose-500/40' };
                        } else if (diffDays <= 7) {
                          statusBadge = { label: '🟠 4–7 dias', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
                        } else if (diffDays <= 30) {
                          statusBadge = { label: '🟡 8–30 dias', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' };
                        }

                        return (
                          <tr key={idx} className="hover:bg-[#E4E2DB]/50">
                            <td className="py-2 px-3 font-bold text-white">{val.produto_nome}</td>
                            <td className="py-2 px-3 text-right font-bold text-amber-300">{val.quantidade}</td>
                            <td className="py-2 px-3">{vencDate.toLocaleDateString('pt-BR')}</td>
                            <td className="py-2 px-3 text-[#77766F]">{val.lote || '—'}</td>
                            <td className="py-2 px-3 text-right">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${statusBadge.color}`}>
                                {statusBadge.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-[11px] text-[#5F5F5F] italic">Nenhum produto cadastrado para controle de validade nesta visita.</p>
              )}
            </div>

            {/* RODAPÉ DO MODAL */}
            <div className="pt-3 border-t border-[#CFCDC5] flex justify-end">
              <button
                onClick={() => setSelectedVisitItem(null)}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs cursor-pointer transition-all shadow-md"
              >
                Fechar Relatório
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 10. MODAL / DRAWER DE HISTÓRICO OPERACIONAL DA LOJA SELECIONADA */}
      {selectedStoreCode && selectedStoreObj && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto font-mono">
          <div className="bg-[#F7F6F2] border border-indigo-500/40 rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto shadow-2xl p-5 sm:p-6 space-y-6">
            {/* CABEÇALHO DA LOJA */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-[#CFCDC5] pb-4 gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center justify-center font-bold text-xl shrink-0">
                  <span className="material-symbols-outlined text-2xl">storefront</span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base sm:text-lg font-extrabold text-[#171717]">
                      {selectedStoreObj.nome}
                    </h3>
                    <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-bold border border-indigo-500/30 uppercase">
                      {selectedStoreObj.codigo}
                    </span>
                  </div>
                  <p className="text-xs text-[#77766F] mt-0.5">
                    {selectedStoreObj.cidade} / {selectedStoreObj.uf} • Frequência:{' '}
                    <strong className="text-cyan-400">
                      {selectedStoreRoutes[0]?.frequencia || 'SEMANAL'}
                    </strong>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                <button
                  onClick={() => setSelectedStoreCode(null)}
                  className="p-2 rounded-xl bg-[#E4E2DB] border border-[#CFCDC5] text-[#77766F] hover:text-[#171717] cursor-pointer transition-colors"
                >
                  <span className="material-symbols-outlined text-xl">close</span>
                </button>
              </div>
            </div>

            {/* SELETOR DE PERÍODO E KPIS RESUMO DA LOJA */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#171717] uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-indigo-400 text-sm">analytics</span>
                  Resumo Operacional do Período
                </span>

                {/* FILTROS DE PERÍODO DA LOJA */}
                <div className="flex items-center gap-1 bg-[#E4E2DB] p-1 rounded-xl border border-[#CFCDC5] self-start sm:self-auto">
                  {(['7', '30', '90', 'all'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => handleHistoryPeriodChange(p)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                        historyPeriodFilter === p
                          ? 'bg-indigo-600 text-white shadow-md'
                          : 'text-[#77766F] hover:text-slate-200'
                      }`}
                    >
                      {p === 'all' ? 'Todos' : `${p} dias`}
                    </button>
                  ))}
                </div>
              </div>

              {/* CARDS KPIS RESUMO DA LOJA */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                <div className="p-3 rounded-xl bg-[#E4E2DB] border border-[#CFCDC5]">
                  <span className="text-[10px] text-purple-400 block font-bold uppercase">PLANEJADOS</span>
                  <span className="text-xl font-extrabold text-purple-300 mt-0.5 block">{loadingHistory ? '...' : storeHistoryKPIs.planejadas}</span>
                </div>

                <div className="p-3 rounded-xl bg-[#E4E2DB] border border-emerald-500/30 bg-emerald-950/10">
                  <span className="text-[10px] text-emerald-400 block font-bold uppercase">CONCLUÍDOS</span>
                  <span className="text-xl font-extrabold text-emerald-300 mt-0.5 block">{loadingHistory ? '...' : storeHistoryKPIs.concluidas}</span>
                </div>

                <div className="p-3 rounded-xl bg-[#E4E2DB] border border-rose-500/30 bg-rose-950/10">
                  <span className="text-[10px] text-rose-400 block font-bold uppercase">PENDENTES</span>
                  <span className="text-xl font-extrabold text-rose-300 mt-0.5 block">{loadingHistory ? '...' : storeHistoryKPIs.pendentes}</span>
                </div>

                <div className="p-3 rounded-xl bg-[#E4E2DB] border border-orange-500/30 bg-orange-950/10">
                  <span className="text-[10px] text-orange-400 block font-bold uppercase">NÃO REALIZADOS</span>
                  <span className="text-xl font-extrabold text-orange-300 mt-0.5 block">{loadingHistory ? '...' : storeHistoryKPIs.naoRealizadas}</span>
                </div>

                <div className="p-3 rounded-xl bg-[#E4E2DB] border border-indigo-500/30 bg-indigo-950/10 col-span-2 sm:col-span-1">
                  <span className="text-[10px] text-indigo-300 block font-bold uppercase">ADERÊNCIA</span>
                  {loadingHistory || systemSettings.status === 'loading' ? (
                    <span className="text-xs font-bold text-[#77766F] mt-1 block">Carregando...</span>
                  ) : systemSettings.mode !== 'OPERACAO_OFICIAL' || systemSettings.status !== 'loaded' ? (
                    <span className="text-[10px] font-bold text-amber-300 mt-1 block leading-tight">Fase de implantação — SLA não ativo</span>
                  ) : (
                    <span className="text-xl font-extrabold text-indigo-200 mt-0.5 block">{`${storeHistoryKPIs.aderencia}%`}</span>
                  )}
                </div>
              </div>
            </div>

            {/* TIMELINE / LISTA DE HISTÓRICO DE ATENDIMENTOS */}
            <div className="space-y-3 pt-2 border-t border-[#CFCDC5]">
              <h4 className="text-xs font-bold text-[#171717] uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-indigo-400 text-base">history_edu</span>
                Linha do Tempo de Atendimentos ({storeHistoryOperationalItems.length})
              </h4>

              {loadingHistory ? (
                <div className="py-10 text-center space-y-2">
                  <span className="material-symbols-outlined text-indigo-400 text-2xl animate-spin">sync</span>
                  <p className="text-xs text-[#77766F]">Carregando histórico da loja...</p>
                </div>
              ) : storeHistoryOperationalItems.length === 0 ? (
                <div className="py-8 text-center bg-[#E4E2DB]/50 rounded-xl border border-[#CFCDC5] space-y-1">
                  <span className="material-symbols-outlined text-slate-600 text-2xl">event_busy</span>
                  <p className="text-xs text-[#171717] font-bold">Nenhum atendimento registrado no período.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {storeHistoryOperationalItems.map((item) => {
                    const isConcluida = item.status === 'concluida';
                    const isEmAndamento = item.status === 'em_andamento';
                    const isNaoRealizada = item.status === 'nao_realizada';
                    const isAtrasada = item.isPastOverdue;
                    const photosCount = item.visitObj?.photos?.length || 0;

                    return (
                      <div
                        key={item.key}
                        className={`p-4 rounded-xl border transition-all ${
                          isConcluida
                            ? 'bg-[#E4E2DB] border-emerald-500/30 hover:border-emerald-500/60'
                            : isEmAndamento
                            ? 'bg-[#E4E2DB] border-blue-500/30 hover:border-blue-500/60'
                            : isNaoRealizada
                            ? 'bg-[#E4E2DB] border-orange-500/30 hover:border-orange-500/60'
                            : isAtrasada
                            ? 'bg-rose-950/20 border-rose-500/40 hover:border-rose-500/70'
                            : 'bg-[#E4E2DB] border-[#CFCDC5]'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[#CFCDC5]">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-[#171717] text-sm">{item.dataStr}</span>
                            <span className="text-[#5F5F5F] text-xs">• {item.dayOfWeekLabel}</span>
                          </div>

                          <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold border self-start sm:self-auto ${
                            isConcluida ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' :
                            isEmAndamento ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' :
                            isNaoRealizada ? 'bg-orange-500/20 text-orange-300 border-orange-500/40' :
                            isAtrasada ? 'bg-rose-950 text-rose-300 border-rose-500 animate-pulse' :
                            'bg-rose-500/20 text-rose-300 border-rose-500/40'
                          }`}>
                            {isConcluida ? '🟢 CONCLUÍDA' :
                             isEmAndamento ? '🔵 EM ANDAMENTO' :
                             isNaoRealizada ? '🟠 NÃO REALIZADA' :
                             isAtrasada ? '🚨 ATRASADA' : '🔴 PENDENTE'}
                          </span>
                        </div>

                        <div className="pt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                          <div>
                            <span className="text-[#5F5F5F] block text-[10px]">PROMOTOR RESPONSÁVEL</span>
                            <span className="font-bold text-cyan-300">{item.promotorNome}</span>
                          </div>

                          <div>
                            <span className="text-[#5F5F5F] block text-[10px]">HORÁRIO / DURAÇÃO</span>
                            <span className="text-slate-200">
                              {item.startedAt ? new Date(item.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                              {' → '}
                              {item.completedAt ? new Date(item.completedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                              {item.duracaoFormatada && <strong className="text-amber-300 ml-1">({item.duracaoFormatada})</strong>}
                            </span>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-[#CFCDC5]">
                            {photosCount > 0 && (
                              <span className="text-[11px] text-cyan-300 font-bold bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/30 flex items-center gap-1">
                                📷 {photosCount} evidência(s)
                              </span>
                            )}

                            {item.visitObj ? (
                              <button
                                onClick={() => handleOpenVisitDetails(item)}
                                className="px-3 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white border border-indigo-500/40 text-xs font-bold transition-all cursor-pointer"
                              >
                                Abrir Relatório
                              </button>
                            ) : (
                              <span className="text-[10px] text-[#5F5F5F] italic">
                                Atendimento planejado sem execução
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* RODAPÉ DO DRAWER DE HISTÓRICO */}
            <div className="pt-3 border-t border-[#CFCDC5] flex justify-end">
              <button
                onClick={() => setSelectedStoreCode(null)}
                className="px-5 py-2 rounded-xl bg-[#E4E2DB] hover:bg-[#CFCDC5] text-[#171717] border border-[#CFCDC5] font-bold text-xs cursor-pointer transition-all"
              >
                Fechar Histórico
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DOCUMENTO EXECUTIVO IMPRESSO A4 (Visível exclusivamente em @media print) */}
      <ExecutiveReportDocument
        activeIndName={activeIndName}
        activeIndCode={activeIndCode}
        periodFilter={periodFilter}
        operationMode={systemSettings.mode}
        kpis={kpis}
        promotoresPerformance={promotoresPerformance}
        occurrencesSummary={occurrencesSummary}
        validitySummary={validitySummary}
        photosSummary={photosSummary}
        temporalEvolution={temporalEvolution}
        topProblematicLojas={topProblematicLojas}
      />
    </div>
  );
};
