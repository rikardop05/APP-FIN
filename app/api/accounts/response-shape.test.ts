import { describe, expect, it, vi } from 'vitest';

import { accountListSchema } from '@/components/cards/schemas';
import { accountsResponseSchema } from '@/components/import/schemas';

/**
 * Fronteira de `GET /api/accounts`: o corpo que a ROTA devolve (com o saldo de hoje por conta e o
 * total) passa no schema real das DUAS telas que o leem, Cartões e Importar. Sessão e banco
 * substituídos: o cálculo do saldo é provado em `lib/db/queries/cards-balance.test.ts`.
 */

const hoisted = vi.hoisted(() => ({
  listAccountsWithBalance: vi.fn(),
  createAccount: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  requireSession: vi.fn(async () => ({ householdId: 'casa-de-teste', memberId: 'membro-de-teste' })),
  SessionMissingError: class SessionMissingError extends Error {},
}));

vi.mock('@/lib/db/queries/cards', () => ({
  listAccountsWithBalance: hoisted.listAccountsWithBalance,
  createAccount: hoisted.createAccount,
}));

const BALANCES = {
  accounts: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Conta corrente',
      bank: 'Banco',
      kind: 'checking',
      openingBalanceCents: 100_000,
      openingDate: '2026-01-01',
      active: true,
      currentBalanceCents: -12_345,
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Carteira',
      bank: null,
      kind: 'cash',
      openingBalanceCents: 0,
      openingDate: '2026-11-01',
      active: true,
      currentBalanceCents: 0,
    },
  ],
  totalBalanceCents: -12_345,
};

describe('GET /api/accounts: corpo com saldo de hoje', () => {
  it('pede o saldo com a data de hoje e as duas telas aceitam a resposta', async () => {
    hoisted.listAccountsWithBalance.mockResolvedValueOnce(BALANCES);
    const { GET } = await import('./route');
    const response = await GET();
    expect(response.status).toBe(200);
    const body: unknown = await response.json();

    expect(hoisted.listAccountsWithBalance).toHaveBeenCalledWith(
      'casa-de-teste',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
    const parsed = accountListSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.totalBalanceCents).toBe(-12_345);
      expect(parsed.data.accounts[0]?.currentBalanceCents).toBe(-12_345);
    }
    expect(accountsResponseSchema.safeParse(body).success).toBe(true);
  });

  it('POST com sucesso devolve o mesmo corpo com saldo (a tela valida a resposta depois de gravar)', async () => {
    hoisted.createAccount.mockResolvedValueOnce(undefined);
    hoisted.listAccountsWithBalance.mockResolvedValueOnce(BALANCES);
    const { POST } = await import('./route');
    const response = await POST(
      new Request('http://localhost/api/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Carteira', bank: null, kind: 'cash', openingBalanceCents: 0, openingDate: '2026-11-01' }),
      }),
    );
    expect(response.status).toBe(201);
    expect(accountListSchema.safeParse(await response.json()).success).toBe(true);
  });

  it('resposta sem o saldo (corpo antigo) é recusada pela tela de Cartões, não exibida como zero', () => {
    const old = {
      accounts: BALANCES.accounts.map((account) => ({
        id: account.id,
        name: account.name,
        bank: account.bank,
        kind: account.kind,
        openingBalanceCents: account.openingBalanceCents,
        openingDate: account.openingDate,
        active: account.active,
      })),
    };
    expect(accountListSchema.safeParse(old).success).toBe(false);
  });
});
