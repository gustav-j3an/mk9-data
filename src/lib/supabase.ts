import { createClient } from '@supabase/supabase-js';

const env =
  typeof import.meta !== 'undefined' && import.meta.env
    ? import.meta.env
    : (typeof process !== 'undefined' ? (process.env as any) : {});

export const supabaseUrl = env.VITE_SUPABASE_URL;

// Priorizar chave pública oficial do frontend
const rawKey = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY;

// Medida preventiva de segurança em tempo de execução:
// Garante que uma credencial com 'service_role' jamais seja carregada no cliente web
export const supabasePublishableKey = (() => {
  if (!rawKey) return undefined;
  try {
    // Se for JWT, verificar se possui role 'service_role'
    if (rawKey.includes('.')) {
      const parts = rawKey.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1]));
        if (payload.role === 'service_role') {
          console.error('[SECURITY ERROR] Uma credencial administrativa (service_role) foi detectada indevidamente nas variáveis de ambiente do cliente web e foi bloqueada.');
          return undefined;
        }
      }
    }
  } catch {
    // Chaves padrão sb_publishable não são JWT de 3 partes e passam normalmente
  }
  return rawKey;
})();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

export const createIsolatedClient = () => {
  if (!isSupabaseConfigured) return null;
  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
};
