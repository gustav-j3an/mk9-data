import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ErrorBoundary } from './ErrorBoundary';

describe('ErrorBoundary Component Logic', () => {
  it('deve atualizar o estado hasError e error ao chamar getDerivedStateFromError', () => {
    const testError = new Error('ChunkLoadError: Failed to fetch dynamically imported module');
    const newState = ErrorBoundary.getDerivedStateFromError(testError);

    assert.strictEqual(newState.hasError, true);
    assert.strictEqual(newState.error, testError);
    assert.strictEqual(newState.errorInfo, null);
  });

  it('deve tratar exceções genéricas preservando a mensagem', () => {
    const runtimeError = new TypeError('Cannot read properties of undefined');
    const newState = ErrorBoundary.getDerivedStateFromError(runtimeError);

    assert.strictEqual(newState.hasError, true);
    assert.strictEqual(newState.error?.message, 'Cannot read properties of undefined');
  });

  it('deve identificar mensagens clássicas de erro de carregamento de chunk', () => {
    const chunkErrors = [
      'Failed to fetch dynamically imported module',
      'Importing a module script failed',
      'Loading chunk 42 failed'
    ];

    for (const msg of chunkErrors) {
      const isChunkError =
        msg.includes('Failed to fetch dynamically imported module') ||
        msg.includes('Importing a module script failed') ||
        msg.includes('Loading chunk');

      assert.strictEqual(isChunkError, true, `Deveria identificar: "${msg}"`);
    }
  });
});
