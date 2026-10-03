import { describe, expect, it } from 'vitest';

import { listContentState } from './list-presentation';

/**
 * O bug do T-403: carga falha -> `rows` fica vazio -> a tela mostrava o estado
 * vazio "Nenhum lancamento ainda" abaixo do erro, dizendo que nao ha nada
 * quando na verdade nao carregou.
 */
describe('listContentState', () => {
  it('carregando vence tudo (inclusive recarga apos erro)', () => {
    expect(listContentState({ loading: true, failed: false, rowCount: 0 })).toBe('loading');
    expect(listContentState({ loading: true, failed: true, rowCount: 0 })).toBe('loading');
    expect(listContentState({ loading: true, failed: true, rowCount: 9 })).toBe('loading');
  });

  it('erro de carga NUNCA vira estado vazio', () => {
    expect(listContentState({ loading: false, failed: true, rowCount: 0 })).toBe('error');
  });

  it('erro tambem suprime a lista (so o alerta)', () => {
    expect(listContentState({ loading: false, failed: true, rowCount: 7 })).toBe('error');
  });

  it('vazio so com carga bem-sucedida e zero itens', () => {
    expect(listContentState({ loading: false, failed: false, rowCount: 0 })).toBe('empty');
  });

  it('lista quando a carga deu certo e ha itens', () => {
    expect(listContentState({ loading: false, failed: false, rowCount: 1 })).toBe('list');
    expect(listContentState({ loading: false, failed: false, rowCount: 60 })).toBe('list');
  });
});
