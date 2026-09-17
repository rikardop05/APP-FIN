import { NextResponse } from 'next/server';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import {
  createAccount,
  listAccounts,
  type AccountMutation,
} from '@/lib/db/queries/cards';
import { accountBodySchema } from './schemas';

export async function GET() {
  try {
    const { householdId } = await requireSession();
    return NextResponse.json({ accounts: await listAccounts(householdId) });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Não foi possível carregar as contas.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { householdId } = await requireSession();
    const payload: unknown = await request.json().catch(() => null);
    const result = accountBodySchema.safeParse(payload);
    if (!result.success) {
      return NextResponse.json({ error: 'Dados da conta inválidos.' }, { status: 400 });
    }
    const input: AccountMutation = result.data;
    await createAccount(householdId, input);
    return NextResponse.json({ accounts: await listAccounts(householdId) }, { status: 201 });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Não foi possível criar a conta.' }, { status: 500 });
  }
}
