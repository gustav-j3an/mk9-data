import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { rhHandler } from './server/rh-handler.ts';
import rhAccessHandler from './server/rh-access-handler.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY', 'MK9_FALTAS_API_URL', 'MK9_FALTAS_API_KEY', 'MK9_FALTAS_PROJECT_TEAMS']) {
    if (env[key] && !process.env[key]) process.env[key] = env[key];
  }
  return {
    plugins: [react(), tailwindcss(), {
      name: 'mk9-rh-api',
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
