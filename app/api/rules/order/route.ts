import { NextResponse } from 'next/server';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import {
  InvalidRuleOrderError,
  listRules,
  reorderRules,
} from '@/lib/db/queries/rules';
import { ruleOrderSchema } from '../schemas';

/**
 * Reordenacao das regras: recebe a lista **completa** de ids na ordem desejada e
 * grava `priority` = indice. E o que o motor de categorizacao consome
 * (`priority` ascendente), entao a ordem da tela e a ordem do match.
 */
export async function PUT(request: Request) {
  try {
    const { householdId } = await requireSession();
    const payload: unknown = await request.json().catch(() => null);
    const result = ruleOrderSchema.safeParse(payload);
    if (!result.success) {
      return NextResponse.json({ error: 'Ordem inválida.' }, { status: 400 });
    }
    await reorderRules(householdId, result.data.ids);
    const rules = await listRules(householdId);
    return NextResponse.json({ rules });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof InvalidRuleOrderError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Não foi possível reordenar as regras.' }, { status: 500 });
  }
}
