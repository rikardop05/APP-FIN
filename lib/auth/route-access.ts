/**
 * Politica de acesso do middleware (BUILD-PLAN T-004): **tudo fechado por
 * padrao**, so o que esta aqui explicitamente e publico.
 *
 * Lista de bloqueio seria o erro classico: esquecer uma rota nova a deixa
 * aberta em silencio. Aqui, rota nova nasce **protegida** — so entra na lista
 * quem precisa, de proposito.
 */

/** Unica pagina publica: onde se pede o magic link. */
export const LOGIN_PATH = '/login';

/**
 * Prefixos publicos. `/api/auth` e o proprio Auth.js (signin, callback,
 * verify-request, signout): se o middleware barra-se, ninguem conseguiria
 * autenticar.
 */
const PUBLIC_PREFIXES = ['/api/auth'] as const;

/**
 * `true` somente para a pagina de login e para as rotas do Auth.js. Qualquer
 * outra rota — `/`, `/lancamentos`, `/api/*` — exige sessao.
 */
export function isPublicPath(pathname: string): boolean {
  if (pathname === LOGIN_PATH) return true;

  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Decisao do middleware, isolada para ser testavel sem servidor. */
export type RouteAccess = 'allow' | 'redirect-login' | 'redirect-home';

/**
 * Traduz `(rota, tem sessao?)` na acao do middleware. Pura: o `middleware.ts` so
 * executa o resultado.
 */
export function resolveRouteAccess(input: {
  pathname: string;
  hasSession: boolean;
}): RouteAccess {
  if (!input.hasSession && !isPublicPath(input.pathname)) {
    return 'redirect-login';
  }

  if (input.hasSession && input.pathname === LOGIN_PATH) {
    return 'redirect-home';
  }

  return 'allow';
}
