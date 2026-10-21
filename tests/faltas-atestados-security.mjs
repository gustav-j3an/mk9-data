import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const assetDir = 'dist/assets';
const assets = (await readdir(assetDir)).filter(file => /\.(js|css)$/.test(file));
assert.ok(assets.some(file => file.endsWith('.js')), 'production JavaScript bundle is missing');
const bundle = (await Promise.all(assets.map(file => readFile(join(assetDir, file), 'utf8')))).join('\n');
for (const forbidden of ['MK9_FALTAS_API_KEY', 'mk9-faltas-atestados-atualizado.vercel.app', '/api/integracoes/ausencias']) {
  assert.ok(!bundle.includes(forbidden), `bundle contains a server-only/external integration marker: ${forbidden}`);
}
const moduleSource = await readFile('src/views/FaltasAtestadosModule.tsx', 'utf8');
assert.doesNotMatch(moduleSource, /method\s*:\s*['"]POST['"]|\.insert\s*\(|\.upsert\s*\(/i);
assert.match(moduleSource, /externalWriteEnabled/);
const attachmentFunction = await readFile('supabase/functions/absence-attachments/index.ts', 'utf8');
const attachmentMigration = await readFile('supabase/migrations/20261021120000_mk9_absence_attachments.sql', 'utf8');
const attachmentService = await readFile('src/lib/absenceAttachmentService.ts', 'utf8');
assert.match(attachmentFunction, /auth\.getUser/);
assert.match(attachmentFunction, /detectAbsenceAttachmentType/);
assert.doesNotMatch(attachmentFunction, /SERVICE_ROLE|service_role/i);
assert.match(attachmentMigration, /VALUES \('absence-documents', 'absence-documents', false/);
assert.match(attachmentMigration, /AS RESTRICTIVE FOR SELECT TO PUBLIC/);
assert.match(attachmentMigration, /can_manage_absence_attachment/);
assert.match(moduleSource, /absenceAttachmentsPersistenceEnabled = false|absenceAttachmentsPersistenceEnabled/);
assert.match(attachmentService, /mk9_faltas_atestados_attachment_path/);
console.log(`PASS: inspected ${assets.length} production assets and private attachment controls; no CRM secret/configuration or external write endpoint found.`);
