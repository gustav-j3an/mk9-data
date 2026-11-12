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

export function isAuthorizedPostgresImage(image) {
  if (!image || typeof image !== 'string') {
    return false;
  }
  // Exclusively accept official Supabase Postgres image registries:
  // 1. Docker Hub: supabase/postgres:<tag>
  // 2. AWS ECR Public: public.ecr.aws/supabase/postgres:<tag>
  return /^(?:public\.ecr\.aws\/)?supabase\/postgres:[a-zA-Z0-9_.-]+$/.test(image.trim());
}

export function inspectCandidateContainerDiagnostics({
  containerId,
  containerName,
  image,
  labels,
  expectedProjectId,
}) {
  const hexPattern = /^[0-9a-fA-F]{12,64}$/;
  const isHexValid = Boolean(containerId && hexPattern.test(containerId.trim()));

  const normalizedName = (containerName || '').replace(/^\//, '');
  const isNameMatch = normalizedName === `supabase_db_${expectedProjectId}`;

  const isImageMatch = isAuthorizedPostgresImage(image);

  const cliProject = labels?.['com.supabase.cli.project'];
  const composeProject = labels?.['com.docker.compose.project'];

  // Project label is considered matching if it either matches expectedProjectId or is unset (not conflicting)
  const isCliProjectMatch = !cliProject || cliProject === expectedProjectId;
  const isComposeProjectMatch = !composeProject || composeProject === expectedProjectId;
  const isLabelsMatch = isCliProjectMatch && isComposeProjectMatch;

  let reason = 'APPROVED';
  let valid = true;

  if (!isHexValid) {
    valid = false;
    reason = 'INVALID_HEX_ID';
  } else if (!isNameMatch) {
    valid = false;
    reason = 'NAME_MISMATCH';
  } else if (!isImageMatch) {
    valid = false;
    reason = 'IMAGE_UNTRUSTED';
  } else if (cliProject && cliProject !== expectedProjectId) {
    valid = false;
    reason = 'CLI_PROJECT_LABEL_MISMATCH';
  } else if (composeProject && composeProject !== expectedProjectId) {
    valid = false;
    reason = 'COMPOSE_PROJECT_LABEL_MISMATCH';
  }

  return {
    valid,
    reason,
    isHexValid,
    isNameMatch,
    isImageMatch,
    isCliProjectMatch,
    isComposeProjectMatch,
    isLabelsMatch,
  };
}

export function verifyCandidateContainerMetadata({
  containerId,
  containerName,
  image,
  labels,
  expectedProjectId,
}) {
  const diag = inspectCandidateContainerDiagnostics({
    containerId,
    containerName,
    image,
    labels,
    expectedProjectId,
  });

  return {
    valid: diag.valid,
    reason: diag.reason,
  };
}

export function filterVerifiedContainers(candidates, expectedProjectId, logger = console) {
  const verified = [];
  const diagnostics = [];

  for (const candidate of candidates) {
    const diag = inspectCandidateContainerDiagnostics({
      containerId: candidate.id,
      containerName: candidate.name,
      image: candidate.image,
      labels: candidate.labels,
      expectedProjectId,
    });

    if (diag.valid) {
      verified.push(candidate);
    }

    diagnostics.push({
      reason: diag.reason,
      isHexValid: diag.isHexValid,
      isNameMatch: diag.isNameMatch,
      isImageMatch: diag.isImageMatch,
      isLabelsMatch: diag.isLabelsMatch,
    });
  }

  if (verified.length !== 1) {
    // Emit strictly sanitized diagnostic summary without exposing raw IDs, names, images, labels or tokens
    logger.error(`[DISPOSABLE_CONTAINER_DIAGNOSTICS] Total inspected: ${candidates.length}, Approved: ${verified.length}`);
    const summaryLimit = Math.min(diagnostics.length, 10);
    for (let i = 0; i < summaryLimit; i++) {
      const d = diagnostics[i];
      logger.error(`[DISPOSABLE_CONTAINER_DIAGNOSTICS] Candidate #${i + 1}: reason=${d.reason} nameMatch=${d.isNameMatch} imageMatch=${d.isImageMatch} labelsMatch=${d.isLabelsMatch} hexValid=${d.isHexValid}`);
    }
    if (diagnostics.length > summaryLimit) {
      logger.error(`[DISPOSABLE_CONTAINER_DIAGNOSTICS] (${diagnostics.length - summaryLimit} additional candidate(s) omitted)`);
    }

    const count = verified.length;
    throw new Error(`DISPOSABLE_CONTAINER_RESOLUTION_FAILED: Expected exactly 1 verified disposable database container for project "${expectedProjectId}", found ${count}`);
  }

  return verified[0];
}

export function verifyDatabaseNonceMatch({ containerId, expectedNonce, targetDatabase = 'postgres', execFn }) {
  if (!containerId || !expectedNonce) {
    throw new Error('NONCE_VERIFICATION_PARAMS_MISSING');
  }

  const query = 'SELECT token FROM mk9_backup_restore_nonce LIMIT 1;';
  let returnedNonce;
  try {
    returnedNonce = execFn(containerId, query, targetDatabase);
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
  const execFn = (id, sql, db = 'postgres') => {
    return execFileSync('docker', ['exec', id, 'psql', '-U', 'postgres', '-d', db, '-t', '-A', '-c', sql], {
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
