import { describe, expect, it } from 'vitest';

import {
  bannerText,
  blocksWrite,
  formatCachedAt,
  INITIAL_OFFLINE_STATE,
  parseWorkerMessage,
  reduceOffline,
  type OfflineState,
} from './offline-state';

const CACHED = '2026-10-03T17:32:10.000Z';

describe('estado da faixa de offline', () => {
  it('começa sem faixa', () => {
    expect(bannerText(INITIAL_OFFLINE_STATE)).toBeNull();
  });

  it('servido do cache: faixa com a data e hora do dado, no horário de São Paulo', () => {
    const state = reduceOffline(INITIAL_OFFLINE_STATE, { type: 'served-from-cache', cachedAt: CACHED });
    expect(state).toEqual({ offline: true, cachedAt: CACHED, reconnected: false });
    expect(bannerText(state)).toBe('Sem conexão — mostrando os dados de 03/10/2026 14:32. Gravar exige internet.');
  });

  it('sem data conhecida, a faixa não inventa uma', () => {
    const state = reduceOffline(INITIAL_OFFLINE_STATE, { type: 'served-from-cache', cachedAt: null });
    expect(bannerText(state)).toBe('Sem conexão — mostrando os últimos dados carregados. Gravar exige internet.');
    expect(bannerText({ ...state, cachedAt: 'lixo' })).toBe(bannerText(state));
  });

  it('o navegador ficou offline: faixa; voltou: oferece recarregar (a tela ainda é a guardada)', () => {
    const offline = reduceOffline(INITIAL_OFFLINE_STATE, { type: 'went-offline' });
    expect(bannerText(offline)).toMatch(/^Sem conexão/);
    const back = reduceOffline(offline, { type: 'went-online' });
    expect(back).toEqual({ offline: false, cachedAt: null, reconnected: true });
    expect(bannerText(back)).toBe('A conexão voltou. Recarregue para ver os dados atuais.');
  });

  it('voltar online sem ter estado offline não mostra nada', () => {
    expect(reduceOffline(INITIAL_OFFLINE_STATE, { type: 'went-online' })).toBe(INITIAL_OFFLINE_STATE);
  });

  it('a resposta de status do worker só liga a faixa quando a página veio do cache', () => {
    expect(reduceOffline(INITIAL_OFFLINE_STATE, { type: 'status', fromCache: false, cachedAt: CACHED })).toBe(
      INITIAL_OFFLINE_STATE,
    );
    expect(reduceOffline(INITIAL_OFFLINE_STATE, { type: 'status', fromCache: true, cachedAt: CACHED }).offline).toBe(true);
  });

  it('logout (cache apagado): volta ao zero, sem faixa e sem data', () => {
    const state: OfflineState = { offline: true, cachedAt: CACHED, reconnected: false };
    const cleared = reduceOffline(state, { type: 'cache-cleared' });
    expect(cleared).toEqual(INITIAL_OFFLINE_STATE);
    expect(bannerText(cleared)).toBeNull();
  });

  it('formata data inválida ou vazia como null', () => {
    expect(formatCachedAt(null)).toBeNull();
    expect(formatCachedAt('')).toBeNull();
    expect(formatCachedAt('lixo')).toBeNull();
    expect(formatCachedAt('2026-10-04T01:05:00.000Z')).toBe('03/10/2026 22:05');
  });
});

describe('gravar exige internet', () => {
  it('sem rede, POST/PUT/PATCH/DELETE são barrados (em qualquer caixa); leitura segue', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'delete']) {
      expect(blocksWrite(method, false)).toBe(true);
      expect(blocksWrite(method, true)).toBe(false);
    }
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) {
      expect(blocksWrite(method, false)).toBe(false);
    }
  });
});

describe('mensagens do service worker', () => {
  it('reconhece as três mensagens do worker', () => {
    expect(parseWorkerMessage({ type: 'served-from-cache', path: '/', cachedAt: CACHED })).toEqual({
      type: 'served-from-cache',
      cachedAt: CACHED,
    });
    expect(parseWorkerMessage({ type: 'status', fromCache: true, cachedAt: CACHED })).toEqual({
      type: 'status',
      fromCache: true,
      cachedAt: CACHED,
    });
    expect(parseWorkerMessage({ type: 'cache-cleared', reason: 'logout' })).toEqual({ type: 'cache-cleared' });
  });

  it('ignora o que não conhece, sem lançar', () => {
    for (const bad of [null, undefined, 'texto', 3, {}, { type: 'outra' }, { type: 5 }]) {
      expect(parseWorkerMessage(bad)).toBeNull();
    }
    expect(parseWorkerMessage({ type: 'status', fromCache: 'sim', cachedAt: 7 })).toEqual({
      type: 'status',
      fromCache: false,
      cachedAt: null,
    });
  });
});
