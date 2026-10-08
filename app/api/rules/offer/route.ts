import { NextResponse } from 'next/server';
import { requireSession, SessionMissingError } from '@/lib/auth/session';
import {
  acceptRuleOffer,
  getRuleOffer,
  InvalidUserRuleError,
  RuleOfferNoLongerValidError,
} from '@/lib/db/queries/user-rules';
import { ruleOfferSchema } from '../schemas';

/**
 * Oferta de regra depois de categorizar a mao (F5). `dryRun: true` so le;
 * `dryRun: false` cria a regra e categoriza as linhas da oferta.
 */
export async function POST(request: Request) {
  try {
    const { householdId } = await requireSession();
    const payload: unknown = await request.json().catch(() => null);
    const result = ruleOfferSchema.safeParse(payload);
    if (!result.success) {
      return NextResponse.json({ error: 'Dados da oferta de regra inválidos.' }, { status: 400 });
    }
    const body = result.data;
    if (body.dryRun) {
      return NextResponse.json({ offer: await getRuleOffer(householdId, body.transactionIds) });
    }
    const accepted = await acceptRuleOffer(householdId, {
      transactionIds: body.transactionIds,
      pattern: body.pattern,
      matchingIds: body.matchingIds,
    });
    return NextResponse.json(accepted, { status: 201 });
  } catch (error) {
    if (error instanceof SessionMissingError) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    if (error instanceof InvalidUserRuleError || error instanceof RuleOfferNoLongerValidError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: 'Não foi possível criar a regra.' }, { status: 500 });
  }
}
