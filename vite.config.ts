import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {defineConfig, loadEnv} from 'vite';
import { rhHandler } from './server/rh-handler.ts';
import rhAccessHandler from './server/rh-access-handler.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY', 'MK9_FALTAS_API_URL', 'MK9_FALTAS_API_KEY', 'MK9_FALTAS_PROJECT_TEAMS']) {
    if (env[key] && !process.env[key]) process.env[key] = env[key];
  }
  const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;
  const readGit = (args: string[]) => {
    try { return execFileSync('git', args, { encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
  };
  const buildCommit = (process.env.VERCEL_GIT_COMMIT_SHA || readGit(['rev-parse', 'HEAD'])).slice(0, 7);
  const buildRef = (process.env.VERCEL_GIT_COMMIT_REF || readGit(['branch', '--show-current'])).replace(/[^a-zA-Z0-9._/-]/g, '').slice(0, 100);
  const buildDirty = !process.env.VERCEL_GIT_COMMIT_SHA && Boolean(readGit(['status', '--porcelain']));
  const buildInfo = { version: packageVersion, commit: `${buildCommit}${buildDirty ? '-dirty' : ''}`, ref: buildRef || 'unknown' };
  return {
    define: {
      __MK9_BUILD_INFO__: JSON.stringify(buildInfo),
    },
    plugins: [react(), tailwindcss(), {
      name: 'mk9-rh-api',
      transformIndexHtml(html) {
        return html.replace('</head>', `<meta name="mk9-build-version" content="${buildInfo.version}" />\n    <meta name="mk9-build-commit" content="${buildInfo.commit}" />\n    <meta name="mk9-build-ref" content="${buildInfo.ref}" />\n  </head>`);
      },
      configureServer(server) {
        const routes: Record<string, ReturnType<typeof rhHandler>> = {
          '/api/rh/acessos': rhAccessHandler,
          '/api/rh/minhas-ausencias': rhHandler('mine'),
          '/api/rh/equipe/ausencias': rhHandler('team'),
          '/api/rh/gestao/ausencias': rhHandler('management')
        };
        server.middlewares.use((req, res, next) => {
          const handler = routes[(req.url || '').split('?')[0]];
          if (handler) void handler(req, res); else next();
        });
      }
    }],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
