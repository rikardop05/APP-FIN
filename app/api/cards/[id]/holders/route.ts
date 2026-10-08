import { NextResponse } from 'next/server';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import {
  CardNotFoundError,
  InvalidCardHolderError,
  upsertCardHolder,
} from '@/lib/db/queries/card-holders';
import { listCards, listMembers } from '@/lib/db/queries/cards';
import { cardHolderBodySchema, cardIdSchema } from '../../schemas';

/** Final do cartao -> membro (decisao 20). Upsert por (cartao, final). */

type RouteContext = { params: Promise<{ id: string }> };

async function responseFor(householdId: string) {
  const [cards, members] = await Promise.all([
    listCards(householdId),
    listMembers(householdId),
  ]);
  return { cards, members };
}

const INVALID_HOLDER = 'Informe os 4 últimos dígitos do cartão e um membro da casa.';

export async function PUT(request: Request, context: RouteContext) {
  try {
    const [{ id }, session] = await Promise.all([context.params, requireSession()]);
    const cardId = cardIdSchema.safeParse(id);
    if (!cardId.success) return NextResponse.json({ error: 'Cartão não encontrado.' }, { status: 404 });
    const payload: unknown = await request.json().catch(() => null);
    const body = cardHolderBodySchema.safeParse(payload);
    if (!body.success) return NextResponse.json({ error: INVALID_HOLDER }, { status: 400 });

    await upsertCardHolder(session.householdId, cardId.data, body.data);
    return NextResponse.json(await responseFor(session.householdId));
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof CardNotFoundError) {
      return NextResponse.json({ error: 'Cartão não encontrado.' }, { status: 404 });
    }
    if (error instanceof InvalidCardHolderError) {
      return NextResponse.json({ error: INVALID_HOLDER }, { status: 400 });
    }
    return NextResponse.json({ error: 'Não foi possível salvar o final do cartão.' }, { status: 500 });
  }
}
