import { NextResponse } from 'next/server';

import { requireSession, SessionMissingError } from '@/lib/auth/session';
import { todayInSaoPaulo } from '@/app/_lib/today';
import { listAccounts, listMembers } from '@/lib/db/queries/cards';
import {
  createIncome,
  listIncomes,
} from '@/lib/db/queries/recurring';
import { cents } from '@/lib/money';

import { incomeBodySchema } from './schemas';

/**
 * GET /api/incomes — receitas (ativas e inativas) da família, com os membros
 * para o seletor de responsável. Sem despesas aqui — a tela tem rota própria.
 */
export async function GET() {
  try {
    const { householdId } = await requireSession();
    const [incomes, members, accounts] = await Promise.all([
      listIncomes(householdId),
      listMembers(householdId),
      listAccounts(householdId),
    ]);
    return NextResponse.json({
      incomes,
      options: { members, accounts: accounts.filter((account) => account.active) },
    });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    return NextResponse.json(
      { error: 'Não foi possível listar as receitas.' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
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
    const id = await createIncome(
      householdId,
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
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    const message =
      error instanceof Error && error.name === 'RecurringReferenceError'
        ? error.message
        : 'Não foi possível criar a receita.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
