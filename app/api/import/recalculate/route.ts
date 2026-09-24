import { NextResponse } from 'next/server';

import { requireSession, SessionMissingError } from '@/lib/auth/session';
import { finalizeImport } from '@/lib/import/pipeline';

import { recalculateBodySchema } from './schema';

/**
 * POST /api/import/recalculate
 *
 * Recalcula total e competência das linhas CONFIRMADAS na tela de importação,
 * SEM gravar nada. Roda em todo edit (data, valor, parcelamento) para que o
 * `competenceByIndex` e o `totalCents` do rodapé reflitam o que o usuário
 * acabou de digitar — antes do commit.
 *
 * **NÃO grava no banco.** O caminho de gravação é exclusivamente
 * `/api/import/commit`. `finalizeImport` é função pura de `lib/import/pipeline`
 * (ver cabeçalho do módulo — sem `lib/db`, sem `next/*`, sem `fs`, sem
 * `fetch`). Esta rota só faz `finalizeImport(...)` e devolve o resultado como
 * JSON. Obedece RF-IMP-02: nada é gravado antes da confirmação do usuário.
 *
 * Recalcula em cima de `existingHashes: new Set<string>()` propositadamente
 * vazio: a tela de confirmação precisa enxergar as competências de cada linha
 * editada, mesmo que sejam duplicadas de algo já gravado — o que seria
 * problema de dedupe na CONFIRMAÇÃO, não no preview.
 */
export async function POST(request: Request) {
  try {
    await requireSession();
    const payload: unknown = await request.json().catch(() => null);
    const parsed = recalculateBodySchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados para recálculo inválidos.' },
        { status: 400 },
      );
    }

    const input = parsed.data;
    const includedResult = finalizeImport({
      rows: input.rows,
      sourceId: input.sourceId,
      sourceKind: input.sourceKind,
      cardCycle: input.cardCycle,
      existingHashes: new Set<string>(),
      reportedTotalCents: null,
    });
    const competenceResult = finalizeImport({
      rows: input.rows.map((row) => ({ ...row, include: true })),
      sourceId: input.sourceId,
      sourceKind: input.sourceKind,
      cardCycle: input.cardCycle,
      existingHashes: new Set<string>(),
      reportedTotalCents: null,
    });
    const competenceByIndex = input.rows.map((row) => {
      const transaction = competenceResult.transactions.find(
        (candidate) =>
          candidate.rawDescription === row.rawDescription &&
          candidate.installmentNumber === (row.installment?.current ?? null),
      );
      return { index: row.index, competence: transaction?.competence ?? null };
    });

    return NextResponse.json({
      totalCents: includedResult.totals.includedCents,
      competenceByIndex,
    });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    return NextResponse.json(
      { error: 'Não foi possível recalcular a confirmação.' },
      { status: 500 },
    );
  }
}
