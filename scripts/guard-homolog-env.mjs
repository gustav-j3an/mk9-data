/**
 * scripts/guard-homolog-env.mjs
 * Guard de seguranca mandatorio para operacoes de homologacao.
 * Impede estritamente qualquer conexao ou apontamento acidental para producao.
 */

export const ALLOWED_HOMOLOG_PROJECT_REF = 'tafjceemuetqjyngresg';
export const FORBIDDEN_PRODUCTION_PROJECT_REF = 'xzmbesqhxcnuokjwrbnw';

export function validateTargetProject(targetRef) {
  if (typeof targetRef !== 'string') {
    return { ok: false, error: 'BLOCKED: Target project parameter is not a string.' };
  }
  const clean = targetRef.trim();
  if (clean.length === 0) {
    return { ok: false, error: 'BLOCKED: Target project is empty or omitted.' };
  }
  if (clean === FORBIDDEN_PRODUCTION_PROJECT_REF) {
    return { ok: false, error: 'FATAL: Attempted execution on PRODUCTION project (xzmbesqhxcnuokjwrbnw). Blocked immediately!' };
  }
  if (clean !== ALLOWED_HOMOLOG_PROJECT_REF) {
    return { ok: false, error: `BLOCKED: Target project '${clean}' is not recognized. Expected exclusively '${ALLOWED_HOMOLOG_PROJECT_REF}'.` };
  }
  return { ok: true, projectRef: clean };
}

export function validateIsolationFromRepoLink(repoLinkedRef) {
  if (typeof repoLinkedRef === 'string' && repoLinkedRef.trim() === FORBIDDEN_PRODUCTION_PROJECT_REF) {
    return {
      ok: true,
      isolated: true,
      warning: `Repository root links to production (${FORBIDDEN_PRODUCTION_PROJECT_REF}). A separate, isolated temp workdir is MANDATORY to prevent accidental writes.`
    };
  }
  return { ok: true, isolated: true };
}

if (process.argv[1] && process.argv[1].endsWith('guard-homolog-env.mjs')) {
  const target = process.argv[2];
  const res = validateTargetProject(target);
  if (!res.ok) {
    console.error(res.error);
    process.exit(1);
  }
  console.log(`[GUARD PASSED] Project validated: ${res.projectRef}`);
  process.exit(0);
}
