import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterValidPhotoFiles,
  createPhotoSelectionItems,
  removePhotoSelectionItem,
  clearPhotoSelectionItems,
  type PhotoSelectionItem
} from './promoterPhotos';

const makeFakeFile = (name: string, size: number, type: string, lastModified: number = 1000): File => {
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type, lastModified });
};

test('promoterPhotos: filterValidPhotoFiles filters SVG and oversized files', () => {
  const valid1 = makeFakeFile('foto1.jpg', 1024 * 500, 'image/jpeg');
  const valid2 = makeFakeFile('foto2.png', 1024 * 800, 'image/png');
  const svg = makeFakeFile('malicious.svg', 1024 * 10, 'image/svg+xml');
  const heavy = makeFakeFile('heavy.jpg', 6 * 1024 * 1024, 'image/jpeg');

  const result = filterValidPhotoFiles([valid1, valid2, svg, heavy]);

  assert.equal(result.validFiles.length, 2);
  assert.equal(result.validFiles[0].name, 'foto1.jpg');
  assert.equal(result.validFiles[1].name, 'foto2.png');
  assert.equal(result.rejectedFiles.length, 2);
  assert.match(result.rejectedFiles[0].reason, /SVG não permitido/);
  assert.match(result.rejectedFiles[1].reason, /excede o limite/);
});

test('promoterPhotos: filterValidPhotoFiles prevents duplicates and preserves existing items', () => {
  const file1 = makeFakeFile('foto1.jpg', 100, 'image/jpeg', 1000);
  const existing: PhotoSelectionItem[] = [
    {
      id: 'item-1',
      file: file1,
      previewUrl: 'blob:fake-url-1',
      tipo_foto: 'gondola',
      sizeBytes: 100,
      status: 'pending'
    }
  ];

  const incomingDuplicate = makeFakeFile('foto1.jpg', 100, 'image/jpeg', 1000);
  const incomingNew = makeFakeFile('foto2.jpg', 200, 'image/jpeg', 2000);

  const result = filterValidPhotoFiles([incomingDuplicate, incomingNew], existing);

  assert.equal(result.validFiles.length, 1);
  assert.equal(result.validFiles[0].name, 'foto2.jpg');
  assert.equal(result.rejectedFiles.length, 1);
  assert.match(result.rejectedFiles[0].reason, /duplicado/);
});

test('promoterPhotos: respects batch limit', () => {
  const existing: PhotoSelectionItem[] = Array.from({ length: 19 }, (_, i) => ({
    id: `item-${i}`,
    file: makeFakeFile(`exist-${i}.jpg`, 100, 'image/jpeg', 1000 + i),
    previewUrl: `blob:fake-${i}`,
    tipo_foto: 'gondola',
    sizeBytes: 100,
    status: 'pending'
  }));

  const files = [
    makeFakeFile('new1.jpg', 100, 'image/jpeg', 2001),
    makeFakeFile('new2.jpg', 100, 'image/jpeg', 2002)
  ];

  const result = filterValidPhotoFiles(files, existing, 20);
  assert.equal(result.validFiles.length, 1);
  assert.equal(result.rejectedFiles.length, 1);
  assert.match(result.rejectedFiles[0].reason, /Limite máximo/);
});

test('promoterPhotos: creates, removes and clears selection items without crashing', () => {
  // Mock global URL
  const originalCreate = globalThis.URL.createObjectURL;
  const originalRevoke = globalThis.URL.revokeObjectURL;
  let revokedCount = 0;
  globalThis.URL.createObjectURL = () => 'blob:mock-url';
  globalThis.URL.revokeObjectURL = () => { revokedCount++; };

  try {
    const file1 = makeFakeFile('test1.jpg', 100, 'image/jpeg');
    const file2 = makeFakeFile('test2.jpg', 200, 'image/jpeg');
    const items = createPhotoSelectionItems([file1, file2], 'fachada');

    assert.equal(items.length, 2);
    assert.equal(items[0].tipo_foto, 'fachada');
    assert.equal(items[0].status, 'pending');

    const remaining = removePhotoSelectionItem(items, items[0].id);
    assert.equal(remaining.length, 1);
    assert.equal(revokedCount, 1);

    clearPhotoSelectionItems(remaining);
    assert.equal(revokedCount, 2);
  } finally {
    globalThis.URL.createObjectURL = originalCreate;
    globalThis.URL.revokeObjectURL = originalRevoke;
  }
});
