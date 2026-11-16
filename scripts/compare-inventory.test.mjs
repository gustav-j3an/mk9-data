import test from 'node:test';
import assert from 'node:assert/strict';
import { assertInventoriesEqual } from './compare-inventory.mjs';

test('assertInventoriesEqual accepts variation exclusively in cron.job_run_details and cron.runid_seq', () => {
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
    ]
  };

  const after = {
    schemas: ['public', 'cron'],
    tables_and_row_counts: [
      { schema: 'public', table: 'visits', rows: 100, data_sha256: 'abc' },
      { schema: 'cron', table: 'job', rows: 1, data_sha256: 'job1' },
      { schema: 'cron', table: 'job_run_details', rows: 5250, data_sha256: 'new_digest' }
    ],
    sequences: [
      { schema: 'public', name: 'visits_id_seq', last_value: '10' },
      { schema: 'cron', name: 'runid_seq', last_value: '5250' }
    ]
  };

  // Deve passar sem lançar erro, pois apenas a telemetria do pg_cron divergiu
  assert.equal(assertInventoriesEqual(before, after), true);
});

test('assertInventoriesEqual fails when cron.job (job definitions) diverges', () => {
  const before = {
    tables_and_row_counts: [
      { schema: 'cron', table: 'job', rows: 1, data_sha256: 'job1' }
    ]
  };
  const after = {
    tables_and_row_counts: [
      { schema: 'cron', table: 'job', rows: 2, data_sha256: 'job2' }
    ]
  };
  assert.throws(() => assertInventoriesEqual(before, after), /DATABASE_INVENTORY_MISMATCH/);
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
