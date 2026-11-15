import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

test('RC1.25 Security: validates RPC single-use authorization token & immutable audit lifecycle', () => {
  const filePath = join(rootDir, 'supabase', 'migrations', 'propostas', '20261115_rc1_25_skus_and_stock_audits.sql');
  const sql = readFileSync(filePath, 'utf8');

  // 1. Edição autorizada individual com token de uso único
  assert.match(sql, /authorization_token UUID UNIQUE/);
  assert.match(sql, /token_consumed_at TIMESTAMPTZ/);
  assert.match(sql, /token_consumed_at IS NULL/);
  assert.match(sql, /SET token_consumed_at = clock_timestamp\(\)/);

  // 2. Prevenção de reutilização: token só é válido se token_consumed_at IS NULL
  assert.match(sql, /WHERE authorization_token = v_auth_token[\s\S]*?AND token_consumed_at IS NULL/);
  assert.match(sql, /Token de autorização de edição inválido, expirado ou já reutilizado/);

  // 3. Validação estrita de correspondência de valor
  // O valor alterado em visits.observacao_geral deve corresponder estritamente ao auditado no token
  assert.match(sql, /NEW\.observacao_geral IS DISTINCT FROM \(v_audit_entry\.new_value ->> 'observacao_geral'\)/);
  assert.match(sql, /O valor de observação não corresponde à alteração autorizada na auditoria/);

  // 4. Bloqueio de alteração direta sem RPC
  // Sem v_auth_token válido, visitas concluídas disparam erro fatal
  assert.match(sql, /Closed visits cannot be changed by promoter/);

  // 5. Imutabilidade estrita de check-in, check-out e identidade da visita
  assert.match(sql, /Visit identity is immutable/);
  assert.match(sql, /Check-in is immutable/);
  assert.match(sql, /NEW\.promotor_matricula,NEW\.loja_codigo,NEW\.industria_codigo,NEW\.rota_id,NEW\.data_visita/);
  assert.match(sql, /NEW\.completed_at, NEW\.latitude, NEW\.longitude, NEW\.checkout_latitude, NEW\.checkout_longitude/);

  // 6. Proibição de edição de visitas de terceiros
  assert.match(sql, /OLD\.promotor_matricula IS DISTINCT FROM public\.get_auth_promotor_matricula\(\)/);
  assert.match(sql, /Visit not owned by authenticated promoter/);
  assert.match(sql, /v_caller_role NOT IN \('admin', 'gestor'\) AND \(v_caller_matricula IS NULL OR v_caller_matricula <> v_visit\.promotor_matricula\)/);
  assert.match(sql, /Você só pode editar visitas realizadas por você mesmo/);

  // 7. Atomicidade da auditoria e bloqueio de escrita direta no log
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.visit_edits_audit_log FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /ALTER TABLE public\.visit_edits_audit_log ENABLE ROW LEVEL SECURITY/);

  // 8. Gate de integridade de checkout de SKUs
  assert.match(sql, /guard_visit_sku_stock_finalization/);
  assert.match(sql, /Todos os SKUs ativos precisam ser conferidos ou justificados antes do checkout/);
});
