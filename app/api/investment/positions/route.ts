import { NextResponse } from 'next/server';

import { todayInSaoPaulo } from '@/app/_lib/today';
import { requireSession } from '@/lib/auth/session';
import { saveSnapshot } from '@/lib/db/queries/investment-positions';

import { parseSnapshotBody } from './body';
import { failure } from './errors';
import { loadPositionsResponse } from './load';

export const dynamic = 'force-dynamic';

/**
 * GET /api/investment/positions: registros de posição, aporte efetivo dos 12 meses fechados
 * + o corrente, aderência e comparação com a curva de cada cenário, já calculadas
 * (`lib/finance/positions`). Esta rota não calcula.
 */
export async function GET() {
  try {
    const { householdId } = await requireSession();
    return NextResponse.json(await loadPositionsResponse(householdId, todayInSaoPaulo()));
  } catch (error) {
    return failure(error, 'Não foi possível carregar as posições.');
  }
}

/** POST: registra a posição da data (já existe nesse dia = edita, D2). Não mexe no plano (D4). */
export async function POST(request: Request) {
  try {
    const { householdId } = await requireSession();
    const today = todayInSaoPaulo();
    const body = parseSnapshotBody(await request.json().catch(() => null), today);
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
    const saved = await saveSnapshot(householdId, body.input);
    return NextResponse.json(
      { ...(await loadPositionsResponse(householdId, today)), saved },
      { status: saved.replaced ? 200 : 201 },
    );
  } catch (error) {
    return failure(error, 'Não foi possível registrar a posição.');
  }
}
