import React, { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'mk9_pwa_dismissed';
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // Lembrar dispensa por 7 dias

export const PWAInstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSPrompt, setShowIOSPrompt] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Verificar se já foi dispensado recentemente no localStorage
    try {
      const dismissedTimestamp = localStorage.getItem(DISMISS_KEY);
      if (dismissedTimestamp) {
        const timeElapsed = Date.now() - parseInt(dismissedTimestamp, 10);
        if (timeElapsed < DISMISS_DURATION_MS) {
          setDismissed(true);
          return;
        }
      }
    } catch {
      // LocalStorage pode falhar em ambientes com restrição de cookies
    }

    // Verificar se já está rodando em modo standalone (PWA instalado)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    if (isStandalone) {
      return;
    }

    // Handler para evento nativo no Android / Desktop Chromium
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setShowIOSPrompt(false);
      try {
        localStorage.setItem(DISMISS_KEY, Date.now().toString());
      } catch {
        // Ignora
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    // Detectar iOS Safari para instrução manual
    const ua = window.navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);

    if (isIOS && isSafari && !isStandalone) {
      setShowIOSPrompt(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
      try {
        localStorage.setItem(DISMISS_KEY, Date.now().toString());
      } catch {
        // Ignora
      }
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, Date.now().toString());
    } catch {
      // Ignora
    }
  };

  if (dismissed) return null;

  // Prompt nativo para Android / Chrome Desktop
  if (deferredPrompt) {
    return (
      <aside
        aria-label="Instalação do Aplicativo"
        className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-md z-40 bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl shadow-2xl p-4 animate-slideUp backdrop-blur-md"
      >
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#111114] border border-[#2D2D30] flex items-center justify-center font-bold text-white shadow-md shrink-0">
            <span className="text-xs font-mono font-extrabold tracking-wider text-[#F3F2EE]">MK9</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-[#171717] tracking-tight">Instale o MK9 Date</h4>
              <button
                onClick={handleDismiss}
                className="text-[#737373] hover:text-[#171717] p-1 rounded-lg transition-colors cursor-pointer shrink-0"
                aria-label="Fechar aviso"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <p className="text-xs text-[#525252] mt-0.5 leading-snug">
              Acesse suas rotas, visitas e atividades diretamente pela tela inicial do celular.
            </p>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={handleInstallClick}
                className="px-3.5 py-2 rounded-xl bg-[#111114] hover:bg-black text-[#F3F2EE] text-xs font-bold transition-all flex items-center gap-1.5 shadow-md active:scale-95 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">download</span>
                <span>Instalar aplicativo</span>
              </button>
              <button
                onClick={handleDismiss}
                className="px-3 py-2 rounded-xl text-[#737373] hover:text-[#171717] text-xs font-medium transition-colors cursor-pointer"
              >
                Agora não
              </button>
            </div>
          </div>
        </div>
      </aside>
    );
  }

  // Instrução para iOS Safari
  if (showIOSPrompt) {
    return (
      <aside
        aria-label="Instalação do Aplicativo iOS"
        className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-md z-40 bg-[#F7F6F2] border border-[#CFCDC5] rounded-2xl shadow-2xl p-4 animate-slideUp backdrop-blur-md"
      >
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#111114] border border-[#2D2D30] flex items-center justify-center font-bold text-white shadow-md shrink-0">
            <span className="text-xs font-mono font-extrabold tracking-wider text-[#F3F2EE]">MK9</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-[#171717] tracking-tight">Instale o MK9 Date</h4>
              <button
                onClick={handleDismiss}
                className="text-[#737373] hover:text-[#171717] p-1 rounded-lg transition-colors cursor-pointer shrink-0"
                aria-label="Fechar aviso"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <p className="text-xs text-[#525252] mt-0.5 leading-snug">
              Acesse suas rotas, visitas e atividades diretamente pela tela inicial do celular.
            </p>
            <div className="mt-2.5 p-2 bg-[#EAE8E2] border border-[#CFCDC5] rounded-xl text-[11px] text-[#333333] leading-relaxed">
              Toque no ícone de <strong className="text-[#111114]">Compartilhar</strong> <span className="inline-block border border-[#CFCDC5] bg-white rounded px-1 font-mono text-[10px]">⎋</span> e selecione <strong className="text-[#111114]">&ldquo;Adicionar à Tela de Início&rdquo;</strong>.
            </div>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={handleDismiss}
                className="px-3.5 py-1.5 rounded-xl bg-[#111114] hover:bg-black text-[#F3F2EE] text-xs font-bold transition-all active:scale-95 cursor-pointer"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      </aside>
    );
  }

  return null;
};
