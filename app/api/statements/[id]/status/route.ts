import { NextResponse } from 'next/server';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import { setStatementStatus, StatementNotFoundError } from '@/lib/db/queries/statements';
import { statementIdSchema, statementStatusBodySchema } from '../../schemas';

type RouteContext = { params: Promise<{ id: string }> };

const NOT_FOUND = 'Fatura não encontrada.';

/** Marca (`paid`) ou desmarca (`open`) a fatura como paga. Devolve `{ id, status }`. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const [{ id }, session] = await Promise.all([context.params, requireSession()]);
    const statementId = statementIdSchema.safeParse(id);
    if (!statementId.success) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }
    const payload: unknown = await request.json().catch(() => null);
    const body = statementStatusBodySchema.safeParse(payload);
    if (!body.success) {
      return NextResponse.json({ error: 'Status da fatura inválido.' }, { status: 400 });
    }
    return NextResponse.json(
      await setStatementStatus(session.householdId, statementId.data, body.data.status),
    );
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof StatementNotFoundError) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }
    return NextResponse.json({ error: 'Não foi possível atualizar a fatura.' }, { status: 500 });
  }
}
