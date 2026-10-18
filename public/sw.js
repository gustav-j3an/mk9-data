// Service Worker MK9 Date
// Cache estático exclusivo para o Shell da aplicação e assets compilados.
// NENHUMA API PRIVADA OU DADO OPERACIONAL DO SUPABASE É CACHEADO.

const CACHE_NAME = 'mk9-date-shell-v3';

// Assets estáticos imutáveis / estáticos não-HTML
const STATIC_ASSETS = [
  '/manifest.json',
  '/icons/icon.svg'
];

// Instalação do Service Worker: Armazena apenas assets estáticos (sem bloquear com HTML antigo)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Caching App Shell static assets');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Ativação do Service Worker: Limpa versões de cache antigas se houver atualização
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache version:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Interceptador de Requisições (Fetch Event)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // REGRA DE SEGURANÇA ABSOLUTA:
  // 1. Ignorar qualquer requisição para o Supabase (API / Auth / REST / Storage)
  // 2. Nunca cachear requisições que não utilizem o método GET
  if (
    url.hostname.includes('supabase.co') ||
    url.pathname.startsWith('/rest/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/storage/') ||
    event.request.method !== 'GET'
  ) {
    // Passar direto para a rede sem passar pelo cache
    return;
  }

  // 1. ESTRATÉGIA NETWORK-FIRST PARA NAVEGAÇÃO E DOCUMENTOS HTML
  // Garante que / e /index.html venham sempre atualizados da rede (Vercel CDN).
  // Se offline, serve o último index.html salvo em cache como fallback seguro.
  const isHtmlNavigation =
    event.request.mode === 'navigate' ||
    event.request.destination === 'document' ||
    url.pathname === '/' ||
    url.pathname === '/index.html' ||
    url.pathname.endsWith('.html');

  if (isHtmlNavigation) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              // Armazena index.html para fallback offline caso a conexão caia posteriormente
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          // Fallback offline seguro para documentos HTML
          const cachedResponse = await caches.match(event.request);
          if (cachedResponse) {
            return cachedResponse;
          }
          const indexFallback = await caches.match('/index.html');
          if (indexFallback) {
            return indexFallback;
          }
          return new Response(
            '<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><title>MK9 Date - Offline</title></head><body><div style="font-family:sans-serif;padding:2rem;text-align:center;"><h2>Sem conexão com a internet</h2><p>Verifique sua conexão e tente novamente.</p></div></body></html>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
          );
        })
    );
    return;
  }

  // 2. ESTRATÉGIA STALE-WHILE-REVALIDATE PARA ASSETS ESTÁTICOS (JS, CSS, Fontes, Imagens)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          /* Falha de rede para asset: se houver cachedResponse será usado abaixo */
        });

      return cachedResponse || fetchPromise;
    })
  );
});
