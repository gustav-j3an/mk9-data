import test from 'node:test';
import assert from 'node:assert/strict';
import { assertInventoriesEqual } from './compare-inventory.mjs';

test('assertInventoriesEqual accepts variation in pg_cron schema and objects in disposable secondary restore', () => {
  const before = {
    schemas: ['public', 'cron'],
    tables_and_row_counts: [
      { schema: 'public', table: 'visits', rows: 100, data_sha256: 'abc' },
      { schema: 'cron', table: 'job', rows: 1, data_sha256: 'job1' },
      { schema: 'cron', table: 'job_run_details', rows: 5247, data_sha256: 'old_digest' }
    ],
    sequences: [
      { schema: 'public', name: 'visits_id_seq', last_value: '10' },
      { schema: 'cron', name: 'runid_seq', last_value: '5247' }
    ],
    extensions: [
      { name: 'pg_cron', version: '1.6' },
      { name: 'pgcrypto', version: '1.3' }
    ]
  };

  const after = {
    schemas: ['public'],
    tables_and_row_counts: [
      { schema: 'public', table: 'visits', rows: 100, data_sha256: 'abc' }
    ],
    sequences: [
      { schema: 'public', name: 'visits_id_seq', last_value: '10' }
    ],
    extensions: [
      { name: 'pgcrypto', version: '1.3' }
    ]
  };

  assert.equal(assertInventoriesEqual(before, after), true);
});

test('assertInventoriesEqual fails when operational public table diverges', () => {
  const before = {
    tables_and_row_counts: [
      { schema: 'public', table: 'visits', rows: 100, data_sha256: 'abc' }
    ]
  };
  const after = {
    tables_and_row_counts: [
      { schema: 'public', table: 'visits', rows: 101, data_sha256: 'xyz' }
    ]
  };
  assert.throws(() => assertInventoriesEqual(before, after), /DATABASE_INVENTORY_MISMATCH/);
});

test('assertInventoriesEqual fails when operational sequence diverges', () => {
  const before = {
    sequences: [
      { schema: 'public', name: 'visits_id_seq', last_value: '10' }
    ]
  };
  const after = {
    sequences: [
      { schema: 'public', name: 'visits_id_seq', last_value: '11' }
    ]
  };
  assert.throws(() => assertInventoriesEqual(before, after), /DATABASE_INVENTORY_MISMATCH/);
});
