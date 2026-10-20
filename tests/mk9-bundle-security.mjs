import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { parse } from 'dotenv';
const sentinel = 'mk9_live_BUNDLE_SECURITY_SENTINEL_8bc779e0';
const secrets = [sentinel, process.env.MK9_FALTAS_API_KEY].filter(Boolean);
for (const path of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  try { const value = parse(await readFile(path)).MK9_FALTAS_API_KEY; if (value) secrets.push(value); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
}
execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
  env: { ...process.env, MK9_FALTAS_API_KEY: sentinel }, stdio: 'inherit'
});
let files = 0;
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await scan(path);
    else {
      const content = await readFile(path);
      assert.ok(!secrets.some(secret => content.includes(Buffer.from(secret))), `Secret found in ${path}`);
      assert.ok(!content.includes(Buffer.from('MK9_FALTAS_API_KEY')), `Server configuration found in ${path}`);
      files++;
    }
  }
}
await scan('dist');
const evidence = { passed: true, filesScanned: files, sentinelAbsent: true, configuredSecretPresentInEnvironment: secrets.length > 1, configuredSecretAbsentFromBundle: true, serverKeyVariableAbsent: true };
await mkdir('scratch/mk9-responsive', { recursive: true });
await writeFile('scratch/mk9-responsive/bundle-security.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
