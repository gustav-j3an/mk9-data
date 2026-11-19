import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseMigrationHistoryData, reconcileMigrationsLedger } from './reconcile-migrations.mjs';

test('reconcileMigrationsLedger: correctly groups collisions and preserves all physical unapplied files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'reconcile-test-'));
  try {
    const sqlPath = path.join(dir, 'history.sql');
    const manifestPath = path.join(dir, 'manifest.json');

    // Simula ledger com versão 20260930 e 20261001 aplicadas no DB
    const sqlContent = `
COPY supabase_migrations.schema_migrations (version, statements, name) FROM stdin;
20260930\t{statement_1}\tname_1
20261001\t{statement_2}\tname_2
\\.
`;
    await writeFile(sqlPath, sqlContent, 'utf8');

    // Simula bundle no repositório com 4 arquivos para 20260930 (colisão) e 2 arquivos para pendentes distintos
    const manifestContent = {
      schema_version: '1.0',
      total_executable_files: 7,
      migrations: [
        { version: '20260930', filename: '20260930_add_status_to_profiles.sql' },
        { version: '20260930', filename: '20260930_create_import_tables.sql' },
        { version: '20260930', filename: '20260930_create_profiles.sql' },
        { version: '20260930', filename: '20260930_update_rotas_structure.sql' },
        { version: '20261001', filename: '20261001_single_file.sql' },
        { version: '20261020160000', filename: '20261020160000_add_whatsapp_group_link_to_industrias.sql' },
        { version: '20261020163000', filename: '20261020163000_mk9_faltas_atestados_prepare_permission.sql' }
      ]
    };
    await writeFile(manifestPath, JSON.stringify(manifestContent), 'utf8');

    const report = await reconcileMigrationsLedger(sqlPath, manifestPath);

    assert.equal(report.dbTotalApplied, 2);
    assert.equal(report.repoTotalFiles, 7);
    assert.equal(report.registeredWithoutFile.length, 0);
    assert.equal(report.isFullyTracked, true);

    // Deve relatar exatamente os 2 arquivos pendentes físicos
    assert.equal(report.filesNotAppliedInDb.length, 2);
    assert.deepEqual(
      report.filesNotAppliedInDb.map(f => f.filename),
      [
        '20261020160000_add_whatsapp_group_link_to_industrias.sql',
        '20261020163000_mk9_faltas_atestados_prepare_permission.sql'
      ]
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseMigrationHistoryData: parses COPY and INSERT statements accurately', () => {
  const sql = `
INSERT INTO supabase_migrations.schema_migrations (version, statements, name) VALUES ('20261006', '{"test"}', 'migration');
COPY supabase_migrations.schema_migrations (version, statements, name) FROM stdin;
20261007\t{s1}\tn1
20261008\t{s2}\tn2
\\.
`;
  const versions = parseMigrationHistoryData(sql);
  assert.deepEqual(versions, ['20261006', '20261007', '20261008']);
});
