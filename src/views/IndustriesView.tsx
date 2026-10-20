import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import type { IndustryItem, StoreItem, RouteItem, Visit, ToastMessage, ContratoLoja, PeriodoContratual, CreateContratoLojaDTO } from '../types';
import { getMonthlyQuinzenalDates } from '../utils/routePlanner';
import { isValidWhatsAppGroupLink, sanitizeWhatsAppGroupLink, openIndustryWhatsAppGroup } from '../utils/whatsappShare';
import { analyzeRotasForContracts, contratosService, parseISODate, classificarParContratual } from '../lib/contratosService';
import { StatCard, StatusBadge, DataTable, Column } from '../components/ui';

interface IndustriesViewProps {
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export interface ContratoItemElegivel {
  industria_codigo: string;
  loja_codigo: string;
  frequencia: 'SEMANAL' | 'QUINZENAL' | 'MENSAL';
  visitas_por_semana: number | null;
  segunda: boolean;
  terca: boolean;
  quarta: boolean;
  quinta: boolean;
  sexta: boolean;
  sabado: boolean;
  domingo: boolean;
  totalRotasVinculadas: number;
  promotoresEnvolvidos: string[];
  projecao_periodo?: PeriodoContratual;
  industriaNome: string;
  lojaInfo: { nome: string; cidade?: string; uf?: string };
  dataCadastro: string | null;
  cadastroAusente: boolean;
  classificacao: 'ERRO_CONSULTA' | 'JA_POSSUI_ATIVO' | 'JA_POSSUI_SUSPENSO' | 'INICIO_NAO_INFORMADO' | 'ELEGIVEL';
  motivoClassificacao: string;
  contratoAtivoExistente: ContratoLoja | null;
  contratoSuspensoExistente: ContratoLoja | null;
  totalContratosHistoricos: number;
}

// Normalização de texto para busca amigável (sem acentos e case-insensitive)
export function normalizeText(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// Formatação amigável de percentual de aderência (Onda 3.2: precisão decimal para percentuais pequenos e tratamento seguro de divisão por zero)
export function formatAderencia(realizadas: number, planejadas: number): string {
  if (!planejadas || planejadas <= 0) {
    return '—';
  }
  if (!realizadas || realizadas <= 0) {
    return '0%';
  }
  const pct = (realizadas / planejadas) * 100;
  if (pct > 0 && pct < 1) {
    // Para percentuais baixos (ex: 6/2148 = 0.279%), exibe uma casa decimal (0,3%) para não mascarar execução real como 0%
    return `${pct.toFixed(1).replace('.', ',')}%`;
  }
  const rounded = Math.round(pct);
  if (Math.abs(pct - rounded) < 0.05) {
    return `${rounded}%`;
  }
  return `${pct.toFixed(1).replace('.', ',')}%`;
}

export const IndustriesView: React.FC<IndustriesViewProps> = ({ onShowToast }) => {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission(['admin', 'gestor']);

  // Aba selecionada ('frequencia' | 'cadastro' | 'contratos')
  const [activeTab, setActiveTab] = useState<'frequencia' | 'cadastro' | 'contratos'>('frequencia');
  const [contratosRefDate, setContratosRefDate] = useState(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });

  const [industries, setIndustries] = useState<IndustryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros e busca
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'ativo' | 'inativo'>('todos');

  // Modais de Criação / Edição / Visualização de Indústria
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<IndustryItem | null>(null);
  const [viewingItem, setViewingItem] = useState<IndustryItem | null>(null);
  const [saving, setSaving] = useState(false);

  // MODAL DE REVISÃO E AUTORIZAÇÃO INDIVIDUAL DE CONTRATO (ETAPA H3.5)
  // Somente protótipo e validação: NENHUM dado é gravado no banco
  const [reviewingContrato, setReviewingContrato] = useState<ContratoItemElegivel | null>(null);
  const [revisaoForm, setRevisaoForm] = useState({
    valor_por_visita: '',
    tipo_vigencia: 'continua' as 'continua' | 'determinada',
    data_fim_vigencia: '',
    observacao: ''
  });
  const [revisaoErrors, setRevisaoErrors] = useState<{ valor?: string; data_fim?: string }>({});
  const [simulatedPayload, setSimulatedPayload] = useState<any | null>(null);
  const [savingContrato, setSavingContrato] = useState(false);

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

  // ESTADOS DE CONTRATOS EXISTENTES (ETAPA H3.3)
  const [contratosList, setContratosList] = useState<ContratoLoja[]>([]);
  const [contratosLoading, setContratosLoading] = useState(false);
  const [contratosError, setContratosError] = useState<string | null>(null);

  // Visualização expandida no detalhamento por loja e por promotor
  const [expandedIndustria, setExpandedIndustria] = useState<string | null>(null);
  const [expandedPromotor, setExpandedPromotor] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'industria' | 'promotor'>('industria');

  // Estados de busca rápida e paginação para Visão por Indústria e Visão por Promotor (Onda 3.2)
  const [searchIndustriaTerm, setSearchIndustriaTerm] = useState('');
  const [industriaPage, setIndustriaPage] = useState(1);
  const [industriaPageSize, setIndustriaPageSize] = useState<10 | 25 | 50>(10);

  const [searchPromotorTerm, setSearchPromotorTerm] = useState('');
  const [promotorPage, setPromotorPage] = useState(1);
  const [promotorPageSize, setPromotorPageSize] = useState<10 | 25 | 50>(10);

  // Resetar expansões e retornar à primeira página ao alterar filtros operacionais ou modo de visualização
  useEffect(() => {
    setExpandedIndustria(null);
    setExpandedPromotor(null);
    setIndustriaPage(1);
    setPromotorPage(1);
  }, [periodFilter, selectedIndustria, selectedLoja, selectedPromotor, viewMode]);

  // Resetar página ao mudar termo de busca
  useEffect(() => {
    setIndustriaPage(1);
  }, [searchIndustriaTerm, industriaPageSize]);

  useEffect(() => {
    setPromotorPage(1);
  }, [searchPromotorTerm, promotorPageSize]);

  // Form State
  const [formData, setFormData] = useState({
    codigo: '',
    nome: '',
    cnpj: '',
    status: 'ativo' as 'ativo' | 'inativo',
    observacao: '',
    data_inicio_operacao: '',
    whatsapp_group_link: ''
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

      const rawRoutes = (rotasRes.data as unknown as RouteItem[]) || [];
      setRoutes(rawRoutes.filter((r) => !r.encerrada_em));
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

  // Busca contratos existentes em public.contratos_lojas (Etapa H3.3)
  const fetchContratos = useCallback(async () => {
    setContratosLoading(true);
    setContratosError(null);

    try {
      const { data, error: err, isMigrationPending } = await contratosService.listContratos();
      if (err) {
        if (isMigrationPending) {
          // Tabela contratos_lojas ainda não criada no banco
          setContratosList([]);
          setContratosError('A tabela de contratos ainda não foi criada no banco (migração pendente).');
        } else {
          setContratosList([]);
          setContratosError(err.message || 'Falha ao consultar contratos existentes.');
        }
      } else {
        setContratosList(data || []);
      }
    } catch (err: any) {
      console.error('Erro ao consultar contratos existentes:', err);
      setContratosList([]);
      setContratosError(err.message || 'Erro inesperado ao consultar contratos.');
    } finally {
      setContratosLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIndustries();
  }, []);

  useEffect(() => {
    if (activeTab === 'frequencia' || activeTab === 'contratos') {
      fetchFrequencyData();
    }
    if (activeTab === 'contratos') {
      fetchContratos();
    }
  }, [activeTab, fetchFrequencyData, fetchContratos]);

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

    // Pré-computar mapa de datas quinzenais para rotas quinzenais
    const quinzenalDatesMap = new Map<string, Set<string>>();
    filteredRoutes.forEach((r) => {
      if ((r.frequencia || '').toUpperCase() === 'QUINZENAL') {
        // Encontrar meses únicos presentes em datesInPeriod
        const monthsSet = new Set<string>();
        datesInPeriod.forEach(({ dateStr }) => {
          monthsSet.add(dateStr.slice(0, 7)); // 'YYYY-MM'
        });

        const scheduledSet = new Set<string>();
        monthsSet.forEach((ym) => {
          const [yStr, mStr] = ym.split('-');
          const y = parseInt(yStr, 10);
          const m = parseInt(mStr, 10);
          const dates = getMonthlyQuinzenalDates(r, y, m);
          dates.forEach((d) => scheduledSet.add(d));
        });

        quinzenalDatesMap.set(r.id, scheduledSet);
      }
    });

    filteredRoutes.forEach((r) => {
      const isQuinzenal = (r.frequencia || '').toUpperCase() === 'QUINZENAL';
      const scheduledSet = isQuinzenal ? quinzenalDatesMap.get(r.id) : null;

      datesInPeriod.forEach(({ dateStr, dayKey }) => {
        let isDayActive = Boolean(r[dayKey as keyof RouteItem]);
        if (isDayActive && isQuinzenal) {
          isDayActive = scheduledSet ? scheduledSet.has(dateStr) : false;
        }

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
      atendimentosDetalhamento: Map<string, {
        lojaCodigo: string;
        lojaNome: string;
        industriaCodigo: string;
        industriaNome: string;
        frequencia: string;
        planejadas: number;
        realizadas: number;
        pendentes: number;
        naoRealizadas: number;
      }>;
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
          naoRealizadas: 0,
          atendimentosDetalhamento: new Map()
        };
        promotorGroupMap.set(p.promotorMatricula, pg);
      }

      pg.planejadas++;
      pg.lojasUnicas.add(p.lojaCodigo);
      pg.industriasUnicas.add(p.industriaCodigo);

      let status = 'pendente';
      const key = `${p.promotorMatricula}|${p.lojaCodigo}|${p.industriaCodigo}|${p.dataStr}`;
      const v = visitsMap.get(key);
      if (v) {
        if (v.status === 'concluida') {
          pg.realizadas++;
          status = 'concluida';
        } else if (v.status === 'nao_realizada') {
          pg.naoRealizadas++;
          status = 'nao_realizada';
        } else {
          pg.pendentes++;
        }
      } else {
        pg.pendentes++;
      }

      const subKey = `${p.lojaCodigo}|${p.industriaCodigo}`;
      let sub = pg.atendimentosDetalhamento.get(subKey);
      if (!sub) {
        const stObj = lojasList.find((st) => st.codigo === p.lojaCodigo);
        const indObj = industries.find((i) => i.codigo === p.industriaCodigo);
        sub = {
          lojaCodigo: p.lojaCodigo,
          lojaNome: stObj?.nome || p.lojaCodigo,
          industriaCodigo: p.industriaCodigo,
          industriaNome: indObj?.nome || p.industriaCodigo,
          frequencia: p.frequencia,
          planejadas: 0,
          realizadas: 0,
          pendentes: 0,
          naoRealizadas: 0
        };
        pg.atendimentosDetalhamento.set(subKey, sub);
      }

      sub.planejadas++;
      if (status === 'concluida') sub.realizadas++;
      else if (status === 'nao_realizada') sub.naoRealizadas++;
      else sub.pendentes++;
    });

    const tabelaPromotores = Array.from(promotorGroupMap.values()).map((pg) => {
      const aderencia = pg.planejadas > 0 ? Math.round((pg.realizadas / pg.planejadas) * 100) : 0;
      const detalhamentoAtendimentos = Array.from(pg.atendimentosDetalhamento.values()).map((d) => ({
        ...d,
        aderencia: d.planejadas > 0 ? Math.round((d.realizadas / d.planejadas) * 100) : 0
      }));

      return {
        matricula: pg.matricula,
        nome: pg.nome,
        qtdLojas: pg.lojasUnicas.size,
        qtdIndustrias: pg.industriasUnicas.size,
        planejadas: pg.planejadas,
        realizadas: pg.realizadas,
        pendentes: pg.pendentes,
        naoRealizadas: pg.naoRealizadas,
        aderencia,
        detalhamentoAtendimentos
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

  // Onda 3.2: Filtragem por busca e paginação para Visão por Indústria (Aba 1)
  const { filteredIndustriasList, paginatedIndustrias, totalIndustriasPages } = useMemo(() => {
    const term = normalizeText(searchIndustriaTerm);
    const filtered = processedData.tabelaIndustrias.filter((ind) => {
      if (!term) return true;
      const nomeNorm = normalizeText(ind.nome);
      const codigoNorm = normalizeText(ind.codigo);
      return nomeNorm.includes(term) || codigoNorm.includes(term);
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / industriaPageSize));
    const currentPage = Math.min(industriaPage, totalPages);
    const startIndex = (currentPage - 1) * industriaPageSize;
    const paginated = filtered.slice(startIndex, startIndex + industriaPageSize);

    return {
      filteredIndustriasList: filtered,
      paginatedIndustrias: paginated,
      totalIndustriasPages: totalPages
    };
  }, [processedData.tabelaIndustrias, searchIndustriaTerm, industriaPage, industriaPageSize]);

  // Onda 3.2: Filtragem por busca e paginação para Visão por Promotor (Aba 1)
  const { filteredPromotoresList, paginatedPromotores, totalPromotoresPages } = useMemo(() => {
    const term = normalizeText(searchPromotorTerm);
    const filtered = processedData.tabelaPromotores.filter((prm) => {
      if (!term) return true;
      const nomeNorm = normalizeText(prm.nome);
      const matNorm = normalizeText(prm.matricula);
      return nomeNorm.includes(term) || matNorm.includes(term);
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / promotorPageSize));
    const currentPage = Math.min(promotorPage, totalPages);
    const startIndex = (currentPage - 1) * promotorPageSize;
    const paginated = filtered.slice(startIndex, startIndex + promotorPageSize);

    return {
      filteredPromotoresList: filtered,
      paginatedPromotores: paginated,
      totalPromotoresPages: totalPages
    };
  }, [processedData.tabelaPromotores, searchPromotorTerm, promotorPage, promotorPageSize]);

  // -------------------------------------------------------------
  // -------------------------------------------------------------
  // ETAPA E: PRÉ-VISUALIZAÇÃO ADMINISTRATIVA DE CONTRATOS E CICLOS (SOMENTE LEITURA)
  // -------------------------------------------------------------
  const contratosPreviewData = useMemo(() => {
    // Monta mapa de início de operação formal (public.industrias.data_inicio_operacao)
    // Regra de Negócio: Não utilizar created_at ou CURRENT_DATE como substitutos silenciosos.
    const dataInicioOperacaoMap: Record<string, string> = {};
    const industriasMap = new Map<string, string>();
    industries.forEach((ind) => {
      industriasMap.set(ind.codigo, ind.nome);
      if (ind.data_inicio_operacao) {
        dataInicioOperacaoMap[ind.codigo] = ind.data_inicio_operacao.slice(0, 10);
      }
    });

    const lojasMap = new Map<string, { nome: string; cidade?: string; uf?: string }>();
    lojasList.forEach((loj) => {
      lojasMap.set(loj.codigo, { nome: loj.nome, cidade: loj.cidade, uf: loj.uf });
    });

    // Filtra rotas com base nos seletores ativos
    const rotasParaAnalise = routes.filter((r) => {
      if (selectedIndustria !== 'todas' && r.industria_codigo !== selectedIndustria) return false;
      if (selectedLoja !== 'todas' && r.loja_codigo !== selectedLoja) return false;
      return true;
    });

    const { elegiveis, conflitos } = analyzeRotasForContracts(rotasParaAnalise, {
      data_referencia: contratosRefDate,
      data_cadastro_map: dataInicioOperacaoMap
    });

    // Mapa de Contratos Existentes em public.contratos_lojas (Etapa H3.3)
    // Chave: `industria_codigo|loja_codigo` -> array de contratos ordenados
    const contratosExistentesMap = new Map<string, ContratoLoja[]>();
    contratosList.forEach((c) => {
      const ind = (c.industria_codigo || '').trim().toUpperCase();
      const loj = (c.loja_codigo || '').trim().toUpperCase();
      if (!ind || !loj) return;
      const key = `${ind}|${loj}`;
      const list = contratosExistentesMap.get(key) || [];
      list.push(c);
      contratosExistentesMap.set(key, list);
    });

    const elegiveisEnriquecidos = elegiveis.map((item) => {
      const dataInicioOp = dataInicioOperacaoMap[item.industria_codigo];
      const isKing = item.industria_codigo === 'IND-013';
      const cadastroAusente = !dataInicioOp;

      // Buscar contratos existentes para esta combinação
      const key = `${item.industria_codigo.toUpperCase()}|${item.loja_codigo.toUpperCase()}`;
      const contratosDoPar = contratosExistentesMap.get(key) || [];
      
      const {
        classificacao,
        motivoClassificacao,
        contratoAtivo,
        contratoSuspenso
      } = classificarParContratual({
        contratosDoPar,
        dataInicioOperacao: dataInicioOp,
        contratosError
      });

      return {
        ...item,
        // Projeção do período fica indisponível se a data de início da operação não estiver informada ou houver erro
        projecao_periodo: (cadastroAusente || contratosError) ? undefined : item.projecao_periodo,
        industriaNome: industriasMap.get(item.industria_codigo) || item.industria_codigo,
        lojaInfo: lojasMap.get(item.loja_codigo) || { nome: item.loja_codigo },
        dataCadastro: dataInicioOp || null,
        cadastroAusente,
        classificacao,
        motivoClassificacao,
        contratoAtivoExistente: contratoAtivo || null,
        contratoSuspensoExistente: contratoSuspenso || null,
        totalContratosHistoricos: contratosDoPar.length
      };
    });

    const conflitosEnriquecidos = conflitos.map((c) => ({
      ...c,
      industriaNome: industriasMap.get(c.industria_codigo) || c.industria_codigo,
      lojaInfo: lojasMap.get(c.loja_codigo) || { nome: c.loja_codigo },
      classificacao: 'CONFLITO_FREQUENCIA' as const,
      motivoClassificacao: 'Múltiplas rotas cadastradas com frequências divergentes para o mesmo PDV.'
    }));

    // Métricas consolidadas
    const totalElegiveisAptos = elegiveisEnriquecidos.filter((e) => e.classificacao === 'ELEGIVEL').length;
    const totalJaComContratoAtivo = elegiveisEnriquecidos.filter((e) => e.classificacao === 'JA_POSSUI_ATIVO').length;
    const totalJaComContratoSuspenso = elegiveisEnriquecidos.filter((e) => e.classificacao === 'JA_POSSUI_SUSPENSO').length;
    const totalInicioNaoInformado = elegiveisEnriquecidos.filter((e) => e.classificacao === 'INICIO_NAO_INFORMADO').length;

    return {
      elegiveis: elegiveisEnriquecidos,
      conflitos: conflitosEnriquecidos,
      totalParesAnalisados: elegiveis.length + conflitos.length,
      totalElegiveisAptos,
      totalJaComContratoAtivo,
      totalJaComContratoSuspenso,
      totalInicioNaoInformado
    };
  }, [routes, industries, lojasList, contratosList, contratosError, selectedIndustria, selectedLoja, contratosRefDate]);

  // Colunas padronizadas para a tabela de Contratos Elegíveis com DataTable
  const contratosColumns: Column<ContratoItemElegivel>[] = useMemo(() => [
    {
      key: 'industria',
      header: 'Indústria',
      sortable: true,
      accessor: (c) => c.industriaNome,
      render: (c) => {
        const isKing = c.industria_codigo === 'IND-013';
        return (
          <div>
            <span className="font-bold text-[#171717] block">{c.industriaNome}</span>
            <span className={`text-[10px] font-mono ${isKing ? 'text-[#286FF5] font-bold' : 'text-[#737373]'}`}>
              {c.industria_codigo} {isKing && '★ (KING)'}
            </span>
          </div>
        );
      }
    },
    {
      key: 'loja',
      header: 'Loja / PDV',
      sortable: true,
      accessor: (c) => c.lojaInfo.nome,
      render: (c) => (
        <div>
          <span className="text-[#171717] block font-bold">{c.lojaInfo.nome}</span>
          <span className="text-[10px] text-[#737373] block font-mono">
            {c.loja_codigo} {c.lojaInfo.cidade ? `• ${c.lojaInfo.cidade}/${c.lojaInfo.uf}` : ''}
          </span>
        </div>
      )
    },
    {
      key: 'frequencia',
      header: 'Frequência',
      sortable: true,
      accessor: (c) => c.frequencia,
      render: (c) => (
        <div className="flex items-center gap-1.5 flex-wrap">
          <StatusBadge
            status={c.frequencia}
            variant={
              c.frequencia === 'SEMANAL'
                ? 'semanal'
                : c.frequencia === 'QUINZENAL'
                ? 'quinzenal'
                : 'mensal'
            }
            label={c.frequencia}
          />
          {c.visitas_por_semana && (
            <span className="text-[10px] font-mono font-bold text-[#525252]">
              ({c.visitas_por_semana}x/sem)
            </span>
          )}
        </div>
      )
    },
    {
      key: 'dias_visita',
      header: 'Dias de Visita',
      render: (c) => (
        <div className="flex gap-1">
          {['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'].map((d, dIdx) => {
            const labels = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
            const active = Boolean(c[d as keyof ContratoItemElegivel]);
            return (
              <span
                key={d}
                className={`w-4 h-4 rounded text-[9px] flex items-center justify-center font-bold ${
                  active ? 'bg-[#111114] text-white shadow-xs' : 'bg-[#EAE8E2] text-[#A3A3A3]'
                }`}
              >
                {labels[dIdx]}
              </span>
            );
          })}
        </div>
      )
    },
    {
      key: 'periodo_sugerido',
      header: 'Período Sugerido',
      sortable: true,
      accessor: (c) => c.projecao_periodo?.data_inicio || '',
      render: (c) => {
        const proj = c.projecao_periodo;
        if (!proj) return <span className="text-[#D93636] italic text-xs">Não calculado</span>;
        return (
          <div className="font-mono text-xs">
            <span className="text-[#171717] font-bold block">{proj.data_inicio}</span>
            <span className="text-[10px] text-[#737373] block">até {proj.data_fim}</span>
          </div>
        );
      }
    },
    {
      key: 'competencia',
      header: 'Competência',
      sortable: true,
      accessor: (c) => c.projecao_periodo?.competencia || '',
      render: (c) => {
        const proj = c.projecao_periodo;
        if (!proj) return <span className="text-[#737373]">—</span>;
        return (
          <span className="px-2 py-0.5 rounded bg-[#EAE8E2] border border-[#CFCDC5] text-[#D98A00] font-mono font-bold text-xs">
            {proj.competencia}
          </span>
        );
      }
    },
    {
      key: 'tipo_ciclo',
      header: 'Tipo de Ciclo',
      sortable: true,
      accessor: (c) => c.projecao_periodo?.tipo_ciclo || '',
      render: (c) => {
        const proj = c.projecao_periodo;
        if (!proj) return <span className="text-[#737373]">—</span>;
        return (
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
              proj.tipo_ciclo === 'ESPECIAL_KING_23_22'
                ? 'bg-[#EBF2FE] text-[#286FF5] border-[#C3D9FD]'
                : proj.tipo_ciclo === 'PRIMEIRA_VIGENCIA_PRO_RATA'
                ? 'bg-[#FFF8E6] text-[#D98A00] border-[#FCE19B]'
                : 'bg-[#E8F5EE] text-[#16845B] border-[#B9E5D0]'
            }`}
          >
            {proj.tipo_ciclo}
          </span>
        );
      }
    },
    {
      key: 'data_inicio_operacao',
      header: 'Início Operação',
      sortable: true,
      accessor: (c) => c.dataCadastro || '',
      render: (c) => {
        if (c.dataCadastro) {
          return <span className="text-[#525252] text-xs font-mono">{c.dataCadastro}</span>;
        }
        return (
          <span className="text-[10px] text-[#D93636] font-bold flex items-center gap-1 font-mono">
            <span className="material-symbols-outlined text-[12px]">warning</span>
            Indisponível
          </span>
        );
      }
    },
    {
      key: 'situacao_contratual',
      header: 'Situação Contratual',
      sortable: true,
      accessor: (c) => c.classificacao,
      render: (c) => {
        if (c.classificacao === 'JA_POSSUI_ATIVO') {
          return (
            <div>
              <StatusBadge status="ativo" label="CONTRATO ATIVO" variant="ativo" />
              <span className="text-[10px] text-[#737373] font-mono block mt-0.5" title={c.motivoClassificacao}>
                Desde {c.contratoAtivoExistente?.data_inicio_vigencia}
              </span>
            </div>
          );
        }
        if (c.classificacao === 'JA_POSSUI_SUSPENSO') {
          return (
            <div>
              <StatusBadge status="suspenso" label="SUSPENSO" variant="pendente" />
              <span className="text-[10px] text-[#D98A00] font-mono block mt-0.5" title={c.motivoClassificacao}>
                Revisar manual
              </span>
            </div>
          );
        }
        if (c.classificacao === 'INICIO_NAO_INFORMADO') {
          return (
            <div>
              <StatusBadge status="bloqueado" label="INÍCIO AUSENTE" variant="falta" />
              <span className="text-[10px] text-[#D93636] font-mono block mt-0.5" title={c.motivoClassificacao}>
                Cadastrar indústria
              </span>
            </div>
          );
        }
        if (c.classificacao === 'ERRO_CONSULTA') {
          return (
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#FDF2F2] text-[#D93636] border border-[#F8C8C8] flex items-center gap-1 w-max" title={c.motivoClassificacao}>
              <span className="material-symbols-outlined text-[12px]">error</span>
              Erro Consulta
            </span>
          );
        }
        return (
          <div>
            <StatusBadge status="elegivel" label="APTO P/ CONTRATO" variant="ativo" />
            <span className="text-[10px] text-[#737373] font-mono block mt-0.5">
              Sem contrato ativo
            </span>
          </div>
        );
      }
    },
    {
      key: 'acoes',
      header: 'Ações',
      headerClassName: 'text-center',
      className: 'text-center',
      render: (c) => {
        if (!canEdit) return null;
        if (c.classificacao === 'ELEGIVEL') {
          return (
            <button
              type="button"
              onClick={() => {
                setReviewingContrato(c);
                setRevisaoForm({
                  valor_por_visita: '',
                  tipo_vigencia: 'continua',
                  data_fim_vigencia: '',
                  observacao: ''
                });
                setRevisaoErrors({});
                setSimulatedPayload(null);
              }}
              className="px-2.5 py-1.5 rounded-lg bg-[#111114] hover:bg-black text-white text-xs font-bold border border-[#111114] flex items-center gap-1.5 mx-auto transition-all cursor-pointer shadow-xs hover:shadow-md"
              title="Revisar e autorizar contrato individualmente"
            >
              <span className="material-symbols-outlined text-[14px] text-[#D98A00]">rate_review</span>
              <span>Revisar</span>
            </button>
          );
        }
        return (
          <span
            className="text-[10px] text-[#737373] italic flex items-center justify-center gap-1 font-mono"
            title={c.motivoClassificacao}
          >
            <span className="material-symbols-outlined text-[12px] text-[#A3A3A3]">lock</span>
            Bloqueado
          </span>
        );
      }
    }
  ], [canEdit]);

  // Colunas do DataTable para a aba de Cadastro de Indústrias (Onda 3.1)
  const columnsIndustrias = useMemo<Column<IndustryItem>[]>(() => [
    {
      key: 'codigo',
      header: 'Código',
      className: 'font-mono font-bold text-purple-700 whitespace-nowrap',
      render: (ind) => (
        <span className="font-mono font-bold text-purple-700">{ind.codigo}</span>
      )
    },
    {
      key: 'nome',
      header: 'Nome da Indústria',
      className: 'font-semibold text-[#171717]',
      render: (ind) => (
        <div>
          <span className="font-bold text-[#171717] block">{ind.nome}</span>
          {ind.data_inicio_operacao && (
            <span className="text-[10px] font-mono text-[#5F5F5F] block">
              Início: {ind.data_inicio_operacao.slice(0, 10)}
            </span>
          )}
        </div>
      )
    },
    {
      key: 'cnpj',
      header: 'CNPJ',
      className: 'font-mono text-[#5F5F5F] whitespace-nowrap',
      render: (ind) => <span>{ind.cnpj || '—'}</span>
    },
    {
      key: 'status',
      header: 'Status',
      className: 'whitespace-nowrap',
      render: (ind) => (
        <StatusBadge
          status={ind.status === 'ativo' ? 'ativo' : 'inativo'}
          label={ind.status.toUpperCase()}
          variant={ind.status === 'ativo' ? 'ativo' : 'inativo'}
        />
      )
    },
    {
      key: 'observacao',
      header: 'Observação',
      className: 'text-[#5F5F5F] max-w-xs truncate',
      render: (ind) => <span title={ind.observacao || ''}>{ind.observacao || '—'}</span>
    },
    {
      key: 'acoes',
      header: 'Ações',
      headerClassName: 'text-right',
      className: 'text-right whitespace-nowrap space-x-2',
      render: (ind) => (
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => setViewingItem(ind)}
            className="p-1.5 rounded-lg bg-[#EAE8E2] hover:bg-[#DFDDD6] text-[#171717] border border-[#CFCDC5] cursor-pointer transition-colors"
            title="Ver Detalhes"
            aria-label={`Ver detalhes de ${ind.nome}`}
          >
            <span className="material-symbols-outlined text-[16px]">visibility</span>
          </button>

          {canEdit && (
            <>
              <button
                type="button"
                onClick={() => handleOpenEdit(ind)}
                className="p-1.5 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 cursor-pointer transition-colors"
                title="Editar"
                aria-label={`Editar ${ind.nome}`}
              >
                <span className="material-symbols-outlined text-[16px]">edit</span>
              </button>
              <button
                type="button"
                onClick={() => handleToggleStatus(ind)}
                className={`p-1.5 rounded-lg border cursor-pointer transition-colors ${
                  ind.status === 'ativo'
                    ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200'
                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                }`}
                title={ind.status === 'ativo' ? 'Inativar Indústria' : 'Ativar Indústria'}
                aria-label={ind.status === 'ativo' ? `Inativar ${ind.nome}` : `Ativar ${ind.nome}`}
              >
                <span className="material-symbols-outlined text-[16px]">
                  {ind.status === 'ativo' ? 'block' : 'check_circle'}
                </span>
              </button>
            </>
          )}
        </div>
      )
    }
  ], [canEdit]);

  // Abrir Modal de Adição
  const handleOpenCreate = async () => {
    setEditingItem(null);

    let nextCode = '';
    try {
      if (supabase) {
        const { data, error: rpcErr } = await supabase.rpc('get_next_industry_code');
        if (!rpcErr && data) {
          nextCode = data;
        }
      }
    } catch (err) {
      console.error('Erro ao consultar próximo código da indústria:', err);
    }

    setFormData({
      codigo: nextCode,
      nome: '',
      cnpj: '',
      status: 'ativo',
      observacao: '',
      data_inicio_operacao: '',
      whatsapp_group_link: ''
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
      observacao: item.observacao || '',
      data_inicio_operacao: item.data_inicio_operacao ? item.data_inicio_operacao.slice(0, 10) : '',
      whatsapp_group_link: item.whatsapp_group_link || ''
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

    const groupLinkRaw = formData.whatsapp_group_link.trim();
    if (groupLinkRaw && !isValidWhatsAppGroupLink(groupLinkRaw)) {
      onShowToast({
        title: 'Link de WhatsApp Inválido',
        message: 'O link do grupo deve ser no formato https://chat.whatsapp.com/[código]. Links wa.me ou de outros domínios são rejeitados.',
        type: 'error'
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
        data_inicio_operacao: formData.data_inicio_operacao.trim() || null,
        whatsapp_group_link: sanitizeWhatsAppGroupLink(groupLinkRaw),
        updated_at: new Date().toISOString()
      };

      if (editingItem) {
        // Atualizar
        const { error: updateErr } = await supabase
          .from('industrias')
          .update(payload)
          .eq('id', editingItem.id);

        if (updateErr) {
          if (updateErr.code === '23505') {
            throw new Error(`O código de indústria "${payload.codigo}" já está em uso por outro registro.`);
          }
          throw updateErr;
        }

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

        if (insertErr) {
          if (insertErr.code === '23505') {
            throw new Error(`O código de indústria "${payload.codigo}" já está cadastrado no sistema.`);
          }
          throw insertErr;
        }

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
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#CFCDC5] pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center font-bold text-white shadow-[0_0_14px_rgba(147,51,234,0.6)]">
              <span className="material-symbols-outlined text-[20px]">factory</span>
            </div>
            <h1 className="text-3xl font-extrabold text-[#171717] tracking-tight">
              Gestão de Indústrias
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-[#77766F] mt-1 max-w-3xl">
            Aderência operacional de visitas e cadastro das marcas parceiras atendidas pela operação de trade marketing.
          </p>
        </div>

        {/* AÇÕES E NAVEGAÇÃO DE ABAS */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={fetchIndustries}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] text-xs font-semibold text-[#171717] hover:text-white hover:border-purple-500/40 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Recarregar Lista de Indústrias"
          >
            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>
              refresh
            </span>
            <span>Atualizar</span>
          </button>

          {canEdit && (
            <button
              onClick={handleOpenCreate}
              className="px-4 py-2 rounded-xl bg-[#222222] hover:bg-black text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-all shadow-[0_0_15px_rgba(147,51,234,0.4)] active:scale-95"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              <span>Nova Indústria</span>
            </button>
          )}

          {/* NAVEGAÇÃO DE ABAS */}
          <div className="flex items-center gap-1.5 bg-[#EAE8E2] p-1.5 rounded-xl border border-[#CFCDC5]">
            <button
              onClick={() => setActiveTab('frequencia')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'frequencia'
                  ? 'bg-[#111114] text-white shadow-sm'
                  : 'text-[#5F5F5F] hover:text-[#171717] hover:bg-[#D5D3CB]'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">analytics</span>
              <span>Aderência</span>
            </button>

            <button
              onClick={() => setActiveTab('cadastro')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'cadastro'
                  ? 'bg-[#111114] text-white shadow-sm'
                  : 'text-[#5F5F5F] hover:text-[#171717] hover:bg-[#D5D3CB]'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">list_alt</span>
              <span>Cadastro ({industries.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('contratos')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'contratos'
                  ? 'bg-[#111114] text-white shadow-sm'
                  : 'text-[#5F5F5F] hover:text-[#171717] hover:bg-[#D5D3CB]'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">contract</span>
              <span>Prévia de Contratos</span>
            </button>
          </div>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* ABA 1: CONTROLE DE FREQUÊNCIA OPERACIONAL POR INDÚSTRIA (ETAPA 7A)        */}
      {/* ========================================================================= */}
      {activeTab === 'frequencia' && (
        <div className="space-y-8 animate-fadeIn">
          {/* BARRA DE FILTROS */}
          <section className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-3">
              <div className="flex items-center gap-2 text-xs font-mono font-bold text-[#171717]">
                <span className="material-symbols-outlined text-purple-600 text-[18px]">filter_alt</span>
                <span>FILTROS OPERACIONAIS</span>
              </div>
              <button
                onClick={fetchFrequencyData}
                disabled={freqLoading}
                className="px-3 py-1.5 rounded-lg bg-[#EAE8E2] border border-[#CFCDC5] text-xs font-semibold text-[#171717] hover:bg-[#DFDDD6] flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
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
                <label className="text-[11px] font-mono font-bold text-[#77766F] block mb-1.5 uppercase">
                  Período
                </label>
                <select
                  value={periodFilter}
                  onChange={(e) => setPeriodFilter(e.target.value as any)}
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-xs text-[#171717] focus:outline-none focus:border-purple-500 font-mono"
                >
                  <option value="today">Hoje</option>
                  <option value="week">Últimos 7 dias</option>
                  <option value="month">Este mês</option>
                </select>
              </div>

              {/* FILTRO INDÚSTRIA */}
              <div>
                <label className="text-[11px] font-mono font-bold text-[#77766F] block mb-1.5 uppercase">
                  Indústria
                </label>
                <select
                  value={selectedIndustria}
                  onChange={(e) => setSelectedIndustria(e.target.value)}
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-xs text-[#171717] focus:outline-none focus:border-purple-500 font-mono"
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
                <label className="text-[11px] font-mono font-bold text-[#77766F] block mb-1.5 uppercase">
                  Loja
                </label>
                <select
                  value={selectedLoja}
                  onChange={(e) => setSelectedLoja(e.target.value)}
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-xs text-[#171717] focus:outline-none focus:border-purple-500 font-mono"
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
                <label className="text-[11px] font-mono font-bold text-[#77766F] block mb-1.5 uppercase">
                  Promotor
                </label>
                <select
                  value={selectedPromotor}
                  onChange={(e) => setSelectedPromotor(e.target.value)}
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-xs text-[#171717] focus:outline-none focus:border-purple-500 font-mono"
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
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3 text-amber-900 text-xs font-mono">
              <span className="material-symbols-outlined text-[20px] text-amber-600 shrink-0 mt-0.5">
                warning
              </span>
              <div>
                <span className="font-bold block uppercase tracking-wide text-amber-950">Atenção sobre Rotas Quinzenais:</span>
                <span>
                  As rotas com frequência quinzenal dependem de referência de semana A/B ou data-base não cadastrada no modelo atual. As ocorrências foram calculadas considerando os dias ativos no período.
                </span>
              </div>
            </div>
          )}

          {/* CARDS DE KPI (TOP BAR) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* PLANEJADAS */}
            <div className="p-5 rounded-2xl bg-[#F7F6F2] border border-[#CFCDC5] shadow-xl">
              <div className="flex items-center justify-between text-[#77766F] font-mono text-[11px] font-bold">
                <span>PLANEJADAS</span>
                <span className="material-symbols-outlined text-purple-600">calendar_month</span>
              </div>
              <div className="text-3xl font-extrabold text-[#171717] font-mono mt-2">
                {processedData.totalPlanejadas}
              </div>
              <p className="text-[10px] text-[#5F5F5F] mt-1">Ocorrências geradas por rotas</p>
            </div>

            {/* REALIZADAS */}
            <div className="p-5 rounded-2xl bg-[#F7F6F2] border border-emerald-500/30 shadow-xl">
              <div className="flex items-center justify-between text-emerald-700 font-mono text-[11px] font-bold">
                <span>REALIZADAS</span>
                <span className="material-symbols-outlined text-emerald-600">task_alt</span>
              </div>
              <div className="text-3xl font-extrabold text-emerald-700 font-mono mt-2">
                {processedData.totalRealizadas}
              </div>
              <p className="text-[10px] text-[#5F5F5F] mt-1">Visitas com status concluída</p>
            </div>

            {/* PENDENTES */}
            <div className="p-5 rounded-2xl bg-[#F7F6F2] border border-amber-500/30 shadow-xl">
              <div className="flex items-center justify-between text-amber-700 font-mono text-[11px] font-bold">
                <span>PENDENTES</span>
                <span className="material-symbols-outlined text-amber-600">pending_actions</span>
              </div>
              <div className="text-3xl font-extrabold text-amber-700 font-mono mt-2">
                {processedData.totalPendentes}
              </div>
              <p className="text-[10px] text-[#5F5F5F] mt-1">Visitas sem execução no dia</p>
            </div>

            {/* NÃO REALIZADAS */}
            <div className="p-5 rounded-2xl bg-[#F7F6F2] border border-rose-500/30 shadow-xl">
              <div className="flex items-center justify-between text-rose-700 font-mono text-[11px] font-bold">
                <span>NÃO REALIZADAS</span>
                <span className="material-symbols-outlined text-rose-600">cancel</span>
              </div>
              <div className="text-3xl font-extrabold text-rose-700 font-mono mt-2">
                {processedData.totalNaoRealizadas}
              </div>
              <p className="text-[10px] text-[#5F5F5F] mt-1">Com justificativa / ocorrência</p>
            </div>

            {/* ADERÊNCIA OPERACIONAL */}
            <div className="p-5 rounded-2xl bg-[#F7F6F2] border border-indigo-500/30 shadow-xl">
              <div className="flex items-center justify-between text-indigo-700 font-mono text-[11px] font-bold">
                <span>ADERÊNCIA OPERACIONAL</span>
                <span className="material-symbols-outlined text-indigo-600">trending_up</span>
              </div>
              <div className="text-3xl font-extrabold text-indigo-700 font-mono mt-2">
                {formatAderencia(processedData.totalRealizadas, processedData.totalPlanejadas)}
              </div>
              <p className="text-[10px] text-[#5F5F5F] mt-1">
                Realizadas / Planejadas {processedData.totalEmAndamento > 0 && `(${processedData.totalEmAndamento} em andamento)`}
              </p>
            </div>
          </div>

          {/* ALTERNADOR DE VISUALIZAÇÃO (POR INDÚSTRIA OU POR PROMOTOR) */}
          <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setViewMode('industria')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                  viewMode === 'industria'
                    ? 'bg-[#111114] text-white shadow-sm'
                    : 'bg-[#F7F6F2] text-[#5F5F5F] hover:text-[#171717] hover:bg-[#EAE8E2] border border-[#CFCDC5]'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">factory</span>
                <span>Visão por Indústria</span>
              </button>

              <button
                onClick={() => setViewMode('promotor')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                  viewMode === 'promotor'
                    ? 'bg-[#111114] text-white shadow-sm'
                    : 'bg-[#F7F6F2] text-[#5F5F5F] hover:text-[#171717] hover:bg-[#EAE8E2] border border-[#CFCDC5]'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">badge</span>
                <span>Visão por Promotor</span>
              </button>
            </div>

            <div className="text-xs font-mono text-[#77766F] hidden sm:block">
              {viewMode === 'industria'
                ? `${processedData.tabelaIndustrias.length} Indústrias Analisadas`
                : `${processedData.tabelaPromotores.length} Promotores Analisados`}
            </div>
          </div>

          {/* TABELA DE VISÃO POR INDÚSTRIA & DETALHAMENTO POR LOJA */}
          {viewMode === 'industria' && (
            <section className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl p-6 shadow-2xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-[#171717] tracking-tight flex items-center gap-2">
                    <span className="material-symbols-outlined text-purple-600">table_chart</span>
                    Frequência e Aderência Operacional por Indústria
                  </h3>
                  <p className="text-xs text-[#77766F] mt-0.5">
                    Ordenado inicialmente por menor aderência para identificação rápida de desvios. Clique na linha para detalhar por loja.
                  </p>
                </div>

                <div className="text-xs font-mono text-[#77766F] bg-[#EAE8E2] px-3 py-1.5 rounded-xl border border-[#CFCDC5] w-fit">
                  {filteredIndustriasList.length === processedData.tabelaIndustrias.length ? (
                    <span>Total: <strong>{processedData.tabelaIndustrias.length}</strong> indústrias</span>
                  ) : (
                    <span>Encontradas: <strong>{filteredIndustriasList.length}</strong> de {processedData.tabelaIndustrias.length}</span>
                  )}
                </div>
              </div>

              {/* BARRA DE PESQUISA RÁPIDA E SELETOR DE PÁGINAS */}
              <div className="p-3.5 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#77766F] text-[18px]">
                    search
                  </span>
                  <input
                    type="text"
                    value={searchIndustriaTerm}
                    onChange={(e) => setSearchIndustriaTerm(e.target.value)}
                    placeholder="Buscar indústria por nome ou código..."
                    className="w-full h-9 pl-9 pr-8 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg text-xs text-[#171717] placeholder:text-[#5F5F5F] focus:outline-none focus:border-purple-600 font-sans"
                  />
                  {searchIndustriaTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchIndustriaTerm('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#77766F] hover:text-[#171717]"
                      aria-label="Limpar busca"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 text-xs font-mono text-[#5F5F5F]">
                  <div className="flex items-center gap-1.5">
                    <span>Exibir:</span>
                    <select
                      value={industriaPageSize}
                      onChange={(e) => setIndustriaPageSize(Number(e.target.value) as 10 | 25 | 50)}
                      className="h-8 px-2 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg text-xs text-[#171717] font-mono focus:outline-none focus:border-purple-600"
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                    </select>
                  </div>

                  <span className="text-[11px]">
                    Pág. <strong>{Math.min(industriaPage, totalIndustriasPages)}</strong> de <strong>{totalIndustriasPages}</strong>
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={industriaPage <= 1}
                      onClick={() => setIndustriaPage((p) => Math.max(1, p - 1))}
                      className="px-2.5 py-1 rounded bg-[#F7F6F2] border border-[#CFCDC5] text-xs font-semibold text-[#171717] hover:bg-[#D5D3CB] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center"
                      title="Página Anterior"
                    >
                      <span className="material-symbols-outlined text-[16px]">chevron_left</span>
                    </button>
                    <button
                      type="button"
                      disabled={industriaPage >= totalIndustriasPages}
                      onClick={() => setIndustriaPage((p) => Math.min(totalIndustriasPages, p + 1))}
                      className="px-2.5 py-1 rounded bg-[#F7F6F2] border border-[#CFCDC5] text-xs font-semibold text-[#171717] hover:bg-[#D5D3CB] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center"
                      title="Próxima Página"
                    >
                      <span className="material-symbols-outlined text-[16px]">chevron_right</span>
                    </button>
                  </div>
                </div>
              </div>

              {filteredIndustriasList.length === 0 ? (
                <div className="p-12 text-center text-[#5F5F5F] font-mono text-xs border border-dashed border-[#CFCDC5] rounded-xl space-y-1">
                  <p className="font-bold text-[#171717]">Nenhuma indústria encontrada para os critérios informados.</p>
                  <p className="text-[11px] text-[#77766F]">Tente ajustar o termo de pesquisa ou os filtros operacionais no topo.</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-[#CFCDC5]">
                  <table className="w-full text-left text-xs font-sans border-collapse">
                    <thead>
                      <tr className="border-b border-[#CFCDC5] text-[#5F5F5F] font-mono text-[11px] uppercase bg-[#E3E1DA]">
                        <th className="py-3 px-4 font-bold text-[#171717]">Indústria</th>
                        <th className="py-3 px-4 font-bold text-[#171717] text-right">Planejadas</th>
                        <th className="py-3 px-4 font-bold text-emerald-800 text-right">Realizadas</th>
                        <th className="py-3 px-4 font-bold text-amber-800 text-right">Pendentes</th>
                        <th className="py-3 px-4 font-bold text-rose-800 text-right">Não Realiz.</th>
                        <th className="py-3 px-4 font-bold text-purple-900 text-right">Ocorrências</th>
                        <th className="py-3 px-4 font-bold text-[#171717] text-center">Aderência</th>
                        <th className="py-3 px-4 font-bold text-[#171717] text-center">Detalhamento</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#CFCDC5]">
                      {paginatedIndustrias.map((ind) => {
                        const isExpanded = expandedIndustria === ind.codigo;
                        return (
                          <React.Fragment key={ind.codigo}>
                            <tr
                              onClick={() => setExpandedIndustria(isExpanded ? null : ind.codigo)}
                              className={`transition-colors cursor-pointer ${
                                isExpanded ? 'bg-[#EAE8E2] border-l-4 border-l-purple-600' : 'hover:bg-[#EAE8E2]/60'
                              }`}
                            >
                              <td className="py-3.5 px-4 font-bold text-[#171717] flex items-center gap-2">
                                <span className="material-symbols-outlined text-[#77766F] text-[18px]">
                                  factory
                                </span>
                                <div>
                                  <span className="block">{ind.nome}</span>
                                  <span className="text-[10px] font-mono text-[#5F5F5F]">{ind.codigo}</span>
                                </div>
                                {ind.temQuinzenal && (
                                  <span
                                    title="Possui rotas quinzenais"
                                    className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-800 font-mono text-[9px] border border-amber-500/30"
                                  >
                                    QZN
                                  </span>
                                )}
                              </td>
                              <td className="py-3.5 px-4 font-mono font-semibold text-[#171717] text-right">
                                {ind.planejadas}
                              </td>
                              <td className="py-3.5 px-4 font-mono font-bold text-emerald-700 text-right">
                                {ind.realizadas}
                              </td>
                              <td className="py-3.5 px-4 font-mono text-amber-700 text-right">
                                {ind.pendentes}
                              </td>
                              <td className="py-3.5 px-4 font-mono text-rose-700 text-right">
                                {ind.naoRealizadas}
                              </td>
                              <td className="py-3.5 px-4 font-mono text-purple-700 text-right">
                                {ind.ocorrenciasCount}
                              </td>
                              <td className="py-3.5 px-4 text-center">
                                <span
                                  className={`px-2.5 py-1 rounded-lg font-mono font-bold text-xs inline-block ${
                                    ind.planejadas === 0
                                      ? 'bg-slate-100 text-slate-600 border border-slate-300'
                                      : ind.aderencia >= 80
                                      ? 'bg-emerald-500/20 text-emerald-800 border border-emerald-500/40'
                                      : ind.aderencia >= 50
                                      ? 'bg-amber-500/20 text-amber-800 border border-amber-500/40'
                                      : 'bg-rose-500/20 text-rose-800 border border-rose-500/40'
                                  }`}
                                >
                                  {formatAderencia(ind.realizadas, ind.planejadas)}
                                </span>
                              </td>
                              <td className="py-3.5 px-4 text-center">
                                <button
                                  type="button"
                                  className="text-[#5F5F5F] hover:text-[#171717] transition-colors p-1 rounded-md"
                                  aria-label={isExpanded ? 'Recolher detalhamento' : 'Expandir detalhamento'}
                                >
                                  <span className="material-symbols-outlined text-[20px]">
                                    {isExpanded ? 'expand_less' : 'expand_more'}
                                  </span>
                                </button>
                              </td>
                            </tr>

                            {/* LINHA EXPANDIDA COM DETALHAMENTO POR LOJA */}
                            {isExpanded && (
                              <tr>
                                <td colSpan={8} className="p-0 bg-[#EAE8E2] border-y border-[#CFCDC5]">
                                  <div className="p-4 space-y-3">
                                    <div className="text-xs font-mono font-bold text-[#171717] flex items-center justify-between border-b border-[#CFCDC5] pb-2">
                                      <span>DETALHAMENTO POR LOJA — {ind.nome.toUpperCase()} ({ind.codigo})</span>
                                      <span className="text-[#5F5F5F] font-normal">
                                        {ind.detalhamentoLojas.length} {ind.detalhamentoLojas.length === 1 ? 'Loja Atendida' : 'Lojas Atendidas'}
                                      </span>
                                    </div>

                                    {ind.detalhamentoLojas.length === 0 ? (
                                      <div className="p-4 text-[#5F5F5F] font-mono text-xs bg-[#F7F6F2] rounded-lg border border-[#CFCDC5]">
                                        Esta indústria não possui lojas relacionadas ou visitas registradas para o período selecionado.
                                      </div>
                                    ) : (
                                      <div className="overflow-x-auto rounded-lg border border-[#CFCDC5] bg-[#F7F6F2]">
                                        <table className="w-full text-left text-xs font-sans">
                                          <thead>
                                            <tr className="text-[#5F5F5F] font-mono text-[10px] uppercase border-b border-[#CFCDC5] bg-[#E3E1DA]">
                                              <th className="py-2 px-3 font-bold text-[#171717]">Loja</th>
                                              <th className="py-2 px-3 font-bold text-[#171717]">Promotor</th>
                                              <th className="py-2 px-3 font-bold text-[#171717]">Frequência</th>
                                              <th className="py-2 px-3 font-bold text-[#171717] text-right">Planejadas</th>
                                              <th className="py-2 px-3 font-bold text-emerald-800 text-right">Realizadas</th>
                                              <th className="py-2 px-3 font-bold text-amber-800 text-right">Pendentes</th>
                                              <th className="py-2 px-3 font-bold text-[#171717] text-center">Aderência</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-[#CFCDC5]">
                                            {ind.detalhamentoLojas.map((d, idx) => (
                                              <tr key={idx} className="hover:bg-[#EAE8E2] transition-colors">
                                                <td className="py-2.5 px-3 font-semibold text-[#171717]">
                                                  {d.lojaNome}
                                                  <span className="block text-[10px] font-mono text-[#5F5F5F]">
                                                    {d.lojaCodigo}
                                                  </span>
                                                </td>
                                                <td className="py-2.5 px-3 text-[#171717]">
                                                  {d.promotorNome}
                                                  <span className="block text-[10px] font-mono text-[#5F5F5F]">
                                                    {d.promotorMatricula}
                                                  </span>
                                                </td>
                                                <td className="py-2.5 px-3 font-mono text-[11px] uppercase">
                                                  <span className="px-2 py-0.5 rounded bg-[#E3E1DA] text-[#7E22CE] font-bold border border-purple-500/20">
                                                    {d.frequencia}
                                                  </span>
                                                </td>
                                                <td className="py-2.5 px-3 font-mono text-[#171717] text-right">
                                                  {d.planejadas}
                                                </td>
                                                <td className="py-2.5 px-3 font-mono text-emerald-700 font-bold text-right">
                                                  {d.realizadas}
                                                </td>
                                                <td className="py-2.5 px-3 font-mono text-amber-700 text-right">
                                                  {d.pendentes}
                                                </td>
                                                <td className="py-2.5 px-3 text-center">
                                                  <span className="font-mono font-bold text-xs text-indigo-700">
                                                    {formatAderencia(d.realizadas, d.planejadas)}
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

                  {/* RODAPÉ DA TABELA DE INDÚSTRIAS COM CONTROLES DE PAGINAÇÃO */}
                  {totalIndustriasPages > 1 && (
                    <div className="p-3 bg-[#EAE8E2] border-t border-[#CFCDC5] flex items-center justify-between text-xs font-mono text-[#5F5F5F]">
                      <span>
                        Mostrando {paginatedIndustrias.length} de {filteredIndustriasList.length} indústrias
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={industriaPage <= 1}
                          onClick={() => setIndustriaPage((p) => Math.max(1, p - 1))}
                          className="px-3 py-1 rounded bg-[#F7F6F2] border border-[#CFCDC5] text-[#171717] hover:bg-[#D5D3CB] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        >
                          Anterior
                        </button>
                        <span>
                          Página {Math.min(industriaPage, totalIndustriasPages)} de {totalIndustriasPages}
                        </span>
                        <button
                          type="button"
                          disabled={industriaPage >= totalIndustriasPages}
                          onClick={() => setIndustriaPage((p) => Math.min(totalIndustriasPages, p + 1))}
                          className="px-3 py-1 rounded bg-[#F7F6F2] border border-[#CFCDC5] text-[#171717] hover:bg-[#D5D3CB] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        >
                          Próxima
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* TABELA DE VISÃO POR PROMOTOR */}
          {viewMode === 'promotor' && (
            <section className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl p-6 shadow-2xl space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-[#171717] tracking-tight flex items-center gap-2">
                    <span className="material-symbols-outlined text-purple-600">badge</span>
                    Aderência Operacional por Promotor
                  </h3>
                  <p className="text-xs text-[#77766F] mt-0.5">
                    Métricas acumuladas de cumprimento do roteiro individual. Clique na linha para detalhar lojas e indústrias atendidas.
                  </p>
                </div>

                {/* CONTROLES DE BUSCA E PAGINAÇÃO SUPERIOR */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative min-w-[240px]">
                    <span className="material-symbols-outlined absolute left-3 top-2.5 text-[#77766F] text-[18px]">
                      search
                    </span>
                    <input
                      type="text"
                      placeholder="Buscar promotor por nome ou matrícula..."
                      value={searchPromotorTerm}
                      onChange={(e) => setSearchPromotorTerm(e.target.value)}
                      className="w-full pl-9 pr-8 py-1.5 text-xs bg-[#EAE8E2] border border-[#CFCDC5] rounded-lg text-[#171717] placeholder-[#77766F] focus:outline-none focus:border-purple-600 focus:bg-[#F7F6F2] transition-colors"
                    />
                    {searchPromotorTerm && (
                      <button
                        type="button"
                        onClick={() => setSearchPromotorTerm('')}
                        className="absolute right-2.5 top-2 text-[#77766F] hover:text-[#171717] cursor-pointer"
                        title="Limpar busca"
                      >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-[#5F5F5F] font-mono">
                    <span>Exibir:</span>
                    <select
                      value={promotorPageSize}
                      onChange={(e) => setPromotorPageSize(Number(e.target.value) as 10 | 25 | 50)}
                      className="bg-[#EAE8E2] border border-[#CFCDC5] rounded px-2 py-1 text-xs text-[#171717] focus:outline-none focus:border-purple-600 cursor-pointer"
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* BARRA DE STATUS DOS RESULTADOS */}
              <div className="flex items-center justify-between text-xs font-mono text-[#5F5F5F] px-1 pt-1 border-t border-[#EAE8E2]">
                <span>
                  Encontrados: {filteredPromotoresList.length} de {processedData.tabelaPromotores.length} promotores
                  {searchPromotorTerm && ` (filtrado por "${searchPromotorTerm}")`}
                </span>

                {totalPromotoresPages > 1 && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={promotorPage <= 1}
                      onClick={() => setPromotorPage((p) => Math.max(1, p - 1))}
                      className="px-2.5 py-1 rounded bg-[#EAE8E2] border border-[#CFCDC5] text-[#171717] hover:bg-[#D5D3CB] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-xs"
                    >
                      Anterior
                    </button>
                    <span>
                      Pág. {Math.min(promotorPage, totalPromotoresPages)} de {totalPromotoresPages}
                    </span>
                    <button
                      type="button"
                      disabled={promotorPage >= totalPromotoresPages}
                      onClick={() => setPromotorPage((p) => Math.min(totalPromotoresPages, p + 1))}
                      className="px-2.5 py-1 rounded bg-[#EAE8E2] border border-[#CFCDC5] text-[#171717] hover:bg-[#D5D3CB] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-xs"
                    >
                      Próxima
                    </button>
                  </div>
                )}
              </div>

              {filteredPromotoresList.length === 0 ? (
                <div className="p-12 text-center text-[#5F5F5F] font-mono text-xs border border-dashed border-[#CFCDC5] rounded-xl">
                  {searchPromotorTerm
                    ? `Nenhum promotor encontrado correspondente ao termo "${searchPromotorTerm}".`
                    : 'Nenhum promotor encontrado para os filtros selecionados.'}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-[#CFCDC5]">
                  <table className="w-full text-left text-xs font-sans border-collapse">
                    <thead>
                      <tr className="border-b border-[#CFCDC5] text-[#5F5F5F] font-mono text-[11px] uppercase bg-[#E3E1DA]">
                        <th className="py-3 px-4 font-bold text-[#171717]">Promotor</th>
                        <th className="py-3 px-4 font-bold text-[#171717] text-center">Indústrias</th>
                        <th className="py-3 px-4 font-bold text-[#171717] text-center">Lojas</th>
                        <th className="py-3 px-4 font-bold text-[#171717] text-right">Planejadas</th>
                        <th className="py-3 px-4 font-bold text-emerald-800 text-right">Realizadas</th>
                        <th className="py-3 px-4 font-bold text-amber-800 text-right">Pendentes</th>
                        <th className="py-3 px-4 font-bold text-[#171717] text-center">Aderência</th>
                        <th className="py-3 px-4 font-bold text-[#171717] text-center">Detalhamento</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#CFCDC5]">
                      {paginatedPromotores.map((prm) => {
                        const isExpanded = expandedPromotor === prm.matricula;
                        const aderenciaNum = prm.planejadas > 0 ? (prm.realizadas / prm.planejadas) * 100 : 0;
                        return (
                          <React.Fragment key={prm.matricula}>
                            <tr
                              onClick={() => setExpandedPromotor(isExpanded ? null : prm.matricula)}
                              className={`transition-colors cursor-pointer ${
                                isExpanded ? 'bg-[#EAE8E2] border-l-4 border-l-purple-600' : 'hover:bg-[#EAE8E2]/60'
                              }`}
                            >
                              <td className="py-3.5 px-4 font-bold text-[#171717] flex items-center gap-2">
                                <span className="material-symbols-outlined text-purple-600 text-[18px]">
                                  person
                                </span>
                                <div>
                                  <span className="block">{prm.nome}</span>
                                  <span className="text-[10px] font-mono text-[#5F5F5F]">{prm.matricula}</span>
                                </div>
                              </td>
                              <td className="py-3.5 px-4 text-center font-mono text-[#171717]">
                                {prm.qtdIndustrias}
                              </td>
                              <td className="py-3.5 px-4 text-center font-mono text-[#171717]">
                                {prm.qtdLojas}
                              </td>
                              <td className="py-3.5 px-4 font-mono font-semibold text-[#171717] text-right">
                                {prm.planejadas}
                              </td>
                              <td className="py-3.5 px-4 font-mono font-bold text-emerald-700 text-right">
                                {prm.realizadas}
                              </td>
                              <td className="py-3.5 px-4 font-mono text-amber-700 text-right">
                                {prm.pendentes}
                              </td>
                              <td className="py-3.5 px-4 text-center">
                                <span
                                  className={`px-2.5 py-1 rounded-lg font-mono font-bold text-xs inline-block ${
                                    prm.planejadas === 0
                                      ? 'bg-neutral-200 text-[#5F5F5F]'
                                      : aderenciaNum >= 80
                                      ? 'bg-emerald-500/20 text-emerald-800 border border-emerald-500/40'
                                      : aderenciaNum >= 50
                                      ? 'bg-amber-500/20 text-amber-800 border border-amber-500/40'
                                      : 'bg-rose-500/20 text-rose-800 border border-rose-500/40'
                                  }`}
                                >
                                  {formatAderencia(prm.realizadas, prm.planejadas)}
                                </span>
                              </td>
                              <td className="py-3.5 px-4 text-center">
                                <button
                                  type="button"
                                  className="text-[#5F5F5F] hover:text-[#171717] transition-colors p-1 rounded-md cursor-pointer"
                                  aria-label={isExpanded ? 'Recolher detalhamento' : 'Expandir detalhamento'}
                                >
                                  <span className="material-symbols-outlined text-[20px]">
                                    {isExpanded ? 'expand_less' : 'expand_more'}
                                  </span>
                                </button>
                              </td>
                            </tr>

                            {/* LINHA EXPANDIDA COM DETALHAMENTO DE ATENDIMENTOS DO PROMOTOR */}
                            {isExpanded && (
                              <tr>
                                <td colSpan={8} className="p-0 bg-[#EAE8E2] border-y border-[#CFCDC5] border-l-4 border-l-purple-600">
                                  <div className="p-4 space-y-3">
                                    <div className="text-xs font-mono font-bold text-[#171717] flex items-center justify-between border-b border-[#CFCDC5] pb-2">
                                      <span>ATENDIMENTOS DO PROMOTOR — {prm.nome.toUpperCase()} ({prm.matricula})</span>
                                      <span className="text-[#5F5F5F] font-normal">
                                        {prm.detalhamentoAtendimentos.length} Relações Loja × Indústria
                                      </span>
                                    </div>

                                    {prm.detalhamentoAtendimentos.length === 0 ? (
                                      <div className="p-4 text-[#5F5F5F] font-mono text-xs">
                                        Sem detalhamento de atendimentos para este promotor no período.
                                      </div>
                                    ) : (
                                      <div className="overflow-x-auto rounded-lg border border-[#CFCDC5] bg-[#F7F6F2]">
                                        <table className="w-full text-left text-xs font-sans">
                                          <thead>
                                            <tr className="text-[#5F5F5F] font-mono text-[10px] uppercase border-b border-[#CFCDC5] bg-[#E3E1DA]">
                                              <th className="py-2 px-3 font-bold text-[#171717]">Loja</th>
                                              <th className="py-2 px-3 font-bold text-[#171717]">Indústria</th>
                                              <th className="py-2 px-3 font-bold text-[#171717]">Frequência</th>
                                              <th className="py-2 px-3 font-bold text-[#171717] text-right">Planejadas</th>
                                              <th className="py-2 px-3 font-bold text-emerald-800 text-right">Realizadas</th>
                                              <th className="py-2 px-3 font-bold text-amber-800 text-right">Pendentes</th>
                                              <th className="py-2 px-3 font-bold text-[#171717] text-center">Aderência</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-[#CFCDC5]">
                                            {prm.detalhamentoAtendimentos.map((d, idx) => (
                                              <tr key={idx} className="hover:bg-[#EAE8E2] transition-colors">
                                                <td className="py-2.5 px-3 font-semibold text-[#171717]">
                                                  {d.lojaNome}
                                                  <span className="block text-[10px] font-mono text-[#5F5F5F]">
                                                    {d.lojaCodigo}
                                                  </span>
                                                </td>
                                                <td className="py-2.5 px-3 text-[#171717]">
                                                  {d.industriaNome}
                                                  <span className="block text-[10px] font-mono text-[#5F5F5F]">
                                                    {d.industriaCodigo}
                                                  </span>
                                                </td>
                                                <td className="py-2.5 px-3 font-mono text-[11px] uppercase">
                                                  <span className="px-2 py-0.5 rounded bg-[#E3E1DA] text-[#7E22CE] font-bold border border-purple-500/20">
                                                    {d.frequencia}
                                                  </span>
                                                </td>
                                                <td className="py-2.5 px-3 font-mono text-[#171717] text-right">
                                                  {d.planejadas}
                                                </td>
                                                <td className="py-2.5 px-3 font-mono text-emerald-700 font-bold text-right">
                                                  {d.realizadas}
                                                </td>
                                                <td className="py-2.5 px-3 font-mono text-amber-700 text-right">
                                                  {d.pendentes}
                                                </td>
                                                <td className="py-2.5 px-3 text-center">
                                                  <span className="font-mono font-bold text-xs text-indigo-700">
                                                    {formatAderencia(d.realizadas, d.planejadas)}
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

                  {/* RODAPÉ DA TABELA DE PROMOTORES COM CONTROLES DE PAGINAÇÃO */}
                  {totalPromotoresPages > 1 && (
                    <div className="p-3 bg-[#EAE8E2] border-t border-[#CFCDC5] flex items-center justify-between text-xs font-mono text-[#5F5F5F]">
                      <span>
                        Mostrando {paginatedPromotores.length} de {filteredPromotoresList.length} promotores
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={promotorPage <= 1}
                          onClick={() => setPromotorPage((p) => Math.max(1, p - 1))}
                          className="px-3 py-1 rounded bg-[#F7F6F2] border border-[#CFCDC5] text-[#171717] hover:bg-[#D5D3CB] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        >
                          Anterior
                        </button>
                        <span>
                          Página {Math.min(promotorPage, totalPromotoresPages)} de {totalPromotoresPages}
                        </span>
                        <button
                          type="button"
                          disabled={promotorPage >= totalPromotoresPages}
                          onClick={() => setPromotorPage((p) => Math.min(totalPromotoresPages, p + 1))}
                          className="px-3 py-1 rounded bg-[#F7F6F2] border border-[#CFCDC5] text-[#171717] hover:bg-[#D5D3CB] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        >
                          Próxima
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* ABA 2: CADASTRO DAS INDÚSTRIAS (TELA ORIGINAL PRESERVADA INTEGRAMENTE)    */}
      {/* ========================================================================= */}
      {/* ========================================================================= */}
      {/* ABA 2: CADASTRO DAS INDÚSTRIAS (ONDA 3.1 — STATCARD, DATATABLE, STATUSBIADGE) */}
      {/* ========================================================================= */}
      {activeTab === 'cadastro' && (
        <div className="space-y-8 animate-fadeIn">
          {/* CARDS DE METRICAS COM STATCARD */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <StatCard
              title="TOTAL DE INDÚSTRIAS"
              value={industries.length}
              icon="factory"
              variant="default"
              description="Marcas parceiras cadastradas no MK9"
            />
            <StatCard
              title="INDÚSTRIAS ATIVAS"
              value={industries.filter((i) => i.status === 'ativo').length}
              icon="check_circle"
              variant="success"
              description="Disponíveis para vinculação e rotas"
            />
            <StatCard
              title="INATIVAS / ARQUIVADAS"
              value={industries.filter((i) => i.status === 'inativo').length}
              icon="block"
              variant="danger"
              description="Suspensas ou fora de operação"
            />
          </div>

          {/* BARRA DE FILTRO E AÇÃO DE CRIAÇÃO */}
          <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl p-5 shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="w-full sm:w-72">
              <label className="text-[11px] font-mono font-bold text-[#77766F] block mb-1.5 uppercase">
                Filtrar por Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-xs text-[#171717] focus:outline-none focus:border-purple-500 font-mono"
              >
                <option value="todos">Status: Todos ({industries.length})</option>
                <option value="ativo">Ativas ({industries.filter((i) => i.status === 'ativo').length})</option>
                <option value="inativo">Inativas ({industries.filter((i) => i.status === 'inativo').length})</option>
              </select>
            </div>

            {canEdit && (
              <div className="self-end sm:self-center">
                <button
                  type="button"
                  onClick={handleOpenCreate}
                  className="px-4 py-2.5 rounded-xl bg-[#111114] hover:bg-black text-white font-bold text-xs flex items-center gap-2 cursor-pointer transition-all shadow-sm active:scale-95"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  <span>Nova Indústria</span>
                </button>
              </div>
            )}
          </div>

          {/* TABELA COM COMPONENTE COMPARTILHADO DATATABLE */}
          <section className="space-y-4">
            <DataTable<IndustryItem>
              data={filteredIndustries}
              columns={columnsIndustrias}
              keyExtractor={(ind) => ind.id}
              loading={loading}
              error={error}
              searchPlaceholder="Buscar por código, nome ou CNPJ da indústria..."
              searchFilter={(ind, query) => {
                const term = query.toLowerCase();
                return (
                  ind.codigo.toLowerCase().includes(term) ||
                  ind.nome.toLowerCase().includes(term) ||
                  Boolean(ind.cnpj && ind.cnpj.toLowerCase().includes(term))
                );
              }}
              defaultPageSize={10}
              emptyMessage="Nenhuma indústria encontrada com os filtros aplicados."
              headerActions={
                <span className="text-xs font-mono font-bold text-[#77766F]">
                  Total: {filteredIndustries.length} {filteredIndustries.length === 1 ? 'indústria' : 'indústrias'}
                </span>
              }
            />
          </section>

          {/* MODAL VER DETALHES (PADRÃO VISUAL ARTCRAFT) */}
          {viewingItem && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5">
                <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-purple-100 border border-purple-200 text-purple-700 flex items-center justify-center">
                      <span className="material-symbols-outlined text-[18px]">factory</span>
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-[#171717] font-mono">
                        Detalhes do Cadastro da Indústria
                      </h3>
                      <span className="text-[10px] text-[#77766F] font-mono">
                        Registro formal no catálogo corporativo
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setViewingItem(null)}
                    className="text-[#77766F] hover:text-[#171717] p-1 rounded-md cursor-pointer"
                    aria-label="Fechar modal de detalhes"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
                  <div className="p-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl space-y-1">
                    <span className="text-[#5F5F5F] block text-[10px] uppercase font-bold">Código Interno</span>
                    <span className="text-purple-700 font-bold text-sm block">{viewingItem.codigo}</span>
                  </div>

                  <div className="p-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl space-y-1">
                    <span className="text-[#5F5F5F] block text-[10px] uppercase font-bold">Status Operacional</span>
                    <div className="pt-0.5">
                      <StatusBadge
                        status={viewingItem.status === 'ativo' ? 'ativo' : 'inativo'}
                        label={viewingItem.status.toUpperCase()}
                        variant={viewingItem.status === 'ativo' ? 'ativo' : 'inativo'}
                      />
                    </div>
                  </div>

                  <div className="sm:col-span-2 p-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl space-y-1">
                    <span className="text-[#5F5F5F] block text-[10px] uppercase font-bold">Nome / Razão Social</span>
                    <span className="text-[#171717] font-bold text-sm block">{viewingItem.nome}</span>
                  </div>

                  <div className="p-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl space-y-1">
                    <span className="text-[#5F5F5F] block text-[10px] uppercase font-bold">CNPJ</span>
                    <span className="text-[#171717] font-semibold">{viewingItem.cnpj || 'Não informado'}</span>
                  </div>

                  <div className="p-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl space-y-1">
                    <span className="text-[#5F5F5F] block text-[10px] uppercase font-bold">Início da Operação (Comercial)</span>
                    <span className="text-[#171717] font-semibold">
                      {viewingItem.data_inicio_operacao ? viewingItem.data_inicio_operacao.slice(0, 10) : 'Não informado'}
                    </span>
                  </div>

                  <div className="sm:col-span-2 p-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[#5F5F5F] block text-[10px] uppercase font-bold">Grupo de WhatsApp</span>
                      {viewingItem.whatsapp_group_link && isValidWhatsAppGroupLink(viewingItem.whatsapp_group_link) && (
                        <button
                          type="button"
                          onClick={() => openIndustryWhatsAppGroup(viewingItem.whatsapp_group_link)}
                          className="text-[11px] text-emerald-700 hover:text-emerald-800 font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                          <span>Abrir Convite</span>
                        </button>
                      )}
                    </div>
                    <span className="text-[#171717] font-mono text-[11px] block break-all">
                      {viewingItem.whatsapp_group_link || 'Nenhum link cadastrado para esta indústria.'}
                    </span>
                  </div>

                  <div className="sm:col-span-2 p-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl space-y-1">
                    <span className="text-[#5F5F5F] block text-[10px] uppercase font-bold">Observações / Anotações Gerais</span>
                    <p className="text-[#171717] whitespace-pre-wrap leading-relaxed text-[11px]">
                      {viewingItem.observacao || 'Nenhuma observação cadastrada para esta indústria.'}
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-[#CFCDC5] flex items-center justify-between">
                  <span className="text-[10px] text-[#77766F] font-mono">
                    MK9 Date • Gestão de Indústrias
                  </span>
                  <div className="flex items-center gap-2">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => {
                          const itemToEdit = viewingItem;
                          setViewingItem(null);
                          handleOpenEdit(itemToEdit);
                        }}
                        className="px-4 py-2 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[15px]">edit</span>
                        <span>Editar</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setViewingItem(null)}
                      className="px-4 py-2 rounded-xl bg-[#EAE8E2] hover:bg-[#DFDDD6] text-[#171717] border border-[#CFCDC5] text-xs font-semibold cursor-pointer"
                    >
                      Fechar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* ABA 3: PRÉ-VISUALIZAÇÃO ADMINISTRATIVA DE CONTRATOS E CICLOS (ETAPA E)     */}
      {/* SOMENTE LEITURA: Projeta contratos a partir de rotas com períodos calculados*/}
      {/* ========================================================================= */}
      {activeTab === 'contratos' && (
        <div className="space-y-8 animate-fadeIn">
          {/* BANNER INFORMATIVO DE AUDITORIA (SOMENTE LEITURA) */}
          <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-2xl flex items-start gap-3.5">
            <span className="material-symbols-outlined text-purple-400 text-2xl mt-0.5">info</span>
            <div className="space-y-1">
              <h4 className="text-xs font-bold text-purple-300 font-mono uppercase tracking-wider">
                Auditoria e Pré-Visualização de Contratos (Somente Leitura)
              </h4>
              <p className="text-xs text-[#77766F] leading-relaxed">
                Esta área projeta em memória os contratos elegíveis a partir da malha de rotas ativas, calculando
                o período contratual conforme as regras comerciais homologadas. <strong>Nenhum contrato é gravado ou alterado automaticamente.</strong>
              </p>
            </div>
          </div>

          {/* BARRA DE CONTROLE: DATA DE REFERÊNCIA E FILTROS */}
          <section className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-3">
              <div className="flex items-center gap-2 text-xs font-mono font-bold text-[#171717]">
                <span className="material-symbols-outlined text-purple-400 text-[18px]">tune</span>
                <span>PARÂMETROS DE AUDITORIA</span>
              </div>
              <button
                onClick={fetchFrequencyData}
                disabled={freqLoading}
                className="px-3 py-1.5 rounded-lg bg-[#EAE8E2] border border-[#CFCDC5] text-xs font-semibold text-[#171717] hover:text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <span className={`material-symbols-outlined text-[16px] ${freqLoading ? 'animate-spin' : ''}`}>
                  refresh
                </span>
                <span>Recarregar Rotas</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* DATA DE REFERÊNCIA PARA CÁLCULO */}
              <div>
                <label className="text-[11px] font-mono font-bold text-[#77766F] block mb-1.5 uppercase">
                  Data de Referência (YYYY-MM-DD)
                </label>
                <input
                  type="date"
                  value={contratosRefDate}
                  onChange={(e) => setContratosRefDate(e.target.value)}
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-xs text-[#171717] focus:outline-none focus:border-purple-500 font-mono"
                />
              </div>

              {/* FILTRO INDÚSTRIA */}
              <div>
                <label className="text-[11px] font-mono font-bold text-[#77766F] block mb-1.5 uppercase">
                  Filtrar por Indústria
                </label>
                <select
                  value={selectedIndustria}
                  onChange={(e) => setSelectedIndustria(e.target.value)}
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-xs text-[#171717] focus:outline-none focus:border-purple-500 font-mono"
                >
                  <option value="todas">Todas as Indústrias ({industries.length})</option>
                  {industries.map((ind) => (
                    <option key={ind.id} value={ind.codigo}>
                      {ind.nome} ({ind.codigo})
                    </option>
                  ))}
                </select>
              </div>

              {/* FILTRO LOJA */}
              <div>
                <label className="text-[11px] font-mono font-bold text-[#77766F] block mb-1.5 uppercase">
                  Filtrar por Loja / PDV
                </label>
                <select
                  value={selectedLoja}
                  onChange={(e) => setSelectedLoja(e.target.value)}
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-xs text-[#171717] focus:outline-none focus:border-purple-500 font-mono"
                >
                  <option value="todas">Todas as Lojas ({lojasList.length})</option>
                  {lojasList.map((st) => (
                    <option key={st.id} value={st.codigo}>
                      {st.nome} ({st.codigo})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* BANNER DE ERRO DE CONSULTA DE CONTRATOS (SE HOUVER) */}
          {contratosError && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-start gap-3.5">
              <span className="material-symbols-outlined text-rose-400 text-2xl mt-0.5">error</span>
              <div className="space-y-1">
                <h4 className="text-xs font-bold text-rose-300 font-mono uppercase tracking-wider">
                  Aviso: Falha ao Consultar Contratos Existentes
                </h4>
                <p className="text-xs text-rose-200 leading-relaxed">
                  {contratosError}
                  <br />
                  <strong>Por segurança, a elegibilidade de todos os registros está preventivamente bloqueada até a normalização da consulta.</strong>
                </p>
              </div>
            </div>
          )}

          {/* CARDS RESUMO PADRONIZADOS COM STATCARD */}
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
            <StatCard
              title="PARES ANALISADOS"
              value={contratosPreviewData.totalParesAnalisados}
              icon="compare_arrows"
              variant="default"
              description="Total de pares indústria/loja"
            />
            <StatCard
              title="APTOS P/ FORMALIZAR"
              value={contratosPreviewData.totalElegiveisAptos}
              icon="verified"
              variant="success"
              description="Sem contrato e com dados OK"
            />
            <StatCard
              title="JÁ CONTRATADOS (ATIVOS)"
              value={contratosPreviewData.totalJaComContratoAtivo}
              icon="lock"
              variant="info"
              description="Contrato ativo em vigência"
            />
            <StatCard
              title="CONTRATOS SUSPENSOS"
              value={contratosPreviewData.totalJaComContratoSuspenso}
              icon="pause_circle"
              variant="warning"
              description="Exige revisão operacional"
            />
            <StatCard
              title="INÍCIO NÃO INFORMADO"
              value={contratosPreviewData.totalInicioNaoInformado}
              icon="warning"
              variant="danger"
              description="Indústria sem início cadastrado"
            />
          </div>

          {/* TABELA 1: CONTRATOS PROJETADOS / ELEGÍVEIS COM DATATABLE */}
          <DataTable<ContratoItemElegivel>
            title="Projeção de Contratos Elegíveis"
            titleIcon="assignment_turned_in"
            badgeCount={contratosPreviewData.elegiveis.length}
            data={contratosPreviewData.elegiveis}
            columns={contratosColumns}
            keyExtractor={(c, idx) => `${c.industria_codigo}_${c.loja_codigo}_${idx}`}
            loading={freqLoading || contratosLoading}
            loadingMessage="Calculando projeções e auditando contratos..."
            emptyTitle="Nenhum par elegível encontrado"
            emptyMessage="Nenhum par (indústria, loja) com rotas ativas encontrado para os filtros selecionados."
            searchPlaceholder="Buscar por indústria, loja, código..."
            searchFilter={(c, query) =>
              Boolean(
                c.industriaNome.toLowerCase().includes(query) ||
                c.industria_codigo.toLowerCase().includes(query) ||
                c.lojaInfo.nome.toLowerCase().includes(query) ||
                c.loja_codigo.toLowerCase().includes(query) ||
                c.frequencia.toLowerCase().includes(query) ||
                (c.projecao_periodo?.competencia && c.projecao_periodo.competencia.toLowerCase().includes(query))
              )
            }
            defaultPageSize={10}
            headerActions={
              <span className="text-[11px] font-mono text-[#737373] bg-[#EAE8E2] px-2.5 py-1 rounded-md border border-[#CFCDC5]">
                Ref: {contratosRefDate}
              </span>
            }
          />

          {/* TABELA 2: ROTAS CONFLITANTES / NÃO ELEGÍVEIS */}
          {contratosPreviewData.conflitos.length > 0 && (
            <section className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-amber-900 uppercase tracking-wider font-mono flex items-center gap-2">
                  <span className="material-symbols-outlined text-amber-600">report_problem</span>
                  Conflitos Detectados nas Rotas ({contratosPreviewData.conflitos.length})
                </h3>
                <span className="text-[11px] font-mono font-bold text-amber-800 bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20">
                  Bloqueados para Geração Contratual
                </span>
              </div>

              <div className="overflow-x-auto rounded-xl border border-[#CFCDC5]">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#E3E1DA] border-b border-[#CFCDC5] text-[11px] font-bold text-[#171717] uppercase tracking-wider font-mono">
                      <th className="py-3 px-3">Indústria</th>
                      <th className="py-3 px-3">Loja / PDV</th>
                      <th className="py-3 px-3 text-center">Total de Rotas</th>
                      <th className="py-3 px-3">Frequências Divergentes</th>
                      <th className="py-3 px-3">Motivo do Bloqueio</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#CFCDC5] text-[#171717] font-mono">
                    {contratosPreviewData.conflitos.map((conf, cIdx) => (
                      <tr key={`conf_${conf.industria_codigo}_${conf.loja_codigo}_${cIdx}`} className="hover:bg-[#EAE8E2] transition-colors">
                        <td className="py-3 px-3 font-bold text-[#171717]">
                          {conf.industriaNome} <span className="text-purple-700 font-bold font-mono">({conf.industria_codigo})</span>
                        </td>
                        <td className="py-3 px-3 text-[#171717]">
                          {conf.lojaInfo.nome} <span className="text-[#5F5F5F] font-mono text-[10px]">({conf.loja_codigo})</span>
                        </td>
                        <td className="py-3 px-3 text-amber-800 font-bold text-center">{conf.totalRotas}</td>
                        <td className="py-3 px-3">
                          <div className="flex gap-1.5 flex-wrap">
                            {conf.frequenciasEncontradas.map((f) => (
                              <span key={f} className="px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">
                                {f}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-[#5F5F5F] text-[11px]">
                          {conf.motivo}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
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
                <span className="material-symbols-outlined text-purple-400">
                  {editingItem ? 'edit' : 'add'}
                </span>
                {editingItem ? 'Editar Indústria' : 'Nova Indústria'}
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-[#77766F] hover:text-white"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4 text-xs font-mono">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[#171717]">CÓDIGO DA INDÚSTRIA (*)</label>
                  {!editingItem && (
                    <span className="text-[10px] text-purple-400 font-mono">
                      (Gerado automaticamente se mantido)
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  required
                  value={formData.codigo}
                  onChange={(e) => setFormData({ ...formData, codigo: e.target.value.toUpperCase() })}
                  placeholder="Ex: IND-001"
                  disabled={Boolean(editingItem)}
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-purple-500 disabled:opacity-50 font-mono uppercase"
                />
              </div>

              <div>
                <label className="text-[#171717] block mb-1">NOME / RAZÃO SOCIAL (*)</label>
                <input
                  type="text"
                  required
                  value={formData.nome}
                  onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                  placeholder="Ex: Nestle Brasil Ltda"
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="text-[#171717] block mb-1">CNPJ (OPCIONAL)</label>
                <input
                  type="text"
                  value={formData.cnpj}
                  onChange={(e) => setFormData({ ...formData, cnpj: e.target.value })}
                  placeholder="Ex: 12345678000195"
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="text-[#171717] block mb-1">STATUS</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-purple-500"
                >
                  <option value="ativo">ATIVO</option>
                  <option value="inativo">INATIVO</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[#171717]">INÍCIO DA OPERAÇÃO (COMERCIAL)</label>
                  <span className="text-[10px] text-[#77766F] font-mono">
                    (Opcional - define ciclo pro-rata)
                  </span>
                </div>
                <input
                  type="date"
                  value={formData.data_inicio_operacao}
                  onChange={(e) => setFormData({ ...formData, data_inicio_operacao: e.target.value })}
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-purple-500 font-mono"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[#171717]">LINK DO GRUPO DE WHATSAPP</label>
                  <span className="text-[10px] text-[#77766F] font-mono">
                    (Opcional - Somente convite oficial)
                  </span>
                </div>
                <input
                  type="url"
                  value={formData.whatsapp_group_link}
                  onChange={(e) => setFormData({ ...formData, whatsapp_group_link: e.target.value })}
                  placeholder="https://chat.whatsapp.com/..."
                  className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-purple-500 font-mono text-xs"
                />
                <p className="text-[10px] text-[#77766F] mt-1 font-mono">
                  Aceita estritamente: <code>https://chat.whatsapp.com/...</code>. Rejeita <code>wa.me</code> e outros domínios.
                </p>
              </div>

              <div>
                <label className="text-[#171717] block mb-1">OBSERVAÇÕES</label>
                <textarea
                  value={formData.observacao}
                  onChange={(e) => setFormData({ ...formData, observacao: e.target.value })}
                  placeholder="Anotações gerais..."
                  className="w-full p-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-purple-500 h-20 resize-none"
                />
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
                className="px-5 py-2 rounded-xl bg-[#222222] hover:bg-black text-white font-bold text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
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

      {/* MODAL DE REVISÃO E AUTORIZAÇÃO INDIVIDUAL DE CONTRATO (ETAPA H3.5) */}
      {/* ATENÇÃO: NENHUMA gravação no banco é executada nesta etapa (somente prototipação e validação local) */}
      {reviewingContrato && canEdit && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            {/* Cabeçalho */}
            <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#171717] font-mono flex items-center gap-2">
                  <span className="material-symbols-outlined text-amber-500">verified</span>
                  Revisão e Autorização Individual de Contrato
                </h3>
                <span className="text-[11px] text-[#77766F] font-mono block mt-0.5">
                  Prototipação comercial para validação antes de emissão
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setReviewingContrato(null);
                  setSimulatedPayload(null);
                }}
                className="text-[#77766F] hover:text-[#171717] p-1 rounded-lg"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Aviso de Modo Seguro / Prototipação */}
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-start gap-2.5">
              <span className="material-symbols-outlined text-amber-500 text-lg shrink-0 mt-0.5">info</span>
              <div className="text-xs font-mono text-amber-800 space-y-1">
                <p className="font-bold">MODO DE PROTOTIPAÇÃO E VALIDAÇÃO ATIVO</p>
                <p className="text-[11px] leading-relaxed text-amber-900/80">
                  Nenhum registro será criado ou alterado no Supabase. O objetivo deste formulário é validar os parâmetros comerciais (valor por visita, término da vigência e ciclo calculado) antes da formalização.
                </p>
              </div>
            </div>

            {/* Dados do Par (Indústria e Loja) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl p-4 text-xs font-mono">
              <div>
                <span className="text-[#5F5F5F] block text-[10px] uppercase">Indústria:</span>
                <span className="text-[#171717] font-bold text-sm block">
                  {reviewingContrato.industriaNome}
                </span>
                <span className="text-purple-600 font-bold text-[11px]">
                  {reviewingContrato.industria_codigo}
                  {reviewingContrato.industria_codigo === 'IND-013' && ' ★ (KING - Ciclo 23 a 22)'}
                </span>
              </div>
              <div>
                <span className="text-[#5F5F5F] block text-[10px] uppercase">Loja / PDV:</span>
                <span className="text-[#171717] font-bold text-sm block">
                  {reviewingContrato.lojaInfo.nome}
                </span>
                <span className="text-[#77766F] text-[11px] block">
                  {reviewingContrato.loja_codigo}
                  {reviewingContrato.lojaInfo.cidade ? ` • ${reviewingContrato.lojaInfo.cidade}/${reviewingContrato.lojaInfo.uf}` : ''}
                </span>
              </div>
            </div>

            {/* Frequência e Dias de Visita Operacionais */}
            <div className="space-y-2 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl p-4 text-xs font-mono">
              <div className="flex items-center justify-between">
                <span className="text-[#5F5F5F] text-[10px] uppercase font-bold">Frequência Operacional:</span>
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-500/10 text-blue-700 border border-blue-500/30">
                  {reviewingContrato.frequencia}
                  {reviewingContrato.visitas_por_semana ? ` (${reviewingContrato.visitas_por_semana}x/sem)` : ''}
                </span>
              </div>
              <div>
                <span className="text-[#5F5F5F] block text-[10px] uppercase mb-1">Dias de Visita na Semana:</span>
                <div className="flex gap-1.5">
                  {['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'].map((d, dIdx) => {
                    const labels = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
                    const shortLabels = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
                    const active = Boolean(reviewingContrato[d as keyof typeof reviewingContrato]);
                    return (
                      <span
                        key={d}
                        title={`${labels[dIdx]}: ${active ? 'Com visita' : 'Sem visita'}`}
                        className={`px-2 py-1 rounded text-[11px] font-bold flex items-center justify-center border ${
                          active
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-[#F7F6F2] text-[#77766F] border-[#CFCDC5]'
                        }`}
                      >
                        {shortLabels[dIdx]}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Início Operacional e Período de Apuração */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl p-4 text-xs font-mono">
              <div>
                <span className="text-[#5F5F5F] block text-[10px] uppercase">Início Operacional Informado:</span>
                <span className="text-[#171717] font-bold">
                  {reviewingContrato.dataCadastro || 'Não cadastrado'}
                </span>
              </div>
              <div>
                <span className="text-[#5F5F5F] block text-[10px] uppercase">Período de Apuração Projetado:</span>
                {reviewingContrato.projecao_periodo ? (
                  <div>
                    <span className="text-[#171717] font-bold block">
                      {reviewingContrato.projecao_periodo.data_inicio} até {reviewingContrato.projecao_periodo.data_fim}
                    </span>
                    <span className="text-[10px] text-amber-700 font-semibold block">
                      Competência: {reviewingContrato.projecao_periodo.competencia} ({reviewingContrato.projecao_periodo.tipo_ciclo})
                    </span>
                  </div>
                ) : (
                  <span className="text-rose-600 italic">Indisponível</span>
                )}
              </div>
            </div>

            {/* Formulário Comercial de Revisão */}
            <div className="space-y-4 pt-2">
              <h4 className="text-xs font-bold text-[#171717] font-mono uppercase tracking-wider">
                Definições Contratuais Obrigatórias
              </h4>

              {/* 1. Valor por Visita (OBRIGATÓRIO) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-mono font-bold text-[#171717]">
                    VALOR POR VISITA (R$) *
                  </label>
                  <span className="text-[10px] text-[#77766F] font-mono">
                    Não inferido das rotas (preenchimento mandatório)
                  </span>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs font-mono font-bold text-[#5F5F5F]">R$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0,00"
                    value={revisaoForm.valor_por_visita}
                    onChange={(e) => {
                      setRevisaoForm({ ...revisaoForm, valor_por_visita: e.target.value });
                      if (revisaoErrors.valor) setRevisaoErrors({ ...revisaoErrors, valor: undefined });
                    }}
                    className={`w-full h-10 pl-10 pr-3 bg-white border rounded-xl text-[#171717] font-mono text-sm focus:outline-none focus:border-purple-600 ${
                      revisaoErrors.valor ? 'border-rose-500' : 'border-[#CFCDC5]'
                    }`}
                  />
                </div>
                {revisaoErrors.valor && (
                  <span className="text-[11px] text-rose-600 font-mono block mt-1">
                    {revisaoErrors.valor}
                  </span>
                )}
              </div>

              {/* 2. Vigência Comercial (Contínua vs Determinada) */}
              <div>
                <label className="text-xs font-mono font-bold text-[#171717] block mb-1">
                  TIPO DE VIGÊNCIA COMERCIAL *
                </label>
                <div className="grid grid-cols-2 gap-3 font-mono text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setRevisaoForm({ ...revisaoForm, tipo_vigencia: 'continua', data_fim_vigencia: '' });
                      if (revisaoErrors.data_fim) setRevisaoErrors({ ...revisaoErrors, data_fim: undefined });
                    }}
                    className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition-all cursor-pointer ${
                      revisaoForm.tipo_vigencia === 'continua'
                        ? 'bg-purple-50 border-purple-600 text-purple-900 font-bold shadow-sm'
                        : 'bg-white border-[#CFCDC5] text-[#5F5F5F] hover:bg-[#EAE8E2]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm">all_inclusive</span>
                      <span>Contrato Contínuo</span>
                    </div>
                    <span className="text-[10px] text-[#77766F] font-normal">
                      Vigência por prazo indeterminado (data fim = nula)
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setRevisaoForm({ ...revisaoForm, tipo_vigencia: 'determinada' });
                    }}
                    className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition-all cursor-pointer ${
                      revisaoForm.tipo_vigencia === 'determinada'
                        ? 'bg-purple-50 border-purple-600 text-purple-900 font-bold shadow-sm'
                        : 'bg-white border-[#CFCDC5] text-[#5F5F5F] hover:bg-[#EAE8E2]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm">event</span>
                      <span>Prazo Determinado</span>
                    </div>
                    <span className="text-[10px] text-[#77766F] font-normal">
                      Com data final de vigência estipulada
                    </span>
                  </button>
                </div>
              </div>

              {/* Data Final de Vigência (se determinada) */}
              {revisaoForm.tipo_vigencia === 'determinada' && (
                <div className="p-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl space-y-1">
                  <label className="text-xs font-mono font-bold text-[#171717] block">
                    DATA FINAL DA VIGÊNCIA COMERCIAL *
                  </label>
                  <input
                    type="date"
                    value={revisaoForm.data_fim_vigencia}
                    onChange={(e) => {
                      setRevisaoForm({ ...revisaoForm, data_fim_vigencia: e.target.value });
                      if (revisaoErrors.data_fim) setRevisaoErrors({ ...revisaoErrors, data_fim: undefined });
                    }}
                    className={`w-full h-10 px-3 bg-white border rounded-xl text-[#171717] font-mono text-sm focus:outline-none focus:border-purple-600 ${
                      revisaoErrors.data_fim ? 'border-rose-500' : 'border-[#CFCDC5]'
                    }`}
                  />
                  {revisaoErrors.data_fim ? (
                    <span className="text-[11px] text-rose-600 font-mono block">
                      {revisaoErrors.data_fim}
                    </span>
                  ) : (
                    <span className="text-[10px] text-[#77766F] font-mono block">
                      A data de término deve ser posterior ou igual ao início da vigência ({reviewingContrato.dataCadastro || contratosRefDate}).
                    </span>
                  )}
                </div>
              )}

              {/* Observações Contratuais */}
              <div>
                <label className="text-xs font-mono font-bold text-[#171717] block mb-1">
                  OBSERVAÇÕES DO CONTRATO
                </label>
                <textarea
                  value={revisaoForm.observacao}
                  onChange={(e) => setRevisaoForm({ ...revisaoForm, observacao: e.target.value })}
                  placeholder="Informações adicionais ou justificativas comerciais..."
                  className="w-full p-3 bg-white border border-[#CFCDC5] rounded-xl text-[#171717] font-mono text-xs focus:outline-none focus:border-purple-600 h-16 resize-none"
                />
              </div>
            </div>

            {/* Simulação do Payload Validado (Sem Gravação) */}
            {simulatedPayload && (
              <div className="bg-emerald-50 border border-emerald-500/40 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-emerald-800 text-xs font-mono font-bold">
                  <span className="material-symbols-outlined text-sm text-emerald-600">task_alt</span>
                  <span>Payload Validado com Sucesso (100% Compatível com o Banco)</span>
                </div>
                <p className="text-[11px] text-emerald-900/80 font-mono">
                  O objeto abaixo é exatamente o payload sanitizado que será enviado ao Supabase por <code className="font-bold">prepareContratoInsertData()</code>, contendo apenas colunas existentes na tabela <code className="font-bold">contratos_lojas</code>:
                </p>
                <div className="space-y-1">
                  <span className="text-[10px] text-emerald-800 font-mono font-bold block uppercase">
                    Payload Real para o Supabase (public.contratos_lojas):
                  </span>
                  <pre className="p-3 bg-white border border-emerald-200 rounded-lg text-[10px] font-mono text-[#171717] overflow-x-auto max-h-40">
                    {JSON.stringify(simulatedPayload.databasePayload, null, 2)}
                  </pre>
                </div>
                <div className="p-2.5 bg-emerald-100/60 border border-emerald-300 rounded-lg text-[10px] font-mono text-emerald-900 space-y-1">
                  <span className="font-bold block uppercase">Metadados de Simulação e Auditoria:</span>
                  <p>• Indústria KING: {simulatedPayload.metadata.isKing ? 'Sim (Ciclo 23 a 22)' : 'Não (Calendário Regular)'}</p>
                  <p>• Tipo de Vigência Comercial: {simulatedPayload.metadata.tipo_vigencia === 'continua' ? 'Contínua (Indeterminada)' : 'Determinada'}</p>
                  <p>• Ciclo de Apuração Calculado: {simulatedPayload.metadata.ciclo_apuracao ? `${simulatedPayload.metadata.ciclo_apuracao.data_inicio} até ${simulatedPayload.metadata.ciclo_apuracao.data_fim} (Competência: ${simulatedPayload.metadata.ciclo_apuracao.competencia})` : 'Não aplicável'}</p>
                  <p className="font-bold text-emerald-950">✓ {simulatedPayload.metadata.aviso}</p>
                </div>
              </div>
            )}

            {/* Rodapé / Ações */}
            <div className="pt-3 border-t border-[#CFCDC5] flex items-center justify-between">
              <span className="text-[10px] text-[#77766F] font-mono">
                MK9 Date • Autorização Individual de Contratos
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={savingContrato}
                  onClick={() => {
                    setReviewingContrato(null);
                    setSimulatedPayload(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-[#EAE8E2] hover:bg-[#E4E2DB] text-[#171717] border border-[#CFCDC5] text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={savingContrato}
                  onClick={async () => {
                    // Validação estrita dos campos do formulário
                    const errors: { valor?: string; data_fim?: string } = {};

                    const valorNum = parseFloat(revisaoForm.valor_por_visita);
                    if (isNaN(valorNum) || valorNum <= 0) {
                      errors.valor = 'Informe um valor por visita válido e maior que zero (R$).';
                    }

                    const dataInicio = reviewingContrato.dataCadastro || contratosRefDate;

                    if (revisaoForm.tipo_vigencia === 'determinada') {
                      if (!revisaoForm.data_fim_vigencia) {
                        errors.data_fim = 'A data final da vigência é obrigatória para contratos de prazo determinado.';
                      } else {
                        try {
                          parseISODate(revisaoForm.data_fim_vigencia);
                          if (revisaoForm.data_fim_vigencia < dataInicio) {
                            errors.data_fim = `A data final (${revisaoForm.data_fim_vigencia}) não pode ser anterior ao início da vigência (${dataInicio}).`;
                          }
                        } catch (err: any) {
                          errors.data_fim = err.message || 'Data final inválida.';
                        }
                      }
                    }

                    if (Object.keys(errors).length > 0) {
                      setRevisaoErrors(errors);
                      setSimulatedPayload(null);
                      return;
                    }

                    setRevisaoErrors({});
                    setSavingContrato(true);

                    try {
                      // Construir o DTO formal para criação de contrato
                      const payloadDTO: CreateContratoLojaDTO = {
                        industria_codigo: reviewingContrato.industria_codigo,
                        loja_codigo: reviewingContrato.loja_codigo,
                        frequencia: reviewingContrato.frequencia,
                        visitas_por_semana: reviewingContrato.visitas_por_semana || undefined,
                        segunda: reviewingContrato.segunda,
                        terca: reviewingContrato.terca,
                        quarta: reviewingContrato.quarta,
                        quinta: reviewingContrato.quinta,
                        sexta: reviewingContrato.sexta,
                        sabado: reviewingContrato.sabado,
                        domingo: reviewingContrato.domingo,
                        data_inicio_vigencia: dataInicio,
                        data_fim_vigencia: revisaoForm.tipo_vigencia === 'continua' ? null : revisaoForm.data_fim_vigencia,
                        valor_por_visita: valorNum,
                        observacao: revisaoForm.observacao.trim() || null,
                        status: 'ativo'
                      };

                      const { data: novoContrato, error: createErr, isMigrationPending } = await contratosService.createContrato(payloadDTO);

                      if (createErr) {
                        if (isMigrationPending) {
                          onShowToast({
                            title: 'Migração Pendente',
                            message: 'A tabela de contratos ainda não está disponível no banco de dados.',
                            type: 'error'
                          });
                        } else {
                          // Tratar mensagens amigáveis para sobreposição e violação de regras
                          const msg = createErr.message || 'Falha ao registrar o contrato no banco de dados.';
                          onShowToast({
                            title: 'Erro ao Formalizar Contrato',
                            message: msg,
                            type: 'error'
                          });
                        }
                        return;
                      }

                      onShowToast({
                        title: 'Contrato Formalizado',
                        message: `Contrato entre ${reviewingContrato.industriaNome} e ${reviewingContrato.lojaInfo?.nome || reviewingContrato.loja_codigo} criado com sucesso.`,
                        type: 'success'
                      });

                      // Fechar modal e recarregar contratos para atualizar a grade e classificações
                      setReviewingContrato(null);
                      setSimulatedPayload(null);
                      fetchContratos();
                    } catch (err: any) {
                      console.error('Erro ao salvar contrato:', err);
                      onShowToast({
                        title: 'Erro Inesperado',
                        message: err.message || 'Ocorreu uma falha ao tentar salvar o contrato.',
                        type: 'error'
                      });
                    } finally {
                      setSavingContrato(false);
                    }
                  }}
                  className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs flex items-center gap-2 cursor-pointer shadow-md hover:shadow-lg disabled:opacity-50"
                >
                  <span className={`material-symbols-outlined text-sm ${savingContrato ? 'animate-spin' : ''}`}>
                    {savingContrato ? 'progress_activity' : 'verified'}
                  </span>
                  <span>{savingContrato ? 'Gravando Contrato...' : 'Autorizar e Gravar Contrato'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
