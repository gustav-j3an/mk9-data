import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const appDir = process.env.RC1_APP_DIR || resolve(process.cwd(), 'app-under-test');
const { getWeeklyPromoterMetricCounts } = await import(pathToFileURL(
  resolve(appDir, 'src/utils/promoterPortalPresentation.ts')
).href);

test('M37 recovered RC1 occurrence is counted once as completed', () => {
  const recoveredOccurrence = {
    dataStr: '2026-11-09',
    status: 'concluida',
    isPastOverdue: false,
    visitObj: { regularization_status: null }
  };

  assert.deepEqual(getWeeklyPromoterMetricCounts([recoveredOccurrence]), {
    scheduled: 0,
    completed: 1,
    inProgress: 0,
    notDone: 0,
    automaticallyClosed: 0
  });
});
