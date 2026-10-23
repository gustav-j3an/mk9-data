import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_PROMOTER_PORTAL_VIEW_STATE,
  getPromoterPortalViewStateKey,
  readPromoterPortalViewState,
  writePromoterPortalViewState,
  type ViewStateStorage
} from './promoterPortalViewState';

function memoryStorage(initial: Record<string, string> = {}): ViewStateStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => { values.set(key, value); }
  };
}

test('portal presentation state is isolated by signed-in user', () => {
  assert.notEqual(getPromoterPortalViewStateKey('user-a'), getPromoterPortalViewStateKey('user-b'));
  assert.equal(getPromoterPortalViewStateKey(null), null);
});

test('portal presentation state restores the selected tab, week and filters', () => {
  const storage = memoryStorage();
  const key = getPromoterPortalViewStateKey('user-a');
  const state = {
    appointmentsTab: 'history' as const,
    isWeekHistoryOpen: true,
    weekOffset: -1,
    selectedDayDateStr: '2026-10-15',
    weekHistoryFilterMode: 'all' as const,
    statusFilter: 'concluida' as const
  };
  writePromoterPortalViewState(storage, key, state);
  assert.deepEqual(readPromoterPortalViewState(storage, key), state);
});

test('invalid or unavailable stored state falls back safely', () => {
  assert.deepEqual(readPromoterPortalViewState(null, 'key'), DEFAULT_PROMOTER_PORTAL_VIEW_STATE);
  assert.deepEqual(readPromoterPortalViewState(memoryStorage({ key: '{broken' }), 'key'), DEFAULT_PROMOTER_PORTAL_VIEW_STATE);
  const unsafe = memoryStorage({ key: JSON.stringify({ appointmentsTab: 'history', weekOffset: 999, selectedDayDateStr: 'bad', statusFilter: 'injected' }) });
  assert.deepEqual(readPromoterPortalViewState(unsafe, 'key'), { ...DEFAULT_PROMOTER_PORTAL_VIEW_STATE, appointmentsTab: 'history' });
});
