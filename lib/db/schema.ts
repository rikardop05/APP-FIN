import { sql } from 'drizzle-orm';
import {
  boolean,
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import {
  accountKind,
  cardBrand,
  categoryNature,
  frequency,
  goalStatus,
  importFormat,
  importStatus,
  incomeKind,
  matchType,
  recordSource,
  scenarioLabel,
  statementStatus,
  transactionKind,
  transactionStatus,
} from './enums.ts';

/**
 * Schema canonico, traduzido de docs/DATA-MODEL.md.
 *
 * DATA-MODEL e a fonte de verdade: divergencia entre ele e este arquivo e bug
 * deste arquivo (CONVENTIONS, cabecalho do DATA-MODEL).
 *
 * Regras que valem para todas as tabelas (DATA-MODEL, preambulo da §2):
 * - `id uuid primary key default gen_random_uuid()`;
 * - toda tabela, exceto as filhas de `households`, tem
 *   `household_id uuid not null references households(id) on delete cascade`.
 *
 * Dinheiro e `bigint` de centavos com sufixo `_cents` (CONVENTIONS §2) e e
 * lido como `number` (`mode: 'number'`): o tipo `Cents` do CONTRACTS §1 e
 * inteiro, e safe integer cobre R$ 90 trilhoes.
 * Percentual e `integer` em basis points com sufixo `_bp` (CONVENTIONS §3).
 * Data de fato financeiro e `date` sem hora, lida como string `YYYY-MM-DD`
 * (CONVENTIONS §4). Timestamp de sistema e `timestamptz` em UTC.
 */

/** `id uuid primary key default gen_random_uuid()` — repetido em toda tabela. */
const id = () => uuid('id').primaryKey().defaultRandom();

/** `created_at timestamptz not null default now()`. */
const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** Dinheiro em centavos: `bigint` lido como inteiro. */
const cents = (name: string) => bigint(name, { mode: 'number' });

// ---------------------------------------------------------------------------
// households
// ---------------------------------------------------------------------------

export const households = pgTable('households', {
  id: id(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// members
// ---------------------------------------------------------------------------

export const members = pgTable('members', {
  id: id(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Usado na allowlist de login (DATA-MODEL §2, members). */
  email: text('email').notNull().unique(),
  /** Hex, usado em graficos. */
  color: text('color').notNull(),
});

// ---------------------------------------------------------------------------
// accounts
// ---------------------------------------------------------------------------

export const accounts = pgTable('accounts', {
  id: id(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  bank: text('bank'),
  kind: accountKind('kind').notNull(),
  /** Saldo no dia `opening_date`. */
  openingBalanceCents: cents('opening_balance_cents').notNull().default(0),
  /** Marco zero do saldo desta conta. */
  openingDate: date('opening_date').notNull(),
  active: boolean('active').notNull().default(true),
});

// ---------------------------------------------------------------------------
// credit_cards
// ---------------------------------------------------------------------------

/**
 * `closing_day`/`due_day` maiores que o ultimo dia do mes sao ajustados para o
 * ultimo dia — a regra vive em `/lib/finance/billing`, nao no banco
 * (DATA-MODEL §2, nota de credit_cards).
 */
export const creditCards = pgTable('credit_cards', {
  id: id(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  bank: text('bank'),
  brand: cardBrand('brand').notNull().default('other'),
  holderMemberId: uuid('holder_member_id').references(() => members.id),
  /** Conta de onde sai o pagamento. */
  paymentAccountId: uuid('payment_account_id').references(() => accounts.id),
  creditLimitCents: cents('credit_limit_cents'),
  /** 1–31, dia de fechamento. */
  closingDay: smallint('closing_day').notNull(),
  /** 1–31, dia de vencimento. */
  dueDay: smallint('due_day').notNull(),
  active: boolean('active').notNull().default(true),
});

// ---------------------------------------------------------------------------
// statements
// ---------------------------------------------------------------------------

/**
 * `computed_total_cents` **nao e coluna**: e sempre a soma das transacoes com
 * este `statement_id`. Divergencia com `reported_total_cents` gera alerta de
 * conciliacao (DATA-MODEL §2, nota de statements).
 *
 * `paid_transaction_id` fecha um ciclo com `transactions.statement_id`:
 * statements aponta para transactions e transactions aponta de volta. As duas
 * pontas usam `(): AnyPgColumn => ...`, que e o que quebra tanto a ordem de
 * carga do modulo (o callback roda depois) quanto o ciclo de inferencia do
 * TypeScript — sem a anotacao, `tsc` acusa TS7022 nas duas tabelas.
 */
export const statements = pgTable(
  'statements',
  {
    id: id(),
    creditCardId: uuid('credit_card_id')
      .notNull()
      .references(() => creditCards.id, { onDelete: 'cascade' }),
    /** Competencia `YYYY-MM`. */
    period: text('period').notNull(),
    closingDate: date('closing_date').notNull(),
    dueDate: date('due_date').notNull(),
    /** Total informado no arquivo; null se manual. */
    reportedTotalCents: cents('reported_total_cents'),
    status: statementStatus('status').notNull().default('open'),
    source: recordSource('source').notNull(),
    /** Lancamento do pagamento. */
    paidTransactionId: uuid('paid_transaction_id').references(
      (): AnyPgColumn => transactions.id,
    ),
  },
  (t) => [
    uniqueIndex('statements_credit_card_id_period_unique').on(
      t.creditCardId,
      t.period,
    ),
  ],
);

// ---------------------------------------------------------------------------
// categories
// ---------------------------------------------------------------------------

/**
 * `nature` pertence a **categoria onde o lancamento cai**; a raiz e
 * agrupamento e pode ter filhas de naturezas diferentes — "Alimentacao" tem
 * "Mercado" (essential) e "Restaurantes" (non_essential) sob a mesma raiz.
 * Relatorio e KPI somam pela `nature` da categoria do proprio lancamento, nunca
 * pela da raiz (DATA-MODEL §2, categories; regra resolvida em 2026-09-10).
 *
 * `parent_id` aceita **no maximo 1 nivel**. Isso depende de outra linha, entao
 * **nao** e CHECK (exigiria subconsulta): vale na borda, com Zod na rota e
 * validacao na UI recusando `parent_id` que aponte para categoria que ja tem
 * `parent_id`.
 */
export const categories = pgTable(
  'categories',
  {
    id: id(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id),
    nature: categoryNature('nature').notNull(),
    icon: text('icon'),
    color: text('color'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    // Impede filhas homonimas sob a mesma raiz.
    uniqueIndex('categories_household_id_parent_id_name_unique').on(
      t.householdId,
      t.parentId,
      t.name,
    ),
    /**
     * Impede **raiz homonima**. Necessario porque NULL nao colide com NULL em
     * Postgres, entao o unique acima nao cobre raizes. Indice parcial em vez de
     * NULLS NOT DISTINCT para nao depender de versao do servidor.
     */
    uniqueIndex('categories_household_id_name_root_unique')
      .on(t.householdId, t.name)
      .where(sql`${t.parentId} is null`),
  ],
);

// ---------------------------------------------------------------------------
// installment_plans
// ---------------------------------------------------------------------------

/**
 * `installment_cents` **nao e coluna**: as parcelas sao as transacoes filhas,
 * geradas por `allocate()` para somar exatamente `total_cents` (DATA-MODEL §2,
 * nota de installment_plans).
 */
export const installmentPlans = pgTable('installment_plans', {
  id: id(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  creditCardId: uuid('credit_card_id')
    .notNull()
    .references(() => creditCards.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  /** Negativo: e despesa. */
  totalCents: cents('total_cents').notNull(),
  installmentsCount: smallint('installments_count').notNull(),
  /** `YYYY-MM`. */
  firstCompetence: text('first_competence').notNull(),
  categoryId: uuid('category_id').references(() => categories.id),
  /** `import` = detectado na fatura. */
  source: recordSource('source').notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// recurring_expenses
// ---------------------------------------------------------------------------

export const recurringExpenses = pgTable('recurring_expenses', {
  id: id(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  /** Negativo. */
  expectedCents: cents('expected_cents').notNull(),
  categoryId: uuid('category_id')
    .notNull()
    .references(() => categories.id),
  dueDay: smallint('due_day').notNull(),
  frequency: frequency('frequency').notNull().default('monthly'),
  /** Onde debita. */
  accountId: uuid('account_id').references(() => accounts.id),
  creditCardId: uuid('credit_card_id').references(() => creditCards.id),
  startsOn: date('starts_on').notNull(),
  /** Null = sem fim. */
  endsOn: date('ends_on'),
  /** Reajuste anual, aplicado no aniversario de `starts_on`. */
  annualAdjustmentBp: integer('annual_adjustment_bp'),
  active: boolean('active').notNull().default(true),
});

// ---------------------------------------------------------------------------
// incomes
// ---------------------------------------------------------------------------

export const incomes = pgTable(
  'incomes',
  {
    id: id(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    description: text('description').notNull(),
    kind: incomeKind('kind').notNull(),
    /** Positivo. */
    expectedCents: cents('expected_cents').notNull(),
    receiveDay: smallint('receive_day').notNull(),
    /** `one_off` cobre 13o, PLR, bonus. */
    frequency: frequency('frequency').notNull().default('monthly'),
    /** Obrigatorio quando `frequency = 'one_off'`. */
    oneOffCompetence: text('one_off_competence'),
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    // Receita eventual sem competencia nao projeta em lugar nenhum e viraria
    // linha orfa (DATA-MODEL §2, incomes).
    check(
      'incomes_one_off_requires_competence',
      sql`${t.frequency} <> 'one_off' or ${t.oneOffCompetence} is not null`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// import_batches
// ---------------------------------------------------------------------------

export const importBatches = pgTable('import_batches', {
  id: id(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  /**
   * sha256 do conteudo (ou do texto colado). Verificado na entrada para avisar
   * "arquivo ja importado" — RF-IMP-10.
   */
  fileHash: text('file_hash').notNull(),
  bankKey: text('bank_key'),
  /**
   * `text` = colagem; nesse caso `file_name` recebe um rotulo dado pelo
   * usuario e `file_hash` e o sha256 do texto colado.
   */
  format: importFormat('format').notNull(),
  /** Destino do lote. */
  creditCardId: uuid('credit_card_id').references(() => creditCards.id),
  accountId: uuid('account_id').references(() => accounts.id),
  statementId: uuid('statement_id').references(() => statements.id),
  rowsRead: integer('rows_read').notNull().default(0),
  rowsImported: integer('rows_imported').notNull().default(0),
  rowsDuplicated: integer('rows_duplicated').notNull().default(0),
  status: importStatus('status').notNull().default('pending'),
  error: text('error'),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// transactions — o registro central
// ---------------------------------------------------------------------------

export const transactions = pgTable(
  'transactions',
  {
    id: id(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Data do fato (compra, recebimento). */
    occurredOn: date('occurred_on').notNull(),
    /** `YYYY-MM`; em cartao = competencia da fatura, nao o mes da compra. */
    competence: text('competence').notNull(),
    /**
     * Data prevista/efetiva de saida do caixa; em item de fatura =
     * `due_date` da fatura.
     */
    cashDate: date('cash_date'),
    /** Editavel pelo usuario. */
    description: text('description').notNull(),
    /**
     * Como veio do arquivo ou da linha colada; **nunca sobrescrever**. String
     * vazia so em lancamento manual.
     */
    rawDescription: text('raw_description').notNull(),
    /** Negativo = saida. */
    amountCents: cents('amount_cents').notNull(),
    kind: transactionKind('kind').notNull(),
    /** `planned` = previsto (parcela futura, recorrencia). */
    status: transactionStatus('status').notNull().default('posted'),
    /** Null = nao categorizado. */
    categoryId: uuid('category_id').references(() => categories.id, {
      onDelete: 'restrict',
    }),
    accountId: uuid('account_id').references(() => accounts.id),
    creditCardId: uuid('credit_card_id').references(() => creditCards.id, {
      onDelete: 'restrict',
    }),
    statementId: uuid('statement_id').references((): AnyPgColumn =>
      statements.id,
    ),
    /** Quem gastou. */
    memberId: uuid('member_id').references(() => members.id),
    installmentPlanId: uuid('installment_plan_id').references(
      () => installmentPlans.id,
      { onDelete: 'cascade' },
    ),
    /** 1-based. */
    installmentNumber: smallint('installment_number'),
    /** Origem, quando gerado. */
    recurringExpenseId: uuid('recurring_expense_id').references(
      () => recurringExpenses.id,
    ),
    /** Origem, quando gerado. */
    incomeId: uuid('income_id').references(() => incomes.id),
    importBatchId: uuid('import_batch_id').references(() => importBatches.id),
    /** Null para lancamento manual. */
    dedupeHash: text('dedupe_hash'),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // DATA-MODEL §2, transactions, "Constraints".
    check(
      'transactions_account_xor_credit_card',
      sql`(${t.accountId} is not null) <> (${t.creditCardId} is not null)`,
    ),
    check(
      'transactions_installment_number_iff_plan',
      sql`(${t.installmentNumber} is null) = (${t.installmentPlanId} is null)`,
    ),
    uniqueIndex('transactions_household_id_dedupe_hash_unique')
      .on(t.householdId, t.dedupeHash)
      .where(sql`${t.dedupeHash} is not null`),
    // DATA-MODEL §2, transactions, "Indices".
    index('transactions_household_id_occurred_on_idx').on(
      t.householdId,
      t.occurredOn.desc(),
    ),
    index('transactions_household_id_competence_idx').on(
      t.householdId,
      t.competence,
    ),
    index('transactions_statement_id_idx').on(t.statementId),
    index('transactions_household_id_category_id_idx').on(
      t.householdId,
      t.categoryId,
    ),
    index('transactions_import_batch_id_idx').on(t.importBatchId),
    index('transactions_household_id_status_cash_date_idx').on(
      t.householdId,
      t.status,
      t.cashDate,
    ),
  ],
);

// ---------------------------------------------------------------------------
// categorization_rules
// ---------------------------------------------------------------------------

export const categorizationRules = pgTable('categorization_rules', {
  id: id(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  pattern: text('pattern').notNull(),
  matchType: matchType('match_type').notNull().default('contains'),
  categoryId: uuid('category_id')
    .notNull()
    .references(() => categories.id),
  /** Sugestao de responsavel. */
  memberId: uuid('member_id').references(() => members.id),
  /** Menor = avaliado primeiro. */
  priority: integer('priority').notNull().default(100),
  hits: integer('hits').notNull().default(0),
  active: boolean('active').notNull().default(true),
});

// ---------------------------------------------------------------------------
// import_mappings
// ---------------------------------------------------------------------------

/**
 * Mapeamento de colunas salvo por banco (RF-IMP-01).
 *
 * Maquinaria de mapeamento de coluna e **Fase 4**: a tabela existe no schema,
 * mas nenhum codigo da v1 a le ou escreve (ORCHESTRATION §5).
 */
export const importMappings = pgTable(
  'import_mappings',
  {
    id: id(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Slug: `nubank_card`, `itau_checking`. */
    bankKey: text('bank_key').notNull(),
    /**
     * Apenas `csv` ou `xlsx`; `ofx`, `pdf` e `text` nao usam mapeamento de
     * coluna. Garantido pelo `check` abaixo.
     */
    format: importFormat('format').notNull(),
    /** `{date, description, amount}` ou `{date, description, debit, credit}`. */
    columnMap: jsonb('column_map').notNull(),
    /** Ex.: `dd/MM/yyyy`. */
    dateFormat: text('date_format').notNull(),
    decimalSeparator: text('decimal_separator').notNull().default(','),
    amountSignInverted: boolean('amount_sign_inverted')
      .notNull()
      .default(false),
    /** Hash do cabecalho, usado na deteccao. */
    headerSignature: text('header_signature'),
  },
  (t) => [
    uniqueIndex('import_mappings_household_id_bank_key_unique').on(
      t.householdId,
      t.bankKey,
    ),
    // Mapeamento de coluna so faz sentido para formato tabular
    // (DATA-MODEL §2, import_mappings).
    check('import_mappings_format_tabular', sql`${t.format} in ('csv', 'xlsx')`),
  ],
);

// ---------------------------------------------------------------------------
// budgets
// ---------------------------------------------------------------------------

export const budgets = pgTable(
  'budgets',
  {
    id: id(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** `YYYY-MM`. */
    period: text('period').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    plannedCents: cents('planned_cents').notNull(),
  },
  (t) => [
    uniqueIndex('budgets_household_id_period_category_id_unique').on(
      t.householdId,
      t.period,
      t.categoryId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// goals
// ---------------------------------------------------------------------------

export const goals = pgTable('goals', {
  id: id(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  targetCents: cents('target_cents').notNull(),
  targetDate: date('target_date'),
  currentCents: cents('current_cents').notNull().default(0),
  /** Se vinculada, `current_cents` vem do saldo. */
  accountId: uuid('account_id').references(() => accounts.id),
  priority: integer('priority').notNull().default(100),
  status: goalStatus('status').notNull().default('active'),
  /** Alvo calculado, nao digitado. */
  isEmergencyFund: boolean('is_emergency_fund').notNull().default(false),
});

// ---------------------------------------------------------------------------
// investment_plans
// ---------------------------------------------------------------------------

export const investmentPlans = pgTable('investment_plans', {
  id: id(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Em R$ de hoje. */
  desiredMonthlyIncomeCents: cents('desired_monthly_income_cents').notNull(),
  currentPortfolioCents: cents('current_portfolio_cents').notNull().default(0),
  currentMonthlyContributionCents: cents('current_monthly_contribution_cents')
    .notNull()
    .default(0),
  /** IPCA 4,50 % a.a. */
  inflationBp: integer('inflation_bp').notNull().default(450),
  /** 15 %. */
  incomeTaxBp: integer('income_tax_bp').notNull().default(1500),
  targetDate: date('target_date'),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// investment_scenarios
// ---------------------------------------------------------------------------

/**
 * Defaults ao criar plano (DATA-MODEL §2): conservative 300/300 ·
 * moderate 500/400 · optimistic 700/500.
 */
export const investmentScenarios = pgTable(
  'investment_scenarios',
  {
    id: id(),
    investmentPlanId: uuid('investment_plan_id')
      .notNull()
      .references(() => investmentPlans.id, { onDelete: 'cascade' }),
    label: scenarioLabel('label').notNull(),
    /** Retorno **real** a.a. na acumulacao. */
    realReturnBp: integer('real_return_bp').notNull(),
    /** Taxa **real** a.a. de retirada perpetua. */
    withdrawalBp: integer('withdrawal_bp').notNull(),
  },
  (t) => [
    uniqueIndex('investment_scenarios_investment_plan_id_label_unique').on(
      t.investmentPlanId,
      t.label,
    ),
  ],
);

// ---------------------------------------------------------------------------
// household_settings
// ---------------------------------------------------------------------------

/**
 * Unica tabela cuja PK e o proprio `household_id` (DATA-MODEL §2): nao tem
 * coluna `id`.
 */
export const householdSettings = pgTable('household_settings', {
  householdId: uuid('household_id')
    .primaryKey()
    .references(() => households.id, { onDelete: 'cascade' }),
  emergencyFundMonths: smallint('emergency_fund_months').notNull().default(6),
  /** Semaforo amarelo em 80 %. */
  budgetWarnBp: integer('budget_warn_bp').notNull().default(8000),
  projectionMonths: smallint('projection_months').notNull().default(12),
  commitmentMonths: smallint('commitment_months').notNull().default(24),
});
