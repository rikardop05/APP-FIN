import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local os testes ficam pulados.
  }
}

/**
 * Resposta unica do login: qualquer e-mail recebe `sent`, dentro ou fora da
 * allowlist (sem estado `denied`, sem mensagem distinta).
 *
 * Sem escopo de requisicao aqui, o `after` e os `headers` sao dublados e a
 * action cai no envio direto. O transporte e o console (ambiente de teste,
 * sem SMTP): o teste captura a URL impressa e prova a ida e volta pelo
 * adapter de verdade — o token da URL, hasheado com o segredo, e aceito por
 * `useVerificationToken`, que e o que o callback do Auth.js faz no login.
 */

const ENV_KEY = 'AUTH_ALLOWED_EMAILS';
const SECRET_KEY = 'AUTH_SECRET';
const originalEnv = process.env[ENV_KEY];
const originalSecret = process.env[SECRET_KEY];
const TEST_SECRET = 'segredo-de-prova-123';

vi.mock('next/server', () => ({
  after: () => {
    throw new Error('after fora de escopo de requisicao');
  },
}));

vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ host: 'localhost:3000', 'x-forwarded-proto': 'http' }),
}));

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = originalEnv;
  }
  if (originalSecret === undefined) {
    delete process.env[SECRET_KEY];
  } else {
    process.env[SECRET_KEY] = originalSecret;
  }
  vi.restoreAllMocks();
});

async function login() {
  const [{ db }, schema, actions, state] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('./actions'),
    import('./magic-link-state'),
  ]);
  return { db, schema, ...actions, ...state };
}
type LoginModules = Awaited<ReturnType<typeof login>>;

function formWith(email: string): FormData {
  const form = new FormData();
  form.set('email', email);
  return form;
}

const ALLOWED = 'membro@example.invalid';
const OUTSIDER = 'intruso@example.invalid';
const CAPPED = 'capped@example.invalid';

async function seedTokens(m: LoginModules, identifier: string, count: number): Promise<void> {
  const { sql } = await import('drizzle-orm');
  for (let i = 0; i < count; i += 1) {
    await m.db.insert(m.schema.verificationTokens).values({
      identifier,
      token: `tok-action-${identifier}-${i}`,
      // Relogio do Postgres, nao JS (CONVENTIONS §4).
      // `as` justificado: a coluna e timestamp e o fragmento e avaliado
      // pelo banco como timestamp.
      expires: sql`now() + interval '15 minutes'` as unknown as Date,
    });
  }
}

async function cleanupTokens(m: LoginModules, identifier: string): Promise<void> {
  const { eq } = await import('drizzle-orm');
  await m.db
    .delete(m.schema.verificationTokens)
    .where(eq(m.schema.verificationTokens.identifier, identifier));
}

async function tokenRows(m: LoginModules, identifier: string) {
  const { eq } = await import('drizzle-orm');
  return m.db
    .select()
    .from(m.schema.verificationTokens)
    .where(eq(m.schema.verificationTokens.identifier, identifier));
}

/** Tira o token em claro da URL que o envio imprime no console. */
function tokenFromLoggedUrl(log: ReturnType<typeof vi.fn>): string {
  const printed: string = log.mock.calls.map((call) => String(call[0] ?? '')).join('\n');
  const match = /token=([0-9a-f]+)/.exec(printed);
  if (!match?.[1]) throw new Error('URL do magic link nao foi impressa.');
  return match[1];
}

describe.skipIf(process.env.DATABASE_URL === undefined)('requestMagicLink: mesma resposta sempre', () => {
  it('e-mail fora da allowlist recebe sent, sem token e sem envio', async () => {
    process.env[ENV_KEY] = `${ALLOWED},outro@example.invalid`;
    process.env[SECRET_KEY] = TEST_SECRET;
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const m = await login();
    const state = await m.requestMagicLink({ status: 'idle' }, formWith(OUTSIDER));
    expect(state).toEqual({ status: 'sent' });
    expect(m.messageForStatus(state)).toContain('Se este e-mail tiver acesso');
    expect(await tokenRows(m, OUTSIDER)).toHaveLength(0);
    expect(log).not.toHaveBeenCalled();
  });

  it('e-mail da allowlist recebe o mesmo sent e o link passa no adapter', async () => {
    process.env[ENV_KEY] = `${ALLOWED},outro@example.invalid`;
    process.env[SECRET_KEY] = TEST_SECRET;
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const m = await login();
    try {
      const { createAuthAdapter } = await import('@/lib/auth/adapter');
      const denied = await m.requestMagicLink({ status: 'idle' }, formWith(OUTSIDER));
      const allowed = await m.requestMagicLink({ status: 'idle' }, formWith(ALLOWED));
      expect(allowed).toEqual(denied);
      expect(m.messageForStatus(allowed)).toBe(m.messageForStatus(denied));

      // Ida e volta pelo adapter de verdade: o token da URL, hasheado com o
      // segredo, e consumido — e o que o callback do Auth.js faz.
      const clearToken = tokenFromLoggedUrl(log);
      const adapter = createAuthAdapter();
      const consumed = await adapter.useVerificationToken?.({
        identifier: ALLOWED,
        token: createHash('sha256').update(`${clearToken}${TEST_SECRET}`).digest('hex'),
      });
      expect(consumed?.identifier).toBe(ALLOWED);
      expect(await tokenRows(m, ALLOWED)).toHaveLength(0);
    } finally {
      await cleanupTokens(m, ALLOWED);
    }
  });

  it('acima do teto, cala sem erro e com a mesma resposta', async () => {
    process.env[ENV_KEY] = `${ALLOWED},${CAPPED}`;
    process.env[SECRET_KEY] = TEST_SECRET;
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const m = await login();
    try {
      await seedTokens(m, CAPPED, 5);
      const limited = await m.requestMagicLink({ status: 'idle' }, formWith(CAPPED));
      expect(limited).toEqual({ status: 'sent' });
      expect(log).not.toHaveBeenCalled();
      expect(await tokenRows(m, CAPPED)).toHaveLength(5);
    } finally {
      await cleanupTokens(m, CAPPED);
    }
  });
});
