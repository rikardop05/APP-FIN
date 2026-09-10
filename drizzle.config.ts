import { defineConfig } from 'drizzle-kit';

/**
 * Config do drizzle-kit.
 *
 * `drizzle-kit generate` le apenas `schema` e `out` — nao precisa de banco, e
 * por isso a migration inicial do T-002a e gerada offline. `drizzle-kit
 * migrate` usa `dbCredentials`, e so roda no T-002b, quando o humano
 * provisionar o Postgres e preencher `DATABASE_URL`.
 */

// Carrega .env.local / .env sem dependencia extra (Node 20.12+).
for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Arquivo ausente e esperado: em `generate` nao ha credencial nenhuma.
  }
}

export default defineConfig({
  dialect: 'postgresql',
  // Os dois arquivos: o drizzle-kit coleta `pgEnum`/`pgTable` dos *exports* de
  // cada caminho listado. Sem `enums.ts` aqui, a migration sai referenciando
  // tipos que ela mesma nunca cria, e falha em banco limpo.
  schema: ['./lib/db/schema.ts', './lib/db/enums.ts'],
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  // SQL legivel, conforme SPEC §2.1 ("migrations versionadas em SQL legivel").
  verbose: true,
  strict: true,
});
