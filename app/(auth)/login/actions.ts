'use server';

import { signIn } from '@/lib/auth';
import { isAllowedEmail } from '@/lib/auth/allowlist';

import type { MagicLinkState } from './magic-link-state';

/**
 * Pede o magic link (T-004).
 *
 * A allowlist e checada **antes** de acionar o Auth.js: quem esta fora dela
 * recebe `denied` e nenhum e-mail chega a ser montado — e o aceite 1
 * ("e-mail fora da allowlist e recusado"), verificado antes de qualquer envio.
 *
 * A mensagem de erro nao revela token, link nem o conteudo do e-mail, e a acao
 * nao loga nada (CONVENTIONS §9).
 */
export async function requestMagicLink(
  _previous: MagicLinkState,
  formData: FormData,
): Promise<MagicLinkState> {
  const raw = formData.get('email');
  const email = typeof raw === 'string' ? raw : '';

  if (!isAllowedEmail(email)) {
    return { status: 'denied' };
  }

  try {
    await signIn('nodemailer', { email, redirect: false });
    return { status: 'sent' };
  } catch {
    // Sem detalhe para o cliente; a causa (ex.: EMAIL_SERVER ausente) fica no
    // servidor. Na duvida, fecha.
    return { status: 'error' };
  }
}
