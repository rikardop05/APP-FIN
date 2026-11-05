import { describe, expect, it } from 'vitest';

import { describeApiError } from './api-error';

describe('describeApiError', () => {
  it('usa a mensagem da API quando o corpo e JSON valido', () => {
    expect(describeApiError('Senha incorreta.', 400, 'Falhou.')).toBe('Senha incorreta.');
  });

  it('inclui o status quando a resposta nao e JSON', () => {
    expect(describeApiError(null, 500, 'Não foi possível processar o PDF.')).toBe(
      'Não foi possível processar o PDF (erro 500).',
    );
  });

  it('funciona com fallback sem ponto final', () => {
    expect(describeApiError(null, 504, 'Falhou')).toBe('Falhou (erro 504).');
  });
});
