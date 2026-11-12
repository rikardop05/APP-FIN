import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { suggestRecurrences } from '@/lib/finance/recurrence-suggestions';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local o teste fica pulado.
  }
}

/**
 * Integração de propósito: o recorte do histórico (status, tipo, janela de datas, o que já veio
 * de recorrência, parcela) só se prova contra o SQL real, e o caminho inteiro consulta -> motor é
 * o que a página roda. Household PRÓPRIO, apagado no `finally`.
 */
describe.skipIf(process.env.DATABASE_URL === undefined)('listRecurrenceHistory contra o banco real', () => {
  it('devolve só o histórico lançado de receita e despesa da janela, e o motor sugere a partir dele', async () => {
    const [{ db }, schema, { listRecurrenceHistory }] = await Promise.all([
      import('@/lib/db'),
      import('@/lib/db/schema'),
      import('./recurring-suggestions'),
    ]);
    const { accounts, categories, creditCards, households, installmentPlans, recurringExpenses, transactions } = schema;

    const [household] = await db.insert(households).values({ name: 'Lote2 sugestoes test' }).returning({ id: households.id });
    const [other] = await db.insert(households).values({ name: 'Lote2 sugestoes test B' }).returning({ id: households.id });
    if (household === undefined || other === undefined) throw new Error('Household de teste não foi criado.');
    const householdId = household.id;

    try {
      const [account] = await db
        .insert(accounts)
        .values({ householdId, name: 'Conta', kind: 'checking', openingDate: '2026-01-01' })
        .returning({ id: accounts.id });
      const [card] = await db
        .insert(creditCards)
        .values({ householdId, name: 'Cartão', closingDay: 1, dueDay: 10 })
        .returning({ id: creditCards.id });
      const [category] = await db
        .insert(categories)
        .values({ householdId, name: 'Assinaturas', parentId: null, nature: 'non_essential' })
        .returning({ id: categories.id });
      const [otherCard] = await db
        .insert(creditCards)
        .values({ householdId: other.id, name: 'Cartão B', closingDay: 1, dueDay: 10 })
        .returning({ id: creditCards.id });
      if (account === undefined || card === undefined || category === undefined || otherCard === undefined) {
        throw new Error('Fixture não foi criada.');
      }
      const [rule] = await db
        .insert(recurringExpenses)
        .values({ householdId, description: 'Internet', expectedCents: -9_990, categoryId: category.id, dueDay: 10, accountId: account.id, startsOn: '2026-01-01' })
        .returning({ id: recurringExpenses.id });
      const [plan] = await db
        .insert(installmentPlans)
        .values({ householdId, creditCardId: card.id, description: 'LOJA X', totalCents: -30_000, installmentsCount: 3, firstCompetence: '2026-10', source: 'import' })
        .returning({ id: installmentPlans.id });
      if (rule === undefined || plan === undefined) throw new Error('Fixture não foi criada.');

      const onCard = { householdId, rawDescription: '', creditCardId: card.id, kind: 'expense', status: 'posted' } as const;
      const onAccount = { householdId, rawDescription: '', accountId: account.id, status: 'posted' } as const;
      await db.insert(transactions).values([
        // Assinatura: set, out e nov (hoje = 2026-11-20). Entra.
        { ...onCard, description: 'NETFLIX.COM', occurredOn: '2026-09-27', competence: '2026-10', cashDate: '2026-10-10', amountCents: -3_990, categoryId: category.id },
        { ...onCard, description: 'NETFLIX.COM', occurredOn: '2026-10-27', competence: '2026-11', cashDate: '2026-11-10', amountCents: -3_990, categoryId: category.id },
        { ...onCard, description: 'NETFLIX.COM', occurredOn: '2026-11-18', competence: '2026-12', cashDate: '2026-12-10', amountCents: -4_190 },
        // Receita em conta: entra.
        { ...onAccount, kind: 'income', description: 'SALARIO', occurredOn: '2026-10-05', competence: '2026-10', cashDate: '2026-10-05', amountCents: 800_000 },
        // Parcela: entra na consulta marcada como parcela (o motor é quem a descarta).
        { ...onCard, description: 'LOJA X 01/03', occurredOn: '2026-10-12', competence: '2026-10', cashDate: '2026-11-10', amountCents: -10_000, installmentPlanId: plan.id, installmentNumber: 1 },
        // --- Ficam FORA da consulta ---
        // Antes da janela (começa em 2026-06-01 para hoje em novembro e em 2026-05-01 para hoje em
        // outubro) e depois de hoje.
        { ...onCard, description: 'NETFLIX.COM', occurredOn: '2026-04-30', competence: '2026-05', cashDate: '2026-06-10', amountCents: -3_990 },
        { ...onCard, description: 'NETFLIX.COM', occurredOn: '2026-11-21', competence: '2026-12', cashDate: '2026-12-10', amountCents: -3_990 },
        // Previsão não é histórico.
        { ...onAccount, status: 'planned', kind: 'expense', description: 'ALGO PREVISTO', occurredOn: '2026-11-05', competence: '2026-11', cashDate: '2026-11-05', amountCents: -1_000 },
        // Já veio de uma despesa fixa cadastrada.
        { ...onAccount, kind: 'expense', description: 'Internet', occurredOn: '2026-10-10', competence: '2026-10', cashDate: '2026-10-10', amountCents: -9_990, recurringExpenseId: rule.id },
        // Transferência e pagamento de fatura.
        { ...onAccount, kind: 'transfer', description: 'TED', occurredOn: '2026-10-11', competence: '2026-10', cashDate: '2026-10-11', amountCents: -50_000 },
        { ...onAccount, kind: 'credit_card_payment', description: 'PGTO FATURA', occurredOn: '2026-10-10', competence: '2026-10', cashDate: '2026-10-10', amountCents: -30_000 },
        // Outra casa.
        { householdId: other.id, rawDescription: '', creditCardId: otherCard.id, kind: 'expense', status: 'posted', description: 'NETFLIX.COM', occurredOn: '2026-10-27', competence: '2026-11', cashDate: '2026-11-10', amountCents: -3_990 },
      ]);

      const history = await listRecurrenceHistory(householdId, '2026-11-20');
      const summary = history
        .map((row) => `${row.occurredOn} ${row.description} ${String(row.amountCents)} ${row.kind} ${row.isInstallment ? 'parcela' : '-'}`)
        .sort();
      expect(summary).toEqual([
        '2026-09-27 NETFLIX.COM -3990 expense -',
        '2026-10-05 SALARIO 800000 income -',
        '2026-10-12 LOJA X 01/03 -10000 expense parcela',
        '2026-10-27 NETFLIX.COM -3990 expense -',
        '2026-11-18 NETFLIX.COM -4190 expense -',
      ]);

      // O caminho que a página roda. Histórico da casa: set, out e nov (3 meses) -> exige 3.
      // Netflix: 3990, 3990, 4190 (41900 <= 43890) -> mediana 3990; dias [27, 27, 18] -> mediana 27,
      // e o 18 está a 9 dias: descartada pelo dia. Salário: um mês só. Nada sugerido.
      expect(suggestRecurrences({ today: '2026-11-20', rows: history, existing: [] })).toEqual([]);
      // Com hoje = 2026-10-28 a de novembro ainda não existe: sobram set e out (historico de 2 meses,
      // exige 2), dias [27, 27] -> sugestão de 39,90 no dia 27, no cartão, com a categoria.
      const earlier = await listRecurrenceHistory(householdId, '2026-10-28');
      expect(suggestRecurrences({ today: '2026-10-28', rows: earlier, existing: [] })).toEqual([
        {
          key: 'expense|netflix.com|3990',
          kind: 'expense',
          description: 'NETFLIX.COM',
          medianCents: -3_990,
          suggestedDay: 27,
          categoryId: category.id,
          accountId: null,
          creditCardId: card.id,
          memberId: null,
          months: ['2026-09', '2026-10'],
        },
      ]);
      // Já cadastrada como despesa fixa: não é sugerida.
      expect(
        suggestRecurrences({ today: '2026-10-28', rows: earlier, existing: [{ kind: 'expense', description: 'Netflix.com' }] }),
      ).toEqual([]);
    } finally {
      await db.delete(households).where(eq(households.id, householdId));
      await db.delete(households).where(eq(households.id, other.id));
    }
  });
});
