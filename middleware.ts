import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';

import { authConfig } from '@/lib/auth/config';
import { LOGIN_PATH, resolveRouteAccess } from '@/lib/auth/route-access';

/**
 * Porteiro do app (BUILD-PLAN T-004). Constroi uma instancia **edge-safe** do
 * Auth.js (so `authConfig`, sem adapter/provider) apenas para ler o token da
 * sessao; importar `lib/auth` traria o cliente Postgres, que nao existe na
 * borda.
 *
 * Regra: **nega por padrao.** So passa o que `isPublicPath` libera (a pagina de
 * login e as rotas do proprio Auth.js). Rota nova nasce fechada.
 */
const { auth } = NextAuth(authConfig);

export default auth((request) => {
  const { nextUrl } = request;

  const access = resolveRouteAccess({
    pathname: nextUrl.pathname,
    hasSession: Boolean(request.auth),
  });

  if (access === 'redirect-login') {
    return NextResponse.redirect(new URL(LOGIN_PATH, nextUrl));
  }

  if (access === 'redirect-home') {
    return NextResponse.redirect(new URL('/', nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest|txt|xml)$).*)',
  ],
};
