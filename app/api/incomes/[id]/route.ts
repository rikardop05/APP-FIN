import { NextResponse } from 'next/server';

import { todayInSaoPaulo } from '@/app/_lib/today';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import {
  deactivateIncome,
  RecurringReferenceError,
  updateIncome,
} from '@/lib/db/queries/recurring';
import { cents } from '@/lib/money';

import { incomeBodySchema } from '../schemas';

type RouteContext = { params: Promise<{ id: string }> };

async function readId(context: RouteContext): Promise<string | null> {
  const { id } = await context.params;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const id = await readId(context);
    if (id === null) return NextResponse.json({ error: 'ID inválido.' }, { status: 400 });
    const { householdId } = await requireSession();
    const payload: unknown = await request.json().catch(() => null);
    const parsed = incomeBodySchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Dados da receita inválidos.' },
        { status: 400 },
      );
    }
    const body = parsed.data;
    await updateIncome(
      householdId,
      id,
      {
        description: body.description,
        kind: body.kind,
        expectedCents: cents(body.expectedCents),
        memberId: body.memberId,
        accountId: body.accountId,
        receiveDay: body.receiveDay,
        frequency: body.frequency,
        oneOffCompetence: body.oneOffCompetence,
        startsOn: body.startsOn,
        endsOn: body.endsOn,
      },
      todayInSaoPaulo(),
    );
    return NextResponse.json({ id });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof RecurringReferenceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Não foi possível atualizar a receita.' },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const id = await readId(context);
    if (id === null) return NextResponse.json({ error: 'ID inválido.' }, { status: 400 });
    const { householdId } = await requireSession();
    await deactivateIncome(householdId, id, todayInSaoPaulo());
    return NextResponse.json({ id });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof RecurringReferenceError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: 'Não foi possível desativar a receita.' },
      { status: 500 },
    );
  }
}
