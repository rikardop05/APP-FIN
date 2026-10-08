import { describe, expect, it, vi } from 'vitest';

import {
  ruleApplicationPreviewSchema,
  ruleApplicationResultSchema,
} from '@/components/transactions/schemas';

/**
 * B1 (laudo do Corvo sobre o CONTRACTS §6.3): a resposta REAL de `POST /api/rules/apply`
 * tem de passar pelos schemas que a tela usa. O `apply-shape.test.ts` valida uma prévia
 * montada à mão e por isso não pegou a rota embrulhando a prévia em `{ proposals: … }`.
 *
 * Sessão e banco são substituídos: o que se testa aqui é a FORMA que a rota devolve.
 */

const hoisted = vi.hoisted(() => {
  class SessionMissingError extends Error {}
  class RuleToApplyNotFoundError extends Error {}
  return {
    SessionMissingError,
    RuleToApplyNotFoundError,
    previewRuleApplication: vi.fn(),
    applyRuleProposals: vi.fn(),
  };
});

vi.mock('@/lib/auth/session', () => ({
  requireSession: vi.fn(async () => ({ householdId: 'casa-de-teste', memberId: 'membro-de-teste' })),
  SessionMissingError: hoisted.SessionMissingError,
}));

vi.mock('@/lib/db/queries/apply-rules', () => ({
  previewRuleApplication: hoisted.previewRuleApplication,
  applyRuleProposals: hoisted.applyRuleProposals,
  RuleToApplyNotFoundError: hoisted.RuleToApplyNotFoundError,
}));

const TX = '11111111-1111-4111-8111-111111111111';
const RULE = '22222222-2222-4222-8222-222222222222';
const CATEGORY = '33333333-3333-4333-8333-333333333333';

function post(body: unknown): Request {
  return new Request('http://localhost/api/rules/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/rules/apply: a resposta da rota passa pelo schema da tela', () => {
  it('dryRun: a prévia vem no topo, { proposals, total }', async () => {
    const preview = {
      proposals: [
        {
          transactionId: TX,
          occurredOn: '2026-10-05',
          description: 'ENEL',
          amountCents: -18000,
          ruleId: RULE,
          rulePattern: 'enel',
          categoryId: CATEGORY,
          categoryName: 'Luz',
        },
      ],
      total: 7,
    };
    hoisted.previewRuleApplication.mockResolvedValueOnce(preview);
    const { POST } = await import('./route');

    const response = await POST(post({ dryRun: true, ruleId: RULE }));
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(ruleApplicationPreviewSchema.parse(body)).toEqual(preview);
    expect(hoisted.previewRuleApplication).toHaveBeenCalledWith('casa-de-teste', RULE);
  });

  it('gravar: { applied, skipped, propagated } no topo', async () => {
    const result = { applied: 3, skipped: 1, propagated: 2 };
    hoisted.applyRuleProposals.mockResolvedValueOnce(result);
    const { POST } = await import('./route');

    const items = [{ transactionId: TX, ruleId: RULE, categoryId: CATEGORY }];
    const response = await POST(post({ dryRun: false, items }));
    expect(response.status).toBe(200);
    expect(ruleApplicationResultSchema.parse(await response.json())).toEqual(result);
    expect(hoisted.applyRuleProposals).toHaveBeenCalledWith('casa-de-teste', items);
  });
});
