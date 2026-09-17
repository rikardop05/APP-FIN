import { and, eq, lt, sql } from 'drizzle-orm';
import type { Adapter, AdapterUser, VerificationToken } from 'next-auth/adapters';

import { db, members, verificationTokens } from '@/lib/db';

import { isAllowedEmail } from './allowlist';

/**
 * Adapter minimo do Auth.js (T-004), ligado ao schema do APPFIN — nao ao schema
 * padrao do Auth.js. Nao ha tabela de `users`/`accounts`/`sessions`: o "usuario"
 * do Auth.js e o `member` (SPEC §2), a sessao e JWT em cookie e o login e so por
 * e-mail.
 *
 * **Metodos exigidos pelo fluxo `email` + sessao JWT** (conferidos no codigo do
 * Auth.js, `lib/actions/callback/handle-login.js` — nao adivinhados):
 * `getUserByEmail`, `updateUser`, `createVerificationToken`,
 * `useVerificationToken`; e `createUser`, que aqui **lanca de proposito**.
 * `getUser` entra quando ha `sessionToken` a decodificar (`session.sub`).
 *
 * Nao faltam opcionais: `createSession`, `getSessionAndUser`, `deleteSession`,
 * `linkAccount` e `getUserByAccount` so existem para sessao em banco, OAuth e
 * WebAuthn — nenhum dos tres e o caso aqui. A ausencia de `updateUser` antes
 * quebrou o login com `TypeError: updateUser is not a function`, por isso a
 * lista agora esta escrita aqui: o proximo metodo a faltar aparece so quando
 * alguem roda o fluxo, nunca no teste de unidade.
 *
 * Decisoes de seguranca:
 * - `createUser` **lanca**. Nao existe cadastro nem auto-registro (RNF-01): se
 *   o e-mail nao tem `member` semeado, o login falha em vez de criar conta.
 * - `updateUser` e **no-op de escrita** (le e devolve; ver o metodo).
 * - o `token` guardado ja chega **hasheado** do Auth.js; o valor em claro nunca
 *   toca o banco.
 * - `useVerificationToken` faz `delete ... returning`: consumir o token e
 *   apaga-lo na mesma operacao, o que da o single-use.
 */
export function createAuthAdapter(): Adapter {
  return {
    async getUser(id: string): Promise<AdapterUser | null> {
      const row = await findMemberById(id);
      return row ? toAdapterUser(row) : null;
    },

    async getUserByEmail(email: string): Promise<AdapterUser | null> {
      const row = await findMemberByEmail(email);
      return row ? toAdapterUser(row) : null;
    },

    async updateUser(
      user: Partial<AdapterUser> & Pick<AdapterUser, 'id'>,
    ): Promise<AdapterUser> {
      // **No-op de escrita.** `members` e tabela de DOMINIO; estado de
      // autenticacao nao mora nela. O Auth.js chama `updateUser` ao concluir a
      // verificacao de um membro ja existente, para marcar `emailVerified` —
      // informacao que a aplicacao nao usa: completar o magic link ja E a
      // sessao, a allowlist e fixa e nao ha cadastro (RNF-01). Persistir isso
      // exigiria uma coluna de auth em tabela de dominio e migration nova, por
      // nenhum ganho.
      //
      // A leitura NAO e opcional: o Auth.js usa o retorno como o `user` do
      // login, e e daqui que saem `email` e `householdId` para o token. Devolver
      // so o que entrou (`{ id, emailVerified }`) perderia `householdId`, e a
      // sessao nasceria sem ele — exatamente o vazamento que `toAppSession`
      // recusa.
      const row = await findMemberById(user.id);
      if (!row) {
        throw new Error('updateUser chamado para membro inexistente.');
      }
      return toAdapterUser(row);
    },

    async createUser(): Promise<never> {
      // Fecha em vez de abrir: sem membro, sem conta.
      throw new Error(
        'O APPFIN nao tem cadastro: o acesso e restrito a allowlist fixa (RNF-01).',
      );
    },

    async createVerificationToken(token: VerificationToken): Promise<VerificationToken> {
      // Terceira porta da allowlist. O Auth.js dispara o envio e a gravacao do
      // token em paralelo (`Promise.all`); recusar aqui impede que uma
      // requisicao direta ao endpoint com e-mail de fora deixe linha orfa na
      // tabela (poderiam acumular, e o `identifier` fica em claro).
      if (!isAllowedEmail(token.identifier)) {
        throw new Error('Magic link recusado: endereco fora da allowlist.');
      }

      // Purga o que expirou: so o uso apaga, e um link pedido e nunca usado
      // ficaria na tabela para sempre. `now()` e do Postgres, nao relogio JS
      // (CONVENTIONS §4 proibe ler relogio em /lib).
      await db
        .delete(verificationTokens)
        .where(lt(verificationTokens.expires, sql`now()`));

      await db
        .insert(verificationTokens)
        .values({
          identifier: token.identifier,
          token: token.token,
          expires: token.expires,
        })
        .onConflictDoNothing();
      return token;
    },

    async useVerificationToken(params: {
      identifier: string;
      token: string;
    }): Promise<VerificationToken | null> {
      const rows = await db
        .delete(verificationTokens)
        .where(
          and(
            eq(verificationTokens.identifier, params.identifier),
            eq(verificationTokens.token, params.token),
          ),
        )
        .returning();

      const row = rows[0];
      if (!row) return null;

      return {
        identifier: row.identifier,
        token: row.token,
        expires: row.expires,
      };
    },
  };
}

/** Campos de `members` que o Auth.js usa. */
type MemberRow = {
  id: string;
  email: string;
  name: string;
  householdId: string;
};

async function findMemberById(id: string): Promise<MemberRow | undefined> {
  const rows = await db.select().from(members).where(eq(members.id, id)).limit(1);
  return rows[0];
}

async function findMemberByEmail(email: string): Promise<MemberRow | undefined> {
  const normalized = email.trim().toLowerCase();
  const rows = await db
    .select()
    .from(members)
    .where(eq(members.email, normalized))
    .limit(1);
  return rows[0];
}

/**
 * Mapeia a linha de `members` para o `User` do Auth.js. `householdId` viaja
 * junto (aumento de tipo em `types.ts`) para o callback `jwt` gravar no token.
 */
function toAdapterUser(row: MemberRow): AdapterUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    // O login e por magic link; nao ha provedor externo a verificar.
    emailVerified: null,
    householdId: row.householdId,
  };
}
