import { NextResponse } from 'next/server';

import { requireSession, SessionMissingError } from '@/lib/auth/session';
import { TransactionNotFoundError } from '@/lib/db/queries/transactions';
import { getDeleteImpact, InvalidDeleteScopeError } from '@/lib/db/queries/transaction-delete';

import { deleteScopeSchema, transactionIdSchema } from '../../schemas';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/transactions/[id]/delete-impact?scope=only|with-future
 *
 * Tudo que o diálogo de confirmação diz, calculado AQUI. A tela só transforma em
 * frase: uma tela que calculasse "quantas parcelas futuras" divergiria do que o
 * `DELETE` apaga de fato, e a confirmação viraria mentira. Só leitura.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const [{ id: rawId }, session] = await Promise.all([context.params, requireSession()]);
    const id = transactionIdSchema.safeParse(rawId);
    if (!id.success) return NextResponse.json({ error: 'Lançamento inválido.' }, { status: 400 });
    const scope = deleteScopeSchema.safeParse(new URL(request.url).searchParams.get('scope') ?? 'only');
    if (!scope.success) return NextResponse.json({ error: 'Escopo inválido.' }, { status: 400 });
    return NextResponse.json(await getDeleteImpact(session.householdId, id.data, scope.data));
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
    return NextResponse.json({ error: 'Não foi possível calcular o que será excluído.' }, { status: 500 });
  }
}
