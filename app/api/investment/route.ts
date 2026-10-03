import { NextResponse } from 'next/server';

import { todayInSaoPaulo } from '@/app/_lib/today';
import { requireSession } from '@/lib/auth/session';
import {
  createInvestmentPlan,
  DEFAULT_SCENARIOS,
  updateInvestmentPlan,
} from '@/lib/db/queries/investment';
import { toCompetence } from '@/lib/date';

import { assertComputable } from './compute';
import { failure } from './errors';
import { loadInvestmentResponse } from './load';
import { planBodySchema, planUpdateBodySchema } from './schemas';

/**
 * GET /api/investment: o plano do household (um só), os três cenários e a saída do motor
 * (`scenarioTable` com horizontes 5/10/15/20 e `accumulationCurve` por cenário), com a
 * âncora na competência de hoje em São Paulo. Esta rota não calcula nada além de chamar
 * o motor (`app/api/investment/compute.ts`).
 */
export async function GET() {
  try {
    const { householdId } = await requireSession();
    return NextResponse.json(await loadInvestmentResponse(householdId, todayInSaoPaulo()));
  } catch (error) {
    return failure(error, 'Não foi possível carregar o plano de investimento.');
  }
}

/** POST: cria o plano e os três cenários com os defaults. 409 se já existe. */
export async function POST(request: Request) {
  try {
    const { householdId } = await requireSession();
    const payload: unknown = await request.json().catch(() => null);
    const parsed = planBodySchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Dados do plano inválidos.' },
        { status: 400 },
      );
    }
    const today = todayInSaoPaulo();
    // Antes de gravar: o motor aceita estas premissas? (Recusa -> 400, nada gravado.)
    assertComputable(parsed.data, DEFAULT_SCENARIOS, toCompetence(today));
    await createInvestmentPlan(householdId, parsed.data);
    return NextResponse.json(await loadInvestmentResponse(householdId, today), { status: 201 });
  } catch (error) {
    return failure(error, 'Não foi possível criar o plano de investimento.');
  }
}

/** PUT: substitui as premissas do plano e dos três cenários. 404 se não há plano. */
export async function PUT(request: Request) {
  try {
    const { householdId } = await requireSession();
    const payload: unknown = await request.json().catch(() => null);
    const parsed = planUpdateBodySchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Dados do plano inválidos.' },
        { status: 400 },
      );
    }
    const today = todayInSaoPaulo();
    const { scenarios, ...plan } = parsed.data;
    assertComputable(plan, scenarios, toCompetence(today));
    await updateInvestmentPlan(householdId, plan, scenarios);
    return NextResponse.json(await loadInvestmentResponse(householdId, today));
  } catch (error) {
    return failure(error, 'Não foi possível salvar o plano de investimento.');
  }
}
