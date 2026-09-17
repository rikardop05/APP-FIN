import { createTransport } from 'nodemailer';
import type { NodemailerConfig } from 'next-auth/providers/nodemailer';

import { isAllowedEmail } from './allowlist';

/**
 * Envio do magic link (T-004). Substitui o `sendVerificationRequest` padrao do
 * Auth.js por um que **recusa fora da allowlist antes de qualquer envio** e que
 * fala pt-BR.
 *
 * Cuidados de seguranca:
 * - a allowlist e checada **aqui**, nao so na rota de login: se alguem chamar o
 *   endpoint do Auth.js direto, o envio ainda para. Defesa em profundidade.
 * - a mensagem de erro **nunca** ecoa o endereco, o link nem o token
 *   (CONVENTIONS §9).
 * - **sem SMTP em producao o app nao sobe** (`assertEmailTransportProductionReady`);
 *   imprimir o magic link no log de producao seria entregar credencial de
 *   acesso a quem le o log.
 *
 * **Desenvolvimento sem SMTP (decisao do orquestrador, 2026-09-16):** o
 * transporte muda, a verificacao NAO. O token continua sendo gerado, gravado em
 * `verification_token`, com a mesma expiracao, e a allowlist continua recusando
 * endereco de fora; a unica diferenca e o canal de entrega — console em vez de
 * caixa de entrada. E trocar o carteiro, nao pular a verificacao.
 *
 * O transporte e injetavel (`TransportFactory`) para o teste rodar sem SMTP.
 */

/** TTL do link: 15 minutos. Curto de proposito — e um segredo efemero. */
export const MAGIC_LINK_TTL_SECONDS = 15 * 60;

/**
 * Os campos do Auth.js que este envio realmente usa. Estreitar o parametro (em
 * vez de aceitar o objeto inteiro) mantem a funcao atribuivel a
 * `NodemailerConfig['sendVerificationRequest']` — menos campos exigidos e um
 * supertipo — e deixa o teste montar as entradas sem construir `Date`.
 */
export type MagicLinkSendParams = {
  identifier: string;
  url: string;
  provider: {
    from?: string;
    server?: NodemailerConfig['server'];
  };
};

export type MailMessage = {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
};

export type MailTransport = {
  sendMail: (message: MailMessage) => Promise<unknown>;
};

export type TransportFactory = (
  server: NonNullable<NodemailerConfig['server']>,
) => MailTransport;

const smtpTransportFactory: TransportFactory = (server) => createTransport(server);

/** Marca o log de desenvolvimento — quem le tem de saber que nao e o normal. */
export const DEV_MAGIC_LINK_PREFIX = '[DEV] magic link (SMTP nao configurado)';

/** Fase de compilacao do Next: avalia modulos, mas nao atende requisicao. */
const NEXT_BUILD_PHASE = 'phase-production-build';

/** `true` em producao. Recebe o env por parametro para poder ser testado. */
export function isProduction(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'production';
}

/**
 * Guarda de boot: **producao sem `EMAIL_SERVER` nao inicializa.**
 *
 * O fallback de console existe so em desenvolvimento. Em producao, imprimir o
 * magic link no log entregaria uma credencial de acesso a qualquer um que lesse
 * o log do servidor. Falhar alto no boot e o comportamento correto — e este
 * teste (`email-provider.test.ts`) e o que impede alguem de afrouxar a guarda
 * depois sem perceber.
 *
 * Excecao: a **fase de build** do Next (`next build`) compila o app mas nao
 * serve requisicao — ali nao ha log de producao nem sessao a proteger, entao a
 * guarda nao dispara. No runtime de producao (`next start`) ela dispara.
 */
export function assertEmailTransportProductionReady(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isProduction(env)) return;
  if (env.NEXT_PHASE === NEXT_BUILD_PHASE) return;
  if (env.EMAIL_SERVER) return;

  throw new Error(
    'EMAIL_SERVER e obrigatorio em producao: sem SMTP o magic link nao pode ser ' +
      'entregue. O fallback que imprime o link no console so vale em desenvolvimento; ' +
      'imprimir credencial de acesso no log de producao seria entrega-la a quem lesse o log.',
  );
}

/** Escapa o minimo de HTML para interpolar texto em atributo e corpo. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Achata para uma linha — evita injecao de cabecalho no assunto. */
function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/** Corpo do e-mail, em pt-BR. Sem `Date` (CONVENTIONS §4 proibe relogio em /lib). */
export function buildMagicLinkEmail(url: string, host: string): Pick<MailMessage, 'subject' | 'text' | 'html'> {
  const subject = `Acesso ao APPFIN (${singleLine(host)})`;
  const text =
    'Alguem pediu um link de acesso ao APPFIN para este endereco.\n\n' +
    `${url}\n\n` +
    'O link vale por 15 minutos e so pode ser usado uma vez. ' +
    'Se nao foi voce, ignore este e-mail: sem o link ninguem entra.';
  // `url` e o link gerado pelo Auth.js, mas escapar antes de interpolar em
  // HTML e barato e fecha a porta para injecao caso um dia nao seja.
  const html =
    '<p>Alguem pediu um link de acesso ao APPFIN para este endereco.</p>' +
    `<p><a href="${escapeHtml(url)}">Entrar no APPFIN</a></p>` +
    '<p>O link vale por 15 minutos e so pode ser usado uma vez. ' +
    'Se nao foi voce, ignore este e-mail.</p>';

  return { subject, text, html };
}

/** Injetaveis do envio: `env` e `log` entram por parametro para o teste. */
export type SendVerificationRuntime = {
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
};

/**
 * Fabrica do `sendVerificationRequest`. O transporte entra por parametro para o
 * teste injetar um dublê — em producao, o SMTP real de `EMAIL_SERVER`.
 */
export function createSendVerificationRequest(
  createTransportFn: TransportFactory = smtpTransportFactory,
  runtime: SendVerificationRuntime = {},
): (params: MagicLinkSendParams) => Promise<void> {
  const env = runtime.env ?? process.env;
  const log =
    runtime.log ??
    ((message: string): void => {
      console.log(message);
    });

  return async (params: MagicLinkSendParams): Promise<void> => {
    const { identifier, url, provider } = params;

    if (!isAllowedEmail(identifier)) {
      // Recusa antes de tocar o transporte. Nao ecoa o endereco.
      throw new Error('Magic link recusado: endereco fora da allowlist.');
    }

    const server = provider.server;
    if (!server) {
      // Sem SMTP. Em producao, falha fechado — NUNCA imprime o link no log. Em
      // desenvolvimento, o console passa a ser o canal de entrega: o token
      // continua real, gravado e com a mesma expiracao; muda so o carteiro.
      assertEmailTransportProductionReady(env);
      log(`${DEV_MAGIC_LINK_PREFIX}: ${url}`);
      return;
    }

    const from = provider.from;
    if (!from) {
      throw new Error(
        'EMAIL_FROM nao esta definido em .env.local: sem remetente nao ha como enviar o magic link.',
      );
    }

    const host = new URL(url).host;
    const transport = createTransportFn(server);
    await transport.sendMail({ to: identifier, from, ...buildMagicLinkEmail(url, host) });
  };
}
