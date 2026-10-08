import { NextResponse } from 'next/server';

import { requireSession, SessionMissingError } from '@/lib/auth/session';
import { BudgetReferenceError, replaceBudgets } from '@/lib/db/queries/budgets';

import { loadBudgetMonthResponse } from './month';
import { budgetsQuerySchema, saveBudgetsBodySchema } from './schemas';

/**
 * GET /api/budgets?period=YYYY-MM
 *
 * Orçamento do mês: `plannedCents` gravado, `spentCents` REALIZADO (`posted`),
 * `upcomingCents` PREVISTO (`planned`), `expectedCents` = os dois somados, e o uso, a
 * folga (`remainingCents`) e o semáforo calculados sobre o esperado (decisão 10b).
 * Tudo vem de `budgetStatus` (CONTRACTS §10); esta rota não calcula nada.
 */
export async function GET(request: Request) {
  try {
    const { householdId } = await requireSession();
    const url = new URL(request.url);
    const query = budgetsQuerySchema.safeParse({ period: url.searchParams.get('period') });
    if (!query.success) {
      return NextResponse.json(
        { error: query.error.issues[0]?.message ?? 'Competência inválida.' },
        { status: 400 },
      );
    }
    return NextResponse.json(await loadBudgetMonthResponse(householdId, query.data.period));
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Não foi possível carregar o orçamento.' }, { status: 500 });
  }
}

/**
 * PUT /api/budgets
 *
 * Substitui o CONJUNTO de orçamentos do mês, numa transação. É o ÚNICO caminho
 * que grava orçamento, e só roda quando a pessoa confirma: "repetir mês
 * anterior" e "média de 3 meses" (`/api/budgets/suggestion`) preenchem o
 * formulário e nada mais.
 */
export async function PUT(request: Request) {
  try {
    const { householdId } = await requireSession();
    const payload: unknown = await request.json().catch(() => null);
    const parsed = saveBudgetsBodySchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Dados do orçamento inválidos.' },
        { status: 400 },
      );
    }
    const { period, items } = parsed.data;
    await replaceBudgets(householdId, period, items);
    return NextResponse.json(await loadBudgetMonthResponse(householdId, period));
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof BudgetReferenceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Não foi possível salvar o orçamento.' }, { status: 500 });
  }
}
