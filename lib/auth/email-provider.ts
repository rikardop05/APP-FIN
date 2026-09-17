import type { NodemailerConfig } from 'next-auth/providers/nodemailer';

import {
  MAGIC_LINK_TTL_SECONDS,
  assertEmailTransportProductionReady,
  createSendVerificationRequest,
} from './magic-link';

/**
 * Provider de e-mail do Auth.js, montado a mao em vez de pela fabrica
 * `Nodemailer()`.
 *
 * Motivo: a fabrica **lanca no carregamento do modulo** quando `server` esta
 * ausente ("Nodemailer requires a `server` configuration"). Construindo o objeto
 * aqui, o app sobe em desenvolvimento sem SMTP; o envio cai no console (ver
 * `magic-link.ts`), e a allowlist e a expiracao seguem valendo.
 *
 * **Guarda de boot (T-004):** em producao sem `EMAIL_SERVER`, `createEmailProvider`
 * lanca — o app nao sobe. O fallback de console so existe em desenvolvimento.
 */
export function createEmailProvider(env: NodeJS.ProcessEnv = process.env): NodemailerConfig {
  assertEmailTransportProductionReady(env);

  return {
    id: 'nodemailer',
    type: 'email',
    name: 'E-mail',
    from: env.EMAIL_FROM ?? '',
    maxAge: MAGIC_LINK_TTL_SECONDS,
    server: (env.EMAIL_SERVER ?? undefined) as NodemailerConfig['server'],
    sendVerificationRequest: createSendVerificationRequest(undefined, { env }),
  };
}
