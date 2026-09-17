import { describe, expect, it } from 'vitest';

import { createEmailProvider } from './email-provider';

/**
 * O guarda mais importante do T-004: **producao sem `EMAIL_SERVER` nao
 * inicializa.**
 *
 * Existe um fallback de desenvolvimento que imprime o magic link no console
 * (trocar o carteiro, nao pular a verificacao). O que nao pode existir, em
 * hipotese alguma, e uma producao que imprima o link no log — seria entregar
 * credencial de acesso a quem lesse o log do servidor. Este teste e o que
 * impede alguem de afrouxar o guarda depois sem perceber.
 */
describe('createEmailProvider — guarda de producao', () => {
  it('producao sem EMAIL_SERVER lanca na inicializacao', () => {
    expect(() => createEmailProvider({ NODE_ENV: 'production' })).toThrow(/EMAIL_SERVER/);
  });

  it('a mensagem diz que EMAIL_SERVER e obrigatorio em producao', () => {
    let message = '';
    try {
      createEmailProvider({ NODE_ENV: 'production' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('EMAIL_SERVER');
    expect(message).toMatch(/producao/i);
  });

  it('producao com EMAIL_SERVER nao lanca', () => {
    expect(() =>
      createEmailProvider({
        NODE_ENV: 'production',
        EMAIL_SERVER: 'smtp://localhost:25',
        EMAIL_FROM: 'APPFIN <no-reply@appfin.invalid>',
      }),
    ).not.toThrow();
  });

  it('desenvolvimento sem EMAIL_SERVER nao lanca — o console e o canal de entrega', () => {
    expect(() => createEmailProvider({ NODE_ENV: 'development' })).not.toThrow();
  });

  it('na fase de build do Next nao lanca — compila, mas nao serve requisicao', () => {
    expect(() =>
      createEmailProvider({
        NODE_ENV: 'production',
        NEXT_PHASE: 'phase-production-build',
      }),
    ).not.toThrow();
  });
});
