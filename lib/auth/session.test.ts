import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `requireSession` e consumido por rotas que precisam distinguir "sem sessao"
 * (401) de erro inesperado (500). A distincao tem de ser por **tipo**
 * (`SessionMissingError`), nunca pelo texto da mensagem — este teste trava essa
 * propriedade. `./index` (Auth.js + Postgres) e dublado: aqui testamos so a
 * resolucao de sessao.
 */

const hoisted = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock('./index', () => ({ auth: hoisted.auth }));

import { SessionMissingError, getSession, requireSession } from './session';

const SESSION = {
  user: { householdId: 'household-1', memberId: 'member-1' },
  expires: '2099-01-01T00:00:00.000Z',
};

beforeEach(() => {
  hoisted.auth.mockReset();
});

describe('getSession', () => {
  it('devolve os ids quando ha sessao', async () => {
    hoisted.auth.mockResolvedValue(SESSION);

    expect(await getSession()).toEqual({ householdId: 'household-1', memberId: 'member-1' });
  });

  it('devolve null quando nao ha sessao (sem lancar)', async () => {
    hoisted.auth.mockResolvedValue(null);

    expect(await getSession()).toBeNull();
  });
});

describe('requireSession', () => {
  it('devolve os ids quando ha sessao', async () => {
    hoisted.auth.mockResolvedValue(SESSION);

    expect(await requireSession()).toEqual({ householdId: 'household-1', memberId: 'member-1' });
  });

  it('lanca SessionMissingError quando nao ha sessao', async () => {
    hoisted.auth.mockResolvedValue(null);

    await expect(requireSession()).rejects.toBeInstanceOf(SessionMissingError);
  });

  it('o erro e reconhecivel por tipo, com nome estavel (a mensagem pode mudar)', async () => {
    hoisted.auth.mockResolvedValue(null);

    let caught: unknown;
    try {
      await requireSession();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SessionMissingError);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe('SessionMissingError');
  });
});
