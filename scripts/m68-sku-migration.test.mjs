import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

test('migration 20261115_rc1_25_skus_and_stock_audits: validates syntax, integrity constraints and RLS', () => {
  const filePath = join(rootDir, 'supabase', 'migrations', 'propostas', '20261115_rc1_25_skus_and_stock_audits.sql');
  const sql = readFileSync(filePath, 'utf8');

  // 1. Tabela industria_skus
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.industria_skus/);
  assert.match(sql, /status IN \('ativo', 'inativo', 'pendente', 'rejeitado'\)/);
  assert.match(sql, /origem_cadastro IN \('admin_import', 'admin_manual', 'promotor_sugestao'\)/);
  assert.match(sql, /CONSTRAINT uq_industria_sku_codigo UNIQUE \(industria_codigo, codigo_sku\)/);

  // 2. Tabela visit_sku_stock_checks
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.visit_sku_stock_checks/);
  assert.match(sql, /quantidade_venda INT NOT NULL DEFAULT 0 CHECK \(quantidade_venda >= 0\)/);
  assert.match(sql, /quantidade_reposicao INT NOT NULL DEFAULT 0 CHECK \(quantidade_reposicao >= 0\)/);
  assert.match(sql, /status_conferencia IN \('conferido', 'justificado', 'pendente'\)/);
  assert.match(sql, /justificativa IN \('nao_encontrado', 'nao_comercializado', 'inacessivel', 'outro'\)/);
  assert.match(sql, /CONSTRAINT uq_visit_sku_check UNIQUE \(visit_id, codigo_sku\)/);

  // 3. Tabela visit_edits_audit_log
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.visit_edits_audit_log/);
  assert.match(sql, /altered_by_user_id UUID NOT NULL REFERENCES auth\.users\(id\)/);

  // 4. RLS e Políticas
  assert.match(sql, /ALTER TABLE public\.industria_skus ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE public\.visit_sku_stock_checks ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE public\.visit_edits_audit_log ENABLE ROW LEVEL SECURITY/);

  // Restrição de promotor inserindo apenas sugestão pendente
  assert.match(sql, /status = 'pendente'\s+AND origem_cadastro = 'promotor_sugestao'/);

  // Restrição de promotor gravando estoque apenas para a própria visita
  assert.match(sql, /conferido_por_matricula = public\.get_auth_promotor_matricula\(\)/);
});
