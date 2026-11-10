import { NextResponse } from 'next/server';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import { categoryKindFailure } from './category-kind-failure';
import {
  countUncategorized,
  createManualTransaction,
  getMonthSummary,
  InvalidTransactionReferenceError,
  listTransactionFilterOptions,
  listTransactionsWithSettlement,
  type ManualTransactionMutation,
} from '@/lib/db/queries/transactions';
import { PlannedNotReconcilableError } from '@/lib/db/queries/manual-reconcile';
import {
  manualTransactionBodySchema,
  transactionFiltersSchema,
} from './schemas';

function filtersFromRequest(request: Request) {
  const params = new URL(request.url).searchParams;
  return transactionFiltersSchema.safeParse({
    competence: params.get('competence') || undefined,
    direction: params.get('direction') || undefined,
    origin: params.get('origin') || undefined,
    from: params.get('from') || undefined,
    to: params.get('to') || undefined,
    categoryId: params.get('categoryId') || undefined,
    accountId: params.get('accountId') || undefined,
    creditCardId: params.get('creditCardId') || undefined,
    memberId: params.get('memberId') || undefined,
    search: params.get('search') || undefined,
    uncategorized: params.get('uncategorized') === 'true',
  });
}

export async function GET(request: Request) {
  try {
    const { householdId } = await requireSession();
    const filters = filtersFromRequest(request);
    if (!filters.success) {
      return NextResponse.json({ error: 'Filtros inválidos.' }, { status: 400 });
    }
    // `summary` (Receitas, Despesas, Sobra do mês, do motor do Painel) só existe com um mês
    // escolhido, e é do mês INTEIRO: os outros filtros não entram nele. `uncategorizedCount`
    // é do household, não do filtro (botão "Revisar N sem categoria").
    const [{ items: transactions, settlement }, options, summary, uncategorizedCount] = await Promise.all([
      listTransactionsWithSettlement(householdId, filters.data),
      listTransactionFilterOptions(householdId),
      filters.data.competence === undefined ? null : getMonthSummary(householdId, filters.data.competence),
      countUncategorized(householdId),
    ]);
    return NextResponse.json({ transactions, options, settlement, summary, uncategorizedCount });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Não foi possível carregar os lançamentos.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { householdId } = await requireSession();
    const payload: unknown = await request.json().catch(() => null);
    const result = manualTransactionBodySchema.safeParse(payload);
    if (!result.success) {
      return NextResponse.json({ error: 'Dados do lançamento inválidos.' }, { status: 400 });
    }
    const { reconcilePlannedId, ...input }: ManualTransactionMutation & { reconcilePlannedId: string | null } = result.data;
    // Decisão 16a: só concilia a previsão que a pessoa confirmou (nunca sozinho).
    const id = await createManualTransaction(householdId, input, { reconcilePlannedId });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof PlannedNotReconcilableError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const kindFailure = categoryKindFailure(error);
    if (kindFailure !== null) {
      return NextResponse.json({ error: kindFailure.error }, { status: kindFailure.status });
    }
    if (error instanceof InvalidTransactionReferenceError) {
      return NextResponse.json({ error: 'Conta, cartão, categoria ou responsável inválido.' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Não foi possível criar o lançamento.' }, { status: 500 });
  }
}
