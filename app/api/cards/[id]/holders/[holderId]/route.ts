import { NextResponse } from 'next/server';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import { CardHolderNotFoundError, deleteCardHolder } from '@/lib/db/queries/card-holders';
import { listCards, listMembers } from '@/lib/db/queries/cards';
import { cardHolderIdSchema, cardIdSchema } from '../../../schemas';

type RouteContext = { params: Promise<{ id: string; holderId: string }> };

async function responseFor(householdId: string) {
  const [cards, members] = await Promise.all([
    listCards(householdId),
    listMembers(householdId),
  ]);
  return { cards, members };
}

const NOT_FOUND = 'Final de cartão não encontrado.';

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const [{ id, holderId }, session] = await Promise.all([context.params, requireSession()]);
    const cardId = cardIdSchema.safeParse(id);
    const holder = cardHolderIdSchema.safeParse(holderId);
    if (!cardId.success || !holder.success) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }
    await deleteCardHolder(session.householdId, cardId.data, holder.data);
    return NextResponse.json(await responseFor(session.householdId));
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof CardHolderNotFoundError) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }
    return NextResponse.json({ error: 'Não foi possível remover o final do cartão.' }, { status: 500 });
  }
}
