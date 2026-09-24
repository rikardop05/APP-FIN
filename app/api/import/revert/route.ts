import { NextResponse } from 'next/server';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import {
  ImportBatchNotFoundError,
  revertImport,
} from '@/lib/db/queries/import';
import { revertBodySchema } from '../schemas';

export async function POST(request: Request) {
  try {
    const { householdId } = await requireSession();
    const payload: unknown = await request.json().catch(() => null);
    const parsed = revertBodySchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Lote inválido.' }, { status: 400 });
    }
    return NextResponse.json(await revertImport(householdId, parsed.data.batchId));
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof ImportBatchNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: 'Não foi possível desfazer a importação.' }, { status: 500 });
  }
}
