import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

/**
 * A política do service worker (`public/sw-policy.js`, T-403) é JavaScript puro carregado no
 * worker por `importScripts`; aqui entra por `require`. O worker em si (`public/sw.js`) só
 * executa o que a política decide, e é verificado no navegador, em build de produção.
 */
type Policy = {
  VERSION: string;
  MAX_ENTRIES: { pages: number; api: number; static: number };
  MAX_AGE_MS: number;
  isFreshEnough: (cachedAtIso: string | null, nowMs: number) => boolean;
  cacheNames: (version?: string) => { pages: string; api: string; static: string };
  isAppCache: (name: string) => boolean;
  staleCaches: (names: string[], version?: string) => string[];
  appCaches: (names: string[]) => string[];
  isSensitivePath: (pathname: string) => boolean;
  isLogoutPath: (pathname: string) => boolean;
  classifyRequest: (input: {
    method: string;
    url: string;
    origin: string;
    headers?: { rsc?: boolean; prefetch?: boolean };
  }) => 'static' | 'page' | 'api' | null;
  cacheKey: (url: string, rsc: boolean) => string;
  isCacheableResponse: (response: { ok: boolean; status: number; redirected: boolean; type: string } | null) => boolean;
  isSessionEnded: (
    requestPathname: string,
    response: { type?: string; redirected?: boolean; url?: string } | null,
  ) => boolean;
  keysToTrim: (keys: string[], max: number) => string[];
  fallbackKind: (classification: string) => 'html' | 'json';
};

// O pacote é ESM (`type: module`), então o arquivo não exporta nada por `module.exports`: como no worker
// (`self.SwPolicy`), ele se publica no objeto global. Carregar o arquivo é o que o coloca lá.
createRequire(import.meta.url)('../../public/sw-policy.js');
const policy = (globalThis as unknown as { SwPolicy: Policy }).SwPolicy;
const ORIGIN = 'https://appfin.example';

function classify(path: string, extra: { method?: string; origin?: string; rsc?: boolean; prefetch?: boolean } = {}) {
  return policy.classifyRequest({
    method: extra.method ?? 'GET',
    url: `${extra.origin ?? ORIGIN}${path}`,
    origin: ORIGIN,
    headers: { rsc: extra.rsc ?? false, prefetch: extra.prefetch ?? false },
  });
}

describe('o que o worker cacheia', () => {
  it('páginas do app e GET /api/* são rede primeiro (page / api)', () => {
    expect(classify('/')).toBe('page');
    expect(classify('/lancamentos?from=2026-10-01')).toBe('page');
    expect(classify('/orcamento/recorrentes')).toBe('page');
    expect(classify('/api/transactions?from=2026-10-01')).toBe('api');
    expect(classify('/api/budgets')).toBe('api');
  });

  it('arquivos com hash, ícones e manifest são cache primeiro (static)', () => {
    expect(classify('/_next/static/chunks/main-abc123.js')).toBe('static');
    expect(classify('/icons/icon-192.png')).toBe('static');
    expect(classify('/manifest.webmanifest')).toBe('static');
  });

  it('NUNCA gravação: POST, PUT, PATCH e DELETE passam direto', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(classify('/api/transactions', { method })).toBeNull();
      expect(classify('/lancamentos', { method })).toBeNull();
    }
  });

  it('NUNCA /api/auth/**, /api/backup/** (o arquivo com tudo da casa) nem a tela de login', () => {
    expect(classify('/api/auth/session')).toBeNull();
    expect(classify('/api/auth/signout')).toBeNull();
    expect(classify('/api/auth/callback/email')).toBeNull();
    expect(classify('/api/backup')).toBeNull();
    expect(classify('/api/backup?format=csv')).toBeNull();
    expect(classify('/api/backup/restore')).toBeNull();
    expect(classify('/login')).toBeNull();
  });

  it('prefixo parecido não vira exceção por engano: /api/backupx e /api/authors seguem a regra normal', () => {
    expect(policy.isSensitivePath('/api/backupx')).toBe(false);
    expect(policy.isSensitivePath('/api/authors')).toBe(false);
    expect(policy.isSensitivePath('/api/auth')).toBe(true);
    expect(policy.isSensitivePath('/api/backup')).toBe(true);
  });

  it('só o próprio domínio: outra origem passa direto', () => {
    expect(classify('/api/transactions', { origin: 'https://outro.example' })).toBeNull();
    expect(classify('/', { origin: 'https://outro.example' })).toBeNull();
  });

  it('prefetch do Next (carga parcial) e demais /_next/ não são cacheados', () => {
    expect(classify('/lancamentos', { prefetch: true })).toBeNull();
    expect(classify('/_next/image?url=x')).toBeNull();
    expect(classify('/_next/webpack-hmr')).toBeNull();
  });

  it('só resposta 200, básica e sem redirecionamento é guardada', () => {
    const ok = { ok: true, status: 200, redirected: false, type: 'basic' };
    expect(policy.isCacheableResponse(ok)).toBe(true);
    expect(policy.isCacheableResponse({ ...ok, redirected: true })).toBe(false);
    expect(policy.isCacheableResponse({ ...ok, status: 404, ok: false })).toBe(false);
    expect(policy.isCacheableResponse({ ...ok, status: 206 })).toBe(false);
    expect(policy.isCacheableResponse({ ...ok, type: 'opaque' })).toBe(false);
    expect(policy.isCacheableResponse({ ...ok, type: 'cors' })).toBe(false);
    expect(policy.isCacheableResponse(null)).toBe(false);
  });

  it('HTML e payload RSC da mesma URL têm chaves de cache diferentes', () => {
    const url = `${ORIGIN}/lancamentos`;
    expect(policy.cacheKey(url, false)).toBe(url);
    expect(policy.cacheKey(url, true)).not.toBe(url);
    expect(policy.cacheKey(`${url}?a=1`, true)).toBe(`${url}?a=1&__sw=rsc`);
    expect(policy.cacheKey(url, true)).toBe(`${url}?__sw=rsc`);
  });
});

describe('versão e limpeza', () => {
  it('nome de cache por versão, com o prefixo do app', () => {
    expect(policy.cacheNames('v7')).toEqual({
      pages: 'appfin-pages-v7',
      api: 'appfin-api-v7',
      static: 'appfin-static-v7',
    });
    expect(policy.cacheNames().pages).toBe(`appfin-pages-${policy.VERSION}`);
  });

  it('a ativação apaga só os caches do app de versão antiga e nunca os de outros', () => {
    const names = [
      'appfin-pages-v0',
      'appfin-api-v0',
      `appfin-pages-${policy.VERSION}`,
      `appfin-api-${policy.VERSION}`,
      `appfin-static-${policy.VERSION}`,
      'outra-coisa',
      'workbox-precache',
    ];
    expect(policy.staleCaches(names)).toEqual(['appfin-pages-v0', 'appfin-api-v0']);
  });

  it('o logout apaga TODOS os caches do app (de qualquer versão) e nenhum alheio', () => {
    const names = ['appfin-pages-v0', `appfin-api-${policy.VERSION}`, 'outra-coisa'];
    expect(policy.appCaches(names)).toEqual(['appfin-pages-v0', `appfin-api-${policy.VERSION}`]);
    expect(policy.isAppCache('outra-coisa')).toBe(false);
  });

  it('o pedido de saída da conta é reconhecido (página e POST do Auth.js)', () => {
    expect(policy.isLogoutPath('/api/auth/signout')).toBe(true);
    expect(policy.isLogoutPath('/api/auth/signout/')).toBe(true);
    expect(policy.isLogoutPath('/api/auth/session')).toBe(false);
    expect(policy.isLogoutPath('/api/auth/signin')).toBe(false);
    expect(policy.isLogoutPath('/lancamentos')).toBe(false);
  });

  it('sessão que acabou: redirecionamento para /login numa página do app apaga o cache', () => {
    expect(policy.isSessionEnded('/lancamentos', { redirected: true, url: `${ORIGIN}/login` })).toBe(true);
    // Navegação: redirect manual chega opaco e o destino não é legível.
    expect(policy.isSessionEnded('/', { type: 'opaqueredirect' })).toBe(true);
    // O próprio /login nunca conta, e resposta comum também não.
    expect(policy.isSessionEnded('/login', { redirected: true, url: `${ORIGIN}/login` })).toBe(false);
    expect(policy.isSessionEnded('/login', { type: 'opaqueredirect' })).toBe(false);
    expect(policy.isSessionEnded('/lancamentos', { redirected: false, url: `${ORIGIN}/lancamentos` })).toBe(false);
    expect(policy.isSessionEnded('/lancamentos', { redirected: true, url: `${ORIGIN}/outra` })).toBe(false);
    expect(policy.isSessionEnded('/lancamentos', null)).toBe(false);
  });

  it('o cache não cresce sem fim: remove as mais antigas além do teto', () => {
    expect(policy.keysToTrim(['a', 'b', 'c'], 3)).toEqual([]);
    expect(policy.keysToTrim(['a', 'b', 'c', 'd', 'e'], 3)).toEqual(['a', 'b']);
    expect(policy.MAX_ENTRIES.pages).toBeGreaterThan(0);
  });
});

describe('validade do que se serve offline', () => {
  const cachedAt = '2026-10-03T12:00:00.000Z';
  const base = Date.parse(cachedAt);

  it('até 24 horas serve; passou disso não serve (aparelho esquecido não mostra a casa para sempre)', () => {
    expect(policy.MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
    expect(policy.isFreshEnough(cachedAt, base)).toBe(true);
    expect(policy.isFreshEnough(cachedAt, base + policy.MAX_AGE_MS)).toBe(true);
    expect(policy.isFreshEnough(cachedAt, base + policy.MAX_AGE_MS + 1)).toBe(false);
  });

  it('sem data válida (ou data no futuro) não serve: na dúvida, apaga', () => {
    expect(policy.isFreshEnough(null, base)).toBe(false);
    expect(policy.isFreshEnough('', base)).toBe(false);
    expect(policy.isFreshEnough('lixo', base)).toBe(false);
    expect(policy.isFreshEnough(cachedAt, base - 1000)).toBe(false);
  });
});

describe('offline: sem rede e sem cache', () => {
  it('tela vira HTML explicativo, API vira JSON', () => {
    expect(policy.fallbackKind('page')).toBe('html');
    expect(policy.fallbackKind('api')).toBe('json');
  });
});
