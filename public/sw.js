/* Service worker do app instalável. Só acelera arquivos estáticos e mostra uma tela offline;
   chamadas da API e uploads nunca passam pelo cache (reservas e pagamentos precisam de dados atuais). */
const VERSION = 'v2'; // v2: descarta caches que guardaram a página inicial no lugar de um arquivo que sumiu
const STATIC = `static-${VERSION}`;
const SHELL = `shell-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.add('/offline.html')).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;

  // Páginas: sempre da rede; sem internet, mostra a tela offline.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }

  // Arquivos do app (JS/CSS com hash, imagens, ícones): usa o cache e atualiza em segundo plano.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const cached = await cache.match(req);
        const fresh = fetch(req).then((res) => {
          // Só guarda arquivo de verdade: se o servidor devolveu uma página HTML no lugar (arquivo removido
          // por uma atualização), isso não pode ficar no cache, senão a tela fica em branco para sempre.
          const type = res.headers.get('content-type') || '';
          if (res.ok && !type.includes('text/html')) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || fresh;
      }),
    );
  }
});
