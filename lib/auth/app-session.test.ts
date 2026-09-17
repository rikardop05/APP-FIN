import { describe, expect, it } from 'vitest';

import type { Session } from 'next-auth';

import { toAppSession } from './app-session';

/**
 * Aceite 3 do T-004: o helper de sessao devolve `householdId` e `memberId`. E
 * tambem a garantia de que um token incompleto vira `null` em vez de um objeto
 * com `undefined` — o que silenciosamente furaria o filtro por household.
 */

function sessionWith(user: unknown): Session {
  // `as Session` justificado: os casos incluem token incompleto, que o tipo
  // completo de `Session` nao representa — e exatamente o que o helper recusa.
  return { user, expires: '2099-01-01T00:00:00.000Z' } as Session;
}

describe('toAppSession', () => {
  it('devolve householdId e memberId quando os dois existem', () => {
    const result = toAppSession(
      sessionWith({ householdId: 'household-1', memberId: 'member-1' }),
    );

    expect(result).toEqual({ householdId: 'household-1', memberId: 'member-1' });
  });

  it('devolve null quando nao ha sessao', () => {
    expect(toAppSession(null)).toBeNull();
  });

  it('devolve null quando falta memberId', () => {
    expect(toAppSession(sessionWith({ householdId: 'household-1' }))).toBeNull();
  });

  it('devolve null quando falta householdId', () => {
    expect(toAppSession(sessionWith({ memberId: 'member-1' }))).toBeNull();
  });

  it('devolve null quando os ids vem vazios', () => {
    expect(
      toAppSession(sessionWith({ householdId: '', memberId: '' })),
    ).toBeNull();
    expect(
      toAppSession(sessionWith({ householdId: 'household-1', memberId: '' })),
    ).toBeNull();
  });

  it('devolve null quando os ids nao sao string', () => {
    expect(
      toAppSession(sessionWith({ householdId: 1, memberId: 2 })),
    ).toBeNull();
  });
});
