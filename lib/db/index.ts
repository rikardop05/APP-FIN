import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema.ts';

export * from './enums.ts';
export * from './schema.ts';

/**
 * Conexao unica com o Postgres. Este e o unico lugar do projeto que abre
 * conexao; SQL vive so em `/lib/db` (CONVENTIONS §5).
 *
 * Lembrete de CONVENTIONS §7: **toda query filtra `household_id`.** E a
 * fronteira de isolamento do household, e nao ha excecao.
 */

function readDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL nao esta definida. Copie .env.example para .env.local e preencha.',
    );
  }
  return url;
}

/**
 * Em desenvolvimento o Next recarrega os modulos a cada alteracao; sem o cache
 * global cada reload abriria um pool novo e o Postgres esgotaria as conexoes.
 */
const globalForDb = globalThis as unknown as {
  appfinSql?: ReturnType<typeof postgres>;
};

function getClient(): ReturnType<typeof postgres> {
  const existing = globalForDb.appfinSql;
  if (existing) return existing;

  const client = postgres(readDatabaseUrl(), {
    // O seed e as migrations rodam em processo curto; o app roda em serverless.
    // Um pool pequeno evita estourar o limite do free tier.
    max: 5,
    /**
     * Prepared statement desligado por padrao, por portabilidade. O pooler de
     * transacao do Supabase nao aceita prepared statement nomeado, e o sintoma
     * e erro de runtime na primeira query, nao na conexao. O endpoint pooled do
     * Neon aceita (PgBouncer >= 1.22 suporta prepared statement de protocolo),
     * entao ali isto e conservador, nao obrigatorio. Em conexao direta, ou no
     * Neon pooled, da para ligar de volta com `DATABASE_PREPARE=true` e ganhar
     * um pouco de desempenho.
     */
    prepare: process.env.DATABASE_PREPARE === 'true',
  });

  if (process.env.NODE_ENV !== 'production') {
    globalForDb.appfinSql = client;
  }
  return client;
}

/** Cliente cru do postgres.js. Use `db` no lugar, salvo em migration/seed. */
export const sql = getClient();

/** Handle do Drizzle, com o schema completo acoplado. */
export const db = drizzle(sql, { schema });

export type Database = typeof db;
