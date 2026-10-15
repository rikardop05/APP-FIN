import { describe, expect, it } from 'vitest';

import { LOGIN_PATH, isCrossSiteMutation, isPublicPath, resolveRouteAccess } from './route-access';

/**
 * A regra do middleware e **nega por padrao**: uma rota nova de dominio tem de
 * cair como protegida sem ninguem lembrar de adiciona-la a lista. Estes testes
 * travam essa propriedade (BUILD-PLAN T-004, aceite 2).
 */
describe('isPublicPath', () => {
  it('libera a pagina de login', () => {
    expect(isPublicPath(LOGIN_PATH)).toBe(true);
  });

  it('libera as rotas do proprio Auth.js', () => {
    expect(isPublicPath('/api/auth')).toBe(true);
    expect(isPublicPath('/api/auth/signin/nodemailer')).toBe(true);
    expect(isPublicPath('/api/auth/callback/nodemailer')).toBe(true);
    expect(isPublicPath('/api/auth/verify-request')).toBe(true);
  });

  it('protege todas as rotas de dominio (nega por padrao)', () => {
    const protectedPaths = [
      '/',
      '/lancamentos',
      '/importar',
      '/cartoes',
      '/orcamento',
      '/fluxo',
      '/investimentos',
      '/metas',
      '/config',
    ];

    for (const pathname of protectedPaths) {
      expect(isPublicPath(pathname), pathname).toBe(false);
    }
  });

  it('protege as APIs de dominio', () => {
    expect(isPublicPath('/api/transactions')).toBe(false);
    expect(isPublicPath('/api/import')).toBe(false);
    expect(isPublicPath('/api/cards')).toBe(false);
  });

  it('nao confunde prefixo parecido com /api/auth nem com /login', () => {
    expect(isPublicPath('/api/authentic')).toBe(false);
    expect(isPublicPath('/logout')).toBe(false);
    expect(isPublicPath('/login-algo')).toBe(false);
    expect(isPublicPath('/login/2')).toBe(false);
  });
});

/**
 * Aceite 2 do T-004: rota protegida sem sessao redireciona para `/login`. A
 * decisao vive aqui, pura, entao da para provar todas as combinacoes sem subir
 * servidor.
 */
describe('resolveRouteAccess', () => {
  it('manda para o login a rota protegida sem sessao', () => {
    expect(resolveRouteAccess({ pathname: '/lancamentos', hasSession: false })).toBe(
      'redirect-login',
    );
    expect(resolveRouteAccess({ pathname: '/', hasSession: false })).toBe(
      'redirect-login',
    );
    expect(resolveRouteAccess({ pathname: '/api/transactions', hasSession: false })).toBe(
      'redirect-login',
    );
  });

  it('deixa passar rota protegida com sessao', () => {
    expect(resolveRouteAccess({ pathname: '/lancamentos', hasSession: true })).toBe(
      'allow',
    );
  });

  it('deixa passar o login sem sessao', () => {
    expect(resolveRouteAccess({ pathname: LOGIN_PATH, hasSession: false })).toBe(
      'allow',
    );
  });

  it('tira da tela de login quem ja tem sessao', () => {
    expect(resolveRouteAccess({ pathname: LOGIN_PATH, hasSession: true })).toBe(
      'redirect-home',
    );
  });
});

/**
 * CSRF: mutacao em /api/** exige Origin igual ao do app; o Auth.js tem
 * CSRF proprio e fica de fora. Pura, sem servidor.
 */
describe('isCrossSiteMutation', () => {
  const app = (method: string, pathname: string, origin: string | null) =>
    isCrossSiteMutation({ method, pathname, origin, appOrigin: 'https://appfin.vercel.app' });

  it('barra mutacao sem Origin ou com Origin estranha em rota de dominio', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(app(method, '/api/transactions', null), method).toBe(true);
      expect(app(method, '/api/transactions', 'https://evil.example'), method).toBe(true);
    }
  });

  it('libera mutacao com Origin do proprio app', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(app(method, '/api/transactions', 'https://appfin.vercel.app'), method).toBe(false);
    }
  });

  it('ignora leitura e caminho fora de /api', () => {
    expect(app('GET', '/api/transactions', null)).toBe(false);
    expect(app('POST', '/lancamentos', null)).toBe(false);
    expect(app('POST', '/', 'https://evil.example')).toBe(false);
  });

  it('isenta o Auth.js (CSRF proprio)', () => {
    expect(app('POST', '/api/auth/signin/nodemailer', null)).toBe(false);
    expect(app('POST', '/api/auth/callback/nodemailer', 'https://evil.example')).toBe(false);
    expect(app('POST', '/api/auth/session', null)).toBe(false);
  });

  it('nao confunde /api/authentic com /api/auth', () => {
    expect(app('POST', '/api/authentic', null)).toBe(true);
  });
});
