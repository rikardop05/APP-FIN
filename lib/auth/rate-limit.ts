import { and, eq, gt, sql } from 'drizzle-orm';

import { db, verificationTokens } from '@/lib/db';

/**
 * Limite de envio de magic link. Ambiente serverless: memoria do
 * processo nao serve (cada instancia tem a sua), entao o contador mora no
 * Postgres, na tabela que o proprio Auth.js ja escreve a cada envio.
 *
 * Sem migration nova: `verification_tokens` tem `(identifier, token,
 * expires)`, sem `created_at`. Como o TTL e de 15 minutos
 * (`MAGIC_LINK_TTL_SECONDS` em `magic-link.ts`), "expira depois de
 * agora − 45 min" equivale a "criado na ultima hora", com folga de sobra
 * para a condicao de corrida (o Auth.js grava o token e envia em paralelo).
 * O limite e aproximado de proposito: basta para travar loop, sem
 * precisar de exatidao transacional.
 */

/** Maximo de envios por endereco por hora, antes de calar (sem erro). */
export const MAGIC_LINK_MAX_SENDS_PER_HOUR = 5;

/** Janela em segundos: 45 min cobrem a hora cheia dado o TTL de 15 min. */
const RECENT_WINDOW_SECONDS = 45 * 60;

/** Quantos links foram gerados para o endereco na ultima hora. */
export async function recentMagicLinkSends(identifier: string): Promise<number> {
  const normalized = identifier.trim().toLowerCase();
  const rows = await db
    .select({ expires: verificationTokens.expires })
    .from(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, normalized),
        gt(verificationTokens.expires, sql`now() - ${RECENT_WINDOW_SECONDS} * interval '1 second'`),
      ),
    );
  return rows.length;
}
