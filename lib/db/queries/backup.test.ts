import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local os testes de banco ficam pulados.
  }
}

/**
 * T-402: backup e restauração contra o SQL real. O teste que importa é a IDA E VOLTA:
 * household com linha em TODAS as tabelas -> exporta -> restaura noutro household vazio ->
 * exporta de novo -> iguais a menos de ids (traduzidos pelo mapa da restauração) e do
 * `exportedAt`; e o painel (`getDashboardData`) dá os mesmos números nos dois.
 * Households PRÓPRIOS, apagados no `finally`, com a checagem barulhenta de que sumiram.
 */

const TODAY = '2026-10-15';
const EXPORTED_AT = '2026-10-15T12:00:00.000Z';

async function modules() {
  const [{ db }, schema, backup, dashboard, { domainFailure }] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('./backup'),
    import('./dashboard'),
    import('@/app/api/backup/domain-errors'),
  ]);
  return { db, schema, backup, dashboard, domainFailure };
}
type Modules = Awaited<ReturnType<typeof modules>>;

async function newHousehold(m: Modules, name: string) {
  const { db, schema } = m;
  const [household] = await db.insert(schema.households).values({ name }).returning({ id: schema.households.id });
  if (household === undefined) throw new Error('Household de teste não foi criado.');
  const [member] = await db
    .insert(schema.members)
    .values({ householdId: household.id, name: `Pessoa ${name}`, email: `t402-${randomUUID()}@example.test`, color: '#123456' })
    .returning({ id: schema.members.id, email: schema.members.email });
  if (member === undefined) throw new Error('Membro de teste não foi criado.');
  return { householdId: household.id, memberId: member.id, email: member.email };
}

async function cleanup(m: Modules, householdId: string) {
  const { db, schema } = m;
  await db.execute(
    sql`update statements set paid_transaction_id = null where credit_card_id in (select id from credit_cards where household_id = ${householdId})`,
  );
  await db.execute(
    sql`update transactions set status = 'planned', reconciled_by_transaction_id = null where household_id = ${householdId} and status = 'reconciled'`,
  );
  await db.delete(schema.transactions).where(eq(schema.transactions.householdId, householdId));
  await db.delete(schema.importBatches).where(eq(schema.importBatches.householdId, householdId));
  await db.delete(schema.households).where(eq(schema.households.id, householdId));
  const left = await db.select({ id: schema.households.id }).from(schema.households).where(eq(schema.households.id, householdId));
  if (left.length > 0) throw new Error(`Limpeza falhou: o household de teste ${householdId} continua no banco.`);
}

/** Uma linha em cada tabela do backup (e mais, onde a FK especial precisa: reconciled, pagamento de fatura). */
async function seedEverything(m: Modules, householdId: string, memberId: string) {
  const { db, schema } = m;
  const one = async <T extends { id: string }>(promise: Promise<T[]>): Promise<T> => {
    const [row] = await promise;
    if (row === undefined) throw new Error('Fixture não foi criada.');
    return row;
  };
  await db.insert(schema.householdSettings).values({ householdId, emergencyFundMonths: 9, budgetWarnBp: 7000, projectionMonths: 6, commitmentMonths: 12 });
  const account = await one(db.insert(schema.accounts).values({ householdId, name: 'Corrente', kind: 'checking', openingBalanceCents: 500_000, openingDate: '2026-01-01' }).returning({ id: schema.accounts.id }));
  const card = await one(db.insert(schema.creditCards).values({ householdId, name: 'Cartão', closingDay: 25, dueDay: 5, holderMemberId: memberId, paymentAccountId: account.id, creditLimitCents: 1_000_000 }).returning({ id: schema.creditCards.id }));
  const root = await one(db.insert(schema.categories).values({ householdId, name: 'Moradia', parentId: null, nature: 'essential' }).returning({ id: schema.categories.id }));
  const leaf = await one(db.insert(schema.categories).values({ householdId, name: 'Luz', parentId: root.id, nature: 'essential', sortOrder: 2 }).returning({ id: schema.categories.id }));
  await db.insert(schema.categorizationRules).values({ householdId, pattern: 'ENEL', categoryId: leaf.id, memberId, priority: 10, hits: 3 });
  await db.insert(schema.importMappings).values({ householdId, bankKey: 'banco-x', format: 'csv', columnMap: { data: 0, valor: 2 }, dateFormat: 'dd/MM/yyyy' });
  const plan = await one(db.insert(schema.installmentPlans).values({ householdId, creditCardId: card.id, description: 'Geladeira', totalCents: -300_000, installmentsCount: 3, firstCompetence: '2026-09', categoryId: leaf.id, source: 'manual' }).returning({ id: schema.installmentPlans.id }));
  const expense = await one(db.insert(schema.recurringExpenses).values({ householdId, description: 'Conta de luz', expectedCents: -18_000, categoryId: leaf.id, dueDay: 5, accountId: account.id, startsOn: '2026-01-01', annualAdjustmentBp: 500 }).returning({ id: schema.recurringExpenses.id }));
  const income = await one(db.insert(schema.incomes).values({ householdId, memberId, accountId: account.id, description: 'Salário', kind: 'salary', expectedCents: 740_000, receiveDay: 5, startsOn: '2026-01-01' }).returning({ id: schema.incomes.id }));
  await db.insert(schema.budgets).values({ householdId, period: '2026-10', categoryId: leaf.id, plannedCents: 20_000 });
  await db.insert(schema.goals).values({ householdId, name: 'Reserva', targetCents: 3_000_000, currentCents: 0, accountId: account.id, isEmergencyFund: true });
  const investment = await one(db.insert(schema.investmentPlans).values({ householdId, name: 'Independência', desiredMonthlyIncomeCents: 1_000_000, currentPortfolioCents: 5_000_000, currentMonthlyContributionCents: 200_000, targetDate: '2046-10-01' }).returning({ id: schema.investmentPlans.id }));
  await db.insert(schema.investmentScenarios).values([
    { investmentPlanId: investment.id, label: 'conservative', realReturnBp: 300, withdrawalBp: 300 },
    { investmentPlanId: investment.id, label: 'moderate', realReturnBp: 500, withdrawalBp: 400 },
    { investmentPlanId: investment.id, label: 'optimistic', realReturnBp: 700, withdrawalBp: 500 },
  ]);
  const statement = await one(db.insert(schema.statements).values({ creditCardId: card.id, period: '2026-09', closingDate: '2026-09-25', dueDate: '2026-10-05', reportedTotalCents: -100_000, status: 'paid', source: 'import' }).returning({ id: schema.statements.id }));
  const batch = await one(db.insert(schema.importBatches).values({ householdId, fileName: 'fatura.pdf', fileHash: 'f'.repeat(64), format: 'pdf', creditCardId: card.id, statementId: statement.id, rowsRead: 2, rowsImported: 2, status: 'committed' }).returning({ id: schema.importBatches.id }));
  await db.insert(schema.skippedOccurrences).values({ householdId, recurringExpenseId: expense.id, competence: '2026-12' });

  const base = { householdId, rawDescription: '' } as const;
  const tx = async (values: Partial<typeof schema.transactions.$inferInsert> & { competence: string; amountCents: number; kind: 'expense' | 'income' | 'credit_card_payment' }) =>
    one(
      db
        .insert(schema.transactions)
        .values({ ...base, occurredOn: `${values.competence}-05`, cashDate: `${values.competence}-05`, description: 'x', ...values })
        .returning({ id: schema.transactions.id }),
    );
  // Compra no cartão, com lote e fatura; e as 3 parcelas da geladeira (1 lida, 2 projetadas).
  await tx({ competence: '2026-09', amountCents: -100_000, kind: 'expense', creditCardId: card.id, statementId: statement.id, importBatchId: batch.id, categoryId: leaf.id, memberId, rawDescription: 'LOJA', dedupeHash: 'hash-loja', note: 'com nota; e "aspas"' });
  for (let n = 1; n <= 3; n += 1) {
    await tx({ competence: `2026-${String(8 + n).padStart(2, '0')}`, amountCents: -100_000, kind: 'expense', creditCardId: card.id, installmentPlanId: plan.id, installmentNumber: n, status: n === 1 ? 'posted' : 'planned', categoryId: leaf.id, dedupeHash: `hash-parcela-${String(n)}` });
  }
  // Pagamento da fatura (paid_transaction_id aponta para ele).
  const payment = await tx({ competence: '2026-10', amountCents: -100_000, kind: 'credit_card_payment', accountId: account.id });
  await db.update(schema.statements).set({ paidTransactionId: payment.id }).where(eq(schema.statements.id, statement.id));
  // Previsão cumprida (reconciled) e o posted que a cumpriu; uma previsão em aberto; a receita.
  const real = await tx({ competence: '2026-09', amountCents: -18_500, kind: 'expense', accountId: account.id, categoryId: leaf.id, rawDescription: 'ENEL' });
  await tx({ competence: '2026-09', amountCents: -18_000, kind: 'expense', accountId: account.id, categoryId: leaf.id, recurringExpenseId: expense.id, status: 'reconciled', reconciledByTransactionId: real.id });
  await tx({ competence: '2026-11', amountCents: -18_000, kind: 'expense', accountId: account.id, categoryId: leaf.id, recurringExpenseId: expense.id, status: 'planned' });
  await tx({ competence: '2026-09', amountCents: 740_000, kind: 'income', accountId: account.id, incomeId: income.id, memberId });
}

/** Troca, em qualquer profundidade, cada string que é id do backup pelo id gravado. */
function translate(value: unknown, idMap: Map<string, string>): unknown {
  if (typeof value === 'string') return idMap.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => translate(item, idMap));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, translate(item, idMap)]));
  }
  return value;
}

/**
 * Listas do painel em ordem canônica: algumas saem do SQL sem `ORDER BY` (são insumo de
 * soma, a ordem não muda número nenhum).
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

const byId = (rows: Record<string, unknown>[]) => [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));

describe.skipIf(process.env.DATABASE_URL === undefined)('backup e restauração (banco real)', () => {
  it('ida e volta: todas as tabelas, ids remapeados (inclusive reconciled e pagamento de fatura), painel igual', async () => {
    const m = await modules();
    const source = await newHousehold(m, 'T-402 backup test (origem)');
    const target = await newHousehold(m, 'T-402 backup test (destino)');
    try {
      await seedEverything(m, source.householdId, source.memberId);
      // O destino tem o que um household recém-criado traz: categoria e regra do seed.
      const [seedRoot] = await m.db.insert(m.schema.categories).values({ householdId: target.householdId, name: 'Semente', parentId: null, nature: 'essential' }).returning({ id: m.schema.categories.id });
      await m.db.insert(m.schema.categorizationRules).values({ householdId: target.householdId, pattern: 'SEED', categoryId: seedRoot?.id ?? '' });

      const first = await m.backup.exportHousehold(source.householdId, EXPORTED_AT);
      for (const key of m.backup.BACKUP_TABLES) expect(first.tables[key]?.length, `tabela ${key} vazia na fixture`).toBeGreaterThan(0);
      // Dinheiro como número inteiro; timestamp ISO; nada de household_id.
      expect(first.tables.transactions?.[0]?.amountCents).toEqual(expect.any(Number));
      expect(String(first.tables.transactions?.[0]?.createdAt)).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
      expect(Object.keys(first.tables.accounts?.[0] ?? {})).not.toContain('householdId');

      // Dry-run: resumo, aviso do membro sem par e das categorias substituídas; destino vazio.
      const dry = await m.backup.dryRunRestore(target.householdId, JSON.parse(JSON.stringify(first)), target.memberId);
      expect(dry.tables).toEqual(m.backup.backupCounts(first));
      expect(dry.targetHasData).toEqual([]);
      expect(dry.warnings.join(' ')).toContain(source.email);
      expect(dry.warnings.join(' ')).toContain('serão substituídas');

      const restored = await m.backup.restoreHousehold(target.householdId, JSON.parse(JSON.stringify(first)), target.memberId);
      expect(restored.tables).toEqual(m.backup.backupCounts(first));
      // Ids novos: nenhum id da origem foi reaproveitado.
      for (const [from, to] of restored.idMap) if (from !== source.memberId) expect(to).not.toBe(from);

      const second = await m.backup.exportHousehold(target.householdId, EXPORTED_AT);
      const translated = translate(first, restored.idMap) as typeof first;
      for (const key of m.backup.BACKUP_TABLES) {
        expect(byId(second.tables[key] ?? []), `tabela ${key}`).toEqual(byId(translated.tables[key] ?? []));
      }
      expect(second.settings).toEqual(first.settings);
      // O seed do destino foi substituído: só as categorias do backup.
      expect((second.tables.categories ?? []).map((row) => row.name).sort()).toEqual(['Luz', 'Moradia']);
      // O que era do membro de origem passou para o membro do destino.
      expect(restored.idMap.get(source.memberId)).toBe(target.memberId);

      const [dashA, dashB] = await Promise.all([
        m.dashboard.getDashboardData(source.householdId, TODAY, 12),
        m.dashboard.getDashboardData(target.householdId, TODAY, 12),
      ]);
      expect(canonical(dashB)).toEqual(canonical(translate(dashA, restored.idMap)));

      // Destino agora tem dado: restaurar de novo é recusado (409), nada muda.
      const again = await m.backup.restoreHousehold(target.householdId, JSON.parse(JSON.stringify(first)), target.memberId).catch((error: unknown) => error);
      expect(again).toBeInstanceOf(m.backup.BackupTargetNotEmptyError);
      expect(m.domainFailure(again)?.status).toBe(409);
      const third = await m.backup.exportHousehold(target.householdId, EXPORTED_AT);
      expect(m.backup.backupCounts(third)).toEqual(m.backup.backupCounts(second));
    } finally {
      await cleanup(m, source.householdId);
      await cleanup(m, target.householdId);
    }
  }, 60_000);

  it('arquivo inválido é recusado inteiro, com o problema dito, e nada é gravado', async () => {
    const m = await modules();
    const source = await newHousehold(m, 'T-402 backup test (origem)');
    const target = await newHousehold(m, 'T-402 backup test (destino)');
    try {
      await seedEverything(m, source.householdId, source.memberId);
      const good = await m.backup.exportHousehold(source.householdId, EXPORTED_AT);
      const clone = () => JSON.parse(JSON.stringify(good)) as typeof good;
      const problemsOf = async (file: unknown) => {
        const error = await m.backup.restoreHousehold(target.householdId, file, target.memberId).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(m.backup.BackupInvalidError);
        expect(m.domainFailure(error)?.status).toBe(400);
        return (error as InstanceType<typeof m.backup.BackupInvalidError>).problems.join(' | ');
      };

      expect(await problemsOf({ format: 'outro' })).toContain('format');
      // Coluna NOT NULL sem default ausente (backup de antes de ela existir): recusado, dizendo qual.
      const missingRequired = clone();
      delete (missingRequired.tables.transactions?.[0] as Record<string, unknown>).amountCents;
      expect(await problemsOf(missingRequired)).toContain(
        'transactions[0]: falta a coluna obrigatória amountCents (o schema atual não tem valor padrão aceitável para ela)',
      );
      // Enum com default também é exigido: `status` ausente não pode virar 'posted' em silêncio.
      const missingStatus = clone();
      delete (missingStatus.tables.transactions?.[0] as Record<string, unknown>).status;
      expect(await problemsOf(missingStatus)).toContain('transactions[0]: falta a coluna obrigatória status');
      const dangling = clone();
      (dangling.tables.transactions?.[0] as Record<string, unknown>).categoryId = randomUUID();
      expect(await problemsOf(dangling)).toContain('categoryId aponta para categories que não está no backup');
      const badType = clone();
      (badType.tables.transactions?.[0] as Record<string, unknown>).amountCents = '12,34';
      expect(await problemsOf(badType)).toContain('transactions[0].amountCents');
      const twinMembers = clone();
      const firstMember = twinMembers.members[0];
      if (firstMember === undefined) throw new Error('Sem membro no backup.');
      twinMembers.members.push({ ...firstMember, id: randomUUID(), email: firstMember.email.toUpperCase() });
      expect(await problemsOf(twinMembers)).toContain('members: e-mail repetido');
      const extraColumn = clone();
      (extraColumn.tables.accounts?.[0] as Record<string, unknown>).senha = 'x';
      expect(await problemsOf(extraColumn)).toContain('accounts[0]');

      // Passa na validação mas fere um CHECK do banco (conta E cartão): a transação desfaz tudo.
      const breaksCheck = clone();
      const row = (breaksCheck.tables.transactions ?? []).find((item) => item.creditCardId !== null) as Record<string, unknown>;
      row.accountId = breaksCheck.tables.accounts?.[0]?.id;
      await expect(m.backup.restoreHousehold(target.householdId, breaksCheck, target.memberId)).rejects.toThrow();
      expect(await m.backup.nonEmptyDataTables(target.householdId)).toEqual([]);
      const categoriesLeft = await m.db.select({ id: m.schema.categories.id }).from(m.schema.categories).where(eq(m.schema.categories.householdId, target.householdId));
      expect(categoriesLeft).toEqual([]);

      // Household com dado: 409 já no restore, e o dry-run diz quais tabelas.
      expect((await m.backup.dryRunRestore(source.householdId, clone(), source.memberId)).targetHasData).toContain('transactions');
    } finally {
      await cleanup(m, source.householdId);
      await cleanup(m, target.householdId);
    }
  }, 60_000);

  it('compatibilidade de forma: outra migration é aviso; coluna nullable ou com default ausente restaura', async () => {
    const m = await modules();
    const source = await newHousehold(m, 'T-402 backup test (origem)');
    const target = await newHousehold(m, 'T-402 backup test (destino)');
    try {
      await seedEverything(m, source.householdId, source.memberId);
      const file = JSON.parse(JSON.stringify(await m.backup.exportHousehold(source.householdId, EXPORTED_AT))) as Awaited<
        ReturnType<typeof m.backup.exportHousehold>
      >;
      // Simula um backup de antes de `transactions.note` (nullable) e `accounts.active`
      // (NOT NULL com default) existirem, gerado noutra migration.
      file.schemaMigration = { tag: '0003_antiga', createdAt: 1 };
      for (const row of file.tables.transactions ?? []) delete row.note;
      for (const row of file.tables.accounts ?? []) delete row.active;

      const dry = await m.backup.dryRunRestore(target.householdId, file, target.memberId);
      expect(dry.warnings[0]).toMatch(/^O backup foi gerado na versão 0003_antiga; o app está na \S+\./);
      expect(m.backup.migrationWarning(file, file.schemaMigration)).toBeNull();

      const restored = await m.backup.restoreHousehold(target.householdId, file, target.memberId);
      expect(restored.warnings[0]).toContain('0003_antiga');
      const accountsRows = await m.db.select({ active: m.schema.accounts.active }).from(m.schema.accounts).where(eq(m.schema.accounts.householdId, target.householdId));
      expect(accountsRows.map((row) => row.active)).toEqual([true]);
      const notes = await m.db.select({ note: m.schema.transactions.note }).from(m.schema.transactions).where(eq(m.schema.transactions.householdId, target.householdId));
      expect(notes.length).toBe(file.tables.transactions?.length);
      expect(notes.every((row) => row.note === null)).toBe(true);
    } finally {
      await cleanup(m, source.householdId);
      await cleanup(m, target.householdId);
    }
  }, 60_000);
});

describe('backup sem banco', () => {
  it('toda tabela com household_id do schema está no backup ou é excluída de propósito', async () => {
    const [schema, { BACKUP_TABLE_NAMES }, { getTableName, getTableColumns, is }, { PgTable }] = await Promise.all([
      import('@/lib/db/schema'),
      import('./backup'),
      import('drizzle-orm'),
      import('drizzle-orm/pg-core'),
    ]);
    // Fora do array de tabelas, por desenho: o household em si, os membros (casados por
    // e-mail), as premissas (campo `settings`) e o segredo de login do Auth.js.
    const handledApart = ['households', 'members', 'household_settings', 'verification_token'];
    const all = Object.values(schema).filter((value) => is(value, PgTable)).map((table) => getTableName(table as never));
    expect([...BACKUP_TABLE_NAMES, ...handledApart].sort()).toEqual([...all].sort());
    expect(Object.keys(getTableColumns(schema.verificationTokens))).toContain('token');
  });

  it('CSV dos lançamentos: ; como separador, vírgula decimal, aspas quando preciso, BOM', async () => {
    const { transactionsCsv } = await import('./backup');
    const csv = transactionsCsv({
      format: 'appfin-backup',
      version: 1,
      exportedAt: EXPORTED_AT,
      schemaMigration: { tag: null, createdAt: 0 },
      household: { name: 'x' },
      members: [{ id: 'm1', name: 'Ana', email: 'a@x', color: '#000' }],
      settings: null,
      tables: {
        categories: [{ id: 'c1', name: 'Luz' }],
        accounts: [{ id: 'a1', name: 'Corrente' }],
        credit_cards: [],
        transactions: [
          { id: 't1', occurredOn: '2026-09-05', competence: '2026-09', cashDate: null, description: 'Conta; de "luz"', amountCents: -18_005, kind: 'expense', status: 'posted', categoryId: 'c1', accountId: 'a1', creditCardId: null, memberId: 'm1', installmentNumber: null, note: null },
          { id: 't2', occurredOn: '2026-09-06', competence: '2026-09', cashDate: null, description: '=HYPERLINK("x")', amountCents: 500, kind: 'income', status: 'posted', categoryId: null, accountId: 'a1', creditCardId: null, memberId: null, installmentNumber: null, note: '@nota' },
        ],
      },
    });
    expect(csv.startsWith('﻿data;competencia;')).toBe(true);
    expect(csv).toContain('2026-09-05;2026-09;;"Conta; de ""luz""";-180,05;expense;posted;Luz;Corrente;;Ana;;\r\n');
    // Injeção de fórmula: texto que começa com = ou @ ganha apóstrofo; o valor negativo não.
    expect(csv).toContain(`2026-09-06;2026-09;;"'=HYPERLINK(""x"")";5,00;income;posted;;Corrente;;;;'@nota\r\n`);
  });
});
