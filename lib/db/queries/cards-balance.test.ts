import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local o teste fica pulado.
  }
}

/**
 * Integração de propósito: o corte por data (`opening_date`, `through`), o status e a conta
 * inativa só se provam contra o SQL real, e a igualdade com a abertura do Fluxo só vale se as
 * DUAS consultas rodarem sobre as mesmas linhas.
 *
 * Disciplina do banco único: household PRÓPRIO, apagado no `finally`.
 */
describe.skipIf(process.env.DATABASE_URL === undefined)('listAccountsWithBalance contra o banco real', () => {
  it('saldo por conta e total; no corte do dia 1 bate com a abertura do Fluxo', async () => {
    const [{ db }, schema, { listAccountsWithBalance }, { getCashflowData }] = await Promise.all([
      import('@/lib/db'),
      import('@/lib/db/schema'),
      import('./cards'),
      import('./cashflow'),
    ]);
    const { accounts, creditCards, households, transactions } = schema;

    const [household] = await db
      .insert(households)
      .values({ name: 'Lote1 saldo por conta test' })
      .returning({ id: households.id });
    if (household === undefined) throw new Error('Household de teste não foi criado.');
    const householdId = household.id;

    try {
      const [main] = await db
        .insert(accounts)
        .values({ householdId, name: 'A principal', kind: 'checking', openingBalanceCents: 100_000, openingDate: '2026-01-01' })
        .returning({ id: accounts.id });
      const [savings] = await db
        .insert(accounts)
        .values({ householdId, name: 'B reserva', kind: 'savings', openingBalanceCents: 50_000, openingDate: '2026-10-05' })
        .returning({ id: accounts.id });
      const [future] = await db
        .insert(accounts)
        .values({ householdId, name: 'C futura', kind: 'cash', openingBalanceCents: 7_000, openingDate: '2026-12-01' })
        .returning({ id: accounts.id });
      const [inactive] = await db
        .insert(accounts)
        .values({ householdId, name: 'D inativa', kind: 'checking', openingBalanceCents: 999_999, openingDate: '2026-01-01', active: false })
        .returning({ id: accounts.id });
      const [card] = await db
        .insert(creditCards)
        .values({ householdId, name: 'Cartão teste', closingDay: 1, dueDay: 10 })
        .returning({ id: creditCards.id });
      if (main === undefined || savings === undefined || future === undefined || inactive === undefined || card === undefined) {
        throw new Error('Fixture não foi criada.');
      }

      const base = { householdId, rawDescription: '', description: 'x' } as const;
      const [real] = await db
        .insert(transactions)
        // O `posted` que cumpre a previsão conciliada mais abaixo.
        .values({ ...base, accountId: main.id, occurredOn: '2026-09-15', competence: '2026-09', cashDate: '2026-09-15', amountCents: -10_000, kind: 'expense', status: 'posted' })
        .returning({ id: transactions.id });
      if (real === undefined) throw new Error('Lançamento real não foi criado.');
      await db.insert(transactions).values([
        // --- A principal ---
        // Previsão já cumprida pelo real acima: NÃO move a conta de novo.
        { ...base, accountId: main.id, occurredOn: '2026-09-15', competence: '2026-09', cashDate: '2026-09-15', amountCents: -10_000, kind: 'expense', status: 'reconciled', reconciledByTransactionId: real.id },
        // Antes de `opening_date`: o saldo informado já o contém.
        { ...base, accountId: main.id, occurredOn: '2025-12-31', competence: '2025-12', cashDate: '2025-12-31', amountCents: -2_500, kind: 'expense', status: 'posted' },
        // No próprio `opening_date`: entra (saldo de INÍCIO do dia).
        { ...base, accountId: main.id, occurredOn: '2026-01-01', competence: '2026-01', cashDate: '2026-01-01', amountCents: -5_000, kind: 'expense', status: 'posted' },
        // Pagamento de fatura e transferência movem a conta.
        { ...base, accountId: main.id, occurredOn: '2026-09-20', competence: '2026-09', cashDate: '2026-09-20', amountCents: -30_000, kind: 'credit_card_payment', status: 'posted' },
        { ...base, accountId: main.id, occurredOn: '2026-10-06', competence: '2026-10', cashDate: '2026-10-06', amountCents: -20_000, kind: 'transfer', status: 'posted' },
        // Sem `cash_date`: vale o `occurred_on`.
        { ...base, accountId: main.id, occurredOn: '2026-10-05', competence: '2026-10', cashDate: null, amountCents: 200_000, kind: 'income', status: 'posted' },
        // No próprio dia do corte: entra.
        { ...base, accountId: main.id, occurredOn: '2026-10-10', competence: '2026-10', cashDate: '2026-10-10', amountCents: -1_000, kind: 'expense', status: 'posted' },
        // Depois do corte: fora.
        { ...base, accountId: main.id, occurredOn: '2026-10-11', competence: '2026-10', cashDate: '2026-10-11', amountCents: -400, kind: 'expense', status: 'posted' },
        // Previsto: não aconteceu.
        { ...base, accountId: main.id, occurredOn: '2026-10-08', competence: '2026-10', cashDate: '2026-10-08', amountCents: -1_111, kind: 'expense', status: 'planned' },
        // --- B reserva (opening_date 2026-10-05) ---
        { ...base, accountId: savings.id, occurredOn: '2026-10-04', competence: '2026-10', cashDate: '2026-10-04', amountCents: 9_999, kind: 'income', status: 'posted' },
        { ...base, accountId: savings.id, occurredOn: '2026-10-06', competence: '2026-10', cashDate: '2026-10-06', amountCents: 20_000, kind: 'transfer', status: 'posted' },
        // --- C futura (opening_date depois do corte): nada soma ---
        { ...base, accountId: future.id, occurredOn: '2026-10-02', competence: '2026-10', cashDate: '2026-10-02', amountCents: -300, kind: 'expense', status: 'posted' },
        // --- D inativa: não aparece ---
        { ...base, accountId: inactive.id, occurredOn: '2026-09-15', competence: '2026-09', cashDate: '2026-09-15', amountCents: -777, kind: 'expense', status: 'posted' },
        // --- Cartão: não é movimento de conta ---
        { ...base, creditCardId: card.id, occurredOn: '2026-09-20', competence: '2026-09', cashDate: '2026-10-08', amountCents: -40_000, kind: 'expense', status: 'posted' },
      ]);

      const today = await listAccountsWithBalance(householdId, '2026-10-10');
      const byName = new Map(today.accounts.map((account) => [account.name, account.currentBalanceCents]));
      expect(today.accounts.map((account) => account.name)).toEqual(['A principal', 'B reserva', 'C futura']);
      // A: 100.000 − 10.000 − 5.000 − 30.000 − 20.000 + 200.000 − 1.000 = 234.000
      //    (fora: −2.500 anterior à abertura, o `reconciled`, o `planned` e o −400 do dia 11).
      expect(byName.get('A principal')).toBe(234_000);
      // B: 50.000 + 20.000 = 70.000 (o +9.999 do dia 4 é anterior à abertura da conta).
      expect(byName.get('B reserva')).toBe(70_000);
      // C: abertura no futuro, só o saldo informado.
      expect(byName.get('C futura')).toBe(7_000);
      // 234.000 + 70.000 + 7.000 = 311.000
      expect(today.totalBalanceCents).toBe(311_000);

      // Corte no último dia do mês anterior = ponto de partida do Fluxo (`< dia 1`).
      // A: 100.000 − 10.000 − 5.000 − 30.000 = 55.000; B: 50.000; C: 7.000 → 112.000.
      const atMonthStart = await listAccountsWithBalance(householdId, '2026-09-30');
      const cashflow = await getCashflowData(householdId, '2026-10-10', 12);
      expect(atMonthStart.totalBalanceCents).toBe(112_000);
      expect(cashflow.openingBalanceCents).toBe(atMonthStart.totalBalanceCents);

      // Outro household não enxerga nada.
      const other = await listAccountsWithBalance('00000000-0000-4000-8000-000000000000', '2026-10-10');
      expect(other).toEqual({ accounts: [], totalBalanceCents: 0 });
    } finally {
      await db.delete(households).where(eq(households.id, householdId));
    }
  });
});
