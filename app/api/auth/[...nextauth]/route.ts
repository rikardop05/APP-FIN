import { handlers } from '@/lib/auth';

/**
 * Rotas do Auth.js (signin, callback, verify-request, signout, session).
 * Runtime Node porque o adapter fala Postgres; o middleware, que roda em borda,
 * nao toca este arquivo (importa apenas `lib/auth/config`).
 */
export const runtime = 'nodejs';

export const { GET, POST } = handlers;
