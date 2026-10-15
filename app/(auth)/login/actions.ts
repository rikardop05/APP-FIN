'use server';

import { createHash, randomBytes } from 'node:crypto';

import { after } from 'next/server';
import { headers } from 'next/headers';

import { createAuthAdapter } from '@/lib/auth/adapter';
import { isAllowedEmail, normalizeEmail } from '@/lib/auth/allowlist';
import { MAGIC_LINK_TTL_SECONDS, createSendVerificationRequest } from '@/lib/auth/magic-link';
import { MAGIC_LINK_MAX_SENDS_PER_HOUR, recentMagicLinkSends } from '@/lib/auth/rate-limit';

import type { MagicLinkState } from './magic-link-state';

/**
 * Pede o magic link (T-004). Regras desta rota:
 *
 * - mesma resposta (`sent`) para qualquer e-mail, dentro ou fora da
 *   allowlist — a tela nunca distingue os dois casos;
 * - o envio acontece DEPOIS da resposta (`after`), entao o tempo de resposta
 *   e igual tenha o e-mail sido enviado ou nao;
 * - e-mail fora da allowlist nao gera token nem dispara envio;
 * - e-mail dentro da allowlist respeita o limite de envios por hora; acima
 *   dele, a rota cala sem erro (a resposta continua `sent`).
 *
 * O envio nao passa pelo `signIn` do Auth.js: ele sincroniza cookies depois
 * de responder, o que dentro do `after` vira erro a cada login. Em vez disso,
 * esta rota executa o fluxo de e-mail com o provider e o adapter
 * diretamente — os mesmos passos que o Auth.js faria (token aleatorio,
 * hash SHA-256 com o AUTH_SECRET, URL de callback no formato dele,
 * `sendVerificationRequest`, gravacao via adapter). A verificacao do link
 * continua no Auth.js de verdade, entao qualquer divergencia de formato
 * quebra o login em vez de passar batido. Nenhuma API do Next e usada no
 * trabalho em segundo plano: origem e callback vao na closure como texto.
 *
 * Erro no envio cai no log do servidor, sem nada que identifique o
 * destinatario (CONVENTIONS §9).
 */
async function deliverMagicLink(email: string, appOrigin: string): Promise<void> {
  try {
    if ((await recentMagicLinkSends(email)) >= MAGIC_LINK_MAX_SENDS_PER_HOUR) return;
    const secret = process.env.AUTH_SECRET;
    if (!secret) throw new Error('AUTH_SECRET ausente.');
    const adapter = createAuthAdapter();
    // 64 hex chars, mesma entropia do `randomString(32)` do Auth.js.
    const clearToken = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + MAGIC_LINK_TTL_SECONDS * 1000);
    const callbackUrl = '/';
    const url =
      `${appOrigin}/api/auth/callback/nodemailer?` +
      new URLSearchParams({ callbackUrl, token: clearToken, email }).toString();
    const send = createSendVerificationRequest();
    // Token gravado ANTES do envio: se a gravacao falhar, nenhum e-mail sai
    // com um link que nao funcionaria.
    await adapter.createVerificationToken?.({
      identifier: email,
      token: createHash('sha256').update(`${clearToken}${secret}`).digest('hex'),
      expires,
    });
    await send({
      identifier: email,
      url,
      provider: {
        from: process.env.EMAIL_FROM,
        server: process.env.EMAIL_SERVER,
      },
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : 'desconhecido';
    console.error(`[login] envio de magic link falhou (${name}).`);
  }
}

export async function requestMagicLink(
  _previous: MagicLinkState,
  formData: FormData,
): Promise<MagicLinkState> {
  const raw = formData.get('email');
  // Normalizado cedo: o identificador e gravado como chega, e o contador do
  // limite precisa enxergar `A@x.com` e `a@x.com` como um so.
  const email = normalizeEmail(typeof raw === 'string' ? raw : '');

  if (!isAllowedEmail(email)) {
    return { status: 'sent' };
  }

  const requestHeaders = await headers();
  // Origem do link: AUTH_URL (controle do servidor) antes do Host do pedido
  // (cabecalho forjavel). Sem trailing slash, para a URL nao quebrar.
  const fromEnv = process.env.AUTH_URL?.replace(/\/+$/, '');
  let appOrigin = fromEnv ?? null;
  if (!appOrigin) {
    const proto = requestHeaders.get('x-forwarded-proto') ?? 'http';
    const host = requestHeaders.get('host') ?? 'localhost:3000';
    appOrigin = `${proto}://${host}`;
  }
  try {
    // Devolve a promessa: na Vercel, o `after` so segura a funcao viva ate o
    // envio terminar se receber a promessa (sem ela, a funcao pode congelar antes).
    after(() => deliverMagicLink(email, appOrigin));
  } catch {
    await deliverMagicLink(email, appOrigin);
  }
  return { status: 'sent' };
}
