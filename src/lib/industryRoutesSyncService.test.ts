import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { unwrapIndustrySyncRpc } from './industryRoutesSyncService';

describe('industryRoutesSyncService - RPC fail-closed', () => {
  it('returns a confirmed RPC result', () => {
    const result = unwrapIndustrySyncRpc('inativação', { success: true, rotas_suspensas: 2 }, null);
    assert.equal(result.rotas_suspensas, 2);
  });

  it('throws when the RPC is unavailable or fails', () => {
    assert.throws(
      () => unwrapIndustrySyncRpc('reativação', null, { message: 'function not found' }),
      /function not found/
    );
  });

  it('throws when the RPC returns no result and no error', () => {
    assert.throws(
      () => unwrapIndustrySyncRpc('inativação', null, null),
      /não confirmou/
    );
  });

  it('throws when the RPC does not confirm success', () => {
    assert.throws(
      () => unwrapIndustrySyncRpc('reativação', { success: false }, null),
      /não confirmou/
    );
  });
});
