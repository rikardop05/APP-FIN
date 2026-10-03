import { NextResponse } from 'next/server';

import { todayInSaoPaulo } from '@/app/_lib/today';
import { requireSession } from '@/lib/auth/session';
import { exportHousehold, transactionsCsv } from '@/lib/db/queries/backup';

import { failure } from './errors';

export const dynamic = 'force-dynamic';

/**
 * GET /api/backup: o household da sessão inteiro num arquivo JSON (`appfin-backup`, v1).
 * GET /api/backup?format=csv: só os lançamentos, em CSV para planilha pt-BR. Um arquivo
 * por tabela num .zip exigiria dependência nova; ficou só `transactions` (decisão do
 * contrato do T-402). Só leitura.
 */
export async function GET(request: Request) {
  try {
    const { householdId } = await requireSession();
    const backup = await exportHousehold(householdId, new Date().toISOString());
    const day = todayInSaoPaulo();
    if (new URL(request.url).searchParams.get('format') === 'csv') {
      return new NextResponse(transactionsCsv(backup), {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="appfin-lancamentos-${day}.csv"`,
          'cache-control': 'no-store',
        },
      });
    }
    return new NextResponse(JSON.stringify(backup, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="appfin-backup-${day}.json"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return failure(error, 'Não foi possível gerar o backup.');
  }
}
