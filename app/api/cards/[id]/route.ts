import { NextResponse } from 'next/server';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import {
  deactivateCard,
  InvalidCardReferenceError,
  listCards,
  listMembers,
  updateCard,
  type CardMutation,
} from '@/lib/db/queries/cards';
import { cardBodySchema, cardIdSchema } from '../schemas';

type RouteContext = { params: Promise<{ id: string }> };

async function getId(context: RouteContext) {
  const { id } = await context.params;
  const result = cardIdSchema.safeParse(id);
  return result.success ? result.data : null;
}

async function responseFor(householdId: string) {
  const [cards, members] = await Promise.all([
    listCards(householdId),
    listMembers(householdId),
  ]);
  return { cards, members };
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const [id, session] = await Promise.all([getId(context), requireSession()]);
    if (!id) return NextResponse.json({ error: 'Cartão inválido.' }, { status: 400 });
    const payload: unknown = await request.json().catch(() => null);
    const result = cardBodySchema.safeParse(payload);
    if (!result.success) {
      return NextResponse.json({ error: 'Dados do cartão inválidos.' }, { status: 400 });
    }
    const input: CardMutation = result.data;
    await updateCard(session.householdId, id, input);
    return NextResponse.json(await responseFor(session.householdId));
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof InvalidCardReferenceError) {
      return NextResponse.json({ error: 'Referência de conta ou responsável inválida.' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Não foi possível atualizar o cartão.' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const [id, session] = await Promise.all([getId(context), requireSession()]);
    if (!id) return NextResponse.json({ error: 'Cartão inválido.' }, { status: 400 });
    await deactivateCard(session.householdId, id);
    return NextResponse.json(await responseFor(session.householdId));
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Não foi possível desativar o cartão.' }, { status: 500 });
  }
}
