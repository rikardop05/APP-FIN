import { NextResponse } from 'next/server';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import {
  getSettings,
  SettingsMissingError,
  updateSettings,
  type SettingsPatch,
} from '@/lib/db/queries/settings';
import { basisPoints } from '@/lib/money';
import { settingsBodySchema } from './schemas';

/**
 * Premissas globais: **so leitura e atualizacao**. A linha e 1:1 com o
 * household e nasce no seed — nao ha POST nem DELETE.
 */

export async function GET() {
  try {
    const { householdId } = await requireSession();
    const settings = await getSettings(householdId);
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof SettingsMissingError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Não foi possível carregar as premissas.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { householdId } = await requireSession();
    const payload: unknown = await request.json().catch(() => null);
    const result = settingsBodySchema.safeParse(payload);
    if (!result.success) {
      return NextResponse.json({ error: 'Premissas inválidas.' }, { status: 400 });
    }
    const patch: SettingsPatch = {
      ...result.data,
      // A borda recebe numero do JSON e entrega `BasisPoints` a query.
      budgetWarnBp: basisPoints(result.data.budgetWarnBp),
    };
    await updateSettings(householdId, patch);
    const settings = await getSettings(householdId);
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof SettingsMissingError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Não foi possível salvar as premissas.' }, { status: 500 });
  }
}
