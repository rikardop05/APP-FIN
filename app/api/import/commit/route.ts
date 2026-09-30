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
    // O schema chama o campo `defaultCompetence` (mesmo nome do upload, de onde
    // o usuário escolheu); o motor quer `statementCompetence`. A uniao
    // discriminada por `sourceKind` estreita o tipo: cartão traz a string
    // (obrigatória), conta traz `null`. Não dá para espalhar `...parsed.data`
    // aqui — o spread alarga a uniao de volta para o tipo largo, perdendo o
    // narrowing. Branches explícitos preservam o tipo.
    const input = parsed.data;
    const commitInput =
      input.sourceKind === 'account'
        ? {
            fileName: input.fileName,
            fileHash: input.fileHash,
            bankKey: input.bankKey,
            format: input.format,
            sourceId: input.sourceId,
            confirmedRows: input.confirmedRows,
            reportedTotalCents: input.reportedTotalCents,
            allowReimport: input.allowReimport,
            sourceKind: 'account' as const,
            statementCompetence: null,
          }
        : {
            fileName: input.fileName,
            fileHash: input.fileHash,
            bankKey: input.bankKey,
            format: input.format,
            sourceId: input.sourceId,
            confirmedRows: input.confirmedRows,
            reportedTotalCents: input.reportedTotalCents,
            allowReimport: input.allowReimport,
            sourceKind: 'credit_card' as const,
            statementCompetence: input.defaultCompetence,
          };
    const result = await commitImport(householdId, commitInput);
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
