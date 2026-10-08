import { describe, expect, it } from 'vitest';
import { ruleOfferAcceptedSchema, ruleOfferResponseSchema } from '@/components/transactions/schemas';
import type { RuleApplicationResult } from '@/lib/db/queries/apply-rules';
import type { RuleOffer } from '@/lib/db/queries/user-rules';
import { ruleOfferSchema } from './schemas';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('fronteira servidor -> tela da oferta de regra', () => {
  it('oferta e aceite tipados pelo servidor passam pelos schemas da tela', () => {
    const offer: RuleOffer = { pattern: 'irmaos boa', categoryId: A, categoryName: 'Mercado', matchingIds: [B], total: 1 };
    expect(ruleOfferResponseSchema.parse({ offer })).toEqual({ offer });
    expect(ruleOfferResponseSchema.parse({ offer: null })).toEqual({ offer: null });
    const accepted: RuleApplicationResult & { ruleId: string } = { ruleId: A, applied: 1, skipped: 0, propagated: 0 };
    expect(ruleOfferAcceptedSchema.parse(accepted)).toEqual(accepted);
  });
});

describe('ruleOfferSchema', () => {
  it('previa aceita o trecho editado, aparado', () => {
    expect(ruleOfferSchema.parse({ dryRun: true, transactionIds: [A], pattern: ' irmaos ' })).toEqual({
      dryRun: true,
      transactionIds: [A],
      pattern: 'irmaos',
    });
  });

  it('previa exige ao menos uma linha', () => {
    expect(ruleOfferSchema.safeParse({ dryRun: true, transactionIds: [] }).success).toBe(false);
    expect(ruleOfferSchema.parse({ dryRun: true, transactionIds: [A] })).toEqual({ dryRun: true, transactionIds: [A] });
  });

  it('aceite apara o padrao e recusa padrao vazio', () => {
    expect(ruleOfferSchema.parse({ dryRun: false, transactionIds: [A], pattern: ' kabum ', matchingIds: [] })).toEqual({
      dryRun: false,
      transactionIds: [A],
      pattern: 'kabum',
      matchingIds: [],
    });
    expect(ruleOfferSchema.safeParse({ dryRun: false, transactionIds: [A], pattern: '  ', matchingIds: [] }).success).toBe(false);
  });
});
