import { createClient } from '@supabase/supabase-js';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';

const output = process.argv[2];
const url = process.env.SUPABASE_PROJECT_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!output || !url || !key) throw new Error('M65_AUTH_EXPORT_CONFIGURATION_MISSING');
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const stream = createWriteStream(output, { flags: 'wx', mode: 0o600 });

try {
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 500 });
    if (error || !data) throw new Error('M65_AUTH_USER_EXPORT_FAILED');
    for (const user of data.users) {
      if (!stream.write(`${JSON.stringify(user)}\n`)) await once(stream, 'drain');
    }
    if (data.users.length < 500) break;
  }
  const flushed = once(stream, 'finish');
  stream.end();
  await flushed;
  process.stdout.write('M65_AUTH_USER_EXPORT_COMPLETE\n');
} catch (error) {
  stream.destroy();
  process.stderr.write(`${error instanceof Error ? error.message : 'M65_AUTH_USER_EXPORT_FAILED'}\n`);
  process.exitCode = 1;
}
