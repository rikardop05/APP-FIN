import { describe, expect, it } from 'vitest';

import { saveBudgetsBodySchema } from '@/app/api/budgets/schemas';
import type { Cents } from '@/lib/money';

import { currentSpendFields } from './current-spend';
import { buildSaveBody } from './save-body';

const c = (n: number) => n as Cents;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const GONE = '44444444-4444-4444-8444-444444444444';

describe('currentSpendFields', () => {
  const month = {
    categories: [{ id: A }, { id: B }, { id: C }],
    rows: [{ categoryId: A, expectedCents: c(135000) }],
    unbudgeted: [
      { categoryId: B, expectedCents: c(4990) },
      { categoryId: GONE, expectedCents: c(100) },
    ],
  };

  it('preenche com o gasto esperado, com e sem orçamento salvo; categoria sem gasto não é tocada', () => {
    expect(currentSpendFields(month)).toEqual({ [A]: '1.350,00', [B]: '49,90' });
  });

  it('categoria com orçamento e gasto esperado zero não vira "0" (zero seria limite explícito)', () => {
    expect(currentSpendFields({ ...month, rows: [{ categoryId: A, expectedCents: c(0) }], unbudgeted: [] })).toEqual({});
  });

  it('o que ele preenche vira um corpo que a rota aceita, com os mesmos centavos', () => {
    const built = buildSaveBody('2026-11', currentSpendFields(month));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(saveBudgetsBodySchema.safeParse(built.body).success).toBe(true);
    expect(built.body.items).toEqual([
      { categoryId: A, plannedCents: 135000 },
      { categoryId: B, plannedCents: 4990 },
    ]);
  });
});
