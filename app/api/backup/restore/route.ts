import { NextResponse } from 'next/server';

import { requireSession } from '@/lib/auth/session';
import { dryRunRestore, restoreHousehold } from '@/lib/db/queries/backup';

import { failure } from '../errors';

export const dynamic = 'force-dynamic';

/**
 * POST /api/backup/restore?dryRun=1: valida o arquivo inteiro (formato, versão, migration,
 * cada linha contra o schema, FKs internas) e devolve `{ tables, warnings, targetHasData }`
 * sem gravar nada.
 *
 * POST /api/backup/restore: a MESMA validação e, só num household sem nenhum dado, grava
 * tudo numa transação com ids novos. Household com dado -> 409. Nunca sobrescreve.
 */
export async function POST(request: Request) {
  try {
    const { householdId, memberId } = await requireSession();
    const payload: unknown = await request.json().catch(() => null);
    if (payload === null) {
      return NextResponse.json({ error: 'O arquivo não é um JSON válido.' }, { status: 400 });
    }
    if (new URL(request.url).searchParams.get('dryRun') === '1') {
      return NextResponse.json(await dryRunRestore(householdId, payload, memberId));
    }
    const result = await restoreHousehold(householdId, payload, memberId);
    return NextResponse.json({ tables: result.tables, warnings: result.warnings }, { status: 201 });
  } catch (error) {
    return failure(error, 'Não foi possível restaurar o backup.');
  }
}
