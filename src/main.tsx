import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

// Registro Seguro do Service Worker PWA em Produção / Produção Web
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        console.log('[PWA] ServiceWorker registrado com sucesso no escopo:', registration.scope);
        void registration.update().catch((err) => {
          console.warn('[PWA] Falha ao verificar atualizações:', err);
        });

        // Verificar atualizações de nova versão do PWA sem interromper visitas ativas
        registration.onupdatefound = () => {
          const installingWorker = registration.installing;
          if (installingWorker) {
            installingWorker.onstatechange = () => {
              if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[PWA] Nova versão do MK9 Date disponível. O app será atualizado na próxima inicialização.');
              }
            };
          }
        };
      })
      .catch((err) => {
        console.warn('[PWA] Falha no registro do ServiceWorker:', err);
      });
  });
}

