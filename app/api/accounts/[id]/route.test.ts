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
    listAccountsWithBalance: vi.fn(),
  };
});

vi.mock('@/lib/auth/session', () => ({
  requireSession: vi.fn(async () => ({ householdId: 'casa-de-teste', memberId: 'membro-de-teste' })),
  SessionMissingError: hoisted.SessionMissingError,
}));

vi.mock('@/lib/db/queries/cards', () => ({
  updateAccount: hoisted.updateAccount,
  deactivateAccount: hoisted.deactivateAccount,
  listAccountsWithBalance: hoisted.listAccountsWithBalance,
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

  it('PATCH e DELETE com sucesso devolvem o corpo com saldo que a tela de Cartões lê', async () => {
    const { accountListSchema } = await import('@/components/cards/schemas');
    const balances = {
      accounts: [
        {
          id: ID,
          name: 'Conta',
          bank: null,
          kind: 'checking',
          openingBalanceCents: 0,
          openingDate: '2026-01-01',
          active: true,
          currentBalanceCents: 1_500,
        },
      ],
      totalBalanceCents: 1_500,
    };
    const { PATCH, DELETE } = await import('./route');

    hoisted.updateAccount.mockResolvedValueOnce(undefined);
    hoisted.listAccountsWithBalance.mockResolvedValueOnce(balances);
    const patched = await PATCH(
      new Request(`http://localhost/api/accounts/${ID}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Conta', kind: 'checking', openingBalanceCents: 0, openingDate: '2026-01-01' }),
      }),
      context,
    );
    expect(patched.status).toBe(200);
    expect(accountListSchema.safeParse(await patched.json()).success).toBe(true);

    hoisted.deactivateAccount.mockResolvedValueOnce(undefined);
    hoisted.listAccountsWithBalance.mockResolvedValueOnce({ accounts: [], totalBalanceCents: 0 });
    const deleted = await DELETE(new Request(`http://localhost/api/accounts/${ID}`, { method: 'DELETE' }), context);
    expect(deleted.status).toBe(200);
    expect(accountListSchema.safeParse(await deleted.json()).success).toBe(true);
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
