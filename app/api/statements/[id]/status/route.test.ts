import { describe, expect, it, vi } from 'vitest';

/**
 * Rota de marcar/desmarcar fatura como paga. Sessão e banco são substituídos:
 * o que se testa aqui é validação, códigos de status e a forma da resposta.
 */

const hoisted = vi.hoisted(() => {
  class SessionMissingError extends Error {}
  class StatementNotFoundError extends Error {}
  return {
    SessionMissingError,
    StatementNotFoundError,
    requireSession: vi.fn(async () => ({ householdId: 'casa-de-teste', memberId: 'membro-de-teste' })),
    setStatementStatus: vi.fn(),
  };
});

vi.mock('@/lib/auth/session', () => ({
  requireSession: hoisted.requireSession,
  SessionMissingError: hoisted.SessionMissingError,
}));

vi.mock('@/lib/db/queries/statements', () => ({
  setStatementStatus: hoisted.setStatementStatus,
  StatementNotFoundError: hoisted.StatementNotFoundError,
}));

const STATEMENT = '44444444-4444-4444-8444-444444444444';

function post(body: unknown): Request {
  return new Request(`http://localhost/api/statements/${STATEMENT}/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function context(id = STATEMENT) {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/statements/[id]/status', () => {
  it('marca como paga e devolve { id, status }', async () => {
    hoisted.setStatementStatus.mockResolvedValueOnce({ id: STATEMENT, status: 'paid' });
    const { POST } = await import('./route');

    const response = await POST(post({ status: 'paid' }), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: STATEMENT, status: 'paid' });
    expect(hoisted.setStatementStatus).toHaveBeenCalledWith('casa-de-teste', STATEMENT, 'paid');
  });

  it('desmarca: open', async () => {
    hoisted.setStatementStatus.mockResolvedValueOnce({ id: STATEMENT, status: 'open' });
    const { POST } = await import('./route');

    const response = await POST(post({ status: 'open' }), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: STATEMENT, status: 'open' });
    expect(hoisted.setStatementStatus).toHaveBeenCalledWith('casa-de-teste', STATEMENT, 'open');
  });

  it('corpo inválido: 400 sem tocar o banco', async () => {
    hoisted.setStatementStatus.mockClear();
    const { POST } = await import('./route');
    for (const request of [
      post({ status: 'closed' }),
      post({ status: 'PAID' }),
      post({}),
      post({ status: 'paid', extra: 1 }),
      post('isto nao e json'),
    ]) {
      expect((await POST(request, context())).status).toBe(400);
    }
    expect(hoisted.setStatementStatus).not.toHaveBeenCalled();
  });

  it('id que não é uuid e fatura de outro household: 404', async () => {
    const { POST } = await import('./route');
    expect((await POST(post({ status: 'paid' }), context('abc'))).status).toBe(404);

    hoisted.setStatementStatus.mockRejectedValueOnce(new hoisted.StatementNotFoundError());
    const response = await POST(post({ status: 'paid' }), context());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Fatura não encontrada.' });
  });

  it('sem sessão: 401; falha inesperada: 500', async () => {
    const { POST } = await import('./route');
    hoisted.requireSession.mockRejectedValueOnce(new hoisted.SessionMissingError());
    expect((await POST(post({ status: 'paid' }), context())).status).toBe(401);

    hoisted.setStatementStatus.mockRejectedValueOnce(new Error('banco caiu'));
    expect((await POST(post({ status: 'paid' }), context())).status).toBe(500);
  });
});
