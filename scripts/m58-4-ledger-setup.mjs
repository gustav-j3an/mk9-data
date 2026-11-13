import { readFile } from 'node:fs/promises';

const blocked = new Set(['20261009144200', '20261010', '20261011120000', '20261011140000', '20261017120000', '20261017']);
const [manifestPath] = process.argv.slice(2);
if (!manifestPath) throw new Error('USAGE');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const versions = manifest.migrations.map((migration) => migration.version).filter((version) => version && !blocked.has(version)).slice(0, 17);
if (versions.length !== 17) throw new Error('M58_4_SYNTHETIC_LEDGER_BASELINE_INVALID');
const rows = versions.map((version) => `('${version}', ARRAY['synthetic baseline only'], 'synthetic_baseline')`).join(',\n');
process.stdout.write(`INSERT INTO supabase_migrations.schema_migrations(version, statements, name) VALUES\n${rows};\n`);
