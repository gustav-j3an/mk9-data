export const absenceAttachmentMimeTypes = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type AbsenceAttachmentMimeType = typeof absenceAttachmentMimeTypes[number];
export const maxAbsenceAttachmentBytes = 10 * 1024 * 1024;

export function detectAbsenceAttachmentType(bytes: Uint8Array): AbsenceAttachmentMimeType | null {
  if (bytes.length >= 10 && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-' &&
    new TextDecoder().decode(bytes.slice(-16)).trimEnd().endsWith('%%EOF')) return 'application/pdf';
  if (bytes.length >= 20 && [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value) &&
    new TextDecoder().decode(bytes.slice(-8, -4)) === 'IEND') return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) return 'image/jpeg';
  return null;
}

export function validateAbsenceAttachmentBytes(bytes: Uint8Array, declaredMimeType: string): declaredMimeType is AbsenceAttachmentMimeType {
  return detectAbsenceAttachmentType(bytes) === declaredMimeType;
}
