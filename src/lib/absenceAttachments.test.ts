import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { absenceAttachmentMaxBytes, newAbsenceAttachmentPath, prepareAbsenceAttachment, validateAbsenceAttachment } from './absenceAttachments';

const file = (name: string, type: string, bytes: number[]) => new File([new Uint8Array(bytes)], name, { type });

test('accepts synthetic PDF, JPEG, and PNG signatures and rejects mismatched or invalid content', async () => {
  for (const candidate of [file('note.pdf', 'application/pdf', [...Buffer.from('%PDF-1.7 fake %%EOF')]), file('photo.jpg', 'image/jpeg', [0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]), file('photo.jpeg', 'image/jpeg', [0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]), file('photo.png', 'image/png', [137,80,78,71,13,10,26,10,...new Array(8).fill(0),73,69,78,68,0,0,0,0])]) {
    assert.equal(validateAbsenceAttachment(candidate), null);
    if (candidate.type === 'application/pdf') assert.equal((await prepareAbsenceAttachment(candidate)).previewUrl, null);
  }
  assert.ok(validateAbsenceAttachment(file('bad.svg', 'image/svg+xml', [60,115,118,103]))?.includes('PDF, JPG'));
  await assert.rejects(prepareAbsenceAttachment(file('fake.pdf', 'application/pdf', [60,104,116,109,108])), /conteúdo do arquivo/);
});

test('compresses oversized images in-browser without changing their aspect ratio', async () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let dimensions = [0, 0];
  const testGlobals = globalThis as unknown as { createImageBitmap?: typeof createImageBitmap; document?: Document };
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => ({ width: 4000, height: 3000, close() {} }) });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({
    set width(value: number) { dimensions[0] = value; },
    set height(value: number) { dimensions[1] = value; },
    getContext: () => ({ fillRect() {}, drawImage() {} }),
    toBlob: (done: (blob: Blob) => void) => done(new Blob([new Uint8Array([0xff,0xd8,0xff])], { type: 'image/jpeg' }))
  }) } });
  try {
    const largeJpeg = new File([new Uint8Array([0xff,0xd8,0xff]), new Uint8Array(2 * 1024 * 1024 + 1), new Uint8Array([0xff,0xd9])], 'photo.jpg', { type: 'image/jpeg' });
    const prepared = await prepareAbsenceAttachment(largeJpeg);
    assert.deepEqual(dimensions, [2560, 1920]);
    assert.equal(prepared.file.type, 'image/jpeg');
    assert.equal(prepared.file.name, 'photo.jpg');
    assert.ok(prepared.previewUrl);
    URL.revokeObjectURL(prepared.previewUrl!);
  } finally {
    if (originalCreateImageBitmap) testGlobals.createImageBitmap = originalCreateImageBitmap;
    else delete testGlobals.createImageBitmap;
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete testGlobals.document;
  }
});

test('rejects empty or oversized files and generates opaque record-scoped paths', () => {
  assert.ok(validateAbsenceAttachment(file('empty.pdf', 'application/pdf', []))?.includes('até 10 MiB'));
  assert.ok(validateAbsenceAttachment(new File([new Uint8Array(absenceAttachmentMaxBytes + 1)], 'large.pdf', { type: 'application/pdf' }))?.includes('até 10 MiB'));
  const path = newAbsenceAttachmentPath('00000000-0000-4000-8000-000000000001', file('patient name.pdf', 'application/pdf', [37,80,68,70,45]));
  assert.match(path, /^00000000-0000-4000-8000-000000000001\/[0-9a-f-]{36}\.pdf$/);
  assert.doesNotMatch(path, /patient name/);
});

test('prepares private Storage policies and authorized metadata RPCs without applying them', async () => {
  const migration = await readFile(resolve('supabase/migrations/20261021120000_mk9_absence_attachments.sql'), 'utf8');
  assert.match(migration, /absence-documents', 'absence-documents', false/);
  assert.match(migration, /file_size_limit=10485760/);
  assert.match(migration, /mk9_rh_private\.can_read_absence_attachment/);
  assert.match(migration, /mk9_rh_private\.can_manage_absence_attachment/);
  assert.match(migration, /mk9_faltas_atestados_register_attachment/);
  assert.match(migration, /mk9_faltas_atestados_delete_attachment/);
  assert.match(migration, /AS RESTRICTIVE FOR SELECT TO PUBLIC/);
});
