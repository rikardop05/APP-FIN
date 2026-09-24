import { NextResponse } from 'next/server';

import { requireSession, SessionMissingError } from '@/lib/auth/session';
import { listImportBatches } from '@/lib/db/queries/import-history';

/**
 * GET /api/import/history
 *
 * Histórico de lotes do household para a tela /importar (T-111, FASE 3).
 * Devolve todos os lotes — `committed`, `reverted`, `pending`, `failed` —
 * ordenados por `createdAt` desc. Filtro de household vem exclusivamente de
 * `requireSession()` (CONVENTIONS §7 + CONTRACTS §17); nenhum cookie,
 * parâmetro de URL ou body é usado para resolver a origem dos dados.
 */
export async function GET() {
  try {
    const { householdId } = await requireSession();
    const batches = await listImportBatches(householdId);
    return NextResponse.json({ batches });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    return NextResponse.json(
      { error: 'Não foi possível carregar o histórico de importações.' },
      { status: 500 },
    );
  }
}
