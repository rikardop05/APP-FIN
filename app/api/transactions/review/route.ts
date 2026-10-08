import { NextResponse } from 'next/server';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import {
  confirmReviewGroup,
  listReviewGroups,
  ReviewCategoryInvalidError,
  ReviewCategoryKindError,
} from '@/lib/db/queries/review-groups';
import { listTransactionFilterOptions } from '@/lib/db/queries/transactions';
import { reviewGroupConfirmationSchema } from '../schemas';

/** Grupos da tela "Revisar sem categoria" (F4) e as categorias para escolher. */
export async function GET() {
  try {
    const { householdId } = await requireSession();
    const [groups, options] = await Promise.all([
      listReviewGroups(householdId),
      listTransactionFilterOptions(householdId),
    ]);
    return NextResponse.json({ groups, categories: options.categories });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Não foi possível carregar a revisão.' }, { status: 500 });
  }
}

/** Confirma um grupo: categoria escolhida e, se pedido, a regra nova. */
export async function POST(request: Request) {
  try {
    const { householdId } = await requireSession();
    const payload: unknown = await request.json().catch(() => null);
    const result = reviewGroupConfirmationSchema.safeParse(payload);
    if (!result.success) {
      return NextResponse.json({ error: 'Dados da revisão inválidos.' }, { status: 400 });
    }
    return NextResponse.json(await confirmReviewGroup(householdId, result.data));
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof ReviewCategoryInvalidError || error instanceof ReviewCategoryKindError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Não foi possível confirmar o grupo.' }, { status: 500 });
  }
}
