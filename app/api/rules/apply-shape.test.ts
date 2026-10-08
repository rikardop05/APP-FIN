import { describe, expect, it } from 'vitest';
import {
  ruleApplicationPreviewSchema,
  ruleApplicationResultSchema,
} from '@/components/transactions/schemas';
import type { RuleApplicationProposal, RuleApplicationResult } from '@/lib/db/queries/apply-rules';
import { cents } from '@/lib/money';
import { applyRulesSchema } from './schemas';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

describe('applyRulesSchema', () => {
  it('previa sem ruleId vale para todas as regras (ruleId null)', () => {
    expect(applyRulesSchema.parse({ dryRun: true })).toEqual({ dryRun: true, ruleId: null });
  });

  it('previa de uma regra so', () => {
    expect(applyRulesSchema.parse({ dryRun: true, ruleId: UUID_A })).toEqual({ dryRun: true, ruleId: UUID_A });
  });

  it('gravacao exige a lista de itens confirmados', () => {
    expect(applyRulesSchema.safeParse({ dryRun: false }).success).toBe(false);
    expect(
      applyRulesSchema.parse({ dryRun: false, items: [{ transactionId: UUID_A, ruleId: UUID_B }] }),
    ).toEqual({ dryRun: false, items: [{ transactionId: UUID_A, ruleId: UUID_B }] });
  });

  it('recusa id que nao e uuid e corpo sem dryRun', () => {
    expect(applyRulesSchema.safeParse({ dryRun: false, items: [{ transactionId: 'x', ruleId: UUID_B }] }).success).toBe(false);
    expect(applyRulesSchema.safeParse({ ruleId: UUID_A }).success).toBe(false);
    expect(applyRulesSchema.safeParse(null).success).toBe(false);
  });
});

describe('fronteira servidor -> tela da aplicacao de regras', () => {
  it('a previa tipada pelo servidor passa pelo schema da tela', () => {
    const proposal: RuleApplicationProposal = {
      transactionId: UUID_A,
      occurredOn: '2026-09-05',
      description: 'IRMAOS BOA',
      amountCents: cents(-1000),
      ruleId: UUID_B,
      rulePattern: 'irmaos boa',
      categoryId: UUID_A,
      categoryName: 'Mercado',
    };
    expect(ruleApplicationPreviewSchema.parse({ proposals: [proposal] })).toEqual({ proposals: [proposal] });
  });

  it('o resultado tipado pelo servidor passa pelo schema da tela', () => {
    const result: RuleApplicationResult = { applied: 2, skipped: 1, propagated: 3 };
    expect(ruleApplicationResultSchema.parse(result)).toEqual(result);
  });
});
