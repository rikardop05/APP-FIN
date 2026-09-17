import type { DefaultSession } from 'next-auth';

/**
 * Aumento de tipo do Auth.js: a sessao carrega o `householdId` e o `memberId`,
 * que sao a fronteira de isolamento (CONVENTIONS §7) e o autor do lancamento.
 *
 * Ficam no token (JWT) e sobem para a sessao pelos callbacks em `config.ts`; e
 * o que permite o helper `getSession()` resolver os dois **sem ir ao banco** a
 * cada requisicao.
 *
 * O token nao precisa de aumento: o `JWT` do Auth.js tem indice `unknown`, e
 * `config.ts` o estreita com `typeof` ao copiar para a sessao — sem `as`.
 */

declare module 'next-auth' {
  interface Session {
    user: {
      householdId: string;
      memberId: string;
    } & DefaultSession['user'];
  }

  interface User {
    householdId: string;
  }
}
