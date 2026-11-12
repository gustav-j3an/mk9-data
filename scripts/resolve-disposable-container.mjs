import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

/**
 * Resolves and verifies the exact disposable database container for the isolated backup restore.
 * 
 * Cryptographic & Operational Identity Rules:
 * 1. An ephemeral nonce/token is injected into the disposable stack's project_id during initialization.
 * 2. Candidates must match the full container name format `supabase_db_<project_id>`.
 * 3. Candidate container image must strictly belong to `supabase/postgres:*`.
 * 4. Docker labels (com.supabase.cli.project and com.docker.compose.project) must match the ephemeral project_id.
 * 5. In-database nonce check: The database accessed via LOCAL_DB_URL must contain the ephemeral nonce table.
 *    The selected container must be verified by querying that same nonce table directly via `docker exec`.
 * 
 * If any check fails, or if 0 or >1 containers match, execution is halted immediately.
 */

export function verifyCandidateContainerMetadata({
  containerId,
  containerName,
  image,
  labels,
  expectedProjectId,
}) {
  const hexPattern = /^[0-9a-fA-F]{12,64}$/;
  if (!containerId || !hexPattern.test(containerId.trim())) {
    return { valid: false, reason: 'INVALID_HEX_ID' };
  }

  // Name check: must match supabase_db_<expectedProjectId>
  const normalizedName = (containerName || '').replace(/^\//, '');
  if (normalizedName !== `supabase_db_${expectedProjectId}`) {
    return { valid: false, reason: 'NAME_MISMATCH' };
  }

  // Image check: must be official Supabase postgres image
  if (!image || !image.startsWith('supabase/postgres:')) {
    return { valid: false, reason: 'IMAGE_UNTRUSTED' };
  }

  // Label check: project labels if present must match expectedProjectId
  const cliProject = labels?.['com.supabase.cli.project'];
  const composeProject = labels?.['com.docker.compose.project'];
  if (cliProject && cliProject !== expectedProjectId) {
    return { valid: false, reason: 'CLI_PROJECT_LABEL_MISMATCH' };
  }
  if (composeProject && composeProject !== expectedProjectId) {
    return { valid: false, reason: 'COMPOSE_PROJECT_LABEL_MISMATCH' };
  }

  return { valid: true };
}

export function filterVerifiedContainers(candidates, expectedProjectId) {
  const verified = [];
  for (const candidate of candidates) {
    const check = verifyCandidateContainerMetadata({
      containerId: candidate.id,
      containerName: candidate.name,
      image: candidate.image,
      labels: candidate.labels,
      expectedProjectId,
    });
    if (check.valid) {
      verified.push(candidate);
    }
  }

  if (verified.length !== 1) {
    const count = verified.length;
    throw new Error(`DISPOSABLE_CONTAINER_RESOLUTION_FAILED: Expected exactly 1 verified disposable database container for project "${expectedProjectId}", found ${count}`);
  }

  return verified[0];
}

export function verifyDatabaseNonceMatch({ containerId, expectedNonce, execFn }) {
  if (!containerId || !expectedNonce) {
    throw new Error('NONCE_VERIFICATION_PARAMS_MISSING');
  }

  const query = 'SELECT token FROM mk9_backup_restore_nonce LIMIT 1;';
  let returnedNonce;
  try {
    returnedNonce = execFn(containerId, query);
  } catch (err) {
    throw new Error(`CONTAINER_NONCE_QUERY_FAILED: ${err.message}`);
  }

  if (!returnedNonce || returnedNonce.trim() !== expectedNonce.trim()) {
    throw new Error(`CONTAINER_NONCE_MISMATCH: Container ${containerId} returned nonce "${returnedNonce}", expected "${expectedNonce}"`);
  }

  return true;
}

// CLI entrypoint when executed directly from shell
if (process.argv[1] && process.argv[1].endsWith('resolve-disposable-container.mjs')) {
  const [,, expectedProjectId, expectedNonce] = process.argv;
  if (!expectedProjectId || !expectedNonce) {
    console.error('Usage: node scripts/resolve-disposable-container.mjs <expectedProjectId> <expectedNonce>');
    process.exit(1);
  }

  let rawInspectJson;
  try {
    // List all running containers and fetch their details as JSON
    const containerIds = execFileSync('docker', ['ps', '-q'], { encoding: 'utf8' })
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (containerIds.length === 0) {
      console.error(`DISPOSABLE_CONTAINER_RESOLUTION_FAILED: No running containers found`);
      process.exit(1);
    }

    rawInspectJson = execFileSync('docker', ['inspect', ...containerIds], { encoding: 'utf8' });
  } catch (err) {
    console.error(`DOCKER_INSPECT_FAILED: ${err.message}`);
    process.exit(1);
  }

  let inspectData;
  try {
    inspectData = JSON.parse(rawInspectJson);
  } catch (err) {
    console.error(`DOCKER_INSPECT_PARSE_FAILED: ${err.message}`);
    process.exit(1);
  }

  const candidates = inspectData.map(c => ({
    id: c.Id ? c.Id.substring(0, 12) : '',
    name: c.Name || '',
    image: c.Config?.Image || '',
    labels: c.Config?.Labels || {},
  }));

  let selected;
  try {
    selected = filterVerifiedContainers(candidates, expectedProjectId);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  // Verify database nonce inside container via docker exec
  const execFn = (id, sql) => {
    return execFileSync('docker', ['exec', id, 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c', sql], {
      encoding: 'utf8',
    }).trim();
  };

  try {
    verifyDatabaseNonceMatch({
      containerId: selected.id,
      expectedNonce,
      execFn,
    });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  // Print verified container ID to stdout for the calling script
  console.log(selected.id);
}
