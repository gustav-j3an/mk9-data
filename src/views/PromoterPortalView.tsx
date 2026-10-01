import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import type { RouteItem, Visit, ToastMessage, VisitChecklistItem } from '../types';

interface PromoterPortalViewProps {
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

const DEFAULT_CHECKLIST_ITEMS = [
  { item_key: 'loja_aberta', item_label: 'Loja aberta e em funcionamento' },
  { item_key: 'presenca_produto', item_label: 'Presença e exposição dos produtos da indústria' },
  { item_key: 'ruptura_gondola', item_label: 'Identificação de ruptura em gôndola' },
  { item_key: 'qtd_frentes', item_label: 'Contagem e verificação da quantidade de frentes' },
  { item_key: 'preco_encontrado', item_label: 'Preço etiquetado visível ao consumidor' },
  { item_key: 'preco_conforme', item_label: 'Preço em conformidade com a tabela acordada' },
  { item_key: 'ponto_extra', item_label: 'Ponto extra / ilha de destaque montada' },
  { item_key: 'material_pop', item_label: 'Material de merchandising e POP instalado' },
  { item_key: 'validade_ok', item_label: 'Validade adequada dos lotes expostos (FIFO)' },
  { item_key: 'estoque_disponivel', item_label: 'Estoque de retaguarda disponível' }
];

export const PromoterPortalView: React.FC<PromoterPortalViewProps> = ({ onShowToast }) => {
  const { profile } = useAuth();
  const promotorMatricula = profile?.promotor_matricula;

  const [loading, setLoading] = useState(true);
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [todayVisits, setTodayVisits] = useState<Visit[]>([]);
  const [activeVisit, setActiveVisit] = useState<Visit | null>(null);

  // Form State para Visita em Andamento
  const [checklist, setChecklist] = useState<Record<string, { checked: boolean; obs: string; valTxt: string }>>({});
  const [photoType, setPhotoType] = useState<'fachada' | 'gondola' | 'preco' | 'ponto_extra' | 'ruptura' | 'outros'>('gondola');
  const [photoCaption, setPhotoCaption] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [occurrenceType, setOccurrenceType] = useState<'ruptura' | 'preco_divergente' | 'falta_espaco' | 'outro'>('ruptura');
  const [occurrenceDesc, setOccurrenceDesc] = useState('');
  const [generalObs, setGeneralObs] = useState('');
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
      const todayStr = now.toISOString().split('T')[0];
      const dayIndex = now.getDay();
      const dayKeys = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
      const currentDayKey = dayKeys[dayIndex];

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
      }

      // Se for perfil de promotor, filtrar pela matrícula associada. Se for admin/gestor, carregar primeiras rotas.
      let rotasQuery = supabase.from('rotas').select(`
        *,
        industria:industrias(codigo, nome),
        loja:lojas(codigo, nome, cidade, uf, endereco),
        promotor:promotores(matricula, nome)
      `);

      if (promotorMatricula) {
        rotasQuery = rotasQuery.eq('promotor_matricula', promotorMatricula);
      }

      let visitsQuery = supabase.from('visits').select(`
        *,
        industria:industrias(codigo, nome),
        loja:lojas(codigo, nome, cidade, uf, endereco),
        promotor:promotores(matricula, nome),
        checklist_items:visit_checklist_items(*),
        photos:visit_photos(*),
        occurrences:visit_occurrences(*)
      `).eq('data_visita', todayStr);

      if (promotorMatricula) {
        visitsQuery = visitsQuery.eq('promotor_matricula', promotorMatricula);
      }

      const [rotasRes, visitsRes] = await Promise.all([rotasQuery, visitsQuery]);

      if (rotasRes.error) throw rotasRes.error;
      if (visitsRes.error) throw visitsRes.error;

      const rawRoutes = (rotasRes.data as unknown as RouteItem[]) || [];
      // Filtrar rotas com visita agendada para o dia atual
      const dayRoutes = rawRoutes.filter((r) => Boolean(r[currentDayKey as keyof RouteItem]));
      setRoutes(dayRoutes.length > 0 ? dayRoutes : rawRoutes);

      const visits = (visitsRes.data as unknown as Visit[]) || [];
      setTodayVisits(visits);

      // Verificar se há alguma visita em andamento para retomada automática
      const inProgress = visits.find((v) => v.status === 'em_andamento');
      if (inProgress) {
        setActiveVisit(inProgress);
        setGeneralObs(inProgress.observacao_geral || '');

        // Preencher checklist já salvo
        const initialChk: Record<string, { checked: boolean; obs: string; valTxt: string }> = {};
        DEFAULT_CHECKLIST_ITEMS.forEach((def) => {
          const found = inProgress.checklist_items?.find((c) => c.item_key === def.item_key);
          initialChk[def.item_key] = {
            checked: found ? found.checked : false,
            obs: found?.observacao || '',
            valTxt: found?.valor_texto || ''
          };
        });
        setChecklist(initialChk);
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
  }, [promotorMatricula, onShowToast]);

  useEffect(() => {
    loadPortalData();
  }, [loadPortalData]);

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

  // Resumo de execução do dia
  const totalPlanned = routes.length;
  const completedCount = todayVisits.filter((v) => v.status === 'concluida').length;
  const inProgressCount = todayVisits.filter((v) => v.status === 'em_andamento').length;
  const notDoneCount = todayVisits.filter((v) => v.status === 'nao_realizada').length;
  const pendingCount = Math.max(0, totalPlanned - completedCount - notDoneCount);
  const executionPerc = totalPlanned > 0 ? Math.round((completedCount / totalPlanned) * 100) : 0;

  // Iniciar Visita
  const handleStartVisit = async (route: RouteItem) => {
    if (!supabase) return;

    try {
      // Obter Geolocalização do dispositivo se disponível
      let lat: number | null = null;
      let lng: number | null = null;

      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 4000 });
          });
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
        } catch (e) {
          console.warn('Geolocalização não concedida ou timeout');
        }
      }

      const todayStr = new Date().toISOString().split('T')[0];

      // Inserir registro de visita em_andamento no Supabase
      const { data: newVisit, error: insertErr } = await supabase
        .from('visits')
        .insert([
          {
            rota_id: route.id,
            promotor_matricula: route.promotor_matricula,
            loja_codigo: route.loja_codigo,
            industria_codigo: route.industria_codigo,
            data_visita: todayStr,
            started_at: new Date().toISOString(),
            latitude: lat,
            longitude: lng,
            status: 'em_andamento'
          }
        ])
        .select(`
          *,
          industria:industrias(codigo, nome),
          loja:lojas(codigo, nome, cidade, uf, endereco),
          promotor:promotores(matricula, nome)
        `)
        .single();

      if (insertErr) throw insertErr;

      const visitData = newVisit as Visit;
      setActiveVisit(visitData);

      // Inicializar checklist padrão
      const initialChk: Record<string, { checked: boolean; obs: string; valTxt: string }> = {};
      DEFAULT_CHECKLIST_ITEMS.forEach((def) => {
        initialChk[def.item_key] = { checked: false, obs: '', valTxt: '' };
      });
      setChecklist(initialChk);

      onShowToast({
        title: 'Visita Iniciada!',
        message: `Check-in registrado na loja ${route.loja?.nome || route.loja_codigo}.`,
        type: 'success'
      });

      loadPortalData();
    } catch (err: any) {
      console.error(err);
      onShowToast({
        title: 'Falha ao Iniciar Visita',
        message: err.message || 'Erro ao registrar check-in no servidor.',
        type: 'error'
      });
    }
  };

  // Upload de Foto para o Bucket Privado 'visit-photos'
  const handleUploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeVisit || !supabase) return;

    if (file.size > 10 * 1024 * 1024) {
      onShowToast({
        title: 'Tamanho Excedido',
        message: 'A foto deve ter no máximo 10MB.',
        type: 'warning'
      });
      return;
    }

    setUploadingPhoto(true);

    try {
      const fileExt = file.name.split('.').pop() || 'jpg';
      const fileName = `${activeVisit.id}/${Date.now()}_${photoType}.${fileExt}`;
      const filePath = `visits/${fileName}`;

      // Upload no Supabase Storage
      const { error: uploadErr } = await supabase.storage
        .from('visit-photos')
        .upload(filePath, file, { upsert: true });

      if (uploadErr) throw uploadErr;

      // Obter URL pública ou assinada do arquivo
      const { data: urlData } = supabase.storage.from('visit-photos').getPublicUrl(filePath);
      const publicUrl = urlData.publicUrl;

      // Gravar referência na tabela visit_photos
      const { error: dbErr } = await supabase.from('visit-photos').insert([
        {
          visit_id: activeVisit.id,
          tipo_foto: photoType,
          storage_path: filePath,
          file_url: publicUrl,
          legenda: photoCaption.trim() || null
        }
      ]);

      if (dbErr) throw dbErr;

      onShowToast({
        title: 'Foto Anexada',
        message: `Foto de ${photoType.toUpperCase()} salva com sucesso!`,
        type: 'success'
      });

      setPhotoCaption('');
      // Atualizar objeto ativo
      const { data: updatedPhotos } = await supabase.from('visit-photos').select('*').eq('visit_id', activeVisit.id);
      setActiveVisit((prev) => (prev ? { ...prev, photos: updatedPhotos as any } : null));
    } catch (err: any) {
      console.error('Erro no upload de foto:', err);
      onShowToast({
        title: 'Falha no Upload',
        message: err.message || 'Erro ao enviar foto para o servidor.',
        type: 'error'
      });
    } finally {
      setUploadingPhoto(false);
    }
  };

  // Registrar Ocorrência / Ruptura
  const handleAddOccurrence = async () => {
    if (!occurrenceDesc.trim() || !activeVisit || !supabase) return;

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
        title: 'Ocorrência Anotada',
        message: `Incidente de ${occurrenceType} registrado para o gestor.`,
        type: 'info'
      });

      setOccurrenceDesc('');
      const { data: updatedOccs } = await supabase.from('visit_occurrences').select('*').eq('visit_id', activeVisit.id);
      setActiveVisit((prev) => (prev ? { ...prev, occurrences: updatedOccs as any } : null));
    } catch (err: any) {
      onShowToast({
        title: 'Erro de Gravação',
        message: err.message || 'Falha ao salvar ocorrência.',
        type: 'error'
      });
    }
  };

  // Finalizar Visita
  const handleCompleteVisit = async () => {
    if (!activeVisit || !supabase) return;

    try {
      // 1. Salvar itens do checklist no banco
      const checklistPayload = Object.entries(checklist).map(([key, item]) => {
        const label = DEFAULT_CHECKLIST_ITEMS.find((d) => d.item_key === key)?.item_label || key;
        return {
          visit_id: activeVisit.id,
          item_key: key,
          item_label: label,
          checked: item.checked,
          observacao: item.obs.trim() || null,
          valor_texto: item.valTxt.trim() || null
        };
      });

      // Limpar antigos e inserir atualizados
      await supabase.from('visit_checklist_items').delete().eq('visit_id', activeVisit.id);
      await supabase.from('visit_checklist_items').insert(checklistPayload);

      // 2. Atualizar status da visita para concluida
      const { error: updateErr } = await supabase
        .from('visits')
        .update({
          status: 'concluida',
          completed_at: new Date().toISOString(),
          observacao_geral: generalObs.trim() || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', activeVisit.id);

      if (updateErr) throw updateErr;

      onShowToast({
        title: 'Visita Finalizada com Sucesso! 🎉',
        message: 'Relatório enviado. O Painel Operacional foi atualizado em tempo real.',
        type: 'success'
      });

      setActiveVisit(null);
      loadPortalData();
    } catch (err: any) {
      console.error(err);
      onShowToast({
        title: 'Erro ao Concluir Visita',
        message: err.message || 'Falha ao encerrar relatório de visita no banco.',
        type: 'error'
      });
    }
  };

  // Registrar Visita Não Realizada
  const handleMarkNotDone = async () => {
    if (!showNotDoneModal || !notDoneReason.trim() || !supabase) return;

    try {
      const todayStr = new Date().toISOString().split('T')[0];

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

  return (
    <div className="w-full px-4 sm:px-6 py-6 max-w-4xl mx-auto space-y-6 font-sans">
      {/* CABEÇALHO PORTAL MOBILE-FIRST */}
      <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#1e2433] pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-amber-500 flex items-center justify-center font-bold text-white shadow-[0_0_15px_rgba(245,158,11,0.4)]">
              <span className="material-symbols-outlined text-[22px]">smartphone</span>
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-white tracking-tight">
                Portal do Promotor
              </h1>
              <p className="text-xs text-slate-400 font-mono">
                {realName} {realMatricula ? `• Matrícula: ${realMatricula}` : ''}
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={loadPortalData}
          disabled={loading}
          className="px-4 py-2 rounded-xl bg-[#171b26] border border-[#1e2433] text-xs font-semibold text-slate-300 hover:text-white flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>
            refresh
          </span>
          <span>Atualizar Minha Rota</span>
        </button>
      </section>

      {/* CARTÃO DE PERFIL DETALHADO DO PROMOTOR */}
      <div className="p-5 rounded-2xl bg-[#171b26] border border-[#1e2433] shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500 via-purple-600 to-indigo-500 flex items-center justify-center font-extrabold text-white text-lg shadow-[0_0_18px_rgba(245,158,11,0.4)] border border-amber-400/40 shrink-0">
            {initials}
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-extrabold text-white tracking-tight">
              {realName}
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
              {realMatricula ? (
                <span className="px-2.5 py-1 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold">
                  Matrícula: {realMatricula}
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300 font-bold flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs">warning</span>
                  Promotor não vinculado
                </span>
              )}

              {(realCidade || realUf) && (
                <span className="text-slate-300 flex items-center gap-1 bg-[#10141f] px-2.5 py-1 rounded border border-[#1e2433]">
                  <span className="material-symbols-outlined text-xs text-amber-400">location_on</span>
                  {realCidade}{realUf ? ` - ${realUf}` : ''}
                </span>
              )}
            </div>
          </div>
        </div>

        {(realSupervisor || realEquipe) && (
          <div className="p-3 rounded-xl bg-[#10141f] border border-[#1e2433] text-xs font-mono space-y-1 w-full sm:w-auto text-left sm:text-right">
            {realSupervisor && (
              <div className="text-slate-300">
                <span className="text-slate-500">Supervisor:</span> <strong className="text-slate-100">{realSupervisor}</strong>
              </div>
            )}
            {realEquipe && (
              <div className="text-cyan-400">
                <span className="text-slate-500">Equipe:</span> <strong>{realEquipe}</strong>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 1. RESUMO EXECUTIVO DO DIA */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
        <div className="p-4 rounded-2xl bg-[#171b26] border border-[#1e2433]">
          <span className="text-[10px] text-slate-400 block font-bold">PLANEJADAS</span>
          <span className="text-2xl font-extrabold text-white">{totalPlanned}</span>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-emerald-500/30">
          <span className="text-[10px] text-emerald-400 block font-bold">CONCLUÍDAS</span>
          <span className="text-2xl font-extrabold text-emerald-400">{completedCount}</span>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-amber-500/30">
          <span className="text-[10px] text-amber-400 block font-bold">PENDENTES</span>
          <span className="text-2xl font-extrabold text-amber-400">{pendingCount}</span>
        </div>

        <div className="p-4 rounded-2xl bg-[#171b26] border border-purple-500/30">
          <span className="text-[10px] text-purple-300 block font-bold">% EXECUÇÃO</span>
          <span className="text-2xl font-extrabold text-purple-300">{executionPerc}%</span>
        </div>
      </div>

      {/* Barra de Progresso de Execução */}
      <div className="p-4 rounded-2xl bg-[#171b26] border border-[#1e2433] space-y-2">
        <div className="flex justify-between items-center text-xs font-mono">
          <span className="text-slate-300 font-bold">Meta de Atendimento Diário:</span>
          <span className="text-cyan-400 font-bold">{completedCount} de {totalPlanned} lojas atendidas</span>
        </div>
        <div className="w-full bg-[#10141f] h-3 rounded-full overflow-hidden p-0.5 border border-[#1e2433]">
          <div
            className="bg-gradient-to-r from-amber-500 via-purple-500 to-emerald-400 h-2 rounded-full transition-all duration-500"
            style={{ width: `${executionPerc}%` }}
          />
        </div>
      </div>

      {/* TELA DE FLUXO DA VISITA EM ANDAMENTO */}
      {activeVisit ? (
        <section className="bg-[#171b26] border-2 border-amber-500/50 rounded-2xl p-6 shadow-2xl space-y-6">
          <div className="flex items-center justify-between border-b border-[#1e2433] pb-4">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-amber-400 animate-ping"></span>
              <h2 className="text-base font-bold text-white font-mono">
                Visita em Andamento — Loja: {activeVisit.loja?.nome || activeVisit.loja_codigo}
              </h2>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold font-mono uppercase">
              EM ANDAMENTO
            </span>
          </div>

          {/* Dados Gerais da Visita */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
            <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433]">
              <span className="text-slate-500 block">LOJA / ENDEREÇO:</span>
              <span className="text-white font-bold block">{activeVisit.loja?.nome}</span>
              <span className="text-slate-400 block">{activeVisit.loja?.endereco} • {activeVisit.loja?.cidade}/{activeVisit.loja?.uf}</span>
            </div>

            <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433]">
              <span className="text-slate-500 block">INDÚSTRIA PARCEIRA:</span>
              <span className="text-purple-300 font-bold block">{activeVisit.industria?.nome || activeVisit.industria_codigo}</span>
              <span className="text-slate-400 block">Horário Check-in: {activeVisit.started_at ? new Date(activeVisit.started_at).toLocaleTimeString('pt-BR') : '—'}</span>
            </div>
          </div>

          {/* PASSO 1: CHECKLIST OPERACIONAL */}
          <div className="space-y-3 pt-2 border-t border-[#1e2433]">
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-400 text-sm">fact_check</span>
              1. Checklist de Atendimento (10 Itens Padrão)
            </h3>

            <div className="space-y-2">
              {DEFAULT_CHECKLIST_ITEMS.map((item) => {
                const state = checklist[item.item_key] || { checked: false, obs: '', valTxt: '' };
                return (
                  <div key={item.item_key} className="p-3 rounded-xl bg-[#131722] border border-[#1e2433] space-y-2">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={state.checked}
                        onChange={(e) =>
                          setChecklist({
                            ...checklist,
                            [item.item_key]: { ...state, checked: e.target.checked }
                          })
                        }
                        className="rounded border-[#1e2433] bg-[#171b26] text-emerald-500 focus:ring-emerald-400 w-4 h-4"
                      />
                      <span className={`text-xs font-mono font-bold ${state.checked ? 'text-emerald-300' : 'text-slate-300'}`}>
                        {item.item_label}
                      </span>
                    </label>

                    {state.checked && (
                      <div className="pl-7 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                        <input
                          type="text"
                          value={state.valTxt}
                          onChange={(e) =>
                            setChecklist({
                              ...checklist,
                              [item.item_key]: { ...state, valTxt: e.target.value }
                            })
                          }
                          placeholder="Valor / Preço / Qtd..."
                          className="h-8 px-2.5 bg-[#171b26] border border-[#1e2433] rounded-lg text-slate-200 focus:outline-none focus:border-amber-500"
                        />
                        <input
                          type="text"
                          value={state.obs}
                          onChange={(e) =>
                            setChecklist({
                              ...checklist,
                              [item.item_key]: { ...state, obs: e.target.value }
                            })
                          }
                          placeholder="Observações do item..."
                          className="h-8 px-2.5 bg-[#171b26] border border-[#1e2433] rounded-lg text-slate-200 focus:outline-none focus:border-amber-500"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* PASSO 2: ANEXAR FOTOS DO PONTO DE VENDA */}
          <div className="space-y-3 pt-3 border-t border-[#1e2433]">
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono flex items-center gap-2">
              <span className="material-symbols-outlined text-cyan-400 text-sm">photo_camera</span>
              2. Evidências Fotográficas do PDV (Bucket Privado Supabase)
            </h3>

            <div className="p-4 rounded-xl bg-[#131722] border border-[#1e2433] space-y-3 font-mono text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">TIPO DA FOTO (*)</label>
                  <select
                    value={photoType}
                    onChange={(e) => setPhotoType(e.target.value as any)}
                    className="w-full h-9 px-2 bg-[#171b26] border border-[#1e2433] rounded-lg text-slate-200"
                  >
                    <option value="fachada">FACHADA</option>
                    <option value="gondola">GÔNDOLA / EXPOSIÇÃO</option>
                    <option value="preco">PREÇO ETIQUETADO</option>
                    <option value="ponto_extra">PONTO EXTRA</option>
                    <option value="ruptura">RUPTURA</option>
                    <option value="outros">OUTROS</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="text-slate-400 block mb-1">LEGENDA / OBSERVAÇÃO</label>
                  <input
                    type="text"
                    value={photoCaption}
                    onChange={(e) => setPhotoCaption(e.target.value)}
                    placeholder="Ex: Foto do ponto extra da marca no corredor 3..."
                    className="w-full h-9 px-3 bg-[#171b26] border border-[#1e2433] rounded-lg text-slate-200"
                  />
                </div>
              </div>

              <div className="relative">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleUploadPhoto}
                  disabled={uploadingPhoto}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
                <button
                  type="button"
                  disabled={uploadingPhoto}
                  className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-base">cloud_upload</span>
                  <span>{uploadingPhoto ? 'Enviando foto para o Supabase Storage...' : 'Selecionar & Anexar Foto'}</span>
                </button>
              </div>

              {/* Lista de Fotos Anexadas */}
              {activeVisit.photos && activeVisit.photos.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
                  {activeVisit.photos.map((p, idx) => (
                    <div key={idx} className="p-2 rounded-lg bg-[#171b26] border border-[#1e2433] space-y-1">
                      <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 text-[9px] font-bold block uppercase truncate">
                        {p.tipo_foto}
                      </span>
                      {p.legenda && <p className="text-[10px] text-slate-400 truncate">{p.legenda}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* PASSO 3: OCORRÊNCIAS E RUPTURAS */}
          <div className="space-y-3 pt-3 border-t border-[#1e2433]">
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono flex items-center gap-2">
              <span className="material-symbols-outlined text-rose-400 text-sm">report_problem</span>
              3. Ocorrências &amp; Rupturas Registradas
            </h3>

            <div className="p-4 rounded-xl bg-[#131722] border border-[#1e2433] space-y-3 font-mono text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">TIPO DE INCIDENTE</label>
                  <select
                    value={occurrenceType}
                    onChange={(e) => setOccurrenceType(e.target.value as any)}
                    className="w-full h-9 px-2 bg-[#171b26] border border-[#1e2433] rounded-lg text-slate-200"
                  >
                    <option value="ruptura">RUPTURA DE ESTOQUE</option>
                    <option value="preco_divergente">PREÇO DIVERGENTE</option>
                    <option value="falta_espaco">FALTA DE ESPAÇO</option>
                    <option value="outro">OUTRO</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="text-slate-400 block mb-1">DESCRIÇÃO DA OCORRÊNCIA</label>
                  <input
                    type="text"
                    value={occurrenceDesc}
                    onChange={(e) => setOccurrenceDesc(e.target.value)}
                    placeholder="Descreva a ruptura ou problema..."
                    className="w-full h-9 px-3 bg-[#171b26] border border-[#1e2433] rounded-lg text-slate-200"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleAddOccurrence}
                disabled={!occurrenceDesc.trim()}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">add</span>
                <span>Adicionar Ocorrência</span>
              </button>

              {activeVisit.occurrences && activeVisit.occurrences.length > 0 && (
                <div className="space-y-1.5 pt-2">
                  {activeVisit.occurrences.map((occ, idx) => (
                    <div key={idx} className="p-2 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 flex justify-between items-center text-[11px]">
                      <span><strong>{occ.tipo.toUpperCase()}:</strong> {occ.descricao}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* PASSO 4: OBSERVAÇÕES GERAIS E FINALIZAÇÃO */}
          <div className="space-y-3 pt-3 border-t border-[#1e2433]">
            <label className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono block">
              4. Observações Gerais do Atendimento
            </label>
            <textarea
              value={generalObs}
              onChange={(e) => setGeneralObs(e.target.value)}
              placeholder="Digite impressões gerais, conversas com o gerente da loja..."
              className="w-full p-3 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-amber-500 font-mono text-xs h-20 resize-none"
            />
          </div>

          <div className="pt-4 border-t border-[#1e2433] flex items-center justify-end gap-3 font-mono">
            <button
              onClick={handleCompleteVisit}
              className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 shadow-[0_0_15px_rgba(16,185,129,0.4)] cursor-pointer"
            >
              <span className="material-symbols-outlined text-lg">check_circle</span>
              <span>Finalizar Visita &amp; Sincronizar</span>
            </button>
          </div>
        </section>
      ) : null}

      {/* 2. ROTA DO DIA (LISTA DE LOJAS PARA ATENDIMENTO) */}
      <section className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
            <span className="material-symbols-outlined text-amber-400">route</span>
            2. Rota de Hoje ({routes.length} agendadas)
          </h3>
        </div>

        {routes.length === 0 ? (
          <div className="py-12 text-center space-y-3 font-mono">
            <div className="w-12 h-12 rounded-full bg-[#131722] border border-[#1e2433] flex items-center justify-center text-slate-500 mx-auto">
              <span className="material-symbols-outlined text-2xl">event_busy</span>
            </div>
            <h4 className="text-xs font-bold text-white">Nenhuma Rota Agendada para Hoje</h4>
            <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
              Não há vínculos de rotas fixas para sua matrícula no dia da semana atual.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {routes.map((route, idx) => {
              const visit = todayVisits.find((v) => v.loja_codigo === route.loja_codigo && v.industria_codigo === route.industria_codigo);
              const status = visit ? visit.status : 'pendente';

              return (
                <div
                  key={route.id}
                  className={`p-4 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 font-mono ${
                    status === 'concluida'
                      ? 'bg-emerald-950/20 border-emerald-500/30'
                      : status === 'em_andamento'
                      ? 'bg-amber-950/20 border-amber-500/50'
                      : status === 'nao_realizada'
                      ? 'bg-rose-950/20 border-rose-500/30'
                      : 'bg-[#131722] border-[#1e2433]'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[#171b26] border border-[#1e2433] text-purple-300 font-bold text-[10px] flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <h4 className="text-sm font-bold text-white">{route.loja?.nome || route.loja_codigo}</h4>
                      <span
                        className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                          status === 'concluida'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : status === 'em_andamento'
                            ? 'bg-amber-500/20 text-amber-300 animate-pulse'
                            : status === 'nao_realizada'
                            ? 'bg-rose-500/20 text-rose-300'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {status.replace('_', ' ')}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-400">
                      Endereço: {(route.loja as any)?.endereco || '—'} ({route.loja?.cidade}/{route.loja?.uf || route.uf || '-'})
                    </p>
                    <div className="flex items-center gap-3 text-[10px] text-slate-500">
                      <span>Indústria: <strong className="text-purple-300">{route.industria?.nome || route.industria_codigo}</strong></span>
                      <span>Frequência: <strong className="text-cyan-300">{route.frequencia}</strong></span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {status === 'pendente' && !activeVisit && (
                      <>
                        <button
                          onClick={() => handleStartVisit(route)}
                          className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md"
                        >
                          <span className="material-symbols-outlined text-sm">play_arrow</span>
                          <span>Iniciar Visita</span>
                        </button>
                        <button
                          onClick={() => setShowNotDoneModal(route)}
                          className="px-3 py-2 rounded-xl bg-[#171b26] hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-[#1e2433] text-xs font-bold cursor-pointer"
                          title="Justificar Não Realização"
                        >
                          Não Atendido
                        </button>
                      </>
                    )}

                    {status === 'em_andamento' && (
                      <span className="text-xs text-amber-300 font-bold flex items-center gap-1">
                        <span className="material-symbols-outlined text-sm animate-spin">sync</span>
                        Em Preenchimento
                      </span>
                    )}

                    {status === 'concluida' && (
                      <span className="text-xs text-emerald-400 font-bold flex items-center gap-1">
                        <span className="material-symbols-outlined text-sm">check_circle</span>
                        Concluída
                      </span>
                    )}

                    {status === 'nao_realizada' && (
                      <span className="text-xs text-rose-400 font-bold flex items-center gap-1">
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

      {/* MODAL JUSTIFICAR NÃO REALIZAÇÃO */}
      {showNotDoneModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#171b26] border border-[#1e2433] rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-[#1e2433] pb-3">
              <h3 className="text-sm font-bold text-white font-mono flex items-center gap-2">
                <span className="material-symbols-outlined text-rose-400">report_problem</span>
                Justificar Não Atendimento
              </h3>
              <button onClick={() => setShowNotDoneModal(null)} className="text-slate-400 hover:text-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-3 font-mono text-xs">
              <div className="p-3 rounded-xl bg-[#131722] border border-[#1e2433] text-slate-300">
                <div>Loja: <strong className="text-white">{showNotDoneModal.loja?.nome}</strong></div>
                <div>Indústria: <strong className="text-purple-300">{showNotDoneModal.industria?.nome}</strong></div>
              </div>

              <div>
                <label className="text-slate-300 block mb-1 font-bold">MOTIVO DO NÃO ATENDIMENTO (*)</label>
                <textarea
                  required
                  value={notDoneReason}
                  onChange={(e) => setNotDoneReason(e.target.value)}
                  placeholder="Ex: Loja fechada para inventário, falta de chave, ausência do encarregado..."
                  className="w-full p-3 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-rose-500 h-24 resize-none"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-[#1e2433] flex items-center justify-end gap-3 font-mono">
              <button
                type="button"
                onClick={() => setShowNotDoneModal(null)}
                className="px-4 py-2 rounded-xl bg-[#131722] text-slate-300 border border-[#1e2433] text-xs font-semibold cursor-pointer"
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
    </div>
  );
};
