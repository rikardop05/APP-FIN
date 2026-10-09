import { and, asc, eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { cents } from '@/lib/money';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local os testes ficam pulados.
  }
}

/**
 * Fatura SEGUINTE de um parcelamento ja projetado (defeito achado pelo Corvo).
 *
 * Antes: o 2o lote criava um plano novo e reprojetava as parcelas futuras com o
 * MESMO `dedupe_hash` das `planned` do 1o lote, e o indice unico
 * `(household_id, dedupe_hash)` derrubava o commit. Agora o lote reconhece o
 * plano existente, liga a parcela real a ele, concilia a `planned` de mesmo
 * numero e nao reprojeta.
 *
 * Integracao de proposito: o defeito era uma violacao de indice do PostgreSQL.
 * Banco unico: household PROPRIO, apagado no `finally` (cascade).
 */

async function modules() {
  const [{ db }, schema, imports, plans, { COUNTED_STATUSES }] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('./import'),
    import('./import-plans'),
    import('./counted-statuses'),
  ]);
  return { db, schema, imports, plans, COUNTED_STATUSES };
}
type Modules = Awaited<ReturnType<typeof modules>>;

async function seed(m: Modules) {
  const [household] = await m.db
    .insert(m.schema.households)
    .values({ name: 'Parcelamento 2a fatura test' })
    .returning({ id: m.schema.households.id });
  if (household === undefined) throw new Error('Household de teste não foi criado.');
  const [card] = await m.db
    .insert(m.schema.creditCards)
    .values({ householdId: household.id, name: 'Cartão parcelas', closingDay: 10, dueDay: 20 })
    .returning({ id: m.schema.creditCards.id });
  if (card === undefined) throw new Error('Cartão de teste não foi criado.');
  return { householdId: household.id, cardId: card.id };
}

/** Uma fatura com a parcela `current/4` da mesma geladeira, comprada em 2026-08-05. */
function invoice(cardId: string, current: number, statementCompetence: string, fileHash: string) {
  return {
    fileName: `fatura-${statementCompetence}.txt`,
    fileHash,
    bankKey: null,
    format: 'text' as const,
    sourceKind: 'credit_card' as const,
    sourceId: cardId,
    confirmedRows: [
      {
        index: 0,
        include: true,
        occurredOn: '2026-08-05',
        description: 'Geladeira',
        rawDescription: `GELADEIRA PARC ${String(current)}/4`,
        amountCents: cents(-25_000),
        categoryId: null,
        memberId: null,
        installment: { current, total: 4 },
      },
    ],
    reportedTotalCents: null,
    allowReimport: false,
    statementCompetence,
  };
}

async function snapshot(m: Modules, householdId: string) {
  const [plans, rows] = await Promise.all([
    m.db
      .select({ id: m.schema.installmentPlans.id })
      .from(m.schema.installmentPlans)
      .where(eq(m.schema.installmentPlans.householdId, householdId)),
    m.db
      .select({
        id: m.schema.transactions.id,
        competence: m.schema.transactions.competence,
        status: m.schema.transactions.status,
        installmentPlanId: m.schema.transactions.installmentPlanId,
        installmentNumber: m.schema.transactions.installmentNumber,
        reconciledBy: m.schema.transactions.reconciledByTransactionId,
        amountCents: m.schema.transactions.amountCents,
      })
      .from(m.schema.transactions)
      .where(eq(m.schema.transactions.householdId, householdId))
      .orderBy(asc(m.schema.transactions.installmentNumber), asc(m.schema.transactions.status)),
  ]);
  return { plans, rows };
}

describe.skipIf(!process.env.DATABASE_URL)('importação da fatura seguinte de um parcelamento (integração)', () => {
  it('listExistingInstallmentPlans devolve o plano do cartão com as planned em aberto e as reais', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      await m.imports.commitImport(s.householdId, invoice(s.cardId, 2, '2026-09', 'a'.repeat(64)));
      const plans = await m.plans.listExistingInstallmentPlans(s.householdId, s.cardId);
      expect(plans).toHaveLength(1);
      const [plan] = plans;
      // 2/4 cobrada em 2026-09: a 1a foi em 2026-08; total = 4 x -250,00.
      expect(plan).toMatchObject({ description: 'Geladeira', installmentsCount: 4, totalCents: -100_000, firstCompetence: '2026-08' });
      expect(plan?.postedNumbers).toEqual([2]);
      expect(plan?.openPlanned.map((p) => p.installmentNumber)).toEqual([3, 4]);

      const prepared = await m.imports.prepareImport(s.householdId, 'credit_card', s.cardId, 'b'.repeat(64));
      expect(prepared.existingPlans.map((p) => p.id)).toEqual([plan?.id]);
    } finally {
      await m.db.delete(m.schema.households).where(eq(m.schema.households.id, s.householdId));
    }
  });

  it('a 2a fatura liga a parcela ao plano existente, concilia a planned, não duplica plano nem mês; desfazer volta ao estado da 1a', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      await m.imports.commitImport(s.householdId, invoice(s.cardId, 2, '2026-09', 'a'.repeat(64)));
      const afterFirst = await snapshot(m, s.householdId);
      // 1o lote: 1 plano, parcela 2 real, 3 e 4 previstas.
      expect(afterFirst.plans).toHaveLength(1);
      expect(afterFirst.rows.map((r) => [r.installmentNumber, r.status])).toEqual([
        [2, 'posted'],
        [3, 'planned'],
        [4, 'planned'],
      ]);
      const planId = afterFirst.plans[0]?.id;
      const planned3 = afterFirst.rows.find((r) => r.installmentNumber === 3);

      // Antes da correcao: viola transactions_household_id_dedupe_hash_unique.
      const second = await m.imports.commitImport(s.householdId, invoice(s.cardId, 3, '2026-10', 'b'.repeat(64)));
      const afterSecond = await snapshot(m, s.householdId);

      expect(afterSecond.plans.map((p) => p.id)).toEqual([planId]);
      const real3 = afterSecond.rows.find((r) => r.installmentNumber === 3 && r.status === 'posted');
      expect(real3?.installmentPlanId).toBe(planId);
      expect(afterSecond.rows.map((r) => [r.installmentNumber, r.status])).toEqual([
        [2, 'posted'],
        [3, 'posted'],
        [3, 'reconciled'],
        [4, 'planned'],
      ]);
      expect(afterSecond.rows.find((r) => r.id === planned3?.id)).toMatchObject({
        status: 'reconciled',
        reconciledBy: real3?.id,
      });
      expect(afterSecond.rows.every((r) => r.installmentPlanId === planId)).toBe(true);

      // Mes nao contado em dobro: em 2026-10 conta so a real (-250,00).
      const counted = await m.db
        .select({ amountCents: m.schema.transactions.amountCents })
        .from(m.schema.transactions)
        .where(
          and(
            eq(m.schema.transactions.householdId, s.householdId),
            eq(m.schema.transactions.competence, '2026-10'),
            inArray(m.schema.transactions.status, m.COUNTED_STATUSES),
          ),
        );
      expect(counted.map((r) => r.amountCents)).toEqual([-25_000]);

      await m.imports.revertImport(s.householdId, second.batchId);
      expect(await snapshot(m, s.householdId)).toEqual(afterFirst);
    } finally {
      await m.db.delete(m.schema.households).where(eq(m.schema.households.id, s.householdId));
    }
  });

  it('desfazer a 1a fatura depois da 2a: o plano continua com as parcelas futuras; reimportar a 1a volta ao estado completo', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      const firstInput = invoice(s.cardId, 2, '2026-09', 'a'.repeat(64));
      const first = await m.imports.commitImport(s.householdId, firstInput);
      await m.imports.commitImport(s.householdId, invoice(s.cardId, 3, '2026-10', 'b'.repeat(64)));
      const complete = await snapshot(m, s.householdId);

      await m.imports.revertImport(s.householdId, first.batchId);
      const afterRevert = await snapshot(m, s.householdId);
      // Sai so a parcela real do lote A (2/4). A 3/4 projetada (conciliada pela real
      // do lote B) e a 4/4 projetada ficam no plano, que continua vivo.
      expect(afterRevert.plans).toEqual(complete.plans);
      expect(afterRevert.rows.map((r) => [r.installmentNumber, r.status])).toEqual([
        [3, 'posted'],
        [3, 'reconciled'],
        [4, 'planned'],
      ]);
      // Soltas do lote desfeito: nao pertencem mais a nenhum lote.
      const detached = await m.db
        .select({ batch: m.schema.transactions.importBatchId })
        .from(m.schema.transactions)
        .where(
          and(eq(m.schema.transactions.householdId, s.householdId), eq(m.schema.transactions.rawDescription, '')),
        );
      expect(detached.map((r) => r.batch)).toEqual([null, null]);

      // Reimportar o lote A religa a 2/4 ao plano e nao reprojeta: estado completo de novo.
      await m.imports.commitImport(s.householdId, { ...firstInput, allowReimport: true });
      const again = await snapshot(m, s.householdId);
      expect(again.plans).toEqual(complete.plans);
      expect(again.rows.map((r) => [r.installmentNumber, r.status])).toEqual(
        complete.rows.map((r) => [r.installmentNumber, r.status]),
      );
    } finally {
      await m.db.delete(m.schema.households).where(eq(m.schema.households.id, s.householdId));
    }
  });

  it('descrição editada na 1a fatura: casa pela raw; 3a fatura fecha o plano sem nenhuma planned aberta', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      const first = invoice(s.cardId, 2, '2026-09', 'a'.repeat(64));
      const [row] = first.confirmedRows;
      if (row === undefined) throw new Error('Fixture sem linha.');
      first.confirmedRows = [{ ...row, description: 'Sofá da sala' }];
      await m.imports.commitImport(s.householdId, first);
      await m.imports.commitImport(s.householdId, invoice(s.cardId, 3, '2026-10', 'b'.repeat(64)));
      await m.imports.commitImport(s.householdId, invoice(s.cardId, 4, '2026-11', 'c'.repeat(64)));

      const after = await snapshot(m, s.householdId);
      expect(after.plans).toHaveLength(1);
      expect(after.rows.map((r) => [r.installmentNumber, r.status])).toEqual([
        [2, 'posted'],
        [3, 'posted'],
        [3, 'reconciled'],
        [4, 'posted'],
        [4, 'reconciled'],
      ]);
    } finally {
      await m.db.delete(m.schema.households).where(eq(m.schema.households.id, s.householdId));
    }
  });
});
