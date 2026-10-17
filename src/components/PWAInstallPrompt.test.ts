import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { PWA_INSTALLED_KEY, PWA_DISMISSED_SESSION_KEY } from './PWAInstallPrompt';

// Mock storage helper for test simulation
class StorageMock {
  private store: Record<string, string> = {};

  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = value;
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  clear(): void {
    this.store = {};
  }
}

/**
 * Funções que encapsulam a lógica pura de decisão de exibição do PWAInstallPrompt
 */
export function shouldShowPWAPrompt({
  isStandalone,
  localStorageMock,
  sessionStorageMock,
  hasActiveVisit,
  hasNativePrompt,
  isIOS,
  isSafari
}: {
  isStandalone: boolean;
  localStorageMock: StorageMock;
  sessionStorageMock: StorageMock;
  hasActiveVisit: boolean;
  hasNativePrompt: boolean;
  isIOS: boolean;
  isSafari: boolean;
}): boolean {
  // 1. Já instalado no dispositivo via localStorage
  if (localStorageMock.getItem(PWA_INSTALLED_KEY) === 'true') {
    return false;
  }

  // 2. Rodando atualmente em modo standalone
  if (isStandalone) {
    return false;
  }

  // 3. Dispensado na sessão corrente ("Agora não" ou fechar)
  if (sessionStorageMock.getItem(PWA_DISMISSED_SESSION_KEY) === 'true') {
    return false;
  }

  // 4. Momento crítico de preenchimento de visita pelo promotor
  if (hasActiveVisit) {
    return false;
  }

  // 5. Suporte de browser disponível (Android/Desktop com evento nativo ou iOS Safari)
  const isEligiblePlatform = hasNativePrompt || (isIOS && isSafari);
  return isEligiblePlatform;
}

describe('PWAInstallPrompt — Regras de Reexibição e Instalação', () => {
  let localStore: StorageMock;
  let sessionStore: StorageMock;

  beforeEach(() => {
    localStore = new StorageMock();
    sessionStore = new StorageMock();
  });

  it('1. Deve exibir o prompt quando o app não estiver instalado e houver suporte', () => {
    const shouldShow = shouldShowPWAPrompt({
      isStandalone: false,
      localStorageMock: localStore,
      sessionStorageMock: sessionStore,
      hasActiveVisit: false,
      hasNativePrompt: true,
      isIOS: false,
      isSafari: false
    });

    assert.strictEqual(shouldShow, true);
  });

  it('2. Ao dispensar ("Agora não"), deve ocultar na sessão atual', () => {
    // Simula clique em dispensar gravando na sessionStorage
    sessionStore.setItem(PWA_DISMISSED_SESSION_KEY, 'true');

    const shouldShow = shouldShowPWAPrompt({
      isStandalone: false,
      localStorageMock: localStore,
      sessionStorageMock: sessionStore,
      hasActiveVisit: false,
      hasNativePrompt: true,
      isIOS: false,
      isSafari: false
    });

    assert.strictEqual(shouldShow, false);
  });

  it('3. Em uma nova sessão (sessionStorage limpa), volta a exibir se não instalado', () => {
    // Simula nova sessão: sessionStorage é naturalmente resetada pelo browser
    sessionStore.clear();

    const shouldShow = shouldShowPWAPrompt({
      isStandalone: false,
      localStorageMock: localStore,
      sessionStorageMock: sessionStore,
      hasActiveVisit: false,
      hasNativePrompt: true,
      isIOS: false,
      isSafari: false
    });

    assert.strictEqual(shouldShow, true);
  });

  it('4. Após a instalação (appinstalled ou standalone), NUNCA mais volta a exibir', () => {
    // Registra instalação definitiva no localStorage
    localStore.setItem(PWA_INSTALLED_KEY, 'true');

    const shouldShowEvenInNewSession = shouldShowPWAPrompt({
      isStandalone: false,
      localStorageMock: localStore,
      sessionStorageMock: sessionStore, // nova sessão limpa
      hasActiveVisit: false,
      hasNativePrompt: true,
      isIOS: false,
      isSafari: false
    });

    assert.strictEqual(shouldShowEvenInNewSession, false);
  });

  it('5. Não deve exibir quando já estiver rodando em standalone', () => {
    const shouldShow = shouldShowPWAPrompt({
      isStandalone: true,
      localStorageMock: localStore,
      sessionStorageMock: sessionStore,
      hasActiveVisit: false,
      hasNativePrompt: true,
      isIOS: false,
      isSafari: false
    });

    assert.strictEqual(shouldShow, false);
  });

  it('6. Não deve exibir em momento crítico de preenchimento de visita do promotor', () => {
    const shouldShow = shouldShowPWAPrompt({
      isStandalone: false,
      localStorageMock: localStore,
      sessionStorageMock: sessionStore,
      hasActiveVisit: true, // Visita ativa sendo preenchida
      hasNativePrompt: true,
      isIOS: false,
      isSafari: false
    });

    assert.strictEqual(shouldShow, false);
  });

  it('7. No iOS Safari sem standalone, exibe as instruções manuais', () => {
    const shouldShow = shouldShowPWAPrompt({
      isStandalone: false,
      localStorageMock: localStore,
      sessionStorageMock: sessionStore,
      hasActiveVisit: false,
      hasNativePrompt: false,
      isIOS: true,
      isSafari: true
    });

    assert.strictEqual(shouldShow, true);
  });
});

