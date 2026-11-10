/**
 * Fronteira da troca de tipo: o corpo que o EDITOR monta (`buildEditValues`) passa no schema real
 * do `PATCH /api/transactions/[id]`, e a rota devolve 400 com a mensagem quando a query recusa a
 * troca. Sessão e banco substituídos; a regra no banco é provada em
 * `lib/db/queries/transactions-kind-edit.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

import { buildEditValues } from '@/components/transactions/edit-values';
import { cents } from '@/lib/money';
import { transactionUpdateSchema } from './schemas';

const hoisted = vi.hoisted(() => {
  class TransactionKindNotEditableError extends Error {
    constructor() {
      super('O tipo deste lançamento não pode ser alterado.');
    }
  }
  return {
    TransactionKindNotEditableError,
    TransactionKindSignError: class extends Error {},
    TransactionNotFoundError: class extends Error {},
    InvalidTransactionReferenceError: class extends Error {},
    updateTransaction: vi.fn(),
  };
});

vi.mock('@/lib/auth/session', () => ({
  requireSession: vi.fn(async () => ({ householdId: 'casa-de-teste', memberId: 'membro-de-teste' })),
  SessionMissingError: class SessionMissingError extends Error {},
}));

vi.mock('@/lib/db/queries/transactions', () => ({
  updateTransaction: hoisted.updateTransaction,
  TransactionKindNotEditableError: hoisted.TransactionKindNotEditableError,
  TransactionKindSignError: hoisted.TransactionKindSignError,
  TransactionNotFoundError: hoisted.TransactionNotFoundError,
  InvalidTransactionReferenceError: hoisted.InvalidTransactionReferenceError,
}));

vi.mock('@/lib/db/queries/transaction-delete', () => ({
  deleteTransaction: vi.fn(),
  InvalidDeleteScopeError: class extends Error {},
}));

vi.mock('@/lib/db/queries/category-kind', () => ({
  CategoryKindMismatchError: class extends Error {},
}));

const ID = '11111111-1111-4111-8111-111111111111';
const fields = { occurredOn: '2026-11-03', description: 'Nu turbo', categoryId: '', memberId: '' };

function patch(body: unknown) {
  return new Request(`http://localhost/api/transactions/${ID}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/transactions/[id]: troca de tipo', () => {
  it('o corpo do editor com troca de tipo passa no schema e chega inteiro na query', async () => {
    const body = buildEditValues({ kind: 'income' }, { ...fields, typedAmountCents: cents(502_690), kind: 'transfer' });
    const parsed = transactionUpdateSchema.safeParse(JSON.parse(JSON.stringify(body)));
    expect(parsed.success).toBe(true);

    hoisted.updateTransaction.mockResolvedValueOnce(undefined);
    const { PATCH } = await import('./[id]/route');
    const response = await PATCH(patch(body), { params: Promise.resolve({ id: ID }) });
    expect(response.status).toBe(200);
    expect(hoisted.updateTransaction).toHaveBeenCalledWith('casa-de-teste', ID, {
      occurredOn: '2026-11-03',
      description: 'Nu turbo',
      amountCents: 502_690,
      categoryId: null,
      memberId: null,
      kind: 'transfer',
    });
  });

  it('o corpo do editor sem troca de tipo continua passando, sem kind', () => {
    const body = buildEditValues({ kind: 'expense' }, { ...fields, typedAmountCents: cents(1_000), kind: 'expense' });
    const parsed = transactionUpdateSchema.safeParse(JSON.parse(JSON.stringify(body)));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.kind).toBeUndefined();
  });

  it('pagamento de fatura e tipo desconhecido não são tipos de destino', () => {
    expect(transactionUpdateSchema.safeParse({ kind: 'credit_card_payment' }).success).toBe(false);
    expect(transactionUpdateSchema.safeParse({ kind: 'qualquer' }).success).toBe(false);
    expect(transactionUpdateSchema.safeParse({ kind: 'investment_contribution' }).success).toBe(true);
  });

  it('troca recusada pela query vira 400 com a mensagem, não 500', async () => {
    hoisted.updateTransaction.mockRejectedValueOnce(new hoisted.TransactionKindNotEditableError());
    const { PATCH } = await import('./[id]/route');
    const response = await PATCH(patch({ kind: 'transfer' }), { params: Promise.resolve({ id: ID }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'O tipo deste lançamento não pode ser alterado.' });
  });
});
