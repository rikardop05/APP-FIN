import { NextResponse } from 'next/server';

import { requireSession, SessionMissingError } from '@/lib/auth/session';
import {
  deactivateRecurringExpense,
  RecurringReferenceError,
  updateRecurringExpense,
} from '@/lib/db/queries/recurring';
import { basisPoints, cents } from '@/lib/money';

import { recurringExpenseBodySchema } from '../schemas';

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
    const parsed = recurringExpenseBodySchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Dados da despesa inválidos.' },
        { status: 400 },
      );
    }
    const body = parsed.data;
    await updateRecurringExpense(householdId, id, {
      description: body.description,
      expectedCents: cents(body.expectedCents),
      categoryId: body.categoryId,
      dueDay: body.dueDay,
      frequency: body.frequency,
      accountId: body.accountId,
      creditCardId: body.creditCardId,
      startsOn: body.startsOn,
      endsOn: body.endsOn,
      annualAdjustmentBp:
        body.annualAdjustmentBp === null ? null : basisPoints(body.annualAdjustmentBp),
    });
    return NextResponse.json({ id });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof RecurringReferenceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Não foi possível atualizar a despesa fixa.' },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const id = await readId(context);
    if (id === null) return NextResponse.json({ error: 'ID inválido.' }, { status: 400 });
    const { householdId } = await requireSession();
    await deactivateRecurringExpense(householdId, id);
    return NextResponse.json({ id });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof RecurringReferenceError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: 'Não foi possível desativar a despesa fixa.' },
      { status: 500 },
    );
  }
}
