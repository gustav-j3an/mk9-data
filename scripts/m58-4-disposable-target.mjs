import { isIP } from 'node:net';

export function assertDisposableTarget({ databaseUrl, projectId, nonce }) {
  let target;
  try { target = new URL(databaseUrl); } catch { throw new Error('M58_4_DB_URL_INVALID'); }
  if (target.protocol !== 'postgresql:' || target.hostname !== '127.0.0.1' || target.port !== '54322'
      || target.pathname !== '/postgres' || target.username !== 'postgres' || target.password !== 'postgres'
      || target.searchParams.get('sslmode') !== 'disable' || [...target.searchParams.keys()].some((key) => key !== 'sslmode')
      || target.hash) throw new Error('M58_4_DB_TARGET_NOT_DISPOSABLE');
  if (!/^mk9_synth_[0-9a-f]{28}$/.test(projectId ?? '') || nonce !== projectId.slice('mk9_synth_'.length)) {
    throw new Error('M58_4_DISPOSABLE_IDENTITY_INVALID');
  }
  return true;
}

export function assertDisposableConnectionProbe({ database, serverAddress, serverPort, serverVersionNum, nonceCount, containerIps }) {
  if (database !== 'postgres' || Number(serverPort) !== 5432 || Number(serverVersionNum) < 170000
      || Number(serverVersionNum) >= 180000 || Number(nonceCount) !== 1) {
    throw new Error('M58_4_POSTGRES_CONNECTION_PROBE_INVALID');
  }
  const allowed = Array.isArray(containerIps) ? containerIps : String(containerIps ?? '').split(',').filter(Boolean);
  if (!allowed.length || allowed.some((ip) => isIP(ip) !== 4) || !allowed.includes(serverAddress)) {
    throw new Error('M58_4_POSTGRES_CONTAINER_ADDRESS_MISMATCH');
  }
  return true;
}

if (process.argv[1]?.endsWith('m58-4-disposable-target.mjs')) {
  const [, , databaseUrl, projectId, nonce, probe, containerIps] = process.argv;
  assertDisposableTarget({ databaseUrl, projectId, nonce });
  if (!probe) {
    console.log('Disposable PostgreSQL URL and project identity accepted.');
  } else {
    const [database, serverAddress, serverPort, serverVersionNum, nonceCount] = probe.split('|');
    assertDisposableConnectionProbe({ database, serverAddress, serverPort, serverVersionNum, nonceCount, containerIps });
    console.log('PostgreSQL endpoint, server version, container network address and nonce match the authorized disposable container.');
  }
}
