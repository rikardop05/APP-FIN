import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { settlementByCompetence } from './statement-settlement';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local, a integracao fica pulada.
  }
}

describe('settlementByCompetence: soma pago e pendente por mes', () => {
  it('soma as faturas da mesma competencia e ordena', () => {
    const result = settlementByCompetence([
      { period: '2026-11', paidCents: 0 as never, pendingCents: 5000 as never },
      { period: '2026-10', paidCents: 40000 as never, pendingCents: 60000 as never },
      { period: '2026-10', paidCents: 10000 as never, pendingCents: 0 as never },
    ]);
    expect(result).toEqual([
      { competence: '2026-10', paidCents: 50000, pendingCents: 60000 },
      { competence: '2026-11', paidCents: 0, pendingCents: 5000 },
    ]);
  });
});

describe.skipIf(process.env.DATABASE_URL === undefined)('situacao das faturas e lancamentos (integracao)', () => {
  it('lancamento traz a situacao da fatura; resumo do mes soma pago e pendente; outra casa nao aparece', async () => {
    const [{ db }, schema, { listTransactionsWithSettlement }] = await Promise.all([
      import('@/lib/db'),
      import('@/lib/db/schema'),
      import('./transactions'),
    ]);
    const [household] = await db.insert(schema.households).values({ name: 'Situacao pagamento test' }).returning({ id: schema.households.id });
    if (household === undefined) throw new Error('Household de teste nao criado.');
    try {
      const [card] = await db
        .insert(schema.creditCards)
        .values({ householdId: household.id, name: 'Cartao', closingDay: 1, dueDay: 10 })
        .returning({ id: schema.creditCards.id });
      if (card === undefined) throw new Error('Cartao nao criado.');
      async function statement(period: string, status: 'open' | 'paid', paid: number | null) {
        const [row] = await db
          .insert(schema.statements)
          .values({ creditCardId: card!.id, period, closingDate: `${period}-01`, dueDate: `${period}-10`, status, paidAmountCents: paid, source: 'manual' })
          .returning({ id: schema.statements.id });
        if (row === undefined) throw new Error('Fatura nao criada.');
        return row.id;
      }
      async function tx(competence: string, amount: number, statementId: string | null, description: string) {
        await db.insert(schema.transactions).values({
          householdId: household!.id,
          occurredOn: `${competence}-05`,
          competence,
          description,
          rawDescription: description,
          amountCents: amount,
          kind: 'expense',
          creditCardId: card!.id,
          statementId,
        });
      }
      const parcial = await statement('2026-09', 'paid', 40000);
      const aberta = await statement('2026-10', 'open', null);
      await tx('2026-09', -100000, parcial, 'parcial');
      await tx('2026-10', -30000, aberta, 'aberta');
      await tx('2026-12', -9000, null, 'projetada');

      const { items, settlement } = await listTransactionsWithSettlement(household.id);
      const byName = new Map(items.map((item) => [item.description, item]));
      expect(byName.get('parcial')).toMatchObject({ statementStatus: 'paid', statementPayment: 'partial' });
      expect(byName.get('aberta')).toMatchObject({ statementStatus: 'open', statementPayment: 'none', statementDueDate: '2026-10-10' });
      expect(byName.get('projetada')).toMatchObject({ statementStatus: null, statementPayment: null });
      expect(settlement).toEqual([
        { competence: '2026-09', paidCents: 40000, pendingCents: 60000 },
        { competence: '2026-10', paidCents: 0, pendingCents: 30000 },
      ]);
    } finally {
      await db.delete(schema.households).where(eq(schema.households.id, household.id));
    }
  });
});
