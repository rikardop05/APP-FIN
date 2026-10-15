import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local os testes ficam pulados.
  }
}

/**
 * O POST externo em /api/auth/signin/* nao tem uso legitimo: o login usa a
 * server action, que chama o Auth.js em processo (sem HTTP). A rota recusa
 * com 404 antes do Auth.js criar token ou enviar e-mail — e o teste prova
 * que nada foi gravado.
 */

const SIGNIN_URL = 'http://localhost:3000/api/auth/signin/nodemailer';
const FAKE_IDENTIFIER = 'route-guard-prova@example.invalid';

// O Auth.js e duble: o que se prova e a guarda da rota (404 antes do
// Auth.js), nao o handler real.
vi.mock('next-auth', () => ({
  default: () => ({
    handlers: {
      GET: async () => new Response('auth-get'),
      POST: async () => new Response('auth-post'),
    },
    auth: async () => null,
    signIn: async () => 'http://localhost:3000/login',
    signOut: async () => undefined,
  }),
}));

async function handlers() {
  const [{ db }, schema] = await Promise.all([import('@/lib/db'), import('@/lib/db/schema')]);
  const route = await import('./route');
  return { db, schema, route };
}

async function tokenCount(
  db: Awaited<ReturnType<typeof handlers>>['db'],
  schema: Awaited<ReturnType<typeof handlers>>['schema'],
): Promise<number> {
  const rows = await db
    .select({ token: schema.verificationTokens.token })
    .from(schema.verificationTokens)
    .where(eq(schema.verificationTokens.identifier, FAKE_IDENTIFIER));
  return rows.length;
}

describe.skipIf(process.env.DATABASE_URL === undefined)('POST /api/auth/signin/* bloqueado', () => {
  it('POST em signin/nodemailer devolve 404 sem gravar token', async () => {
    const { db, schema, route } = await handlers();
    const response = await route.POST(
      new NextRequest(SIGNIN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email: FAKE_IDENTIFIER, callbackUrl: '/' }),
      }),
    );
    expect(response.status).toBe(404);
    expect(await tokenCount(db, schema)).toBe(0);
  });

  it('GET continua no Auth.js (nao e 404 da guarda)', async () => {
    const { route } = await handlers();
    const response = await route.GET(new NextRequest(SIGNIN_URL, { method: 'GET' }));
    expect(response.status).not.toBe(404);
  });
});
