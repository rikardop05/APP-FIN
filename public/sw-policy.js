/*
 * Politica do service worker (T-403): TODA decisao que dá para isolar mora aqui, em funcoes
 * puras sobre dados simples (sem `fetch`, `caches` nem `self`), para o vitest testar. O
 * `public/sw.js` so executa. Carregado no worker por `importScripts('/sw-policy.js')` e nos
 * testes por `require`: por isso o formato UMD minimo no fim.
 *
 * Principios (decisoes do Orquestrador, handoff T-403):
 *  - cache so de LEITURA: so GET, so o proprio dominio, nunca gravacao;
 *  - nunca cachear /api/auth/**, /api/backup/** (o arquivo com tudo da casa) nem a tela de login;
 *  - logout (ou sessao que acabou) APAGA tudo: celular emprestado nao mostra as financas.
 */
(function (root) {
  'use strict';

  /** Sobe a cada mudanca de FORMATO do cache; ao ativar, o worker apaga os de versao antiga. */
  var VERSION = 'v1';
  var CACHE_PREFIX = 'appfin-';
  var LOGIN_PATH = '/login';
  var NEVER_CACHE_PREFIXES = ['/api/auth', '/api/backup'];
  /** Teto de entradas por cache: o app de 2 pessoas nao precisa de mais, e o cache nao cresce sem fim. */
  var MAX_ENTRIES = { pages: 60, api: 120, static: 250 };

  /**
   * Validade do que o cache entrega OFFLINE: 24 horas (decisao do Ricardo, 2026-10-03). Offline nenhum pedido revela que a conta
   * mudou de mao (so a rede dispara o apagamento do logout), entao o dado guardado nao fica para
   * sempre num aparelho esquecido. Passou disso, o worker nao serve (e apaga a entrada).
   */
  var MAX_AGE_MS = 24 * 60 * 60 * 1000;

  /** O dado guardado em `cachedAtIso` ainda pode ser servido em `nowMs`? Sem data valida: nao. */
  function isFreshEnough(cachedAtIso, nowMs) {
    if (typeof cachedAtIso !== 'string' || cachedAtIso === '') return false;
    var cachedMs = new Date(cachedAtIso).getTime();
    if (isNaN(cachedMs)) return false;
    var age = nowMs - cachedMs;
    return age >= 0 && age <= MAX_AGE_MS;
  }

  function cacheNames(version) {
    var v = version || VERSION;
    return {
      pages: CACHE_PREFIX + 'pages-' + v,
      api: CACHE_PREFIX + 'api-' + v,
      static: CACHE_PREFIX + 'static-' + v,
    };
  }

  function isAppCache(name) {
    return typeof name === 'string' && name.indexOf(CACHE_PREFIX) === 0;
  }

  /** Caches do app que NAO sao da versao corrente (a ativacao os apaga). Cache alheio nunca e tocado. */
  function staleCaches(names, version) {
    var current = cacheNames(version);
    var keep = [current.pages, current.api, current.static];
    return names.filter(function (name) {
      return isAppCache(name) && keep.indexOf(name) === -1;
    });
  }

  /** Todos os caches do app: o que o logout apaga. */
  function appCaches(names) {
    return names.filter(isAppCache);
  }

  function underPrefix(pathname, prefix) {
    return pathname === prefix || pathname.indexOf(prefix + '/') === 0;
  }

  /** Rota que jamais entra no cache: Auth.js, backup e a tela de login. */
  function isSensitivePath(pathname) {
    if (pathname === LOGIN_PATH) return true;
    return NEVER_CACHE_PREFIXES.some(function (prefix) {
      return underPrefix(pathname, prefix);
    });
  }

  /** Pedido de saida da conta (a pagina de confirmacao e o POST do Auth.js): o worker apaga o cache. */
  function isLogoutPath(pathname) {
    return underPrefix(pathname, '/api/auth/signout');
  }

  /**
   * Como tratar um pedido: 'static' (cache primeiro), 'page' ou 'api' (rede primeiro, cache de
   * reserva) ou null (o worker nao toca e o navegador segue normal).
   * Entrada: { method, url, origin, headers: { rsc, prefetch } }.
   */
  function classifyRequest(input) {
    if (input.method !== 'GET') return null;
    var url = new URL(input.url);
    if (url.origin !== input.origin) return null;
    var path = url.pathname;
    if (isSensitivePath(path)) return null;
    var headers = input.headers || {};
    // Prefetch do Next traz carga parcial de rota dinamica: cacheada, abriria uma tela pela metade.
    if (headers.prefetch) return null;
    if (path.indexOf('/_next/static/') === 0 || path.indexOf('/icons/') === 0) return 'static';
    if (path === '/manifest.webmanifest') return 'static';
    if (path.indexOf('/_next/') === 0) return null;
    if (underPrefix(path, '/api')) return 'api';
    return 'page';
  }

  /**
   * Chave do cache. O HTML de uma pagina e o payload RSC (navegacao do cliente) vivem na MESMA
   * URL e a Cache API casa por URL: sem chave propria um serviria o outro e a tela viraria texto cru.
   */
  function cacheKey(url, rsc) {
    if (!rsc) return url;
    return url + (url.indexOf('?') === -1 ? '?' : '&') + '__sw=rsc';
  }

  /** So resposta 200 do proprio dominio, sem redirecionamento, entra no cache. */
  function isCacheableResponse(response) {
    return Boolean(
      response &&
        response.ok &&
        response.status === 200 &&
        !response.redirected &&
        response.type === 'basic',
    );
  }

  /**
   * A sessao acabou? O middleware responde a um pedido sem sessao com redirecionamento para
   * /login. Se uma pagina do app volta redirecionada para o login, o que esta em cache e de uma
   * sessao que nao existe mais: o worker apaga tudo.
   */
  function isSessionEnded(requestPathname, response) {
    if (!response) return false;
    // Navegacao: o navegador pede com redirect "manual", entao o redirecionamento chega como
    // resposta opaca e o destino nao e legivel. O unico redirecionamento do middleware para
    // fora do login e o de "sem sessao -> /login", entao opaco numa pagina do app = sessao
    // acabou. (Falso positivo possivel: um redirect() de servidor; custa so o cache, nunca vaza.)
    if (response.type === 'opaqueredirect') return requestPathname !== LOGIN_PATH;
    if (!response.redirected || !response.url) return false;
    var finalPath = new URL(response.url).pathname;
    return finalPath === LOGIN_PATH && requestPathname !== LOGIN_PATH;
  }

  /** Chaves a remover para o cache nao passar de `max`: as mais antigas (a lista vem em ordem de insercao). */
  function keysToTrim(keys, max) {
    return keys.length <= max ? [] : keys.slice(0, keys.length - max);
  }

  /** Tipo do fallback quando nao ha rede NEM cache: 'html' para tela, 'json' para API. */
  function fallbackKind(classification) {
    return classification === 'api' ? 'json' : 'html';
  }

  var api = {
    VERSION: VERSION,
    CACHE_PREFIX: CACHE_PREFIX,
    LOGIN_PATH: LOGIN_PATH,
    MAX_ENTRIES: MAX_ENTRIES,
    MAX_AGE_MS: MAX_AGE_MS,
    isFreshEnough: isFreshEnough,
    cacheNames: cacheNames,
    isAppCache: isAppCache,
    staleCaches: staleCaches,
    appCaches: appCaches,
    isSensitivePath: isSensitivePath,
    isLogoutPath: isLogoutPath,
    classifyRequest: classifyRequest,
    cacheKey: cacheKey,
    isCacheableResponse: isCacheableResponse,
    isSessionEnded: isSessionEnded,
    keysToTrim: keysToTrim,
    fallbackKind: fallbackKind,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SwPolicy = api;
})(typeof self !== 'undefined' ? self : globalThis);
