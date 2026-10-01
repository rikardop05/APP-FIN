import { NextResponse } from 'next/server';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import {
  InvalidTransactionReferenceError,
  TransactionNotFoundError,
  updateTransaction,
} from '@/lib/db/queries/transactions';
import { deleteTransaction, InvalidDeleteScopeError } from '@/lib/db/queries/transaction-delete';
import { deleteScopeSchema, transactionIdSchema, transactionUpdateSchema } from '../schemas';

type RouteContext = { params: Promise<{ id: string }> };

async function getId(context: RouteContext) {
  const { id } = await context.params;
  const result = transactionIdSchema.safeParse(id);
  return result.success ? result.data : null;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const [id, session] = await Promise.all([getId(context), requireSession()]);
    if (!id) return NextResponse.json({ error: 'Lançamento inválido.' }, { status: 400 });
    const payload: unknown = await request.json().catch(() => null);
    const result = transactionUpdateSchema.safeParse(payload);
    if (!result.success) {
      return NextResponse.json({ error: 'Dados do lançamento inválidos.' }, { status: 400 });
    }
    await updateTransaction(session.householdId, id, result.data);
    return NextResponse.json({ id });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof TransactionNotFoundError) {
      return NextResponse.json({ error: 'Lançamento não encontrado.' }, { status: 404 });
    }
    if (error instanceof InvalidTransactionReferenceError) {
      return NextResponse.json({ error: 'Categoria ou responsável inválido.' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Não foi possível atualizar o lançamento.' }, { status: 500 });
  }
}

/**
 * DELETE /api/transactions/[id]?scope=only|with-future
 *
 * Exclusão de verdade, em qualquer lançamento, sem lista de exceções. Devolve o
 * que REALMENTE apagou. Irreversível: o app não tem desfazer. O que a exclusão
 * alcança é calculado por `GET .../delete-impact`, com a mesma função.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const [id, session] = await Promise.all([getId(context), requireSession()]);
    if (!id) return NextResponse.json({ error: 'Lançamento inválido.' }, { status: 400 });
    const scope = deleteScopeSchema.safeParse(new URL(request.url).searchParams.get('scope') ?? 'only');
    if (!scope.success) return NextResponse.json({ error: 'Escopo inválido.' }, { status: 400 });
    const deleted = await deleteTransaction(session.householdId, id, scope.data);
    return NextResponse.json({ id, deleted });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof TransactionNotFoundError) {
      return NextResponse.json({ error: 'Lançamento não encontrado.' }, { status: 404 });
    }
    if (error instanceof InvalidDeleteScopeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Não foi possível excluir o lançamento.' }, { status: 500 });
  }
}
