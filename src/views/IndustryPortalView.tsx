import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import * as XLSX from 'xlsx';
import type { Visit, RouteItem, ToastMessage, VisitPhoto } from '../types';
import {
  calculateOperationalVisits,
  getLocalDateString,
  OperationalVisitItem,
  DayOfWeekDate
} from '../utils/routePlanner';
import { ExecutiveReportDocument } from '../components/reports/ExecutiveReportDocument';

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

      // Query RLS leve de Visitas (sem carregar relutantemente fotos e tabelas filhas completas)
      let visitsQuery = supabase
        .from('visits')
        .select(`
          *,
          promotor:promotores(matricula, nome),
          loja:lojas(codigo, nome, cidade, uf, endereco),
          industria:industrias(codigo, nome),
          photos:visit_photos(id, storage_path, tipo_foto),
          occurrences:visit_occurrences(id, tipo, descricao, resolvido),
          validity_items:visit_product_validity(id, produto_nome, quantidade, data_vencimento)
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

      // Query de Rotas respeitando o filtro de indústria ativo
      let rotasQuery = supabase.from('rotas').select(`
        *,
        industria:industrias(codigo, nome),
        loja:lojas(codigo, nome, cidade, uf),
        promotor:promotores(matricula, nome)
      `);

      if (activeIndCode) {
        rotasQuery = rotasQuery.eq('industria_codigo', activeIndCode);
      }

      // Executar consultas com RLS ativo no Supabase
      const [visitsRes, rotasRes, promotoresRes, lojasRes] = await Promise.all([
        visitsQuery,
        rotasQuery,
        supabase.from('promotores').select('*'),
        supabase.from('lojas').select('*')
      ]);

      if (visitsRes.error) throw visitsRes.error;
      if (rotasRes.error) throw rotasRes.error;

      const realVisits = (visitsRes.data as unknown as Visit[]) || [];
      const realRoutes = (rotasRes.data as unknown as RouteItem[]) || [];

      setVisits(realVisits);
      setRoutes(realRoutes);
      setPromotoresList(promotoresRes.data || []);
      setLojasList(lojasRes.data || []);

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
      todayStr
    }).filter((v) => !activeIndCode || v.industriaCodigo === activeIndCode);
  }, [routes, visits, promotoresList, periodDaysRange, todayStr, activeIndCode]);

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

  // KPIs Principais da Indústria
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

  // Filtrar apenas pendências (Hoje e Atrasadas) para a Seção Destacada
  const pendenciasList = useMemo(() => {
    return allOperationalVisits.filter((v) => v.status === 'pendente');
  }, [allOperationalVisits]);

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
          loja:lojas(codigo, nome, cidade, uf, endereco),
          industria:industrias(codigo, nome),
          photos:visit_photos(id, storage_path)
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
      todayStr
    });
    // Ordenar do mais recente para o mais antigo
    return items.sort((a, b) => b.dataStr.localeCompare(a.dataStr));
  }, [selectedStoreCode, selectedStoreRoutes, historyVisitsData, promotoresList, historyDaysRange, todayStr]);

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
          *,
          visit:visits!inner(
            id,
            data_visita,
            status,
            industria_codigo,
            loja_codigo,
            promotor_matricula,
            observacao_geral,
            loja:lojas(codigo, nome, cidade, uf),
            promotor:promotores(matricula, nome)
          )
        `, { count: 'exact' });

      // Filtro RLS por indústria
      if (activeIndCode) {
        query = query.eq('visit.industria_codigo', activeIndCode);
      }

      // Filtro de Período (baseado em visits.data_visita)
      if (evidenciasPeriod !== 'all') {
        const days = parseInt(evidenciasPeriod, 10);
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - days);
        const pastDateStr = getLocalDateString(pastDate);
        query = query.gte('visit.data_visita', pastDateStr);
      }

      // Filtro de Loja
      if (evidenciasLoja !== 'all') {
        query = query.eq('visit.loja_codigo', evidenciasLoja);
      }

      // Filtro de Promotor
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
            const { data: signData } = await supabase.storage
              .from('visit-photos')
              .createSignedUrl(p.storage_path, 3600);
            if (signData?.signedUrl) {
              urlMap[p.storage_path] = signData.signedUrl;
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
  }, [evidenciasPage, evidenciasPeriod, evidenciasLoja, evidenciasPromotor, evidenciasTipo, activeIndCode]);

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
            const { data } = await supabase.storage
              .from('visit-photos')
              .createSignedUrl(photo.storage_path, 3600);
            if (data?.signedUrl) {
              urlMap[photo.storage_path] = data.signedUrl;
            }
          }
        }
        setSignedPhotoUrls(urlMap);
      }
    } catch (err) {
      console.warn('Erro ao carregar detalhes completos da visita sob demanda:', err);
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
        ['Aderência Operacional (%)', `${kpis.aderencia}%`, 'Taxa de execução em relação ao planejado'],
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
      <section className="bg-[#171b26] border border-indigo-500/40 rounded-2xl p-6 shadow-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 flex items-center justify-center font-bold text-2xl shadow-[0_0_15px_rgba(99,102,241,0.3)] shrink-0">
            <span className="material-symbols-outlined text-3xl">domain</span>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold text-white tracking-tight font-mono">
                Portal da Indústria
              </h1>

              {/* SELETOR DE INDÚSTRIA (VISÍVEL APENAS PARA ADMIN / GESTOR) */}
              {isAdminOrGestor ? (
                <div className="relative inline-block">
                  <select
                    value={selectedIndFilter}
                    onChange={(e) => setSelectedIndFilter(e.target.value)}
                    className="bg-[#10141f] text-indigo-300 border border-indigo-500/40 rounded-xl px-3 py-1 font-mono font-bold text-xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-lg"
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

            <p className="text-xs text-slate-300 font-mono mt-1">
              Parceiro: <strong className="text-indigo-400 font-bold">{activeIndName}</strong> • Telemetria em Tempo Real MK9
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 self-end md:self-auto font-mono text-xs">
          <span className="text-slate-400 bg-[#10141f] border border-[#1e2433] px-3 py-2 rounded-xl">
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
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 bg-[#171b26] border border-[#1e2433] rounded-2xl p-4 font-mono text-xs">
        {/* NAVEGAÇÃO DE ABAS */}
        <div className="flex items-center gap-1.5 bg-[#10141f] border border-[#1e2433] rounded-xl p-1 w-full md:w-auto">
          <button
            onClick={() => setActiveTab('operacional')}
            className={`flex-1 md:flex-initial px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === 'operacional'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
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
                : 'text-slate-400 hover:text-white'
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
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span className="material-symbols-outlined text-base">assessment</span>
            <span>Relatório Executivo</span>
          </button>
        </div>

        {/* PERÍODO GLOBAL (EXIBIDO NA ABA OPERACIONAL E RELATÓRIO) */}
        {(activeTab === 'operacional' || activeTab === 'relatorio') && (
          <div className="flex items-center gap-1.5 bg-[#10141f] border border-[#1e2433] rounded-xl p-1 w-full md:w-auto">
            {activeTab === 'operacional' && (
              <button
                onClick={() => setPeriodFilter('today')}
                className={`flex-1 md:flex-initial px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                  periodFilter === 'today'
                    ? 'bg-indigo-600/40 text-indigo-200 border border-indigo-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-white'
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
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              7 Dias
            </button>
            <button
              onClick={() => setPeriodFilter('month')}
              className={`flex-1 md:flex-initial px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                periodFilter === 'month'
                  ? 'bg-indigo-600/40 text-indigo-200 border border-indigo-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              30 Dias
            </button>
          </div>
        )}
      </div>

      {/* RENDERIZAÇÃO DA ABA OPERACIONAL */}
      {activeTab === 'operacional' && (
        <>
          {/* ESTADO DE ERRO */}
          {error && (
            <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-500/50 text-rose-300 font-mono text-xs flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-xl text-rose-400">error</span>
                <span>Não foi possível carregar os dados. Tente novamente. ({error})</span>
              </div>
              <button onClick={fetchIndustryData} className="underline font-bold hover:text-white">
                Tentar novamente
              </button>
            </div>
          )}

          {/* 4. CARDS DE KPIS PRINCIPAIS DA INDÚSTRIA */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 font-mono text-xs">
            <div className="p-4 rounded-2xl bg-[#171b26] border border-[#1e2433]">
              <span className="text-[10px] text-slate-400 block font-bold uppercase">PDVs CONTRATADOS</span>
              <span className="text-2xl font-extrabold text-white mt-1 block">{loading ? '...' : kpis.lojas}</span>
              <span className="text-[10px] text-slate-500 block mt-0.5">{loading ? '...' : `${kpis.lojasComVisita} com visita realizada`}</span>
            </div>

            <div className="p-4 rounded-2xl bg-[#171b26] border border-purple-500/30 bg-purple-950/10">
              <span className="text-[10px] text-purple-400 block font-bold uppercase">VISITAS PLANEJADAS</span>
              <span className="text-2xl font-extrabold text-purple-300 mt-1 block">{loading ? '...' : kpis.planejadas}</span>
              <span className="text-[10px] text-purple-400/70 block mt-0.5">Atendimentos previstos no período</span>
            </div>

            <div className="p-4 rounded-2xl bg-[#171b26] border border-emerald-500/30 bg-emerald-950/10">
              <span className="text-[10px] text-emerald-400 block font-bold uppercase">VISITAS CONCLUÍDAS</span>
              <span className="text-2xl font-extrabold text-emerald-300 mt-1 block">{loading ? '...' : kpis.concluidas}</span>
              <span className="text-[10px] text-emerald-400/70 block mt-0.5">Check-outs realizados</span>
            </div>

            <div className="p-4 rounded-2xl bg-[#171b26] border border-rose-500/30 bg-rose-950/10">
              <span className="text-[10px] text-rose-400 block font-bold uppercase">VISITAS PENDENTES</span>
              <span className="text-2xl font-extrabold text-rose-300 mt-1 block">{loading ? '...' : kpis.pendentes}</span>
              <span className="text-[10px] text-rose-400/70 block mt-0.5 truncate">{loading ? '...' : `${kpis.atrasadas} atrasadas • ${kpis.pendentesHoje} para hoje`}</span>
            </div>

            <div className="p-4 rounded-2xl bg-[#171b26] border border-orange-500/30 bg-orange-950/10">
              <span className="text-[10px] text-orange-400 block font-bold uppercase">NÃO REALIZADAS</span>
              <span className="text-2xl font-extrabold text-orange-300 mt-1 block">{loading ? '...' : kpis.naoRealizadas}</span>
              <span className="text-[10px] text-orange-400/70 block mt-0.5">Visitas não realizadas</span>
            </div>

            <div className="p-4 rounded-2xl bg-[#171b26] border border-indigo-500/40 bg-indigo-950/20">
              <span className="text-[10px] text-indigo-300 block font-bold uppercase">ADERÊNCIA</span>
              <span className="text-2xl font-extrabold text-indigo-200 mt-1 block">{loading ? '...' : `${kpis.aderencia}%`}</span>
              <span className="text-[10px] text-indigo-400/70 block mt-0.5">Taxa de Execução</span>
            </div>
          </div>

          {/* 8. SEÇÃO DESTACADA: PENDÊNCIAS DE ATENDIMENTO DA INDÚSTRIA */}
          <section className="bg-[#171b26] border border-rose-500/40 rounded-2xl p-5 shadow-2xl space-y-4 font-mono">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-[#1e2433] pb-3 gap-2">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-rose-400 text-xl animate-pulse">warning</span>
                <div>
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                    PENDÊNCIAS DE ATENDIMENTO ({pendenciasList.length})
                  </h2>
                  <p className="text-[11px] text-slate-400 font-normal">
                    Atendimentos previstos que ainda precisam de execução no campo.
                  </p>
                </div>
              </div>
              <span className="text-[11px] text-rose-400 font-bold bg-rose-500/10 px-2.5 py-1 rounded-lg border border-rose-500/30 self-start sm:self-auto">
                Requer Regularização em Campo
              </span>
            </div>

            {pendenciasList.length === 0 ? (
              <div className="py-8 text-center space-y-1 bg-[#10141f]/50 rounded-xl border border-[#1e2433]">
                <span className="material-symbols-outlined text-emerald-400 text-3xl">check_circle</span>
                <p className="text-xs text-slate-300 font-bold">Nenhuma pendência encontrada para o período selecionado.</p>
                <p className="text-[11px] text-slate-500">Todos os atendimentos das suas lojas foram executados no prazo.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[#1e2433]">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-[#10141f] border-b border-[#1e2433] text-slate-400 text-[10px] uppercase">
                      <th className="py-2.5 px-3">Data Prevista</th>
                      <th className="py-2.5 px-3">Loja / PDV</th>
                      <th className="py-2.5 px-3">Promotor</th>
                      <th className="py-2.5 px-3">Frequência</th>
                      <th className="py-2.5 px-3">Situação</th>
                      <th className="py-2.5 px-3 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e2433] text-slate-300">
                    {pendenciasList.map((item) => (
                      <tr key={item.key} className="hover:bg-[#10141f]/80 transition-colors">
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-white">{item.dataStr}</div>
                          <div className="text-[10px] text-slate-500">{item.dayOfWeekLabel}</div>
                        </td>
                        <td className="py-2.5 px-3 font-bold text-white">
                          {item.lojaNome}
                          {item.lojaCidade && <span className="text-[10px] text-slate-400 block font-normal">{item.lojaCidade} - {item.lojaUf}</span>}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-cyan-400">{item.promotorNome}</td>
                        <td className="py-2.5 px-3 text-slate-400">{item.frequencia}</td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            item.isPastOverdue
                              ? 'bg-rose-950 text-rose-300 border-rose-500 animate-pulse'
                              : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                          }`}>
                            {item.isPastOverdue ? '🚨 ATRASADA' : '🔴 PENDENTE'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={() => handleOpenVisitDetails(item)}
                            className="px-3 py-1 rounded-lg bg-[#10141f] hover:bg-[#1e2433] text-indigo-300 border border-indigo-500/30 text-[11px] font-bold transition-all cursor-pointer"
                          >
                            Ver Detalhes
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 7. CENTRAL DE ACOMPANHAMENTO: STATUS DOS ATENDIMENTOS DA INDÚSTRIA */}
          <section className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-5 shadow-2xl space-y-4 font-mono">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#1e2433] pb-3">
              <div>
                <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <span className="material-symbols-outlined text-indigo-400 text-xl">store</span>
                  STATUS DOS ATENDIMENTOS DO PERÍODO ({allOperationalVisits.length})
                </h2>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Atendimentos previstos no período selecionado e situação de execução em tempo real.
                </p>
              </div>
              <span className="text-[11px] text-slate-400">
                Exibindo <strong>{allOperationalVisits.length}</strong> atendimento(s)
              </span>
            </div>

            {loading ? (
              <div className="py-12 text-center space-y-3">
                <span className="material-symbols-outlined text-indigo-400 text-3xl animate-spin">sync</span>
                <p className="text-xs text-slate-400">Carregando operação da indústria...</p>
              </div>
            ) : allOperationalVisits.length === 0 ? (
              <div className="py-12 text-center space-y-2 bg-[#10141f]/50 rounded-xl border border-[#1e2433]">
                <span className="material-symbols-outlined text-slate-600 text-3xl">event_busy</span>
                <p className="text-xs text-slate-300 font-bold">Nenhuma operação encontrada para o período.</p>
              </div>
            ) : (
              <>
                {/* TABELA DESKTOP */}
                <div className="hidden md:block overflow-x-auto rounded-xl border border-[#1e2433]">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-[#10141f] border-b border-[#1e2433] text-slate-400 text-[10px] uppercase">
                        <th className="py-3 px-4">Loja / PDV</th>
                        <th className="py-3 px-4">Cidade/UF</th>
                        <th className="py-3 px-4">Frequência</th>
                        <th className="py-3 px-4">Promotor</th>
                        <th className="py-3 px-4">Data Prevista</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Detalhes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e2433] text-slate-300">
                      {allOperationalVisits.map((item) => {
                        let badge = { label: '🔴 PENDENTE', style: 'bg-rose-500/10 text-rose-400 border-rose-500/30' };
                        if (item.isPastOverdue) {
                          badge = { label: '🚨 ATRASADA', style: 'bg-rose-950 text-rose-300 border-rose-500 animate-pulse font-bold' };
                        } else if (item.status === 'em_andamento') {
                          badge = { label: '🔵 EM ANDAMENTO', style: 'bg-blue-500/10 text-blue-400 border-blue-500/30' };
                        } else if (item.status === 'nao_realizada') {
                          badge = { label: '🟠 NÃO REALIZADA', style: 'bg-orange-500/10 text-orange-400 border-orange-500/30' };
                        } else if (item.status === 'concluida') {
                          badge = { label: '🟢 CONCLUÍDA', style: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' };
                        } else if (item.status === 'planejada') {
                          badge = { label: '⚪ PLANEJADA', style: 'bg-slate-800 text-slate-300 border-slate-700' };
                        }

                        return (
                          <tr key={item.key} className="hover:bg-[#10141f]/80 transition-colors">
                            <td className="py-3 px-4 font-bold text-white">
                              <button
                                onClick={() => handleOpenStoreHistory(item.lojaCodigo)}
                                className="text-left font-bold text-white hover:text-indigo-400 underline decoration-indigo-500/40 cursor-pointer transition-colors flex items-center gap-1.5"
                              >
                                <span className="material-symbols-outlined text-xs text-indigo-400">history</span>
                                <span>{item.lojaNome}</span>
                              </button>
                            </td>
                            <td className="py-3 px-4 text-slate-400">{item.lojaCidade || '—'}/{item.lojaUf || '-'}</td>
                            <td className="py-3 px-4 text-slate-400">{item.frequencia}</td>
                            <td className="py-3 px-4 font-bold text-cyan-400">{item.promotorNome}</td>
                            <td className="py-3 px-4">
                              <div className="font-bold text-white">{item.dataStr}</div>
                              <div className="text-[10px] text-slate-500">{item.dayOfWeekLabel}</div>
                            </td>
                            <td className="py-3 px-4">
                              <span className={`px-2 py-0.5 rounded text-[10px] border ${badge.style}`}>
                                {badge.label}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleOpenStoreHistory(item.lojaCodigo)}
                                className="px-2.5 py-1.5 rounded-lg bg-[#10141f] hover:bg-indigo-950/40 text-indigo-300 border border-indigo-500/30 text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                                title="Ver Histórico Completo da Loja"
                              >
                                <span className="material-symbols-outlined text-sm">history</span>
                                <span>Histórico</span>
                              </button>
                              <button
                                onClick={() => handleOpenVisitDetails(item)}
                                className="px-2.5 py-1.5 rounded-lg bg-[#10141f] hover:bg-[#1e2433] text-slate-300 border border-[#1e2433] text-xs font-bold transition-all cursor-pointer"
                              >
                                Relatório
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* CARDS MOBILE (390px / 768px) */}
                <div className="md:hidden space-y-3">
                  {allOperationalVisits.map((item) => (
                    <div key={item.key} className="p-4 rounded-xl bg-[#10141f] border border-[#1e2433] space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-400">{item.dataStr} • {item.dayOfWeekLabel}</span>
                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${
                          item.status === 'concluida' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
                          item.status === 'em_andamento' ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' :
                          item.status === 'nao_realizada' ? 'bg-orange-500/20 text-orange-300 border-orange-500/30' :
                          item.isPastOverdue ? 'bg-rose-950 text-rose-300 border-rose-500 animate-pulse' :
                          'bg-rose-500/20 text-rose-300 border-rose-500/30'
                        }`}>
                          {item.status.toUpperCase()}
                        </span>
                      </div>

                      <h3
                        onClick={() => handleOpenStoreHistory(item.lojaCodigo)}
                        className="text-sm font-bold text-white hover:text-indigo-400 cursor-pointer flex items-center gap-1.5"
                      >
                        <span className="material-symbols-outlined text-xs text-indigo-400">history</span>
                        <span>{item.lojaNome}</span>
                      </h3>
                      <p className="text-xs text-slate-400">Cidade: {item.lojaCidade}/{item.lojaUf} • Promotor: <strong className="text-cyan-300">{item.promotorNome}</strong></p>

                      <div className="pt-2 border-t border-[#1e2433] flex justify-end gap-2">
                        <button
                          onClick={() => handleOpenStoreHistory(item.lojaCodigo)}
                          className="px-3 py-1.5 rounded-lg bg-[#171b26] text-indigo-300 border border-indigo-500/30 text-xs font-bold flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-sm">history</span>
                          <span>Histórico Loja</span>
                        </button>
                        <button
                          onClick={() => handleOpenVisitDetails(item)}
                          className="px-3 py-1.5 rounded-lg bg-[#171b26] text-slate-300 border border-[#1e2433] text-xs font-bold"
                        >
                          Relatório
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}

      {/* RENDERIZAÇÃO DA ABA CENTRAL DE EVIDÊNCIAS */}
      {activeTab === 'evidencias' && (
        <section className="bg-[#171b26] border border-indigo-500/40 rounded-2xl p-6 shadow-2xl space-y-6 font-mono">
          {/* CABEÇALHO DA CENTRAL DE EVIDÊNCIAS E REINICIAR FILTROS */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-[#1e2433] pb-4 gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-indigo-400 text-2xl">photo_library</span>
                <h2 className="text-lg font-extrabold text-white tracking-wide">
                  Central de Evidências Fotográficas
                </h2>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {activeIndCode ? `Exibindo evidências reais do parceiro ${activeIndName}` : 'Exibindo evidências consolidadas do ecossistema (GLOBAL)'}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="px-3 py-1 rounded-xl bg-indigo-500/20 text-indigo-300 text-xs font-bold border border-indigo-500/30">
                {evidenciasTotalCount} evidência(s) encontrada(s)
              </span>

              <button
                onClick={handleClearEvidenciasFilters}
                className="px-3 py-1.5 rounded-xl bg-[#10141f] hover:bg-[#1e2433] text-slate-300 border border-[#1e2433] text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                title="Limpar todos os filtros"
              >
                <span className="material-symbols-outlined text-sm">filter_alt_off</span>
                <span>Limpar Filtros</span>
              </button>
            </div>
          </div>

          {/* BARRA DE FILTROS DA CENTRAL DE EVIDÊNCIAS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs bg-[#10141f] p-4 rounded-xl border border-[#1e2433]">
            {/* FILTRO DE PERÍODO */}
            <div>
              <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Período da Visita</label>
              <select
                value={evidenciasPeriod}
                onChange={(e) => { setEvidenciasPeriod(e.target.value as any); setEvidenciasPage(1); }}
                className="w-full bg-[#171b26] text-white border border-[#1e2433] rounded-lg px-2.5 py-1.5 font-bold cursor-pointer focus:outline-none focus:border-indigo-500"
              >
                <option value="7">Últimos 7 dias</option>
                <option value="30">Últimos 30 dias</option>
                <option value="90">Últimos 90 dias</option>
                <option value="all">Todos os períodos</option>
              </select>
            </div>

            {/* FILTRO DE LOJA */}
            <div>
              <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Loja / PDV</label>
              <select
                value={evidenciasLoja}
                onChange={(e) => { setEvidenciasLoja(e.target.value); setEvidenciasPage(1); }}
                className="w-full bg-[#171b26] text-white border border-[#1e2433] rounded-lg px-2.5 py-1.5 font-bold cursor-pointer focus:outline-none focus:border-indigo-500"
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
              <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Promotor Responsável</label>
              <select
                value={evidenciasPromotor}
                onChange={(e) => { setEvidenciasPromotor(e.target.value); setEvidenciasPage(1); }}
                className="w-full bg-[#171b26] text-white border border-[#1e2433] rounded-lg px-2.5 py-1.5 font-bold cursor-pointer focus:outline-none focus:border-indigo-500"
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
              <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Tipo de Evidência</label>
              <select
                value={evidenciasTipo}
                onChange={(e) => { setEvidenciasTipo(e.target.value); setEvidenciasPage(1); }}
                className="w-full bg-[#171b26] text-white border border-[#1e2433] rounded-lg px-2.5 py-1.5 font-bold cursor-pointer focus:outline-none focus:border-indigo-500"
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
              <p className="text-xs text-slate-400">Carregando galeria paginada da Central de Evidências...</p>
            </div>
          ) : evidenciasPhotos.length === 0 ? (
            <div className="py-16 text-center bg-[#10141f]/50 rounded-xl border border-[#1e2433] space-y-2">
              <span className="material-symbols-outlined text-slate-600 text-4xl">no_photography</span>
              <p className="text-xs text-slate-300 font-bold">Nenhuma evidência encontrada para os filtros selecionados.</p>
              <p className="text-[11px] text-slate-500">Tente ajustar o período ou selecionar outros critérios de pesquisa.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {evidenciasPhotos.map((photo) => {
                const signedUrl = evidenciasSignedUrls[photo.storage_path];
                const visitObj = photo.visit;
                const lojaNome = visitObj?.loja?.nome || visitObj?.loja_codigo || 'PDV';
                const promotorNome = visitObj?.promotor?.nome || visitObj?.promotor_matricula || 'Promotor';

                let tipoLabel = photo.tipo_foto?.toUpperCase() || 'EVIDÊNCIA';

                return (
                  <div
                    key={photo.id}
                    onClick={() => setZoomedEvidencia(photo)}
                    className="p-2.5 rounded-xl bg-[#10141f] border border-[#1e2433] hover:border-indigo-500/50 transition-all cursor-pointer flex flex-col justify-between space-y-2 group"
                  >
                    <div className="relative aspect-square rounded-lg bg-[#171b26] overflow-hidden border border-[#1e2433] flex items-center justify-center">
                      {signedUrl ? (
                        <img
                          src={signedUrl}
                          alt={photo.legenda || photo.tipo_foto}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <span className="material-symbols-outlined text-slate-600 text-3xl">image</span>
                      )}

                      <span className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded bg-black/75 backdrop-blur-sm text-cyan-300 text-[9px] font-bold border border-cyan-500/30 uppercase">
                        {tipoLabel}
                      </span>
                    </div>

                    <div className="space-y-1 text-left">
                      <h4 className="text-xs font-bold text-white truncate" title={lojaNome}>
                        {lojaNome}
                      </h4>
                      <p className="text-[10px] text-slate-400">
                        {visitObj?.data_visita} • <strong className="text-cyan-300">{promotorNome}</strong>
                      </p>
                      {photo.legenda && (
                        <p className="text-[10px] text-slate-300 truncate italic" title={photo.legenda}>
                          "{photo.legenda}"
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* CONTROLES DE PAGINAÇÃO (12 EVIDÊNCIAS POR PÁGINA) */}
          {evidenciasTotalCount > 12 && (
            <div className="flex items-center justify-between pt-4 border-t border-[#1e2433]">
              <span className="text-xs text-slate-400">
                Página <strong>{evidenciasPage}</strong> de <strong>{Math.ceil(evidenciasTotalCount / 12)}</strong>
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEvidenciasPage((p) => Math.max(1, p - 1))}
                  disabled={evidenciasPage === 1}
                  className="px-3 py-1.5 rounded-lg bg-[#10141f] border border-[#1e2433] text-slate-300 hover:text-white font-bold text-xs disabled:opacity-40 cursor-pointer"
                >
                  Anterior
                </button>
                <button
                  onClick={() => setEvidenciasPage((p) => (p * 12 < evidenciasTotalCount ? p + 1 : p))}
                  disabled={evidenciasPage * 12 >= evidenciasTotalCount}
                  className="px-3 py-1.5 rounded-lg bg-[#10141f] border border-[#1e2433] text-slate-300 hover:text-white font-bold text-xs disabled:opacity-40 cursor-pointer"
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* 5. RENDERIZAÇÃO DA ABA RELATÓRIO EXECUTIVO */}
      {activeTab === 'relatorio' && (
        <section className="space-y-6 animate-fadeIn print-executive-report">
          {/* 1. CABEÇALHO DA SEÇÃO EXECUTIVA */}
          <div className="bg-[#171b26] border border-indigo-500/30 rounded-2xl p-5 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 font-mono">
            <div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-indigo-400 text-2xl">assessment</span>
                <h2 className="text-xl font-extrabold text-white tracking-tight uppercase">
                  RELATÓRIO EXECUTIVO
                </h2>
              </div>
              <p className="text-xs text-slate-300 mt-1">
                Indústria: <strong className="text-indigo-400 font-bold">{activeIndName}</strong> • Período: <span className="text-cyan-300 font-bold uppercase">{periodFilter === 'today' ? 'Hoje' : periodFilter === 'week' ? 'Últimos 7 dias' : 'Últimos 30 dias'}</span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs no-print">
              <span className="px-3 py-1.5 rounded-xl bg-[#10141f] border border-[#1e2433] text-slate-400">
                Atualizado às: <strong className="text-white">{lastUpdate}</strong>
              </span>

              <button
                onClick={handleExportExcel}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
                title="Exportar planilha Excel completa com 3 abas"
              >
                <span className="material-symbols-outlined text-base">download</span>
                <span>EXPORTAR EXCEL</span>
              </button>

              <button
                onClick={handlePrintPDF}
                className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
                title="Imprimir ou Salvar em PDF via Navegador"
              >
                <span className="material-symbols-outlined text-base">print</span>
                <span>IMPRIMIR / SALVAR PDF</span>
              </button>
            </div>
          </div>

          {/* 2. KPIS PRINCIPAIS EXECUTIVOS (GRID DE 8 CARDS) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
            {/* Card 1: PDVs Contratados */}
            <div className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-4 flex flex-col justify-between shadow-lg">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">PDVs Contratados</span>
              <div className="flex items-baseline justify-between mt-2">
                <span className="text-2xl font-black text-white">{kpis.lojas}</span>
                <span className="material-symbols-outlined text-indigo-400 text-xl">store</span>
              </div>
              <span className="text-[10px] text-slate-500 mt-1">Lojas ativas na escala</span>
            </div>

            {/* Card 2: Visitas Planejadas */}
            <div className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-4 flex flex-col justify-between shadow-lg">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Visitas Planejadas</span>
              <div className="flex items-baseline justify-between mt-2">
                <span className="text-2xl font-black text-cyan-300">{kpis.planejadas}</span>
                <span className="material-symbols-outlined text-cyan-400 text-xl">calendar_month</span>
              </div>
              <span className="text-[10px] text-slate-500 mt-1">Total no período</span>
            </div>

            {/* Card 3: Visitas Realizadas */}
            <div className="bg-[#171b26] border border-emerald-500/30 rounded-2xl p-4 flex flex-col justify-between shadow-lg">
              <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Visitas Realizadas</span>
              <div className="flex items-baseline justify-between mt-2">
                <span className="text-2xl font-black text-emerald-400">{kpis.concluidas}</span>
                <span className="material-symbols-outlined text-emerald-400 text-xl">check_circle</span>
              </div>
              <span className="text-[10px] text-emerald-500/80 mt-1">Check-out concluído</span>
            </div>

            {/* Card 4: Visitas Pendentes */}
            <div className="bg-[#171b26] border border-amber-500/30 rounded-2xl p-4 flex flex-col justify-between shadow-lg">
              <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Visitas Pendentes</span>
              <div className="flex items-baseline justify-between mt-2">
                <span className="text-2xl font-black text-amber-400">{kpis.pendentes}</span>
                <span className="material-symbols-outlined text-amber-400 text-xl">schedule</span>
              </div>
              <span className="text-[10px] text-amber-500/80 mt-1 truncate">
                {`${kpis.atrasadas} atrasadas • ${kpis.pendentesHoje} para hoje`}
              </span>
            </div>

            {/* Card 5: Visitas Atrasadas */}
            <div className="bg-[#171b26] border border-rose-500/30 rounded-2xl p-4 flex flex-col justify-between shadow-lg">
              <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">Visitas Atrasadas</span>
              <div className="flex items-baseline justify-between mt-2">
                <span className="text-2xl font-black text-rose-400">{kpis.atrasadas}</span>
                <span className="material-symbols-outlined text-rose-400 text-xl">warning</span>
              </div>
              <span className="text-[10px] text-rose-500/80 mt-1">Excederam a data limite</span>
            </div>

            {/* Card 6: Visitas Não Realizadas */}
            <div className="bg-[#171b26] border border-slate-600 rounded-2xl p-4 flex flex-col justify-between shadow-lg">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Não Realizadas</span>
              <div className="flex items-baseline justify-between mt-2">
                <span className="text-2xl font-black text-slate-300">{kpis.naoRealizadas}</span>
                <span className="material-symbols-outlined text-slate-400 text-xl">block</span>
              </div>
              <span className="text-[10px] text-slate-500 mt-1">Justificativa informada</span>
            </div>

            {/* Card 7: Aderência Operacional */}
            <div className="bg-[#171b26] border border-purple-500/40 rounded-2xl p-4 flex flex-col justify-between shadow-lg">
              <span className="text-[10px] font-bold text-purple-300 uppercase tracking-wider">Aderência Operacional</span>
              <div className="flex items-baseline justify-between mt-2">
                <span className="text-2xl font-black text-purple-300">{kpis.aderencia}%</span>
                <span className="material-symbols-outlined text-purple-400 text-xl">speed</span>
              </div>
              <div className="w-full bg-[#10141f] h-1.5 rounded-full overflow-hidden mt-1.5 border border-[#1e2433]">
                <div className="bg-purple-500 h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, kpis.aderencia)}%` }} />
              </div>
            </div>

            {/* Card 8: Cobertura de PDVs */}
            <div className="bg-[#171b26] border border-indigo-500/40 rounded-2xl p-4 flex flex-col justify-between shadow-lg">
              <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider">Cobertura de PDVs</span>
              <div className="flex items-baseline justify-between mt-2">
                <span className="text-2xl font-black text-indigo-300">
                  {kpis.lojas > 0 ? Math.round((kpis.lojasComVisita / kpis.lojas) * 100) : 0}%
                </span>
                <span className="material-symbols-outlined text-indigo-400 text-xl">grid_view</span>
              </div>
              <span className="text-[10px] text-indigo-400/80 mt-1">{kpis.lojasComVisita} de {kpis.lojas} PDVs atendidos</span>
            </div>
          </div>

          {/* RESSALVA DE ROTA QUINZENAL */}
          {hasQuinzenalRoutes && (
            <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-300 text-xs font-mono flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-400 text-base shrink-0">info</span>
              <span>
                Observação: a projeção de visitas quinzenais utiliza o modelo operacional atual e ainda não possui distinção de Semana A/B.
              </span>
            </div>
          )}

          {/* 3. EVOLUÇÃO TEMPORAL & STATUS DA OPERAÇÃO (GRID 2 COLUNAS) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 font-mono">
            {/* EVOLUÇÃO TEMPORAL */}
            <div className="lg:col-span-2 bg-[#171b26] border border-[#1e2433] rounded-2xl p-5 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-[#1e2433] pb-3">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <span className="material-symbols-outlined text-cyan-400 text-base">show_chart</span>
                  Evolução Temporal das Visitas
                </h3>
                <span className="text-[10px] text-slate-400">Total no período ({periodFilter === 'today' ? 'Hoje' : periodFilter === 'week' ? '7d' : '30d'})</span>
              </div>

              {/* BARRAS SIMPLES DE EVOLUÇÃO TEMPORAL */}
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {temporalEvolution.map((item, idx) => {
                  const maxVal = Math.max(1, item.planejadas);
                  const realPct = Math.round((item.realizadas / maxVal) * 100);
                  const pendPct = Math.round((item.pendentes / maxVal) * 100);

                  return (
                    <div key={idx} className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-300 font-bold">{item.dateStr} ({item.dayShort})</span>
                        <div className="flex items-center gap-3 text-[10px]">
                          <span className="text-emerald-400">Realizadas: {item.realizadas}</span>
                          <span className="text-amber-400">Pendentes: {item.pendentes}</span>
                          <span className="text-slate-400">Total: {item.planejadas}</span>
                        </div>
                      </div>

                      <div className="w-full bg-[#10141f] h-2.5 rounded-full overflow-hidden flex border border-[#1e2433]">
                        <div className="bg-emerald-500 h-full transition-all" style={{ width: `${realPct}%` }} title={`Realizadas: ${item.realizadas}`} />
                        <div className="bg-amber-500 h-full transition-all" style={{ width: `${pendPct}%` }} title={`Pendentes: ${item.pendentes}`} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ALERTAS EXECUTIVOS & STATUS DA OPERAÇÃO */}
            <div className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-5 space-y-4 shadow-xl flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 border-b border-[#1e2433] pb-3">
                  <span className="material-symbols-outlined text-rose-400 text-base">warning</span>
                  Atenção na Operação
                </h3>

                <div className="space-y-2.5 mt-3 text-xs">
                  {kpis.atrasadas > 0 ? (
                    <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300 flex items-start gap-2">
                      <span className="material-symbols-outlined text-rose-400 text-base shrink-0 mt-0.5">error</span>
                      <div>
                        <strong className="block font-bold">{kpis.atrasadas} visita(s) atrasada(s)</strong>
                        <span className="text-[11px] text-rose-400/80">Requer atenção imediata da equipe de campo.</span>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 flex items-center gap-2">
                      <span className="material-symbols-outlined text-emerald-400 text-base">check_circle</span>
                      <span>Zero visitas atrasadas na operação!</span>
                    </div>
                  )}

                  {kpis.lojas - kpis.lojasComVisita > 0 && (
                    <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-300 flex items-start gap-2">
                      <span className="material-symbols-outlined text-amber-400 text-base shrink-0 mt-0.5">store</span>
                      <div>
                        <strong className="block font-bold">{kpis.lojas - kpis.lojasComVisita} PDV(s) sem atendimento</strong>
                        <span className="text-[11px] text-amber-400/80">Lojas contratadas que ainda não concluíram visitas no período.</span>
                      </div>
                    </div>
                  )}

                  {occurrencesSummary.rupturas > 0 && (
                    <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300 flex items-start gap-2">
                      <span className="material-symbols-outlined text-rose-400 text-base shrink-0 mt-0.5">report</span>
                      <div>
                        <strong className="block font-bold">{occurrencesSummary.rupturas} ocorrência(s) de ruptura</strong>
                        <span className="text-[11px] text-rose-400/80">Falta de produto identificada nas gôndolas.</span>
                      </div>
                    </div>
                  )}

                  {validitySummary.vencidos > 0 && (
                    <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300 flex items-start gap-2">
                      <span className="material-symbols-outlined text-rose-400 text-base shrink-0 mt-0.5">event_busy</span>
                      <div>
                        <strong className="block font-bold">{validitySummary.vencidos} produto(s) vencido(s)</strong>
                        <span className="text-[11px] text-rose-400/80">Exigem recolhimento imediato.</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* BOTAO PARA VER EVIDENCIAS */}
              <button
                onClick={() => setActiveTab('evidencias')}
                className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer mt-4"
              >
                <span className="material-symbols-outlined text-base">photo_library</span>
                <span>Ver Central de Evidências ({photosSummary.total} Fotos)</span>
              </button>
            </div>
          </div>

          {/* 4. MÓDULOS DE RESUMO: OCORRÊNCIAS, VALIDADE & EVIDÊNCIAS (GRID 3 COLUNAS) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-mono text-xs">
            {/* OCORRÊNCIAS */}
            <div className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-5 space-y-3 shadow-xl">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 border-b border-[#1e2433] pb-2.5">
                <span className="material-symbols-outlined text-rose-400 text-base">report</span>
                Principais Ocorrências ({occurrencesSummary.total})
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2 rounded-xl bg-[#10141f] border border-[#1e2433]">
                  <span className="text-slate-300">Rupturas de Estoque</span>
                  <span className="font-bold text-rose-400">{occurrencesSummary.rupturas}</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-xl bg-[#10141f] border border-[#1e2433]">
                  <span className="text-slate-300">Divergências de Preço</span>
                  <span className="font-bold text-amber-400">{occurrencesSummary.preco}</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-xl bg-[#10141f] border border-[#1e2433]">
                  <span className="text-slate-300">Falta de Espaço</span>
                  <span className="font-bold text-cyan-400">{occurrencesSummary.espaco}</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-xl bg-[#10141f] border border-[#1e2433]">
                  <span className="text-slate-300">Outras Ocorrências</span>
                  <span className="font-bold text-slate-400">{occurrencesSummary.outros}</span>
                </div>
              </div>
            </div>

            {/* VALIDADE */}
            <div className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-5 space-y-3 shadow-xl">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 border-b border-[#1e2433] pb-2.5">
                <span className="material-symbols-outlined text-amber-400 text-base">event</span>
                Validade de Produtos ({validitySummary.totalAuditados})
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2 rounded-xl bg-[#10141f] border border-[#1e2433]">
                  <span className="text-slate-300">Produtos Vencidos</span>
                  <span className={`font-bold ${validitySummary.vencidos > 0 ? 'text-rose-400 animate-pulse' : 'text-emerald-400'}`}>{validitySummary.vencidos}</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-xl bg-[#10141f] border border-[#1e2433]">
                  <span className="text-slate-300">Vencendo em ≤ 3 dias</span>
                  <span className="font-bold text-rose-400">{validitySummary.vencendo3d}</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-xl bg-[#10141f] border border-[#1e2433]">
                  <span className="text-slate-300">Vencendo em 4–7 dias</span>
                  <span className="font-bold text-amber-400">{validitySummary.vencendo7d}</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-xl bg-[#10141f] border border-[#1e2433]">
                  <span className="text-slate-300">Vencendo em 8–30 dias</span>
                  <span className="font-bold text-yellow-400">{validitySummary.vencendo30d}</span>
                </div>
              </div>
            </div>

            {/* EVIDÊNCIAS */}
            <div className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-5 space-y-3 shadow-xl">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 border-b border-[#1e2433] pb-2.5">
                <span className="material-symbols-outlined text-cyan-400 text-base">photo_camera</span>
                Evidências por Tipo ({photosSummary.total})
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2 rounded-xl bg-[#10141f] border border-[#1e2433]">
                  <span className="text-slate-300">Gôndola / Exposição</span>
                  <span className="font-bold text-cyan-400">{photosSummary.gondola}</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-xl bg-[#10141f] border border-[#1e2433]">
                  <span className="text-slate-300">Fachada / Entrada</span>
                  <span className="font-bold text-indigo-400">{photosSummary.fachada}</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-xl bg-[#10141f] border border-[#1e2433]">
                  <span className="text-slate-300">Etiqueta de Preço</span>
                  <span className="font-bold text-amber-400">{photosSummary.preco}</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-xl bg-[#10141f] border border-[#1e2433]">
                  <span className="text-slate-300">Ponto Extra / Ruptura</span>
                  <span className="font-bold text-rose-400">{photosSummary.ponto_extra + photosSummary.ruptura}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 5. TABELA DE DESEMPENHO POR LOJA */}
          <div className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-5 space-y-4 shadow-xl font-mono text-xs">
            <div className="flex items-center justify-between border-b border-[#1e2433] pb-3">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <span className="material-symbols-outlined text-indigo-400 text-base">store</span>
                  Desempenho por PDV / Loja ({lojasPerformance.length})
                </h3>
                <p className="text-[10px] text-slate-400 mt-0.5">Clique em qualquer loja para abrir o histórico operacional detalhado.</p>
              </div>
              <span className="text-[10px] text-slate-500 hidden sm:inline">Ordenado por atrasos e menor aderência</span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[#1e2433]">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-[#10141f] text-slate-400 text-[10px] uppercase border-b border-[#1e2433]">
                    <th className="py-2.5 px-3">PDV / Loja</th>
                    <th className="py-2.5 px-3 text-center">Planejadas</th>
                    <th className="py-2.5 px-3 text-center">Realizadas</th>
                    <th className="py-2.5 px-3 text-center">Pendentes</th>
                    <th className="py-2.5 px-3 text-center">Atrasadas</th>
                    <th className="py-2.5 px-3 text-center">Aderência</th>
                    <th className="py-2.5 px-3 text-center">Ocorrências</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e2433] text-slate-300">
                  {lojasPerformance.map((loja) => (
                    <tr
                      key={loja.codigo}
                      onClick={() => handleOpenStoreHistory(loja.codigo)}
                      className="hover:bg-[#10141f]/70 cursor-pointer transition-colors"
                    >
                      <td className="py-2.5 px-3">
                        <strong className="text-white block">{loja.nome}</strong>
                        <span className="text-[10px] text-slate-400">{loja.cidade} - {loja.uf} ({loja.codigo})</span>
                      </td>
                      <td className="py-2.5 px-3 text-center text-cyan-300 font-bold">{loja.planejadas}</td>
                      <td className="py-2.5 px-3 text-center text-emerald-400 font-bold">{loja.concluidas}</td>
                      <td className="py-2.5 px-3 text-center text-amber-400 font-bold">{loja.pendentes}</td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${loja.atrasadas > 0 ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' : 'text-slate-500'}`}>
                          {loja.atrasadas}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          loja.aderencia >= 80 ? 'bg-emerald-500/20 text-emerald-300' : loja.aderencia >= 50 ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300'
                        }`}>
                          {loja.aderencia}%
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center text-slate-400">{loja.ocorrencias}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 6. TABELA DE DESEMPENHO POR PROMOTOR */}
          <div className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-5 space-y-4 shadow-xl font-mono text-xs">
            <div className="flex items-center justify-between border-b border-[#1e2433] pb-3">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <span className="material-symbols-outlined text-purple-400 text-base">badge</span>
                  Desempenho por Promotor ({promotoresPerformance.length})
                </h3>
                <p className="text-[10px] text-slate-400 mt-0.5">Produtividade e aderência da equipe no período.</p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[#1e2433]">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-[#10141f] text-slate-400 text-[10px] uppercase border-b border-[#1e2433]">
                    <th className="py-2.5 px-3">Promotor</th>
                    <th className="py-2.5 px-3 text-center">Planejadas</th>
                    <th className="py-2.5 px-3 text-center">Realizadas</th>
                    <th className="py-2.5 px-3 text-center">Pendentes</th>
                    <th className="py-2.5 px-3 text-center">Atrasadas</th>
                    <th className="py-2.5 px-3 text-center">Aderência</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e2433] text-slate-300">
                  {promotoresPerformance.map((prom) => (
                    <tr key={prom.matricula} className="hover:bg-[#10141f]/70 transition-colors">
                      <td className="py-2.5 px-3">
                        <strong className="text-white block">{prom.nome}</strong>
                        <span className="text-[10px] text-slate-400">Matrícula: {prom.matricula}</span>
                      </td>
                      <td className="py-2.5 px-3 text-center text-cyan-300 font-bold">{prom.planejadas}</td>
                      <td className="py-2.5 px-3 text-center text-emerald-400 font-bold">{prom.concluidas}</td>
                      <td className="py-2.5 px-3 text-center text-amber-400 font-bold">{prom.pendentes}</td>
                      <td className="py-2.5 px-3 text-center font-bold text-rose-400">{prom.atrasadas}</td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          prom.aderencia >= 80 ? 'bg-emerald-500/20 text-emerald-300' : prom.aderencia >= 50 ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300'
                        }`}>
                          {prom.aderencia}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* RODAPÉ DO RELATÓRIO IMPRESSO */}
          <div className="hidden print:flex items-center justify-between border-t border-slate-300 pt-3 text-[10px] text-slate-500 font-mono mt-6">
            <span>MK9 Trade Marketing • Relatório Executivo Operacional</span>
            <span>Parceiro: {activeIndName}</span>
            <span>Página Gerada em {new Date().toLocaleDateString('pt-BR')}</span>
          </div>
        </section>
      )}

      {/* MODAL DE FOTO AMPLIADA DA CENTRAL DE EVIDÊNCIAS */}
      {zoomedEvidencia && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 font-mono">
          <div className="bg-[#171b26] border border-indigo-500/40 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl space-y-4 p-5">
            <div className="flex items-center justify-between border-b border-[#1e2433] pb-3">
              <div>
                <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 text-[10px] font-bold border border-cyan-500/30 uppercase">
                  {zoomedEvidencia.tipo_foto}
                </span>
                <h3 className="text-sm font-bold text-white mt-1">
                  {zoomedEvidencia.visit?.loja?.nome || 'PDV'}
                </h3>
              </div>
              <button
                onClick={() => setZoomedEvidencia(null)}
                className="p-1.5 rounded-xl bg-[#10141f] text-slate-400 hover:text-white cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* FOTO GRANDE */}
            <div className="relative aspect-video rounded-xl bg-[#10141f] overflow-hidden border border-[#1e2433] flex items-center justify-center">
              {evidenciasSignedUrls[zoomedEvidencia.storage_path] ? (
                <img
                  src={evidenciasSignedUrls[zoomedEvidencia.storage_path]}
                  alt={zoomedEvidencia.legenda || zoomedEvidencia.tipo_foto}
                  className="w-full h-full object-contain"
                />
              ) : (
                <span className="material-symbols-outlined text-slate-600 text-4xl">image</span>
              )}
            </div>

            {/* DADOS DA FOTO E BOTÃO DE ATENDIMENTO COMPLETO */}
            <div className="text-xs space-y-2 bg-[#10141f] p-3 rounded-xl border border-[#1e2433]">
              <p className="text-slate-300">
                Data do Atendimento: <strong className="text-white">{zoomedEvidencia.visit?.data_visita}</strong>
              </p>
              <p className="text-slate-300">
                Promotor: <strong className="text-cyan-300">{zoomedEvidencia.visit?.promotor?.nome || zoomedEvidencia.visit?.promotor_matricula}</strong>
              </p>
              {zoomedEvidencia.legenda && (
                <p className="text-slate-400 italic">
                  Legenda: "{zoomedEvidencia.legenda}"
                </p>
              )}
            </div>

            <div className="pt-2 flex justify-between items-center border-t border-[#1e2433]">
              <button
                onClick={() => handleOpenFullReportFromEvidencia(zoomedEvidencia)}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">fact_check</span>
                <span>Ver Atendimento Completo</span>
              </button>

              <button
                onClick={() => setZoomedEvidencia(null)}
                className="px-4 py-2 rounded-xl bg-[#10141f] hover:bg-[#1e2433] text-slate-300 font-bold text-xs cursor-pointer"
              >
                Fechar Zoom
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ESTADO DE ERRO */}
      {error && (
        <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-500/50 text-rose-300 font-mono text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-xl text-rose-400">error</span>
            <span>Não foi possível carregar os dados. Tente novamente. ({error})</span>
          </div>
          <button onClick={fetchIndustryData} className="underline font-bold hover:text-white">
            Tentar novamente
          </button>
        </div>
      )}

      {/* 4. CARDS DE KPIS PRINCIPAIS DA INDÚSTRIA */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 font-mono text-xs">
        <div className="p-4 rounded-2xl bg-[#171b26] border border-[#1e2433]">
          <span className="text-[10px] text-slate-400 block font-bold uppercase">PDVs CONTRATADOS</span>
          <span className="text-2xl font-extrabold text-white mt-1 block">{loading ? '...' : kpis.lojas}</span>
          <span className="text-[10px] text-slate-500 block mt-0.5">{loading ? '...' : `${kpis.lojasComVisita} com visita realizada`}</span>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-purple-500/30 bg-purple-950/10">
          <span className="text-[10px] text-purple-400 block font-bold uppercase">VISITAS PLANEJADAS</span>
          <span className="text-2xl font-extrabold text-purple-300 mt-1 block">{loading ? '...' : kpis.planejadas}</span>
          <span className="text-[10px] text-purple-400/70 block mt-0.5">Ocorrências Rota</span>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-emerald-500/30 bg-emerald-950/10">
          <span className="text-[10px] text-emerald-400 block font-bold uppercase">VISITAS CONCLUÍDAS</span>
          <span className="text-2xl font-extrabold text-emerald-300 mt-1 block">{loading ? '...' : kpis.concluidas}</span>
          <span className="text-[10px] text-emerald-400/70 block mt-0.5">Check-outs Ok</span>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-rose-500/30 bg-rose-950/10">
          <span className="text-[10px] text-rose-400 block font-bold uppercase">VISITAS PENDENTES</span>
          <span className="text-2xl font-extrabold text-rose-300 mt-1 block">{loading ? '...' : kpis.pendentes}</span>
          <span className="text-[10px] text-rose-400/70 block mt-0.5 truncate">{loading ? '...' : `${kpis.atrasadas} atrasadas • ${kpis.pendentesHoje} para hoje`}</span>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-orange-500/30 bg-orange-950/10">
          <span className="text-[10px] text-orange-400 block font-bold uppercase">NÃO REALIZADAS</span>
          <span className="text-2xl font-extrabold text-orange-300 mt-1 block">{loading ? '...' : kpis.naoRealizadas}</span>
          <span className="text-[10px] text-orange-400/70 block mt-0.5">Com Motivo</span>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-indigo-500/40 bg-indigo-950/20">
          <span className="text-[10px] text-indigo-300 block font-bold uppercase">ADERÊNCIA</span>
          <span className="text-2xl font-extrabold text-indigo-200 mt-1 block">{loading ? '...' : `${kpis.aderencia}%`}</span>
          <span className="text-[10px] text-indigo-400/70 block mt-0.5">Taxa de Execução</span>
        </div>
      </div>

      {/* 8. SEÇÃO DESTACADA: PENDÊNCIAS DE ATENDIMENTO DA INDÚSTRIA */}
      <section className="bg-[#171b26] border border-rose-500/40 rounded-2xl p-5 shadow-2xl space-y-4 font-mono">
        <div className="flex items-center justify-between border-b border-[#1e2433] pb-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-rose-400 text-xl animate-pulse">warning</span>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Pendências de Atendimento ({pendenciasList.length})
            </h2>
          </div>
          <span className="text-[11px] text-rose-400 font-bold bg-rose-500/10 px-2.5 py-1 rounded-lg border border-rose-500/30">
            Requer Regularização em Campo
          </span>
        </div>

        {pendenciasList.length === 0 ? (
          <div className="py-8 text-center space-y-1 bg-[#10141f]/50 rounded-xl border border-[#1e2433]">
            <span className="material-symbols-outlined text-emerald-400 text-3xl">check_circle</span>
            <p className="text-xs text-slate-300 font-bold">Nenhuma pendência encontrada para o período selecionado.</p>
            <p className="text-[11px] text-slate-500">Todos os atendimentos das suas lojas foram executados no prazo.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#1e2433]">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-[#10141f] border-b border-[#1e2433] text-slate-400 text-[10px] uppercase">
                  <th className="py-2.5 px-3">Data Prevista</th>
                  <th className="py-2.5 px-3">Loja / PDV</th>
                  <th className="py-2.5 px-3">Promotor</th>
                  <th className="py-2.5 px-3">Frequência</th>
                  <th className="py-2.5 px-3">Situação</th>
                  <th className="py-2.5 px-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e2433] text-slate-300">
                {pendenciasList.map((item) => (
                  <tr key={item.key} className="hover:bg-[#10141f]/80 transition-colors">
                    <td className="py-2.5 px-3">
                      <div className="font-bold text-white">{item.dataStr}</div>
                      <div className="text-[10px] text-slate-500">{item.dayOfWeekLabel}</div>
                    </td>
                    <td className="py-2.5 px-3 font-bold text-white">
                      {item.lojaNome}
                      {item.lojaCidade && <span className="text-[10px] text-slate-400 block font-normal">{item.lojaCidade} - {item.lojaUf}</span>}
                    </td>
                    <td className="py-2.5 px-3 font-bold text-cyan-400">{item.promotorNome}</td>
                    <td className="py-2.5 px-3 text-slate-400">{item.frequencia}</td>
                    <td className="py-2.5 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        item.isPastOverdue
                          ? 'bg-rose-950 text-rose-300 border-rose-500 animate-pulse'
                          : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                      }`}>
                        {item.isPastOverdue ? '🚨 ATRASADA' : '🔴 PENDENTE'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => handleOpenVisitDetails(item)}
                        className="px-3 py-1 rounded-lg bg-[#10141f] hover:bg-[#1e2433] text-indigo-300 border border-indigo-500/30 text-[11px] font-bold transition-all cursor-pointer"
                      >
                        Ver Detalhes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 7. CENTRAL DE ACOMPANHAMENTO: STATUS DAS LOJAS DA INDÚSTRIA */}
      <section className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-5 shadow-2xl space-y-4 font-mono">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#1e2433] pb-3">
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span className="material-symbols-outlined text-indigo-400 text-xl">store</span>
              Status de Atendimento das Lojas ({allOperationalVisits.length})
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Listagem operacional em tempo real de todas as lojas contratadas no período.
            </p>
          </div>
          <span className="text-[11px] text-slate-400">
            Exibindo <strong>{allOperationalVisits.length}</strong> loja(s)
          </span>
        </div>

        {loading ? (
          <div className="py-12 text-center space-y-3">
            <span className="material-symbols-outlined text-indigo-400 text-3xl animate-spin">sync</span>
            <p className="text-xs text-slate-400">Carregando operação da indústria...</p>
          </div>
        ) : allOperationalVisits.length === 0 ? (
          <div className="py-12 text-center space-y-2 bg-[#10141f]/50 rounded-xl border border-[#1e2433]">
            <span className="material-symbols-outlined text-slate-600 text-3xl">event_busy</span>
            <p className="text-xs text-slate-300 font-bold">Nenhuma operação encontrada para o período.</p>
          </div>
        ) : (
          <>
            {/* TABELA DESKTOP */}
            <div className="hidden md:block overflow-x-auto rounded-xl border border-[#1e2433]">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#10141f] border-b border-[#1e2433] text-slate-400 text-[10px] uppercase">
                    <th className="py-3 px-4">Loja / PDV</th>
                    <th className="py-3 px-4">Cidade/UF</th>
                    <th className="py-3 px-4">Frequência</th>
                    <th className="py-3 px-4">Promotor</th>
                    <th className="py-3 px-4">Data Prevista</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Detalhes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e2433] text-slate-300">
                  {allOperationalVisits.map((item) => {
                    let badge = { label: '🔴 PENDENTE', style: 'bg-rose-500/10 text-rose-400 border-rose-500/30' };
                    if (item.isPastOverdue) {
                      badge = { label: '🚨 ATRASADA', style: 'bg-rose-950 text-rose-300 border-rose-500 animate-pulse font-bold' };
                    } else if (item.status === 'em_andamento') {
                      badge = { label: '🔵 EM ANDAMENTO', style: 'bg-blue-500/10 text-blue-400 border-blue-500/30' };
                    } else if (item.status === 'nao_realizada') {
                      badge = { label: '🟠 NÃO REALIZADA', style: 'bg-orange-500/10 text-orange-400 border-orange-500/30' };
                    } else if (item.status === 'concluida') {
                      badge = { label: '🟢 CONCLUÍDA', style: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' };
                    } else if (item.status === 'planejada') {
                      badge = { label: '⚪ PLANEJADA', style: 'bg-slate-800 text-slate-300 border-slate-700' };
                    }

                    return (
                      <tr key={item.key} className="hover:bg-[#10141f]/80 transition-colors">
                        <td className="py-3 px-4 font-bold text-white">
                          <button
                            onClick={() => handleOpenStoreHistory(item.lojaCodigo)}
                            className="text-left font-bold text-white hover:text-indigo-400 underline decoration-indigo-500/40 cursor-pointer transition-colors flex items-center gap-1.5"
                          >
                            <span className="material-symbols-outlined text-xs text-indigo-400">history</span>
                            <span>{item.lojaNome}</span>
                          </button>
                        </td>
                        <td className="py-3 px-4 text-slate-400">{item.lojaCidade || '—'}/{item.lojaUf || '-'}</td>
                        <td className="py-3 px-4 text-slate-400">{item.frequencia}</td>
                        <td className="py-3 px-4 font-bold text-cyan-400">{item.promotorNome}</td>
                        <td className="py-3 px-4">
                          <div className="font-bold text-white">{item.dataStr}</div>
                          <div className="text-[10px] text-slate-500">{item.dayOfWeekLabel}</div>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] border ${badge.style}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleOpenStoreHistory(item.lojaCodigo)}
                            className="px-2.5 py-1.5 rounded-lg bg-[#10141f] hover:bg-indigo-950/40 text-indigo-300 border border-indigo-500/30 text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                            title="Ver Histórico Completo da Loja"
                          >
                            <span className="material-symbols-outlined text-sm">history</span>
                            <span>Histórico</span>
                          </button>
                          <button
                            onClick={() => handleOpenVisitDetails(item)}
                            className="px-2.5 py-1.5 rounded-lg bg-[#10141f] hover:bg-[#1e2433] text-slate-300 border border-[#1e2433] text-xs font-bold transition-all cursor-pointer"
                          >
                            Relatório
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* CARDS MOBILE (390px / 768px) */}
            <div className="md:hidden space-y-3">
              {allOperationalVisits.map((item) => (
                <div key={item.key} className="p-4 rounded-xl bg-[#10141f] border border-[#1e2433] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400">{item.dataStr} • {item.dayOfWeekLabel}</span>
                    <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${
                      item.status === 'concluida' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
                      item.status === 'em_andamento' ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' :
                      item.status === 'nao_realizada' ? 'bg-orange-500/20 text-orange-300 border-orange-500/30' :
                      item.isPastOverdue ? 'bg-rose-950 text-rose-300 border-rose-500 animate-pulse' :
                      'bg-rose-500/20 text-rose-300 border-rose-500/30'
                    }`}>
                      {item.status.toUpperCase()}
                    </span>
                  </div>

                  <h3
                    onClick={() => handleOpenStoreHistory(item.lojaCodigo)}
                    className="text-sm font-bold text-white hover:text-indigo-400 cursor-pointer flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-xs text-indigo-400">history</span>
                    <span>{item.lojaNome}</span>
                  </h3>
                  <p className="text-xs text-slate-400">Cidade: {item.lojaCidade}/{item.lojaUf} • Promotor: <strong className="text-cyan-300">{item.promotorNome}</strong></p>

                  <div className="pt-2 border-t border-[#1e2433] flex justify-end gap-2">
                    <button
                      onClick={() => handleOpenStoreHistory(item.lojaCodigo)}
                      className="px-3 py-1.5 rounded-lg bg-[#171b26] text-indigo-300 border border-indigo-500/30 text-xs font-bold flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-sm">history</span>
                      <span>Histórico Loja</span>
                    </button>
                    <button
                      onClick={() => handleOpenVisitDetails(item)}
                      className="px-3 py-1.5 rounded-lg bg-[#171b26] text-slate-300 border border-[#1e2433] text-xs font-bold"
                    >
                      Relatório
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* 9. MODAL / DRAWER DE DETALHES DA VISITA (SOMENTE LEITURA) */}
      {selectedVisitItem && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto font-mono">
          <div className="bg-[#171b26] border border-indigo-500/40 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-6">
            {/* CABEÇALHO DO MODAL */}
            <div className="flex items-center justify-between border-b border-[#1e2433] pb-4">
              <div>
                <h3 className="text-lg font-extrabold text-white">
                  Relatório da Visita — {selectedVisitItem.lojaNome}
                </h3>
                <p className="text-xs text-slate-400">
                  Data Prevista: {selectedVisitItem.dataStr} • Promotor: {selectedVisitItem.promotorNome}
                </p>
              </div>

              <button
                onClick={() => setSelectedVisitItem(null)}
                className="p-1.5 rounded-xl bg-[#10141f] border border-[#1e2433] text-slate-400 hover:text-white cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* DADOS GERAIS DO ATENDIMENTO */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-[#10141f] border border-[#1e2433]">
                <span className="text-slate-500 block">SITUAÇÃO</span>
                <span className="font-extrabold text-white uppercase">{selectedVisitItem.status}</span>
              </div>

              <div className="p-3 rounded-xl bg-[#10141f] border border-[#1e2433]">
                <span className="text-slate-500 block">CHECK-IN</span>
                <span className="font-extrabold text-white">
                  {selectedVisitItem.startedAt ? new Date(selectedVisitItem.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-[#10141f] border border-[#1e2433]">
                <span className="text-slate-500 block">CHECK-OUT</span>
                <span className="font-extrabold text-white">
                  {selectedVisitItem.completedAt ? new Date(selectedVisitItem.completedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-[#10141f] border border-[#1e2433]">
                <span className="text-slate-500 block">DURAÇÃO</span>
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
              <div className="p-4 rounded-xl bg-[#10141f] border border-[#1e2433] text-xs space-y-1">
                <span className="text-slate-400 font-bold block uppercase">OBSERVAÇÃO GERAL DO PROMOTOR:</span>
                <p className="text-slate-200">{selectedVisitItem.visitObj.observacao_geral}</p>
              </div>
            )}

            {/* 11. CHECKLIST OPERACIONAL */}
            <div className="space-y-3 pt-2 border-t border-[#1e2433]">
              <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400 text-base">fact_check</span>
                Checklist Operacional Registrado
              </h4>

              {selectedVisitItem.visitObj?.checklist_items && selectedVisitItem.visitObj.checklist_items.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {selectedVisitItem.visitObj.checklist_items.map((item, idx) => (
                    <div key={idx} className="p-2.5 rounded-xl bg-[#10141f] border border-[#1e2433] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`material-symbols-outlined text-base ${item.checked ? 'text-emerald-400' : 'text-slate-600'}`}>
                          {item.checked ? 'check_circle' : 'cancel'}
                        </span>
                        <span className="text-slate-200 font-bold">{item.item_label}</span>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${item.checked ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                        {item.checked ? 'Sim' : 'Não'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-slate-500 italic">Nenhum item de checklist registrado nesta visita.</p>
              )}
            </div>

            {/* 10. EVIDÊNCIAS FOTOGRÁFICAS DA VISITA (STORAGE PRIVADO) */}
            <div className="space-y-3 pt-2 border-t border-[#1e2433]">
              <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-cyan-400 text-base">photo_camera</span>
                Evidências Fotográficas do Ponto de Venda
              </h4>

              {loadingPhotos ? (
                <div className="py-4 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                  <span className="material-symbols-outlined text-cyan-400 animate-spin">sync</span>
                  <span>Gerando Signed URLs seguras para fotos...</span>
                </div>
              ) : selectedVisitItem.visitObj?.photos && selectedVisitItem.visitObj.photos.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {selectedVisitItem.visitObj.photos.map((p, idx) => {
                    const signedUrl = signedPhotoUrls[p.storage_path];

                    return (
                      <div key={idx} className="p-2 rounded-xl bg-[#10141f] border border-[#1e2433] space-y-1.5 flex flex-col justify-between">
                        <div className="relative aspect-video rounded-lg bg-[#171b26] overflow-hidden border border-[#1e2433] flex items-center justify-center">
                          {signedUrl ? (
                            <img src={signedUrl} alt={p.legenda || p.tipo_foto} className="w-full h-full object-cover" />
                          ) : (
                            <span className="material-symbols-outlined text-slate-600 text-2xl">image</span>
                          )}
                          <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-sm text-cyan-300 text-[9px] font-bold uppercase border border-cyan-500/30">
                            {p.tipo_foto}
                          </span>
                        </div>
                        {p.legenda && <p className="text-[10px] text-slate-300 truncate" title={p.legenda}>{p.legenda}</p>}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] text-slate-500 italic">Nenhuma foto registrada nesta visita.</p>
              )}
            </div>

            {/* 12. OCORRÊNCIAS E RUPTURAS */}
            <div className="space-y-3 pt-2 border-t border-[#1e2433]">
              <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-rose-400 text-base">report</span>
                Ocorrências & Rupturas Registradas
              </h4>

              {selectedVisitItem.visitObj?.occurrences && selectedVisitItem.visitObj.occurrences.length > 0 ? (
                <div className="space-y-2 text-xs">
                  {selectedVisitItem.visitObj.occurrences.map((occ, idx) => (
                    <div key={idx} className="p-3 rounded-xl bg-[#10141f] border border-[#1e2433] flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-bold uppercase border border-rose-500/30">
                            {occ.tipo}
                          </span>
                          <span className="text-slate-400 text-[10px]">
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
                <p className="text-[11px] text-slate-500 italic">Nenhuma ocorrência ou ruptura identificada nesta visita.</p>
              )}
            </div>

            {/* 13. CONTROLE DE VALIDADE DE PRODUTOS */}
            <div className="space-y-3 pt-2 border-t border-[#1e2433]">
              <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400 text-base">event</span>
                Controle de Validade de Produtos (FIFO)
              </h4>

              {selectedVisitItem.visitObj?.validity_items && selectedVisitItem.visitObj.validity_items.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-[#1e2433]">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-[#10141f] text-slate-400 text-[10px] uppercase border-b border-[#1e2433]">
                        <th className="py-2 px-3">Produto</th>
                        <th className="py-2 px-3 text-right">Qtd.</th>
                        <th className="py-2 px-3">Vencimento</th>
                        <th className="py-2 px-3">Lote</th>
                        <th className="py-2 px-3 text-right">Situação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e2433] text-slate-300">
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
                          <tr key={idx} className="hover:bg-[#10141f]/50">
                            <td className="py-2 px-3 font-bold text-white">{val.produto_nome}</td>
                            <td className="py-2 px-3 text-right font-bold text-amber-300">{val.quantidade}</td>
                            <td className="py-2 px-3">{vencDate.toLocaleDateString('pt-BR')}</td>
                            <td className="py-2 px-3 text-slate-400">{val.lote || '—'}</td>
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
                <p className="text-[11px] text-slate-500 italic">Nenhum produto cadastrado para controle de validade nesta visita.</p>
              )}
            </div>

            {/* RODAPÉ DO MODAL */}
            <div className="pt-3 border-t border-[#1e2433] flex justify-end">
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
          <div className="bg-[#171b26] border border-indigo-500/40 rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto shadow-2xl p-5 sm:p-6 space-y-6">
            {/* CABEÇALHO DA LOJA */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-[#1e2433] pb-4 gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center justify-center font-bold text-xl shrink-0">
                  <span className="material-symbols-outlined text-2xl">storefront</span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base sm:text-lg font-extrabold text-white">
                      {selectedStoreObj.nome}
                    </h3>
                    <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-bold border border-indigo-500/30 uppercase">
                      {selectedStoreObj.codigo}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
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
                  className="p-2 rounded-xl bg-[#10141f] border border-[#1e2433] text-slate-400 hover:text-white cursor-pointer transition-colors"
                >
                  <span className="material-symbols-outlined text-xl">close</span>
                </button>
              </div>
            </div>

            {/* SELETOR DE PERÍODO E KPIS RESUMO DA LOJA */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-indigo-400 text-sm">analytics</span>
                  Resumo Operacional do Período
                </span>

                {/* FILTROS DE PERÍODO DA LOJA */}
                <div className="flex items-center gap-1 bg-[#10141f] p-1 rounded-xl border border-[#1e2433] self-start sm:self-auto">
                  {(['7', '30', '90', 'all'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => handleHistoryPeriodChange(p)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                        historyPeriodFilter === p
                          ? 'bg-indigo-600 text-white shadow-md'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {p === 'all' ? 'Todos' : `${p} dias`}
                    </button>
                  ))}
                </div>
              </div>

              {/* CARDS KPIS RESUMO DA LOJA */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                <div className="p-3 rounded-xl bg-[#10141f] border border-[#1e2433]">
                  <span className="text-[10px] text-purple-400 block font-bold uppercase">PLANEJADOS</span>
                  <span className="text-xl font-extrabold text-purple-300 mt-0.5 block">{loadingHistory ? '...' : storeHistoryKPIs.planejadas}</span>
                </div>

                <div className="p-3 rounded-xl bg-[#10141f] border border-emerald-500/30 bg-emerald-950/10">
                  <span className="text-[10px] text-emerald-400 block font-bold uppercase">CONCLUÍDOS</span>
                  <span className="text-xl font-extrabold text-emerald-300 mt-0.5 block">{loadingHistory ? '...' : storeHistoryKPIs.concluidas}</span>
                </div>

                <div className="p-3 rounded-xl bg-[#10141f] border border-rose-500/30 bg-rose-950/10">
                  <span className="text-[10px] text-rose-400 block font-bold uppercase">PENDENTES</span>
                  <span className="text-xl font-extrabold text-rose-300 mt-0.5 block">{loadingHistory ? '...' : storeHistoryKPIs.pendentes}</span>
                </div>

                <div className="p-3 rounded-xl bg-[#10141f] border border-orange-500/30 bg-orange-950/10">
                  <span className="text-[10px] text-orange-400 block font-bold uppercase">NÃO REALIZADOS</span>
                  <span className="text-xl font-extrabold text-orange-300 mt-0.5 block">{loadingHistory ? '...' : storeHistoryKPIs.naoRealizadas}</span>
                </div>

                <div className="p-3 rounded-xl bg-[#10141f] border border-indigo-500/30 bg-indigo-950/10 col-span-2 sm:col-span-1">
                  <span className="text-[10px] text-indigo-300 block font-bold uppercase">ADERÊNCIA</span>
                  <span className="text-xl font-extrabold text-indigo-200 mt-0.5 block">{loadingHistory ? '...' : `${storeHistoryKPIs.aderencia}%`}</span>
                </div>
              </div>
            </div>

            {/* TIMELINE / LISTA DE HISTÓRICO DE ATENDIMENTOS */}
            <div className="space-y-3 pt-2 border-t border-[#1e2433]">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-indigo-400 text-base">history_edu</span>
                Linha do Tempo de Atendimentos ({storeHistoryOperationalItems.length})
              </h4>

              {loadingHistory ? (
                <div className="py-10 text-center space-y-2">
                  <span className="material-symbols-outlined text-indigo-400 text-2xl animate-spin">sync</span>
                  <p className="text-xs text-slate-400">Carregando histórico da loja...</p>
                </div>
              ) : storeHistoryOperationalItems.length === 0 ? (
                <div className="py-8 text-center bg-[#10141f]/50 rounded-xl border border-[#1e2433] space-y-1">
                  <span className="material-symbols-outlined text-slate-600 text-2xl">event_busy</span>
                  <p className="text-xs text-slate-300 font-bold">Nenhum atendimento registrado no período.</p>
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
                            ? 'bg-[#10141f] border-emerald-500/30 hover:border-emerald-500/60'
                            : isEmAndamento
                            ? 'bg-[#10141f] border-blue-500/30 hover:border-blue-500/60'
                            : isNaoRealizada
                            ? 'bg-[#10141f] border-orange-500/30 hover:border-orange-500/60'
                            : isAtrasada
                            ? 'bg-rose-950/20 border-rose-500/40 hover:border-rose-500/70'
                            : 'bg-[#10141f] border-[#1e2433]'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[#1e2433]">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-white text-sm">{item.dataStr}</span>
                            <span className="text-slate-500 text-xs">• {item.dayOfWeekLabel}</span>
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
                            <span className="text-slate-500 block text-[10px]">PROMOTOR RESPONSÁVEL</span>
                            <span className="font-bold text-cyan-300">{item.promotorNome}</span>
                          </div>

                          <div>
                            <span className="text-slate-500 block text-[10px]">HORÁRIO / DURAÇÃO</span>
                            <span className="text-slate-200">
                              {item.startedAt ? new Date(item.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                              {' → '}
                              {item.completedAt ? new Date(item.completedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                              {item.duracaoFormatada && <strong className="text-amber-300 ml-1">({item.duracaoFormatada})</strong>}
                            </span>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-[#1e2433]">
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
                              <span className="text-[10px] text-slate-500 italic">
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
            <div className="pt-3 border-t border-[#1e2433] flex justify-end">
              <button
                onClick={() => setSelectedStoreCode(null)}
                className="px-5 py-2 rounded-xl bg-[#10141f] hover:bg-[#1e2433] text-slate-300 border border-[#1e2433] font-bold text-xs cursor-pointer transition-all"
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

