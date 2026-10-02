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

import {
  isSimpleDelete,
  reimportNotice,
  withFutureOptionLabel,
} from '@/components/transactions/delete-presentation';
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
  { kind: 'reimport_will_fail', planDescription: 'Magazine', blockingInstallments: 2 },
  { kind: 'stays_deleted_on_reimport' },
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

describe('reimportNotice: o que a reimportação faz', () => {
  it('sem futuras projetadas sobrando: o lançamento volta (texto de antes, intocado)', () => {
    expect(reimportNotice({ kind: 'returns_on_reimport' })).toBe(
      'Se você importar este arquivo de novo, este lançamento volta.',
    );
  });

  it('com futuras sobrando: diz que a importação FALHA, e não que volta', () => {
    const text = reimportNotice({ kind: 'reimport_will_fail', planDescription: 'Magazine', blockingInstallments: 2 });
    expect(text).toBe(
      'Se você importar este arquivo de novo, a importação vai falhar enquanto as 2 parcelas futuras deste plano existirem. ' +
        'Para poder reimportar, exclua esta junto com as futuras.',
    );
    expect(text).not.toMatch(/volta/);
  });

  it('uma futura só: singular', () => {
    expect(reimportNotice({ kind: 'reimport_will_fail', planDescription: 'Magazine', blockingInstallments: 1 })).toBe(
      'Se você importar este arquivo de novo, a importação vai falhar enquanto a parcela futura deste plano existir. ' +
        'Para poder reimportar, exclua esta junto com a futura.',
    );
  });

  it('parcela projetada com a lida ainda no banco: diz que NÃO volta', () => {
    const text = reimportNotice({ kind: 'stays_deleted_on_reimport' });
    expect(text).toBe(
      'Se você importar este arquivo de novo, esta parcela não volta: a compra já consta como importada.',
    );
  });

  it('o schema da tela recusa reimport_will_fail sem parcela bloqueando', () => {
    const base = { target, deleted: { transactions: 1, futureInstallments: 0 } };
    const effect = { kind: 'reimport_will_fail', planDescription: 'Magazine', blockingInstallments: 0 };
    expect(deleteImpactSchema.safeParse({ ...base, effects: [effect] }).success).toBe(false);
  });
});

describe('withFutureOptionLabel: a escolha "esta e as futuras"', () => {
  it('sem futuras (ex.: a 12/12): a escolha NÃO aparece, nada de "0 parcelas"', () => {
    expect(withFutureOptionLabel(0)).toBeNull();
  });

  it('uma futura: singular', () => {
    expect(withFutureOptionLabel(1)).toBe('Esta e a parcela futura do plano');
  });

  it('várias futuras: com o número', () => {
    expect(withFutureOptionLabel(7)).toBe('Esta e as 7 parcelas futuras do plano');
  });
});
