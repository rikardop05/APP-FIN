import { NextResponse } from 'next/server';

import { requireSession, SessionMissingError } from '@/lib/auth/session';
import { suggestPlannedForManual } from '@/lib/db/queries/manual-reconcile';

import { manualTransactionBodySchema } from '../schemas';

/**
 * POST /api/transactions/reconcile-suggestion — decisão 16a. Recebe o RASCUNHO do lançamento
 * manual (o mesmo corpo do POST de criação) e devolve a previsão de recorrência que ele
 * cumpriria, para a tela PERGUNTAR antes de gravar. Só leitura: não grava nada.
 */
export async function POST(request: Request) {
  try {
    const { householdId } = await requireSession();
    const payload: unknown = await request.json().catch(() => null);
    const result = manualTransactionBodySchema.safeParse(payload);
    if (!result.success) {
      return NextResponse.json({ error: 'Dados do lançamento inválidos.' }, { status: 400 });
    }
    const suggestion = await suggestPlannedForManual(householdId, result.data);
    return NextResponse.json({ suggestion });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Não foi possível procurar a previsão.' }, { status: 500 });
  }
}
