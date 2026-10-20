import { readFileSync } from 'node:fs';
import { createServer, type RequestListener } from 'node:http';

// Deliberately do not load .env.local or any hosted project configuration.
for (const name of Object.keys(process.env)) if (/^(SUPABASE_|VITE_|MK9_)/.test(name)) delete process.env[name];
const local = JSON.parse(readFileSync(new URL('../homologation/rh/.env.backend.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
if (local.url !== 'http://127.0.0.1:55321' || typeof local.key !== 'string') throw new Error('Invalid isolated local configuration');
process.env.SUPABASE_URL = local.url;
process.env.SUPABASE_PUBLISHABLE_KEY = local.key;
const nativeFetch = globalThis.fetch;
let blockedRequests = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== local.url || url.username || url.password) {
    blockedRequests++;
    throw new Error('Nonlocal network request blocked by RH homologation guard');
  }
  return nativeFetch(input, { ...init, redirect: 'error' });
};
const routes: Record<string, RequestListener> = {
  '/api/rh/acessos': (await import('../api/rh/acessos.ts')).default,
  '/api/rh/minhas-ausencias': (await import('../api/rh/minhas-ausencias.ts')).default,
  '/api/rh/equipe/ausencias': (await import('../api/rh/equipe/ausencias.ts')).default,
  '/api/rh/gestao/ausencias': (await import('../api/rh/gestao/ausencias.ts')).default,
};
createServer((req, res) => {
  const path = new URL(req.url || '/', 'http://127.0.0.1:55300').pathname;
  if (path === '/health') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ environment: 'mk9-rh-homolog', supabase: local.url, externalApiEnabled: false, blockedRequests }));
    return;
  }
  if (routes[path]) { routes[path](req, res); return; }
  res.statusCode = 404; res.end('{}');
}).listen(55300, '127.0.0.1', () => console.log('Isolated RH backend listening on 127.0.0.1:55300; external API disabled.'));
