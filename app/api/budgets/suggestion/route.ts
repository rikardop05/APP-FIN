import { NextResponse } from 'next/server';

import { requireSession, SessionMissingError } from '@/lib/auth/session';
import { getBudgetSuggestion } from '@/lib/db/queries/budgets';

import { suggestionQuerySchema } from '../schemas';

/**
 * GET /api/budgets/suggestion?period=YYYY-MM&mode=previous|avg3
 *
 * Sugestão de orçamento a partir do REALIZADO dos meses anteriores
 * (`suggestBudgetFromHistory`, ancorada no mês anterior ao orçado).
 *
 * **Só leitura, de propósito.** Uma rota que gravasse o sugerido tiraria da
 * família a decisão sobre o próprio dinheiro: o botão preenche o formulário, e
 * quem grava é a pessoa, ao confirmar.
 */
export async function GET(request: Request) {
  try {
    const { householdId } = await requireSession();
    const url = new URL(request.url);
    const query = suggestionQuerySchema.safeParse({
      period: url.searchParams.get('period'),
      mode: url.searchParams.get('mode'),
    });
    if (!query.success) {
      return NextResponse.json(
        { error: query.error.issues[0]?.message ?? 'Parâmetros inválidos.' },
        { status: 400 },
      );
    }
    const { period, mode } = query.data;
    const suggestions = await getBudgetSuggestion(householdId, period, mode);
    return NextResponse.json({ period, mode, suggestions });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Não foi possível calcular a sugestão.' }, { status: 500 });
  }
}
