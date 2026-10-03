import { NextResponse } from 'next/server';

import { SessionMissingError } from '@/lib/auth/session';

import { domainFailure } from './domain-errors';

/** Erro -> resposta HTTP. Compartilhado por `route.ts` e `[id]/route.ts`. */
export function failure(error: unknown, fallback: string) {
  if (error instanceof SessionMissingError) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  }
  const domain = domainFailure(error);
  if (domain !== null) return NextResponse.json({ error: domain.error }, { status: domain.status });
  return NextResponse.json({ error: fallback }, { status: 500 });
}
