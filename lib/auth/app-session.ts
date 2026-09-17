import type { Session } from 'next-auth';

/**
 * O que a aplicacao precisa saber sobre quem esta logado.
 *
 * `householdId` e a fronteira de isolamento de toda query (CONVENTIONS §7);
 * `memberId` e quem gastou. Os dois vem do token de sessao, nao de uma consulta
 * ao banco — o helper e leitura pura de sessao.
 */
export type AppSession = {
  householdId: string;
  memberId: string;
};

/**
 * Mapeia a sessao do Auth.js para o formato da aplicacao. **Funcao pura** (sem
 * `next-auth` em runtime, sem banco), por isso e testavel isoladamente.
 *
 * Devolve `null` — nunca um objeto parcial — quando falta qualquer um dos dois
 * ids. Um `householdId` ausente nao pode virar `undefined` silencioso numa
 * query: e exatamente o erro que vazaria dado entre households.
 */
export function toAppSession(session: Session | null): AppSession | null {
  const memberId = session?.user?.memberId;
  const householdId = session?.user?.householdId;

  if (typeof memberId !== 'string' || memberId.length === 0) return null;
  if (typeof householdId !== 'string' || householdId.length === 0) return null;

  return { householdId, memberId };
}
