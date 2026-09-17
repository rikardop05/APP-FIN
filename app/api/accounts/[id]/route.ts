import { NextResponse } from 'next/server';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import {
  deactivateAccount,
  listAccounts,
  updateAccount,
  type AccountMutation,
} from '@/lib/db/queries/cards';
import { accountBodySchema, accountIdSchema } from '../schemas';

type RouteContext = { params: Promise<{ id: string }> };

async function getIds(context: RouteContext) {
  const { id } = await context.params;
  const result = accountIdSchema.safeParse(id);
  return result.success ? result.data : null;
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const [id, session] = await Promise.all([getIds(context), requireSession()]);
    if (!id) return NextResponse.json({ error: 'Conta inválida.' }, { status: 400 });
    const payload: unknown = await request.json().catch(() => null);
    const result = accountBodySchema.safeParse(payload);
    if (!result.success) {
      return NextResponse.json({ error: 'Dados da conta inválidos.' }, { status: 400 });
    }
    const input: AccountMutation = result.data;
    await updateAccount(session.householdId, id, input);
    return NextResponse.json({ accounts: await listAccounts(session.householdId) });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Não foi possível atualizar a conta.' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const [id, session] = await Promise.all([getIds(context), requireSession()]);
    if (!id) return NextResponse.json({ error: 'Conta inválida.' }, { status: 400 });
    await deactivateAccount(session.householdId, id);
    return NextResponse.json({ accounts: await listAccounts(session.householdId) });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Não foi possível desativar a conta.' }, { status: 500 });
  }
}
