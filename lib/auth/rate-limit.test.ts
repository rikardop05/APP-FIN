import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local os testes ficam pulados.
  }
}

/**
 * Contador do limite de magic link: usa a propria tabela de tokens do
 * Auth.js, sem tabela nova. Identificadores de teste sinteticos, apagados no
 * `finally` (disciplina do banco unico).
 */

async function modules() {
  const [{ db }, schema, rateLimit] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('./rate-limit'),
  ]);
  return { db, schema, rateLimit };
}
type Modules = Awaited<ReturnType<typeof modules>>;

const SUFFIX = 'ratelimit-prova@example.invalid';

async function seedToken(m: Modules, identifier: string, token: string, fresh: boolean): Promise<void> {
  const { db, schema } = m;
  await db.insert(schema.verificationTokens).values({
    identifier,
    token,
    // Relogio do Postgres, nao JS (CONVENTIONS §4 proibe `Date` em /lib):
    // fresco expira daqui a 15 min; velho expirou ha 1h.
    // `as` justificado: a coluna e timestamp, e o fragmento SQL e avaliado
    // pelo banco como timestamp.
    expires: (fresh ? sql`now() + interval '15 minutes'` : sql`now() - interval '1 hour'`) as unknown as Date,
  });
}

async function cleanup(m: Modules, identifiers: string[]): Promise<void> {
  const { db, schema } = m;
  for (const identifier of identifiers) {
    await db
      .delete(schema.verificationTokens)
      .where(eq(schema.verificationTokens.identifier, identifier));
  }
}

describe.skipIf(process.env.DATABASE_URL === undefined)('recentMagicLinkSends (banco real)', () => {
  it('conta so os tokens recentes do endereco, sem misturar identificadores', async () => {
    const m = await modules();
    const email = `a-${SUFFIX}`;
    const other = `b-${SUFFIX}`;
    try {
      expect(await m.rateLimit.recentMagicLinkSends(email)).toBe(0);

      for (let i = 0; i < 5; i += 1) {
        await seedToken(m, email, `tok-a-${i}`, true);
      }
      await seedToken(m, other, 'tok-b-0', true);
      // Expirado ha mais de 1h: fora da janela, nao conta.
      await seedToken(m, email, 'tok-a-velho', false);

      expect(await m.rateLimit.recentMagicLinkSends(email)).toBe(5);
      expect(await m.rateLimit.recentMagicLinkSends(other)).toBe(1);
      // Normaliza como a action: caixa alta conta no mesmo endereco.
      expect(await m.rateLimit.recentMagicLinkSends(email.toUpperCase())).toBe(5);
    } finally {
      await cleanup(m, [email, other]);
    }
  });

  it('o teto e 5: com 5 recentes, o sexto envio deve calar', async () => {
    const m = await modules();
    const email = `c-${SUFFIX}`;
    try {
      for (let i = 0; i < 5; i += 1) {
        await seedToken(m, email, `tok-c-${i}`, true);
      }
      const recent = await m.rateLimit.recentMagicLinkSends(email);
      expect(recent).toBeGreaterThanOrEqual(m.rateLimit.MAGIC_LINK_MAX_SENDS_PER_HOUR);
    } finally {
      await cleanup(m, [email]);
    }
  });
});
