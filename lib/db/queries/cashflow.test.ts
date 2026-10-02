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
 * Integração de propósito: a fronteira do saldo de abertura (dia 1, `opening_date`,
 * `credit_card_payment` antes × dentro da janela) só é provada contra o SQL real.
 *
 * Disciplina do banco único (decisão de 2026-09-30): household PRÓPRIO, apagado
 * no `finally`. É a única barreira entre este teste e os dados da casa.
 */
describe.skipIf(process.env.DATABASE_URL === undefined)(
  'getCashflowData contra o banco real',
  () => {
    it('abertura inclui pagamento de fatura ANTERIOR à janela; janela exclui transfer e pagamento', async () => {
      const [{ db }, schema, { getCashflowData }] = await Promise.all([
        import('@/lib/db'),
        import('@/lib/db/schema'),
        import('./cashflow'),
      ]);
      const { accounts, creditCards, households, transactions } = schema;

      const [household] = await db
        .insert(households)
        .values({ name: 'T-207 cashflow query test' })
        .returning({ id: households.id });
      if (household === undefined) throw new Error('Household de teste não foi criado.');
      const householdId = household.id;

      try {
        const [account] = await db
          .insert(accounts)
          .values({
            householdId,
            name: 'Conta teste',
            kind: 'checking',
            openingBalanceCents: 100_000,
            openingDate: '2026-01-01',
          })
          .returning({ id: accounts.id });
        const [inactive] = await db
          .insert(accounts)
          .values({
            householdId,
            name: 'Conta inativa',
            kind: 'checking',
            openingBalanceCents: 999_999,
            openingDate: '2026-01-01',
            active: false,
          })
          .returning({ id: accounts.id });
        const [card] = await db
          .insert(creditCards)
          .values({ householdId, name: 'Cartão teste', closingDay: 1, dueDay: 10 })
          .returning({ id: creditCards.id });
        if (account === undefined || inactive === undefined || card === undefined) {
          throw new Error('Fixture não foi criada.');
        }

        const base = { householdId, rawDescription: '', description: 'x' } as const;
        await db.insert(transactions).values([
          // --- ANTES do dia 1 (entram na abertura, de qualquer kind) ---
          { ...base, accountId: account.id, occurredOn: '2026-09-15', competence: '2026-09', cashDate: '2026-09-15', amountCents: -10_000, kind: 'expense', status: 'posted' },
          { ...base, accountId: account.id, occurredOn: '2026-09-20', competence: '2026-09', cashDate: '2026-09-20', amountCents: -30_000, kind: 'credit_card_payment', status: 'posted' },
          // No próprio `opening_date`: o saldo informado é de INÍCIO do dia, então
          // o movimento do dia NÃO está nele → entra.
          // Antes de `opening_date`: o saldo já o contém → fora (−2.500, em 2025-12-31).
          { ...base, accountId: account.id, occurredOn: '2025-12-31', competence: '2025-12', cashDate: '2025-12-31', amountCents: -2_500, kind: 'expense', status: 'posted' },
          { ...base, accountId: account.id, occurredOn: '2026-01-01', competence: '2026-01', cashDate: '2026-01-01', amountCents: -5_000, kind: 'expense', status: 'posted' },
          // Conta inativa: fora da abertura.
          { ...base, accountId: inactive.id, occurredOn: '2026-09-15', competence: '2026-09', cashDate: '2026-09-15', amountCents: -777, kind: 'expense', status: 'posted' },
          // `planned` não é fato consumado → fora da abertura (e fora da janela: é de setembro).
          { ...base, accountId: account.id, occurredOn: '2026-09-25', competence: '2026-09', cashDate: '2026-09-25', amountCents: -1_111, kind: 'expense', status: 'planned' },

          // --- DENTRO da janela (today = 2026-10-10) ---
          { ...base, accountId: account.id, occurredOn: '2026-10-05', competence: '2026-10', cashDate: '2026-10-05', amountCents: 200_000, kind: 'income', status: 'posted' },
          { ...base, accountId: account.id, occurredOn: '2026-11-05', competence: '2026-11', cashDate: '2026-11-05', amountCents: -8_000, kind: 'expense', status: 'planned' },
          // Pagamento de fatura e transfer dentro da janela: FORA (RC-03).
          { ...base, accountId: account.id, occurredOn: '2026-10-09', competence: '2026-10', cashDate: '2026-10-09', amountCents: -50_000, kind: 'credit_card_payment', status: 'posted' },
          { ...base, accountId: account.id, occurredOn: '2026-10-09', competence: '2026-10', cashDate: '2026-10-09', amountCents: -1_000, kind: 'transfer', status: 'posted' },
          // Cartão: o mês é o do vencimento (cash_date), não o da competência.
          { ...base, creditCardId: card.id, occurredOn: '2026-09-20', competence: '2026-09', cashDate: '2026-10-20', amountCents: -40_000, kind: 'expense', status: 'posted' },
          // Cartão sem cash_date na janela: não se adivinha o mês; é contada.
          { ...base, creditCardId: card.id, occurredOn: '2026-10-02', competence: '2026-11', cashDate: null, amountCents: -3_000, kind: 'expense', status: 'posted' },
        ]);

        const result = await getCashflowData(householdId, '2026-10-10', 12);

        // 100.000 (conta ativa) − 10.000 − 30.000 − 5.000 (dia de `opening_date`,
        // incluído) = 55.000. A conta inativa (999.999), o dia anterior a
        // `opening_date` (−2.500) e o `planned` (−1.111) ficam de fora.
        expect(result.openingBalanceCents).toBe(55_000);
        expect(result.fromCompetence).toBe('2026-10');

        const summary = result.rows
          .map((r) => `${r.cashDate} ${String(r.amountCents)} ${r.kind} ${r.origin}`)
          .sort();
        expect(summary).toEqual([
          '2026-10-05 200000 income account',
          '2026-10-20 -40000 expense card',
          '2026-11-05 -8000 expense account',
        ]);
        expect(result.cardRowsWithoutCashDate).toBe(1);
        // Nenhuma linha `planned` de recorrência/receita foi criada neste household.
        expect(result.recurrencePlannedThrough).toBeNull();
      } finally {
        await db.delete(households).where(eq(households.id, householdId));
      }
    });

    it('janela: movimento de conta anterior ao opening_date DA PRÓPRIA conta fica fora; no dia entra', async () => {
      const [{ db }, schema, { getCashflowData }] = await Promise.all([
        import('@/lib/db'),
        import('@/lib/db/schema'),
        import('./cashflow'),
      ]);
      const { accounts, households, transactions } = schema;

      const [household] = await db
        .insert(households)
        .values({ name: 'Cashflow opening_date window test' })
        .returning({ id: households.id });
      if (household === undefined) throw new Error('Household de teste não foi criado.');
      const householdId = household.id;

      try {
        // A: saldo de início de 04/10 (futuro em relação ao dia 1). B: aberta em janeiro.
        const [a] = await db
          .insert(accounts)
          .values({ householdId, name: 'A', kind: 'checking', openingBalanceCents: 740_000, openingDate: '2026-10-04' })
          .returning({ id: accounts.id });
        const [b] = await db
          .insert(accounts)
          .values({ householdId, name: 'B', kind: 'checking', openingBalanceCents: 10_000, openingDate: '2026-01-01' })
          .returning({ id: accounts.id });
        if (a === undefined || b === undefined) throw new Error('Fixture não foi criada.');

        const base = { householdId, rawDescription: '', description: 'x' } as const;
        await db.insert(transactions).values([
          // A, dia 01/10 (< opening_date de A): já está no saldo informado → fora.
          { ...base, accountId: a.id, occurredOn: '2026-10-01', competence: '2026-10', cashDate: '2026-10-01', amountCents: 740_000, kind: 'income', status: 'posted' },
          // A, dia 04/10 (= opening_date): entra.
          { ...base, accountId: a.id, occurredOn: '2026-10-04', competence: '2026-10', cashDate: '2026-10-04', amountCents: -1_000, kind: 'expense', status: 'posted' },
          // A, planned antes do opening_date: também é movimento anterior → fora.
          { ...base, accountId: a.id, occurredOn: '2026-10-02', competence: '2026-10', cashDate: '2026-10-02', amountCents: -2_000, kind: 'expense', status: 'planned' },
          // B, mesmo dia 01/10 (opening_date de B é janeiro): entra.
          { ...base, accountId: b.id, occurredOn: '2026-10-01', competence: '2026-10', cashDate: '2026-10-01', amountCents: -3_000, kind: 'expense', status: 'posted' },
        ]);

        const result = await getCashflowData(householdId, '2026-10-10', 12);

        expect(result.openingBalanceCents).toBe(750_000);
        const summary = result.rows.map((r) => `${r.cashDate} ${String(r.amountCents)}`).sort();
        expect(summary).toEqual(['2026-10-01 -3000', '2026-10-04 -1000']);
      } finally {
        await db.delete(households).where(eq(households.id, householdId));
      }
    });
  },
);
