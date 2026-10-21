import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { Visit, ToastMessage, IndustryItem } from '../types';
import { supabase } from '../lib/supabase';
import {
  buildWhatsAppReportText,
  buildWhatsAppWebUrl,
  isValidWhatsAppGroupLink,
  shareViaWebShare,
  triggerFileDownload
} from '../utils/whatsappShare';

export interface ShareWhatsAppModalProps {
  visit: Visit;
  industry?: IndustryItem | null;
  onClose: () => void;
  onShowToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export const ShareWhatsAppModal: React.FC<ShareWhatsAppModalProps> = ({
  visit,
  industry,
  onClose,
  onShowToast
}) => {
  // Texto do relatório pré-gerado (imutável — base para restauração)
  const reportText = useMemo(() => buildWhatsAppReportText(visit), [visit]);

  // Texto editável da mensagem (o promotor pode personalizar antes de enviar)
  const [editedText, setEditedText] = useState(() => buildWhatsAppReportText(visit));
  const isTextModified = editedText !== reportText;

  // Restaurar texto para o original gerado automaticamente
  const handleRestoreText = () => setEditedText(reportText);

  // Estados de cópia e links
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);

  // Estados de preparação de arquivos de imagem locais
  const [preparedFiles, setPreparedFiles] = useState<File[]>([]);
  const [preparingPhotos, setPreparingPhotos] = useState(false);
  const [photoErrors, setPhotoErrors] = useState<Record<string, string>>({});
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  // Link do grupo da indústria (validação segura e resolução resiliente)
  const [dynamicGroupLink, setDynamicGroupLink] = useState<string | null>(industry?.whatsapp_group_link || null);

  useEffect(() => {
    let isCancelled = false;
    // Se o link já veio no prop, usá-lo
    if (industry?.whatsapp_group_link !== undefined) {
      setDynamicGroupLink(industry.whatsapp_group_link || null);
      return;
    }

    // Se veio código da indústria mas sem a coluna carregada, busca pontualmente
    const indCodigo = industry?.codigo || visit.industria_codigo || visit.industria?.codigo;
    if (indCodigo && supabase) {
      (async () => {
        try {
          const { data, error } = await supabase
            .from('industrias')
            .select('whatsapp_group_link')
            .eq('codigo', indCodigo)
            .maybeSingle();

          if (!isCancelled && !error && data) {
            setDynamicGroupLink(data.whatsapp_group_link || null);
          }
        } catch {
          // Falha silenciosa: coluna pode não existir ainda se migration não foi rodada
        }
      })();
    }

    return () => {
      isCancelled = true;
    };
  }, [industry, visit.industria_codigo, visit.industria?.codigo]);

  const groupLink = dynamicGroupLink;
  const isGroupValid = isValidWhatsAppGroupLink(groupLink);

  // Fotos da visita
  const photos = visit.photos || [];

  // 1. Efeito para pré-carregar as imagens em Files do navegador
  useEffect(() => {
    let isCancelled = false;

    async function preparePhotos() {
      if (!photos || photos.length === 0 || !supabase) {
        return;
      }

      setPreparingPhotos(true);
      const loadedFiles: File[] = [];
      const loadedUrls: Record<string, string> = {};
      const errors: Record<string, string> = {};

      for (let idx = 0; idx < photos.length; idx++) {
        if (isCancelled) break;
        const photo = photos[idx];
        const key = photo.id || photo.storage_path || `foto-${idx}`;

        try {
          let cleanPath = photo.storage_path ? photo.storage_path.trim() : '';
          if (cleanPath.startsWith('visit-photos/')) {
            cleanPath = cleanPath.replace(/^visit-photos\//, '');
          }
          cleanPath = cleanPath.replace(/^\/+/, '');

          if (!cleanPath) {
            throw new Error('Caminho da foto não informado');
          }

          // A. Obter Signed URL
          const { data: signData, error: signErr } = await supabase.storage
            .from('visit-photos')
            .createSignedUrl(cleanPath, 3600);

          if (signErr || !signData?.signedUrl) {
            throw signErr || new Error('Não foi possível gerar link assinado');
          }

          loadedUrls[key] = signData.signedUrl;

          // B. Baixar binário Blob e encapsular em File com nome descritivo
          const response = await fetch(signData.signedUrl);
          if (!response.ok) {
            throw new Error(`Falha no download da imagem (${response.status})`);
          }

          const blob = await response.blob();
          const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
          const fileName = `visita_${visit.loja_codigo}_${photo.tipo_foto}_${idx + 1}.${ext}`;
          const file = new File([blob], fileName, { type: blob.type });

          loadedFiles.push(file);
        } catch (err: any) {
          console.warn(`Erro ao preparar foto ${key}:`, err);
          errors[key] = err?.message || 'Erro ao carregar';
        }
      }

      if (!isCancelled) {
        setPreparedFiles(loadedFiles);
        setSignedUrls(loadedUrls);
        setPhotoErrors(errors);
        setPreparingPhotos(false);
      }
    }

    preparePhotos();

    return () => {
      isCancelled = true;
    };
  }, [visit, photos]);

  // 2. Copiar texto do relatório (usa o texto editado pelo promotor)
  const handleCopyReport = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(editedText);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = editedText;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      setCopied(true);
      onShowToast({
        title: 'Relatório Copiado! 📋',
        message: 'O texto formatado foi copiado para sua área de transferência.',
        type: 'success'
      });
      setTimeout(() => setCopied(false), 3000);
    } catch (err) {
      onShowToast({
        title: 'Não foi possível copiar',
        message: 'Por favor, selecione e copie o texto manualmente.',
        type: 'error'
      });
    }
  };

  // 3. Compartilhar via Web Share (usa o texto editado pelo promotor)
  const handleShareNative = async () => {
    setSharing(true);
    try {
      // Se tiver fotos preparadas, tenta compartilhar com arquivos
      const shareResult = await shareViaWebShare({
        title: `Relatório de Visita — ${visit.loja?.nome || visit.loja_codigo}`,
        text: editedText,
        files: preparedFiles.length > 0 ? preparedFiles : undefined
      });

      if (shareResult === 'shared') {
        onShowToast({
          title: 'Compartilhamento Concluído! 🚀',
          message: 'Relatório enviado com sucesso.',
          type: 'success'
        });
      } else if (shareResult === 'canceled') {
        onShowToast({
          title: 'Compartilhamento Cancelado',
          message: 'Você cancelou o envio.',
          type: 'info'
        });
      } else if (shareResult === 'unsupported' || shareResult === 'error') {
        // Fallback: abrir WhatsApp Web / App diretamente com o texto editado
        const url = buildWhatsAppWebUrl(editedText);
        window.open(url, '_blank', 'noopener,noreferrer');
        onShowToast({
          title: 'Abrindo WhatsApp 📲',
          message: 'Redirecionando para o aplicativo do WhatsApp.',
          type: 'info'
        });
      }
    } finally {
      setSharing(false);
    }
  };

  // 4. Abrir link wa.me direto (fallback explícito, usa o texto editado)
  const handleOpenWhatsAppWeb = () => {
    const url = buildWhatsAppWebUrl(editedText);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // 5. Baixar todas as fotos preparadas
  const handleDownloadAllPhotos = () => {
    if (preparedFiles.length === 0) {
      onShowToast({
        title: 'Nenhuma foto pronta',
        message: 'Aguarde o carregamento ou verifique se existem fotos anexadas.',
        type: 'warning'
      });
      return;
    }

    setDownloadingAll(true);
    try {
      preparedFiles.forEach((file) => {
        triggerFileDownload(file);
      });
      onShowToast({
        title: 'Download Iniciado 📥',
        message: `${preparedFiles.length} foto(s) enviada(s) para download.`,
        type: 'success'
      });
    } finally {
      setDownloadingAll(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 font-mono overflow-y-auto">
      <div className="bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl w-full max-w-lg shadow-2xl max-h-[92vh] flex flex-col overflow-hidden text-[#171717]">
        {/* Cabeçalho */}
        <div className="px-5 py-4 border-b border-[#CFCDC5] flex items-center justify-between bg-[#EAE8E2]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <span className="material-symbols-outlined text-[18px]">share</span>
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#171717] tracking-tight">
                Compartilhar Relatório
              </h3>
              <p className="text-[10px] text-[#77766F]">
                {visit.loja?.nome || visit.loja_codigo} • {visit.industria?.nome || visit.industria_codigo}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#77766F] hover:text-[#171717] p-1.5 rounded-lg hover:bg-[#DFDDD6] transition-colors cursor-pointer"
            aria-label="Fechar"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Corpo com Scroll */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto text-xs flex-1">
          {/* Link do Grupo da Indústria (se configurado) */}
          {groupLink && (
            <div className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
              isGroupValid ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'
            }`}>
              <div className="flex items-center gap-2 min-w-0">
                <span className={`material-symbols-outlined text-lg shrink-0 ${isGroupValid ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {isGroupValid ? 'group' : 'warning'}
                </span>
                <div className="min-w-0">
                  <span className="text-[10px] uppercase font-bold text-[#5F5F5F] block">
                    Grupo WhatsApp da Indústria
                  </span>
                  <span className="text-xs font-bold text-[#171717] truncate block">
                    {isGroupValid ? 'Grupo Oficial Cadastrado' : 'Link de Grupo Inválido'}
                  </span>
                </div>
              </div>

              {isGroupValid && (
                <a
                  href={groupLink.startsWith('http') ? groupLink : `https://${groupLink}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] shrink-0 flex items-center gap-1 transition-colors"
                >
                  <span>Abrir Grupo</span>
                  <span className="material-symbols-outlined text-xs">open_in_new</span>
                </a>
              )}
            </div>
          )}

          {/* Galeria de Fotos Anexadas */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-[#5F5F5F] uppercase flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm">photo_camera</span>
                Fotos Anexadas ({photos.length})
              </span>
              {photos.length > 0 && (
                <span className="text-[10px] text-[#77766F]">
                  {preparingPhotos ? 'Preparando arquivos...' : `${preparedFiles.length}/${photos.length} prontas`}
                </span>
              )}
            </div>

            {photos.length === 0 ? (
              <div className="p-3 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] text-center text-[#77766F] text-[11px]">
                Nenhuma foto registrada nesta visita.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {photos.map((photo, idx) => {
                  const key = photo.id || photo.storage_path || `foto-${idx}`;
                  const signedUrl = signedUrls[key];
                  const hasError = photoErrors[key];

                  return (
                    <div
                      key={key}
                      className="relative aspect-video rounded-lg bg-[#EAE8E2] border border-[#CFCDC5] overflow-hidden flex items-center justify-center group"
                    >
                      {signedUrl ? (
                        <img
                          src={signedUrl}
                          alt={photo.legenda || photo.tipo_foto}
                          className="w-full h-full object-cover"
                        />
                      ) : hasError ? (
                        <span className="material-symbols-outlined text-rose-500 text-base" title={hasError}>
                          broken_image
                        </span>
                      ) : (
                        <span className="material-symbols-outlined text-[#77766F] text-base animate-spin">
                          sync
                        </span>
                      )}
                      <span className="absolute bottom-1 left-1 px-1 py-0.5 rounded bg-black/70 text-white text-[8px] uppercase font-bold">
                        {photo.tipo_foto}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Mensagem Editável */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold text-[#5F5F5F] uppercase flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm">edit_note</span>
                Mensagem
                {isTextModified && (
                  <span className="text-[9px] font-semibold text-amber-600 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                    editada
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2">
                {isTextModified && (
                  <button
                    type="button"
                    onClick={handleRestoreText}
                    className="text-[11px] font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1 cursor-pointer"
                    title="Desfazer edições e restaurar o texto original"
                  >
                    <span className="material-symbols-outlined text-sm">restart_alt</span>
                    <span>Restaurar</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCopyReport}
                  className="text-[11px] font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">
                    {copied ? 'check' : 'content_copy'}
                  </span>
                  <span>{copied ? 'Copiado!' : 'Copiar'}</span>
                </button>
              </div>
            </div>
            <textarea
              id="whatsapp-report-message"
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              rows={8}
              className="w-full p-3 rounded-xl bg-[#EAE8E2] border border-[#CFCDC5] text-[#171717] text-[11px] font-mono leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
              aria-label="Mensagem do relatório — editável"
              spellCheck={false}
            />
            <p className="text-[10px] text-[#77766F] mt-1">
              ✏️ Edite livremente — adicione observações, emojis ou informações extras. O registro oficial não é alterado.
            </p>
          </div>
        </div>

        {/* Rodapé com Ações */}
        <div className="px-5 py-3.5 border-t border-[#CFCDC5] bg-[#EAE8E2] flex flex-col sm:flex-row items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {photos.length > 0 && (
              <button
                type="button"
                onClick={handleDownloadAllPhotos}
                disabled={downloadingAll || preparedFiles.length === 0}
                className="flex-1 sm:flex-none px-3 py-2 rounded-xl bg-[#F7F6F2] hover:bg-[#DFDDD6] disabled:opacity-50 text-[#171717] border border-[#CFCDC5] text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                title="Baixar fotos para envio manual"
              >
                <span className="material-symbols-outlined text-sm">download</span>
                <span>Baixar Fotos</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleOpenWhatsAppWeb}
              className="flex-1 sm:flex-none px-3 py-2 rounded-xl bg-[#F7F6F2] hover:bg-[#DFDDD6] text-[#171717] border border-[#CFCDC5] text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              title="Abrir no WhatsApp Web"
            >
              <span className="material-symbols-outlined text-sm">open_in_browser</span>
              <span>Abrir WhatsApp</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleShareNative}
            disabled={sharing}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md cursor-pointer transition-all"
          >
            <span className={`material-symbols-outlined text-base ${sharing ? 'animate-spin' : ''}`}>
              {sharing ? 'sync' : 'share'}
            </span>
            <span>{sharing ? 'Compartilhando...' : 'Compartilhar'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
