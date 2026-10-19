import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import type { RouteItem, Visit, ToastMessage, PromoterOperationAuthorization } from '../types';
import { fetchSystemSettings } from '../lib/systemSettings';
import {
  calculateOperationalVisits,
  getWeekDaysRange,
  getLocalDateString,
  DayOfWeekDate,
  OperationalVisitItem
} from '../utils/routePlanner';
import {
  buildChecklistSyncPlan,
  CHECKLIST_GROUPS,
  CHECKLIST_QUANTITY_KEYS,
  createChecklistState,
  DEFAULT_CHECKLIST_ITEMS,
  findInvalidChecklistQuantity,
  isSupportedVisitPhoto,
  isWithinVisitPhotoLimit
} from '../utils/visitExecution';
import { SearchableSelect } from '../components/SearchableSelect';
import { AuthorSignature } from '../components/AuthorSignature';

interface PromoterPortalViewProps {
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const PromoterPortalView: React.FC<PromoterPortalViewProps> = ({ onShowToast }) => {
  const { profile, role } = useAuth();
  const isAdminUser = role === 'admin' || role === 'gestor' || role === 'operador';

  // Para promotor de campo, usa estritamente a matrícula do perfil
  // Para administrador/gestor/operador, permite selecionar um promotor para consulta
  const [selectedPromoterMatricula, setSelectedPromoterMatricula] = useState<string>('');
  const [adminPromotersList, setAdminPromotersList] = useState<Array<{ matricula: string; nome: string; cidade?: string; uf?: string; supervisor?: string; equipe?: string }>>([]);

  const promotorMatricula = isAdminUser 
    ? (selectedPromoterMatricula || null)
    : profile?.promotor_matricula;

  const [loading, setLoading] = useState(true);
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [todayVisits, setTodayVisits] = useState<Visit[]>([]);
  const [activeVisit, setActiveVisit] = useState<Visit | null>(null);

  // Estado de Autorização do Promotor (Etapa 4.1)
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);
  const [authRecord, setAuthRecord] = useState<PromoterOperationAuthorization | null>(null);
  const [isImplantacaoMode, setIsImplantacaoMode] = useState<boolean>(true);

  // Visitas anteriores à data atual que não foram concluídas (Pendências de dias anteriores)
  const [startingRouteId, setStartingRouteId] = useState<string | null>(null);
  const [staleInProgressVisits, setStaleInProgressVisits] = useState<Visit[]>([]);
  const [staleNotDoneVisits, setStaleNotDoneVisits] = useState<Visit[]>([]);
  const [staleNotDoneVisit, setStaleNotDoneVisit] = useState<Visit | null>(null);
  const [staleNotDoneReason, setStaleNotDoneReason] = useState<string>('');
  const [savingStaleNotDone, setSavingStaleNotDone] = useState<boolean>(false);

  // Estado para Interrupção / Cancelamento de Atendimento em Andamento (Requisito 3)
  const [interruptModalVisit, setInterruptModalVisit] = useState<Visit | null>(null);
  const [interruptReason, setInterruptReason] = useState<string>('');
  const [savingInterrupt, setSavingInterrupt] = useState<boolean>(false);

  // Estado para conflito de atendimento ativo ao tentar iniciar outra loja (Etapa 1)
  const [busyConflictTargetRoute, setBusyConflictTargetRoute] = useState<RouteItem | null>(null);

  // Estado para Recuperação de Visita Não Realizada / Pendente ("Realizar hoje" - Etapa 2)
  const [recoverModalVisit, setRecoverModalVisit] = useState<Visit | null>(null);
  const [recoveringVisit, setRecoveringVisit] = useState<boolean>(false);

  // Controle de colapso do Histórico da Semana (Fechado por padrão no mobile)
  const [isWeekHistoryOpen, setIsWeekHistoryOpen] = useState<boolean>(false);

  // Estado para Agenda Semanal "MINHA SEMANA" (Etapa 7.2)
  const [weekOffset, setWeekOffset] = useState<number>(0);
  const [weekVisits, setWeekVisits] = useState<Visit[]>([]);
  const [selectedDayDateStr, setSelectedDayDateStr] = useState<string>(getLocalDateString(new Date()));
  const [weekHistoryFilterMode, setWeekHistoryFilterMode] = useState<'day' | 'all'>('day');

  // Visualização da Escala Fixa Semanal e Modal de Edição (Item 3 e 4)
  const [scaleViewMode, setScaleViewMode] = useState<'semana' | 'dia'>('semana');
  const [selectedScaleDayKey, setSelectedScaleDayKey] = useState<string>('segunda');
  const [editingScaleRoute, setEditingScaleRoute] = useState<RouteItem | null>(null);
  const [savingScaleRoute, setSavingScaleRoute] = useState<boolean>(false);

  // Form State para Visita em Andamento
  const [checklist, setChecklist] = useState<
    Record<string, { checked: boolean; answered: boolean; obs: string; valTxt: string }>
  >({});
  const [pendingChecklistWrites, setPendingChecklistWrites] = useState(0);
  const pendingChecklistWritesRef = useRef(0);
  const checklistWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [checklistSaveError, setChecklistSaveError] = useState<string | null>(null);
  const [photoType, setPhotoType] = useState<'fachada' | 'gondola' | 'preco' | 'ponto_extra' | 'ruptura' | 'outros'>('gondola');
  const [photoCaption, setPhotoCaption] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const uploadingPhotoRef = useRef(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [photoStatusMessage, setPhotoStatusMessage] = useState<string>('');
  const [occurrenceType, setOccurrenceType] = useState<'ruptura' | 'preco_divergente' | 'falta_espaco' | 'outro'>('ruptura');
  const [occurrenceDesc, setOccurrenceDesc] = useState('');
  const [savingOccurrence, setSavingOccurrence] = useState(false);

  // Form State para Validade de Produtos (Etapa 4)
  const [validityProdutoNome, setValidityProdutoNome] = useState('');
  const [validityQuantidade, setValidityQuantidade] = useState<number>(1);
  const [validityDataVencimento, setValidityDataVencimento] = useState('');
  const [validityLote, setValidityLote] = useState('');
  const [validityObservacao, setValidityObservacao] = useState('');
  const [savingValidity, setSavingValidity] = useState(false);

  // Estado para Modal de Consulta de Detalhes da Visita (Modo Administrativo)
  const [adminInspectionVisit, setAdminInspectionVisit] = useState<OperationalVisitItem | null>(null);
  const [adminSignedPhotoUrls, setAdminSignedPhotoUrls] = useState<Record<string, string>>({});
  const [loadingInspectionPhotos, setLoadingInspectionPhotos] = useState(false);
  const [adminZoomedPhoto, setAdminZoomedPhoto] = useState<string | null>(null);

  const [generalObs, setGeneralObs] = useState('');
  const [completingVisit, setCompletingVisit] = useState(false);
  const [notDoneReason, setNotDoneReason] = useState('');
  const [showNotDoneModal, setShowNotDoneModal] = useState<RouteItem | null>(null);

  const [promoterDetails, setPromoterDetails] = useState<{
    nome?: string;
    matricula?: string;
    cidade?: string;
    uf?: string;
    supervisor?: string;
    equipe?: string;
  } | null>(null);

  // Recarregar dados do portal do promotor
  const loadPortalData = useCallback(async () => {
    setLoading(true);
    if (!supabase) {
      setLoading(false);
      return;
    }

    try {
      const now = new Date();
      const todayStr = getLocalDateString(now);
      const dayIndex = now.getDay();
      const dayKeys = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
      const currentDayKey = dayKeys[dayIndex];

      // Para administradores, carregar a lista de todos os promotores cadastrados para seleção
      if (isAdminUser) {
        try {
          const { data: allPromoters } = await supabase
            .from('promotores')
            .select('matricula, nome, cidade, uf, supervisor, equipe')
            .order('nome', { ascending: true });
          if (allPromoters) {
            setAdminPromotersList(allPromoters);
          }
        } catch (pListErr) {
          console.warn('Erro ao listar promotores para admin:', pListErr);
        }
      }

      // Buscar cadastro do promotor em public.promotores usando profiles.promotor_matricula = promotores.matricula
      if (promotorMatricula) {
        try {
          const { data: pData, error: pErr } = await supabase
            .from('promotores')
            .select('matricula, nome, cidade, uf, supervisor, equipe')
            .eq('matricula', promotorMatricula)
            .maybeSingle();

          if (pErr) {
            console.error('Erro ao buscar cadastro em public.promotores:', pErr.message);
          } else if (pData) {
            setPromoterDetails({
              nome: pData.nome,
              matricula: pData.matricula,
              cidade: pData.cidade,
              uf: pData.uf,
              supervisor: pData.supervisor,
              equipe: pData.equipe
            });
          }
        } catch (err) {
          console.error('Erro na consulta do promotor:', err);
        }
      } else {
        setPromoterDetails(null);
      }

      const weekDays = getWeekDaysRange(new Date(), weekOffset);
      const weekStartStr = weekDays[0].dateStr;
      const weekEndStr = weekDays[6].dateStr;

      // Segurança por perfil: Administradores e Gestores podem visualizar rotas e visitas gerais para auditoria.
      // Usuários comuns ou promotores sem matrícula associada NÃO devem carregar visitas de terceiros.
      const isPrivilegedUser = profile?.role === 'admin' || profile?.role === 'gestor';

      let rotasQuery: any;
      let visitsQuery: any;
      let openVisitsQuery: any;

      if (promotorMatricula) {
        // Promotor autenticado com matrícula vinculada
        rotasQuery = supabase.from('rotas').select(`
          *,
          industria:industrias(codigo, nome),
          loja:lojas(codigo, nome, cidade, uf, endereco),
          promotor:promotores(matricula, nome)
        `).eq('promotor_matricula', promotorMatricula);

        visitsQuery = supabase.from('visits').select(`
          *,
          industria:industrias(codigo, nome),
          loja:lojas(codigo, nome, cidade, uf, endereco),
          promotor:promotores(matricula, nome),
          checklist_items:visit_checklist_items(*),
          photos:visit_photos(*),
          occurrences:visit_occurrences(*),
          validity_items:visit_product_validity(*)
        `).gte('data_visita', weekStartStr).lte('data_visita', weekEndStr).eq('promotor_matricula', promotorMatricula);

        // Buscar visitas anteriores a hoje que ainda não foram concluídas (em_andamento ou nao_realizada)
        openVisitsQuery = supabase.from('visits').select(`
          *,
          industria:industrias(codigo, nome),
          loja:lojas(codigo, nome, cidade, uf, endereco),
          promotor:promotores(matricula, nome),
          checklist_items:visit_checklist_items(*),
          photos:visit_photos(*),
          occurrences:visit_occurrences(*),
          validity_items:visit_product_validity(*)
        `).in('status', ['em_andamento', 'nao_realizada']).lt('data_visita', todayStr).eq('promotor_matricula', promotorMatricula);
      } else if (isPrivilegedUser) {
        // Usuário privilegiado (Admin/Gestor) que ainda não selecionou um promotor
        // Não carrega a agenda pessoal de todos misturada como se fosse de um promotor
        rotasQuery = Promise.resolve({ data: [], error: null });
        visitsQuery = Promise.resolve({ data: [], error: null });
        openVisitsQuery = Promise.resolve({ data: [], error: null });
      } else {
        // Usuário não privilegiado e sem matrícula vinculada: não carrega dados de outros promotores
        rotasQuery = Promise.resolve({ data: [], error: null });
        visitsQuery = Promise.resolve({ data: [], error: null });
        openVisitsQuery = Promise.resolve({ data: [], error: null });
      }

      // Consultar autorização e modo operacional
      let authQuery = promotorMatricula
        ? supabase.from('promoter_operation_authorizations').select('*').eq('promotor_matricula', promotorMatricula).maybeSingle()
        : Promise.resolve({ data: null, error: null });

      const [rotasRes, visitsRes, openVisitsRes, authRes, settings] = await Promise.all([
        rotasQuery,
        visitsQuery,
        openVisitsQuery,
        authQuery,
        fetchSystemSettings()
      ]);

      if (rotasRes.error) throw rotasRes.error;
      if (visitsRes.error) throw visitsRes.error;
      if (openVisitsRes && 'error' in openVisitsRes && openVisitsRes.error) throw openVisitsRes.error;

      const isImplantacao = settings.mode !== 'OPERACAO_OFICIAL';
      setIsImplantacaoMode(isImplantacao);

      const authData = (authRes?.data as unknown as PromoterOperationAuthorization) || null;
      setAuthRecord(authData);

      // Autorizado se for OPERACAO_OFICIAL ou se tiver autorização com status 'liberado'
      const authorized = !isImplantacao || (authData?.status === 'liberado');
      setIsAuthorized(authorized);

      const rawRoutes = (rotasRes.data as unknown as RouteItem[]) || [];
      setRoutes(rawRoutes);

      const visits = (visitsRes.data as unknown as Visit[]) || [];
      const openVisits = ((openVisitsRes && 'data' in openVisitsRes ? openVisitsRes.data : []) as unknown as Visit[]) || [];

      // Consolidar todas as visitas adicionando as em aberto
      const visitsMap = new Map<string, Visit>();
      visits.forEach((v) => visitsMap.set(v.id, v));
      openVisits.forEach((v) => visitsMap.set(v.id, v));
      const allConsolidatedVisits = Array.from(visitsMap.values());

      setWeekVisits(allConsolidatedVisits);
      setTodayVisits(allConsolidatedVisits.filter((v) => v.data_visita === todayStr));

      // Identificar visitas anteriores à data atual que não foram concluídas (Requisito 2)
      // 1. Em andamento de dias anteriores (data < hoje e status = 'em_andamento')
      const stalesInProgress = allConsolidatedVisits.filter(
        (v) => v.status === 'em_andamento' && v.data_visita < todayStr
      );
      setStaleInProgressVisits(stalesInProgress);

      // 2. Não realizadas de dias anteriores (data < hoje e status = 'nao_realizada')
      const stalesNotDone = allConsolidatedVisits.filter(
        (v) => v.status === 'nao_realizada' && v.data_visita < todayStr
      );
      setStaleNotDoneVisits(stalesNotDone);

      // Visita em andamento de HOJE
      const todayInProgress = allConsolidatedVisits.find((v) => v.status === 'em_andamento' && v.data_visita === todayStr);

      // Se houver visita de hoje em andamento, prioriza atendimento ativo de hoje
      // Se não houver de hoje mas houver stale, candidateActive não sequestra o topo ativo de hoje
      const candidateActive = todayInProgress || null;

      if (candidateActive) {
        // Gerar signedUrls para as fotos da visita ativa
        if (candidateActive.photos && candidateActive.photos.length > 0) {
          const photosWithSignedUrls = await Promise.all(
            candidateActive.photos.map(async (p) => {
              if (p.storage_path) {
                const { data } = await supabase!.storage
                  .from('visit-photos')
                  .createSignedUrl(p.storage_path, 3600);
                if (data?.signedUrl) {
                  return { ...p, signed_url: data.signedUrl };
                }
              }
              return p;
            })
          );
          candidateActive.photos = photosWithSignedUrls;
        }

        // Se a visita for do dia de hoje, abre no formulário de atendimento ativo
        if (candidateActive.data_visita === todayStr) {
          setActiveVisit(candidateActive);
          setGeneralObs(candidateActive.observacao_geral || '');

          setChecklist(createChecklistState(candidateActive.checklist_items));
        } else {
          // Se for uma visita de dia anterior, NÃO sequestra o topo como visita ativa do dia
          // O banner dedicado de aviso exibirá os botões: "Continuar Visita" ou "Registrar como Não Realizada"
          setActiveVisit(null);
        }
      } else {
        setActiveVisit(null);
      }
    } catch (err: any) {
      console.error('Erro ao carregar Portal do Promotor:', err);
      onShowToast({
        title: 'Erro de Carregamento',
        message: err.message || 'Falha ao carregar suas rotas e visitas.',
        type: 'error'
      });
    } finally {
      setLoading(false);
    }
  }, [promotorMatricula, isAdminUser, weekOffset, onShowToast]);

  useEffect(() => {
    loadPortalData();
  }, [loadPortalData, weekOffset]);

  // Carregar URLs assinadas para a visita inspecionada pelo administrador
  useEffect(() => {
    if (!adminInspectionVisit?.visitObj?.photos || adminInspectionVisit.visitObj.photos.length === 0) {
      setAdminSignedPhotoUrls({});
      return;
    }

    const photos = adminInspectionVisit.visitObj.photos;
    let isCancelled = false;
    setLoadingInspectionPhotos(true);

    const generateUrls = async () => {
      const urlMap: Record<string, string> = {};
      for (const p of photos) {
        if (p.storage_path && supabase) {
          try {
            const { data } = await supabase.storage
              .from('visit-photos')
              .createSignedUrl(p.storage_path, 3600);
            if (data?.signedUrl) {
              urlMap[p.id || p.storage_path] = data.signedUrl;
            }
          } catch (e) {
            console.warn('Erro ao assinar foto para inspeção admin:', e);
          }
        }
      }
      if (!isCancelled) {
        setAdminSignedPhotoUrls(urlMap);
        setLoadingInspectionPhotos(false);
      }
    };

    generateUrls();

    return () => {
      isCancelled = true;
    };
  }, [adminInspectionVisit]);

  // Salvar Edição da Escala Fixa da Rota (Item 4)
  const handleSaveRouteScale = async (routeToSave: RouteItem) => {
    if (!supabase) {
      onShowToast({
        title: 'Erro de Conexão',
        message: 'Cliente Supabase não inicializado.',
        type: 'error'
      });
      return;
    }

    const { segunda, terca, quarta, quinta, sexta, sabado, domingo } = routeToSave;
    if (!segunda && !terca && !quarta && !quinta && !sexta && !sabado && !domingo) {
      onShowToast({
        title: 'Atenção: Nenhum dia selecionado',
        message: 'A rota ficará salva sem visitas programadas em nenhum dia da semana.',
        type: 'warning'
      });
    }

    setSavingScaleRoute(true);
    try {
      const { error: updateErr } = await supabase
        .from('rotas')
        .update({
          frequencia: routeToSave.frequencia,
          segunda: routeToSave.segunda,
          terca: routeToSave.terca,
          quarta: routeToSave.quarta,
          quinta: routeToSave.quinta,
          sexta: routeToSave.sexta,
          sabado: routeToSave.sabado,
          domingo: routeToSave.domingo,
          observacao: routeToSave.observacao ? routeToSave.observacao.trim() : null,
          updated_at: new Date().toISOString()
        })
        .eq('id', routeToSave.id);

      if (updateErr) throw updateErr;

      onShowToast({
        title: 'Escala Fixa Atualizada',
        message: `A escala da rota foi atualizada com sucesso. As visitas futuras refletirão esta nova grade.`,
        type: 'success'
      });

      setEditingScaleRoute(null);
      await loadPortalData();
    } catch (err: any) {
      console.error('Erro ao atualizar escala da rota:', err);
      onShowToast({
        title: 'Falha ao Salvar Escala',
        message: err.message || 'Ocorreu um erro ao atualizar a escala da rota.',
        type: 'error'
      });
    } finally {
      setSavingScaleRoute(false);
    }
  };

  const todayStr = useMemo(() => getLocalDateString(new Date()), []);
  const weekDaysRange = useMemo(() => getWeekDaysRange(new Date(), weekOffset), [weekOffset]);

  const allWeekOperationalVisits = useMemo(() => {
    return calculateOperationalVisits({
      routes,
      visits: weekVisits,
      daysRange: weekDaysRange,
      todayStr
    });
  }, [routes, weekVisits, weekDaysRange, todayStr]);

  // Agenda das visitas de HOJE com ordenação amigável:
  // 1º Em atendimento, 2º Pendentes/Planejadas, 3º Não realizadas, 4º Concluídas
  const todayOperationalVisits = useMemo(() => {
    const list = allWeekOperationalVisits.filter((item) => item.dataStr === todayStr);
    return list.sort((a, b) => {
      const orderScore = (status: string) => {
        if (status === 'em_andamento') return 1;
        if (status === 'pendente' || status === 'planejada') return 2;
        if (status === 'nao_realizada') return 3;
        if (status === 'concluida') return 4;
        return 5;
      };
      const scoreDiff = orderScore(a.status) - orderScore(b.status);
      if (scoreDiff !== 0) return scoreDiff;
      return a.lojaNome.localeCompare(b.lojaNome);
    });
  }, [allWeekOperationalVisits, todayStr]);

  // Visitas filtradas exclusivamente para o dia selecionado no Histórico Semanal (Item 2)
  const selectedDayOperationalVisits = useMemo(() => {
    return allWeekOperationalVisits.filter((item) => item.dataStr === selectedDayDateStr);
  }, [allWeekOperationalVisits, selectedDayDateStr]);

  // Lista final a ser exibida no histórico semanal (por dia ou a semana toda)
  const displayedWeekVisits = useMemo(() => {
    if (weekHistoryFilterMode === 'all') {
      return allWeekOperationalVisits;
    }
    return selectedDayOperationalVisits;
  }, [weekHistoryFilterMode, allWeekOperationalVisits, selectedDayOperationalVisits]);

  const realName = promoterDetails?.nome || profile?.promotor_nome || profile?.name || (promotorMatricula ? 'Promotor de Campo' : 'Promotor não vinculado');
  const realMatricula = promoterDetails?.matricula || profile?.promotor_matricula || null;
  const realCidade = promoterDetails?.cidade || profile?.promotor_cidade;
  const realUf = promoterDetails?.uf || profile?.promotor_uf;
  const realSupervisor = promoterDetails?.supervisor || profile?.promotor_supervisor;
  const realEquipe = promoterDetails?.equipe || profile?.promotor_equipe;

  const initials = (() => {
    if (!realName || realName === 'Promotor não vinculado') return 'PR';
    const parts = realName.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return realName.substring(0, 2).toUpperCase();
  })();

  // Resumo de execução do dia de HOJE baseado nas visitas previstas para o dia atual
  const totalPlanned = todayOperationalVisits.length;
  const completedCount = todayOperationalVisits.filter((v) => v.status === 'concluida').length;
  const inProgressCount = todayOperationalVisits.filter((v) => v.status === 'em_andamento').length;
  const notDoneCount = todayOperationalVisits.filter((v) => v.status === 'nao_realizada').length;
  const pendingCount = todayOperationalVisits.filter((v) => v.status === 'pendente' || v.status === 'planejada').length;
  const executionPerc = totalPlanned > 0 ? Math.round((completedCount / totalPlanned) * 100) : 0;

  // Iniciar Visita
  const handleStartVisit = async (route: RouteItem) => {
    if (!supabase) return;

    if (isAdminUser) {
      onShowToast({
        title: 'Modo Somente Leitura',
        message: 'A visualização administrativa é apenas para consulta. Administradores não devem registrar check-in em nome do promotor.',
        type: 'info'
      });
      return;
    }

    if (!promotorMatricula) {
      onShowToast({
        title: 'Matrícula Não Vinculada',
        message: 'Seu usuário não possui uma matrícula de promotor associada. Solicite ao administrador a vinculação do seu perfil a um promotor cadastrado.',
        type: 'warning'
      });
      return;
    }

    if (isImplantacaoMode && !isAuthorized) {
      onShowToast({
        title: 'Operação Não Liberada',
        message: 'Seu usuário ainda não foi liberado individualmente pelo gestor para a fase de testes em campo.',
        type: 'warning'
      });
      return;
    }

    // Se já houver uma visita em andamento (hoje ou de dias anteriores), não permite iniciar outra silenciosamente.
    // Exige decisão explícita: voltar para a atual ou interromper a anterior com justificativa.
    if (activeVisit) {
      const isSameVisit = activeVisit.loja_codigo === route.loja_codigo && activeVisit.industria_codigo === route.industria_codigo;
      if (!isSameVisit) {
        setBusyConflictTargetRoute(route);
        return;
      }
    }

    // Prevenir duplo clique
    if (startingRouteId) return;
    setStartingRouteId(route.id);

    try {
      const todayStr = getLocalDateString(new Date());

      // 1. Verificar se já existe visita para esta rota e data (prevenir duplicidade)
      const { data: existingVisits, error: checkErr } = await supabase
        .from('visits')
        .select(`
          *,
          industria:industrias(codigo, nome),
          loja:lojas(codigo, nome, cidade, uf, endereco),
          promotor:promotores(matricula, nome),
          checklist_items:visit_checklist_items(*),
          photos:visit_photos(*),
          occurrences:visit_occurrences(*)
        `)
        .eq('promotor_matricula', promotorMatricula)
        .eq('loja_codigo', route.loja_codigo)
        .eq('industria_codigo', route.industria_codigo)
        .eq('data_visita', todayStr);

      if (checkErr) throw checkErr;

      let visitData: Visit;

      if (existingVisits && existingVisits.length > 0) {
        // Reutilizar visita existente caso já tenha sido iniciada/criada hoje
        visitData = existingVisits[0] as Visit;
        onShowToast({
          title: 'Visita Retomada',
          message: `Visita já existente carregada para a loja ${route.loja?.nome || route.loja_codigo}.`,
          type: 'info'
        });
      } else {
        // Obter Geolocalização do dispositivo com timeout seguro e sem travar o início da visita
        let lat: number | null = null;
        let lng: number | null = null;
        let accuracy: number | null = null;

        if (typeof navigator !== 'undefined' && navigator.geolocation) {
          try {
            const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
              const timer = setTimeout(() => {
                reject(new Error('Geolocation timeout'));
              }, 3000);

              navigator.geolocation.getCurrentPosition(
                (position) => {
                  clearTimeout(timer);
                  resolve(position);
                },
                (error) => {
                  clearTimeout(timer);
                  reject(error);
                },
                { timeout: 3000, enableHighAccuracy: false, maximumAge: 60000 }
              );
            });
            lat = pos.coords.latitude;
            lng = pos.coords.longitude;
            accuracy = pos.coords.accuracy;
          } catch (e) {
            console.warn('Geolocalização não concedida ou timeout:', e);
          }
        }

        // Sanitização de rota_id: validar se corresponde a um UUID válido ou rota real para evitar rejeição por Foreign Key
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(route.id || '');
        const validRouteInDb = routes.find((r) => r.id === route.id);
        const rotaIdToInsert = (validRouteInDb || isUuid) ? route.id : null;

        // Server identifies the authenticated promoter and timestamps the event.
        const { data: newVisit, error: insertErr } = await supabase.rpc('attendance_check_in', {
          p_store: route.loja_codigo, p_industry: route.industria_codigo, p_route: rotaIdToInsert,
          p_lat: lat, p_lng: lng, p_accuracy: accuracy
        });

        if (insertErr) {
          // Se ocorreu duplicidade por corrida concorrente, tenta carregar a visita criada
          if (insertErr.code === '23505' || insertErr.message?.includes('duplicate key') || insertErr.message?.includes('visits_promotor_loja_industria_data_unique')) {
            const { data: fallbackVisits } = await supabase
              .from('visits')
              .select(`
                *,
                industria:industrias(codigo, nome),
                loja:lojas(codigo, nome, cidade, uf, endereco),
                promotor:promotores(matricula, nome),
                checklist_items:visit_checklist_items(*),
                photos:visit_photos(*),
                occurrences:visit_occurrences(*)
              `)
              .eq('promotor_matricula', promotorMatricula)
              .eq('loja_codigo', route.loja_codigo)
              .eq('industria_codigo', route.industria_codigo)
              .eq('data_visita', todayStr);

            if (fallbackVisits && fallbackVisits.length > 0) {
              visitData = fallbackVisits[0] as Visit;
              onShowToast({
                title: 'Visita em Andamento',
                message: `Visita recuperada com sucesso para a loja ${route.loja?.nome || route.loja_codigo}.`,
                type: 'info'
              });
            } else {
              throw insertErr;
            }
          } else {
            throw insertErr;
          }
        } else {
          visitData = newVisit as Visit;
          onShowToast({
            title: 'Visita Iniciada!',
            message: `Check-in registrado na loja ${route.loja?.nome || route.loja_codigo}.`,
            type: 'success'
          });
        }
      }

      setActiveVisit(visitData);

      // Inicializar checklist padrão
      setChecklist(createChecklistState(visitData.checklist_items));

      await loadPortalData();
    } catch (err: any) {
      console.error('Erro ao iniciar visita:', err);

      let userMsg = 'Erro ao registrar check-in no servidor.';
      if (err?.message) {
        if (err.message.includes('row-level security') || err.code === '42501') {
          userMsg = 'Acesso não autorizado pelas regras do sistema para esta matrícula.';
        } else if (err.message.includes('foreign key') || err.code === '23503') {
          userMsg = 'Dados da loja, indústria ou rota não encontrados no cadastro.';
        } else if (err.message.includes('duplicate key') || err.code === '23505') {
          userMsg = 'Já existe um registro de visita ativo para esta loja e data.';
        } else {
          // Sanitização de mensagem: evitar expor tokens, senhas ou URLs completas
          userMsg = err.message.replace(/https?:\/\/[^\s]+/g, '[servidor]').slice(0, 150);
        }
      }

      onShowToast({
        title: 'Falha ao Iniciar Visita',
        message: userMsg,
        type: 'error'
      });
    } finally {
      setStartingRouteId(null);
    }
  };

  const handleChecklistChange = (
    item: { item_key: string; item_label: string },
    checked: boolean,
    obs: string,
    valTxt: string,
    answered: boolean
  ) => {
    if (completingVisit) return;

    const updatedState = { checked, answered, obs, valTxt };
    setChecklist((previous) => ({ ...previous, [item.item_key]: updatedState }));
    setChecklistSaveError(null);

    if (!activeVisit || activeVisit.status !== 'em_andamento' || !supabase) return;

    pendingChecklistWritesRef.current += 1;
    setPendingChecklistWrites(pendingChecklistWritesRef.current);

    const saveItem = async () => {
      const client = supabase;
      if (!client) throw new Error('Cliente Supabase não inicializado.');

      const { data: existing, error: lookupError } = await client
        .from('visit_checklist_items')
        .select('id')
        .eq('visit_id', activeVisit.id)
        .eq('item_key', item.item_key)
        .maybeSingle();
      if (lookupError) throw lookupError;

      const values = {
        checked,
        observacao: obs.trim() || null,
        valor_texto: valTxt.trim() || null
      };

      if (existing) {
        const { error } = await client
          .from('visit_checklist_items')
          .update(values)
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await client.from('visit_checklist_items').insert([
          {
            visit_id: activeVisit.id,
            item_key: item.item_key,
            item_label: item.item_label,
            ...values
          }
        ]);
        if (error) throw error;
      }
    };

    const queuedSave = checklistWriteQueueRef.current.then(saveItem, saveItem);
    const settledSave = queuedSave
      .catch((error: unknown) => {
        console.error('Erro ao persistir item de checklist:', error);
        setChecklistSaveError('Não foi possível salvar uma resposta. Tente novamente antes de finalizar.');
      })
      .finally(() => {
        pendingChecklistWritesRef.current = Math.max(0, pendingChecklistWritesRef.current - 1);
        setPendingChecklistWrites(pendingChecklistWritesRef.current);
      });

    checklistWriteQueueRef.current = settledSave;
  };

  // Função nativa para Redimensionar e Comprimir Imagens no Dispositivo (Browser HTML5 Canvas API)
  const compressImageFile = (file: File, maxDimension: number = 1920, quality: number = 0.82): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);
        let width = img.width;
        let height = img.height;

        // Manter proporção reduzindo o lado maior para maxDimension (1920px)
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          reject(new Error('Falha ao inicializar contexto 2D para otimização da imagem.'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        // Exportar como JPEG otimizado
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Falha ao comprimir arquivo de imagem.'));
            }
          },
          'image/jpeg',
          quality
        );
      };

      img.onerror = (err) => {
        URL.revokeObjectURL(url);
        reject(err);
      };

      img.src = url;
    });
  };

  // Upload de Foto para o Bucket Privado 'visit-photos' com Compressão no Device e Validação
  const handleUploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeVisit || activeVisit.status !== 'em_andamento' || !supabase || completingVisit) return;
    if (uploadingPhotoRef.current) {
      e.target.value = '';
      return;
    }

    if (!isSupportedVisitPhoto(file.type)) {
      onShowToast({
        title: 'Formato Inválido',
        message: 'Selecione um arquivo de imagem válido (SVG não é permitido).',
        type: 'warning'
      });
      e.target.value = '';
      return;
    }

    uploadingPhotoRef.current = true;
    setUploadingPhoto(true);
    setPhotoStatusMessage('Otimizando foto...');
    let uploadedPath: string | null = null;
    const selectedPhotoType = photoType;
    const caption = photoCaption.trim();

    try {
      // 2. Compressão e Redimensionamento no Dispositivo antes do envio (Máx 1920px, Qualidade 82% JPEG)
      let fileToUpload: Blob = file;
      let contentType = 'image/jpeg';
      let fileExtension = 'jpg';
      try {
        fileToUpload = await compressImageFile(file, 1920, 0.82);
        console.log(`Foto otimizada: Original ${(file.size / 1024).toFixed(1)} KB -> Otimizada ${(fileToUpload.size / 1024).toFixed(1)} KB`);
      } catch (cErr) {
        console.warn('Falha na otimização nativa, enviando arquivo original:', cErr);
        fileToUpload = file;
        contentType = file.type.toLowerCase();
        fileExtension = contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'img';
      }

      // 3. Validar limite de tamanho pós-compressão (máximo 5MB)
      if (!isWithinVisitPhotoLimit(fileToUpload.size)) {
        onShowToast({
          title: 'Tamanho Excedido',
          message: 'Mesmo após a otimização, a foto excedeu o limite seguro de 5MB.',
          type: 'warning'
        });
        return;
      }

      setPhotoStatusMessage('Enviando foto...');

      // Estrutura padrão de caminho: visits/{visit_id}/{arquivo}_{tipo}.{extensão}
      const uploadId = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const fileName = `${activeVisit.id}/${uploadId}_${selectedPhotoType}.${fileExtension}`;
      uploadedPath = `visits/${fileName}`;

      // 4. Upload no Supabase Storage
      const { error: uploadErr } = await supabase.storage
        .from('visit-photos')
        .upload(uploadedPath, fileToUpload, { contentType });

      if (uploadErr) throw uploadErr;

      // 5. Gerar Signed URL para exibição temporária privada (3600s)
      const { data: signedData } = await supabase.storage
        .from('visit-photos')
        .createSignedUrl(uploadedPath, 3600);

      const signedUrl = signedData?.signedUrl || '';

      // 6. Gravar referência na tabela visit_photos (storage_path)
      const { error: dbErr } = await supabase.from('visit_photos').insert([
        {
          visit_id: activeVisit.id,
          tipo_foto: selectedPhotoType,
          storage_path: uploadedPath,
          file_url: signedUrl || uploadedPath,
          legenda: caption || null
        }
      ]);

      if (dbErr) {
        console.error('Erro no INSERT em visit_photos. Limpando arquivo enviado no Storage...', dbErr);
        await supabase.storage.from('visit-photos').remove([uploadedPath]);
        throw dbErr;
      }

      onShowToast({
        title: 'Foto Anexada',
        message: `Foto otimizada e salva com sucesso! (${(fileToUpload.size / 1024).toFixed(0)} KB)`,
        type: 'success'
      });

      setPhotoCaption('');

      // Atualizar lista de fotos da visita ativa com signed_url
      const { data: updatedPhotos } = await supabase.from('visit_photos').select('*').eq('visit_id', activeVisit.id);
      if (updatedPhotos) {
        const photosWithSignedUrls = await Promise.all(
          updatedPhotos.map(async (p: any) => {
            if (p.storage_path) {
              const { data } = await supabase!.storage
                .from('visit-photos')
                .createSignedUrl(p.storage_path, 3600);
              if (data?.signedUrl) {
                return { ...p, signed_url: data.signedUrl };
              }
            }
            return p;
          })
        );
        setActiveVisit((prev) => prev ? { ...prev, photos: photosWithSignedUrls } : null);
      }
    } catch (err: any) {
      console.error('Erro ao enviar foto otimizada:', err);
      onShowToast({
        title: 'Falha no Upload',
        message: err.message || 'Erro ao enviar a foto otimizada para o servidor.',
        type: 'error'
      });
    } finally {
      setUploadingPhoto(false);
      uploadingPhotoRef.current = false;
      setPhotoStatusMessage('');
      e.target.value = '';
    }
  };

  // Registrar Ocorrência / Ruptura
  const handleAddOccurrence = async () => {
    if (!occurrenceDesc.trim() || !activeVisit || !supabase) return;

    setSavingOccurrence(true);
    try {
      const { error: err } = await supabase.from('visit_occurrences').insert([
        {
          visit_id: activeVisit.id,
          tipo: occurrenceType,
          descricao: occurrenceDesc.trim()
        }
      ]);

      if (err) throw err;

      onShowToast({
        title: 'Ocorrência Registrada',
        message: `Incidente de ${occurrenceType.toUpperCase()} salvo com sucesso!`,
        type: 'info'
      });

      setOccurrenceDesc('');
      const { data: updatedOccs } = await supabase
        .from('visit_occurrences')
        .select('*')
        .eq('visit_id', activeVisit.id)
        .order('created_at', { ascending: false });

      setActiveVisit((prev) => (prev ? { ...prev, occurrences: updatedOccs as any } : null));
    } catch (err: any) {
      console.error('Erro ao gravar ocorrência:', err);
      onShowToast({
        title: 'Erro de Gravação',
        message: err.message || 'Falha ao salvar ocorrência.',
        type: 'error'
      });
    } finally {
      setSavingOccurrence(false);
    }
  };

  // Registrar Validade de Produto (Etapa 4)
  const handleAddProductValidity = async () => {
    if (!validityProdutoNome.trim() || !validityDataVencimento || !activeVisit || !supabase) {
      onShowToast({
        title: 'Dados Incompletos',
        message: 'Preencha o nome do produto e a data de vencimento.',
        type: 'warning'
      });
      return;
    }

    if (validityQuantidade <= 0) {
      onShowToast({
        title: 'Quantidade Inválida',
        message: 'A quantidade deve ser um número inteiro maior que zero.',
        type: 'warning'
      });
      return;
    }

    setSavingValidity(true);
    try {
      const { error: err } = await supabase.from('visit_product_validity').insert([
        {
          visit_id: activeVisit.id,
          produto_nome: validityProdutoNome.trim(),
          quantidade: Math.max(1, Math.floor(validityQuantidade)),
          data_vencimento: validityDataVencimento,
          lote: validityLote.trim() || null,
          observacao: validityObservacao.trim() || null
        }
      ]);

      if (err) throw err;

      onShowToast({
        title: 'Validade Registrada',
        message: `Produto ${validityProdutoNome.trim()} adicionado com sucesso!`,
        type: 'success'
      });

      setValidityProdutoNome('');
      setValidityQuantidade(1);
      setValidityDataVencimento('');
      setValidityLote('');
      setValidityObservacao('');

      const { data: updatedVal } = await supabase
        .from('visit_product_validity')
        .select('*')
        .eq('visit_id', activeVisit.id)
        .order('data_vencimento', { ascending: true });

      setActiveVisit((prev) => (prev ? { ...prev, validity_items: updatedVal as any } : null));
    } catch (err: any) {
      console.error('Erro ao salvar validade do produto:', err);
      onShowToast({
        title: 'Erro de Gravação',
        message: err.message || 'Falha ao salvar registro de validade.',
        type: 'error'
      });
    } finally {
      setSavingValidity(false);
    }
  };

  // Finalizar Visita / Check-out
  const handleCompleteVisit = async () => {
    if (!activeVisit || activeVisit.status !== 'em_andamento' || !supabase || completingVisit) return;
    const invalidQuantity = findInvalidChecklistQuantity(checklist);
    if (invalidQuantity) {
      onShowToast({
        title: 'Quantidade Inválida',
        message: `Informe um número inteiro igual ou maior que zero em "${invalidQuantity}".`,
        type: 'warning'
      });
      return;
    }
    if (uploadingPhotoRef.current) {
      onShowToast({
        title: 'Upload em andamento',
        message: 'Aguarde o envio da foto antes de finalizar a visita.',
        type: 'info'
      });
      return;
    }
    if (pendingChecklistWritesRef.current > 0) {
      onShowToast({
        title: 'Salvando Checklist',
        message: 'Aguarde o salvamento das respostas antes de finalizar a visita.',
        type: 'info'
      });
      return;
    }

    setCompletingVisit(true);

    try {
      await checklistWriteQueueRef.current;

      // 1. Obter Geolocalização do dispositivo no check-out se disponível
      let lat: number | null = null;
      let lng: number | null = null;
      let checkoutAccuracy: number | null = null;

      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3500 });
          });
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
          checkoutAccuracy = pos.coords.accuracy;
        } catch (e) {
          console.warn('Geolocalização no check-out não concedida ou timeout');
        }
      }

      // 2. Sincronizar o checklist sem apagar campos legados ou respostas fora do formulário atual
      const { data: existingChecklist, error: checklistReadError } = await supabase
        .from('visit_checklist_items')
        .select('id, item_key')
        .eq('visit_id', activeVisit.id);
      if (checklistReadError) throw checklistReadError;

      const syncPlan = buildChecklistSyncPlan(
        activeVisit.id,
        checklist,
        existingChecklist || []
      );

      for (const update of syncPlan.updates) {
        const { error: updateChecklistError } = await supabase
          .from('visit_checklist_items')
          .update(update.values)
          .eq('id', update.id);
        if (updateChecklistError) throw updateChecklistError;
      }

      if (syncPlan.inserts.length > 0) {
        const { error: insertChecklistError } = await supabase
          .from('visit_checklist_items')
          .insert(syncPlan.inserts);
        if (insertChecklistError) throw insertChecklistError;
      }
      setChecklistSaveError(null);

      // 3. Atualizar visita com status oficial 'concluida' e completed_at (preservando started_at)
      const nowIso = new Date().toISOString();
      const { error: updateErr } = await supabase.rpc('attendance_check_out', {
        p_visit: activeVisit.id, p_lat: lat, p_lng: lng, p_accuracy: checkoutAccuracy,
        p_observation: generalObs.trim() || null
      });

      if (updateErr) throw updateErr;

      onShowToast({
        title: 'Visita Finalizada com Sucesso! 🎉',
        message: `Check-out concluído na loja ${activeVisit.loja?.nome || activeVisit.loja_codigo}.`,
        type: 'success'
      });

      setActiveVisit(null);
      await loadPortalData();
    } catch (err: any) {
      console.error('Erro ao finalizar visita:', err);
      onShowToast({
        title: 'Erro ao Concluir Visita',
        message: err.message || 'Falha ao encerrar relatório de visita no banco.',
        type: 'error'
      });
    } finally {
      setCompletingVisit(false);
    }
  };

  // Registrar Visita Não Realizada
  const handleMarkNotDone = async () => {
    if (!showNotDoneModal || !notDoneReason.trim() || !supabase) return;

    if (isImplantacaoMode && !isAuthorized) {
      onShowToast({
        title: 'Operação Não Liberada',
        message: 'Seu usuário ainda não foi liberado para registrar apontamentos de campo.',
        type: 'warning'
      });
      return;
    }

    try {
      const todayStr = getLocalDateString(new Date());

      const { error: err } = await supabase.from('visits').insert([
        {
          rota_id: showNotDoneModal.id,
          promotor_matricula: showNotDoneModal.promotor_matricula,
          loja_codigo: showNotDoneModal.loja_codigo,
          industria_codigo: showNotDoneModal.industria_codigo,
          data_visita: todayStr,
          status: 'nao_realizada',
          motivo_nao_realizada: notDoneReason.trim()
        }
      ]);

      if (err) throw err;

      onShowToast({
        title: 'Visita Justificada',
        message: 'Ocorrência de não realização encaminhada ao supervisor.',
        type: 'info'
      });

      setShowNotDoneModal(null);
      setNotDoneReason('');
      loadPortalData();
    } catch (err: any) {
      onShowToast({
        title: 'Erro ao Registrar',
        message: err.message || 'Falha ao salvar não realização.',
        type: 'error'
      });
    }
  };

  // 1. Continuar Visita Antiga em Andamento
  const handleResumeStaleVisit = async (visit: Visit) => {
    try {
      // Carregar signedUrls para fotos
      if (visit.photos && visit.photos.length > 0 && supabase) {
        const photosWithSignedUrls = await Promise.all(
          visit.photos.map(async (p) => {
            if (p.storage_path) {
              const { data } = await supabase!.storage
                .from('visit-photos')
                .createSignedUrl(p.storage_path, 3600);
              if (data?.signedUrl) {
                return { ...p, signed_url: data.signedUrl };
              }
            }
            return p;
          })
        );
        visit.photos = photosWithSignedUrls;
      }

      setActiveVisit(visit);
      setGeneralObs(visit.observacao_geral || '');

      setChecklist(createChecklistState(visit.checklist_items));

      onShowToast({
        title: 'Atendimento Retomado',
        message: `Visita iniciada em ${visit.data_visita.split('-').reverse().join('/')} retomada com dados preservados.`,
        type: 'info'
      });
    } catch (err: any) {
      console.error('Erro ao retomar visita antiga:', err);
      onShowToast({
        title: 'Erro ao Retomar Visita',
        message: err.message || 'Não foi possível carregar a visita em andamento.',
        type: 'error'
      });
    }
  };

  // 2. Registrar Visita Antiga como Não Realizada com motivo obrigatório
  const handleConfirmStaleNotDone = async () => {
    if (!staleNotDoneVisit || !staleNotDoneReason.trim() || !supabase) return;

    setSavingStaleNotDone(true);
    try {
      const nowIso = new Date().toISOString();
      const { error: updateErr } = await supabase
        .from('visits')
        .update({
          status: 'nao_realizada',
          motivo_nao_realizada: staleNotDoneReason.trim(),
          updated_at: nowIso
        })
        .eq('id', staleNotDoneVisit.id);

      if (updateErr) throw updateErr;

      onShowToast({
        title: 'Visita Registrada como Não Realizada',
        message: `A visita de ${staleNotDoneVisit.data_visita.split('-').reverse().join('/')} na loja ${staleNotDoneVisit.loja?.nome || staleNotDoneVisit.loja_codigo} foi registrada como não realizada.`,
        type: 'info'
      });

      // Se a visita cancelada era a visita ativa aberta no formulário, limpa
      if (activeVisit?.id === staleNotDoneVisit.id) {
        setActiveVisit(null);
      }

      setStaleNotDoneVisit(null);
      setStaleNotDoneReason('');
      await loadPortalData();
    } catch (err: any) {
      console.error('Erro ao registrar visita antiga como não realizada:', err);
      onShowToast({
        title: 'Erro ao Atualizar',
        message: err.message || 'Falha ao registrar ocorrência no banco de dados.',
        type: 'error'
      });
    } finally {
      setSavingStaleNotDone(false);
    }
  };

  // 3. Interromper Atendimento em Andamento (Requisito 3)
  // Permite abandonar uma execução iniciada por engano ou interrompida para atender outra loja.
  // Grava ocorrência de auditoria em visit_occurrences, define status 'nao_realizada',
  // preserva evidências e fotos existentes, e desocupa a visita ativa para permitir iniciar outra.
  const handleConfirmInterruptVisit = async () => {
    if (!interruptModalVisit || !interruptReason.trim() || !supabase) return;

    // Garantir que não permite modificar visitas já concluídas
    if (interruptModalVisit.status === 'concluida') {
      onShowToast({
        title: 'Operação Não Permitida',
        message: 'Visitas já concluídas não podem ser alteradas ou interrompidas.',
        type: 'warning'
      });
      setInterruptModalVisit(null);
      setInterruptReason('');
      return;
    }

    setSavingInterrupt(true);
    try {
      const nowIso = new Date().toISOString();
      const justifText = interruptReason.trim();

      // 1. Atualizar o status da visita para 'nao_realizada' com o motivo registrado
      const { error: updateErr } = await supabase
        .from('visits')
        .update({
          status: 'nao_realizada',
          motivo_nao_realizada: `[Interrupção de Atendimento]: ${justifText}`,
          updated_at: nowIso
        })
        .eq('id', interruptModalVisit.id);

      if (updateErr) throw updateErr;

      // 2. Registrar no mecanismo de histórico e auditoria (visit_occurrences)
      try {
        await supabase.from('visit_occurrences').insert([
          {
            visit_id: interruptModalVisit.id,
            tipo: 'outro',
            descricao: `Atendimento interrompido pelo promotor. Justificativa: ${justifText}`
          }
        ]);
      } catch (occErr) {
        console.warn('Aviso: Falha ao inserir ocorrência de auditoria da interrupção:', occErr);
      }

      onShowToast({
        title: 'Atendimento Interrompido',
        message: `Atendimento da loja ${interruptModalVisit.loja?.nome || interruptModalVisit.loja_codigo} foi cancelado com justificativa. Sua agenda está liberada.`,
        type: 'info'
      });

      // Se a visita interrompida for a visita ativa no momento, desocupar
      if (activeVisit?.id === interruptModalVisit.id) {
        setActiveVisit(null);
      }

      setInterruptModalVisit(null);
      setInterruptReason('');
      await loadPortalData();
    } catch (err: any) {
      console.error('Erro ao interromper atendimento:', err);
      onShowToast({
        title: 'Erro ao Interromper',
        message: err.message || 'Falha ao atualizar status da visita no banco de dados.',
        type: 'error'
      });
    } finally {
      setSavingInterrupt(false);
    }
  };

  // 4. Recuperar Visita Não Realizada ("Realizar hoje" - Etapa 2)
  // Reabre com atraso uma visita não realizada pertencente à janela operacional permitida (até 30 dias).
  // Preserva integralmente: data_visita original, motivo_nao_realizada anterior, fotos, checklist e ocorrências.
  // Registra nova ocorrência em visit_occurrences para auditoria e define started_at se ainda não existia.
  const handleConfirmRecoverVisit = async () => {
    if (!recoverModalVisit || !supabase || recoveringVisit) return;

    if (!promotorMatricula) {
      onShowToast({
        title: 'Matrícula Não Vinculada',
        message: 'Usuário sem matrícula associada não pode recuperar visitas.',
        type: 'warning'
      });
      return;
    }

    if (isImplantacaoMode && !isAuthorized) {
      onShowToast({
        title: 'Operação Não Liberada',
        message: 'Seu usuário ainda não foi liberado para testes em campo.',
        type: 'warning'
      });
      return;
    }

    // Validação de conflito: não permite recuperar se já houver outra visita em andamento
    if (activeVisit && activeVisit.id !== recoverModalVisit.id) {
      const targetRouteFake = {
        id: recoverModalVisit.rota_id || recoverModalVisit.id,
        promotor_matricula: recoverModalVisit.promotor_matricula,
        loja_codigo: recoverModalVisit.loja_codigo,
        industria_codigo: recoverModalVisit.industria_codigo,
        frequencia: 'SEMANAL',
        loja: recoverModalVisit.loja,
        industria: recoverModalVisit.industria
      } as RouteItem;
      setRecoverModalVisit(null);
      setBusyConflictTargetRoute(targetRouteFake);
      return;
    }

    setRecoveringVisit(true);

    try {
      const todayStr = getLocalDateString(new Date());

      // 1. Revalidar no servidor o status e a matrícula atual da visita para evitar corrida/duplicidade
      const { data: currentDbVisit, error: fetchErr } = await supabase
        .from('visits')
        .select(`
          *,
          industria:industrias(codigo, nome),
          loja:lojas(codigo, nome, cidade, uf, endereco),
          promotor:promotores(matricula, nome),
          checklist_items:visit_checklist_items(*),
          photos:visit_photos(*),
          occurrences:visit_occurrences(*),
          validity_items:visit_product_validity(*)
        `)
        .eq('id', recoverModalVisit.id)
        .eq('promotor_matricula', promotorMatricula)
        .single();

      if (fetchErr || !currentDbVisit) {
        throw new Error('Visita não encontrada ou você não tem permissão para recuperá-la.');
      }

      // Regra de segurança: não permitir recuperar visita já concluída
      if (currentDbVisit.status === 'concluida') {
        onShowToast({
          title: 'Operação Não Permitida',
          message: 'Esta visita já foi concluída anteriormente e não pode ser reaberta.',
          type: 'warning'
        });
        setRecoverModalVisit(null);
        await loadPortalData();
        return;
      }

      // Regra de elegibilidade temporal: data planejada não pode ser futura e não pode exceder 30 dias (ciclo mensal)
      if (currentDbVisit.data_visita > todayStr) {
        onShowToast({
          title: 'Data Futura',
          message: 'Visitas futuras não podem ser recuperadas antecipadamente como pendência.',
          type: 'warning'
        });
        setRecoverModalVisit(null);
        return;
      }

      const diffDays = Math.round((new Date(todayStr).getTime() - new Date(currentDbVisit.data_visita).getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 30) {
        onShowToast({
          title: 'Período Excedido',
          message: 'Visitas anteriores a 30 dias pertencem a ciclos operacionais já encerrados para auditoria.',
          type: 'warning'
        });
        setRecoverModalVisit(null);
        return;
      }

      const nowIso = new Date().toISOString();

      // Preservar started_at original se já existia (ex: visita que começou e foi interrompida); caso contrário, registrar nowIso
      const effectiveStartedAt = currentDbVisit.started_at || nowIso;

      // 2. Atualizar status para 'em_andamento' preservando motivo_nao_realizada original
      const { data: updatedVisitData, error: updateErr } = await supabase
        .from('visits')
        .update({
          status: 'em_andamento',
          started_at: effectiveStartedAt,
          updated_at: nowIso
        })
        .eq('id', currentDbVisit.id)
        .eq('promotor_matricula', promotorMatricula)
        .select(`
          *,
          industria:industrias(codigo, nome),
          loja:lojas(codigo, nome, cidade, uf, endereco),
          promotor:promotores(matricula, nome),
          checklist_items:visit_checklist_items(*),
          photos:visit_photos(*),
          occurrences:visit_occurrences(*),
          validity_items:visit_product_validity(*)
        `)
        .single();

      if (updateErr) throw updateErr;

      // 3. Registrar ocorrência de auditoria em visit_occurrences registrando a recuperação com atraso
      try {
        const originalDateFmt = currentDbVisit.data_visita.split('-').reverse().join('/');
        const todayFmt = todayStr.split('-').reverse().join('/');
        await supabase.from('visit_occurrences').insert([
          {
            visit_id: currentDbVisit.id,
            tipo: 'outro',
            descricao: `[Recuperação de Pendência]: Visita originalmente planejada para ${originalDateFmt} recuperada para execução em ${todayFmt} com atraso.`
          }
        ]);
      } catch (occErr) {
        console.warn('Aviso: Falha ao registrar ocorrência de auditoria da recuperação:', occErr);
      }

      // 4. Carregar signedUrls para fotos existentes sem perder nada
      const loadedVisit = (updatedVisitData || currentDbVisit) as Visit;
      if (loadedVisit.photos && loadedVisit.photos.length > 0) {
        const photosWithSignedUrls = await Promise.all(
          loadedVisit.photos.map(async (p) => {
            if (p.storage_path) {
              const { data: sData } = await supabase!.storage
                .from('visit-photos')
                .createSignedUrl(p.storage_path, 3600);
              if (sData?.signedUrl) {
                return { ...p, signed_url: sData.signedUrl };
              }
            }
            return p;
          })
        );
        loadedVisit.photos = photosWithSignedUrls;
      }

      // 5. Configurar visita ativa no formulário de atendimento
      setActiveVisit(loadedVisit);
      setGeneralObs(loadedVisit.observacao_geral || '');

      // Preservar checklist preenchido ou carregar padrão
      setChecklist(createChecklistState(loadedVisit.checklist_items));

      onShowToast({
        title: 'Visita Recuperada com Sucesso!',
        message: `Atendimento liberado para a loja ${loadedVisit.loja?.nome || loadedVisit.loja_codigo} (Planejada para ${loadedVisit.data_visita.split('-').reverse().join('/')}).`,
        type: 'success'
      });

      setRecoverModalVisit(null);
      await loadPortalData();

      // Rolar suavemente para a área de atendimento
      setTimeout(() => {
        const el = document.getElementById('active-visit-section');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 250);
    } catch (err: any) {
      console.error('Erro ao recuperar visita pendente:', err);
      onShowToast({
        title: 'Falha ao Recuperar Visita',
        message: err.message || 'Não foi possível reabrir a pendência no banco de dados.',
        type: 'error'
      });
    } finally {
      setRecoveringVisit(false);
    }
  };

  return (
    <div className="w-full px-4 sm:px-6 py-6 max-w-4xl mx-auto space-y-6 font-sans">
      {/* CABEÇALHO PORTAL MOBILE-FIRST */}
      <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#CFCDC5] pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-amber-500 flex items-center justify-center font-bold text-white shadow-[0_0_15px_rgba(245,158,11,0.4)]">
              <span className="material-symbols-outlined text-[22px]">
                {isAdminUser ? 'manage_accounts' : 'smartphone'}
              </span>
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-[#171717] tracking-tight">
                {isAdminUser ? 'Portal do Promotor — Administração' : 'Portal do Promotor'}
              </h1>
              <p className="text-xs text-[#77766F] font-mono">
                {isAdminUser
                  ? 'Consulte promotores, suas rotas planejadas e os atendimentos realizados em campo.'
                  : `${realName} ${realMatricula ? `• Matrícula: ${realMatricula}` : ''}`}
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={loadPortalData}
          disabled={loading}
          className="px-4 py-2 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] text-xs font-semibold text-[#171717] hover:text-white flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>
            refresh
          </span>
          <span>{isAdminUser ? 'Atualizar Dados' : 'Atualizar Minha Rota'}</span>
        </button>
      </section>

      {/* SELETOR ADMINISTRATIVO DE PROMOTOR (Exclusivo para perfis administrativos) */}
      {isAdminUser && (
        <section className="p-5 rounded-2xl bg-[#F7F6F2] border border-[#CFCDC5] shadow-xs space-y-4 font-mono">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#171717] flex items-center gap-2">
                <span className="material-symbols-outlined text-sm text-[#286FF5]">person_search</span>
                Selecionar Promotor para Consulta
              </span>
              <p className="text-[11px] text-[#77766F] mt-0.5">
                Escolha um profissional para visualizar sua programação, o andamento das visitas e os registros de campo.
              </p>
            </div>

            <div className="w-full sm:w-96 min-w-[280px]">
              <SearchableSelect
                id="promoter-admin-select"
                value={selectedPromoterMatricula}
                placeholder="Selecione um promotor..."
                options={adminPromotersList.map((p) => ({
                  value: p.matricula,
                  label: `${p.nome} (${p.matricula})`,
                  searchText: `${p.nome} ${p.matricula} ${p.cidade || ''} ${p.uf || ''} ${p.supervisor || ''}`,
                  detail: p.cidade ? `${p.cidade} - ${p.uf || ''}` : undefined
                }))}
                onChange={(val) => setSelectedPromoterMatricula(val)}
              />
            </div>
          </div>

          {!selectedPromoterMatricula && (
            <div className="py-12 px-4 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] text-center space-y-2">
              <span className="material-symbols-outlined text-3xl text-[#77766F]">person_search</span>
              <h3 className="text-sm font-bold text-[#171717]">
                Selecione um promotor para consultar seus atendimentos.
              </h3>
              <p className="text-xs text-[#5F5F5F] max-w-md mx-auto">
                Escolha um profissional para visualizar sua programação, o andamento das visitas e os registros de campo.
              </p>
            </div>
          )}
        </section>
      )}

      {/* BANNER DE AUTORIZAÇÃO INDIVIDUAL DO PROMOTOR (Etapa 4.1 - Exibido apenas para promotores reais de campo) */}
      {!isAdminUser && isImplantacaoMode && !loading && (
        !isAuthorized ? (
          <section className="bg-amber-950/30 border border-amber-500/40 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono shadow-lg">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-amber-400 text-2xl mt-0.5">lock_clock</span>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30 text-[10px] uppercase">
                    Fase de Preparação (Piloto)
                  </span>
                  <span className="text-[#77766F] text-[11px]">• Aguardando Liberação</span>
                </div>
                <p className="text-[#171717] text-xs font-sans leading-relaxed">
                  Suas rotas cadastradas estão disponíveis para visualização e planejamento. A realização de check-ins em campo está temporariamente bloqueada até que o administrador libere o seu usuário para o teste piloto.
                </p>
              </div>
            </div>
            <span className="px-3 py-1.5 rounded-xl bg-[#E4E2DB] border border-amber-500/30 text-amber-300 text-[11px] font-bold self-start sm:self-auto shrink-0">
              Operação Pré-Liberada
            </span>
          </section>
        ) : (
          <section className="bg-emerald-950/25 border border-emerald-500/40 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono shadow-lg">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-emerald-400 text-2xl mt-0.5">verified_user</span>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30 text-[10px] uppercase">
                    Piloto Liberado
                  </span>
                  <span className="text-[#77766F] text-[11px]">• Operação Autorizada</span>
                </div>
                <p className="text-[#171717] text-xs font-sans leading-relaxed">
                  Seu usuário está liberado para executar check-in, checklists e fotos nas suas rotas programadas. Os dados registrados serão auditados pela coordenação.
                </p>
              </div>
            </div>
            <span className="px-3 py-1.5 rounded-xl bg-[#E4E2DB] border border-emerald-500/30 text-emerald-300 text-[11px] font-bold self-start sm:self-auto shrink-0">
              🟢 Liberado para Teste
            </span>
          </section>
        )
      )}

      {/* CARTÃO DE PERFIL DETALHADO DO PROMOTOR (Exibido para promotores reais ou para administradores quando houver promotor selecionado) */}
      {(!isAdminUser || selectedPromoterMatricula) && (
        <div className="p-5 rounded-2xl bg-[#F7F6F2] border border-[#CFCDC5] shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-[#222222] flex items-center justify-center font-extrabold text-[#171717] text-lg font-mono border border-[#CFCDC5] shrink-0 shadow-xs">
              {initials}
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-extrabold text-[#171717] tracking-tight">
                {realName}
              </h2>
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                {realMatricula ? (
                  <span className="px-2.5 py-1 rounded-lg bg-[#E4E2DB] border border-[#CFCDC5] text-[#222222] font-bold">
                    Matrícula: {realMatricula}
                  </span>
                ) : (
                  !isAdminUser && (
                    <span className="px-2.5 py-1 rounded-lg bg-[#FDF2F2] border border-[#F8C8C8] text-[#C62828] font-bold flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs">warning</span>
                      Promotor não vinculado
                    </span>
                  )
                )}

                {(realCidade || realUf) && (
                  <span className="text-[#5F5F5F] flex items-center gap-1 bg-[#E4E2DB] px-2.5 py-1 rounded-lg border border-[#CFCDC5]">
                    <span className="material-symbols-outlined text-xs text-[#286FF5]">location_on</span>
                    {realCidade}{realUf ? ` - ${realUf}` : ''}
                  </span>
                )}
              </div>
            </div>
          </div>

          {(realSupervisor || realEquipe) && (
            <div className="p-3.5 rounded-xl bg-[#E4E2DB] border border-[#CFCDC5] text-xs font-mono space-y-1.5 w-full sm:w-auto text-left sm:text-right">
              {realSupervisor && (
                <div className="text-[#222222]">
                  <span className="text-[#5F5F5F]">Supervisor:</span> <strong className="text-[#171717]">{realSupervisor}</strong>
                </div>
              )}
              {realEquipe && (
                <div className="text-[#286FF5]">
                  <span className="text-[#5F5F5F]">Equipe:</span> <strong className="text-[#286FF5]">{realEquipe}</strong>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 1. RESUMO EXECUTIVO DO DIA / RESUMO DO PROMOTOR */}
      {(!isAdminUser || selectedPromoterMatricula) && (
        <section className="space-y-3">
          {isAdminUser && (
            <div className="flex items-center gap-2 font-mono text-xs font-bold text-[#171717]">
              <span className="material-symbols-outlined text-base text-[#286FF5]">analytics</span>
              <span>Resumo do Promotor (Hoje)</span>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 font-mono">
            <div className="p-2.5 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5]">
              <span className="text-[9px] text-[#5F5F5F] block font-bold uppercase">PLANEJADAS</span>
              <span className="text-xl font-extrabold text-[#171717]">{totalPlanned}</span>
            </div>

            <div className="p-2.5 rounded-xl bg-[#F7F6F2] border border-[#FCE19B]">
              <span className="text-[9px] text-[#986000] block font-bold uppercase">EM ANDAMENTO</span>
              <span className="text-xl font-extrabold text-[#986000]">{inProgressCount}</span>
            </div>

            <div className="p-2.5 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5]">
              <span className="text-[9px] text-[#5F5F5F] block font-bold uppercase">PENDENTES</span>
              <span className="text-xl font-extrabold text-[#222222]">{pendingCount}</span>
            </div>

            <div className="p-2.5 rounded-xl bg-[#F7F6F2] border border-[#B9E5D0]">
              <span className="text-[9px] text-[#16794F] block font-bold uppercase">CONCLUÍDAS</span>
              <span className="text-xl font-extrabold text-[#16794F]">{completedCount}</span>
            </div>

            <div className="p-2.5 rounded-xl bg-[#F7F6F2] border border-[#F8C8C8] col-span-2 sm:col-span-1">
              <span className="text-[9px] text-[#C62828] block font-bold uppercase">NÃO REALIZADAS</span>
              <span className="text-xl font-extrabold text-[#C62828]">{notDoneCount}</span>
            </div>
          </div>

          {/* Barra de Progresso de Execução */}
          <div className="p-4 rounded-2xl bg-[#F7F6F2] border border-[#CFCDC5] space-y-2">
            <div className="flex justify-between items-center text-xs font-mono">
              <span className="text-[#171717] font-bold">Meta de Atendimento Diário:</span>
              <span className="text-[#286FF5] font-bold">{completedCount} de {totalPlanned} lojas atendidas</span>
            </div>
            <div className="w-full bg-[#E4E2DB] h-3 rounded-full overflow-hidden p-0.5 border border-[#CFCDC5]">
              <div
                className="bg-gradient-to-r from-amber-500 via-purple-500 to-emerald-500 h-2 rounded-full transition-all duration-500"
                style={{ width: `${executionPerc}%` }}
              />
            </div>
          </div>
        </section>
      )}



      {/* 2. AGENDA DE HOJE / PROGRAMAÇÃO DE VISITAS */}
      {(!isAdminUser || selectedPromoterMatricula) && (
        <section className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#CFCDC5] pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#286FF5] text-xl">
                  {isAdminUser ? 'calendar_month' : 'today'}
                </span>
                <h2 className="text-base font-extrabold text-[#171717] font-mono tracking-tight">
                  {isAdminUser
                    ? `Programação de Visitas — Hoje (${todayStr.split('-').reverse().join('/')})`
                    : `Agenda de Hoje (${todayStr.split('-').reverse().join('/')})`}
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-[#E4E2DB] text-[#222222] text-[10px] font-bold font-mono">
                  {todayOperationalVisits.length} {todayOperationalVisits.length === 1 ? 'loja' : 'lojas'}
                </span>
              </div>
              <p className="text-xs text-[#77766F] font-mono mt-0.5">
                {isAdminUser
                  ? 'Rotas programadas e atendimentos registrados para este promotor na data atual.'
                  : 'Rotas previstas e em atendimento ordenadas para o seu dia de trabalho.'}
              </p>
            </div>
          </div>

        {/* ALERTA CONTEXTUAL DE ATENDIMENTO ATIVO (Etapa 1) */}
        {activeVisit && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/40 font-mono text-xs flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-md animate-fadeIn">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping shrink-0" />
                <span className="text-amber-300 font-extrabold uppercase tracking-wide">
                  Atendimento em Andamento
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/30 font-bold">
                  {activeVisit.data_visita.split('-').reverse().join('/')}
                </span>
              </div>
              <p className="text-[#171717] text-[11px] leading-relaxed">
                Você possui uma visita aberta na loja <strong className="text-[#171717]">{activeVisit.loja?.nome || activeVisit.loja_codigo}</strong> ({activeVisit.industria?.nome || activeVisit.industria_codigo}). Conclua o preenchimento ou interrompa com justificativa para iniciar outra rota.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  const el = document.getElementById('active-visit-section');
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth' });
                  }
                }}
                className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs flex items-center gap-1.5 cursor-pointer shadow-md transition-colors"
              >
                <span className="material-symbols-outlined text-sm">edit_note</span>
                <span>Voltar para atendimento atual</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setInterruptModalVisit(activeVisit);
                  setInterruptReason('');
                }}
                className="px-3 py-2 rounded-xl bg-[#EAE8E2] hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
                title="Interromper atendimento com justificativa obrigatória"
              >
                <span className="material-symbols-outlined text-sm">close</span>
                <span>Interromper com justificativa</span>
              </button>
            </div>
          </div>
        )}

        {todayOperationalVisits.length === 0 ? (
          <div className="py-4 px-3 text-center space-y-1.5 font-mono">
            <div className="w-8 h-8 rounded-full bg-[#EAE8E2] border border-[#CFCDC5] flex items-center justify-center text-[#5F5F5F] mx-auto">
              <span className="material-symbols-outlined text-lg">event_available</span>
            </div>
            <h4 className="text-xs font-bold text-[#171717]">Nenhuma Rota Prevista para Hoje</h4>
            <p className="text-[11px] text-[#77766F] max-w-sm mx-auto">
              Não há lojas agendadas para a data atual ({todayStr.split('-').reverse().join('/')}). Consulte o histórico semanal ou a escala fixa abaixo.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {todayOperationalVisits.map((item, idx) => {
              const routeObj = routes.find((r) => r.id === item.routeId) || {
                id: item.routeId,
                promotor_matricula: item.promotorMatricula,
                loja_codigo: item.lojaCodigo,
                industria_codigo: item.industriaCodigo,
                frequencia: item.frequencia,
                loja: { codigo: item.lojaCodigo, nome: item.lojaNome, cidade: item.lojaCidade, uf: item.lojaUf },
                industria: { codigo: item.industriaCodigo, nome: item.industriaNome }
              } as RouteItem;

              const isCurrentActive = activeVisit && (activeVisit.id === item.visitObj?.id || (activeVisit.loja_codigo === item.lojaCodigo && activeVisit.data_visita === item.dataStr));

              return (
                <div
                  key={`today_${item.key}_${item.dataStr}`}
                  className={`p-4 rounded-xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 font-mono ${
                    isCurrentActive
                      ? 'bg-amber-950/30 border-2 border-amber-500 shadow-lg'
                      : item.status === 'concluida'
                      ? 'bg-emerald-950/20 border-emerald-500/30'
                      : item.status === 'em_andamento'
                      ? 'bg-amber-950/20 border-amber-500/50'
                      : item.status === 'nao_realizada'
                      ? 'bg-rose-950/20 border-rose-500/30'
                      : 'bg-[#EAE8E2] border-[#CFCDC5]'
                  }`}
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[#F7F6F2] border border-[#CFCDC5] text-[#7E22CE] font-bold text-[10px] flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase flex items-center gap-1 shrink-0 ${
                          item.status === 'concluida'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : item.status === 'em_andamento'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse'
                            : item.status === 'nao_realizada'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            : item.status === 'pendente'
                            ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
                            : 'bg-slate-800 text-slate-300 border border-[#CFCDC5]'
                        }`}
                      >
                        {item.status === 'concluida' && '🟢 Concluída'}
                        {item.status === 'em_andamento' && '🔵 Em andamento'}
                        {item.status === 'pendente' && '🟡 Pendente'}
                        {item.status === 'nao_realizada' && '🟠 Não realizada'}
                        {item.status === 'planejada' && '⚪ Planejada'}
                      </span>
                    </div>

                    <h4 className="text-sm font-bold text-[#171717] truncate">
                      {item.lojaNome}
                    </h4>

                    <p className="text-[11px] text-[#77766F]">
                      {item.lojaCidade || '—'}/{item.lojaUf || '-'} • Indústria: <span className="text-[#7E22CE] font-bold">{item.industriaNome}</span>
                    </p>

                    <div className="flex flex-wrap items-center gap-3 text-[10px] text-[#5F5F5F]">
                      {item.startedAt && (
                        <span>Check-in: <strong className="text-amber-300">{new Date(item.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong></span>
                      )}
                      {item.completedAt && (
                        <span>Concluído: <strong className="text-emerald-300">{new Date(item.completedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong></span>
                      )}
                      {item.motivoNaoRealizada && (
                        <span className="text-rose-400">Motivo: <strong>{item.motivoNaoRealizada}</strong></span>
                      )}
                    </div>
                  </div>

                  {/* Ação Única e Clara por Cartão */}
                  <div className="flex items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-[#CFCDC5]">
                    {isAdminUser ? (
                      <button
                        type="button"
                        onClick={() => setAdminInspectionVisit(item)}
                        className="px-3 py-1.5 rounded-xl bg-[#E4E2DB] hover:bg-[#CFCDC5] text-[#171717] border border-[#CFCDC5] text-xs font-bold font-mono flex items-center gap-1.5 cursor-pointer transition-colors"
                        title="Inspecionar detalhes e evidências desta visita"
                      >
                        <span className="material-symbols-outlined text-sm text-[#286FF5]">visibility</span>
                        <span>Ver Detalhes</span>
                      </button>
                    ) : (
                      (item.status === 'pendente' || item.status === 'planejada') && (
                        isImplantacaoMode && !isAuthorized ? (
                          <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#FFF8E6] border border-[#FCE19B] text-[#986000] text-xs font-mono font-bold">
                            <span className="material-symbols-outlined text-sm">lock</span>
                            <span>Aguardando Liberação</span>
                          </div>
                        ) : activeVisit ? (
                          <div className="flex flex-wrap items-center gap-1.5 w-full md:w-auto">
                            <button
                              onClick={() => handleStartVisit(routeObj)}
                              disabled={Boolean(startingRouteId)}
                              className="px-3.5 py-2 rounded-xl bg-[#E4E2DB] hover:bg-[#CFCDC5] text-[#222222] border border-[#AAA79E] font-bold text-xs flex items-center justify-center gap-1 cursor-pointer transition-colors shadow-xs"
                              title="Trocar para esta loja (exige finalizar ou interromper o atendimento atual)"
                            >
                              <span className="material-symbols-outlined text-sm">play_arrow</span>
                              <span>Iniciar Esta</span>
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={() => handleStartVisit(routeObj)}
                              disabled={Boolean(startingRouteId)}
                              className="w-full md:w-auto px-4 py-2.5 rounded-xl bg-[#222222] hover:bg-black disabled:bg-[#CFCDC5] disabled:text-[#737373] disabled:cursor-not-allowed text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                            >
                              <span className={`material-symbols-outlined text-sm ${startingRouteId === routeObj.id ? 'animate-spin' : ''}`}>
                                {startingRouteId === routeObj.id ? 'sync' : 'play_arrow'}
                              </span>
                              <span>{startingRouteId === routeObj.id ? 'Iniciando...' : 'Iniciar Visita'}</span>
                            </button>
                            <button
                              onClick={() => setShowNotDoneModal(routeObj)}
                              disabled={Boolean(startingRouteId)}
                              className="px-3 py-2.5 rounded-xl bg-[#F7F6F2] hover:bg-[#FDF2F2] disabled:bg-[#E4E2DB] disabled:text-[#737373] text-[#5F5F5F] hover:text-[#C62828] border border-[#CFCDC5] text-xs font-bold cursor-pointer transition-colors"
                              title="Registrar Não Atendimento"
                            >
                              Não Atendido
                            </button>
                          </>
                        )
                      )
                    )}

                    {!isAdminUser && item.status === 'em_andamento' && (
                      <div className="flex items-center gap-2 w-full md:w-auto">
                        <button
                          onClick={() => {
                            if (item.visitObj) {
                              handleResumeStaleVisit(item.visitObj);
                            }
                          }}
                          className="flex-1 md:flex-none px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-colors"
                        >
                          <span className="material-symbols-outlined text-sm">edit_note</span>
                          <span>{isCurrentActive ? 'Preenchendo Abaixo' : 'Continuar Atendimento'}</span>
                        </button>
                        <button
                          onClick={() => {
                            if (item.visitObj) {
                              setInterruptModalVisit(item.visitObj);
                              setInterruptReason('');
                            }
                          }}
                          className="px-3 py-2.5 rounded-xl bg-[#F7F6F2] hover:bg-rose-500/20 text-[#171717] hover:text-rose-300 border border-[#CFCDC5] text-xs font-bold cursor-pointer transition-colors"
                          title="Interromper atendimento desta loja"
                        >
                          <span className="material-symbols-outlined text-sm text-rose-400">close</span>
                          <span className="hidden sm:inline">Interromper</span>
                        </button>
                      </div>
                    )}

                    {item.status === 'concluida' && (
                      <span className="text-xs text-emerald-400 font-bold flex items-center gap-1 px-3 py-2 bg-emerald-500/10 rounded-xl border border-emerald-500/30">
                        <span className="material-symbols-outlined text-sm">check_circle</span>
                        Concluída
                      </span>
                    )}

                    {item.status === 'nao_realizada' && (
                      <span className="text-xs text-rose-400 font-bold flex items-center gap-1 px-3 py-2 bg-rose-500/10 rounded-xl border border-rose-500/30">
                        <span className="material-symbols-outlined text-sm">cancel</span>
                        Não Realizada
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      )}

      {/* 2. PENDÊNCIAS DE DIAS ANTERIORES (VISITAS ANTERIORES NÃO CONCLUÍDAS - VISÍVEL APENAS PARA PROMOTOR OPERACIONAL) */}
      {!isAdminUser && (staleInProgressVisits.length > 0 || staleNotDoneVisits.length > 0) && (
        <section className="bg-amber-950/20 border-2 border-amber-500/50 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-6">
          <div className="flex items-start gap-3 border-b border-amber-500/30 pb-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
              <span className="material-symbols-outlined text-2xl">pending_actions</span>
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded bg-amber-500/30 text-amber-200 font-bold border border-amber-500/40 text-xs font-mono uppercase tracking-wide">
                  Pendências de dias anteriores
                </span>
                <span className="text-xs text-amber-300 font-mono font-bold">
                  {staleInProgressVisits.length + staleNotDoneVisits.length} {staleInProgressVisits.length + staleNotDoneVisits.length === 1 ? 'visita pendente' : 'visitas pendentes'}
                </span>
              </div>
              <p className="text-[#171717] text-xs leading-relaxed font-mono">
                Visitas de datas anteriores à data de hoje que não foram concluídas. Não misturadas com os indicadores diários de hoje.
              </p>
            </div>
          </div>

          {/* GRUPO 1: VISITAS EM ANDAMENTO */}
          {staleInProgressVisits.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping"></span>
                <h3 className="font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm">timelapse</span>
                  Em andamento ({staleInProgressVisits.length})
                </h3>
                <span className="text-[11px] text-[#77766F]">
                  — Visitas iniciadas que ficaram em aberto
                </span>
              </div>

              <div className="space-y-3">
                {staleInProgressVisits.map((stale) => {
                  const elapsedDesc = (() => {
                    if (!stale.started_at) return null;
                    const startMs = new Date(stale.started_at).getTime();
                    const nowMs = Date.now();
                    const diffHours = Math.floor((nowMs - startMs) / (1000 * 60 * 60));
                    const diffDays = Math.floor(diffHours / 24);
                    if (diffDays > 0) return `Iniciada há ${diffDays}d e ${diffHours % 24}h`;
                    if (diffHours > 0) return `Iniciada há ${diffHours}h`;
                    return 'Iniciada há menos de 1h';
                  })();

                  const isCurrentActive = activeVisit?.id === stale.id;

                  return (
                    <div
                      key={`stale_prog_${stale.id}`}
                      className={`p-4 rounded-xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 font-mono ${
                        isCurrentActive
                          ? 'bg-[#FFF8E6] border-2 border-amber-400 shadow-lg'
                          : 'bg-[#EAE8E2] border-amber-500/40 hover:border-amber-500/70'
                      }`}
                    >
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase flex items-center gap-1">
                            <span className="material-symbols-outlined text-xs animate-spin">refresh</span>
                            Em andamento
                          </span>
                          <span className="text-amber-400 text-xs font-bold">
                            Data: {stale.data_visita.split('-').reverse().join('/')}
                          </span>
                          {stale.started_at && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#F7F6F2] text-[#171717] border border-[#CFCDC5]">
                              Início: {new Date(stale.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                          {elapsedDesc && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-200 border border-amber-500/30">
                              {elapsedDesc}
                            </span>
                          )}
                        </div>

                        <h4 className="text-sm font-bold text-[#171717] truncate">
                          {stale.loja?.nome || stale.loja_codigo}
                        </h4>

                        <p className="text-[11px] text-[#77766F]">
                          {stale.loja?.cidade || '—'}/{stale.loja?.uf || '-'} • Indústria: <span className="text-[#7E22CE] font-bold">{stale.industria?.nome || stale.industria_codigo}</span>
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-[#CFCDC5]">
                        <button
                          onClick={() => handleResumeStaleVisit(stale)}
                          className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs flex items-center gap-1.5 cursor-pointer shadow-md transition-colors"
                        >
                          <span className="material-symbols-outlined text-sm">play_arrow</span>
                          <span>{isCurrentActive ? 'Preenchendo Abaixo' : 'Continuar Visita'}</span>
                        </button>
                        <button
                          onClick={() => {
                            setInterruptModalVisit(stale);
                            setInterruptReason('');
                          }}
                          className="px-3 py-2.5 rounded-xl bg-[#F7F6F2] hover:bg-rose-500/20 text-[#171717] hover:text-rose-300 border border-[#CFCDC5] text-xs font-bold cursor-pointer transition-colors"
                          title="Interromper atendimento com justificativa obrigatória"
                        >
                          <span className="material-symbols-outlined text-sm text-rose-400">close</span>
                          <span>Interromper Atendimento</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* GRUPO 2: VISITAS NÃO REALIZADAS */}
          {staleNotDoneVisits.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="material-symbols-outlined text-rose-400 text-sm">cancel</span>
                <h3 className="font-bold text-rose-300 uppercase tracking-wider">
                  Não realizadas ({staleNotDoneVisits.length})
                </h3>
                <span className="text-[11px] text-[#77766F]">
                  — Registros de dias anteriores com justificativa (somente leitura)
                </span>
              </div>

              <div className="space-y-3">
                {staleNotDoneVisits.map((stale) => (
                  <div
                    key={`stale_notdone_${stale.id}`}
                    className="p-4 rounded-xl bg-[#EAE8E2] border border-rose-500/30 hover:border-rose-500/50 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 font-mono"
                  >
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 uppercase flex items-center gap-1">
                          <span className="material-symbols-outlined text-xs">cancel</span>
                          Não realizada
                        </span>
                        <span className="text-rose-300 text-xs font-bold">
                          Data: {stale.data_visita.split('-').reverse().join('/')}
                        </span>
                      </div>

                      <h4 className="text-sm font-bold text-[#171717] truncate">
                        {stale.loja?.nome || stale.loja_codigo}
                      </h4>

                      <p className="text-[11px] text-[#77766F]">
                        {stale.loja?.cidade || '—'}/{stale.loja?.uf || '-'} • Indústria: <span className="text-[#7E22CE] font-bold">{stale.industria?.nome || stale.industria_codigo}</span>
                      </p>

                      <div className="p-2.5 rounded-lg bg-[#F7F6F2] border border-[#CFCDC5] text-xs text-rose-300/90 flex items-start gap-2 mt-1">
                        <span className="material-symbols-outlined text-sm text-rose-400 shrink-0 mt-0.5">comment</span>
                        <div>
                          <span className="text-[#77766F] font-bold">Motivo registrado: </span>
                          <span className="font-medium text-white">{stale.motivo_nao_realizada || 'Não informado'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-[#CFCDC5]">
                      <button
                        onClick={() => setRecoverModalVisit(stale)}
                        className="px-3.5 py-2 rounded-xl bg-[#222222] hover:bg-black text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md transition-colors"
                        title="Recuperar esta pendência para execução na data de hoje"
                      >
                        <span className="material-symbols-outlined text-sm">replay</span>
                        <span>Realizar hoje</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* TELA DE FLUXO DA VISITA EM ANDAMENTO (Apenas para promotores em campo) */}
      {!isAdminUser && activeVisit ? (
        <section id="active-visit-section" className="bg-[#F7F6F2] border-2 border-amber-500/50 rounded-2xl p-6 shadow-2xl space-y-6">
          <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-4">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-amber-400 animate-ping"></span>
              <h2 className="text-base font-bold text-[#171717] font-mono">
                Visita em Andamento — Loja: {activeVisit.loja?.nome || activeVisit.loja_codigo}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {activeVisit.data_visita < todayStr && (
                <span className="px-2.5 py-1 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-300 text-[10px] font-bold font-mono uppercase flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs">schedule</span>
                  Recuperada com Atraso (Orig: {activeVisit.data_visita.split('-').reverse().join('/')})
                </span>
              )}
              <span className="px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold font-mono uppercase">
                EM ANDAMENTO
              </span>
            </div>
          </div>

          {/* Dados Gerais da Visita */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
            <div className="p-3 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5]">
              <span className="text-[#5F5F5F] block">LOJA / ENDEREÇO:</span>
              <span className="text-white font-bold block">{activeVisit.loja?.nome}</span>
              <span className="text-[#77766F] block">{activeVisit.loja?.endereco} • {activeVisit.loja?.cidade}/{activeVisit.loja?.uf}</span>
            </div>

            <div className="p-3 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5]">
              <span className="text-[#5F5F5F] block">INDÚSTRIA PARCEIRA:</span>
              <span className="text-[#7E22CE] font-bold block">{activeVisit.industria?.nome || activeVisit.industria_codigo}</span>
              <span className="text-[#77766F] block">Horário Check-in: {activeVisit.started_at ? new Date(activeVisit.started_at).toLocaleTimeString('pt-BR') : '—'}</span>
            </div>
          </div>

          {/* PASSO 1: CHECKLIST OPERACIONAL */}
          <div className="space-y-3 pt-2 border-t border-[#CFCDC5]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h3 className="text-xs font-bold text-slate-[#171717] uppercase tracking-wider font-mono flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400 text-sm">fact_check</span>
                Checklist operacional
              </h3>
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                  {Object.values(checklist).filter((item) => item.answered).length} de {DEFAULT_CHECKLIST_ITEMS.length} respondidos
                </span>
                {pendingChecklistWrites > 0 && (
                  <span className="text-[10px] text-cyan-400 font-bold flex items-center gap-1 animate-pulse">
                    <span className="material-symbols-outlined text-xs animate-spin">sync</span>
                    Salvando...
                  </span>
                )}
              </div>
            </div>

            {checklistSaveError && (
              <p role="alert" className="text-[11px] text-rose-400">{checklistSaveError}</p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {CHECKLIST_GROUPS.map((group) => (
                <section
                  key={group.title}
                  aria-label={group.title}
                  className="p-3.5 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] space-y-3"
                >
                  <h4 className="text-[11px] font-bold text-[#171717] uppercase tracking-wide font-mono">
                    {group.title}
                  </h4>
                  <div className="space-y-3">
                    {group.itemKeys.map((itemKey) => {
                      const item = DEFAULT_CHECKLIST_ITEMS.find((candidate) => candidate.item_key === itemKey);
                      if (!item) return null;

                      const state = checklist[item.item_key] || {
                        checked: false,
                        answered: false,
                        obs: '',
                        valTxt: ''
                      };
                      const isQuantity = CHECKLIST_QUANTITY_KEYS.has(item.item_key);

                      return (
                        <div key={item.item_key} className="space-y-2">
                          <label
                            htmlFor={`visit-checklist-${item.item_key}`}
                            className="block text-xs font-semibold text-[#171717]"
                          >
                            {item.item_label}
                          </label>
                          <input
                            id={`visit-checklist-${item.item_key}`}
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            value={state.valTxt}
                            disabled={completingVisit}
                            onChange={(event) =>
                              handleChecklistChange(
                                item,
                                state.checked,
                                state.obs,
                                event.target.value,
                                Boolean(event.target.value.trim())
                              )
                            }
                            placeholder={
                              item.item_key === 'qtd_produtos_deposito'
                                ? 'Informe a quantidade (0 se não houver)'
                                : 'Quantidade na área de vendas'
                            }
                            className="w-full h-10 px-3 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg text-sm text-[#171717] focus:outline-none focus:border-amber-500 disabled:opacity-60"
                          />
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>

          {/* PASSO 2: ANEXAR FOTOS DO PONTO DE VENDA */}
          <div className="space-y-3 pt-3 border-t border-[#CFCDC5]">
            <h3 className="text-xs font-bold text-slate-[#171717] uppercase tracking-wider font-mono flex items-center gap-2">
              <span className="material-symbols-outlined text-cyan-400 text-sm">photo_camera</span>
              D. Evidências fotográficas do PDV
            </h3>

            <div className="p-4 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] space-y-3 font-mono text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[#77766F] block mb-1">TIPO DA FOTO (*)</label>
                  <select
                    value={photoType}
                    onChange={(e) => setPhotoType(e.target.value as any)}
                    className="w-full h-9 px-2 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg text-[#171717]"
                  >
                    <option value="fachada">FACHADA</option>
                    <option value="gondola">GÔNDOLA / EXPOSIÇÃO</option>
                    <option value="preco">PREÇO ETIQUETADO</option>
                    <option value="ponto_extra">PONTO EXTRA</option>
                    <option value="ruptura">RUPTURA</option>
                    <option value="outros">OUTROS</option>
                  </select>
                  <span className="mt-1 block text-[10px] text-[#77766F]">
                    Foto do depósito: use OUTROS e identifique na legenda.
                  </span>
                </div>

                <div className="sm:col-span-2">
                  <label className="text-[#77766F] block mb-1">LEGENDA / OBSERVAÇÃO</label>
                  <input
                    type="text"
                    value={photoCaption}
                    onChange={(e) => setPhotoCaption(e.target.value)}
                    placeholder="Ex.: foto do depósito ou ponto extra no corredor 3..."
                    className="w-full h-9 px-3 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg text-[#171717]"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleUploadPhoto}
                  disabled={uploadingPhoto || completingVisit}
                  className="hidden"
                />
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleUploadPhoto}
                  disabled={uploadingPhoto || completingVisit}
                  className="hidden"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={uploadingPhoto || completingVisit}
                    className="min-h-11 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <span className={`material-symbols-outlined text-base ${uploadingPhoto ? 'animate-spin' : ''}`}>
                      {uploadingPhoto ? 'sync' : 'photo_camera'}
                    </span>
                    <span>{uploadingPhoto ? (photoStatusMessage || 'Otimizando e enviando...') : 'Tirar foto'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    disabled={uploadingPhoto || completingVisit}
                    className="min-h-11 px-4 py-2.5 rounded-xl bg-[#F7F6F2] hover:bg-[#E4E2DB] text-[#171717] font-bold text-xs flex items-center justify-center gap-2 border border-[#CFCDC5] transition-all cursor-pointer disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-base">photo_library</span>
                    <span>Escolher da galeria</span>
                  </button>
                </div>
              </div>

              {/* Lista de Fotos Anexadas com Preview de Miniaturas */}
              {activeVisit.photos && activeVisit.photos.length > 0 ? (
                <div className="space-y-2 pt-2 border-t border-[#CFCDC5]">
                  <span className="text-[11px] text-[#77766F] font-bold block">FOTOS REGISTRADAS NESTA VISITA ({activeVisit.photos.length}):</span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {activeVisit.photos.map((p, idx) => (
                      <div key={idx} className="p-2 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] space-y-1.5 flex flex-col justify-between">
                        <div className="relative aspect-video rounded-lg bg-[#E4E2DB] overflow-hidden border border-[#CFCDC5] flex items-center justify-center">
                          {(p.signed_url || p.file_url) ? (
                            <img
                              src={p.signed_url || p.file_url}
                              alt={p.legenda || p.tipo_foto}
                              className="w-full h-full object-cover"
                              onError={(err) => {
                                (err.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <span className="material-symbols-outlined text-slate-600 text-2xl">image</span>
                          )}
                          <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-sm text-cyan-300 text-[9px] font-bold uppercase border border-cyan-500/30">
                            {p.tipo_foto}
                          </span>
                        </div>
                        {p.legenda && <p className="text-[10px] text-[#171717] truncate" title={p.legenda}>{p.legenda}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-[#5F5F5F] italic pt-1 text-center">Nenhuma foto enviada para esta visita ainda.</p>
              )}
            </div>
          </div>

          {/* PASSO 3: OCORRÊNCIAS E RUPTURAS */}
          <div className="space-y-3 pt-3 border-t border-[#CFCDC5]">
            <h3 className="text-xs font-bold text-slate-[#171717] uppercase tracking-wider font-mono flex items-center gap-2">
              <span className="material-symbols-outlined text-rose-400 text-sm">report_problem</span>
              3. Ocorrências &amp; Rupturas Registradas
            </h3>

            <div className="p-4 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] space-y-3 font-mono text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[#77766F] block mb-1">TIPO DE INCIDENTE</label>
                  <select
                    value={occurrenceType}
                    onChange={(e) => setOccurrenceType(e.target.value as any)}
                    className="w-full h-9 px-2 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg text-[#171717]"
                  >
                    <option value="ruptura">RUPTURA DE ESTOQUE</option>
                    <option value="preco_divergente">PREÇO DIVERGENTE</option>
                    <option value="falta_espaco">FALTA DE ESPAÇO</option>
                    <option value="outro">OUTRO</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="text-[#77766F] block mb-1">DESCRIÇÃO DA OCORRÊNCIA</label>
                  <input
                    type="text"
                    value={occurrenceDesc}
                    onChange={(e) => setOccurrenceDesc(e.target.value)}
                    placeholder="Descreva a ruptura ou problema..."
                    className="w-full h-9 px-3 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg text-[#171717]"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleAddOccurrence}
                disabled={!occurrenceDesc.trim() || savingOccurrence}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-sm transition-all"
              >
                <span className={`material-symbols-outlined text-sm ${savingOccurrence ? 'animate-spin' : ''}`}>
                  {savingOccurrence ? 'sync' : 'add'}
                </span>
                <span>{savingOccurrence ? 'Salvando ocorrência...' : '+ Registrar Ocorrência'}</span>
              </button>

              {/* Lista de Ocorrências Registradas */}
              {activeVisit.occurrences && activeVisit.occurrences.length > 0 ? (
                <div className="space-y-2 pt-2 border-t border-[#CFCDC5]">
                  <span className="text-[11px] text-[#77766F] font-bold block">OCORRÊNCIAS NESTA VISITA ({activeVisit.occurrences.length}):</span>
                  <div className="space-y-2">
                    {activeVisit.occurrences.map((occ, idx) => (
                      <div key={idx} className="p-3 rounded-xl bg-rose-950/20 border border-rose-500/30 text-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-rose-500/30 text-rose-300 text-[10px] font-bold uppercase">
                              {occ.tipo.replace('_', ' ')}
                            </span>
                            {occ.created_at && (
                              <span className="text-[10px] text-[#77766F]">
                                {new Date(occ.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </div>
                          <p className="text-slate-200 font-mono text-xs">{occ.descricao}</p>
                        </div>
                        <span className="text-[10px] text-amber-400 font-bold px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 self-start sm:self-center">
                          Pendente Gestão
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-[#5F5F5F] italic pt-1 text-center">Nenhuma ocorrência registrada para esta visita.</p>
              )}
            </div>
          </div>

          {/* PASSO 4: CONTROLE DE VALIDADE E VENCIMENTO DE PRODUTOS */}
          <div className="space-y-3 pt-3 border-t border-[#CFCDC5]">
            <h3 className="text-xs font-bold text-slate-[#171717] uppercase tracking-wider font-mono flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-400 text-sm">inventory_2</span>
              4. 📦 Controle de Validade dos Produtos
            </h3>

            <div className="p-4 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] space-y-3 font-mono text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="lg:col-span-2">
                  <label className="text-[#77766F] block mb-1">PRODUTO (*)</label>
                  <input
                    type="text"
                    value={validityProdutoNome}
                    onChange={(e) => setValidityProdutoNome(e.target.value)}
                    placeholder="Nome ou descrição do produto..."
                    className="w-full h-9 px-3 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg text-[#171717]"
                  />
                </div>

                <div>
                  <label className="text-[#77766F] block mb-1">QUANTIDADE (*)</label>
                  <input
                    type="number"
                    min="1"
                    value={validityQuantidade}
                    onChange={(e) => setValidityQuantidade(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full h-9 px-3 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg text-[#171717]"
                  />
                </div>

                <div>
                  <label className="text-[#77766F] block mb-1">VALIDADE (*)</label>
                  <input
                    type="date"
                    value={validityDataVencimento}
                    onChange={(e) => setValidityDataVencimento(e.target.value)}
                    className="w-full h-9 px-3 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg text-[#171717]"
                  />
                </div>

                <div>
                  <label className="text-[#77766F] block mb-1">LOTE (OPCIONAL)</label>
                  <input
                    type="text"
                    value={validityLote}
                    onChange={(e) => setValidityLote(e.target.value)}
                    placeholder="L12345"
                    className="w-full h-9 px-3 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg text-[#171717]"
                  />
                </div>
              </div>

              <div>
                <label className="text-[#77766F] block mb-1">OBSERVAÇÃO (OPCIONAL)</label>
                <input
                  type="text"
                  value={validityObservacao}
                  onChange={(e) => setValidityObservacao(e.target.value)}
                  placeholder="Ex: Produto recolhido / Avaria na embalagem..."
                  className="w-full h-9 px-3 bg-[#F7F6F2] border border-[#CFCDC5] rounded-lg text-[#171717]"
                />
              </div>

              <button
                type="button"
                onClick={handleAddProductValidity}
                disabled={!validityProdutoNome.trim() || !validityDataVencimento || savingValidity}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-sm transition-all"
              >
                <span className={`material-symbols-outlined text-sm ${savingValidity ? 'animate-spin' : ''}`}>
                  {savingValidity ? 'sync' : 'add'}
                </span>
                <span>{savingValidity ? 'Adicionando...' : '+ Adicionar produto'}</span>
              </button>

              {/* Lista de Produtos Registrados na Visita */}
              {activeVisit.validity_items && activeVisit.validity_items.length > 0 ? (
                <div className="space-y-2 pt-2 border-t border-[#CFCDC5]">
                  <span className="text-[11px] text-[#77766F] font-bold block">
                    PRODUTOS E VALIDADES REGISTRADOS ({activeVisit.validity_items.length}):
                  </span>

                  <div className="overflow-x-auto rounded-lg border border-[#CFCDC5]">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-[#F7F6F2] text-[#77766F] text-[10px] font-bold uppercase border-b border-[#CFCDC5]">
                          <th className="py-2 px-3">Produto</th>
                          <th className="py-2 px-3 text-right">Qtd.</th>
                          <th className="py-2 px-3">Validade</th>
                          <th className="py-2 px-3">Lote</th>
                          <th className="py-2 px-3 text-right">Situação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#CFCDC5] text-slate-200">
                        {activeVisit.validity_items.map((valItem, idx) => {
                          // Calcular classificação de vencimento local
                          const [vYear, vMonth, vDay] = valItem.data_vencimento.split('-').map(Number);
                          const vencDate = new Date(vYear, vMonth - 1, vDay);
                          const nDate = new Date();
                          const todayLocal = new Date(nDate.getFullYear(), nDate.getMonth(), nDate.getDate());

                          const diffTime = vencDate.getTime() - todayLocal.getTime();
                          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                          let statusBadge = { label: '🟢 Normal', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
                          if (diffDays < 0) {
                            statusBadge = { label: '🔴 Vencido', color: 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse' };
                          } else if (diffDays <= 3) {
                            statusBadge = { label: '🚨 Até 3 dias', color: 'bg-rose-500/20 text-rose-300 border-rose-500/40' };
                          } else if (diffDays <= 7) {
                            statusBadge = { label: '🟠 4–7 dias', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
                          } else if (diffDays <= 30) {
                            statusBadge = { label: '🟡 8–30 dias', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' };
                          }

                          return (
                            <tr key={valItem.id || idx} className="hover:bg-[#F7F6F2]/50">
                              <td className="py-2 px-3 font-bold text-white">{valItem.produto_nome}</td>
                              <td className="py-2 px-3 text-right font-bold text-amber-300">{valItem.quantidade}</td>
                              <td className="py-2 px-3">{new Date(vencDate).toLocaleDateString('pt-BR')}</td>
                              <td className="py-2 px-3 text-[#77766F]">{valItem.lote || '—'}</td>
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
                </div>
              ) : (
                <p className="text-[11px] text-[#5F5F5F] italic pt-1 text-center">
                  Nenhum produto cadastrado para controle de validade nesta visita.
                </p>
              )}
            </div>
          </div>

          {/* PASSO 5: OBSERVAÇÕES GERAIS E FINALIZAÇÃO */}
          <div className="space-y-4 pt-3 border-t border-[#CFCDC5]">
            <div>
              <label className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono block mb-1.5">
                5. Observações Gerais do Atendimento
              </label>
              <textarea
                value={generalObs}
                onChange={(e) => setGeneralObs(e.target.value)}
                placeholder="Digite impressões gerais, conversas com o gerente da loja..."
                className="w-full p-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-amber-500 font-mono text-xs h-20 resize-none"
              />
            </div>

            {/* PAINEL DE RESUMO DA VISITA PARA FINALIZAÇÃO */}
            <div className="p-4 rounded-xl bg-[#E4E2DB] border border-[#CFCDC5] space-y-3 font-mono text-xs">
              <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-sm">summarize</span>
                Resumo do Atendimento Antes do Check-out
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[#171717]">
                <div className="p-2.5 rounded-lg bg-[#F7F6F2] border border-[#CFCDC5]">
                  <span className="text-[10px] text-[#5F5F5F] block font-bold">HORÁRIO ENTRADA</span>
                  <span className="text-sm font-extrabold text-[#171717]">
                    {activeVisit.started_at ? new Date(activeVisit.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#F7F6F2] border border-[#CFCDC5]">
                  <span className="text-[10px] text-[#5F5F5F] block font-bold">CHECKLIST</span>
                  <span className="text-sm font-extrabold text-amber-300">
                    {Object.values(checklist).filter((item) => item.answered).length} / {DEFAULT_CHECKLIST_ITEMS.length}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#F7F6F2] border border-[#CFCDC5]">
                  <span className="text-[10px] text-[#5F5F5F] block font-bold">FOTOS ANEXADAS</span>
                  <span className="text-sm font-extrabold text-cyan-300">
                    {activeVisit.photos?.length || 0}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#F7F6F2] border border-[#CFCDC5]">
                  <span className="text-[10px] text-[#5F5F5F] block font-bold">OCORRÊNCIAS</span>
                  <span className="text-sm font-extrabold text-rose-300">
                    {activeVisit.occurrences?.length || 0}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#F7F6F2] border border-[#CFCDC5]">
                  <span className="text-[10px] text-[#5F5F5F] block font-bold">VALIDADES</span>
                  <span className="text-sm font-extrabold text-amber-400">
                    {activeVisit.validity_items?.length || 0}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-[#CFCDC5] flex flex-col sm:flex-row items-center justify-between gap-3 font-mono">
            <span className="text-[11px] text-[#77766F] text-center sm:text-left">
              Ao finalizar, o check-out será registrado e a visita não poderá ser reeditada.
            </span>
            <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => {
                  setInterruptModalVisit(activeVisit);
                  setInterruptReason('');
                }}
                disabled={completingVisit}
                className="w-full sm:w-auto px-4 py-3 rounded-xl bg-[#EAE8E2] hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                title="Abandonar ou cancelar esta execução para atender outra loja"
              >
                <span className="material-symbols-outlined text-sm">close</span>
                <span>Interromper Atendimento</span>
              </button>
              <button
                onClick={handleCompleteVisit}
                disabled={completingVisit}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(16,185,129,0.4)] cursor-pointer transition-all"
              >
                <span className={`material-symbols-outlined text-lg ${completingVisit ? 'animate-spin' : ''}`}>
                  {completingVisit ? 'sync' : 'check_circle'}
                </span>
                <span>{completingVisit ? 'Finalizando...' : 'Finalizar Visita & Check-out'}</span>
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {/* 3. HISTÓRICO DE ATENDIMENTOS / AGENDA DA SEMANA */}
      {(!isAdminUser || selectedPromoterMatricula) && (
        <section className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#CFCDC5] pb-4">
            <div
              onClick={() => setIsWeekHistoryOpen((prev) => !prev)}
              className="cursor-pointer select-none flex-1 group"
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#286FF5]">
                  {isAdminUser ? 'history_toggle_off' : 'calendar_view_week'}
                </span>
                <h3 className="text-sm font-bold text-[#171717] uppercase tracking-wider font-mono flex items-center gap-2">
                  {isAdminUser
                    ? `Histórico de Atendimentos — Semana (${allWeekOperationalVisits.length} registros)`
                    : `3. Minha Semana & Histórico (${allWeekOperationalVisits.length} agendadas)`}
                </h3>
                <span className="px-2 py-0.5 rounded bg-[#E4E2DB] border border-[#CFCDC5] text-[#77766F] text-[10px] font-mono group-hover:text-[#171717] transition-colors">
                  {isWeekHistoryOpen ? 'Recolher ▲' : 'Ver Todos os Dias ▼'}
                </span>
              </div>
              <p className="text-[11px] text-[#77766F] font-mono mt-0.5">
                {isAdminUser
                  ? 'Grade semanal consolidada de visitas, presenças e histórico do promotor.'
                  : 'Grade semanal completa de rotas planejadas, histórico e pendências de outros dias.'}
              </p>
            </div>

          {/* Navegação entre semanas (visível sempre) */}
          <div className="flex items-center gap-2 shrink-0 font-mono text-xs">
            <button
              type="button"
              onClick={() => setWeekOffset((prev) => prev - 1)}
              className="p-1.5 rounded-lg bg-[#EAE8E2] hover:bg-[#CFCDC5] border border-[#CFCDC5] text-[#171717] cursor-pointer flex items-center gap-1 transition-colors"
              title="Semana anterior"
            >
              <span className="material-symbols-outlined text-sm">chevron_left</span>
              <span className="hidden md:inline">Anterior</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setWeekOffset(0);
                setSelectedDayDateStr(getLocalDateString(new Date()));
              }}
              className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                weekOffset === 0
                  ? 'bg-[#3B0764] hover:bg-[#2E0854] text-white border-[#2E0854] shadow-sm ring-1 ring-purple-900/50'
                  : 'bg-[#EAE8E2] text-[#171717] border-[#CFCDC5] hover:bg-[#CFCDC5]'
              }`}
            >
              {weekOffset === 0 && <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>}
              <span>Semana Atual</span>
            </button>

            <button
              type="button"
              onClick={() => setWeekOffset((prev) => prev + 1)}
              className="p-1.5 rounded-lg bg-[#EAE8E2] hover:bg-[#CFCDC5] border border-[#CFCDC5] text-[#171717] cursor-pointer flex items-center gap-1 transition-colors"
              title="Próxima semana"
            >
              <span className="hidden md:inline">Próxima</span>
              <span className="material-symbols-outlined text-sm">chevron_right</span>
            </button>
          </div>
        </div>

        {/* CONTEÚDO EXPANSÍVEL DA SEMANA */}
        {isWeekHistoryOpen && (
          <div className="space-y-4 pt-1">
            {/* Controles de visualização: Seletores dos 7 dias + Alternância Semana / Dia */}
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2 font-mono text-xs text-[#5F5F5F]">
                <span>Selecione um dia da semana ou visualize a grade completa:</span>
                <div className="flex items-center gap-1.5 self-end sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setWeekHistoryFilterMode('day')}
                    className={`px-2.5 py-1 rounded-lg font-bold text-xs transition-colors cursor-pointer ${
                      weekHistoryFilterMode === 'day'
                        ? 'bg-[#171717] text-white shadow-xs'
                        : 'bg-[#EAE8E2] text-[#5F5F5F] hover:text-[#171717] border border-[#CFCDC5]'
                    }`}
                  >
                    Por Dia
                  </button>
                  <button
                    type="button"
                    onClick={() => setWeekHistoryFilterMode('all')}
                    className={`px-2.5 py-1 rounded-lg font-bold text-xs transition-colors cursor-pointer ${
                      weekHistoryFilterMode === 'all'
                        ? 'bg-[#171717] text-white shadow-xs'
                        : 'bg-[#EAE8E2] text-[#5F5F5F] hover:text-[#171717] border border-[#CFCDC5]'
                    }`}
                  >
                    Todos da Semana ({allWeekOperationalVisits.length})
                  </button>
                </div>
              </div>

              {/* Grade com os 7 botões de dias */}
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 font-mono">
                {weekDaysRange.map((day) => {
                  const isTodayDay = day.dateStr === getLocalDateString(new Date());
                  const isSelected = weekHistoryFilterMode === 'day' && day.dateStr === selectedDayDateStr;
                  const dayVisits = allWeekOperationalVisits.filter((v) => v.dataStr === day.dateStr);
                  const storeCount = dayVisits.length;
                  const pendingCount = dayVisits.filter((v) => v.status === 'pendente').length;
                  const completedCount = dayVisits.filter((v) => v.status === 'concluida').length;

                  return (
                    <button
                      key={day.dateStr}
                      type="button"
                      onClick={() => {
                        setSelectedDayDateStr(day.dateStr);
                        setWeekHistoryFilterMode('day');
                      }}
                      className={`p-2.5 rounded-xl border text-left flex flex-col justify-between space-y-1.5 transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-[#171717] text-white border-[#171717] shadow-sm ring-2 ring-[#3B0764]/40'
                          : isTodayDay
                          ? 'bg-purple-100/80 border-purple-300 text-[#171717] hover:bg-purple-200/70'
                          : 'bg-[#EAE8E2] border-[#CFCDC5] text-[#171717] hover:bg-[#E4E2DB]'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className={`text-[10px] font-bold uppercase ${isSelected ? 'text-amber-400' : 'text-[#77766F]'}`}>
                          {day.dayShort}
                        </span>
                        {isTodayDay ? (
                          <span className={`px-1.5 py-0.2 text-[8px] font-bold rounded ${isSelected ? 'bg-purple-900 text-purple-200' : 'bg-[#3B0764] text-white'}`}>
                            HOJE
                          </span>
                        ) : (
                          <span className={`px-1.5 py-0.2 text-[8px] font-bold rounded ${isSelected ? 'bg-white/20 text-white' : 'bg-[#E4E2DB] text-[#5F5F5F]'}`}>
                            {storeCount} {storeCount === 1 ? 'loja' : 'lojas'}
                          </span>
                        )}
                      </div>

                      <div className="flex items-baseline justify-between w-full">
                        <span className={`text-xs font-bold ${isSelected ? 'text-white' : 'text-[#171717]'}`}>
                          {day.dateStr.split('-').reverse().slice(0, 2).join('/')}
                        </span>
                        {isTodayDay && (
                          <span className={`text-[10px] font-semibold ${isSelected ? 'text-slate-300' : 'text-[#5F5F5F]'}`}>
                            {storeCount} {storeCount === 1 ? 'loja' : 'lojas'}
                          </span>
                        )}
                      </div>

                      <div className={`flex items-center gap-1.5 text-[10px] pt-1 border-t ${isSelected ? 'border-white/20' : 'border-[#CFCDC5]/60'}`}>
                        {completedCount > 0 && <span className="font-bold text-emerald-600">🟢 {completedCount}</span>}
                        {pendingCount > 0 && <span className="font-bold text-rose-600">🔴 {pendingCount}</span>}
                        {storeCount === 0 && <span className={isSelected ? 'text-slate-400' : 'text-[#77766F]'}>Sem visitas</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Cabeçalho informativo da listagem */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pt-2 border-t border-[#CFCDC5]">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-[#171717]">
                  {weekHistoryFilterMode === 'all'
                    ? `Todos os Atendimentos da Semana (${displayedWeekVisits.length} ${displayedWeekVisits.length === 1 ? 'registro' : 'registros'})`
                    : `Atendimentos de ${selectedDayDateStr.split('-').reverse().join('/')} (${selectedDayOperationalVisits.length} no dia • ${allWeekOperationalVisits.length} na semana)`}
                </span>
                {weekHistoryFilterMode === 'day' && selectedDayOperationalVisits.length === 0 && allWeekOperationalVisits.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setWeekHistoryFilterMode('all')}
                    className="text-[11px] font-bold text-[#286FF5] hover:underline cursor-pointer"
                  >
                    (Ver todos os {allWeekOperationalVisits.length} registros da semana)
                  </button>
                )}
              </div>
              <span className="font-mono text-[11px] text-[#77766F]">
                {weekHistoryFilterMode === 'all'
                  ? 'Exibindo segunda a domingo'
                  : weekDaysRange.find((d) => d.dateStr === selectedDayDateStr)?.dayLabel || ''}
              </span>
            </div>

            {/* Lista detalhada das visitas do DIA SELECIONADO ou DA SEMANA */}
            {displayedWeekVisits.length === 0 ? (
              <div className="py-8 text-center space-y-2 font-mono bg-[#EAE8E2] rounded-xl border border-[#CFCDC5]">
                <div className="w-10 h-10 rounded-full bg-[#F7F6F2] border border-[#CFCDC5] flex items-center justify-center text-[#5F5F5F] mx-auto">
                  <span className="material-symbols-outlined text-xl">event_busy</span>
                </div>
                <h4 className="text-xs font-bold text-[#171717]">
                  {weekHistoryFilterMode === 'all'
                    ? 'Nenhum Atendimento Programado nesta Semana'
                    : 'Nenhum Atendimento para este Dia'}
                </h4>
                <p className="text-[11px] text-[#77766F] max-w-sm mx-auto">
                  {weekHistoryFilterMode === 'all'
                    ? 'Não foram encontrados registros para o promotor nesta semana selecionada.'
                    : allWeekOperationalVisits.length > 0
                    ? `Não há visitas programadas para ${selectedDayDateStr.split('-').reverse().join('/')}, mas há ${allWeekOperationalVisits.length} atendimentos em outros dias desta semana. Clique nos dias acima ou em "Todos da Semana".`
                    : `Não há visitas programadas ou registros de campo para ${selectedDayDateStr.split('-').reverse().join('/')}. Selecione outro dia nos botões acima.`}
                </p>
                {weekHistoryFilterMode === 'day' && allWeekOperationalVisits.length > 0 && (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => setWeekHistoryFilterMode('all')}
                      className="px-3 py-1.5 rounded-lg bg-[#171717] hover:bg-black text-white text-xs font-bold cursor-pointer transition-colors"
                    >
                      Exibir Todos os {allWeekOperationalVisits.length} da Semana
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {displayedWeekVisits.map((item, idx) => {
                  const isTodayItem = item.dataStr === getLocalDateString(new Date());
                  const routeObj = routes.find((r) => r.id === item.routeId) || {
                    id: item.routeId,
                    promotor_matricula: item.promotorMatricula,
                    loja_codigo: item.lojaCodigo,
                    industria_codigo: item.industriaCodigo,
                    frequencia: item.frequencia,
                    loja: { codigo: item.lojaCodigo, nome: item.lojaNome, cidade: item.lojaCidade, uf: item.lojaUf },
                    industria: { codigo: item.industriaCodigo, nome: item.industriaNome }
                  } as RouteItem;

                  return (
                    <div
                      key={`${item.key}_${item.dataStr}`}
                      className={`p-4 rounded-xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 font-mono ${
                        item.status === 'concluida'
                          ? 'bg-emerald-950/20 border-emerald-500/30'
                          : item.status === 'em_andamento'
                          ? 'bg-amber-950/20 border-amber-500/50'
                          : item.status === 'nao_realizada'
                          ? 'bg-rose-950/20 border-rose-500/30'
                          : item.status === 'pendente'
                          ? 'bg-rose-950/15 border-rose-500/30'
                          : 'bg-[#EAE8E2] border-[#CFCDC5]'
                      }`}
                    >
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-[#F7F6F2] border border-[#CFCDC5] text-[#7E22CE] font-bold text-[10px] flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <span className="text-xs font-bold text-[#5B21B6] uppercase">
                            {item.dataStr.split('-').reverse().join('/')} • {item.dayOfWeekLabel}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase flex items-center gap-1 ${
                              item.status === 'concluida'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : item.status === 'em_andamento'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse'
                                : item.status === 'nao_realizada'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : item.status === 'pendente'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                : 'bg-slate-800 text-slate-300 border border-[#CFCDC5]'
                            }`}
                          >
                            {item.status === 'concluida' && '🟢 Concluída'}
                            {item.status === 'em_andamento' && '🔵 Em andamento'}
                            {item.status === 'pendente' && (item.isPastOverdue ? '🔴 Pendente (Atrasada)' : '🔴 Pendente')}
                            {item.status === 'nao_realizada' && '🟠 Não realizada'}
                            {item.status === 'planejada' && '⚪ Planejada'}
                          </span>
                        </div>

                        <h4 className="text-sm font-bold text-[#171717]">
                          {item.lojaNome}
                        </h4>

                        <p className="text-[11px] text-[#77766F]">
                          Cidade/UF: {item.lojaCidade || '—'}/{item.lojaUf || '-'}
                        </p>
                        <div className="flex flex-wrap items-center gap-3 text-[10px] text-[#5F5F5F]">
                          <span>Indústria: <strong className="text-[#7E22CE] font-bold">{item.industriaNome}</strong></span>
                          <span>Frequência: <strong className="text-[#0E7490] font-bold">{item.frequencia}</strong></span>
                          {item.completedAt && (
                            <span>Concluído às: <strong className="text-emerald-700 font-bold">{new Date(item.completedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong></span>
                          )}
                        </div>
                      </div>

                      {/* Ações */}
                      <div className="flex items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-[#CFCDC5]">
                        {isAdminUser ? (
                          <button
                            type="button"
                            onClick={() => setAdminInspectionVisit(item)}
                            className="px-2.5 py-1 rounded-xl bg-[#E4E2DB] hover:bg-[#CFCDC5] text-[#171717] border border-[#CFCDC5] text-[11px] font-bold font-mono flex items-center gap-1 cursor-pointer transition-colors"
                            title="Inspecionar detalhes e evidências desta visita"
                          >
                            <span className="material-symbols-outlined text-sm text-[#286FF5]">visibility</span>
                            <span>Ver Detalhes</span>
                          </button>
                        ) : (
                          <>
                            {(item.status === 'pendente' || item.status === 'planejada') && isTodayItem && (
                              isImplantacaoMode && !isAuthorized ? (
                                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-mono">
                                  <span className="material-symbols-outlined text-sm">lock</span>
                                  <span>Aguardando Liberação</span>
                                </div>
                              ) : activeVisit ? (
                                <button
                                  onClick={() => handleStartVisit(routeObj)}
                                  className="px-3 py-1.5 rounded-xl bg-[#EAE8E2] hover:bg-purple-600/30 text-purple-300 border border-purple-500/40 font-bold text-xs flex items-center gap-1 cursor-pointer transition-colors"
                                  title="Trocar para esta loja (exige finalizar ou interromper o atendimento atual)"
                                >
                                  <span className="material-symbols-outlined text-sm">play_arrow</span>
                                  <span>Iniciar Esta</span>
                                </button>
                              ) : (
                                <>
                                  <button
                                    onClick={() => handleStartVisit(routeObj)}
                                    className="px-4 py-2 rounded-xl bg-[#222222] hover:bg-black text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md"
                                  >
                                    <span className="material-symbols-outlined text-sm">play_arrow</span>
                                    <span>Iniciar Visita</span>
                                  </button>
                                  <button
                                    onClick={() => setShowNotDoneModal(routeObj)}
                                    className="px-3 py-2 rounded-xl bg-[#F7F6F2] hover:bg-rose-500/20 text-[#77766F] hover:text-rose-300 border border-[#CFCDC5] text-xs font-bold cursor-pointer"
                                    title="Justificar Não Realização"
                                  >
                                    Não Atendido
                                  </button>
                                </>
                              )
                            )}

                            {item.status === 'pendente' && !isTodayItem && item.isPastOverdue && !activeVisit && (
                              isImplantacaoMode && !isAuthorized ? (
                                <span className="text-xs text-[#5F5F5F] font-mono italic">Aguardando Liberação</span>
                              ) : (
                                <button
                                  onClick={() => handleStartVisit(routeObj)}
                                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md"
                                >
                                  <span className="material-symbols-outlined text-sm">play_arrow</span>
                                  <span>Regularizar Pendência</span>
                                </button>
                              )
                            )}
                          </>
                        )}

                        {item.status === 'em_andamento' && (
                          <span className="text-xs text-amber-300 font-bold flex items-center gap-1 px-3 py-2 bg-amber-500/10 rounded-xl border border-amber-500/30">
                            <span className="material-symbols-outlined text-sm animate-spin">sync</span>
                            Em Atendimento
                          </span>
                        )}

                        {item.status === 'concluida' && (
                          <span className="text-xs text-emerald-400 font-bold flex items-center gap-1 px-3 py-2 bg-emerald-500/10 rounded-xl border border-emerald-500/30">
                            <span className="material-symbols-outlined text-sm">check_circle</span>
                            Concluída
                          </span>
                        )}

                        {item.status === 'nao_realizada' && (
                          item.visitObj ? (
                            <button
                              onClick={() => {
                                if (activeVisit) {
                                  onShowToast({
                                    title: 'Atendimento Já em Andamento',
                                    message: `Finalize ou interrompa o atendimento da loja ${activeVisit.loja?.nome || activeVisit.loja_codigo} antes de recuperar outra visita.`,
                                    type: 'warning'
                                  });
                                  const el = document.getElementById('active-visit-section');
                                  if (el) el.scrollIntoView({ behavior: 'smooth' });
                                  return;
                                }
                                if (item.visitObj) {
                                  setRecoverModalVisit(item.visitObj);
                                }
                              }}
                              className="px-3 py-1.5 rounded-xl bg-[#222222] hover:bg-black text-white font-bold text-xs flex items-center gap-1 cursor-pointer shadow-md transition-colors"
                              title="Realizar esta visita hoje com atraso"
                            >
                              <span className="material-symbols-outlined text-sm">replay</span>
                              <span>Realizar hoje</span>
                            </button>
                          ) : (
                            <span className="text-xs text-rose-400 font-bold flex items-center gap-1 px-3 py-2 bg-rose-500/10 rounded-xl border border-rose-500/30">
                              <span className="material-symbols-outlined text-sm">cancel</span>
                              Não Realizada
                            </span>
                          )
                        )}

                        {item.status === 'planejada' && (
                          <span className="text-xs text-[#77766F] font-bold flex items-center gap-1 px-3 py-2 bg-slate-800/40 rounded-xl border border-[#CFCDC5]/50">
                            <span className="material-symbols-outlined text-sm">event</span>
                            Visita Planejada
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>
      )}

      {/* 4. ESCALA FIXA DA SEMANA (Itens 3 e 4) */}
      {(!isAdminUser || selectedPromoterMatricula) && (
        <section className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#CFCDC5] pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#7E22CE]">calendar_month</span>
                <h3 className="text-sm font-bold text-[#171717] uppercase tracking-wider font-mono flex items-center gap-2">
                  Escala Fixa da Semana ({routes.length} {routes.length === 1 ? 'rota programada' : 'rotas programadas'})
                </h3>
              </div>
              <p className="text-[11px] text-[#77766F] font-mono mt-0.5">
                Grade contratada oficial (segunda a domingo) cadastrada no sistema para este promotor.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0 font-mono text-xs">
              {/* Alternância Semana / Dia */}
              <div className="flex items-center p-0.5 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl">
                <button
                  type="button"
                  onClick={() => setScaleViewMode('semana')}
                  className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-colors cursor-pointer ${
                    scaleViewMode === 'semana'
                      ? 'bg-[#171717] text-white shadow-xs'
                      : 'text-[#5F5F5F] hover:text-[#171717]'
                  }`}
                >
                  Semana
                </button>
                <button
                  type="button"
                  onClick={() => setScaleViewMode('dia')}
                  className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-colors cursor-pointer ${
                    scaleViewMode === 'dia'
                      ? 'bg-[#171717] text-white shadow-xs'
                      : 'text-[#5F5F5F] hover:text-[#171717]'
                  }`}
                >
                  Dia
                </button>
              </div>

              {/* Botão compacto "Editar escala fixa" para perfis com permissão */}
              {isAdminUser && routes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setEditingScaleRoute(routes[0])}
                  className="px-3 py-1.5 rounded-xl bg-[#3B0764] hover:bg-[#2E0854] text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors border border-[#2E0854] focus:outline-none focus:ring-2 focus:ring-purple-900/50"
                  title="Editar a escala fixa oficial de rotas deste promotor"
                >
                  <span className="material-symbols-outlined text-sm">edit_calendar</span>
                  <span>Editar escala fixa</span>
                </button>
              )}
            </div>
          </div>

          {routes.length === 0 ? (
            <div className="py-8 text-center space-y-2 font-mono bg-[#EAE8E2] rounded-xl border border-[#CFCDC5]">
              <div className="w-10 h-10 rounded-full bg-[#F7F6F2] border border-[#CFCDC5] flex items-center justify-center text-[#5F5F5F] mx-auto">
                <span className="material-symbols-outlined text-xl">event_busy</span>
              </div>
              <h4 className="text-xs font-bold text-[#171717]">Nenhuma Rota Fixa Cadastrada</h4>
              <p className="text-[11px] text-[#77766F] max-w-sm mx-auto">
                Não há rotas vinculadas à matrícula {realMatricula || 'selecionada'} na tabela oficial de escalas.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Visão de Segunda a Domingo com contador de lojas */}
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 font-mono text-xs">
                {[
                  { key: 'segunda', label: 'Segunda', short: 'SEG' },
                  { key: 'terca', label: 'Terça', short: 'TER' },
                  { key: 'quarta', label: 'Quarta', short: 'QUA' },
                  { key: 'quinta', label: 'Quinta', short: 'QUI' },
                  { key: 'sexta', label: 'Sexta', short: 'SEX' },
                  { key: 'sabado', label: 'Sábado', short: 'SÁB' },
                  { key: 'domingo', label: 'Domingo', short: 'DOM' }
                ].map((d) => {
                  const dayRoutes = routes.filter((r) => Boolean((r as any)[d.key]));
                  const isSelected = selectedScaleDayKey === d.key;

                  return (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => {
                        setSelectedScaleDayKey(d.key);
                        if (scaleViewMode !== 'dia') setScaleViewMode('dia');
                      }}
                      className={`p-2.5 rounded-xl border text-left flex flex-col justify-between space-y-1 transition-all cursor-pointer ${
                        isSelected && scaleViewMode === 'dia'
                          ? 'bg-[#171717] text-white border-[#171717] shadow-sm ring-2 ring-purple-600/40'
                          : 'bg-[#EAE8E2] border-[#CFCDC5] text-[#171717] hover:bg-[#E4E2DB]'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className={`text-[10px] font-bold uppercase ${isSelected && scaleViewMode === 'dia' ? 'text-amber-400' : 'text-[#77766F]'}`}>
                          {d.short}
                        </span>
                        <span className={`px-1.5 py-0.2 text-[8px] font-bold rounded ${isSelected && scaleViewMode === 'dia' ? 'bg-white/20 text-white' : 'bg-[#E4E2DB] text-[#5F5F5F]'}`}>
                          {dayRoutes.length} {dayRoutes.length === 1 ? 'loja' : 'lojas'}
                        </span>
                      </div>
                      <div className="text-xs font-bold truncate">
                        {d.label}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Conteúdo da Escala: Modo SEMANA ou Modo DIA */}
              {scaleViewMode === 'semana' ? (
                /* Modo Semana: Grade completa de rotas cadastradas */
                <div className="space-y-2.5">
                  <div className="text-xs font-mono font-bold text-[#171717] flex items-center justify-between">
                    <span>Todas as Rotas Programadas na Escala Fixa:</span>
                    <span className="text-[11px] text-[#77766F] font-normal">Exibindo {routes.length} rotas ativas</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono">
                    {routes.map((r, idx) => {
                      const activeDays = [
                        r.segunda && 'SEG',
                        r.terca && 'TER',
                        r.quarta && 'QUA',
                        r.quinta && 'QUI',
                        r.sexta && 'SEX',
                        r.sabado && 'SÁB',
                        r.domingo && 'DOM'
                      ].filter(Boolean);

                      return (
                        <div
                          key={r.id || idx}
                          className="p-3.5 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] space-y-2 flex flex-col justify-between hover:border-[#171717]/40 transition-colors"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#F7F6F2] border border-[#CFCDC5] text-[#7E22CE]">
                                ROTA: {r.codigo_rota || `R-${idx + 1}`}
                              </span>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-cyan-100 text-cyan-800 border border-cyan-300">
                                {r.frequencia || 'SEMANAL'}
                              </span>
                            </div>
                            <h4 className="text-xs font-bold text-[#171717]">
                              {r.loja?.nome || r.loja_codigo}
                            </h4>
                            <p className="text-[11px] text-[#77766F]">
                              Indústria: <strong className="text-[#171717]">{r.industria?.nome || r.industria_codigo}</strong> • {r.loja?.cidade || '—'}/{r.loja?.uf || '-'}
                            </p>
                            {r.observacao && (
                              <p className="text-[10px] text-[#5F5F5F] italic bg-[#F7F6F2] p-1.5 rounded border border-[#CFCDC5]/50">
                                Obs: {r.observacao}
                              </p>
                            )}
                          </div>

                          <div className="pt-2 border-t border-[#CFCDC5] flex items-center justify-between">
                            <div className="flex flex-wrap gap-1 text-[9px] font-bold">
                              {['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'].map((dKey, dIdx) => {
                                const dayLabels = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
                                const active = Boolean((r as any)[dKey]);
                                return (
                                  <span
                                    key={dKey}
                                    className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${
                                      active
                                        ? 'bg-[#171717] text-white font-bold'
                                        : 'bg-[#E4E2DB] text-[#999891]'
                                    }`}
                                  >
                                    {dayLabels[dIdx]}
                                  </span>
                                );
                              })}
                            </div>

                            {isAdminUser && (
                              <button
                                type="button"
                                onClick={() => setEditingScaleRoute(r)}
                                className="px-2 py-1 rounded-lg bg-[#F7F6F2] hover:bg-[#171717] text-[#171717] hover:text-white border border-[#CFCDC5] text-[10px] font-bold cursor-pointer transition-colors"
                              >
                                Editar
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* Modo Dia: Exibe rotas programadas para o dia da semana selecionado */
                <div className="space-y-3 font-mono">
                  <div className="text-xs font-bold text-[#171717] flex items-center justify-between border-b border-[#CFCDC5] pb-2">
                    <span className="uppercase">
                      Programação Fixa para {
                        selectedScaleDayKey === 'segunda' ? 'Segunda-feira' :
                        selectedScaleDayKey === 'terca' ? 'Terça-feira' :
                        selectedScaleDayKey === 'quarta' ? 'Quarta-feira' :
                        selectedScaleDayKey === 'quinta' ? 'Quinta-feira' :
                        selectedScaleDayKey === 'sexta' ? 'Sexta-feira' :
                        selectedScaleDayKey === 'sabado' ? 'Sábado' : 'Domingo'
                      }
                    </span>
                    <span className="text-[11px] text-[#77766F] font-normal">
                      {routes.filter((r) => Boolean((r as any)[selectedScaleDayKey])).length} lojas programadas
                    </span>
                  </div>

                  {routes.filter((r) => Boolean((r as any)[selectedScaleDayKey])).length === 0 ? (
                    <div className="py-6 text-center space-y-1 bg-[#EAE8E2] rounded-xl border border-[#CFCDC5]">
                      <p className="text-xs font-bold text-[#171717]">Nenhuma loja na escala deste dia da semana.</p>
                      <p className="text-[11px] text-[#77766F]">
                        Este promotor não possui previsão contratada de atendimento neste dia.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {routes
                        .filter((r) => Boolean((r as any)[selectedScaleDayKey]))
                        .map((r, idx) => (
                          <div
                            key={r.id || idx}
                            className="p-3 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-[#171717] text-white text-[10px] font-bold flex items-center justify-center">
                                  {idx + 1}
                                </span>
                                <h4 className="font-bold text-[#171717]">
                                  {r.loja?.nome || r.loja_codigo}
                                </h4>
                                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-cyan-100 text-cyan-800 border border-cyan-300">
                                  {r.frequencia || 'SEMANAL'}
                                </span>
                              </div>
                              <p className="text-[11px] text-[#77766F] pl-7">
                                Indústria: <strong className="text-[#171717]">{r.industria?.nome || r.industria_codigo}</strong> • {r.loja?.cidade || '—'}/{r.loja?.uf || '-'}
                                {r.observacao ? ` • Obs: ${r.observacao}` : ''}
                              </p>
                            </div>

                            {isAdminUser && (
                              <button
                                type="button"
                                onClick={() => setEditingScaleRoute(r)}
                                className="px-2.5 py-1 rounded-xl bg-[#F7F6F2] hover:bg-[#171717] text-[#171717] hover:text-white border border-[#CFCDC5] text-xs font-bold cursor-pointer transition-colors self-end sm:self-auto"
                              >
                                Editar Escala
                              </button>
                            )}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* MODAL DE EDIÇÃO DA ESCALA FIXA (Item 4) */}
      {editingScaleRoute && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 font-mono text-xs">
            <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-purple-700">edit_calendar</span>
                <h3 className="text-sm font-bold text-[#171717] uppercase">
                  Editar Escala Fixa da Rota
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingScaleRoute(null)}
                className="text-[#77766F] hover:text-[#171717] cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Identificação da Loja e Indústria */}
            <div className="p-3 bg-[#EAE8E2] rounded-xl border border-[#CFCDC5] space-y-1">
              <div className="text-[#171717] font-bold text-sm">
                {editingScaleRoute.loja?.nome || editingScaleRoute.loja_codigo}
              </div>
              <div className="text-[11px] text-[#77766F]">
                Indústria: <strong className="text-[#171717]">{editingScaleRoute.industria?.nome || editingScaleRoute.industria_codigo}</strong> • Rota: {editingScaleRoute.codigo_rota || editingScaleRoute.id}
              </div>
            </div>

            {/* Seletor de Rota / Troca de Rota para Editar */}
            {routes.length > 1 && (
              <div>
                <label className="text-[11px] font-bold text-[#77766F] block mb-1">
                  SELECIONAR ROTA PARA CONFIGURAR:
                </label>
                <select
                  value={editingScaleRoute.id}
                  onChange={(e) => {
                    const found = routes.find((r) => r.id === e.target.value);
                    if (found) setEditingScaleRoute(found);
                  }}
                  className="w-full h-9 px-3 bg-white border border-[#CFCDC5] rounded-xl text-xs font-semibold text-[#171717]"
                >
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.loja?.nome || r.loja_codigo} ({r.industria?.nome || r.industria_codigo}) - {r.codigo_rota}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Frequência */}
            <div>
              <label className="text-[11px] font-bold text-[#77766F] block mb-1">FREQUÊNCIA DA ROTA:</label>
              <div className="grid grid-cols-2 gap-2">
                {(['SEMANAL', 'QUINZENAL'] as const).map((freq) => (
                  <button
                    key={freq}
                    type="button"
                    onClick={() => setEditingScaleRoute({ ...editingScaleRoute, frequencia: freq })}
                    className={`p-2 rounded-xl border text-center font-bold cursor-pointer transition-colors ${
                      editingScaleRoute.frequencia === freq
                        ? 'bg-[#171717] text-white border-[#171717]'
                        : 'bg-[#EAE8E2] text-[#171717] border-[#CFCDC5] hover:bg-[#E4E2DB]'
                    }`}
                  >
                    {freq}
                  </button>
                ))}
              </div>
            </div>

            {/* Dias da Semana (Segunda a Domingo) */}
            <div>
              <label className="text-[11px] font-bold text-[#77766F] block mb-1.5">
                DIAS DE VISITA ATIVOS:
              </label>
              <div className="grid grid-cols-7 gap-1.5 text-center">
                {[
                  { key: 'segunda', label: 'SEG' },
                  { key: 'terca', label: 'TER' },
                  { key: 'quarta', label: 'QUA' },
                  { key: 'quinta', label: 'QUI' },
                  { key: 'sexta', label: 'SEX' },
                  { key: 'sabado', label: 'SÁB' },
                  { key: 'domingo', label: 'DOM' }
                ].map((d) => {
                  const isActive = Boolean((editingScaleRoute as any)[d.key]);
                  return (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() =>
                        setEditingScaleRoute({
                          ...editingScaleRoute,
                          [d.key]: !isActive
                        })
                      }
                      className={`p-2 rounded-xl border font-bold text-xs cursor-pointer transition-all ${
                        isActive
                          ? 'bg-[#3B0764] text-white border-[#2E0854] shadow-xs'
                          : 'bg-[#EAE8E2] text-[#77766F] border-[#CFCDC5] hover:bg-[#E4E2DB]'
                      }`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Observações da Escala */}
            <div>
              <label className="text-[11px] font-bold text-[#77766F] block mb-1">
                OBSERVAÇÕES DA ROTA (OPCIONAL):
              </label>
              <input
                type="text"
                value={editingScaleRoute.observacao || ''}
                onChange={(e) => setEditingScaleRoute({ ...editingScaleRoute, observacao: e.target.value })}
                placeholder="Ex: Prioridade matutina, verificar ruptura de café..."
                className="w-full h-9 px-3 bg-white border border-[#CFCDC5] rounded-xl text-xs text-[#171717]"
              />
            </div>

            {/* Aviso de propagação segura */}
            <div className="p-2.5 rounded-xl bg-purple-50 border border-purple-200 text-purple-900 text-[11px] leading-relaxed">
              <strong>Regra de Propagação:</strong> As alterações salvas atualizarão a escala fixa e a geração das próximas visitas. Visitas já concluídas, fotos e ocorrências passadas não sofrerão nenhuma alteração.
            </div>

            {/* Ações do Modal */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#CFCDC5]">
              <button
                type="button"
                onClick={() => setEditingScaleRoute(null)}
                disabled={savingScaleRoute}
                className="px-4 py-2 rounded-xl bg-[#EAE8E2] hover:bg-[#CFCDC5] text-[#171717] font-bold cursor-pointer transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleSaveRouteScale(editingScaleRoute)}
                disabled={savingScaleRoute}
                className="px-4 py-2 rounded-xl bg-[#3B0764] hover:bg-[#2E0854] text-white font-bold cursor-pointer shadow-md transition-colors flex items-center gap-1.5 disabled:opacity-50 border border-[#2E0854] focus:outline-none focus:ring-2 focus:ring-purple-900/50"
              >
                {savingScaleRoute ? (
                  <>
                    <span className="material-symbols-outlined text-sm animate-spin">refresh</span>
                    <span>Salvando...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm">check</span>
                    <span>Confirmar e Salvar Escala</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL JUSTIFICAR VISITA ANTERIOR EM ANDAMENTO COMO NÃO REALIZADA */}
      {staleNotDoneVisit && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#F7F6F2] border-2 border-rose-500/50 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-3">
              <h3 className="text-sm font-bold text-[#171717] font-mono flex items-center gap-2">
                <span className="material-symbols-outlined text-rose-400">report_problem</span>
                Registrar Visita Anterior como Não Realizada
              </h3>
              <button
                onClick={() => setStaleNotDoneVisit(null)}
                className="text-[#77766F] hover:text-white cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-3 font-mono text-xs">
              <div className="p-3.5 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] text-[#171717] space-y-1">
                <div>Loja: <strong className="text-[#171717]">{staleNotDoneVisit.loja?.nome || staleNotDoneVisit.loja_codigo}</strong></div>
                <div>Indústria: <strong className="text-purple-300">{staleNotDoneVisit.industria?.nome || staleNotDoneVisit.industria_codigo}</strong></div>
                <div>Data Original: <strong className="text-amber-400">{staleNotDoneVisit.data_visita.split('-').reverse().join('/')}</strong></div>
              </div>

              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-[11px] leading-relaxed">
                Ao registrar como não realizada, o status da visita será atualizado no banco de dados e sua agenda ficará liberada para os atendimentos de hoje.
              </div>

              <div>
                <label className="text-[#171717] block mb-1.5 font-bold">
                  MOTIVO OBRIGATÓRIO (*)
                </label>
                <textarea
                  required
                  value={staleNotDoneReason}
                  onChange={(e) => setStaleNotDoneReason(e.target.value)}
                  placeholder="Ex: Turno encerrado sem check-out, loja fechou antes da conclusão, problema com o dispositivo..."
                  className="w-full p-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-rose-500 h-24 resize-none font-mono text-xs"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-[#CFCDC5] flex items-center justify-end gap-3 font-mono">
              <button
                type="button"
                onClick={() => setStaleNotDoneVisit(null)}
                disabled={savingStaleNotDone}
                className="px-4 py-2 rounded-xl bg-[#EAE8E2] text-[#171717] border border-[#CFCDC5] text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmStaleNotDone}
                disabled={!staleNotDoneReason.trim() || savingStaleNotDone}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-md"
              >
                <span>{savingStaleNotDone ? 'Salvando...' : 'Confirmar Não Realização'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL JUSTIFICAR NÃO REALIZAÇÃO */}
      {showNotDoneModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-3">
              <h3 className="text-sm font-bold text-[#171717] font-mono flex items-center gap-2">
                <span className="material-symbols-outlined text-rose-400">report_problem</span>
                Justificar Não Atendimento
              </h3>
              <button onClick={() => setShowNotDoneModal(null)} className="text-[#77766F] hover:text-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-3 font-mono text-xs">
              <div className="p-3 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] text-[#171717]">
                <div>Loja: <strong className="text-[#171717]">{showNotDoneModal.loja?.nome}</strong></div>
                <div>Indústria: <strong className="text-purple-300">{showNotDoneModal.industria?.nome}</strong></div>
              </div>

              <div>
                <label className="text-[#171717] block mb-1 font-bold">MOTIVO DO NÃO ATENDIMENTO (*)</label>
                <textarea
                  required
                  value={notDoneReason}
                  onChange={(e) => setNotDoneReason(e.target.value)}
                  placeholder="Ex: Loja fechada para inventário, falta de chave, ausência do encarregado..."
                  className="w-full p-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-rose-500 h-24 resize-none"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-[#CFCDC5] flex items-center justify-end gap-3 font-mono">
              <button
                type="button"
                onClick={() => setShowNotDoneModal(null)}
                className="px-4 py-2 rounded-xl bg-[#EAE8E2] text-[#171717] border border-[#CFCDC5] text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleMarkNotDone}
                disabled={!notDoneReason.trim()}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <span>Confirmar Ocorrência</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL INTERROMPER / CANCELAR ATENDIMENTO (Requisito 3) */}
      {interruptModalVisit && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#F7F6F2] border-2 border-rose-500/50 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-3">
              <h3 className="text-sm font-bold text-[#171717] font-mono flex items-center gap-2">
                <span className="material-symbols-outlined text-rose-400">cancel</span>
                Interromper Atendimento
              </h3>
              <button
                onClick={() => {
                  if (!savingInterrupt) {
                    setInterruptModalVisit(null);
                    setInterruptReason('');
                  }
                }}
                className="text-[#77766F] hover:text-white cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-3 font-mono text-xs">
              <div className="p-3.5 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] text-[#171717] space-y-1">
                <div>Loja: <strong className="text-[#171717]">{interruptModalVisit.loja?.nome || interruptModalVisit.loja_codigo}</strong></div>
                <div>Indústria: <strong className="text-purple-300">{interruptModalVisit.industria?.nome || interruptModalVisit.industria_codigo}</strong></div>
                <div>Data da Visita: <strong className="text-amber-400">{interruptModalVisit.data_visita.split('-').reverse().join('/')}</strong></div>
                {interruptModalVisit.started_at && (
                  <div>Iniciada às: <strong className="text-cyan-400">{new Date(interruptModalVisit.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong></div>
                )}
              </div>

              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-[11px] leading-relaxed">
                Esta ação cancelará a execução atual desta loja com registro de auditoria, preservando fotos e dados já salvos. Sua agenda será liberada para você iniciar o atendimento em outra loja programada.
              </div>

              <div>
                <label className="text-[#171717] block mb-1.5 font-bold">
                  JUSTIFICATIVA OBRIGATÓRIA (*)
                </label>
                <textarea
                  required
                  value={interruptReason}
                  onChange={(e) => setInterruptReason(e.target.value)}
                  placeholder="Ex: Iniciada por engano; loja solicitou retorno mais tarde; necessidade de deslocamento para outra loja..."
                  className="w-full p-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] focus:outline-none focus:border-rose-500 h-24 resize-none font-mono text-xs"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-[#CFCDC5] flex items-center justify-end gap-3 font-mono">
              <button
                type="button"
                onClick={() => {
                  setInterruptModalVisit(null);
                  setInterruptReason('');
                }}
                disabled={savingInterrupt}
                className="px-4 py-2 rounded-xl bg-[#EAE8E2] text-[#171717] border border-[#CFCDC5] text-xs font-semibold cursor-pointer"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={handleConfirmInterruptVisit}
                disabled={!interruptReason.trim() || savingInterrupt}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-md"
              >
                <span className={`material-symbols-outlined text-sm ${savingInterrupt ? 'animate-spin' : ''}`}>
                  {savingInterrupt ? 'sync' : 'close'}
                </span>
                <span>{savingInterrupt ? 'Cancelando...' : 'Confirmar Interrupção'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* MODAL DECISÃO EXPLÍCITA: ATENDIMENTO EM ANDAMENTO (Etapa 1) */}
      {busyConflictTargetRoute && activeVisit && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#F7F6F2] border-2 border-amber-500/50 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-3">
              <h3 className="text-sm font-bold text-[#171717] font-mono flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400">warning</span>
                Atendimento Já em Andamento
              </h3>
              <button
                onClick={() => setBusyConflictTargetRoute(null)}
                className="text-[#77766F] hover:text-white cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-3 font-mono text-xs">
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs leading-relaxed">
                Você já possui um atendimento ativo na loja <strong className="text-[#171717]">{activeVisit.loja?.nome || activeVisit.loja_codigo}</strong> ({activeVisit.industria?.nome || activeVisit.industria_codigo}).
              </div>

              <div className="p-3.5 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] text-[#171717] space-y-1">
                <div className="text-[10px] text-[#5F5F5F] font-bold uppercase">NOVA LOJA SELECIONADA:</div>
                <div>Loja: <strong className="text-[#171717]">{busyConflictTargetRoute.loja?.nome || busyConflictTargetRoute.loja_codigo}</strong></div>
                <div>Indústria: <strong className="text-purple-300">{busyConflictTargetRoute.industria?.nome || busyConflictTargetRoute.industria_codigo}</strong></div>
              </div>

              <p className="text-[#171717] text-[11px] leading-relaxed">
                Para iniciar a nova loja, você deve primeiro <strong>concluir</strong> o checklist da loja atual ou <strong>interrompê-la com justificativa</strong> obrigatória.
              </p>
            </div>

            <div className="pt-3 border-t border-[#CFCDC5] flex flex-col sm:flex-row items-center justify-end gap-2 font-mono">
              <button
                type="button"
                onClick={() => {
                  setBusyConflictTargetRoute(null);
                  const el = document.getElementById('active-visit-section');
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth' });
                  }
                }}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-colors"
              >
                <span className="material-symbols-outlined text-sm">edit_note</span>
                <span>Voltar para atendimento atual</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const currentActive = activeVisit;
                  setBusyConflictTargetRoute(null);
                  setInterruptModalVisit(currentActive);
                  setInterruptReason('');
                }}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#EAE8E2] hover:bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <span className="material-symbols-outlined text-sm">close</span>
                <span>Interromper com justificativa</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CONFIRMAÇÃO DE RECUPERAÇÃO DE VISITA PENDENTE COM ATRASO */}
      {recoverModalVisit && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#F7F6F2] border-2 border-purple-500/50 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-[#CFCDC5] pb-3">
              <h3 className="text-sm font-bold text-[#171717] font-mono flex items-center gap-2">
                <span className="material-symbols-outlined text-purple-400">replay</span>
                Recuperar Visita Pendente
              </h3>
              <button
                onClick={() => setRecoverModalVisit(null)}
                disabled={recoveringVisit}
                className="text-[#77766F] hover:text-white cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-3 font-mono text-xs">
              <div className="p-3.5 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] text-[#171717] space-y-1">
                <div>Loja: <strong className="text-[#171717]">{recoverModalVisit.loja?.nome || recoverModalVisit.loja_codigo}</strong></div>
                <div>Indústria: <strong className="text-purple-300">{recoverModalVisit.industria?.nome || recoverModalVisit.industria_codigo}</strong></div>
                <div>Data Originalmente Planejada: <strong className="text-amber-400">{recoverModalVisit.data_visita.split('-').reverse().join('/')}</strong></div>
                {recoverModalVisit.motivo_nao_realizada && (
                  <div className="pt-1 text-[11px] text-[#77766F]">
                    Motivo Anterior: <span className="text-rose-300 italic">{recoverModalVisit.motivo_nao_realizada}</span>
                  </div>
                )}
              </div>

              <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-200 text-[11px] leading-relaxed space-y-1">
                <p>
                  • Esta visita será iniciada na <strong>data de hoje</strong> e vinculada ao seu atendimento ativo.
                </p>
                <p>
                  • O motivo anterior e as evidências já registradas serão integralmente <strong>preservados</strong>.
                </p>
                <p>
                  • A data planejada original será mantida para auditoria, e a recuperação ficará registrada como <strong>atendimento realizado com atraso</strong>.
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-[#CFCDC5] flex items-center justify-end gap-3 font-mono">
              <button
                type="button"
                onClick={() => setRecoverModalVisit(null)}
                disabled={recoveringVisit}
                className="px-4 py-2 rounded-xl bg-[#EAE8E2] text-[#171717] border border-[#CFCDC5] text-xs font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmRecoverVisit}
                disabled={recoveringVisit}
                className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md transition-colors"
              >
                <span className={`material-symbols-outlined text-sm ${recoveringVisit ? 'animate-spin' : ''}`}>
                  {recoveringVisit ? 'sync' : 'play_arrow'}
                </span>
                <span>{recoveringVisit ? 'Reabrindo Visita...' : 'Confirmar e Iniciar Hoje'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CONSULTA DE DETALHES DA VISITA (MODO ADMINISTRATIVO) */}
      {adminInspectionVisit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden my-8 max-h-[90vh] flex flex-col font-sans">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-[#CFCDC5] flex items-center justify-between bg-[#EAE8E2]">
              <div>
                <h3 className="font-extrabold text-[#171717] text-base flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#286FF5]">visibility</span>
                  <span>Detalhes do Atendimento</span>
                </h3>
                <p className="text-xs text-[#5F5F5F] font-mono mt-0.5">
                  {adminInspectionVisit.lojaNome} • {adminInspectionVisit.dataStr.split('-').reverse().join('/')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdminInspectionVisit(null)}
                className="text-[#77766F] hover:text-[#171717] p-1 rounded-lg transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 text-xs">
              {/* Informações Gerais */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl font-mono">
                  <div className="text-[10px] text-[#5F5F5F] uppercase font-bold">Status</div>
                  <div className="text-xs font-bold text-[#171717] mt-1 capitalize">
                    {adminInspectionVisit.status.replace('_', ' ')}
                  </div>
                </div>

                <div className="p-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl font-mono">
                  <div className="text-[10px] text-[#5F5F5F] uppercase font-bold">Indústria</div>
                  <div className="text-xs font-bold text-[#171717] mt-1 truncate">
                    {adminInspectionVisit.industriaNome}
                  </div>
                </div>

                <div className="p-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl font-mono">
                  <div className="text-[10px] text-[#5F5F5F] uppercase font-bold">Check-in</div>
                  <div className="text-xs font-bold text-[#171717] mt-1">
                    {adminInspectionVisit.startedAt
                      ? new Date(adminInspectionVisit.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                      : '—'}
                  </div>
                </div>

                <div className="p-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl font-mono">
                  <div className="text-[10px] text-[#5F5F5F] uppercase font-bold">Conclusão</div>
                  <div className="text-xs font-bold text-[#171717] mt-1">
                    {adminInspectionVisit.completedAt
                      ? new Date(adminInspectionVisit.completedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                      : '—'}
                  </div>
                </div>
              </div>

              {/* Justificativa de Não Realização */}
              {adminInspectionVisit.motivoNaoRealizada && (
                <div className="p-4 bg-[#FDF2F2] border border-[#F8C8C8] rounded-xl">
                  <div className="font-bold text-[#C62828] flex items-center gap-1.5 mb-1">
                    <span className="material-symbols-outlined text-sm">report</span>
                    <span>Justificativa de Não Atendimento</span>
                  </div>
                  <p className="text-[#C62828] text-xs font-mono">{adminInspectionVisit.motivoNaoRealizada}</p>
                </div>
              )}

              {/* Galeria de Fotos com URLs Assinadas */}
              <div>
                <h4 className="font-bold text-sm text-[#171717] mb-2 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-base text-[#286FF5]">photo_library</span>
                  <span>Fotos e Evidências Fotográficas</span>
                </h4>

                {loadingInspectionPhotos ? (
                  <div className="p-6 text-center bg-[#EAE8E2] rounded-xl border border-[#CFCDC5] text-[#5F5F5F] font-mono">
                    Carregando fotos do bucket seguro...
                  </div>
                ) : !adminInspectionVisit.visitObj?.photos || adminInspectionVisit.visitObj.photos.length === 0 ? (
                  <div className="p-4 text-center bg-[#EAE8E2] rounded-xl border border-[#CFCDC5] text-[#5F5F5F] font-mono">
                    Nenhuma foto registrada nesta visita.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {adminInspectionVisit.visitObj.photos.map((photo) => {
                      const signedUrl = adminSignedPhotoUrls[photo.id || photo.storage_path];
                      return (
                        <div
                          key={photo.id}
                          className="border border-[#CFCDC5] rounded-xl overflow-hidden bg-[#EAE8E2] group cursor-pointer hover:border-[#286FF5] transition-all"
                          onClick={() => signedUrl && setAdminZoomedPhoto(signedUrl)}
                        >
                          <div className="aspect-video w-full bg-[#E4E2DB] flex items-center justify-center relative overflow-hidden">
                            {signedUrl ? (
                              <img
                                src={signedUrl}
                                alt={photo.tipo_foto}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                              />
                            ) : (
                              <span className="material-symbols-outlined text-2xl text-[#77766F]">
                                photo_camera
                              </span>
                            )}
                          </div>
                          <div className="p-2 text-[10px] bg-[#F7F6F2] border-t border-[#CFCDC5]">
                            <div className="font-bold uppercase text-[#286FF5] font-mono">{photo.tipo_foto}</div>
                            {photo.legenda && (
                              <div className="text-[#5F5F5F] truncate mt-0.5">{photo.legenda}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Checklist Realizado */}
              <div>
                <h4 className="font-bold text-sm text-[#171717] mb-2 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-base text-[#16794F]">checklist</span>
                  <span>Checklist de Atendimento</span>
                </h4>

                {!adminInspectionVisit.visitObj?.checklist_items ||
                adminInspectionVisit.visitObj.checklist_items.length === 0 ? (
                  <div className="p-4 text-center bg-[#EAE8E2] rounded-xl border border-[#CFCDC5] text-[#5F5F5F] font-mono">
                    Checklist não preenchido ou não iniciado.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {adminInspectionVisit.visitObj.checklist_items.map((item) => (
                      <div
                        key={item.id || item.item_key}
                        className={`p-2.5 rounded-xl border flex items-start gap-2 ${
                          item.checked
                            ? 'bg-[#EAF5EF] border-[#B9E5D0] text-[#16794F]'
                            : 'bg-[#EAE8E2] border-[#CFCDC5] text-[#5F5F5F]'
                        }`}
                      >
                        <span className="material-symbols-outlined text-base mt-0.5">
                          {item.checked ? 'check_box' : 'check_box_outline_blank'}
                        </span>
                        <div>
                          <div className="font-medium text-[#171717]">{item.item_label}</div>
                          {item.observacao && (
                            <div className="text-[11px] text-[#5F5F5F] mt-0.5">{item.observacao}</div>
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
                  <span className="material-symbols-outlined text-base text-[#986000]">warning</span>
                  <span>Ocorrências e Rupturas</span>
                </h4>

                {!adminInspectionVisit.visitObj?.occurrences ||
                adminInspectionVisit.visitObj.occurrences.length === 0 ? (
                  <div className="p-4 text-center bg-[#EAE8E2] rounded-xl border border-[#CFCDC5] text-[#5F5F5F] font-mono">
                    Nenhuma ocorrência reportada nesta visita.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {adminInspectionVisit.visitObj.occurrences.map((occ) => (
                      <div
                        key={occ.id}
                        className="p-3 bg-[#FFF8E6] border border-[#FCE19B] rounded-xl flex items-start justify-between font-mono"
                      >
                        <div>
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-[#986000] text-white mr-2">
                            {occ.tipo}
                          </span>
                          <span className="font-medium text-[#171717]">{occ.descricao}</span>
                        </div>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            occ.resolvido ? 'bg-[#EAF5EF] text-[#16794F]' : 'bg-[#FDF2F2] text-[#C62828]'
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
              <div>
                <h4 className="font-bold text-sm text-[#171717] mb-2 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-base text-[#286FF5]">event</span>
                  <span>Controle de Validade de Produtos</span>
                </h4>

                {!adminInspectionVisit.visitObj?.validity_items ||
                adminInspectionVisit.visitObj.validity_items.length === 0 ? (
                  <div className="p-4 text-center bg-[#EAE8E2] rounded-xl border border-[#CFCDC5] text-[#5F5F5F] font-mono">
                    Nenhum apontamento de validade registrado.
                  </div>
                ) : (
                  <div className="border border-[#CFCDC5] rounded-xl overflow-hidden font-mono">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#EAE8E2] text-[#5F5F5F] uppercase text-[10px] font-bold border-b border-[#CFCDC5]">
                        <tr>
                          <th className="px-4 py-2">Produto</th>
                          <th className="px-3 py-2">Qtd</th>
                          <th className="px-3 py-2">Vencimento</th>
                          <th className="px-3 py-2">Lote</th>
                          <th className="px-3 py-2">Observação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#CFCDC5]">
                        {adminInspectionVisit.visitObj.validity_items.map((val) => (
                          <tr key={val.id}>
                            <td className="px-4 py-2 font-medium text-[#171717]">{val.produto_nome}</td>
                            <td className="px-3 py-2 text-[#171717]">{val.quantidade}</td>
                            <td className="px-3 py-2 font-bold text-[#C62828]">{val.data_vencimento}</td>
                            <td className="px-3 py-2 text-[#5F5F5F]">{val.lote || '—'}</td>
                            <td className="px-3 py-2 text-[#5F5F5F]">{val.observacao || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Footer Modal */}
            <div className="px-6 py-3 border-t border-[#CFCDC5] bg-[#EAE8E2] flex justify-end font-mono">
              <button
                type="button"
                onClick={() => setAdminInspectionVisit(null)}
                className="px-4 py-2 bg-[#222222] text-white rounded-xl text-xs font-semibold hover:bg-black transition-colors cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RODAPÉ DO PORTAL DO PROMOTOR */}
      <footer className="pt-6 pb-2 border-t border-[#CFCDC5]/60 flex flex-col sm:flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-[#16845B]" />
          <span className="font-mono text-[11px] text-[#737373]">MK9 Date • Portal de Campo</span>
        </div>
        <AuthorSignature variant="muted" />
      </footer>

      {/* MODAL DE ZOOM DE FOTO (MODO ADMINISTRATIVO) */}
      {adminZoomedPhoto && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setAdminZoomedPhoto(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center">
            <img
              src={adminZoomedPhoto}
              alt="Evidência ampliada"
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            />
            <button
              onClick={() => setAdminZoomedPhoto(null)}
              className="mt-3 px-4 py-1.5 bg-[#222222] hover:bg-black text-white text-xs font-mono font-bold rounded-lg cursor-pointer"
            >
              Fechar Visualização
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
