import { NextResponse } from 'next/server';

import { todayInSaoPaulo } from '@/app/_lib/today';
import { requireSession } from '@/lib/auth/session';
import { createGoal } from '@/lib/db/queries/goals';

import { failure } from './errors';
import { loadGoalsResponse } from './load';
import { goalBodySchema } from './schemas';
import { toGoalInput } from './to-input';

/**
 * GET /api/goals: metas ordenadas por prioridade, já com progresso, aporte mensal
 * necessário e a sugestão da reserva de emergência. Esta rota não calcula nada: o
 * motor é `lib/finance/goals`.
 */
export async function GET() {
  try {
    const { householdId } = await requireSession();
    return NextResponse.json(await loadGoalsResponse(householdId, todayInSaoPaulo()));
  } catch (error) {
    return failure(error, 'Não foi possível carregar as metas.');
  }
}

export async function POST(request: Request) {
  try {
    const { householdId } = await requireSession();
    const payload: unknown = await request.json().catch(() => null);
    const parsed = goalBodySchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Dados da meta inválidos.' },
        { status: 400 },
      );
    }
    const today = todayInSaoPaulo();
    await createGoal(householdId, await toGoalInput(parsed.data, householdId, today));
    return NextResponse.json(await loadGoalsResponse(householdId, today), { status: 201 });
  } catch (error) {
    return failure(error, 'Não foi possível criar a meta.');
  }
}
