import NextAuth from 'next-auth';

import { createAuthAdapter } from './adapter';
import { authConfig } from './config';
import { createEmailProvider } from './email-provider';

/**
 * Ponto unico do Auth.js no runtime Node: junta a configuracao edge-safe
 * (`config.ts`), o adapter (Postgres) e o provider de e-mail.
 *
 * O `middleware.ts` **nao** importa daqui — importa `config.ts`, para nao levar
 * o cliente de banco para o runtime de borda.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: createAuthAdapter(),
  providers: [createEmailProvider()],
});
