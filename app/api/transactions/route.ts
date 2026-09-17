import { NextResponse } from 'next/server';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import {
  createManualTransaction,
  InvalidTransactionReferenceError,
  listTransactionFilterOptions,
  listTransactions,
  type ManualTransactionMutation,
} from '@/lib/db/queries/transactions';
import {
  manualTransactionBodySchema,
  transactionFiltersSchema,
} from './schemas';

function filtersFromRequest(request: Request) {
  const params = new URL(request.url).searchParams;
  return transactionFiltersSchema.safeParse({
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
    const [transactions, options] = await Promise.all([
      listTransactions(householdId, filters.data),
      listTransactionFilterOptions(householdId),
    ]);
    return NextResponse.json({ transactions, options });
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
    const input: ManualTransactionMutation = {
      ...result.data,
    };
    const id = await createManualTransaction(householdId, input);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof InvalidTransactionReferenceError) {
      return NextResponse.json({ error: 'Conta, cartão, categoria ou responsável inválido.' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Não foi possível criar o lançamento.' }, { status: 500 });
  }
}
