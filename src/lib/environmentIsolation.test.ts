import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Isolamento de Ambientes — Homologação vs Produção', () => {
  const rootDir = resolve('.');

  it('arquivo .env.homologation.example existe e está configurado para o Supabase de homologação', () => {
    const homologationEnvPath = resolve(rootDir, '.env.homologation.example');
    assert.ok(existsSync(homologationEnvPath), '.env.homologation.example deve existir na raiz do projeto');

    const content = readFileSync(homologationEnvPath, 'utf8');
    assert.ok(content.includes('tafjceemuetqjyngresg'), 'Deve conter a ref do projeto de homologação (tafjceemuetqjyngresg)');
    assert.ok(content.includes('https://tafjceemuetqjyngresg.supabase.co'), 'VITE_SUPABASE_URL deve apontar para o host de homologação');
    assert.ok(content.includes('https://mk9-date-homologacao.vercel.app'), 'APP_URL deve apontar para o domínio de homologação');
  });

  it('comprova que os identificadores de homologação e produção são estritamente isolados', () => {
    const homologationRef = 'tafjceemuetqjyngresg';
    const productionRef = 'xzmbesqhxcnuokjwrbnw';

    assert.notEqual(homologationRef, productionRef, 'As referências de homologação e produção devem ser distintas');

    const homologationEnvPath = resolve(rootDir, '.env.homologation.example');
    const content = readFileSync(homologationEnvPath, 'utf8');

    assert.ok(
      !content.includes(productionRef),
      'O arquivo de configuração de homologação JAMAIS pode conter a referência do Supabase de produção'
    );
  });

  it('.gitignore permite o rastreamento de .env.homologation.example e .env.example sem expor .env.local', () => {
    const gitignorePath = resolve(rootDir, '.gitignore');
    assert.ok(existsSync(gitignorePath), '.gitignore deve existir');

    const gitignoreContent = readFileSync(gitignorePath, 'utf8');
    assert.ok(gitignoreContent.includes('!.env.homologation.example'), '.gitignore deve des-ignorar explicitamente .env.homologation.example');
    assert.ok(gitignoreContent.includes('!.env.example'), '.gitignore deve des-ignorar .env.example');
    assert.ok(gitignoreContent.includes('.env*'), '.gitignore deve manter .env* ignorado');
  });

  it('migration M30/M36A contém os triggers e proteções transacionais contra rotas de indústrias inativas', () => {
    const migrationPath = resolve(rootDir, 'supabase/migrations/20261105150000_m30_inactivate_industry_routes_sync.sql');
    assert.ok(existsSync(migrationPath), 'Migration M30 deve existir');

    const sql = readFileSync(migrationPath, 'utf8');

    // RPCs transacionais
    assert.ok(sql.includes('inactivate_industry_and_suspend_routes'), 'Deve conter a RPC inactivate_industry_and_suspend_routes');
    assert.ok(sql.includes('reactivate_industry_routes'), 'Deve conter a RPC reactivate_industry_routes');

    // Trigger de sincronização com contagem prévia não redundante
    assert.ok(sql.includes('trg_industrias_inactivation_sync_routes'), 'Deve conter o trigger trg_industrias_inactivation_sync_routes');
    assert.ok(sql.includes('trg_auto_suspend_routes_on_industry_inactivation'), 'Deve conter a função trg_auto_suspend_routes_on_industry_inactivation');
    assert.ok(sql.includes('v_active_routes_count > 0'), 'Deve conter verificação preventiva de rotas ativas para evitar redundância');

    // Trigger de proteção contra inserção e reativação de rotas para indústrias inativas
    assert.ok(sql.includes('trg_rotas_prevent_inactive_industry'), 'Deve conter o trigger trg_rotas_prevent_inactive_industry');
    assert.ok(sql.includes('trg_prevent_active_route_for_inactive_industry'), 'Deve conter a função trg_prevent_active_route_for_inactive_industry');
    assert.ok(sql.includes('ERRCODE = \'22023\''), 'Deve lançar erro 22023 caso se tente criar ou reativar rota de indústria inativa');
  });
});
