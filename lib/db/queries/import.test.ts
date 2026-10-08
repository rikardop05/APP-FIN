import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { cents } from '@/lib/money';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // The test remains skipped on environments without a local database.
  }
}

/**
 * This is intentionally an integration test: a fake transaction can prove
 * that a callback was called, but not that PostgreSQL rolled back rows already
 * inserted before the injected failure.
 */
describe.skipIf(process.env.DATABASE_URL === undefined)('commitImport atomicity', () => {
  it('rolls back batch, statement, plan and transactions after a mid-commit failure', async () => {
    const [{ db }, schema, { commitImport }] = await Promise.all([
      import('@/lib/db'),
      import('@/lib/db/schema'),
      import('./import'),
    ]);
    const {
      creditCards,
      households,
      importBatches,
      installmentPlans,
      statements,
      transactions,
    } = schema;
    const [household] = await db
      .insert(households)
      .values({ name: 'T-108 atomicity test' })
      .returning({ id: households.id });
    if (household === undefined) throw new Error('Test household was not created.');

    try {
      const [card] = await db
        .insert(creditCards)
        .values({
          householdId: household.id,
          name: 'T-108 card',
          bank: null,
          brand: 'other',
          holderMemberId: null,
          paymentAccountId: null,
          creditLimitCents: null,
          closingDay: 10,
          dueDay: 20,
          active: true,
        })
        .returning({ id: creditCards.id });
      if (card === undefined) throw new Error('Test card was not created.');

      await expect(
        commitImport(
          household.id,
          {
            fileName: 'atomicity.txt',
            fileHash: 'a'.repeat(64),
            bankKey: null,
            format: 'text',
            sourceKind: 'credit_card',
            sourceId: card.id,
            confirmedRows: [
              {
                index: 0,
                include: true,
                occurredOn: '2026-09-05',
                description: 'Compra de teste',
                rawDescription: 'Compra de teste',
                amountCents: cents(-1000),
                categoryId: null,
                memberId: null,
                installment: null,
              },
            ],
            reportedTotalCents: null,
            allowReimport: false,
            statementCompetence: '2026-09',
          },
          { failAfter: 'transactions' },
        ),
      ).rejects.toThrow('Falha de teste após os lançamentos.');

      const [batchRows, statementRows, planRows, transactionRows] = await Promise.all([
        db.select({ id: importBatches.id }).from(importBatches).where(eq(importBatches.householdId, household.id)),
        db
          .select({ id: statements.id })
          .from(statements)
          .innerJoin(creditCards, eq(creditCards.id, statements.creditCardId))
          .where(and(eq(creditCards.householdId, household.id), eq(statements.period, '2026-09'))),
        db.select({ id: installmentPlans.id }).from(installmentPlans).where(eq(installmentPlans.householdId, household.id)),
        db.select({ id: transactions.id }).from(transactions).where(eq(transactions.householdId, household.id)),
      ]);
      expect(batchRows).toHaveLength(0);
      expect(statementRows).toHaveLength(0);
      expect(planRows).toHaveLength(0);
      expect(transactionRows).toHaveLength(0);
    } finally {
      await db.delete(households).where(eq(households.id, household.id));
    }
  });
});

async function createImportFixture(label: string) {
  const [{ db }, schema] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
  ]);
  const [household] = await db
    .insert(schema.households)
    .values({ name: `T-108 ${label}` })
    .returning({ id: schema.households.id });
  if (household === undefined) throw new Error('Test household was not created.');

  const [card] = await db
    .insert(schema.creditCards)
    .values({
      householdId: household.id,
      name: `T-108 ${label} card`,
      bank: null,
      brand: 'other',
      holderMemberId: null,
      paymentAccountId: null,
      creditLimitCents: null,
      closingDay: 10,
      dueDay: 20,
      active: true,
    })
    .returning({ id: schema.creditCards.id });
  if (card === undefined) throw new Error('Test card was not created.');

  return {
    db,
    schema,
    householdId: household.id,
    cardId: card.id,
    cleanup: async () => {
      await db.delete(schema.households).where(eq(schema.households.id, household.id));
    },
  };
}

describe.skipIf(process.env.DATABASE_URL === undefined)('import dedupe and revert boundaries', () => {
  it('does not add transactions when the same confirmed file is committed twice', async () => {
    const fixture = await createImportFixture('dedupe');
    const { commitImport } = await import('./import');
    const input = {
      fileName: 'same-file.txt',
      fileHash: 'b'.repeat(64),
      bankKey: null,
      format: 'text' as const,
      sourceKind: 'credit_card' as const,
      sourceId: fixture.cardId,
      confirmedRows: [
        {
          index: 0,
          include: true,
          occurredOn: '2026-09-05',
          description: 'Compra repetida',
          rawDescription: 'Compra repetida',
          amountCents: cents(-1500),
          categoryId: null,
          memberId: null,
          installment: null,
        },
      ],
      reportedTotalCents: null,
      allowReimport: false,
      statementCompetence: '2026-09',
    };

    try {
      const first = await commitImport(fixture.householdId, input);
      const second = await commitImport(fixture.householdId, {
        ...input,
        allowReimport: true,
      });
      const rows = await fixture.db
        .select({ id: fixture.schema.transactions.id })
        .from(fixture.schema.transactions)
        .where(eq(fixture.schema.transactions.householdId, fixture.householdId));

      expect(first.rowsImported).toBe(1);
      expect(second.rowsImported).toBe(0);
      expect(second.rowsDuplicated).toBe(1);
      expect(rows).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it('revert removes only its own rows and leaves no plan or statement orphan', async () => {
    const fixture = await createImportFixture('revert-boundary');
    const { commitImport, revertImport } = await import('./import');
    const first = {
      fileName: 'first.txt',
      fileHash: 'c'.repeat(64),
      bankKey: null,
      format: 'text' as const,
      sourceKind: 'credit_card' as const,
      sourceId: fixture.cardId,
      confirmedRows: [
        {
          index: 0,
          include: true,
          occurredOn: '2026-09-05',
          description: 'Compra parcelada',
          rawDescription: 'Compra parcelada 1/2',
          amountCents: cents(-1000),
          categoryId: null,
          memberId: null,
          installment: { current: 1, total: 2 },
        },
      ],
      reportedTotalCents: null,
      allowReimport: false,
      statementCompetence: '2026-09',
    };
    const second = {
      ...first,
      fileName: 'second.txt',
      fileHash: 'd'.repeat(64),
      confirmedRows: [
        {
          index: 0,
          include: true,
          occurredOn: '2026-09-05',
          rawDescription: 'Outra compra',
          description: 'Outra compra',
          amountCents: cents(-2000),
          categoryId: null,
          memberId: null,
          installment: null,
        },
      ],
    };

    try {
      const firstBatch = await commitImport(fixture.householdId, first);
      const secondBatch = await commitImport(fixture.householdId, second);
      const reverted = await revertImport(fixture.householdId, firstBatch.batchId);
      const afterFirst = await fixture.db
        .select({ id: fixture.schema.transactions.id, batchId: fixture.schema.transactions.importBatchId })
        .from(fixture.schema.transactions)
        .where(eq(fixture.schema.transactions.householdId, fixture.householdId));
      const plansAfterFirst = await fixture.db
        .select({ id: fixture.schema.installmentPlans.id })
        .from(fixture.schema.installmentPlans)
        .where(eq(fixture.schema.installmentPlans.householdId, fixture.householdId));
      const statementsAfterFirst = await fixture.db
        .select({ id: fixture.schema.statements.id })
        .from(fixture.schema.statements)
        .innerJoin(
          fixture.schema.creditCards,
          eq(fixture.schema.creditCards.id, fixture.schema.statements.creditCardId),
        )
        .where(eq(fixture.schema.creditCards.householdId, fixture.householdId));

      expect(reverted.transactionsDeleted).toBe(2);
      expect(afterFirst).toEqual([
        { id: expect.any(String), batchId: secondBatch.batchId },
      ]);
      expect(plansAfterFirst).toHaveLength(0);
      expect(statementsAfterFirst).toHaveLength(1);

      const revertedSecond = await revertImport(fixture.householdId, secondBatch.batchId);
      const [remainingTransactions, remainingPlans, remainingStatements] = await Promise.all([
        fixture.db
          .select({ id: fixture.schema.transactions.id })
          .from(fixture.schema.transactions)
          .where(eq(fixture.schema.transactions.householdId, fixture.householdId)),
        fixture.db
          .select({ id: fixture.schema.installmentPlans.id })
          .from(fixture.schema.installmentPlans)
          .where(eq(fixture.schema.installmentPlans.householdId, fixture.householdId)),
        fixture.db
          .select({ id: fixture.schema.statements.id })
          .from(fixture.schema.statements)
          .innerJoin(
            fixture.schema.creditCards,
            eq(fixture.schema.creditCards.id, fixture.schema.statements.creditCardId),
          )
          .where(eq(fixture.schema.creditCards.householdId, fixture.householdId)),
      ]);
      expect(revertedSecond.transactionsDeleted).toBe(1);
      expect(remainingTransactions).toHaveLength(0);
      expect(remainingPlans).toHaveLength(0);
      expect(remainingStatements).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  /**
   * A regra que este teste descreve: `period` da fatura vem da escolha do
   * usuário ("Competência padrão"), não de uma transação do lote. Um cartão
   * carrega compras de vários meses (parcelas, estornos que cruzam o
   * fechamento) — nenhuma transação é fonte legítima dessa informação.
   *
   * Quatro linhas em quatro competências diferentes, fatura declarada em uma
   * quinta: o `period` da fatura gravada é a quinta, não a primeira nem a
   * maioria nem nada inferido.
   */
  it('uses the declared statementCompetence, not any transaction competence', async () => {
    const fixture = await createImportFixture('statement-period');
    const { commitImport } = await import('./import');
    const input = {
      fileName: 'competencias-diferentes.txt',
      fileHash: 'e'.repeat(64),
      bankKey: null,
      format: 'text' as const,
      sourceKind: 'credit_card' as const,
      sourceId: fixture.cardId,
      confirmedRows: [
        {
          index: 0,
          include: true,
          occurredOn: '2025-10-05',
          description: 'Compra de 2025-10',
          rawDescription: 'Compra de 2025-10',
          amountCents: cents(-1000),
          categoryId: null,
          memberId: null,
          installment: null,
        },
        {
          index: 1,
          include: true,
          occurredOn: '2025-11-05',
          description: 'Compra de 2025-11',
          rawDescription: 'Compra de 2025-11',
          amountCents: cents(-2000),
          categoryId: null,
          memberId: null,
          installment: null,
        },
        {
          index: 2,
          include: true,
          occurredOn: '2025-12-05',
          description: 'Compra de 2025-12',
          rawDescription: 'Compra de 2025-12',
          amountCents: cents(-3000),
          categoryId: null,
          memberId: null,
          installment: null,
        },
        {
          index: 3,
          include: true,
          occurredOn: '2026-01-05',
          description: 'Compra de 2026-01',
          rawDescription: 'Compra de 2026-01',
          amountCents: cents(-4000),
          categoryId: null,
          memberId: null,
          installment: null,
        },
      ],
      reportedTotalCents: null,
      allowReimport: false,
      // A fatura e de 2026-02. As linhas estao em quatro meses diferentes,
      // nenhum deles e 2026-02. A escolha do usuario e que vale.
      statementCompetence: '2026-02',
    };

    try {
      await commitImport(fixture.householdId, input);
      const [statement] = await fixture.db
        .select({ period: fixture.schema.statements.period })
        .from(fixture.schema.statements)
        .innerJoin(
          fixture.schema.creditCards,
          eq(fixture.schema.creditCards.id, fixture.schema.statements.creditCardId),
        )
        .where(eq(fixture.schema.creditCards.householdId, fixture.householdId));
      expect(statement).toBeDefined();
      expect(statement?.period).toBe('2026-02');
    } finally {
      await fixture.cleanup();
    }
  });

  /**
   * O total IMPRESSO no documento atravessa o caminho inteiro: parser ->
   * `buildImportPreview` -> JSON da rota de upload -> `uploadResponseSchema` do
   * cliente -> corpo do commit (como `import-confirmation.tsx` o monta) ->
   * `commitBodySchema` -> `commitImport` -> `statements.reported_total_cents`.
   * Antes ele morria no preview e o cliente mandava `null` fixo.
   *
   * O impresso (-2000) difere de propósito da soma das linhas (-1500): prova
   * que o gravado é o do documento, não um total recalculado.
   */
  it('grava em statements.reported_total_cents o total impresso que veio do preview', async () => {
    const fixture = await createImportFixture('reported-total');
    const [{ commitImport }, { buildImportPreview }, { uploadResponseSchema }, { commitBodySchema }] =
      await Promise.all([
        import('./import'),
        import('@/lib/import/pipeline'),
        import('@/components/import/schemas'),
        import('@/app/api/import/schemas'),
      ]);

    try {
      const preview = buildImportPreview({
        parse: {
          rows: [
            {
              occurredOn: '2026-09-05',
              rawDescription: 'Compra com total impresso',
              amountCents: cents(-1500),
              fitId: null,
              installment: null,
            },
          ],
          diagnostics: [],
          reportedTotalCents: cents(-2000),
        },
        sourceId: fixture.cardId,
        sourceKind: 'credit_card',
        cardCycle: { closingDay: 10, dueDay: 20 },
        rules: [],
        existingHashes: new Set<string>(),
        today: '2026-09-30',
        statementCompetence: '2026-09',
      });
      const uploaded = uploadResponseSchema.parse(
        JSON.parse(
          JSON.stringify({
            fileName: 'total-impresso.pdf',
            fileHash: 'f'.repeat(64),
            format: 'pdf',
            bankKey: 'santander',
            sourceKind: 'credit_card',
            sourceId: fixture.cardId,
            cardCycle: { closingDay: 10, dueDay: 20 },
            preview,
            previousBatches: [],
          }),
        ),
      );
      const row = uploaded.preview.rows[0];
      if (row === undefined || row.occurredOn === null || row.amountCents === null) {
        throw new Error('Preview row was not built.');
      }
      const body = commitBodySchema.parse({
        fileName: uploaded.fileName,
        fileHash: uploaded.fileHash,
        bankKey: uploaded.bankKey,
        format: uploaded.format,
        sourceKind: 'credit_card',
        sourceId: uploaded.sourceId,
        confirmedRows: [
          {
            index: row.index,
            include: true,
            occurredOn: row.occurredOn,
            description: row.description,
            rawDescription: row.rawDescription,
            amountCents: row.amountCents,
            categoryId: null,
            memberId: null,
            installment: null,
          },
        ],
        reportedTotalCents: uploaded.preview.reportedTotalCents,
        allowReimport: false,
        defaultCompetence: '2026-09',
      });
      if (body.sourceKind !== 'credit_card') throw new Error('Unexpected source kind.');

      await commitImport(fixture.householdId, {
        fileName: body.fileName,
        fileHash: body.fileHash,
        bankKey: body.bankKey,
        format: body.format,
        sourceId: body.sourceId,
        confirmedRows: body.confirmedRows,
        reportedTotalCents: body.reportedTotalCents,
        allowReimport: body.allowReimport,
        sourceKind: 'credit_card',
        statementCompetence: body.defaultCompetence,
      });

      const [statement] = await fixture.db
        .select({ reported: fixture.schema.statements.reportedTotalCents })
        .from(fixture.schema.statements)
        .innerJoin(
          fixture.schema.creditCards,
          eq(fixture.schema.creditCards.id, fixture.schema.statements.creditCardId),
        )
        .where(eq(fixture.schema.creditCards.householdId, fixture.householdId));
      expect(statement).toBeDefined();
      expect(Number(statement?.reported)).toBe(-2000);
    } finally {
      await fixture.cleanup();
    }
  });

  /**
   * Achado A2 do Corvo: o ramo de fatura JÁ EXISTENTE descartava o total impresso.
   * Fixture: 1º lote sem total (fatura com NULL, como as gravadas antes de 0d01c12);
   * 2º lote do MESMO período, arquivo diferente, com total → preenche; 3º lote com
   * outro total → NÃO sobrescreve (COALESCE, idempotente).
   */
  it('2º lote do mesmo período preenche o total impresso NULL e não sobrescreve um já gravado', async () => {
    const fixture = await createImportFixture('reported-total-existing');
    const { commitImport } = await import('./import');
    const batch = (hash: string, description: string, reported: number | null) => ({
      fileName: `${hash}.txt`,
      fileHash: hash.repeat(64).slice(0, 64),
      bankKey: null,
      format: 'text' as const,
      sourceKind: 'credit_card' as const,
      sourceId: fixture.cardId,
      confirmedRows: [
        {
          index: 0,
          include: true,
          occurredOn: '2026-09-05',
          description,
          rawDescription: description,
          amountCents: cents(-1500),
          categoryId: null,
          memberId: null,
          installment: null,
        },
      ],
      reportedTotalCents: reported === null ? null : cents(reported),
      allowReimport: false,
      statementCompetence: '2026-09' as const,
    });
    const readReported = async () => {
      const rows = await fixture.db
        .select({
          id: fixture.schema.statements.id,
          reported: fixture.schema.statements.reportedTotalCents,
        })
        .from(fixture.schema.statements)
        .innerJoin(
          fixture.schema.creditCards,
          eq(fixture.schema.creditCards.id, fixture.schema.statements.creditCardId),
        )
        .where(eq(fixture.schema.creditCards.householdId, fixture.householdId));
      return rows;
    };

    try {
      await commitImport(fixture.householdId, batch('a', 'Compra A', null));
      const [afterFirst, ...extraFirst] = await readReported();
      expect(extraFirst).toHaveLength(0);
      expect(afterFirst?.reported).toBeNull();

      await commitImport(fixture.householdId, batch('b', 'Compra B', -2000));
      const [afterSecond, ...extraSecond] = await readReported();
      expect(extraSecond).toHaveLength(0);
      expect(afterSecond?.id).toBe(afterFirst?.id);
      expect(Number(afterSecond?.reported)).toBe(-2000);

      await commitImport(fixture.householdId, batch('c', 'Compra C', -9999));
      const [afterThird] = await readReported();
      expect(Number(afterThird?.reported)).toBe(-2000);
    } finally {
      await fixture.cleanup();
    }
  });
});

describe.skipIf(process.env.DATABASE_URL === undefined)('importacao: linha informativa (decisao 8)', () => {
  it('rowsImported subtrai TODO o skipped (duplicata, informativa e desmarcada), e o zero nao vira lancamento', async () => {
    const fixture = await createImportFixture('informational');
    const { commitImport } = await import('./import');
    const row = (index: number, overrides: Record<string, unknown>) => ({
      index,
      include: true,
      occurredOn: '2026-09-05',
      description: `Linha ${String(index)}`,
      rawDescription: `Linha ${String(index)}`,
      amountCents: cents(-1500 - index),
      categoryId: null,
      memberId: null,
      installment: null,
      ...overrides,
    });
    const base = {
      fileName: 'informativa.txt',
      fileHash: 'c'.repeat(64),
      bankKey: null,
      format: 'text' as const,
      sourceKind: 'credit_card' as const,
      sourceId: fixture.cardId,
      reportedTotalCents: null,
      allowReimport: false,
      statementCompetence: '2026-09' as const,
    };

    try {
      const result = await commitImport(fixture.householdId, {
        ...base,
        confirmedRows: [
          row(0, {}),
          row(1, {}),
          // Informativa: valor CONFIRMADO zero, com parcela impressa ao lado.
          row(2, { description: 'ANUIDADE DIFERENCIADA', rawDescription: 'ANUIDADE DIFERENCIADA 01/12', amountCents: cents(0), installment: { current: 1, total: 12 } }),
          // Desmarcada pelo usuario.
          row(3, { include: false }),
          // Duplicata da linha 0 (mesmo dia, valor e descricao).
          row(4, { description: 'Linha 0', rawDescription: 'Linha 0', amountCents: cents(-1500) }),
        ],
      });
      const rows = await fixture.db
        .select({ amountCents: fixture.schema.transactions.amountCents, kind: fixture.schema.transactions.kind })
        .from(fixture.schema.transactions)
        .where(eq(fixture.schema.transactions.householdId, fixture.householdId));
      const plans = await fixture.db
        .select({ id: fixture.schema.installmentPlans.id })
        .from(fixture.schema.installmentPlans)
        .where(eq(fixture.schema.installmentPlans.householdId, fixture.householdId));

      // 5 linhas lidas: 2 importadas (0 e 1); a informativa, a desmarcada e a duplicata ficam de fora.
      expect(result.rowsImported).toBe(2);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => Number(r.amountCents) !== 0 && r.kind === 'expense')).toBe(true);
      expect(plans).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });
});
