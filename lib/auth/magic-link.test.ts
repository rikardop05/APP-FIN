import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEV_MAGIC_LINK_PREFIX,
  buildMagicLinkEmail,
  createSendVerificationRequest,
  type MailMessage,
} from './magic-link';

/**
 * Aceite 1 do T-004: e-mail fora da allowlist e **recusado**. Aqui a prova e
 * ainda mais forte que a da rota — a recusa acontece **antes de tocar o
 * transporte**, entao nem um socket SMTP e aberto. O transporte e um duble
 * injetado, o que permite rodar sem credencial de SMTP.
 *
 * E-mails de teste sao sinteticos (`*.invalid`, RFC 2606).
 */

const ALLOWED = 'membro@example.invalid';
const OUTSIDER = 'intruso@example.invalid';
const FROM = 'APPFIN <no-reply@appfin.invalid>';
const SMTP_SERVER = 'smtp://localhost:25';
const MAGIC_URL = 'http://localhost:3000/api/auth/callback/nodemailer?token=s3cr3t-no-link';
const ENV_KEY = 'AUTH_ALLOWED_EMAILS';
const originalEnv = process.env[ENV_KEY];

function fakeTransportFactory() {
  const sendMail = vi.fn<(message: MailMessage) => Promise<unknown>>(async () => undefined);
  const factory = vi.fn(() => ({ sendMail }));
  return { sendMail, factory };
}

function buildParams(
  identifier: string,
  provider: { from?: string; server?: string },
) {
  return { identifier, url: MAGIC_URL, provider };
}

beforeEach(() => {
  process.env[ENV_KEY] = `${ALLOWED},outro@example.invalid`;
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = originalEnv;
  }
  vi.restoreAllMocks();
});

describe('createSendVerificationRequest', () => {
  it('envia para um endereco da allowlist', async () => {
    const { sendMail, factory } = fakeTransportFactory();
    const send = createSendVerificationRequest(factory);

    await send(buildParams(ALLOWED, { from: FROM, server: SMTP_SERVER }));

    expect(factory).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = sendMail.mock.calls[0]?.[0];
    expect(message?.to).toBe(ALLOWED);
    expect(message?.from).toBe(FROM);
    expect(message?.text).toContain(MAGIC_URL);
  });

  it('recusa endereco fora da allowlist sem acionar o transporte', async () => {
    const { sendMail, factory } = fakeTransportFactory();
    const send = createSendVerificationRequest(factory);

    await expect(
      send(buildParams(OUTSIDER, { from: FROM, server: SMTP_SERVER })),
    ).rejects.toThrow(/allowlist/i);

    expect(factory).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('a mensagem de recusa nao ecoa o endereco nem o token', async () => {
    const { factory } = fakeTransportFactory();
    const send = createSendVerificationRequest(factory);

    let message = '';
    try {
      await send(buildParams(OUTSIDER, { from: FROM, server: SMTP_SERVER }));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toContain(OUTSIDER);
    expect(message).not.toContain('s3cr3t-no-link');
  });

  it('em desenvolvimento sem EMAIL_SERVER imprime o link no console, com o prefixo [DEV]', async () => {
    const { sendMail, factory } = fakeTransportFactory();
    const log = vi.fn();
    const send = createSendVerificationRequest(factory, {
      env: { NODE_ENV: 'development' },
      log,
    });

    await send(buildParams(ALLOWED, { from: FROM }));

    expect(factory).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    const message = log.mock.calls[0]?.[0] ?? '';
    expect(message).toContain(DEV_MAGIC_LINK_PREFIX);
    expect(message).toContain(MAGIC_URL);
  });

  it('em producao sem EMAIL_SERVER lanca e NAO imprime o link', async () => {
    const { factory } = fakeTransportFactory();
    const log = vi.fn();
    const send = createSendVerificationRequest(factory, {
      env: { NODE_ENV: 'production' },
      log,
    });

    await expect(send(buildParams(ALLOWED, { from: FROM }))).rejects.toThrow(
      /EMAIL_SERVER/,
    );
    expect(log).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });

  it('sem SMTP, endereco fora da allowlist continua recusado — e nada e impresso', async () => {
    const { factory } = fakeTransportFactory();
    const log = vi.fn();
    const send = createSendVerificationRequest(factory, {
      env: { NODE_ENV: 'development' },
      log,
    });

    await expect(send(buildParams(OUTSIDER, { from: FROM }))).rejects.toThrow(
      /allowlist/i,
    );
    expect(log).not.toHaveBeenCalled();
  });
});

describe('buildMagicLinkEmail', () => {
  it('monta assunto e corpo em pt-BR com o link', () => {
    const email = buildMagicLinkEmail(MAGIC_URL, 'localhost:3000');

    expect(email.subject).toContain('APPFIN');
    expect(email.text).toContain(MAGIC_URL);
    expect(email.html).toContain('href=');
  });

  it('escapa o link antes de interpolar no HTML', () => {
    const hostile =
      'https://exemplo.invalid/?a=1&b=<script>alert(1)</script>';

    const email = buildMagicLinkEmail(hostile, 'exemplo.invalid');

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('&amp;b=');
    // O corpo texto nao e HTML: o link sai cru.
    expect(email.text).toContain(hostile);
  });
});
