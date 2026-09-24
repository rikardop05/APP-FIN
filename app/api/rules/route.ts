import { NextResponse } from 'next/server';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import { listMembers } from '@/lib/db/queries/cards';
import {
  createRule,
  InvalidRuleReferenceError,
  listRules,
  RuleCategoryNotLeafError,
  type RuleMutation,
} from '@/lib/db/queries/rules';
import { ruleBodySchema } from './schemas';

export async function GET() {
  try {
    const { householdId } = await requireSession();
    const [rules, members] = await Promise.all([
      listRules(householdId),
      listMembers(householdId),
    ]);
    return NextResponse.json({ rules, members });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Não foi possível carregar as regras.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { householdId } = await requireSession();
    const payload: unknown = await request.json().catch(() => null);
    const result = ruleBodySchema.safeParse(payload);
    if (!result.success) {
      return NextResponse.json({ error: 'Dados da regra inválidos.' }, { status: 400 });
    }
    const input: RuleMutation = result.data;
    await createRule(householdId, input);
    const rules = await listRules(householdId);
    return NextResponse.json({ rules }, { status: 201 });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof InvalidRuleReferenceError || error instanceof RuleCategoryNotLeafError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Não foi possível criar a regra.' }, { status: 500 });
  }
}
