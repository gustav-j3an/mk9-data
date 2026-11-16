import { execFileSync } from 'node:child_process';

export const MAX_BACKUP_AGE_MS = 24 * 60 * 60 * 1000; // 24 horas

export async function verifyActiveHomologationBackup(token = process.env.GITHUB_TOKEN) {
  const repo = 'gustav-j3an/mk9-data';
  const url = `https://api.github.com/repos/${repo}/actions/artifacts?per_page=20`;
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'mk9-safe-rc1-25-apply'
  };
  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`FAILED_TO_FETCH_ARTIFACTS: GitHub API returned status ${res.status}`);
  }

  const data = await res.json();
  const artifacts = data.artifacts || [];

  // Localizar artefato ativo de backup de homologacao
  const backupArtifacts = artifacts.filter(a =>
    a.name && a.name.startsWith('mk9-homologation-backup-') && !a.expired
  );

  if (backupArtifacts.length === 0) {
    throw new Error('NO_ACTIVE_BACKUP_FOUND: No unexpired mk9-homologation-backup artifact exists.');
  }

  // Ordenar pelo mais recente
  backupArtifacts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const latest = backupArtifacts[0];

  const createdAt = new Date(latest.created_at).getTime();
  const ageMs = Date.now() - createdAt;
  if (ageMs > MAX_BACKUP_AGE_MS) {
    throw new Error(`BACKUP_EXPIRED: Latest backup artifact ${latest.name} is older than 24 hours (${Math.round(ageMs / 3600000)}h).`);
  }

  return {
    ok: true,
    name: latest.name,
    id: latest.id,
    sizeBytes: latest.size_in_bytes,
    sha256: latest.digest,
    createdAt: latest.created_at,
    expiresAt: latest.expires_at,
    runId: latest.workflow_run?.id
  };
}

if (process.argv[1] && process.argv[1].endsWith('verify-active-backup.mjs')) {
  verifyActiveHomologationBackup()
    .then(b => {
      console.log(`[BACKUP VERIFIED] Active backup found: ${b.name} (runId: ${b.runId}, size: ${b.sizeBytes} bytes, expires: ${b.expiresAt})`);
      process.exit(0);
    })
    .catch(err => {
      console.error(`[BACKUP CHECK FAILED] ${err.message}`);
      process.exit(1);
    });
}
