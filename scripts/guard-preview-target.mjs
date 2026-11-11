export const HOMOLOGATION_PROJECT_REF = 'tafjceemuetqjyngresg';
export const HOMOLOGATION_PREVIEW_BRANCH = 'codex/m44-promoter-homologation-preview';
export const HOMOLOGATION_PAGES_BRANCH = 'codex/m46-cloudflare-promoter-homologation';
export const HOMOLOGATION_PROTECTED_BRANCHES = new Set([
  HOMOLOGATION_PREVIEW_BRANCH,
  HOMOLOGATION_PAGES_BRANCH,
]);

export function validatePreviewTarget({ branch, supabaseUrl, publishableKey }) {
  if (!HOMOLOGATION_PROTECTED_BRANCHES.has(branch)) return { ok: true, applies: false };

  let projectRef = null;
  try {
    projectRef = new URL(supabaseUrl).hostname.split('.')[0];
  } catch {
    return { ok: false, reason: 'Preview branch requires a valid Supabase URL.' };
  }

  if (projectRef !== HOMOLOGATION_PROJECT_REF) {
    return { ok: false, reason: 'Preview branch is restricted to the homologation Supabase project.' };
  }
  if (typeof publishableKey !== 'string' || publishableKey.trim().length < 20) {
    return { ok: false, reason: 'Preview branch requires a Supabase publishable or anon key.' };
  }

  if (publishableKey.startsWith('eyJ')) {
    try {
      const payload = JSON.parse(Buffer.from(publishableKey.split('.')[1], 'base64url').toString());
      if (payload.ref && payload.ref !== HOMOLOGATION_PROJECT_REF) {
        return { ok: false, reason: 'Supabase key project claim does not match homologation.' };
      }
      if (payload.role === 'service_role') {
        return { ok: false, reason: 'Service role keys are forbidden in browser builds.' };
      }
    } catch {
      return { ok: false, reason: 'JWT-form Supabase key could not be validated.' };
    }
  } else if (!publishableKey.startsWith('sb_publishable_')) {
    return { ok: false, reason: 'Only a Supabase publishable key or verified legacy anon key is allowed.' };
  }

  return { ok: true, applies: true, projectRef };
}

export function assertPreviewTarget(config) {
  const result = validatePreviewTarget(config);
  if (!result.ok) throw new Error(`Unsafe homologation Preview build: ${result.reason}`);
  return result;
}
