import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';

import { authConfig } from '@/lib/auth/config';
import { LOGIN_PATH, isCrossSiteMutation, resolveRouteAccess } from '@/lib/auth/route-access';

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

  // Mutacao sem origem do proprio app nao vem do app: 403 antes de qualquer
  // outra decisao. Server actions nao passam por aqui (outro caminho).
  if (
    isCrossSiteMutation({
      method: request.method,
      pathname: nextUrl.pathname,
      origin: request.headers.get('origin'),
      appOrigin: nextUrl.origin,
    })
  ) {
    return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
  }

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
    // Exclui do middleware: assets internos do Next, o favicon, e os arquivos do
    // service worker (`/sw.js`, `/sw-policy.js`) — sem isto eles sem sessao
    // respondem 307 para /login e a ATUALIZACAO do service worker falha (o
    // navegador busca esses arquivos fora do escopo de sessao do app).
    '/((?!_next/static|_next/image|favicon.ico|sw\\.js|sw-policy\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest|txt|xml)$).*)',
  ],
};
