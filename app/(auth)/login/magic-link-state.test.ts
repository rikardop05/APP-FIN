import { describe, expect, it } from 'vitest';

import { messageForStatus } from './magic-link-state';

describe('mensagens do login em pt-BR acentuado', () => {
  it('erro e envio', () => {
    expect(messageForStatus({ status: 'error' })).toBe('Não foi possível enviar o link agora. Tente de novo em instantes.');
    expect(messageForStatus({ status: 'sent' })).toBe('Se este e-mail tiver acesso, enviamos um link. Abra o e-mail neste aparelho.');
    expect(messageForStatus({ status: 'idle' })).toBeNull();
  });
});
