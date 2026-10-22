import { maxAbsenceAttachmentBytes, validateAbsenceAttachmentBytes } from '../../shared/absenceAttachmentValidation';

export const absenceAttachmentBucket = 'absence-documents';
export const absenceAttachmentMaxBytes = maxAbsenceAttachmentBytes;
export const acceptedAbsenceAttachmentTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);

export interface PreparedAbsenceAttachment {
  file: File;
  previewUrl: string | null;
}

export function validateAbsenceAttachment(file: File): string | null {
  const extension = file.name.split('.').pop()?.toLocaleLowerCase('en-US');
  if (!acceptedAbsenceAttachmentTypes.has(file.type) || !['pdf', 'jpg', 'jpeg', 'png'].includes(extension || '')) {
    return 'Selecione um PDF, JPG, JPEG ou PNG válido.';
  }
  if (file.size <= 0 || file.size > absenceAttachmentMaxBytes) return 'Cada arquivo deve ter até 10 MiB.';
  return null;
}

async function hasValidSignature(file: File): Promise<boolean> {
  return validateAbsenceAttachmentBytes(new Uint8Array(await file.arrayBuffer()), file.type);
}

export async function prepareAbsenceAttachment(file: File): Promise<PreparedAbsenceAttachment> {
  const issue = validateAbsenceAttachment(file);
  if (issue) throw new Error(issue);
  if (!(await hasValidSignature(file))) throw new Error('O conteúdo do arquivo não corresponde ao formato informado.');
  if (file.type === 'application/pdf') return { file, previewUrl: null };
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error('A imagem excede a resolução segura para processamento.');
    if (file.size <= 2 * 1024 * 1024 && Math.max(bitmap.width, bitmap.height) <= 2560) return { file, previewUrl: URL.createObjectURL(file) };
    const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível processar a imagem neste navegador.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Não foi possível comprimir a imagem.')), 'image/jpeg', 0.9));
    const compressed = new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
    if (compressed.size > absenceAttachmentMaxBytes) throw new Error('A imagem continua acima de 10 MiB após a compressão.');
    return { file: compressed, previewUrl: URL.createObjectURL(compressed) };
  } finally {
    bitmap.close();
  }
}

export function newAbsenceAttachmentPath(recordId: string, file: File): string {
  return `${recordId}/${crypto.randomUUID()}.${file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg'}`;
}
