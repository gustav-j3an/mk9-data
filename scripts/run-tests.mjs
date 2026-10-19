import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
async function find(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => entry.isDirectory() ? find(`${directory}/${entry.name}`) : entry.name.endsWith('.test.ts') ? [`${directory}/${entry.name}`] : []));
  return files.flat();
}
const files = (await Promise.all(['src', 'server'].map(find))).flat().sort();
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
