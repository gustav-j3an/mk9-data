import test from 'node:test';
import assert from 'node:assert/strict';
import { assertInventoriesEqual } from './compare-inventory.mjs';

test('assertInventoriesEqual accepts identical inventories', () => {
  const base = {
    schemas: ['public', 'auth'],
    tables_and_row_counts: [
      { schema: 'public', table: 'visitas', rows: 10, data_sha256: 'abc' },
      { schema: 'auth', table: 'users', rows: 5, data_sha256: 'def' }
    ],
    indexes: [
      { schema: 'public', table: 'visitas', name: 'visitas_pkey' }
    ]
  };
  assert.equal(assertInventoriesEqual(base, structuredClone(base)), true);
});

test('assertInventoriesEqual reconciles expected GoTrue auth index difference', () => {
  const source = {
    indexes: [
      { schema: 'public', table: 'visitas', name: 'visitas_pkey' }
    ]
  };
  const restored = {
    indexes: [
      { schema: 'public', table: 'visitas', name: 'visitas_pkey' },
      {
        schema: 'auth',
        table: 'one_time_tokens',
        name: 'one_time_tokens_link_token_hash_hash_idx',
        definition: 'CREATE INDEX one_time_tokens_link_token_hash_hash_idx ON auth.one_time_tokens USING hash (link_token_hash)'
      }
    ]
  };
  assert.equal(assertInventoriesEqual(source, restored), true);
});

test('assertInventoriesEqual reconciles auth.schema_migrations internal migration count variance', () => {
  const source = {
    tables_and_row_counts: [
      { schema: 'public', table: 'visitas', rows: 10, data_sha256: 'abc' },
      { schema: 'auth', table: 'schema_migrations', rows: 82, data_sha256: 'a3499f8d746b80f808404a05aea46916559675680bc503492a2373d9b77188af' }
    ]
  };
  const restored = {
    tables_and_row_counts: [
      { schema: 'public', table: 'visitas', rows: 10, data_sha256: 'abc' },
      { schema: 'auth', table: 'schema_migrations', rows: 84, data_sha256: 'a044716d2fac053f0c27a4b978453a130533990ffcf8dfa3ebd169ab2877a4da' }
    ]
  };
  assert.equal(assertInventoriesEqual(source, restored), true);
});

test('assertInventoriesEqual strictly rejects genuine table row count or data divergence', () => {
  const source = {
    tables_and_row_counts: [
      { schema: 'public', table: 'visitas', rows: 10, data_sha256: 'abc' }
    ]
  };
  const restored = {
    tables_and_row_counts: [
      { schema: 'public', table: 'visitas', rows: 9, data_sha256: 'diff' }
    ]
  };
  assert.throws(() => assertInventoriesEqual(source, restored), /DATABASE_INVENTORY_MISMATCH/);
});

test('assertInventoriesEqual strictly rejects user index divergence', () => {
  const source = {
    indexes: [
      { schema: 'public', table: 'visitas', name: 'visitas_pkey' }
    ]
  };
  const restored = {
    indexes: [
      { schema: 'public', table: 'visitas', name: 'visitas_pkey' },
      { schema: 'public', table: 'visitas', name: 'visitas_custom_idx' }
    ]
  };
  assert.throws(() => assertInventoriesEqual(source, restored), /DATABASE_INVENTORY_MISMATCH/);
});
