/**
 * Teste de fronteira da exclusão: as duas pontas do contrato.
 *
 * - A resposta é tipada com o `DeleteImpact` REAL do servidor
 *   (`lib/db/queries/transaction-delete.ts`) e passa pelo schema que a tela usa no
 *   `.parse`. Cobre todos os tipos de efeito: um efeito novo no servidor sem o
 *   schema da tela acende vermelho aqui, em vez de a tela ler `undefined`.
 * - O critério simples × detalhada (`isSimpleDelete`) é a lista de efeitos, não o
 *   tipo do lançamento.
 */

import { describe, expect, it } from 'vitest';

import { isSimpleDelete } from '@/components/transactions/delete-presentation';
import { deleteImpactSchema, deleteResultSchema } from '@/components/transactions/schemas';
import type { DeleteImpact } from '@/lib/db/queries/transaction-delete';
import { cents } from '@/lib/money';

import { deleteScopeSchema } from './schemas';

const ID = '11111111-1111-4111-8111-111111111111';

const target: DeleteImpact['target'] = {
  id: ID,
  description: 'Magazine (3/10)',
  amountCents: cents(-10000),
  occurredOn: '2026-10-05',
  status: 'planned',
};

const everyEffect: DeleteImpact['effects'] = [
  { kind: 'plan_hole', planDescription: 'Magazine', remaining: 4 },
  { kind: 'plan_removed', planDescription: 'Magazine' },
  {
    kind: 'statement_total',
    cardName: 'Nubank',
    competence: '2026-09',
    beforeCents: cents(-107482),
    afterCents: cents(-89482),
    reportedCents: cents(-107482),
  },
  {
    kind: 'statement_total',
    cardName: 'Nubank',
    competence: '2026-09',
    beforeCents: cents(-107482),
    afterCents: cents(-89482),
    reportedCents: null,
  },
  { kind: 'statement_unpaid', cardName: 'Nubank', competence: '2026-09' },
  { kind: 'import_batch', fileName: 'fatura.pdf', before: 14, after: 13 },
  { kind: 'returns_on_reimport' },
  { kind: 'occurrence_skipped', ruleDescription: 'Conta de luz', competence: '2026-11' },
];

function roundTrip<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe('delete-impact: o que a tela faz parse', () => {
  it('o DeleteImpact REAL do servidor, com todos os efeitos, passa pelo schema da tela', () => {
    const impact: DeleteImpact = {
      target,
      deleted: { transactions: 1, futureInstallments: 7 },
      effects: everyEffect,
    };
    expect(deleteImpactSchema.safeParse(roundTrip(impact)).success).toBe(true);
  });

  it('impacto sem efeitos (lançamento manual) também passa', () => {
    const impact: DeleteImpact = { target, deleted: { transactions: 1, futureInstallments: 0 }, effects: [] };
    expect(deleteImpactSchema.safeParse(roundTrip(impact)).success).toBe(true);
  });

  it('efeito desconhecido ou campo faltando FALHA o parse (falha alto)', () => {
    const base = { target, deleted: { transactions: 1, futureInstallments: 0 } };
    expect(deleteImpactSchema.safeParse({ ...base, effects: [{ kind: 'novo_efeito' }] }).success).toBe(false);
    expect(
      deleteImpactSchema.safeParse({ ...base, effects: [{ kind: 'plan_hole', planDescription: 'x' }] }).success,
    ).toBe(false);
    expect(deleteImpactSchema.safeParse({ target, effects: [] }).success).toBe(false);
  });

  it('a resposta do DELETE passa pelo schema da tela', () => {
    expect(
      deleteResultSchema.safeParse({ id: ID, deleted: { transactions: 1, futureInstallments: 3 } }).success,
    ).toBe(true);
    expect(deleteResultSchema.safeParse({ id: ID }).success).toBe(false);
  });
});

describe('scope', () => {
  it('só "only" e "with-future"', () => {
    expect(deleteScopeSchema.safeParse('only').success).toBe(true);
    expect(deleteScopeSchema.safeParse('with-future').success).toBe(true);
    expect(deleteScopeSchema.safeParse('all').success).toBe(false);
    expect(deleteScopeSchema.safeParse('').success).toBe(false);
  });
});

describe('isSimpleDelete: simples × detalhada', () => {
  it('sem efeitos e sem parcelas futuras: SIMPLES', () => {
    expect(isSimpleDelete({ effects: [], deleted: { transactions: 1, futureInstallments: 0 } })).toBe(true);
  });

  it.each(everyEffect.map((effect) => [effect.kind, effect] as const))(
    'qualquer efeito (%s) torna a confirmação DETALHADA',
    (_kind, effect) => {
      expect(isSimpleDelete({ effects: [effect], deleted: { transactions: 1, futureInstallments: 0 } })).toBe(false);
    },
  );

  it('parcelas futuras indo junto são DETALHADA mesmo com a lista de efeitos vazia', () => {
    expect(isSimpleDelete({ effects: [], deleted: { transactions: 1, futureInstallments: 2 } })).toBe(false);
  });
});
