import { NextResponse } from 'next/server';

import { todayInSaoPaulo } from '@/app/_lib/today';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import { listAccounts, listCards } from '@/lib/db/queries/cards';
import { listCategories } from '@/lib/db/queries/categories';
import {
  createRecurringExpense,
  listRecurringExpenses,
} from '@/lib/db/queries/recurring';
import { cents, basisPoints } from '@/lib/money';

import { recurringExpenseBodySchema } from './schemas';

/**
 * GET /api/recurring — despesas fixas ativas e inativas da família, mais as
 * opções que o formulário precisa (categorias folha, contas, cartões). Não
 * devolve `incomes` — a tela de receitas tem rota própria.
 */
export async function GET() {
  try {
    const { householdId } = await requireSession();
    const [expenses, categories, accounts, cards] = await Promise.all([
      listRecurringExpenses(householdId),
      listCategories(householdId),
      listAccounts(householdId),
      listCards(householdId),
    ]);
    return NextResponse.json({
      expenses,
      options: {
        categories: categories.filter((category) => category.parentId !== null),
        accounts: accounts.filter((account) => account.active),
        cards: cards.filter((card) => card.active),
      },
    });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    return NextResponse.json(
      { error: 'Não foi possível listar as despesas fixas.' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
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
    const id = await createRecurringExpense(
      householdId,
      {
        description: body.description,
        // Banco guarda saida como negativo; Zod aceita o que a tela mandar e
        // a tela ja inverte o sinal. Sem normalizacao adicional — a borda
        // converte via Money.
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
        : 'Não foi possível criar a despesa fixa.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
