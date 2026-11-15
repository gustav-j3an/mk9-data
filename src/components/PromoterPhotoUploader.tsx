import React, { useRef, useState } from 'react';
import type { VisitPhoto } from '../types';
import {
  filterValidPhotoFiles,
  createPhotoSelectionItems,
  removePhotoSelectionItem,
  clearPhotoSelectionItems,
  type PhotoSelectionItem
} from '../utils/promoterPhotos';

interface PromoterPhotoUploaderProps {
  existingPhotos: VisitPhoto[];
  onUploadPhotos: (items: PhotoSelectionItem[]) => Promise<void>;
  disabled?: boolean;
  onShowToast: (toast: { title: string; message: string; type: 'success' | 'warning' | 'error' | 'info' }) => void;
}

export const PromoterPhotoUploader: React.FC<PromoterPhotoUploaderProps> = ({
  existingPhotos,
  onUploadPhotos,
  disabled = false,
  onShowToast
}) => {
  const [pendingItems, setPendingItems] = useState<PhotoSelectionItem[]>([]);
  const [selectedType, setSelectedType] = useState<PhotoSelectionItem['tipo_foto']>('gondola');
  const [defaultCaption, setDefaultCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgressMsg, setUploadProgressMsg] = useState('');

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const handleFilesChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const { validFiles, rejectedFiles } = filterValidPhotoFiles(files, pendingItems, 20);

    if (rejectedFiles.length > 0) {
      const summaryMsg = rejectedFiles.map((r) => `${r.file.name}: ${r.reason}`).join(' | ');
      onShowToast({
        title: 'Fotos Não Adicionadas',
        message: summaryMsg,
        type: 'warning'
      });
    }

    if (validFiles.length > 0) {
      const newItems = createPhotoSelectionItems(validFiles, selectedType);
      if (defaultCaption) {
        newItems.forEach((item) => {
          item.legenda = defaultCaption;
        });
      }
      setPendingItems((prev) => [...prev, ...newItems]);
      onShowToast({
        title: 'Fotos Selecionadas',
        message: `${validFiles.length} foto(s) pronta(s) para conferência e envio.`,
        type: 'info'
      });
    }

    e.target.value = '';
  };

  const handleRemovePending = (id: string) => {
    setPendingItems((prev) => removePhotoSelectionItem(prev, id));
  };

  const handleClearAll = () => {
    clearPhotoSelectionItems(pendingItems);
    setPendingItems([]);
  };

  const handleUpdateItemType = (id: string, type: PhotoSelectionItem['tipo_foto']) => {
    setPendingItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, tipo_foto: type } : item))
    );
  };

  const handleUpdateItemCaption = (id: string, caption: string) => {
    setPendingItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, legenda: caption } : item))
    );
  };

  const handleSendBatch = async () => {
    if (pendingItems.length === 0 || uploading || disabled) return;

    setUploading(true);
    setUploadProgressMsg(`Enviando lote de ${pendingItems.length} foto(s)...`);

    try {
      await onUploadPhotos(pendingItems);
      clearPhotoSelectionItems(pendingItems);
      setPendingItems([]);
      setDefaultCaption('');
      onShowToast({
        title: 'Lote Concluído',
        message: 'Todas as fotos selecionadas foram enviadas com sucesso!',
        type: 'success'
      });
    } catch (err: any) {
      console.error('Falha no upload do lote:', err);
      onShowToast({
        title: 'Erro no Upload',
        message: err.message || 'Falha ao processar fotos do lote.',
        type: 'error'
      });
    } finally {
      setUploading(false);
      setUploadProgressMsg('');
    }
  };

  return (
    <div className="space-y-4 font-mono text-xs">
      {/* Controles de Entrada */}
      <div className="p-4 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[#5F5F5F] font-bold block mb-1">CATEGORIA PADRÃO DA EVIDÊNCIA</label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value as any)}
              disabled={disabled || uploading}
              className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] font-semibold"
            >
              <option value="fachada">FACHADA DA LOJA</option>
              <option value="gondola">GÔNDOLA / PONTO NATURAL</option>
              <option value="ponto_extra">PONTO EXTRA / ILHA</option>
              <option value="preco">ETIQUETA DE PREÇO</option>
              <option value="ruptura">RUPTURA DE PRODUTO</option>
              <option value="outros">OUTROS / DIVERSOS</option>
            </select>
          </div>

          <div>
            <label className="text-[#5F5F5F] font-bold block mb-1">LEGENDA OU OBSERVAÇÃO (OPCIONAL)</label>
            <input
              type="text"
              value={defaultCaption}
              onChange={(e) => setDefaultCaption(e.target.value)}
              disabled={disabled || uploading}
              placeholder="Ex: Antes da reposição, gôndola limpa..."
              className="w-full h-10 px-3 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[#171717] placeholder:text-[#888680]"
            />
          </div>
        </div>

        {/* Inputs Ocultos */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFilesChosen}
          disabled={disabled || uploading}
          className="hidden"
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFilesChosen}
          disabled={disabled || uploading}
          className="hidden"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            disabled={disabled || uploading}
            className="min-h-11 px-4 py-2.5 rounded-xl bg-cyan-700 hover:bg-cyan-800 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-base">photo_camera</span>
            <span>Tirar foto agora</span>
          </button>
          <button
            type="button"
            onClick={() => galleryInputRef.current?.click()}
            disabled={disabled || uploading}
            className="min-h-11 px-4 py-2.5 rounded-xl bg-[#EAE8E2] hover:bg-[#E0DED7] text-[#171717] font-bold text-xs flex items-center justify-center gap-2 border border-[#CFCDC5] transition-all cursor-pointer disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-base">photo_library</span>
            <span>Selecionar da galeria (várias)</span>
          </button>
        </div>
      </div>

      {/* Fila de Fotos Selecionadas para Envio */}
      {pendingItems.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-amber-800 text-sm">queue</span>
              Fotos aguardando envio ({pendingItems.length}):
            </span>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={uploading}
              className="text-[11px] text-rose-800 hover:underline font-semibold"
            >
              Limpar fila
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
            {pendingItems.map((item) => (
              <div
                key={item.id}
                className="p-2.5 rounded-xl bg-white border border-amber-200 shadow-2xs flex gap-2.5 items-center justify-between"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <img
                    src={item.previewUrl}
                    alt="Preview"
                    className="w-14 h-14 rounded-lg object-cover border border-[#CFCDC5] shrink-0"
                  />
                  <div className="min-w-0 space-y-1">
                    <select
                      value={item.tipo_foto}
                      onChange={(e) => handleUpdateItemType(item.id, e.target.value as any)}
                      disabled={uploading}
                      className="text-[11px] h-7 px-1.5 bg-[#F7F6F2] border border-[#CFCDC5] rounded-md text-[#171717] font-semibold"
                    >
                      <option value="fachada">Fachada</option>
                      <option value="gondola">Gôndola</option>
                      <option value="ponto_extra">Ponto Extra</option>
                      <option value="preco">Preço</option>
                      <option value="ruptura">Ruptura</option>
                      <option value="outros">Outros</option>
                    </select>
                    <input
                      type="text"
                      value={item.legenda || ''}
                      onChange={(e) => handleUpdateItemCaption(item.id, e.target.value)}
                      disabled={uploading}
                      placeholder="Legenda..."
                      className="text-[10px] w-full h-6 px-1.5 bg-[#F7F6F2] border border-[#CFCDC5] rounded text-[#171717]"
                    />
                    <span className="text-[9px] text-[#77766F] block">
                      {(item.sizeBytes / 1024).toFixed(0)} KB
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleRemovePending(item.id)}
                  disabled={uploading}
                  className="p-1 text-rose-700 hover:bg-rose-50 rounded-lg shrink-0 cursor-pointer"
                  title="Remover foto da fila"
                >
                  <span className="material-symbols-outlined text-base">delete</span>
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={handleSendBatch}
            disabled={uploading || disabled}
            className="w-full min-h-11 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-base ${uploading ? 'animate-spin' : ''}`}>
              {uploading ? 'sync' : 'cloud_upload'}
            </span>
            <span>{uploading ? (uploadProgressMsg || 'Enviando...') : `Confirmar e Enviar (${pendingItems.length}) Fotos`}</span>
          </button>
        </div>
      )}

      {/* Lista de Fotos Já Salvas no Banco */}
      <div className="space-y-2 pt-2 border-t border-[#CFCDC5]">
        <span className="text-[11px] text-[#5F5F5F] font-bold block">
          FOTOS REGISTRADAS NESTA VISITA ({existingPhotos.length}):
        </span>
        {existingPhotos.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {existingPhotos.map((p, idx) => (
              <div
                key={p.id || idx}
                className="p-2 rounded-xl bg-[#F7F6F2] border border-[#CFCDC5] space-y-1.5 flex flex-col justify-between"
              >
                <div className="relative aspect-video rounded-lg bg-[#EAE8E2] overflow-hidden border border-[#CFCDC5] flex items-center justify-center">
                  {p.signed_url || p.file_url ? (
                    <img
                      src={p.signed_url || p.file_url}
                      alt={p.legenda || p.tipo_foto}
                      className="w-full h-full object-cover"
                      onError={(err) => {
                        (err.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <span className="material-symbols-outlined text-[#77766F] text-2xl">image</span>
                  )}
                  <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-xs text-cyan-200 text-[9px] font-bold uppercase border border-cyan-400/40">
                    {p.tipo_foto}
                  </span>
                </div>
                {p.legenda && (
                  <p className="text-[10px] text-[#171717] font-semibold truncate" title={p.legenda}>
                    {p.legenda}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-[#77766F] italic pt-1 text-center">
            Nenhuma foto registrada para esta visita ainda.
          </p>
        )}
      </div>
    </div>
  );
};
