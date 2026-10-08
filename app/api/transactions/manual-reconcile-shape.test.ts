import { describe, expect, it } from 'vitest';

import { manualTransactionBodySchema, reconcileSuggestionResponseSchema } from './schemas';

const BODY = {
  occurredOn: '2026-11-06',
  description: 'Luz paga no Pix',
  amountCents: -18500,
  kind: 'expense',
  categoryId: '11111111-1111-4111-8111-111111111111',
  accountId: '22222222-2222-4222-8222-222222222222',
  creditCardId: null,
  memberId: null,
};

describe('lançamento manual que cumpre previsão (decisão 16a): forma do pedido e da resposta', () => {
  it('reconcilePlannedId é opcional e, ausente, vale null: sem confirmação nada é conciliado', () => {
    const parsed = manualTransactionBodySchema.parse(BODY);
    expect(parsed.reconcilePlannedId).toBeNull();
    expect(manualTransactionBodySchema.parse({ ...BODY, reconcilePlannedId: '33333333-3333-4333-8333-333333333333' }).reconcilePlannedId).toBe(
      '33333333-3333-4333-8333-333333333333',
    );
    expect(manualTransactionBodySchema.safeParse({ ...BODY, reconcilePlannedId: 'nao-e-uuid' }).success).toBe(false);
  });

  it('a sugestão é a previsão (id, descrição, data, valor) ou null', () => {
    expect(reconcileSuggestionResponseSchema.parse({ suggestion: null })).toEqual({ suggestion: null });
    const suggestion = { plannedId: '33333333-3333-4333-8333-333333333333', description: 'Conta de luz', occurredOn: '2026-11-05', amountCents: -18000 };
    expect(reconcileSuggestionResponseSchema.parse({ suggestion })).toEqual({ suggestion });
  });
});
