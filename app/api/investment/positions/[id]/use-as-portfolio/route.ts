import { NextResponse } from 'next/server';

import { todayInSaoPaulo } from '@/app/_lib/today';
import { requireSession } from '@/lib/auth/session';

import { failure } from '../../errors';
import { loadPositionsResponse } from '../../load';
import { snapshotIdSchema } from '../../schemas';
import { applySnapshotToPlan } from '../../use-as-portfolio';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/investment/positions/[id]/use-as-portfolio — D4, o passo EXPLÍCITO: o valor do
 * registro vira o patrimônio atual do plano. 404 sem plano ou sem o registro.
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const [{ id: rawId }, session] = await Promise.all([context.params, requireSession()]);
    const id = snapshotIdSchema.safeParse(rawId);
    if (!id.success) return NextResponse.json({ error: 'Registro inválido.' }, { status: 400 });
    const today = todayInSaoPaulo();
    await applySnapshotToPlan(session.householdId, id.data, today);
    return NextResponse.json(await loadPositionsResponse(session.householdId, today));
  } catch (error) {
    return failure(error, 'Não foi possível atualizar o patrimônio do plano.');
  }
}
