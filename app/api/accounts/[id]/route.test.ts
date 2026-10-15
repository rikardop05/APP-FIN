import { describe, expect, it, vi } from 'vitest';

/**
 * Id de outro household em PATCH/DELETE de conta: a query lança
 * `AccountNotFoundError` e a rota responde 404 com a mensagem — nunca 200
 * silencioso. Sessão e banco substituídos: aqui só o mapeamento é testado.
 */

const hoisted = vi.hoisted(() => {
  class SessionMissingError extends Error {}
  class AccountNotFoundError extends Error {
    constructor() {
      super('Conta não encontrada.');
      this.name = 'AccountNotFoundError';
    }
  }
  return {
    SessionMissingError,
    AccountNotFoundError,
    updateAccount: vi.fn(),
    deactivateAccount: vi.fn(),
    listAccounts: vi.fn(),
  };
});

vi.mock('@/lib/auth/session', () => ({
  requireSession: vi.fn(async () => ({ householdId: 'casa-de-teste', memberId: 'membro-de-teste' })),
  SessionMissingError: hoisted.SessionMissingError,
}));

vi.mock('@/lib/db/queries/cards', () => ({
  updateAccount: hoisted.updateAccount,
  deactivateAccount: hoisted.deactivateAccount,
  listAccounts: hoisted.listAccounts,
  AccountNotFoundError: hoisted.AccountNotFoundError,
}));

const ID = '11111111-1111-4111-8111-111111111111';
const context = { params: Promise.resolve({ id: ID }) };

describe('PATCH/DELETE /api/accounts/[id]: conta de outro household vira 404', () => {
  it('PATCH mapeia AccountNotFoundError para 404', async () => {
    hoisted.updateAccount.mockRejectedValueOnce(new hoisted.AccountNotFoundError());
    const { PATCH } = await import('./route');
    const response = await PATCH(
      new Request(`http://localhost/api/accounts/${ID}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Conta',
          kind: 'checking',
          openingBalanceCents: 0,
          openingDate: '2026-01-01',
        }),
      }),
      context,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Conta não encontrada.' });
  });

  it('DELETE mapeia AccountNotFoundError para 404', async () => {
    hoisted.deactivateAccount.mockRejectedValueOnce(new hoisted.AccountNotFoundError());
    const { DELETE } = await import('./route');
    const response = await DELETE(
      new Request(`http://localhost/api/accounts/${ID}`, { method: 'DELETE' }),
      context,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Conta não encontrada.' });
  });
});
