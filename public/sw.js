/*
 * Service worker do APPFIN (T-403): leitura offline do ULTIMO estado carregado. Escrito a mao,
 * sem dependencia (decisao do Orquestrador). A politica (o que cacheia, nomes por versao, quando
 * apagar) esta em /sw-policy.js, testada; aqui so se executa.
 *
 * - paginas e GET /api/*: rede primeiro, cache de reserva (so o proprio dominio, so GET);
 * - /_next/static, icones e manifest: cache primeiro (arquivos com hash no nome);
 * - NUNCA: gravacao (POST/PUT/DELETE), /api/auth/**, /api/backup/**, tela de login;
 * - logout (ou sessao que acabou): APAGA todos os caches do app;
 * - nunca enfileira gravacao para depois.
 */
importScripts('/sw-policy.js');

var P = self.SwPolicy;
var NAMES = P.cacheNames();
var META_KEY = '/__sw/last-offline';

self.addEventListener('install', function (event) {
  // Versao nova assume na hora: sem "app velho preso" depois de um deploy.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    (async function () {
      var names = await caches.keys();
      await Promise.all(P.staleCaches(names).map(function (name) { return caches.delete(name); }));
      await self.clients.claim();
    })(),
  );
});

async function notifyClients(message) {
  var all = await self.clients.matchAll({ includeUncontrolled: true });
  all.forEach(function (client) { client.postMessage(message); });
}

/** Apaga TODOS os caches do app (logout, sessao encerrada, pedido da pagina). */
async function clearAll(reason) {
  var names = await caches.keys();
  await Promise.all(P.appCaches(names).map(function (name) { return caches.delete(name); }));
  await notifyClients({ type: 'cache-cleared', reason: reason });
}

async function trim(cache, max) {
  var keys = await cache.keys();
  var drop = P.keysToTrim(keys.map(function (request) { return request.url; }), max);
  await Promise.all(drop.map(function (url) { return cache.delete(url); }));
}

/** Guarda a resposta com o instante em que foi guardada (a faixa de offline o mostra). */
async function store(cacheName, key, response, max) {
  var headers = new Headers(response.headers);
  headers.set('x-sw-cached-at', new Date().toISOString());
  var copy = new Response(response.body, { status: response.status, statusText: response.statusText, headers: headers });
  var cache = await caches.open(cacheName);
  await cache.put(key, copy);
  await trim(cache, max);
}

async function cacheFirst(request) {
  var cache = await caches.open(NAMES.static);
  var hit = await cache.match(request.url);
  if (hit) return hit;
  var response = await fetch(request);
  if (P.isCacheableResponse(response)) {
    await store(NAMES.static, request.url, response.clone(), P.MAX_ENTRIES.static);
  }
  return response;
}

/** Pre-aquece no cache estatico os arquivos de /_next/static que o HTML referencia (melhor esforco). */
async function prewarmAssets(htmlResponse) {
  try {
    var html = await htmlResponse.text();
    var urls = P.extractStaticAssets(html, self.location.origin);
    var cache = await caches.open(NAMES.static);
    var missing = [];
    for (var i = 0; i < urls.length; i += 1) {
      if (!(await cache.match(urls[i]))) missing.push(urls[i]);
    }
    // Poucos de cada vez: nao disputa a banda da propria tela que esta abrindo.
    for (var j = 0; j < missing.length; j += 4) {
      await Promise.all(
        missing.slice(j, j + 4).map(async function (url) {
          try {
            var response = await fetch(url);
            if (P.isCacheableResponse(response)) await store(NAMES.static, url, response, P.MAX_ENTRIES.static);
          } catch {
            // Um arquivo que nao veio nao derruba os outros.
          }
        }),
      );
    }
  } catch {
    // Pre-aquecimento e so um bonus.
  }
}

function fallbackResponse(kind) {
  if (P.fallbackKind(kind) === 'json') {
    return new Response(JSON.stringify({ error: 'Sem conexão e sem dados guardados desta consulta.' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  var html =
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>APPFIN: sem conexão</title></head>' +
    '<body style="font-family:system-ui,sans-serif;padding:2rem;max-width:32rem;margin:auto">' +
    '<h1 style="font-size:1.25rem">Sem conexão</h1>' +
    '<p>Esta tela ainda não foi aberta neste aparelho, então não há dados guardados para mostrar.</p>' +
    '<p>Volte quando tiver internet.</p></body></html>';
  return new Response(html, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/** Servido do cache: avisa as telas abertas e deixa um recado para a que ainda esta carregando. */
async function announceCached(request, cached) {
  var cachedAt = cached.headers.get('x-sw-cached-at');
  var url = new URL(request.url);
  var path = url.pathname + url.search;
  var meta = new Response(JSON.stringify({ path: path, cachedAt: cachedAt, at: Date.now() }), {
    headers: { 'content-type': 'application/json' },
  });
  var cache = await caches.open(NAMES.pages);
  await cache.put(META_KEY, meta);
  await notifyClients({ type: 'served-from-cache', path: path, cachedAt: cachedAt });
}

async function networkFirst(event, request, kind) {
  var rsc = request.headers.get('rsc') === '1';
  var key = P.cacheKey(request.url, rsc);
  var cacheName = kind === 'api' ? NAMES.api : NAMES.pages;
  var max = kind === 'api' ? P.MAX_ENTRIES.api : P.MAX_ENTRIES.pages;
  var requestPath = new URL(request.url).pathname;

  async function fromCache() {
    var cache = await caches.open(cacheName);
    var hit = await cache.match(key);
    if (!hit) return undefined;
    // Vencido (24 horas): nao serve e apaga. Offline ninguem revela troca de dono do aparelho.
    if (!P.isFreshEnough(hit.headers.get('x-sw-cached-at'), Date.now())) {
      await cache.delete(key);
      return undefined;
    }
    return hit;
  }

  try {
    var response = await fetch(request);
    if (P.isSessionEnded(requestPath, response)) {
      event.waitUntil(clearAll('session-ended'));
      return response;
    }
    if (response.status >= 500) {
      var backup = await fromCache();
      if (backup) {
        event.waitUntil(announceCached(request, backup));
        return backup;
      }
      return response;
    }
    if (P.isCacheableResponse(response)) {
      event.waitUntil(store(cacheName, key, response.clone(), max));
      // HTML guardado precisa dos arquivos da rota tambem, senao offline cai em "Application
      // error". Em segundo plano e sem travar a resposta: se falhar, so perde o pre-aquecimento.
      if (kind === 'page' && !rsc && (response.headers.get('content-type') || '').indexOf('text/html') === 0) {
        event.waitUntil(prewarmAssets(response.clone()));
      }
    }
    return response;
  } catch {
    var cached = await fromCache();
    if (cached) {
      event.waitUntil(announceCached(request, cached));
      return cached;
    }
    return fallbackResponse(kind);
  }
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  var url = new URL(request.url);

  // Saida da conta (a pagina de confirmacao ou o POST do Auth.js): apaga o cache e deixa o
  // pedido seguir normal. Vale para qualquer metodo.
  if (url.origin === self.location.origin && P.isLogoutPath(url.pathname)) {
    event.waitUntil(clearAll('logout'));
    return;
  }

  var kind = P.classifyRequest({
    method: request.method,
    url: request.url,
    origin: self.location.origin,
    headers: { rsc: request.headers.get('rsc') === '1', prefetch: request.headers.has('next-router-prefetch') },
  });
  if (kind === null) return;

  if (kind === 'static') {
    event.respondWith(cacheFirst(request).catch(function () { return Response.error(); }));
  } else {
    event.respondWith(networkFirst(event, request, kind));
  }
});

self.addEventListener('message', function (event) {
  var data = event.data || {};
  if (data.type === 'clear') {
    event.waitUntil(clearAll('requested'));
    return;
  }
  if (data.type === 'status' && event.source) {
    event.waitUntil(
      (async function () {
        var cache = await caches.open(NAMES.pages);
        var hit = await cache.match(META_KEY);
        var meta = hit ? await hit.json() : null;
        var fresh = meta && meta.path === data.path && Date.now() - meta.at < 30000;
        event.source.postMessage({ type: 'status', fromCache: Boolean(fresh), cachedAt: fresh ? meta.cachedAt : null });
      })(),
    );
  }
});
