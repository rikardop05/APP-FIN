import { NextRequest, NextResponse } from 'next/server';

import { handlers } from '@/lib/auth';

/**
 * Rotas do Auth.js (signin, callback, verify-request, signout, session).
 * Runtime Node porque o adapter fala Postgres; o middleware, que roda em borda,
 * nao toca este arquivo (importa apenas `lib/auth/config`).
 *
 * O login do app usa a server action (`app/(auth)/login/actions.ts`), que
 * chama o Auth.js em processo — nao passa por HTTP. Por isso o POST externo
 * em `/api/auth/signin/*` nao tem uso legitimo e e recusado com 404: ele e o
 * segundo caminho que disparava magic link, fora do limite por e-mail da
 * action. GETs (pagina de signin, callbacks do link, sessao, signout)
 * continuam no Auth.js.
 */

export const runtime = 'nodejs';

function isExternalEmailSigninPost(request: Request): boolean {
  if (request.method !== 'POST') return false;
  const { pathname } = new URL(request.url);
  return pathname === '/api/auth/signin' || pathname.startsWith('/api/auth/signin/');
}

async function handlePost(request: NextRequest): Promise<Response> {
  if (isExternalEmailSigninPost(request)) {
    return NextResponse.json({ error: 'Não encontrado.' }, { status: 404 });
  }
  return handlers.POST(request);
}

export const { GET } = handlers;
export { handlePost as POST };
