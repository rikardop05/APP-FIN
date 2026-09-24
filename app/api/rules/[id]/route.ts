import { NextResponse } from 'next/server';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import {
  deleteRule,
  InvalidRuleReferenceError,
  listRules,
  RuleCategoryNotLeafError,
  RuleNotFoundError,
  updateRule,
  type RuleMutation,
} from '@/lib/db/queries/rules';
import { ruleBodySchema, ruleIdSchema } from '../schemas';

type RouteContext = { params: Promise<{ id: string }> };

async function getId(context: RouteContext): Promise<string | null> {
  const { id } = await context.params;
  const result = ruleIdSchema.safeParse(id);
  return result.success ? result.data : null;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const [id, session] = await Promise.all([getId(context), requireSession()]);
    if (id === null) {
      return NextResponse.json({ error: 'Regra inválida.' }, { status: 400 });
    }
    const payload: unknown = await request.json().catch(() => null);
    const result = ruleBodySchema.safeParse(payload);
    if (!result.success) {
      return NextResponse.json({ error: 'Dados da regra inválidos.' }, { status: 400 });
    }
    const input: RuleMutation = result.data;
    await updateRule(session.householdId, id, input);
    const rules = await listRules(session.householdId);
    return NextResponse.json({ rules });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof RuleNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof InvalidRuleReferenceError || error instanceof RuleCategoryNotLeafError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Não foi possível atualizar a regra.' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const [id, session] = await Promise.all([getId(context), requireSession()]);
    if (id === null) {
      return NextResponse.json({ error: 'Regra inválida.' }, { status: 400 });
    }
    await deleteRule(session.householdId, id);
    const rules = await listRules(session.householdId);
    return NextResponse.json({ rules });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof RuleNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: 'Não foi possível excluir a regra.' }, { status: 500 });
  }
}
