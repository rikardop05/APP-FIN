import { describe, expect, it, vi } from 'vitest';

/**
 * Id de outro household em PATCH/DELETE de cartão: a query lança
 * `CardNotFoundError` e a rota responde 404 com a mensagem — nunca 200
 * silencioso. Sessão e banco substituídos: aqui só o mapeamento é testado.
 */

const hoisted = vi.hoisted(() => {
  class SessionMissingError extends Error {}
  class CardNotFoundError extends Error {
    constructor() {
      super('Cartão não encontrado.');
      this.name = 'CardNotFoundError';
    }
  }
  class InvalidCardReferenceError extends Error {}
  return {
    SessionMissingError,
    CardNotFoundError,
    InvalidCardReferenceError,
    updateCard: vi.fn(),
    deactivateCard: vi.fn(),
    listCards: vi.fn(),
    listMembers: vi.fn(),
  };
});

vi.mock('@/lib/auth/session', () => ({
  requireSession: vi.fn(async () => ({ householdId: 'casa-de-teste', memberId: 'membro-de-teste' })),
  SessionMissingError: hoisted.SessionMissingError,
}));

vi.mock('@/lib/db/queries/cards', () => ({
  updateCard: hoisted.updateCard,
  deactivateCard: hoisted.deactivateCard,
  listCards: hoisted.listCards,
  listMembers: hoisted.listMembers,
  CardNotFoundError: hoisted.CardNotFoundError,
  InvalidCardReferenceError: hoisted.InvalidCardReferenceError,
}));

const ID = '11111111-1111-4111-8111-111111111111';
const context = { params: Promise.resolve({ id: ID }) };

describe('PATCH/DELETE /api/cards/[id]: cartão de outro household vira 404', () => {
  it('PATCH mapeia CardNotFoundError para 404', async () => {
    hoisted.updateCard.mockRejectedValueOnce(new hoisted.CardNotFoundError());
    const { PATCH } = await import('./route');
    const response = await PATCH(
      new Request(`http://localhost/api/cards/${ID}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Cartão',
          brand: 'visa',
          creditLimitCents: null,
          closingDay: 1,
          dueDay: 10,
        }),
      }),
      context,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Cartão não encontrado.' });
  });

  it('DELETE mapeia CardNotFoundError para 404', async () => {
    hoisted.deactivateCard.mockRejectedValueOnce(new hoisted.CardNotFoundError());
    const { DELETE } = await import('./route');
    const response = await DELETE(
      new Request(`http://localhost/api/cards/${ID}`, { method: 'DELETE' }),
      context,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Cartão não encontrado.' });
  });
});
