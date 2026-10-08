/**
 * Fronteira da revisao em grupos (F4): o tipo REAL do servidor passa pelo schema
 * da tela, e o corpo do POST e validado como a rota valida.
 */
import { describe, expect, it } from 'vitest';
import { reviewGroupSchema, reviewResultSchema } from '@/components/transactions/schemas';
import type { ReviewGroup, ReviewGroupResult } from '@/lib/db/queries/review-groups';
import { cents } from '@/lib/money';
import { reviewGroupConfirmationSchema } from './schemas';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

describe('fronteira servidor -> tela da revisao', () => {
  it('grupo e resultado tipados pelo servidor passam pelo schema da tela', () => {
    const group: ReviewGroup = {
      key: 'out|pattern:irmaos boa',
      pattern: 'irmaos boa',
      direction: 'out',
      transactionIds: [UUID_A],
      count: 1,
      totalCents: cents(-1000),
      sampleDescriptions: ['IRMAOS BOA'],
      ruleId: null,
      suggestedCategoryId: null,
      suggestedCategoryName: null,
    };
    expect(reviewGroupSchema.parse(group)).toEqual(group);
    const result: ReviewGroupResult = { categorized: 1, skipped: 0, propagated: 0, ruleId: UUID_B };
    expect(reviewResultSchema.parse(result)).toEqual(result);
  });
});

describe('reviewGroupConfirmationSchema', () => {
  it('apara o padrao e aceita null', () => {
    expect(reviewGroupConfirmationSchema.parse({ transactionIds: [UUID_A], categoryId: UUID_B, newRulePattern: ' loja ' }).newRulePattern).toBe('loja');
    expect(reviewGroupConfirmationSchema.parse({ transactionIds: [UUID_A], categoryId: UUID_B, newRulePattern: null }).newRulePattern).toBeNull();
  });

  it('recusa padrao vazio, grupo vazio e id repetido', () => {
    expect(reviewGroupConfirmationSchema.safeParse({ transactionIds: [UUID_A], categoryId: UUID_B, newRulePattern: '   ' }).success).toBe(false);
    expect(reviewGroupConfirmationSchema.safeParse({ transactionIds: [], categoryId: UUID_B, newRulePattern: null }).success).toBe(false);
    expect(reviewGroupConfirmationSchema.safeParse({ transactionIds: [UUID_A, UUID_A], categoryId: UUID_B, newRulePattern: null }).success).toBe(false);
  });
});
