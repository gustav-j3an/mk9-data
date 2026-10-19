import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CANONICAL_TABLES = [
  'visits',
  'rotas',
  'promotores',
  'lojas',
  'visit_photos'
];

describe('Proteção contra regressão — Tabelas Canônicas do Supabase', () => {
  it('confirma que o Portal da Indústria usa as tabelas canônicas oficiais do Supabase', () => {
    const portal = readFileSync(join(process.cwd(), 'src', 'views', 'IndustryPortalView.tsx'), 'utf8');

    for (const table of CANONICAL_TABLES) {
      assert.match(portal, new RegExp(`\\.from\\(['"]${table}['"]\\)`), `Portal must query ${table}`);
    }

    // Garante que não existem consultas a views inexistentes que causam PGRST205
    const nonExistentViews = ['industry_visits', 'industry_routes', 'industry_promoters', 'industry_visit_photos'];
    for (const view of nonExistentViews) {
      assert.doesNotMatch(portal, new RegExp(`\\.from\\(['"]${view}['"]\\)`), `Portal must not query non-existent ${view}`);
    }
  });
});
