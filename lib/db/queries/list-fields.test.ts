import { eq } from 'drizzle-orm';
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
 * Campos que as telas pedem a mais: banco e competencia de cada lote no
 * historico de importacoes, e o total de parcelas do plano na lista de
 * Lancamentos ("Parcela 03/10").
 *
 * Banco unico: household PROPRIO, apagado no `finally` (cascade).
 */

async function modules() {
  const [{ db }, schema, imports, history, txs] = await Promise.all([
    import('@/lib/db'),
    import('@/lib/db/schema'),
    import('./import'),
    import('./import-history'),
    import('./transactions'),
  ]);
  return { db, schema, imports, history, txs };
}
type Modules = Awaited<ReturnType<typeof modules>>;

async function seed(m: Modules) {
  const [household] = await m.db
    .insert(m.schema.households)
    .values({ name: 'Campos das listas test' })
    .returning({ id: m.schema.households.id });
  if (household === undefined) throw new Error('Household de teste não foi criado.');
  const [card] = await m.db
    .insert(m.schema.creditCards)
    .values({ householdId: household.id, name: 'Cartão listas', closingDay: 10, dueDay: 20 })
    .returning({ id: m.schema.creditCards.id });
  const [account] = await m.db
    .insert(m.schema.accounts)
    .values({ householdId: household.id, name: 'Conta listas', kind: 'checking', openingDate: '2026-01-01' })
    .returning({ id: m.schema.accounts.id });
  if (card === undefined || account === undefined) throw new Error('Fixture não foi criada.');
  return { householdId: household.id, cardId: card.id, accountId: account.id };
}

const row = (description: string, installment: { current: number; total: number } | null) => ({
  index: 0,
  include: true,
  occurredOn: '2026-08-05',
  description,
  rawDescription: installment === null ? description.toUpperCase() : `${description.toUpperCase()} PARC ${String(installment.current)}/${String(installment.total)}`,
  amountCents: cents(-10_000),
  categoryId: null,
  memberId: null,
  installment,
});

describe.skipIf(!process.env.DATABASE_URL)('campos das listas (integração)', () => {
  it('listImportBatches devolve bankKey e a competência da fatura do lote; lote de conta tem competência null', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      await m.imports.commitImport(s.householdId, {
        fileName: 'nubank.pdf',
        fileHash: 'a'.repeat(64),
        bankKey: 'nubank_card',
        format: 'pdf',
        sourceKind: 'credit_card',
        sourceId: s.cardId,
        confirmedRows: [row('Mercado', null)],
        reportedTotalCents: null,
        allowReimport: false,
        statementCompetence: '2026-09',
      });
      await m.imports.commitImport(s.householdId, {
        fileName: 'extrato.txt',
        fileHash: 'b'.repeat(64),
        bankKey: null,
        format: 'text',
        sourceKind: 'account',
        sourceId: s.accountId,
        confirmedRows: [row('Padaria', null)],
        reportedTotalCents: null,
        allowReimport: false,
        statementCompetence: null,
      });

      const batches = await m.history.listImportBatches(s.householdId);
      const byFile = Object.fromEntries(batches.map((b) => [b.fileName, { bankKey: b.bankKey, competence: b.competence }]));
      expect(byFile).toEqual({
        'nubank.pdf': { bankKey: 'nubank_card', competence: '2026-09' },
        'extrato.txt': { bankKey: null, competence: null },
      });
    } finally {
      await m.db.delete(m.schema.households).where(eq(m.schema.households.id, s.householdId));
    }
  });

  it('listTransactions devolve installmentsCount do plano junto do número; avulsa tem os dois null', async () => {
    const m = await modules();
    const s = await seed(m);
    try {
      await m.imports.commitImport(s.householdId, {
        fileName: 'fatura.txt',
        fileHash: 'c'.repeat(64),
        bankKey: null,
        format: 'text',
        sourceKind: 'credit_card',
        sourceId: s.cardId,
        confirmedRows: [row('Geladeira', { current: 3, total: 10 }), { ...row('Mercado', null), index: 1 }],
        reportedTotalCents: null,
        allowReimport: false,
        statementCompetence: '2026-09',
      });

      const list = await m.txs.listTransactions(s.householdId);
      const pairs = list
        .map((t) => [t.installmentNumber, t.installmentsCount])
        .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
      // Avulsa (null/null), a 3/10 real e as 4..10 projetadas, todas com total 10.
      expect(pairs).toEqual([[null, null], ...[3, 4, 5, 6, 7, 8, 9, 10].map((n) => [n, 10])]);
    } finally {
      await m.db.delete(m.schema.households).where(eq(m.schema.households.id, s.householdId));
    }
  });
});
