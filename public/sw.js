// Service Worker MK9 Trade Marketing
// Cache estático exclusivo para o Shell da aplicação e assets compilados.
// NENHUMA API PRIVADA OU DADO OPERACIONAL DO SUPABASE É CACHEADO.

const CACHE_NAME = 'mk9-shell-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon.svg'
];

// Instalação do Service Worker: Armazena exclusivamente o App Shell em cache
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

  // Estratégia Stale-While-Revalidate segura apenas para JS, CSS e Fontes estáticas
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Atualizar cache em segundo plano para assets estáticos
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse.clone());
            });
          }
        }).catch(() => {/* Offline fallback se necessário */});

        return cachedResponse;
      }

      return fetch(event.request);
    })
  );
});
