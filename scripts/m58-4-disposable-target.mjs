import { isIP } from 'node:net';

function normalizeIpAddress(value) {
  let address = String(value ?? '').trim();
  if (address.startsWith('[') && address.endsWith(']')) address = address.slice(1, -1);
  const slash = address.lastIndexOf('/');
  if (slash > 0) {
    const prefix = Number(address.slice(slash + 1));
    const candidate = address.slice(0, slash);
    const family = isIP(candidate);
    if (!family || !Number.isInteger(prefix) || prefix < 0 || prefix > (family === 4 ? 32 : 128)) return null;
    address = candidate;
  }
  const mappedV4 = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mappedV4) address = mappedV4[1];
  const mappedHexV4 = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (mappedHexV4) {
    const high = Number.parseInt(mappedHexV4[1], 16);
    const low = Number.parseInt(mappedHexV4[2], 16);
    address = [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
  }
  const family = isIP(address);
  if (!family) return null;
  if (family === 4) return address.split('.').map(Number).join('.');
  try {
    return new URL(`http://[${address}]/`).hostname.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }
}

export function extractContainerNetworkAddresses(containerNetworks) {
  let networks = containerNetworks;
  if (typeof networks === 'string') {
    const raw = networks.trim();
    if (!raw) return [];
    try {
      networks = JSON.parse(raw);
    } catch {
      // Keep accepting the previous comma-delimited CLI form for callers during migration.
      return [...new Set(raw.split(',').map(normalizeIpAddress).filter(Boolean))];
    }
  }
  networks = networks?.NetworkSettings?.Networks ?? networks;
  if (!networks || typeof networks !== 'object') return [];
  const entries = Array.isArray(networks) ? networks : Object.values(networks);
  const addresses = entries.flatMap((network) => typeof network === 'string'
    ? [network]
    : [network?.IPAddress, network?.GlobalIPv6Address]);
  return [...new Set(addresses.map(normalizeIpAddress).filter(Boolean))];
}

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
  const allowed = extractContainerNetworkAddresses(containerIps);
  const normalizedServerAddress = normalizeIpAddress(serverAddress);
  if (!allowed.length || !normalizedServerAddress || !allowed.includes(normalizedServerAddress)) {
    const server = normalizedServerAddress ?? 'invalid-or-empty';
    const docker = allowed.length ? allowed.join(',') : 'no-valid-container-addresses';
    throw new Error(`M58_4_POSTGRES_CONTAINER_ADDRESS_MISMATCH server=${server} docker=${docker}`);
  }
  return true;
}

if (process.argv[1]?.endsWith('m58-4-disposable-target.mjs')) {
  const [, , databaseUrl, projectId, nonce, probe, containerNetworks] = process.argv;
  assertDisposableTarget({ databaseUrl, projectId, nonce });
  if (!probe) {
    console.log('Disposable PostgreSQL URL and project identity accepted.');
  } else {
    const [database, serverAddress, serverPort, serverVersionNum, nonceCount] = probe.split('|');
    assertDisposableConnectionProbe({ database, serverAddress, serverPort, serverVersionNum, nonceCount, containerIps: containerNetworks });
    console.log('PostgreSQL endpoint, server version, container network address and nonce match the authorized disposable container.');
  }
}
