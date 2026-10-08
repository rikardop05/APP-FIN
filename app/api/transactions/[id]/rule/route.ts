import { NextResponse } from 'next/server';
import { suggestRulePattern } from '@/lib/finance/categorization';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import {
  getTransactionForRule,
  TransactionNotFoundError,
} from '@/lib/db/queries/transactions';
import { createUserRule, InvalidUserRuleError } from '@/lib/db/queries/user-rules';
import { ruleBodySchema, transactionIdSchema } from '../../schemas';

type RouteContext = { params: Promise<{ id: string }> };

async function getId(context: RouteContext) {
  const { id } = await context.params;
  const result = transactionIdSchema.safeParse(id);
  return result.success ? result.data : null;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const [id, session] = await Promise.all([getId(context), requireSession()]);
    if (!id) return NextResponse.json({ error: 'Lançamento inválido.' }, { status: 400 });
    const source = await getTransactionForRule(session.householdId, id);
    return NextResponse.json({
      ...source,
      suggestion: suggestRulePattern(source.description),
    });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof TransactionNotFoundError) {
      return NextResponse.json({ error: 'Lançamento não encontrado.' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Não foi possível sugerir a regra.' }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const [id, session] = await Promise.all([getId(context), requireSession()]);
    if (!id) return NextResponse.json({ error: 'Lançamento inválido.' }, { status: 400 });
    await getTransactionForRule(session.householdId, id);
    const payload: unknown = await request.json().catch(() => null);
    const result = ruleBodySchema.safeParse(payload);
    if (!result.success) {
      return NextResponse.json({ error: 'Dados da regra inválidos.' }, { status: 400 });
    }
    // Regra do usuario entra no TOPO da ordem (politica unica, F5): a
    // `priority` do corpo nao e mais usada.
    const { pattern, matchType, categoryId, memberId } = result.data;
    const ruleId = await createUserRule(session.householdId, { pattern, matchType, categoryId, memberId });
    return NextResponse.json({ id: ruleId }, { status: 201 });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof TransactionNotFoundError) {
      return NextResponse.json({ error: 'Lançamento não encontrado.' }, { status: 404 });
    }
    if (error instanceof InvalidUserRuleError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Não foi possível criar a regra.' }, { status: 500 });
  }
}
