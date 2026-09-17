import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ALLOWED_EMAILS_ENV,
  isAllowedEmail,
  normalizeEmail,
  readAllowedEmails,
} from './allowlist.ts';

/**
 * Allowlist e superficie de seguranca (RNF-01): quem nao esta na lista nao
 * entra. Os testes cobrem o caminho feliz, os erros de configuracao e — o mais
 * importante — que a mensagem de erro nunca ecoa um e-mail (CONVENTIONS §9).
 *
 * E-mails aqui sao sinteticos (`*.invalid`, RFC 2606) de proposito.
 */

const EMAIL_A = 'membro-a@example.invalid';
const EMAIL_B = 'membro-b@example.invalid';

const original = process.env[ALLOWED_EMAILS_ENV];

beforeEach(() => {
  delete process.env[ALLOWED_EMAILS_ENV];
});

afterEach(() => {
  if (original === undefined) {
    delete process.env[ALLOWED_EMAILS_ENV];
  } else {
    process.env[ALLOWED_EMAILS_ENV] = original;
  }
});

describe('normalizeEmail', () => {
  it('faz trim e minusculas', () => {
    expect(normalizeEmail('  Membro@Example.INVALID ')).toBe('membro@example.invalid');
  });
});

describe('readAllowedEmails', () => {
  it('devolve os 2 e-mails normalizados, na ordem da variavel', () => {
    process.env[ALLOWED_EMAILS_ENV] = `${EMAIL_A},${EMAIL_B}`;
    expect(readAllowedEmails()).toEqual([EMAIL_A, EMAIL_B]);
  });

  it('normaliza caixa e espaco em volta', () => {
    process.env[ALLOWED_EMAILS_ENV] = ` ${EMAIL_A.toUpperCase()} , ${EMAIL_B} `;
    expect(readAllowedEmails()).toEqual([EMAIL_A, EMAIL_B]);
  });

  it('lanca quando a variavel esta ausente, com mensagem acionavel', () => {
    expect(() => readAllowedEmails()).toThrowError(/AUTH_ALLOWED_EMAILS/);
    expect(() => readAllowedEmails()).toThrowError(/recebi 0/);
    expect(() => readAllowedEmails()).toThrowError(/\.env\.local/);
  });

  it('lanca quando ha apenas 1 e-mail', () => {
    process.env[ALLOWED_EMAILS_ENV] = EMAIL_A;
    expect(() => readAllowedEmails()).toThrowError(/recebi 1/);
  });

  it('lanca quando ha 3 e-mails', () => {
    process.env[ALLOWED_EMAILS_ENV] = `${EMAIL_A},${EMAIL_B},terceiro@example.invalid`;
    expect(() => readAllowedEmails()).toThrowError(/recebi 3/);
  });

  it('lanca quando os dois e-mails sao iguais', () => {
    process.env[ALLOWED_EMAILS_ENV] = `${EMAIL_A},${EMAIL_A}`;
    expect(() => readAllowedEmails()).toThrowError(/mesmo e-mail duas vezes/);
  });

  // Regressao de privacidade: a mensagem nao pode vazar o e-mail do household.
  it('nunca ecoa o e-mail na mensagem de erro', () => {
    process.env[ALLOWED_EMAILS_ENV] = `${EMAIL_A},${EMAIL_A}`;
    let message = '';
    try {
      readAllowedEmails();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain(EMAIL_A);
  });
});

describe('isAllowedEmail', () => {
  beforeEach(() => {
    process.env[ALLOWED_EMAILS_ENV] = `${EMAIL_A},${EMAIL_B}`;
  });

  it('aceita exatamente os 2 e-mails da lista', () => {
    expect(isAllowedEmail(EMAIL_A)).toBe(true);
    expect(isAllowedEmail(EMAIL_B)).toBe(true);
  });

  it('aceita ignorando caixa e espaco', () => {
    expect(isAllowedEmail(`  ${EMAIL_A.toUpperCase()}  `)).toBe(true);
  });

  it('recusa e-mail fora da allowlist', () => {
    expect(isAllowedEmail('intruso@example.invalid')).toBe(false);
  });

  it('recusa string vazia', () => {
    expect(isAllowedEmail('')).toBe(false);
    expect(isAllowedEmail('   ')).toBe(false);
  });

  // Fecha em vez de abrir: configuracao quebrada NUNCA pode virar acesso.
  it('recusa tudo quando a variavel esta ausente (falha fechada)', () => {
    delete process.env[ALLOWED_EMAILS_ENV];
    expect(isAllowedEmail(EMAIL_A)).toBe(false);
  });

  it('recusa tudo quando a variavel esta malformada (falha fechada)', () => {
    process.env[ALLOWED_EMAILS_ENV] = EMAIL_A;
    expect(isAllowedEmail(EMAIL_A)).toBe(false);
  });
});
