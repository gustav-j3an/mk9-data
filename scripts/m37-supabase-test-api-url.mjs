const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function resolveSupabaseTestApiUrl(explicitUrl, statusOutput) {
  const candidate = explicitUrl || Object.fromEntries(statusOutput.split(/\r?\n/).map(line => {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    return match ? [match[1], match[2].replace(/^['"]|['"]$/g, '')] : [];
  }).filter(([key]) => key)).API_URL;

  if (!candidate) {
    throw new Error('Local Supabase API URL is missing: set SUPABASE_TEST_API_URL or ensure `supabase status -o env` reports API_URL.');
  }

  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('Local Supabase API URL is invalid; expected an HTTP URL for the disposable local stack.');
  }
  if (url.protocol !== 'http:' || !LOCAL_HOSTS.has(url.hostname)) {
    throw new Error('Refusing non-local Supabase API URL; functional tests may only connect to the disposable local stack.');
  }
  return url.origin;
}
