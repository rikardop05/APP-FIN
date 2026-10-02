import { describe, expect, it } from 'vitest';

import {
  isSimpleDelete,
  reopensPlannedNotice,
  withFutureOptionLabel,
} from './delete-presentation';

/**
 * O texto do efeito `reopens_planned` (decisão 7 §3.3): uma previsão cumprida
 * volta a ficar em aberto quando o lançamento real é excluído. O switch do
 * diálogo agora é exaustivo; a formatação do mês fica nesta função pura.
 */
describe('reopensPlannedNotice', () => {
  it('monta a frase com o mês por extenso e barra', () => {
    expect(
      reopensPlannedNotice({
        kind: 'reopens_planned',
        ruleDescription: 'Aluguel',
        competence: '2026-10',
      }),
    ).toBe('A previsão de Aluguel de outubro/2026 volta a ficar em aberto.');
  });

  it('usa o nome do mês correto em outros meses', () => {
    expect(
      reopensPlannedNotice({
        kind: 'reopens_planned',
        ruleDescription: 'Internet',
        competence: '2027-01',
      }),
    ).toBe('A previsão de Internet de janeiro/2027 volta a ficar em aberto.');
  });
});

describe('withFutureOptionLabel', () => {
  it('devolve null sem parcela futura e rotula 1 e N', () => {
    expect(withFutureOptionLabel(0)).toBeNull();
    expect(withFutureOptionLabel(1)).toBe('Esta e a parcela futura do plano');
    expect(withFutureOptionLabel(3)).toBe('Esta e as 3 parcelas futuras do plano');
  });
});

describe('isSimpleDelete', () => {
  it('é simples só sem efeitos e sem parcela futura', () => {
    expect(isSimpleDelete({ effects: [], deleted: { transactions: 1, futureInstallments: 0 } })).toBe(true);
    expect(
      isSimpleDelete({
        effects: [{ kind: 'plan_removed', planDescription: 'Notebook' }],
        deleted: { transactions: 1, futureInstallments: 0 },
      }),
    ).toBe(false);
    expect(isSimpleDelete({ effects: [], deleted: { transactions: 1, futureInstallments: 2 } })).toBe(false);
  });
});
