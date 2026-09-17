import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VerificationToken } from 'next-auth/adapters';

/**
 * O adapter e a unica peca de auth que fala banco. Aqui o `db` e um duble
 * encadeado, entao da para provar as regras de seguranca sem Postgres:
 * - `createUser` lança (nao existe cadastro, RNF-01);
 * - `createVerificationToken` recusa fora da allowlist **sem gravar**;
 * - `useVerificationToken` consome e some (single-use).
 *
 * E-mails de teste sao sinteticos (`*.invalid`, RFC 2606).
 */

const ALLOWED = 'membro@example.invalid';
const OUTSIDER = 'intruso@example.invalid';
const ENV_KEY = 'AUTH_ALLOWED_EMAILS';

const mocks = vi.hoisted(() => {
  const selectLimit = vi.fn();
  const selectWhere = vi.fn(() => ({ limit: selectLimit }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));

  const insertOnConflictDoNothing = vi.fn(async () => undefined);
  const insertValues = vi.fn(() => ({
    onConflictDoNothing: insertOnConflictDoNothing,
  }));
  const insert = vi.fn(() => ({ values: insertValues }));

  const deleteReturning = vi.fn();
  const deleteWhere = vi.fn(() => ({ returning: deleteReturning }));
  const deleteFn = vi.fn(() => ({ where: deleteWhere }));

  return {
    select,
    selectLimit,
    insert,
    insertValues,
    insertOnConflictDoNothing,
    deleteFn,
    deleteReturning,
  };
});

vi.mock('@/lib/db', async () => {
  const schema = await import('@/lib/db/schema');
  return {
    db: { select: mocks.select, insert: mocks.insert, delete: mocks.deleteFn },
    members: schema.members,
    verificationTokens: schema.verificationTokens,
  };
});

import { createAuthAdapter } from './adapter';

/** Token com `expires: 0` — o teste nao le relogio (ESLint proibe `Date` em /lib). */
function token(identifier: string): VerificationToken {
  // `as unknown as VerificationToken` justificado: `expires` e Date, proibido em
  // lib/** (CONVENTIONS §4); o valor so atravessa para o insert dublado.
  return { identifier, token: 'hash-do-token', expires: 0 } as unknown as VerificationToken;
}

const originalEnv = process.env[ENV_KEY];

beforeEach(() => {
  process.env[ENV_KEY] = `${ALLOWED},outro@example.invalid`;
  vi.clearAllMocks();
  mocks.selectLimit.mockResolvedValue([]);
  mocks.deleteReturning.mockResolvedValue([]);
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = originalEnv;
  }
});

describe('createAuthAdapter', () => {
  it('getUserByEmail devolve o membro com householdId', async () => {
    mocks.selectLimit.mockResolvedValueOnce([
      { id: 'm1', email: ALLOWED, name: 'Membro', householdId: 'h1' },
    ]);

    const user = await createAuthAdapter().getUserByEmail?.(ALLOWED);

    expect(user).toMatchObject({ id: 'm1', email: ALLOWED, householdId: 'h1' });
  });

  it('getUserByEmail devolve null quando nao ha membro', async () => {
    mocks.selectLimit.mockResolvedValueOnce([]);

    expect(await createAuthAdapter().getUserByEmail?.(ALLOWED)).toBeNull();
  });

  it('updateUser devolve o membro (com householdId) sem gravar nada', async () => {
    mocks.selectLimit.mockResolvedValueOnce([
      { id: 'm1', email: ALLOWED, name: 'Membro', householdId: 'h1' },
    ]);

    const user = await createAuthAdapter().updateUser?.({ id: 'm1' });

    expect(user).toMatchObject({ id: 'm1', email: ALLOWED, householdId: 'h1' });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('updateUser lanca se o membro nao existe (fecha em vez de abrir)', async () => {
    mocks.selectLimit.mockResolvedValueOnce([]);

    await expect(createAuthAdapter().updateUser?.({ id: 'fantasma' })).rejects.toThrow();
  });

  it('createUser lanca — nao existe cadastro (RNF-01)', async () => {
    const adapter = createAuthAdapter();

    await expect(
      adapter.createUser?.({
        id: 'novo-membro',
        email: ALLOWED,
        emailVerified: null,
        householdId: 'h1',
      }),
    ).rejects.toThrow(/cadastro|allowlist/i);
  });

  it('createVerificationToken recusa fora da allowlist sem gravar', async () => {
    const adapter = createAuthAdapter();

    await expect(
      adapter.createVerificationToken?.(token(OUTSIDER)),
    ).rejects.toThrow(/allowlist/i);

    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('createVerificationToken grava o token (ja hasheado) do endereco permitido', async () => {
    const adapter = createAuthAdapter();
    const value = token(ALLOWED);

    await adapter.createVerificationToken?.(value);

    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).toHaveBeenCalledWith(value);
  });

  it('useVerificationToken consome e some (single-use)', async () => {
    const adapter = createAuthAdapter();
    const value = token(ALLOWED);

    mocks.deleteReturning.mockResolvedValueOnce([value]);
    expect(
      await adapter.useVerificationToken?.({ identifier: ALLOWED, token: 'hash-do-token' }),
    ).toEqual(value);

    mocks.deleteReturning.mockResolvedValueOnce([]);
    expect(
      await adapter.useVerificationToken?.({ identifier: ALLOWED, token: 'hash-do-token' }),
    ).toBeNull();
  });
});
