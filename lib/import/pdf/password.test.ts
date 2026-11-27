import { describe, expect, it } from 'vitest';

import { PdfPasswordError } from '@/lib/import/pdf/extract';
import {
  PASSWORD_REQUESTED_HINT,
  PDF_PASSWORD_ERROR_CODE,
  isPasswordErrorCode,
  isPasswordFieldOpen,
} from '@/lib/import/pdf/password';

describe('senha do PDF no upload', () => {
  it('o campo abre sozinho quando o PDF é protegido ou o servidor pediu a senha', () => {
    expect(isPasswordFieldOpen({ encrypted: true, requested: false })).toBe(true);
    expect(isPasswordFieldOpen({ encrypted: false, requested: true })).toBe(true);
    expect(isPasswordFieldOpen({ encrypted: true, requested: true })).toBe(true);
  });

  it('em PDF comum o campo fica recolhido, mas continua disponível', () => {
    expect(isPasswordFieldOpen({ encrypted: false, requested: false })).toBe(false);
  });

  it('reconhece só o código de senha, nunca um erro qualquer', () => {
    expect(isPasswordErrorCode(PDF_PASSWORD_ERROR_CODE)).toBe(true);
    expect(isPasswordErrorCode(undefined)).toBe(false);
    expect(isPasswordErrorCode('outro')).toBe(false);
    expect(isPasswordErrorCode(null)).toBe(false);
  });

  it('a dica aponta o campo e garante que a senha não é salva', () => {
    expect(PASSWORD_REQUESTED_HINT).toMatch(/Senha da fatura/);
    expect(PASSWORD_REQUESTED_HINT).toMatch(/não é salva/);
  });

  it('as duas mensagens de senha do extrator nunca carregam a senha digitada', () => {
    for (const reason of ['missing', 'incorrect'] as const) {
      const error = new PdfPasswordError(reason);
      expect(error.message).not.toMatch(/hunter2/);
      expect(error.reason).toBe(reason);
    }
  });
});
