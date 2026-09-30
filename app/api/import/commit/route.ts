import { NextResponse } from 'next/server';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import {
  ImportAccountInstallmentError,
  ImportAlreadyCommittedError,
  ImportSourceNotFoundError,
  commitImport,
} from '@/lib/db/queries/import';
import { commitBodySchema } from '../schemas';

export async function POST(request: Request) {
  try {
    const { householdId } = await requireSession();
    const payload: unknown = await request.json().catch(() => null);
    const parsed = commitBodySchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Dados de confirmação inválidos.' }, { status: 400 });
    }
    const result = await commitImport(householdId, {
      ...parsed.data,
      confirmedRows: parsed.data.confirmedRows,
      // O schema chama o campo `defaultCompetence` (mesmo nome do upload, de onde
      // o usuário escolheu); o motor quer `statementCompetence`. Conta: o campo
      // é opcional, vira `null`. Cartão: o schema validou que veio preenchido.
      statementCompetence: parsed.data.defaultCompetence ?? null,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof ImportAlreadyCommittedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof ImportAccountInstallmentError || error instanceof ImportSourceNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Não foi possível gravar a importação.' }, { status: 500 });
  }
}
