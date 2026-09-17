import type { NextAuthConfig } from 'next-auth';

import { isAllowedEmail } from './allowlist';

/**
 * Configuracao **edge-safe** do Auth.js: callbacks, paginas e estrategia de
 * sessao. Nao inclui provider nem adapter de proposito — e o que o
 * `middleware.ts` importa, e o middleware roda em runtime de borda, onde o
 * cliente Postgres nao existe.
 *
 * O provider de e-mail e o adapter entram so em `lib/auth/index.ts`, usado pelo
 * route handler (runtime Node). Se ambos estivessem aqui, o Auth.js acusaria
 * `MissingAdapter` ao carregar no middleware.
 */
export const authConfig = {
  // Sessao em cookie JWT (BUILD-PLAN T-004): sem tabela de sessao, sem lookup
  // de banco a cada requisicao. `householdId`/`memberId` viajam no token.
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
    verifyRequest: '/login',
    error: '/login',
  },
  // NAO fixamos `trustHost`. O Auth.js ja tem o default certo: confia no Host
  // quando ha `AUTH_URL`, `AUTH_TRUST_HOST`, `VERCEL`/`CF_PAGES`, ou fora de
  // producao — e **recusa com `UntrustedHost`** em producao sem nenhum deles.
  // Fixar `trustHost: true` desligaria essa ultima protecao (Host forjado
  // viraria URL de callback). Producao exige `AUTH_URL` (ver `.env.example`).
  callbacks: {
    // Defesa em profundidade: o envio ja recusa fora da allowlist, mas o login
    // tambem. Nenhuma das duas portas aceita sozinha.
    signIn({ user }) {
      return typeof user.email === 'string' && isAllowedEmail(user.email);
    },
    // No primeiro login, `user` e o membro resolvido pelo adapter. Grava os dois
    // ids no token; nas requisicoes seguintes o token ja os carrega.
    jwt({ token, user }) {
      if (user) {
        if (typeof user.id === 'string' && user.id.length > 0) {
          token.memberId = user.id;
        }
        if (typeof user.householdId === 'string' && user.householdId.length > 0) {
          token.householdId = user.householdId;
        }
      }
      return token;
    },
    // Expoe os ids na sessao que `getSession()` le. O token e `Record<string,
    // unknown>`; o `typeof` estreita sem `as` e um token sem o campo vira `''`,
    // que `toAppSession` recusa (nunca um id `undefined` numa query).
    session({ session, token }) {
      session.user.memberId =
        typeof token.memberId === 'string' ? token.memberId : '';
      session.user.householdId =
        typeof token.householdId === 'string' ? token.householdId : '';
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
