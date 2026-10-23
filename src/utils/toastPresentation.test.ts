import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getToastPresentation } from './toastPresentation';

test('error toasts use an error icon and red treatment', () => {
  assert.deepEqual(getToastPresentation('error'), {
    icon: 'error',
    iconClass: 'bg-red-50 text-red-700 border-red-200'
  });
});

test('success, warning, and info toasts retain distinct visual treatments', () => {
  assert.equal(getToastPresentation('success').icon, 'done');
  assert.match(getToastPresentation('warning').iconClass, /amber/);
  assert.match(getToastPresentation('info').iconClass, /cyan/);
});
