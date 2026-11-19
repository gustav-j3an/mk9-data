import { isSupportedVisitPhoto, isWithinVisitPhotoLimit } from './visitExecution';

export interface PhotoSelectionItem {
  id: string;
  file: File;
  previewUrl: string;
  tipo_foto: 'fachada' | 'gondola' | 'preco' | 'ponto_extra' | 'ruptura' | 'outros';
  legenda?: string;
  sizeBytes: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  errorMessage?: string;
}

export interface PhotoValidationResult {
  validFiles: File[];
  rejectedFiles: Array<{ file: File; reason: string }>;
}

export const filterValidPhotoFiles = (
  incomingFiles: FileList | File[],
  existingPendingFiles: PhotoSelectionItem[] = [],
  maxBatchCount: number = 20
): PhotoValidationResult => {
  const fileArray = Array.from(incomingFiles);
  const validFiles: File[] = [];
  const rejectedFiles: Array<{ file: File; reason: string }> = [];

  const existingFileSignatures = new Set(
    existingPendingFiles.map((p) => `${p.file.name}_${p.file.size}_${p.file.lastModified}`)
  );

  for (const file of fileArray) {
    if (!isSupportedVisitPhoto(file.type)) {
      rejectedFiles.push({ file, reason: 'Formato não suportado (apenas imagens; SVG não permitido)' });
      continue;
    }

    if (!isWithinVisitPhotoLimit(file.size)) {
      rejectedFiles.push({ file, reason: 'Arquivo excede o limite individual de 5MB' });
      continue;
    }

    const signature = `${file.name}_${file.size}_${file.lastModified}`;
    if (existingFileSignatures.has(signature)) {
      rejectedFiles.push({ file, reason: 'Arquivo duplicado já selecionado nesta lista' });
      continue;
    }

    if (existingPendingFiles.length + validFiles.length >= maxBatchCount) {
      rejectedFiles.push({ file, reason: `Limite máximo de ${maxBatchCount} fotos por lote atingido` });
      continue;
    }

    existingFileSignatures.add(signature);
    validFiles.push(file);
  }

  return { validFiles, rejectedFiles };
};

export const createPhotoSelectionItems = (
  files: File[],
  defaultTipoFoto: PhotoSelectionItem['tipo_foto'] = 'gondola'
): PhotoSelectionItem[] => {
  return files.map((file) => ({
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`,
    file,
    previewUrl: URL.createObjectURL(file),
    tipo_foto: defaultTipoFoto,
    legenda: '',
    sizeBytes: file.size,
    status: 'pending'
  }));
};

export const removePhotoSelectionItem = (
  items: PhotoSelectionItem[],
  idToRemove: string
): PhotoSelectionItem[] => {
  const item = items.find((i) => i.id === idToRemove);
  if (item?.previewUrl && item.previewUrl.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(item.previewUrl);
    } catch {
      // Ignorar erro de revoke no unmount
    }
  }
  return items.filter((i) => i.id !== idToRemove);
};

export const clearPhotoSelectionItems = (items: PhotoSelectionItem[]): void => {
  for (const item of items) {
    if (item.previewUrl && item.previewUrl.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(item.previewUrl);
      } catch {
        // Ignorar
      }
    }
  }
};
