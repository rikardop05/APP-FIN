import { NextResponse } from 'next/server';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import {
  createCard,
  InvalidCardReferenceError,
  listCards,
  listMembers,
  type CardMutation,
} from '@/lib/db/queries/cards';
import { cardBodySchema } from './schemas';

export async function GET() {
  try {
    const { householdId } = await requireSession();
    const [cards, members] = await Promise.all([
      listCards(householdId),
      listMembers(householdId),
    ]);
    return NextResponse.json({ cards, members });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Não foi possível carregar os cartões.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { householdId } = await requireSession();
    const payload: unknown = await request.json().catch(() => null);
    const result = cardBodySchema.safeParse(payload);
    if (!result.success) {
      return NextResponse.json({ error: 'Dados do cartão inválidos.' }, { status: 400 });
    }
    const input: CardMutation = result.data;
    await createCard(householdId, input);
    const [cards, members] = await Promise.all([
      listCards(householdId),
      listMembers(householdId),
    ]);
    return NextResponse.json({ cards, members }, { status: 201 });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof InvalidCardReferenceError) {
      return NextResponse.json({ error: 'Referência de conta ou responsável inválida.' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Não foi possível criar o cartão.' }, { status: 500 });
  }
}
