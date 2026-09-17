import { NextResponse } from 'next/server';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import {
  categorizeTransactionsBatch,
  InvalidTransactionReferenceError,
} from '@/lib/db/queries/transactions';
import { batchCategorizationSchema } from '../schemas';

export async function POST(request: Request) {
  try {
    const { householdId } = await requireSession();
    const payload: unknown = await request.json().catch(() => null);
    const result = batchCategorizationSchema.safeParse(payload);
    if (!result.success) {
      return NextResponse.json({ error: 'Dados da categorização inválidos.' }, { status: 400 });
    }
    const updated = await categorizeTransactionsBatch(householdId, result.data);
    return NextResponse.json({ updated });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof InvalidTransactionReferenceError) {
      return NextResponse.json({ error: 'Lançamento, categoria ou responsável inválido.' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Não foi possível categorizar os lançamentos.' }, { status: 500 });
  }
}
