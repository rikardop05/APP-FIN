import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { cents } from '@/lib/money';

if (process.env.DATABASE_URL === undefined) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Sem banco local, o teste fica pulado.
  }
}

/**
 * F3 da categorizacao automatica: a importacao grava QUAL regra deu a
 * categoria (`category_rule_id`) e soma o uso dela (`hits`) na mesma transacao
 * do lote. Integracao de proposito: o que se prova e o rollback do Postgres.
 */
async function createFixture(label: string) {
  const [{ db }, schema] = await Promise.all([import('@/lib/db'), import('@/lib/db/schema')]);
  const [household] = await db
    .insert(schema.households)
    .values({ name: `F3 importacao ${label}` })
    .returning({ id: schema.households.id });
  if (household === undefined) throw new Error('Household de teste nao foi criado.');
  const householdId = household.id;

  const [card] = await db
    .insert(schema.creditCards)
    .values({
      householdId,
      name: `F3 ${label} cartao`,
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
  const [mercado, casa] = await db
    .insert(schema.categories)
    .values([
      { householdId, name: 'Mercado', nature: 'essential' },
      { householdId, name: 'Casa', nature: 'non_essential' },
    ])
    .returning({ id: schema.categories.id });
  if (card === undefined || mercado === undefined || casa === undefined) {
    throw new Error('Fixture incompleta.');
  }
  const [rule] = await db
    .insert(schema.categorizationRules)
    .values({ householdId, pattern: 'irmaos boa', matchType: 'contains', categoryId: mercado.id, priority: 1, hits: 5 })
    .returning({ id: schema.categorizationRules.id });
  if (rule === undefined) throw new Error('Regra de teste nao foi criada.');

  return {
    db,
    schema,
    householdId,
    cardId: card.id,
    mercadoId: mercado.id,
    casaId: casa.id,
    ruleId: rule.id,
    hits: async () => {
      const [row] = await db
        .select({ hits: schema.categorizationRules.hits })
        .from(schema.categorizationRules)
        .where(eq(schema.categorizationRules.id, rule.id));
      return row?.hits;
    },
    transactions: () =>
      db
        .select({
          description: schema.transactions.description,
          status: schema.transactions.status,
          categoryId: schema.transactions.categoryId,
          categoryRuleId: schema.transactions.categoryRuleId,
        })
        .from(schema.transactions)
        .where(eq(schema.transactions.householdId, householdId))
        .orderBy(schema.transactions.occurredOn, schema.transactions.competence),
    cleanup: () => db.delete(schema.households).where(eq(schema.households.id, householdId)),
  };
}

type Row = {
  index: number;
  description: string;
  amountCents: ReturnType<typeof cents>;
  categoryId: string | null;
  installment?: { current: number; total: number } | null;
};

function input(cardId: string, fileHash: string, rows: Row[]) {
  return {
    fileName: 'f3.txt',
    fileHash,
    bankKey: null,
    format: 'text' as const,
    sourceKind: 'credit_card' as const,
    sourceId: cardId,
    confirmedRows: rows.map((row) => ({
      index: row.index,
      include: true,
      occurredOn: `2026-09-0${row.index + 1}`,
      description: row.description,
      rawDescription: row.description,
      amountCents: row.amountCents,
      categoryId: row.categoryId,
      memberId: null,
      installment: row.installment ?? null,
    })),
    reportedTotalCents: null,
    allowReimport: false,
    statementCompetence: '2026-09' as const,
  };
}

describe.skipIf(process.env.DATABASE_URL === undefined)('importacao grava a regra e os hits (F3)', () => {
  it('categoria aceita da regra leva category_rule_id; trocada a mao ou vazia nao leva', async () => {
    const f = await createFixture('atribuicao');
    try {
      const { commitImport } = await import('./import');
      await commitImport(
        f.householdId,
        input(f.cardId, 'f'.repeat(63) + '1', [
          // Aceitou a sugestao da regra.
          { index: 0, description: '[final 4239] IRMAOS BOA', amountCents: cents(-1000), categoryId: f.mercadoId },
          // A regra sugeria Mercado; o usuario trocou para Casa: categoria a mao.
          { index: 1, description: 'IRMAOS BOA', amountCents: cents(-2000), categoryId: f.casaId },
          // Regra casava, mas o usuario deixou sem categoria.
          { index: 2, description: 'IRMAOS BOA', amountCents: cents(-3000), categoryId: null },
          // Nenhuma regra casa: categoria a mao.
          { index: 3, description: 'OUTRA LOJA', amountCents: cents(-4000), categoryId: f.mercadoId },
        ]),
      );

      const rows = await f.transactions();
      expect(rows.map((row) => [row.description, row.categoryRuleId])).toEqual([
        ['[final 4239] IRMAOS BOA', f.ruleId],
        ['IRMAOS BOA', null],
        ['IRMAOS BOA', null],
        ['OUTRA LOJA', null],
      ]);
      // hits era 5; uma linha categorizada pela regra: 5 + 1 = 6.
      expect(await f.hits()).toBe(6);
    } finally {
      await f.cleanup();
    }
  });

  it('parcelamento: real e projetadas levam a regra, mas hits conta so a linha real', async () => {
    const f = await createFixture('parcela');
    try {
      const { commitImport } = await import('./import');
      await commitImport(
        f.householdId,
        input(f.cardId, 'f'.repeat(63) + '2', [
          {
            index: 0,
            description: 'IRMAOS BOA',
            amountCents: cents(-1000),
            categoryId: f.mercadoId,
            installment: { current: 1, total: 3 },
          },
        ]),
      );

      const rows = await f.transactions();
      // Parcela 1/3 real + 2/3 e 3/3 projetadas (planned).
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.categoryRuleId === f.ruleId)).toBe(true);
      // Projetada nao e uso da regra: so a 1/3 conta. 5 + 1 = 6.
      expect(await f.hits()).toBe(6);
    } finally {
      await f.cleanup();
    }
  });

  it('falha no meio do lote desfaz tambem o incremento de hits', async () => {
    const f = await createFixture('rollback');
    try {
      const { commitImport } = await import('./import');
      await expect(
        commitImport(
          f.householdId,
          input(f.cardId, 'f'.repeat(63) + '3', [
            { index: 0, description: 'IRMAOS BOA', amountCents: cents(-1000), categoryId: f.mercadoId },
          ]),
          { failAfter: 'transactions' },
        ),
      ).rejects.toThrow('Falha de teste após os lançamentos.');
      expect(await f.transactions()).toHaveLength(0);
      expect(await f.hits()).toBe(5);
    } finally {
      await f.cleanup();
    }
  });

  it('regra de outro household nao e usada', async () => {
    const f = await createFixture('isolamento');
    const outro = await createFixture('isolamento-outro');
    try {
      const { commitImport } = await import('./import');
      // A categoria e do household `f`; a regra de `outro` casaria o texto.
      await f.db.delete(f.schema.categorizationRules).where(eq(f.schema.categorizationRules.id, f.ruleId));
      await commitImport(
        f.householdId,
        input(f.cardId, 'f'.repeat(63) + '4', [
          { index: 0, description: 'IRMAOS BOA', amountCents: cents(-1000), categoryId: f.mercadoId },
        ]),
      );
      const [row] = await f.transactions();
      expect(row?.categoryRuleId).toBeNull();
      expect(await outro.hits()).toBe(5);
    } finally {
      await f.cleanup();
      await outro.cleanup();
    }
  });
});

describe.skipIf(process.env.DATABASE_URL === undefined)('importacao: rastro da regra respeita natureza x sinal', () => {
  it('regra de categoria de receita e pulada numa despesa; a proxima compativel leva o rastro', async () => {
    const f = await createFixture('natureza');
    try {
      const [salario] = await f.db
        .insert(f.schema.categories)
        .values({ householdId: f.householdId, name: 'Salario', nature: 'income' })
        .returning({ id: f.schema.categories.id });
      if (salario === undefined) throw new Error('Categoria de receita nao foi criada.');
      // Prioridade 0 vence a regra da fixture (1), mas a categoria e de receita.
      const [regraReceita] = await f.db
        .insert(f.schema.categorizationRules)
        .values({ householdId: f.householdId, pattern: 'irmaos boa', matchType: 'contains', categoryId: salario.id, priority: 0, hits: 0 })
        .returning({ id: f.schema.categorizationRules.id });
      if (regraReceita === undefined) throw new Error('Regra de receita nao foi criada.');

      const { commitImport } = await import('./import');
      await commitImport(
        f.householdId,
        input(f.cardId, 'f'.repeat(63) + '5', [
          // Despesa aceita em Mercado: a regra de receita nao cabe, a de Mercado leva.
          { index: 0, description: 'IRMAOS BOA', amountCents: cents(-1000), categoryId: f.mercadoId },
          // Entrada aceita em Salario: a regra de receita cabe e vence pela prioridade.
          { index: 1, description: 'IRMAOS BOA', amountCents: cents(2000), categoryId: salario.id },
        ]),
      );

      const rows = await f.transactions();
      expect(rows.map((row) => row.categoryRuleId)).toEqual([f.ruleId, regraReceita.id]);
      expect(await f.hits()).toBe(6);
    } finally {
      await f.cleanup();
    }
  });
});
