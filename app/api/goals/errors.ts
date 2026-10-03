import { NextResponse } from 'next/server';

import { SessionMissingError } from '@/lib/auth/session';
import { EmergencyFundExistsError, GoalNotFoundError, GoalReferenceError } from '@/lib/db/queries/goals';

/** Erro de domínio -> resposta HTTP. Compartilhado por `route.ts` e `[id]/route.ts`. */
export function failure(error: unknown, fallback: string) {
  if (error instanceof SessionMissingError) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  }
  if (error instanceof GoalNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof GoalReferenceError) {
    return NextResponse.json({ error: 'Conta inválida para a meta.' }, { status: 400 });
  }
  if (error instanceof EmergencyFundExistsError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}
