import { NextResponse } from 'next/server';

import { todayInSaoPaulo } from '@/app/_lib/today';
import { requireSession } from '@/lib/auth/session';
import { deleteGoal, updateGoal } from '@/lib/db/queries/goals';

import { failure } from '../errors';
import { loadGoalsResponse } from '../load';
import { goalBodySchema, goalIdSchema } from '../schemas';
import { toGoalInput } from '../to-input';

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
  try {
    const [{ id: rawId }, session] = await Promise.all([context.params, requireSession()]);
    const id = goalIdSchema.safeParse(rawId);
    if (!id.success) return NextResponse.json({ error: 'Meta inválida.' }, { status: 400 });
    const payload: unknown = await request.json().catch(() => null);
    const parsed = goalBodySchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Dados da meta inválidos.' },
        { status: 400 },
      );
    }
    const today = todayInSaoPaulo();
    await updateGoal(
      session.householdId,
      id.data,
      await toGoalInput(parsed.data, session.householdId, today),
    );
    return NextResponse.json(await loadGoalsResponse(session.householdId, today));
  } catch (error) {
    return failure(error, 'Não foi possível salvar a meta.');
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const [{ id: rawId }, session] = await Promise.all([context.params, requireSession()]);
    const id = goalIdSchema.safeParse(rawId);
    if (!id.success) return NextResponse.json({ error: 'Meta inválida.' }, { status: 400 });
    await deleteGoal(session.householdId, id.data);
    return NextResponse.json(await loadGoalsResponse(session.householdId, todayInSaoPaulo()));
  } catch (error) {
    return failure(error, 'Não foi possível excluir a meta.');
  }
}
