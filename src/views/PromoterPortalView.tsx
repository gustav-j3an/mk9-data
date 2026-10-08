import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import type { RouteItem, Visit, ToastMessage, VisitChecklistItem } from '../types';
import {
  calculateOperationalVisits,
  getWeekDaysRange,
  getLocalDateString,
  DayOfWeekDate,
  OperationalVisitItem
} from '../utils/routePlanner';

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

  // Estado para Agenda Semanal "MINHA SEMANA" (Etapa 7.2)
  const [weekOffset, setWeekOffset] = useState<number>(0);
  const [weekVisits, setWeekVisits] = useState<Visit[]>([]);
  const [selectedDayDateStr, setSelectedDayDateStr] = useState<string>(getLocalDateString(new Date()));

  // Form State para Visita em Andamento
  const [checklist, setChecklist] = useState<Record<string, { checked: boolean; obs: string; valTxt: string }>>({});
  const [savingChecklistKey, setSavingChecklistKey] = useState<string | null>(null);
  const [photoType, setPhotoType] = useState<'fachada' | 'gondola' | 'preco' | 'ponto_extra' | 'ruptura' | 'outros'>('gondola');
  const [photoCaption, setPhotoCaption] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
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

      const weekDays = getWeekDaysRange(new Date(), weekOffset);
      const weekStartStr = weekDays[0].dateStr;
      const weekEndStr = weekDays[6].dateStr;

      let visitsQuery = supabase.from('visits').select(`
        *,
        industria:industrias(codigo, nome),
        loja:lojas(codigo, nome, cidade, uf, endereco),
        promotor:promotores(matricula, nome),
        checklist_items:visit_checklist_items(*),
        photos:visit_photos(*),
        occurrences:visit_occurrences(*),
        validity_items:visit_product_validity(*)
      `).gte('data_visita', weekStartStr).lte('data_visita', weekEndStr);

      if (promotorMatricula) {
        visitsQuery = visitsQuery.eq('promotor_matricula', promotorMatricula);
      }

      const [rotasRes, visitsRes] = await Promise.all([rotasQuery, visitsQuery]);

      if (rotasRes.error) throw rotasRes.error;
      if (visitsRes.error) throw visitsRes.error;

      const rawRoutes = (rotasRes.data as unknown as RouteItem[]) || [];
      setRoutes(rawRoutes);

      const visits = (visitsRes.data as unknown as Visit[]) || [];
      setWeekVisits(visits);
      setTodayVisits(visits.filter((v) => v.data_visita === todayStr));

      // Verificar se há alguma visita em andamento para retomada automática
      const inProgress = visits.find((v) => v.status === 'em_andamento');
      if (inProgress) {
        // Gerar signedUrls para as fotos da visita ativa
        if (inProgress.photos && inProgress.photos.length > 0) {
          const photosWithSignedUrls = await Promise.all(
            inProgress.photos.map(async (p) => {
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
          inProgress.photos = photosWithSignedUrls;
        }

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
  }, [loadPortalData, weekOffset]);

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

    if (!promotorMatricula) {
      onShowToast({
        title: 'Matrícula Não Vinculada',
        message: 'Seu usuário não possui uma matrícula de promotor associada. Solicite ao administrador a vinculação do seu perfil a um promotor cadastrado.',
        type: 'warning'
      });
      return;
    }

    try {
      const todayStr = new Date().toISOString().split('T')[0];

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

        // Inserir registro de visita em_andamento no Supabase usando schema exato
        const { data: newVisit, error: insertErr } = await supabase
          .from('visits')
          .insert([
            {
              rota_id: route.id,
              promotor_matricula: promotorMatricula,
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

        visitData = newVisit as Visit;
        onShowToast({
          title: 'Visita Iniciada!',
          message: `Check-in registrado na loja ${route.loja?.nome || route.loja_codigo}.`,
          type: 'success'
        });
      }

      setActiveVisit(visitData);

      // Inicializar checklist padrão
      const initialChk: Record<string, { checked: boolean; obs: string; valTxt: string }> = {};
      DEFAULT_CHECKLIST_ITEMS.forEach((def) => {
        const found = visitData.checklist_items?.find((c) => c.item_key === def.item_key);
        initialChk[def.item_key] = {
          checked: found ? found.checked : false,
          obs: found?.observacao || '',
          valTxt: found?.valor_texto || ''
        };
      });
      setChecklist(initialChk);

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
    if (!file || !activeVisit || !supabase) return;

    // 1. Validar tipo MIME de segurança (somente imagens seguras)
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (!file.type.startsWith('image/') || file.type.includes('svg') || (!allowedTypes.includes(file.type.toLowerCase()) && !file.type.startsWith('image/'))) {
      onShowToast({
        title: 'Formato Inválido',
        message: 'Apenas arquivos de imagem válidos (JPG, PNG, WEBP) são permitidos.',
        type: 'warning'
      });
      return;
    }

    setUploadingPhoto(true);
    setPhotoStatusMessage('Otimizando foto...');
    let uploadedPath: string | null = null;

    try {
      // 2. Compressão e Redimensionamento no Dispositivo antes do envio (Máx 1920px, Qualidade 82% JPEG)
      let fileToUpload: Blob = file;
      try {
        fileToUpload = await compressImageFile(file, 1920, 0.82);
        console.log(`Foto otimizada: Original ${(file.size / 1024).toFixed(1)} KB -> Otimizada ${(fileToUpload.size / 1024).toFixed(1)} KB`);
      } catch (cErr) {
        console.warn('Falha na otimização nativa, enviando arquivo original:', cErr);
      }

      // 3. Validar limite de tamanho pós-compressão (máximo 5MB)
      if (fileToUpload.size > 5 * 1024 * 1024) {
        onShowToast({
          title: 'Tamanho Excedido',
          message: 'Mesmo após a otimização, a foto excedeu o limite seguro de 5MB.',
          type: 'warning'
        });
        setUploadingPhoto(false);
        setPhotoStatusMessage('');
        return;
      }

      setPhotoStatusMessage('Enviando foto...');

      // Estrutura padrão de caminho: visits/{visit_id}/{timestamp}_{tipo}.jpg
      const fileName = `${activeVisit.id}/${Date.now()}_${photoType}.jpg`;
      uploadedPath = `visits/${fileName}`;

      // 4. Upload no Supabase Storage
      const { error: uploadErr } = await supabase.storage
        .from('visit-photos')
        .upload(uploadedPath, fileToUpload, { upsert: true, contentType: 'image/jpeg' });

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
          tipo_foto: photoType,
          storage_path: uploadedPath,
          file_url: signedUrl || uploadedPath,
          legenda: photoCaption.trim() || null
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
    if (!activeVisit || !supabase || completingVisit) return;

    setCompletingVisit(true);

    try {
      // 1. Obter Geolocalização do dispositivo no check-out se disponível
      let lat: number | null = activeVisit.latitude || null;
      let lng: number | null = activeVisit.longitude || null;

      if (navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3500 });
          });
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
        } catch (e) {
          console.warn('Geolocalização no check-out não concedida ou timeout');
        }
      }

      // 2. Persistir itens finais do checklist no banco
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

      if (checklistPayload.length > 0) {
        await supabase.from('visit_checklist_items').delete().eq('visit_id', activeVisit.id);
        await supabase.from('visit_checklist_items').insert(checklistPayload);
      }

      // 3. Atualizar visita com status oficial 'concluida' e completed_at (preservando started_at)
      const nowIso = new Date().toISOString();
      const { error: updateErr } = await supabase
        .from('visits')
        .update({
          status: 'concluida',
          completed_at: nowIso,
          latitude: lat,
          longitude: lng,
          observacao_geral: generalObs.trim() || null,
          updated_at: nowIso
        })
        .eq('id', activeVisit.id);

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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-400 text-sm">fact_check</span>
                1. Checklist de Atendimento ({DEFAULT_CHECKLIST_ITEMS.length} Itens)
              </h3>
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                  {Object.values(checklist).filter((c) => c.checked).length} de {DEFAULT_CHECKLIST_ITEMS.length} concluídos
                </span>
                {savingChecklistKey && (
                  <span className="text-[10px] text-cyan-400 font-bold flex items-center gap-1 animate-pulse">
                    <span className="material-symbols-outlined text-xs animate-spin">sync</span>
                    Salvando...
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-2">
              {DEFAULT_CHECKLIST_ITEMS.map((item) => {
                const state = checklist[item.item_key] || { checked: false, obs: '', valTxt: '' };
                const isSaving = savingChecklistKey === item.item_key;

                const handleChecklistChange = async (newChecked: boolean, newObs: string, newValTxt: string) => {
                  const updatedState = { checked: newChecked, obs: newObs, valTxt: newValTxt };
                  setChecklist((prev) => ({
                    ...prev,
                    [item.item_key]: updatedState
                  }));

                  if (!activeVisit || !supabase) return;

                  setSavingChecklistKey(item.item_key);
                  try {
                    // Tentar upsert imediato em public.visit_checklist_items
                    const { data: existing } = await supabase
                      .from('visit_checklist_items')
                      .select('id')
                      .eq('visit_id', activeVisit.id)
                      .eq('item_key', item.item_key)
                      .maybeSingle();

                    if (existing) {
                      await supabase
                        .from('visit_checklist_items')
                        .update({
                          checked: newChecked,
                          observacao: newObs.trim() || null,
                          valor_texto: newValTxt.trim() || null
                        })
                        .eq('id', existing.id);
                    } else {
                      await supabase
                        .from('visit_checklist_items')
                        .insert([
                          {
                            visit_id: activeVisit.id,
                            item_key: item.item_key,
                            item_label: item.item_label,
                            checked: newChecked,
                            observacao: newObs.trim() || null,
                            valor_texto: newValTxt.trim() || null
                          }
                        ]);
                    }
                  } catch (err) {
                    console.error('Erro ao persistir item de checklist:', err);
                  } finally {
                    setSavingChecklistKey(null);
                  }
                };

                return (
                  <div key={item.item_key} className="p-3 rounded-xl bg-[#131722] border border-[#1e2433] space-y-2">
                    <label className="flex items-center justify-between cursor-pointer">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={state.checked}
                          disabled={isSaving}
                          onChange={(e) => handleChecklistChange(e.target.checked, state.obs, state.valTxt)}
                          className="rounded border-[#1e2433] bg-[#171b26] text-emerald-500 focus:ring-emerald-400 w-4 h-4 cursor-pointer"
                        />
                        <span className={`text-xs font-mono font-bold ${state.checked ? 'text-emerald-300' : 'text-slate-300'}`}>
                          {item.item_label}
                        </span>
                      </div>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase ${state.checked ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                        {state.checked ? 'Concluído' : 'Pendente'}
                      </span>
                    </label>

                    {state.checked && (
                      <div className="pl-7 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                        <input
                          type="text"
                          value={state.valTxt}
                          onChange={(e) => handleChecklistChange(state.checked, state.obs, e.target.value)}
                          placeholder="Valor / Preço / Qtd..."
                          className="h-8 px-2.5 bg-[#171b26] border border-[#1e2433] rounded-lg text-slate-200 focus:outline-none focus:border-amber-500"
                        />
                        <input
                          type="text"
                          value={state.obs}
                          onChange={(e) => handleChecklistChange(state.checked, e.target.value, state.valTxt)}
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
                  <span className={`material-symbols-outlined text-base ${uploadingPhoto ? 'animate-spin' : ''}`}>
                    {uploadingPhoto ? 'sync' : 'cloud_upload'}
                  </span>
                  <span>{uploadingPhoto ? (photoStatusMessage || 'Otimizando & enviando foto...') : 'Tirar Foto ou Selecionar da Galeria'}</span>
                </button>
              </div>

              {/* Lista de Fotos Anexadas com Preview de Miniaturas */}
              {activeVisit.photos && activeVisit.photos.length > 0 ? (
                <div className="space-y-2 pt-2 border-t border-[#1e2433]">
                  <span className="text-[11px] text-slate-400 font-bold block">FOTOS REGISTRADAS NESTA VISITA ({activeVisit.photos.length}):</span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {activeVisit.photos.map((p, idx) => (
                      <div key={idx} className="p-2 rounded-xl bg-[#171b26] border border-[#1e2433] space-y-1.5 flex flex-col justify-between">
                        <div className="relative aspect-video rounded-lg bg-[#10141f] overflow-hidden border border-[#1e2433] flex items-center justify-center">
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
                        {p.legenda && <p className="text-[10px] text-slate-300 truncate" title={p.legenda}>{p.legenda}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-slate-500 italic pt-1 text-center">Nenhuma foto enviada para esta visita ainda.</p>
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
                <div className="space-y-2 pt-2 border-t border-[#1e2433]">
                  <span className="text-[11px] text-slate-400 font-bold block">OCORRÊNCIAS NESTA VISITA ({activeVisit.occurrences.length}):</span>
                  <div className="space-y-2">
                    {activeVisit.occurrences.map((occ, idx) => (
                      <div key={idx} className="p-3 rounded-xl bg-rose-950/20 border border-rose-500/30 text-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-rose-500/30 text-rose-300 text-[10px] font-bold uppercase">
                              {occ.tipo.replace('_', ' ')}
                            </span>
                            {occ.created_at && (
                              <span className="text-[10px] text-slate-400">
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
                <p className="text-[11px] text-slate-500 italic pt-1 text-center">Nenhuma ocorrência registrada para esta visita.</p>
              )}
            </div>
          </div>

          {/* PASSO 4: CONTROLE DE VALIDADE E VENCIMENTO DE PRODUTOS */}
          <div className="space-y-3 pt-3 border-t border-[#1e2433]">
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-400 text-sm">inventory_2</span>
              4. 📦 Controle de Validade dos Produtos
            </h3>

            <div className="p-4 rounded-xl bg-[#131722] border border-[#1e2433] space-y-3 font-mono text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="lg:col-span-2">
                  <label className="text-slate-400 block mb-1">PRODUTO (*)</label>
                  <input
                    type="text"
                    value={validityProdutoNome}
                    onChange={(e) => setValidityProdutoNome(e.target.value)}
                    placeholder="Nome ou descrição do produto..."
                    className="w-full h-9 px-3 bg-[#171b26] border border-[#1e2433] rounded-lg text-slate-200"
                  />
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">QUANTIDADE (*)</label>
                  <input
                    type="number"
                    min="1"
                    value={validityQuantidade}
                    onChange={(e) => setValidityQuantidade(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full h-9 px-3 bg-[#171b26] border border-[#1e2433] rounded-lg text-slate-200"
                  />
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">VALIDADE (*)</label>
                  <input
                    type="date"
                    value={validityDataVencimento}
                    onChange={(e) => setValidityDataVencimento(e.target.value)}
                    className="w-full h-9 px-3 bg-[#171b26] border border-[#1e2433] rounded-lg text-slate-200"
                  />
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">LOTE (OPCIONAL)</label>
                  <input
                    type="text"
                    value={validityLote}
                    onChange={(e) => setValidityLote(e.target.value)}
                    placeholder="L12345"
                    className="w-full h-9 px-3 bg-[#171b26] border border-[#1e2433] rounded-lg text-slate-200"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">OBSERVAÇÃO (OPCIONAL)</label>
                <input
                  type="text"
                  value={validityObservacao}
                  onChange={(e) => setValidityObservacao(e.target.value)}
                  placeholder="Ex: Produto recolhido / Avaria na embalagem..."
                  className="w-full h-9 px-3 bg-[#171b26] border border-[#1e2433] rounded-lg text-slate-200"
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
                <div className="space-y-2 pt-2 border-t border-[#1e2433]">
                  <span className="text-[11px] text-slate-400 font-bold block">
                    PRODUTOS E VALIDADES REGISTRADOS ({activeVisit.validity_items.length}):
                  </span>

                  <div className="overflow-x-auto rounded-lg border border-[#1e2433]">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-[#171b26] text-slate-400 text-[10px] font-bold uppercase border-b border-[#1e2433]">
                          <th className="py-2 px-3">Produto</th>
                          <th className="py-2 px-3 text-right">Qtd.</th>
                          <th className="py-2 px-3">Validade</th>
                          <th className="py-2 px-3">Lote</th>
                          <th className="py-2 px-3 text-right">Situação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1e2433] text-slate-200">
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
                            <tr key={valItem.id || idx} className="hover:bg-[#171b26]/50">
                              <td className="py-2 px-3 font-bold text-white">{valItem.produto_nome}</td>
                              <td className="py-2 px-3 text-right font-bold text-amber-300">{valItem.quantidade}</td>
                              <td className="py-2 px-3">{new Date(vencDate).toLocaleDateString('pt-BR')}</td>
                              <td className="py-2 px-3 text-slate-400">{valItem.lote || '—'}</td>
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
                <p className="text-[11px] text-slate-500 italic pt-1 text-center">
                  Nenhum produto cadastrado para controle de validade nesta visita.
                </p>
              )}
            </div>
          </div>

          {/* PASSO 5: OBSERVAÇÕES GERAIS E FINALIZAÇÃO */}
          <div className="space-y-4 pt-3 border-t border-[#1e2433]">
            <div>
              <label className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono block mb-1.5">
                5. Observações Gerais do Atendimento
              </label>
              <textarea
                value={generalObs}
                onChange={(e) => setGeneralObs(e.target.value)}
                placeholder="Digite impressões gerais, conversas com o gerente da loja..."
                className="w-full p-3 bg-[#131722] border border-[#1e2433] rounded-xl text-slate-200 focus:outline-none focus:border-amber-500 font-mono text-xs h-20 resize-none"
              />
            </div>

            {/* PAINEL DE RESUMO DA VISITA PARA FINALIZAÇÃO */}
            <div className="p-4 rounded-xl bg-[#10141f] border border-[#1e2433] space-y-3 font-mono text-xs">
              <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-sm">summarize</span>
                Resumo do Atendimento Antes do Check-out
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-slate-300">
                <div className="p-2.5 rounded-lg bg-[#171b26] border border-[#1e2433]">
                  <span className="text-[10px] text-slate-500 block font-bold">HORÁRIO ENTRADA</span>
                  <span className="text-sm font-extrabold text-white">
                    {activeVisit.started_at ? new Date(activeVisit.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#171b26] border border-[#1e2433]">
                  <span className="text-[10px] text-slate-500 block font-bold">CHECKLIST</span>
                  <span className="text-sm font-extrabold text-amber-300">
                    {Object.values(checklist).filter((c) => c.checked).length} / {DEFAULT_CHECKLIST_ITEMS.length}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#171b26] border border-[#1e2433]">
                  <span className="text-[10px] text-slate-500 block font-bold">FOTOS ANEXADAS</span>
                  <span className="text-sm font-extrabold text-cyan-300">
                    {activeVisit.photos?.length || 0}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#171b26] border border-[#1e2433]">
                  <span className="text-[10px] text-slate-500 block font-bold">OCORRÊNCIAS</span>
                  <span className="text-sm font-extrabold text-rose-300">
                    {activeVisit.occurrences?.length || 0}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-[#171b26] border border-[#1e2433]">
                  <span className="text-[10px] text-slate-500 block font-bold">VALIDADES</span>
                  <span className="text-sm font-extrabold text-amber-400">
                    {activeVisit.validity_items?.length || 0}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-[#1e2433] flex flex-col sm:flex-row items-center justify-between gap-3 font-mono">
            <span className="text-[11px] text-slate-400 text-center sm:text-left">
              Ao finalizar, o check-out será registrado e a visita não poderá ser reeditada.
            </span>
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
        </section>
      ) : null}

      {/* 2. MINHA SEMANA OPERACIONAL */}
      <section className="bg-[#171b26] border border-[#1e2433] rounded-2xl p-6 shadow-2xl space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1e2433] pb-4">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
              <span className="material-symbols-outlined text-purple-400">calendar_view_week</span>
              2. Minha Semana Operacional ({allWeekOperationalVisits.length} agendadas)
            </h3>
            <p className="text-[11px] text-slate-400 font-mono mt-0.5">
              Agenda semanal completa das suas rotas operacionais e pendências acumuladas.
            </p>
          </div>

          {/* Navegação entre semanas */}
          <div className="flex items-center gap-2 shrink-0 font-mono text-xs">
            <button
              onClick={() => setWeekOffset((prev) => prev - 1)}
              className="p-1.5 rounded-lg bg-[#131722] hover:bg-[#1a202c] border border-[#1e2433] text-slate-300 hover:text-white cursor-pointer flex items-center gap-1"
              title="Semana anterior"
            >
              <span className="material-symbols-outlined text-sm">chevron_left</span>
              <span className="hidden md:inline">Anterior</span>
            </button>

            <button
              onClick={() => setWeekOffset(0)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors cursor-pointer ${
                weekOffset === 0
                  ? 'bg-purple-600/30 text-purple-300 border-purple-500/50'
                  : 'bg-[#131722] text-slate-300 border-[#1e2433] hover:text-white'
              }`}
            >
              Semana Atual
            </button>

            <button
              onClick={() => setWeekOffset((prev) => prev + 1)}
              className="p-1.5 rounded-lg bg-[#131722] hover:bg-[#1a202c] border border-[#1e2433] text-slate-300 hover:text-white cursor-pointer flex items-center gap-1"
              title="Próxima semana"
            >
              <span className="hidden md:inline">Próxima</span>
              <span className="material-symbols-outlined text-sm">chevron_right</span>
            </button>
          </div>
        </div>

        {/* Resumo rápido por dia da semana */}
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 font-mono">
          {weekDaysRange.map((day) => {
            const isTodayDay = day.dateStr === getLocalDateString(new Date());
            const dayVisits = allWeekOperationalVisits.filter((v) => v.dataStr === day.dateStr);
            const pendingCount = dayVisits.filter((v) => v.status === 'pendente').length;
            const completedCount = dayVisits.filter((v) => v.status === 'concluida').length;

            return (
              <div
                key={day.dateStr}
                className={`p-2.5 rounded-xl border flex flex-col justify-between space-y-1 ${
                  isTodayDay
                    ? 'bg-purple-950/20 border-purple-500/40'
                    : 'bg-[#131722] border-[#1e2433]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">{day.dayShort}</span>
                  {isTodayDay && (
                    <span className="px-1.5 py-0.2 text-[8px] font-bold rounded bg-purple-500/20 text-purple-300">
                      HOJE
                    </span>
                  )}
                </div>
                <div className="text-xs font-bold text-white">
                  {day.dateStr.split('-').reverse().slice(0, 2).join('/')}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] pt-1 border-t border-[#1e2433]/50">
                  {completedCount > 0 && <span className="text-emerald-400 font-bold">🟢 {completedCount}</span>}
                  {pendingCount > 0 && <span className="text-rose-400 font-bold">🔴 {pendingCount}</span>}
                  {dayVisits.length === 0 && <span className="text-slate-600">—</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Lista detalhada das visitas da semana */}
        {allWeekOperationalVisits.length === 0 ? (
          <div className="py-12 text-center space-y-3 font-mono">
            <div className="w-12 h-12 rounded-full bg-[#131722] border border-[#1e2433] flex items-center justify-center text-slate-500 mx-auto">
              <span className="material-symbols-outlined text-2xl">event_busy</span>
            </div>
            <h4 className="text-xs font-bold text-white">Nenhuma Rota para esta Semana</h4>
            <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
              Não foram encontradas rotas cadastradas para a sua matrícula na semana selecionada.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {allWeekOperationalVisits.map((item, idx) => {
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
                      : 'bg-[#131722] border-[#1e2433]'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[#171b26] border border-[#1e2433] text-purple-300 font-bold text-[10px] flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <span className="text-xs font-bold text-purple-300 uppercase">
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
                            : 'bg-slate-800 text-slate-300 border border-slate-700'
                        }`}
                      >
                        {item.status === 'concluida' && '🟢 Concluída'}
                        {item.status === 'em_andamento' && '🔵 Em andamento'}
                        {item.status === 'pendente' && (item.isPastOverdue ? '🔴 Pendente (Atrasada)' : '🔴 Pendente')}
                        {item.status === 'nao_realizada' && '🟠 Não realizada'}
                        {item.status === 'planejada' && '⚪ Planejada'}
                      </span>
                    </div>

                    <h4 className="text-sm font-bold text-white">
                      {item.lojaNome}
                    </h4>

                    <p className="text-[11px] text-slate-400">
                      Cidade/UF: {item.lojaCidade || '—'}/{item.lojaUf || '-'}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
                      <span>Indústria: <strong className="text-purple-300">{item.industriaNome}</strong></span>
                      <span>Frequência: <strong className="text-cyan-300">{item.frequencia}</strong></span>
                      {item.completedAt && (
                        <span>Concluído às: <strong className="text-emerald-300">{new Date(item.completedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong></span>
                      )}
                    </div>
                  </div>

                  {/* Ações */}
                  <div className="flex items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-[#1e2433]">
                    {item.status === 'pendente' && isTodayItem && !activeVisit && (
                      <>
                        <button
                          onClick={() => handleStartVisit(routeObj)}
                          className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md"
                        >
                          <span className="material-symbols-outlined text-sm">play_arrow</span>
                          <span>Iniciar Visita</span>
                        </button>
                        <button
                          onClick={() => setShowNotDoneModal(routeObj)}
                          className="px-3 py-2 rounded-xl bg-[#171b26] hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-[#1e2433] text-xs font-bold cursor-pointer"
                          title="Justificar Não Realização"
                        >
                          Não Atendido
                        </button>
                      </>
                    )}

                    {item.status === 'pendente' && !isTodayItem && item.isPastOverdue && !activeVisit && (
                      <button
                        onClick={() => handleStartVisit(routeObj)}
                        className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md"
                      >
                        <span className="material-symbols-outlined text-sm">play_arrow</span>
                        <span>Regularizar Pendência</span>
                      </button>
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
                      <span className="text-xs text-rose-400 font-bold flex items-center gap-1 px-3 py-2 bg-rose-500/10 rounded-xl border border-rose-500/30">
                        <span className="material-symbols-outlined text-sm">cancel</span>
                        Não Realizada
                      </span>
                    )}

                    {item.status === 'planejada' && (
                      <span className="text-xs text-slate-400 font-bold flex items-center gap-1 px-3 py-2 bg-slate-800/40 rounded-xl border border-slate-700/50">
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
