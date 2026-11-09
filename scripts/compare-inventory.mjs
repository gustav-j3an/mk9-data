import { readFile } from 'node:fs/promises';

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) throw new Error('USAGE');
const before = JSON.parse(await readFile(beforePath, 'utf8'));
const after = JSON.parse(await readFile(afterPath, 'utf8'));
if (JSON.stringify(before) !== JSON.stringify(after)) {
  console.error('Restored database inventory does not match source.');
  process.exit(1);
}
console.log('Database inventory matches: schemas, row counts, RLS, policies, functions, triggers, views, ACLs and extensions.');
