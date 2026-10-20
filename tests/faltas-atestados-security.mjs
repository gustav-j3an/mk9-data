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
console.log(`PASS: inspected ${assets.length} production assets; no CRM secret/configuration or external write endpoint found.`);
