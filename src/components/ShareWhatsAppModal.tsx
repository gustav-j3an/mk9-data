import React, { useState, useEffect } from 'react';
import {
  X,
  Share2,
  Copy,
  Download,
  ExternalLink,
  Check,
  AlertCircle,
  FileText,
  Image as ImageIcon,
  Building2,
  Store,
  Calendar,
  Clock,
  Loader2,
} from 'lucide-react';
import {
  type VisitShareData,
  formatVisitReportText,
  isValidWhatsAppGroupLink,
  preparePhotoFiles,
  shareVisitReport,
  openIndustryWhatsAppGroup,
} from '../utils/whatsappShare';

interface ShareWhatsAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: VisitShareData;
}

export const ShareWhatsAppModal: React.FC<ShareWhatsAppModalProps> = ({
  isOpen,
  onClose,
  data,
}) => {
  const [copied, setCopied] = useState(false);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [statusMessage, setStatusMessage] = useState<{ type: 'info' | 'success' | 'warn'; text: string } | null>(null);
  const [isSharing, setIsSharing] = useState(false);

  // Carrega as imagens autorizadas de forma segura como arquivos
  useEffect(() => {
    let isMounted = true;
    if (isOpen && data.fotos && data.fotos.length > 0) {
      setLoadingPhotos(true);
      preparePhotoFiles(data.fotos)
        .then((files) => {
          if (isMounted) {
            setPhotoFiles(files);
            setLoadingPhotos(false);
          }
        })
        .catch((err) => {
          if (isMounted) {
            console.error('Erro ao carregar fotos:', err);
            setLoadingPhotos(false);
          }
        });
    } else {
      setPhotoFiles([]);
      setLoadingPhotos(false);
    }
    return () => {
      isMounted = false;
    };
  }, [isOpen, data.fotos]);

  if (!isOpen) return null;

  const hasGroupLink = isValidWhatsAppGroupLink(data.whatsappGroupLink);
  const reportText = formatVisitReportText(data);

  const handleCopyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      setCopied(true);
      setStatusMessage({ type: 'success', text: 'Relatório copiado para a área de transferência!' });
      setTimeout(() => setCopied(false), 3000);
    } catch (err) {
      setStatusMessage({ type: 'warn', text: 'Não foi possível copiar automaticamente. Selecione e copie o texto.' });
    }
  };

  const handleShare = async () => {
    setIsSharing(true);
    setStatusMessage(null);
    try {
      const result = await shareVisitReport(data, { photoFiles });
      if (result.action === 'canceled') {
        setStatusMessage({ type: 'info', text: 'Compartilhamento cancelado.' });
      } else if (result.success) {
        setStatusMessage({
          type: 'success',
          text: result.action === 'whatsapp_link'
            ? 'WhatsApp aberto. Cole o relatório na conversa do grupo.'
            : 'Janela de compartilhamento aberta com sucesso.',
        });
      } else {
        setStatusMessage({ type: 'warn', text: result.message || 'Falha ao compartilhar.' });
      }
    } catch (err) {
      setStatusMessage({ type: 'warn', text: 'Erro ao tentar compartilhar.' });
    } finally {
      setIsSharing(false);
    }
  };

  const handleOpenGroup = () => {
    if (hasGroupLink) {
      const ok = openIndustryWhatsAppGroup(data.whatsappGroupLink);
      if (ok) {
        setStatusMessage({
          type: 'info',
          text: 'Grupo aberto no WhatsApp. Use o botão "Copiar Relatório" para colar os dados no grupo.',
        });
      }
    }
  };

  const handleDownloadPhotos = () => {
    if (!data.fotos || data.fotos.length === 0) return;
    data.fotos.forEach((foto, idx) => {
      if (!foto.url) return;
      const link = document.createElement('a');
      link.href = foto.url;
      link.download = `foto_visita_${idx + 1}.jpg`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
    setStatusMessage({ type: 'success', text: 'Download das fotos iniciado.' });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white tracking-wide">Compartilhar Relatório no WhatsApp</h3>
              <p className="text-xs text-slate-400">Envio seguro para o grupo da indústria</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-sm">
          {/* Card de Informações da Visita */}
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center gap-2 text-slate-300">
                <Building2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="truncate">
                  <strong className="text-slate-400">Indústria:</strong> {data.industriaNome || 'Não informada'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-slate-300">
                <Store className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="truncate">
                  <strong className="text-slate-400">Loja:</strong> {data.lojaNome || 'Não informada'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-slate-300">
                <Calendar className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  <strong className="text-slate-400">Data:</strong>{' '}
                  {data.dataVisita ? data.dataVisita.split('-').reverse().join('/') : 'Hoje'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-slate-300">
                <Clock className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  <strong className="text-slate-400">Horário:</strong>{' '}
                  {data.horaInicio ? data.horaInicio.slice(0, 5) : '--:--'} às{' '}
                  {data.horaFim ? data.horaFim.slice(0, 5) : '--:--'}
                </span>
              </div>
            </div>

            {data.resumoAtendimento && (
              <div className="pt-2 border-t border-slate-700/40">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">
                  Resumo do Atendimento
                </p>
                <p className="text-slate-300 text-xs bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                  {data.resumoAtendimento}
                </p>
              </div>
            )}
          </div>

          {/* Fotos Disponíveis */}
          {data.fotos && data.fotos.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 uppercase tracking-wider">
                  <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
                  Fotos da Visita ({data.fotos.length})
                </span>
                <button
                  type="button"
                  onClick={handleDownloadPhotos}
                  className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  Baixar Fotos
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {data.fotos.map((f, i) => (
                  <div
                    key={f.id || i}
                    className="relative aspect-square rounded-lg overflow-hidden border border-slate-700 bg-slate-950 group"
                  >
                    <img
                      src={f.url}
                      alt={f.descricao || `Foto ${i + 1}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <span className="absolute bottom-1 right-1 bg-black/70 px-1 py-0.5 rounded text-[10px] text-slate-300">
                      #{i + 1}
                    </span>
                  </div>
                ))}
              </div>
              {loadingPhotos && (
                <p className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-1.5">
                  <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
                  Carregando fotos para anexo nativo...
                </p>
              )}
            </div>
          )}

          {/* Status do Grupo da Indústria */}
          <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-slate-300">Grupo de WhatsApp da Indústria</p>
              <p className="text-[11px] text-slate-400">
                {hasGroupLink
                  ? 'Link do grupo cadastrado e verificado.'
                  : 'Nenhum link de grupo oficial configurado para esta indústria.'}
              </p>
            </div>
            {hasGroupLink ? (
              <button
                type="button"
                onClick={handleOpenGroup}
                className="px-3 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30 text-xs font-medium flex items-center gap-1.5 transition shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Abrir Grupo
              </button>
            ) : (
              <span className="text-[11px] text-slate-400 italic">Não disponível</span>
            )}
          </div>

          {/* Mensagem de Feedback */}
          {statusMessage && (
            <div
              className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                  : statusMessage.type === 'warn'
                  ? 'bg-amber-500/15 border border-amber-500/30 text-amber-300'
                  : 'bg-blue-500/15 border border-blue-500/30 text-blue-300'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <Check className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {/* Aviso Legal de Envio */}
          <p className="text-[11px] text-slate-400 leading-relaxed bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
            ℹ️ O compartilhamento utiliza recursos nativos do seu dispositivo ou abre o WhatsApp Web. A conclusão da
            visita no sistema já está gravada e não depende do envio no WhatsApp.
          </p>
        </div>

        {/* Footer com Ações */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/90 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleCopyReport}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-2 transition"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copiado!' : 'Copiar Relatório'}
          </button>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-transparent hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs font-medium transition"
            >
              Fechar
            </button>
            <button
              type="button"
              onClick={handleShare}
              disabled={isSharing}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-xs flex items-center gap-2 shadow-lg shadow-emerald-900/30 transition"
            >
              {isSharing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Share2 className="w-4 h-4" />
              )}
              Compartilhar no WhatsApp
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
