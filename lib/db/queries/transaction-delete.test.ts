import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { addCompetence } from '@/lib/date';
import { cents } from '@/lib/money';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local os testes ficam pulados.
  }
}

/**
 * Integração de propósito: FK sem cascata (`paid_transaction_id`), índice único de
 * `dedupe_hash`, plano que some quando fica vazio e a dispensa que impede o
 * `topUpPlanned` de regenerar só se provam contra o PostgreSQL.
 *
 * Disciplina do banco único: household PRÓPRIO, apagado no `finally`. A ordem da
 * limpeza importa: `statements.paid_transaction_id` aponta para `transactions` SEM
 * cascata e `transactions.statement_id` aponta de volta.
 */

async function modules() {
  const [{ db }, schema, del, recurring, write, imp] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('./transaction-delete'),
    import('./recurring'),
    import('./recurring-planned-write'),
    import('./import'),
  ]);
  return { db, schema, del, recurring, write, imp };
}
type Modules = Awaited<ReturnType<typeof modules>>;

async function seed(m: Modules, name = 'T-delete test') {
  const { db, schema } = m;
  const [household] = await db
    .insert(schema.households)
    .values({ name })
    .returning({ id: schema.households.id });
  if (household === undefined) throw new Error('Household de teste não foi criado.');
  const householdId = household.id;
  await db.insert(schema.householdSettings).values({ householdId, projectionMonths: 6 });
  const [account] = await db
    .insert(schema.accounts)
    .values({ householdId, name: 'Conta teste', kind: 'checking', openingDate: '2026-01-01' })
    .returning({ id: schema.accounts.id });
  const [card] = await db
    .insert(schema.creditCards)
    .values({ householdId, name: 'Cartão teste', closingDay: 25, dueDay: 5 })
    .returning({ id: schema.creditCards.id });
  const [root] = await db
    .insert(schema.categories)
    .values({ householdId, name: 'Moradia teste', parentId: null, nature: 'essential' })
    .returning({ id: schema.categories.id });
  if (account === undefined || card === undefined || root === undefined) throw new Error('Seed incompleto.');
  const [leaf] = await db
    .insert(schema.categories)
    .values({ householdId, name: 'Luz teste', parentId: root.id, nature: 'essential' })
    .returning({ id: schema.categories.id });
  if (leaf === undefined) throw new Error('Categoria folha não foi criada.');

  const insertTx = async (
    values: Partial<typeof schema.transactions.$inferInsert> & { competence: string },
  ): Promise<string> => {
    const [row] = await db
      .insert(schema.transactions)
      .values({
        householdId,
        occurredOn: `${values.competence}-10`,
        description: 'Lançamento teste',
        rawDescription: '',
        amountCents: -10000,
        kind: 'expense',
        status: 'posted',
        accountId: account.id,
        ...values,
      })
      .returning({ id: schema.transactions.id });
    if (row === undefined) throw new Error('Lançamento não foi criado.');
    return row.id;
  };
  const exists = async (id: string) =>
    (await db.select({ id: schema.transactions.id }).from(schema.transactions).where(eq(schema.transactions.id, id))).length === 1;
  return { householdId, accountId: account.id, cardId: card.id, categoryId: leaf.id, insertTx, exists };
}

async function cleanup(m: Modules, householdId: string) {
  const { db, schema } = m;
  await db.execute(
    sql`update statements set paid_transaction_id = null where credit_card_id in (select id from credit_cards where household_id = ${householdId})`,
  );
  await db.delete(schema.transactions).where(eq(schema.transactions.householdId, householdId));
  await db.delete(schema.importBatches).where(eq(schema.importBatches.householdId, householdId));
  await db.delete(schema.households).where(eq(schema.households.id, householdId));
}

async function hasSkippedTable(m: Modules): Promise<boolean> {
  const rows = await m.db.execute(
    sql`select 1 from information_schema.tables where table_name = 'skipped_occurrences'`,
  );
  return rows.length > 0;
}

describe.skipIf(process.env.DATABASE_URL === undefined)('exclusão de lançamento (banco real)', () => {
  it('lançamento manual isolado: impacto SEM efeitos (diálogo simples), apaga só ele', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      const keep = await s.insertTx({ competence: '2026-10' });
      const id = await s.insertTx({ competence: '2026-10', description: 'Aporte digitado errado' });
      const impact = await m.del.getDeleteImpact(s.householdId, id, 'only');
      expect(impact.effects).toEqual([]);
      expect(impact.deleted).toEqual({ transactions: 1, futureInstallments: 0 });
      expect(impact.target).toMatchObject({ id, description: 'Aporte digitado errado', amountCents: -10000 });

      expect(await m.del.deleteTransaction(s.householdId, id, 'only')).toEqual({
        transactions: 1,
        futureInstallments: 0,
      });
      expect(await s.exists(id)).toBe(false);
      expect(await s.exists(keep)).toBe(true);
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  it('excluir de novo ou excluir id inexistente lança "não encontrado"; id de OUTRO household não apaga nada', async () => {
    const m = await modules();
    const a = await seed(m, 'T-delete A');
    const b = await seed(m, 'T-delete B');
    try {
      const mine = await a.insertTx({ competence: '2026-10' });
      await expect(m.del.deleteTransaction(b.householdId, mine, 'only')).rejects.toThrow();
      await expect(m.del.getDeleteImpact(b.householdId, mine, 'only')).rejects.toThrow();
      expect(await a.exists(mine)).toBe(true);
      await m.del.deleteTransaction(a.householdId, mine, 'only');
      await expect(m.del.deleteTransaction(a.householdId, mine, 'only')).rejects.toThrow();
    } finally {
      await cleanup(m, a.householdId);
      await cleanup(m, b.householdId);
    }
  });

  it('"esta e as futuras" numa linha que NÃO é parcela é recusado', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      const id = await s.insertTx({ competence: '2026-10' });
      await expect(m.del.deleteTransaction(s.householdId, id, 'with-future')).rejects.toThrow(/parcela/);
      expect(await s.exists(id)).toBe(true);
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  describe('parcelas de um plano (5x: #1 postada, #2..#5 planned)', () => {
    async function plan(m: Modules, s: Awaited<ReturnType<typeof seed>>) {
      const [row] = await m.db
        .insert(m.schema.installmentPlans)
        .values({
          householdId: s.householdId,
          creditCardId: s.cardId,
          description: 'Magazine',
          totalCents: -50000,
          installmentsCount: 5,
          firstCompetence: '2026-09',
          source: 'import',
        })
        .returning({ id: m.schema.installmentPlans.id });
      if (row === undefined) throw new Error('Plano não foi criado.');
      const ids: string[] = [];
      for (let n = 1; n <= 5; n += 1) {
        ids.push(
          await s.insertTx({
            competence: addCompetence('2026-09', n - 1),
            creditCardId: s.cardId,
            accountId: null,
            description: `Magazine (${String(n)}/5)`,
            rawDescription: n === 1 ? 'MAGAZINE 1/5' : '',
            status: n === 1 ? 'posted' : 'planned',
            installmentPlanId: row.id,
            installmentNumber: n,
            dedupeHash: `plan-hash-${String(n)}`,
          }),
        );
      }
      return { planId: row.id, ids };
    }
    const planExists = async (m: Modules, planId: string) =>
      (await m.db.select({ id: m.schema.installmentPlans.id }).from(m.schema.installmentPlans).where(eq(m.schema.installmentPlans.id, planId))).length === 1;

    it('"só esta" (padrão) apaga uma parcela, deixa o buraco DITO e o plano continua', async () => {
      const m = await modules();
      const s = await seed(m);
      try {
        const p = await plan(m, s);
        const impact = await m.del.getDeleteImpact(s.householdId, p.ids[2] ?? '', 'only');
        expect(impact.deleted).toEqual({ transactions: 1, futureInstallments: 0 });
        expect(impact.effects).toContainEqual({ kind: 'plan_hole', planDescription: 'Magazine', remaining: 4 });
        // Parcela PROJETADA (#3) com a #1 lida ainda no banco: a reimportação pula a #1
        // e não projeta nada, então a #3 NÃO volta (e nada colide).
        expect(impact.effects).toContainEqual({ kind: 'stays_deleted_on_reimport' });
        expect(impact.effects).not.toContainEqual({ kind: 'returns_on_reimport' });
        expect(impact.effects.some((effect) => effect.kind === 'reimport_will_fail')).toBe(false);

        // Parcela LIDA do arquivo (#1) com as 4 projetadas ficando: a reimportação falharia.
        const first = await m.del.getDeleteImpact(s.householdId, p.ids[0] ?? '', 'only');
        expect(first.effects).toContainEqual({ kind: 'reimport_will_fail', planDescription: 'Magazine', blockingInstallments: 4 });
        expect(first.effects).not.toContainEqual({ kind: 'returns_on_reimport' });

        await m.del.deleteTransaction(s.householdId, p.ids[2] ?? '', 'only');
        expect(await s.exists(p.ids[2] ?? '')).toBe(false);
        expect(await s.exists(p.ids[3] ?? '')).toBe(true);
        expect(await planExists(m, p.planId)).toBe(true);
      } finally {
        await cleanup(m, s.householdId);
      }
    });

    it('"esta e as futuras" conta e apaga só as planned de número MAIOR; a postada e as anteriores ficam', async () => {
      const m = await modules();
      const s = await seed(m);
      try {
        const p = await plan(m, s);
        const impact = await m.del.getDeleteImpact(s.householdId, p.ids[1] ?? '', 'with-future');
        expect(impact.deleted).toEqual({ transactions: 1, futureInstallments: 3 });

        const deleted = await m.del.deleteTransaction(s.householdId, p.ids[1] ?? '', 'with-future');
        expect(deleted).toEqual({ transactions: 1, futureInstallments: 3 });
        expect(await s.exists(p.ids[0] ?? '')).toBe(true); // a #1 (postada) ficou
        for (const id of p.ids.slice(1)) expect(await s.exists(id)).toBe(false);
        expect(await planExists(m, p.planId)).toBe(true);
      } finally {
        await cleanup(m, s.householdId);
      }
    });

    it('apagar a última linha do plano apaga o PLANO junto, e o impacto avisa antes', async () => {
      const m = await modules();
      const s = await seed(m);
      try {
        const p = await plan(m, s);
        await m.del.deleteTransaction(s.householdId, p.ids[0] ?? '', 'with-future');
        expect(await planExists(m, p.planId)).toBe(false);
      } finally {
        await cleanup(m, s.householdId);
      }
      const m2 = await modules();
      const s2 = await seed(m2);
      try {
        const p = await plan(m2, s2);
        for (const id of p.ids.slice(0, 4)) await m2.del.deleteTransaction(s2.householdId, id, 'only');
        const last = await m2.del.getDeleteImpact(s2.householdId, p.ids[4] ?? '', 'only');
        expect(last.effects).toContainEqual({ kind: 'plan_removed', planDescription: 'Magazine' });
        await m2.del.deleteTransaction(s2.householdId, p.ids[4] ?? '', 'only');
        expect(await planExists(m2, p.planId)).toBe(false);
      } finally {
        await cleanup(m2, s2.householdId);
      }
    });
  });

  it('linha de fatura: o total calculado cai, o impresso NÃO muda, e o impacto mostra antes e depois', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      const [statement] = await m.db
        .insert(m.schema.statements)
        .values({
          creditCardId: s.cardId,
          period: '2026-09',
          closingDate: '2026-09-25',
          dueDate: '2026-10-05',
          reportedTotalCents: -50000,
          source: 'import',
        })
        .returning({ id: m.schema.statements.id });
      if (statement === undefined) throw new Error('Fatura não foi criada.');
      const a = await s.insertTx({ competence: '2026-09', creditCardId: s.cardId, accountId: null, statementId: statement.id, amountCents: -30000 });
      await s.insertTx({ competence: '2026-09', creditCardId: s.cardId, accountId: null, statementId: statement.id, amountCents: -20000 });

      const impact = await m.del.getDeleteImpact(s.householdId, a, 'only');
      expect(impact.effects).toContainEqual({
        kind: 'statement_total',
        cardName: 'Cartão teste',
        competence: '2026-09',
        beforeCents: -50000,
        afterCents: -20000,
        reportedCents: -50000,
      });
      await m.del.deleteTransaction(s.householdId, a, 'only');
      const [sum] = await m.db
        .select({ total: sql<string>`SUM(${m.schema.transactions.amountCents})` })
        .from(m.schema.transactions)
        .where(eq(m.schema.transactions.statementId, statement.id));
      expect(Number(sum?.total)).toBe(-20000);
      const [after] = await m.db
        .select({ reported: m.schema.statements.reportedTotalCents })
        .from(m.schema.statements)
        .where(eq(m.schema.statements.id, statement.id));
      expect(after?.reported).toBe(-50000);
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  it('pagamento de fatura: apagar NÃO viola a FK; paid_transaction_id é anulado e o impacto avisa', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      const payment = await s.insertTx({ competence: '2026-10', kind: 'credit_card_payment', description: 'Pagamento fatura' });
      const [statement] = await m.db
        .insert(m.schema.statements)
        .values({
          creditCardId: s.cardId,
          period: '2026-09',
          closingDate: '2026-09-25',
          dueDate: '2026-10-05',
          source: 'import',
          status: 'paid',
          paidTransactionId: payment,
        })
        .returning({ id: m.schema.statements.id });
      if (statement === undefined) throw new Error('Fatura não foi criada.');

      const impact = await m.del.getDeleteImpact(s.householdId, payment, 'only');
      expect(impact.effects).toContainEqual({ kind: 'statement_unpaid', cardName: 'Cartão teste', competence: '2026-09' });

      await m.del.deleteTransaction(s.householdId, payment, 'only'); // sem o UPDATE prévio, a FK barraria aqui
      expect(await s.exists(payment)).toBe(false);
      const [after] = await m.db
        .select({ paid: m.schema.statements.paidTransactionId })
        .from(m.schema.statements)
        .where(eq(m.schema.statements.id, statement.id));
      expect(after?.paid).toBeNull();
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  it('veio de importação: avisa que volta na reimportação (SÓ com hash) e decrementa rows_imported sem passar de 0', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      const [batch] = await m.db
        .insert(m.schema.importBatches)
        .values({
          householdId: s.householdId,
          fileName: 'fatura-teste.pdf',
          fileHash: 'f'.repeat(64),
          format: 'pdf',
          accountId: s.accountId,
          rowsImported: 3,
          status: 'committed',
        })
        .returning({ id: m.schema.importBatches.id });
      if (batch === undefined) throw new Error('Lote não foi criado.');
      const imported = await s.insertTx({ competence: '2026-10', importBatchId: batch.id, rawDescription: 'LOJA X', dedupeHash: 'hash-1' });
      const manual = await s.insertTx({ competence: '2026-10' });
      const projected = await s.insertTx({ competence: '2026-11', importBatchId: batch.id, rawDescription: '', status: 'planned', dedupeHash: 'hash-proj' });

      const impact = await m.del.getDeleteImpact(s.householdId, imported, 'only');
      expect(impact.effects).toContainEqual({ kind: 'import_batch', fileName: 'fatura-teste.pdf', before: 3, after: 2 });
      expect(impact.effects).toContainEqual({ kind: 'returns_on_reimport' });
      // Lançamento manual: NADA de "volta na reimportação".
      expect((await m.del.getDeleteImpact(s.householdId, manual, 'only')).effects).toEqual([]);

      const rowsImported = async () =>
        (await m.db.select({ n: m.schema.importBatches.rowsImported }).from(m.schema.importBatches).where(eq(m.schema.importBatches.id, batch.id)))[0]?.n;
      await m.del.deleteTransaction(s.householdId, imported, 'only');
      expect(await rowsImported()).toBe(2);
      // Parcela projetada nunca foi contada: não decrementa.
      await m.del.deleteTransaction(s.householdId, projected, 'only');
      expect(await rowsImported()).toBe(2);

      await m.db.update(m.schema.importBatches).set({ rowsImported: 0 }).where(eq(m.schema.importBatches.id, batch.id));
      const another = await s.insertTx({ competence: '2026-10', importBatchId: batch.id, rawDescription: 'OUTRA', dedupeHash: 'hash-2' });
      await m.del.deleteTransaction(s.householdId, another, 'only');
      expect(await rowsImported()).toBe(0);
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  it('R1: apagar a parcela POSTADA e deixar as futuras, depois reimportar o mesmo arquivo (allowReimport)', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      const input = {
        fileName: 'fatura.txt',
        fileHash: 'a'.repeat(64),
        bankKey: null,
        format: 'text' as const,
        sourceKind: 'credit_card' as const,
        sourceId: s.cardId,
        confirmedRows: [
          {
            index: 0,
            include: true,
            occurredOn: '2026-09-05',
            description: 'Compra parcelada',
            rawDescription: 'Compra parcelada 1/3',
            amountCents: cents(-1000),
            categoryId: null,
            memberId: null,
            installment: { current: 1, total: 3 },
          },
        ],
        reportedTotalCents: null,
        allowReimport: true,
        statementCompetence: '2026-09',
      };
      await m.imp.commitImport(s.householdId, input);
      const rows = await m.db
        .select({ id: m.schema.transactions.id, n: m.schema.transactions.installmentNumber, status: m.schema.transactions.status })
        .from(m.schema.transactions)
        .where(eq(m.schema.transactions.householdId, s.householdId));
      expect(rows).toHaveLength(3);
      const posted = rows.find((row) => row.status === 'posted');
      if (posted === undefined) throw new Error('Sem parcela postada.');

      // A confirmação diz a VERDADE antes: com as 2 futuras ficando, a reimportação falha.
      const only = await m.del.getDeleteImpact(s.householdId, posted.id, 'only');
      expect(only.effects).toContainEqual({
        kind: 'reimport_will_fail',
        planDescription: 'Compra parcelada',
        blockingInstallments: 2,
      });
      expect(only.effects).not.toContainEqual({ kind: 'returns_on_reimport' });
      // Levando as futuras junto, nada colide: aí sim volta.
      const withFuture = await m.del.getDeleteImpact(s.householdId, posted.id, 'with-future');
      expect(withFuture.effects).toContainEqual({ kind: 'returns_on_reimport' });
      expect(withFuture.effects.some((effect) => effect.kind === 'reimport_will_fail')).toBe(false);

      await m.del.deleteTransaction(s.householdId, posted.id, 'only'); // deixa as 2 futuras
      const afterDelete = await m.db.select({ id: m.schema.transactions.id }).from(m.schema.transactions).where(eq(m.schema.transactions.householdId, s.householdId));
      expect(afterDelete).toHaveLength(2);
      // Sem a lida, apagar UMA das projetadas ainda deixa a outra colidindo.
      const sibling = await m.del.getDeleteImpact(s.householdId, afterDelete[0]?.id ?? '', 'only');
      expect(sibling.effects).toContainEqual({
        kind: 'reimport_will_fail',
        planDescription: 'Compra parcelada',
        blockingInstallments: 1,
      });

      // O resultado REAL (hipótese: o lote falha inteiro por violação do índice único
      // de dedupe_hash das filhas que ficaram; não duplica em silêncio).
      let outcome: 'rejeitou' | 'aceitou' = 'aceitou';
      let cause = '';
      try {
        await m.imp.commitImport(s.householdId, input);
      } catch (error) {
        outcome = 'rejeitou';
        // O erro do drizzle embrulha o do Postgres em `cause`.
        const inner = (error as { cause?: { code?: string; constraint_name?: string } }).cause;
        cause = `${inner?.code ?? '?'}/${inner?.constraint_name ?? '?'}`;
      }
      const afterReimport = await m.db.select({ id: m.schema.transactions.id }).from(m.schema.transactions).where(eq(m.schema.transactions.householdId, s.householdId));
      // Nunca pode ter duplicado calado: ou rejeita e nada muda, ou aceita sem repetir as filhas.
      if (outcome === 'rejeitou') expect(afterReimport).toHaveLength(2);
      else expect(afterReimport.length).toBeLessThanOrEqual(3);
      console.info(`[R1] reimportar após apagar a parcela postada: ${outcome}; linhas depois: ${String(afterReimport.length)}`);
      expect(outcome).toBe('rejeitou');
      // E rejeitou PELO MOTIVO previsto, não por outro erro qualquer: violação (23505)
      // do índice único de dedupe_hash das parcelas futuras que ficaram.
      expect(cause).toBe('23505/transactions_household_id_dedupe_hash_unique');
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  it('A1: plano importado mês a mês (3/10 no lote A, 4/10 no lote B, ambas lidas): apagar a 3/10 avisa que a reimportação falha', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      const [plan] = await m.db
        .insert(m.schema.installmentPlans)
        .values({
          householdId: s.householdId,
          creditCardId: s.cardId,
          description: 'Geladeira',
          totalCents: -100000,
          installmentsCount: 10,
          firstCompetence: '2026-07',
          source: 'import',
        })
        .returning({ id: m.schema.installmentPlans.id });
      if (plan === undefined) throw new Error('Plano não foi criado.');
      const lote = async (fileName: string) => {
        const [batch] = await m.db
          .insert(m.schema.importBatches)
          .values({ householdId: s.householdId, fileName, fileHash: fileName.padEnd(64, 'x'), format: 'text', rowsImported: 1 })
          .returning({ id: m.schema.importBatches.id });
        if (batch === undefined) throw new Error('Lote não foi criado.');
        return batch.id;
      };
      const [batchA, batchB] = [await lote('a'), await lote('b')];
      const parcela = (n: number, batchId: string) =>
        s.insertTx({
          competence: addCompetence('2026-07', n - 3),
          creditCardId: s.cardId,
          accountId: null,
          description: `Geladeira (${String(n)}/10)`,
          rawDescription: `GELADEIRA ${String(n)}/10`,
          installmentPlanId: plan.id,
          installmentNumber: n,
          importBatchId: batchId,
          dedupeHash: `spread-hash-${String(n)}`,
        });
      const third = await parcela(3, batchA);
      const fourth = await parcela(4, batchB);

      // A 4/10 (lida, de outro lote) ficando colide com o que o lote A recriaria.
      const only = await m.del.getDeleteImpact(s.householdId, third, 'only');
      expect(only.effects).toContainEqual({
        kind: 'reimport_will_fail',
        planDescription: 'Geladeira',
        blockingInstallments: 1,
      });
      expect(only.effects).not.toContainEqual({ kind: 'returns_on_reimport' });

      // Apagar a 4/10 com a 3/10 lida ainda lá: a 3/10 é pulada na reimportação, nada colide.
      const fourthImpact = await m.del.getDeleteImpact(s.householdId, fourth, 'only');
      expect(fourthImpact.effects.some((effect) => effect.kind === 'reimport_will_fail')).toBe(false);
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  it('apagar uma parcela PROJETADA com a lida ainda no banco: o impacto diz que não volta, e a reimportação real confirma', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      const input = {
        fileName: 'fatura.txt',
        fileHash: 'b'.repeat(64),
        bankKey: null,
        format: 'text' as const,
        sourceKind: 'credit_card' as const,
        sourceId: s.cardId,
        confirmedRows: [
          {
            index: 0,
            include: true,
            occurredOn: '2026-09-05',
            description: 'Compra parcelada',
            rawDescription: 'Compra parcelada 1/3',
            amountCents: cents(-1000),
            categoryId: null,
            memberId: null,
            installment: { current: 1, total: 3 },
          },
        ],
        reportedTotalCents: null,
        allowReimport: true,
        statementCompetence: '2026-09',
      };
      await m.imp.commitImport(s.householdId, input);
      const rows = async () =>
        m.db
          .select({ id: m.schema.transactions.id, n: m.schema.transactions.installmentNumber })
          .from(m.schema.transactions)
          .where(eq(m.schema.transactions.householdId, s.householdId));
      const second = (await rows()).find((row) => row.n === 2);
      if (second === undefined) throw new Error('Sem a parcela 2/3.');

      const impact = await m.del.getDeleteImpact(s.householdId, second.id, 'only');
      expect(impact.effects).toContainEqual({ kind: 'stays_deleted_on_reimport' });
      expect(impact.effects).not.toContainEqual({ kind: 'returns_on_reimport' });

      await m.del.deleteTransaction(s.householdId, second.id, 'only');
      await m.imp.commitImport(s.householdId, input); // não falha: a 1/3 é pulada como duplicada
      const after = await rows();
      expect(after).toHaveLength(2);
      expect(after.map((row) => row.n).sort()).toEqual([1, 3]); // a 2/3 NÃO voltou
    } finally {
      await cleanup(m, s.householdId);
    }
  });

  describe('previsão de recorrência (dispensa; exige a migration 0004)', () => {
    const TODAY = '2026-10-15';
    async function setup(m: Modules) {
      const s = await seed(m);
      const id = await m.recurring.createRecurringExpense(
        s.householdId,
        {
          description: 'Conta de luz',
          expectedCents: cents(-18000),
          categoryId: s.categoryId,
          dueDay: 5,
          frequency: 'monthly',
          accountId: s.accountId,
          creditCardId: null,
          startsOn: '2026-10-01',
          endsOn: null,
          annualAdjustmentBp: null,
        },
        TODAY,
      );
      const rows = async () =>
        (
          await m.db
            .select()
            .from(m.schema.transactions)
            .where(eq(m.schema.transactions.recurringExpenseId, id))
        ).sort((x, y) => x.competence.localeCompare(y.competence));
      return { ...s, id, rows };
    }

    it('apagar a de novembro: o top-up NÃO a recria, a de dezembro continua e o impacto explica', async (ctx) => {
      const m = await modules();
      if (!(await hasSkippedTable(m))) ctx.skip();
      const s = await setup(m);
      try {
        const november = (await s.rows()).find((row) => row.competence === '2026-11');
        if (november === undefined) throw new Error('Sem novembro.');
        const impact = await m.del.getDeleteImpact(s.householdId, november.id, 'only');
        expect(impact.effects).toEqual([
          { kind: 'occurrence_skipped', ruleDescription: 'Conta de luz', competence: '2026-11' },
        ]);

        await m.del.deleteTransaction(s.householdId, november.id, 'only');
        await m.write.topUpPlanned(s.householdId, TODAY);
        await m.write.topUpPlanned(s.householdId, TODAY);
        const competences = (await s.rows()).map((row) => row.competence);
        expect(competences).not.toContain('2026-11');
        expect(competences).toContain('2026-12');
        expect(competences).toHaveLength(5);
      } finally {
        await cleanup(m, s.householdId);
      }
    });

    it('editar o valor depois NÃO ressuscita a dispensada (o replan respeita), e o futuro sai no valor novo', async (ctx) => {
      const m = await modules();
      if (!(await hasSkippedTable(m))) ctx.skip();
      const s = await setup(m);
      try {
        const november = (await s.rows()).find((row) => row.competence === '2026-11');
        if (november === undefined) throw new Error('Sem novembro.');
        await m.del.deleteTransaction(s.householdId, november.id, 'only');
        await m.recurring.updateRecurringExpense(
          s.householdId,
          s.id,
          {
            description: 'Conta de luz',
            expectedCents: cents(-22000),
            categoryId: s.categoryId,
            dueDay: 5,
            frequency: 'monthly',
            accountId: s.accountId,
            creditCardId: null,
            startsOn: '2026-10-01',
            endsOn: null,
            annualAdjustmentBp: null,
          },
          TODAY,
        );
        const after = await s.rows();
        expect(after.map((row) => row.competence)).not.toContain('2026-11');
        expect(after.find((row) => row.competence === '2026-12')?.amountCents).toBe(-22000);
      } finally {
        await cleanup(m, s.householdId);
      }
    });

    it('apagar a VENCIDA e não realizada resolve a pendência: some e não volta', async (ctx) => {
      const m = await modules();
      if (!(await hasSkippedTable(m))) ctx.skip();
      const s = await setup(m);
      try {
        const october = (await s.rows()).find((row) => row.competence === '2026-10');
        if (october === undefined) throw new Error('Sem outubro.');
        expect(october.occurredOn < TODAY).toBe(true); // vencida: 05/10 < 15/10
        await m.del.deleteTransaction(s.householdId, october.id, 'only');
        await m.write.topUpPlanned(s.householdId, TODAY);
        expect((await s.rows()).map((row) => row.competence)).not.toContain('2026-10');
      } finally {
        await cleanup(m, s.householdId);
      }
    });

    it('dispensar a mesma ocorrência duas vezes é idempotente', async (ctx) => {
      const m = await modules();
      if (!(await hasSkippedTable(m))) ctx.skip();
      const s = await setup(m);
      try {
        await m.db.transaction(async (tx) => {
          await m.write.recordSkippedOccurrence(tx, s.householdId, { expenseId: s.id }, '2026-12');
          await m.write.recordSkippedOccurrence(tx, s.householdId, { expenseId: s.id }, '2026-12');
        });
        const marks = await m.db
          .select({ id: m.schema.skippedOccurrences.id })
          .from(m.schema.skippedOccurrences)
          .where(eq(m.schema.skippedOccurrences.householdId, s.householdId));
        expect(marks).toHaveLength(1);
      } finally {
        await cleanup(m, s.householdId);
      }
    });
  });
});
