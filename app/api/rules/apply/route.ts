import { NextResponse } from 'next/server';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import {
  applyRuleProposals,
  previewRuleApplication,
  RuleToApplyNotFoundError,
} from '@/lib/db/queries/apply-rules';
import { applyRulesSchema } from '../schemas';

/**
 * Aplicar regras aos lancamentos sem categoria (F3). `dryRun: true` so le e
 * devolve a previa; `dryRun: false` grava os itens confirmados nela.
 */
export async function POST(request: Request) {
  try {
    const { householdId } = await requireSession();
    const payload: unknown = await request.json().catch(() => null);
    const result = applyRulesSchema.safeParse(payload);
    if (!result.success) {
      return NextResponse.json({ error: 'Dados da aplicação de regras inválidos.' }, { status: 400 });
    }
    const body = result.data;
    if (body.dryRun) {
      // A prévia vai no TOPO ({ proposals, total }), a forma que a tela lê (CONTRACTS §6.3).
      return NextResponse.json(await previewRuleApplication(householdId, body.ruleId));
    }
    const applied = await applyRuleProposals(householdId, body.items);
    return NextResponse.json(applied);
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof RuleToApplyNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: 'Não foi possível aplicar as regras.' }, { status: 500 });
  }
}
