import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

export const EXPECTED_FUNCTIONS = Object.freeze([
  { file: '20261010_create_system_settings_and_audit.sql', name: 'set_operation_mode', signature: 'text,date,text', hash: 'f5998b68f9299ed23841ab42f9e38cbf9a63d810a8ec207f2b7dd920a9fb04fd' },
  { file: '20261011120000_create_promoter_authorizations.sql', name: 'is_promotor_authorized', signature: 'text', hash: 'ecbfaaf0d9eb23ceac53cb5d4c3d0a0a89bd9211e6c6971e75032ec89fadb426' },
  { file: '20261011120000_create_promoter_authorizations.sql', name: 'check_visit_promotor_update_integrity', signature: '', hash: '37b776d3aecf92e97fbe597efba96912537b6ac3a49d177297b82f76ee23f80f' },
  { file: '20261011120000_create_promoter_authorizations.sql', name: 'set_promoter_authorization', signature: 'text,text,text', hash: '5d64566240a1a7ce4bea17f3990e076f34c0ffc1b6d2e22771ec39f5612e03da' },
  { file: '20261011140000_auto_generate_industry_code.sql', name: 'generate_industry_code', signature: '', hash: 'f8f645f06977615bd034826940018927b47c98766ef62494d69585015788a1fe' },
  { file: '20261011140000_auto_generate_industry_code.sql', name: 'get_next_industry_code', signature: '', hash: '32dd2bd302b0e7dcf440a276ad846aec9bcd6287a2955ca1f6c014c30789450f' },
  { file: '20261011140000_auto_generate_industry_code.sql', name: 'set_industria_codigo_trigger', signature: '', hash: 'b15eaa0da4f6589dff18eb3f59c74d421a89958805b11fd2ec76b4fefe3ee1c0' },
  { file: '20261017120000_create_contratos_lojas_table.sql', name: 'check_contratos_vigencia_overlap', signature: '', hash: '4368408cd796d4be865440e13d769100ec87431b6f22c3ccdff525a717f9ce46' },
  { file: '20261017120000_create_contratos_lojas_table.sql', name: 'handle_contratos_updated_at', signature: '', hash: 'c10d3ecdb68d176c4ef7b01c3a1e54694ef57ab9c5da8db855e50997e3dfff31' },
  { file: '20261017120000_create_contratos_lojas_table.sql', name: 'sync_contratos_from_rotas', signature: '', hash: '40959a6cb21073ed9efe13b338817dc3456279c2944504b26274bac0959786cd',
  },
]);

export function sourceFunctionBody(sql, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${escaped}\\s*\\([\\s\\S]*?\\)\\s*RETURNS[\\s\\S]*?\\bAS\\s+\\$\\$([\\s\\S]*?)\\$\\$;`, 'i');
  const match = sql.match(expression);
  if (!match) throw new Error(`M58_4_EXPECTED_FUNCTION_SOURCE_MISSING:${name}`);
  return match[1].replace(/\r\n/g, '\n');
}

export function assertFunctionBodyHash(expectedHash, body, label = 'function') {
  const actual = createHash('sha256').update(body, 'utf8').digest('hex');
  if (actual !== expectedHash) throw new Error(`M58_4_FUNCTION_BODY_DIVERGED:${label}`);
  return true;
}

export async function verifyFunctionBodies(databaseUrl, migrationDirectory = 'supabase/migrations') {
  for (const item of EXPECTED_FUNCTIONS) {
    const sql = await readFile(`${migrationDirectory}/${item.file}`, 'utf8');
    const body = sourceFunctionBody(sql, item.name);
    assertFunctionBodyHash(item.hash, body, item.name);
    const query = `SELECT prosrc FROM pg_proc WHERE oid='public.${item.name}(${item.signature})'::regprocedure`;
    const result = spawnSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], { encoding: 'utf8' });
    if (result.status !== 0 || !result.stdout) throw new Error(`M58_4_DATABASE_FUNCTION_MISSING:${item.name}`);
    assertFunctionBodyHash(item.hash, result.stdout.replace(/\r?\n$/, ''), item.name);
  }
  return true;
}

if (process.argv[1]?.endsWith('m58-4-verify-function-bodies.mjs')) {
  const [databaseUrl] = process.argv.slice(2);
  if (!databaseUrl) throw new Error('USAGE');
  await verifyFunctionBodies(databaseUrl);
  console.log(`Verified ${EXPECTED_FUNCTIONS.length} migration function bodies against fixed SHA-256 fingerprints.`);
}
