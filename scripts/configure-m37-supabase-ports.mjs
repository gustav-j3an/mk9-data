import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SUPABASE_PORT_KEYS = [
  ['api', 'port'],
  ['db', 'port'],
  ['db', 'shadow_port'],
  ['db.pooler', 'port'],
  ['studio', 'port'],
  ['local_smtp', 'port'],
  ['analytics', 'port'],
  ['edge_runtime', 'inspector_port']
];

export function configureSupabasePorts(config, ports) {
  let section = '';
  const seen = new Set();
  const updated = config.split(/\r?\n/).map(line => {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (sectionMatch) section = sectionMatch[1];

    const key = SUPABASE_PORT_KEYS.find(([targetSection, targetKey]) =>
      targetSection === section && line.match(new RegExp(`^\\s*${targetKey}\\s*=`)));
    if (!key) return line;

    const value = ports[`${key[0]}.${key[1]}`];
    if (!Number.isInteger(value) || value < 1024 || value > 65535) {
      throw new Error(`Invalid or missing port for [${key[0]}].${key[1]}.`);
    }
    seen.add(`${key[0]}.${key[1]}`);
    return line.replace(/^(\s*[^=]+?\s*=\s*)\d+(\s*(?:#.*)?)$/, `$1${value}$2`);
  });

  const missing = SUPABASE_PORT_KEYS
    .map(([targetSection, targetKey]) => `${targetSection}.${targetKey}`)
    .filter(key => !seen.has(key));
  if (missing.length) throw new Error(`Supabase config is missing port settings: ${missing.join(', ')}.`);

  const values = SUPABASE_PORT_KEYS.map(([targetSection, targetKey]) => ports[`${targetSection}.${targetKey}`]);
  if (new Set(values).size !== values.length) throw new Error('Supabase service ports must be unique.');

  return updated.join('\n');
}

export async function allocateUniquePorts(count = SUPABASE_PORT_KEYS.length) {
  const ports = new Set();
  while (ports.size < count) {
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '0.0.0.0', resolve);
    });
    const { port } = server.address();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    ports.add(port);
  }
  return [...ports];
}

async function main() {
  const configPath = process.argv[2];
  if (!configPath) throw new Error('Usage: node configure-m37-supabase-ports.mjs <supabase-config.toml>');

  const ports = await allocateUniquePorts();
  const portMap = Object.fromEntries(SUPABASE_PORT_KEYS.map(([section, key], index) => [`${section}.${key}`, ports[index]]));
  const config = readFileSync(configPath, 'utf8');
  writeFileSync(configPath, configureSupabasePorts(config, portMap), 'utf8');

  const databasePort = portMap['db.port'];
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `PGPORT=${databasePort}\n`);
  console.log(`Configured unique Supabase ports: ${Object.entries(portMap).map(([key, value]) => `${key}=${value}`).join(', ')}`);
  console.log(`PGPORT=${databasePort} matches [db].port in supabase/config.toml.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}
