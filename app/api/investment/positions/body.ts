import type { SnapshotInput } from '@/lib/db/queries/investment-positions';

import { snapshotBodySchema } from './schemas';

/**
 * Corpo -> registro, ou a mensagem de erro. Data no futuro é recusada: posição é o que JÁ
 * está investido. `today` vem da rota (o relógio só é lido em `app/`).
 */
export function parseSnapshotBody(
  payload: unknown,
  today: string,
): { ok: true; input: SnapshotInput } | { ok: false; error: string } {
  const parsed = snapshotBodySchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados do registro inválidos.' };
  if (parsed.data.asOf > today) return { ok: false, error: 'A data da posição não pode estar no futuro.' };
  return { ok: true, input: parsed.data };
}
