import React, { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export const PWAInstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSPrompt, setShowIOSPrompt] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check if dismissed in this session
    const isDismissed = sessionStorage.getItem('mk9_pwa_install_dismissed');
    if (isDismissed) {
      setDismissed(true);
      return;
    }

    // Check if already in standalone mode
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    if (isStandalone) {
      return;
    }

    // Handler for Android / Desktop Chromium beforeinstallprompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Detect iOS Safari
    const ua = window.navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);

    if (isIOS && isSafari && !isStandalone) {
      setShowIOSPrompt(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('mk9_pwa_install_dismissed', 'true');
  };

  if (dismissed) return null;

  // Render Android / Chrome prompt
  if (deferredPrompt) {
    return (
      <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-sm z-50 bg-[#171b26] border border-purple-500/40 rounded-xl shadow-2xl p-4 animate-slideUp">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center font-bold text-white shadow-md shrink-0">
            <span className="text-xs font-mono font-extrabold">MK9</span>
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-xs font-bold text-white tracking-wide">Instalar aplicativo MK9</h4>
            <p className="text-[11px] text-slate-300 mt-0.5 leading-tight">
              Instale na sua tela inicial para acesso rápido e melhor experiência em campo.
            </p>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={handleInstallClick}
                className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-colors flex items-center gap-1.5 shadow-md"
              >
                <span className="material-symbols-outlined text-[16px]">download</span>
                <span>Instalar</span>
              </button>
              <button
                onClick={handleDismiss}
                className="px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 text-xs font-medium transition-colors"
              >
                Agora não
              </button>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="text-slate-500 hover:text-slate-300 p-1 rounded shrink-0"
            aria-label="Fechar"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      </div>
    );
  }

  // Render iOS Safari instruction prompt
  if (showIOSPrompt) {
    return (
      <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-sm z-50 bg-[#171b26] border border-cyan-500/40 rounded-xl shadow-2xl p-4 animate-slideUp">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-tr from-cyan-600 to-blue-500 flex items-center justify-center font-bold text-white shadow-md shrink-0">
            <span className="text-xs font-mono font-extrabold">MK9</span>
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-xs font-bold text-white tracking-wide">Instalar MK9 no iOS</h4>
            <p className="text-[11px] text-slate-300 mt-1 leading-normal">
              Para instalar: toque no ícone de <span className="text-cyan-400 font-bold">Compartilhar</span> <span className="inline-block border border-slate-600 rounded px-1 text-[10px]">⎋</span> e selecione <span className="text-cyan-400 font-bold">'Adicionar à Tela de Início'</span>.
            </p>
            <button
              onClick={handleDismiss}
              className="mt-2.5 px-3 py-1 rounded bg-[#1e2433] hover:bg-[#283044] text-slate-300 text-[11px] font-bold transition-colors"
            >
              Entendido
            </button>
          </div>
          <button
            onClick={handleDismiss}
            className="text-slate-500 hover:text-slate-300 p-1 rounded shrink-0"
            aria-label="Fechar"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      </div>
    );
  }

  return null;
};
