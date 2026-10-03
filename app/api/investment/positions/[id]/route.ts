import { NextResponse } from 'next/server';

import { todayInSaoPaulo } from '@/app/_lib/today';
import { requireSession } from '@/lib/auth/session';
import { deleteSnapshot, updateSnapshot } from '@/lib/db/queries/investment-positions';

import { parseSnapshotBody } from '../body';
import { failure } from '../errors';
import { loadPositionsResponse } from '../load';
import { snapshotIdSchema } from '../schemas';

type RouteContext = { params: Promise<{ id: string }> };

/** PUT: edita o registro (inclusive a data; data de outro registro -> 409). */
export async function PUT(request: Request, context: RouteContext) {
  try {
    const [{ id: rawId }, session] = await Promise.all([context.params, requireSession()]);
    const id = snapshotIdSchema.safeParse(rawId);
    if (!id.success) return NextResponse.json({ error: 'Registro inválido.' }, { status: 400 });
    const today = todayInSaoPaulo();
    const body = parseSnapshotBody(await request.json().catch(() => null), today);
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
    await updateSnapshot(session.householdId, id.data, body.input);
    return NextResponse.json(await loadPositionsResponse(session.householdId, today));
  } catch (error) {
    return failure(error, 'Não foi possível salvar o registro.');
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const [{ id: rawId }, session] = await Promise.all([context.params, requireSession()]);
    const id = snapshotIdSchema.safeParse(rawId);
    if (!id.success) return NextResponse.json({ error: 'Registro inválido.' }, { status: 400 });
    await deleteSnapshot(session.householdId, id.data);
    return NextResponse.json(await loadPositionsResponse(session.householdId, todayInSaoPaulo()));
  } catch (error) {
    return failure(error, 'Não foi possível excluir o registro.');
  }
}
