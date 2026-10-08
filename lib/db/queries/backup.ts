import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { getTableColumns, getTableName } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { db } from '../index.ts';
import {
  accounts,
  budgets,
  categories,
  categorizationRules,
  creditCards,
  goals,
  householdSettings,
  households,
  importBatches,
  importMappings,
  incomes,
  installmentPlans,
  investmentPlans,
  investmentScenarios,
  investmentSnapshots,
  members,
  recurringExpenses,
  skippedOccurrences,
  statements,
  transactions,
} from '../schema.ts';

/**
 * Backup e restauração — T-402.
 *
 * ## Arquivo (version 1)
 *
 * `{ format: 'appfin-backup', version: 1, exportedAt, schemaMigration, household, members,
 *    settings, tables: { <tabela>: [linhas] } }`
 *
 * - Linhas com as chaves do Drizzle (camelCase, as mesmas de `$inferSelect`), SEM
 *   `household_id` (implícito: é o household exportado). Os `id` originais vão no arquivo
 *   para as FKs internas fecharem; a restauração gera ids novos e remapeia todas.
 * - **Dinheiro (`*_cents`) vai como número JSON inteiro.** O schema lê `bigint` em
 *   `mode: 'number'` e `Cents` é safe integer (CONVENTIONS §2): todo valor que o app
 *   consegue ler cabe exato num número JSON (até 2^53). A exportação recusa um valor fora
 *   do safe integer em vez de gravar um número arredondado.
 * - Datas `date` como `YYYY-MM-DD`; `timestamptz` como ISO 8601 em UTC; `jsonb` como está.
 * - `schemaMigration`: a última migration aplicada no banco (`drizzle.__drizzle_migrations`):
 *   `createdAt` (o `when` do journal) e o `tag` do arquivo, quando o journal está à mão.
 *   Migration diferente da do banco é só AVISO: a compatibilidade é de FORMA (o arquivo vale
 *   contra as colunas do schema atual; coluna ausente só se tiver default ou aceitar nulo,
 *   coluna desconhecida é recusada). Ver `rowSchema`.
 *
 * ## Fora do arquivo (e por quê)
 *
 * - `verification_token` (Auth.js): segredo efêmero de login. Não há tabela de sessão (a
 *   sessão é JWT) nem coluna de senha de PDF no schema.
 * - `household_id` e o id do household: o destino é o household da sessão.
 *
 * ## Restauração: nunca sobrescreve dado
 *
 * Só num household SEM DADO nas tabelas de `DATA_TABLES` (contas, cartões, lançamentos,
 * metas, plano…). O que um household recém-criado já traz do seed é tratado assim:
 * - `members` NÃO são inseridos (o e-mail é único no sistema e é a allowlist do login):
 *   cada membro do backup vira o membro do destino com o MESMO e-mail; sem par, vira o
 *   membro de quem restaura (aviso).
 * - `categories` e `categorization_rules` do destino são SUBSTITUÍDAS pelas do backup
 *   (aviso). Sem dado nenhum, nada as referencia.
 * - `household_settings` do destino recebe as premissas do backup.
 *
 * Tudo numa transação: ou entra inteiro, ou nada.
 */

export const BACKUP_FORMAT = 'appfin-backup';
export const BACKUP_VERSION = 1;

// ---------------------------------------------------------------------------
// Tabelas
// ---------------------------------------------------------------------------

type Scope = 'household' | 'card' | 'plan';

type TableSpec = {
  key: string;
  table: PgTable;
  scope: Scope;
  /** Coluna (chave Drizzle) -> tabela do backup que ela referencia. */
  fks: Record<string, string>;
};

/**
 * Ordem de INSERÇÃO (pais antes de filhos). Três FKs não cabem na ordem e são tratadas à
 * parte: `categories.parentId` (raízes antes), `statements.paidTransactionId` (gravado
 * depois dos lançamentos) e `transactions.reconciledByTransactionId` (a `reconciled` entra
 * depois do `posted` que a cumpriu).
 */
const TABLES: readonly TableSpec[] = [
  { key: 'accounts', table: accounts, scope: 'household', fks: {} },
  {
    key: 'credit_cards',
    table: creditCards,
    scope: 'household',
    fks: { holderMemberId: 'members', paymentAccountId: 'accounts' },
  },
  { key: 'categories', table: categories, scope: 'household', fks: { parentId: 'categories' } },
  {
    key: 'categorization_rules',
    table: categorizationRules,
    scope: 'household',
    fks: { categoryId: 'categories', memberId: 'members' },
  },
  { key: 'import_mappings', table: importMappings, scope: 'household', fks: {} },
  {
    key: 'installment_plans',
    table: installmentPlans,
    scope: 'household',
    fks: { creditCardId: 'credit_cards', categoryId: 'categories' },
  },
  {
    key: 'recurring_expenses',
    table: recurringExpenses,
    scope: 'household',
    fks: { categoryId: 'categories', accountId: 'accounts', creditCardId: 'credit_cards' },
  },
  { key: 'incomes', table: incomes, scope: 'household', fks: { memberId: 'members', accountId: 'accounts' } },
  { key: 'budgets', table: budgets, scope: 'household', fks: { categoryId: 'categories' } },
  { key: 'goals', table: goals, scope: 'household', fks: { accountId: 'accounts' } },
  { key: 'investment_plans', table: investmentPlans, scope: 'household', fks: {} },
  { key: 'investment_snapshots', table: investmentSnapshots, scope: 'household', fks: {} },
  {
    key: 'investment_scenarios',
    table: investmentScenarios,
    scope: 'plan',
    fks: { investmentPlanId: 'investment_plans' },
  },
  {
    key: 'statements',
    table: statements,
    scope: 'card',
    fks: { creditCardId: 'credit_cards', paidTransactionId: 'transactions' },
  },
  {
    key: 'import_batches',
    table: importBatches,
    scope: 'household',
    fks: { creditCardId: 'credit_cards', accountId: 'accounts', statementId: 'statements' },
  },
  {
    key: 'skipped_occurrences',
    table: skippedOccurrences,
    scope: 'household',
    fks: { recurringExpenseId: 'recurring_expenses', incomeId: 'incomes' },
  },
  {
    key: 'transactions',
    table: transactions,
    scope: 'household',
    fks: {
      categoryId: 'categories',
      categoryRuleId: 'categorization_rules',
      accountId: 'accounts',
      creditCardId: 'credit_cards',
      statementId: 'statements',
      memberId: 'members',
      installmentPlanId: 'installment_plans',
      recurringExpenseId: 'recurring_expenses',
      incomeId: 'incomes',
      importBatchId: 'import_batches',
      reconciledByTransactionId: 'transactions',
    },
  },
];

export const BACKUP_TABLES: readonly string[] = TABLES.map((spec) => spec.key);

/**
 * Tabelas cujo conteúdo é DADO: qualquer linha no destino recusa a restauração.
 * `statements` e `investment_scenarios` vêm junto de cartões e planos.
 */
const DATA_TABLES: readonly { key: string; table: PgTable & { householdId: PgColumn } }[] = [
  { key: 'accounts', table: accounts },
  { key: 'credit_cards', table: creditCards },
  { key: 'transactions', table: transactions },
  { key: 'installment_plans', table: installmentPlans },
  { key: 'recurring_expenses', table: recurringExpenses },
  { key: 'incomes', table: incomes },
  { key: 'import_batches', table: importBatches },
  { key: 'skipped_occurrences', table: skippedOccurrences },
  { key: 'budgets', table: budgets },
  { key: 'goals', table: goals },
  { key: 'investment_plans', table: investmentPlans },
  { key: 'investment_snapshots', table: investmentSnapshots },
  { key: 'import_mappings', table: importMappings },
];

// ---------------------------------------------------------------------------
// Validação derivada do schema: um tipo de coluna novo sem tradução quebra aqui, alto.
// ---------------------------------------------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data YYYY-MM-DD');
const isoTimestamp = z.string().datetime({ offset: true, message: 'timestamp ISO 8601' });
const safeInt = z.number().refine(Number.isSafeInteger, 'inteiro seguro');

function columnSchema(column: PgColumn): z.ZodTypeAny {
  let schema: z.ZodTypeAny;
  switch (column.columnType) {
    case 'PgUUID':
      schema = z.string().uuid();
      break;
    case 'PgText':
      schema = z.string();
      break;
    case 'PgEnumColumn':
      schema = z.enum(column.enumValues as [string, ...string[]]);
      break;
    case 'PgBigInt53':
      schema = safeInt;
      break;
    case 'PgInteger':
      schema = z.number().int().min(-2_147_483_648).max(2_147_483_647);
      break;
    case 'PgSmallInt':
      schema = z.number().int().min(-32_768).max(32_767);
      break;
    case 'PgBoolean':
      schema = z.boolean();
      break;
    case 'PgDateString':
      schema = isoDate;
      break;
    case 'PgTimestamp':
      schema = isoTimestamp;
      break;
    case 'PgJsonb':
      schema = z.custom<unknown>((value) => value !== undefined, 'json');
      break;
    default:
      throw new Error(`Backup: tipo de coluna sem tradução (${column.columnType} em ${column.name}).`);
  }
  return column.notNull ? schema : schema.nullable();
}

/** Colunas do backup de uma tabela: todas, menos `householdId`. */
function backupColumns(table: PgTable): [string, PgColumn][] {
  return Object.entries(getTableColumns(table)).filter(([key]) => key !== 'householdId');
}

/**
 * Coluna que o arquivo PRECISA trazer: `id` (as FKs internas dependem dele) e toda coluna
 * NOT NULL sem default no schema ATUAL. As outras podem faltar (backup de uma versão anterior
 * à coluna): a restauração as omite no INSERT e o banco põe o default ou NULL.
 */
function isRequired(key: string, column: PgColumn): boolean {
  if (key === 'id') return true;
  if (!column.notNull) return false;
  // Enum NOT NULL é sempre exigido, mesmo com default: o default de enum tem SENTIDO de
  // negócio (`transactions.status` 'posted', `statements.status` 'open', `frequency`
  // 'monthly'), e preenchê-lo em silêncio mudaria o que conta (laudo do Corvo, A1).
  return !column.hasDefault || column.columnType === 'PgEnumColumn';
}

/**
 * Compatibilidade de FORMA (decisão do Orquestrador, 2026-10-03): o arquivo vale contra as
 * colunas do schema atual, não contra a migration em que foi gerado. Coluna desconhecida é
 * recusada (`.strict()`); coluna ausente só se não for obrigatória (`isRequired`).
 */
function rowSchema(table: PgTable): z.ZodTypeAny {
  return z
    .object(
      Object.fromEntries(
        backupColumns(table).map(([key, column]) => [
          key,
          isRequired(key, column) ? columnSchema(column) : columnSchema(column).optional(),
        ]),
      ),
    )
    .strict();
}

/** Colunas obrigatórias por tabela, para a mensagem de coluna ausente. */
function requiredKeys(table: PgTable): string[] {
  return backupColumns(table)
    .filter(([key, column]) => isRequired(key, column))
    .map(([key]) => key);
}

const memberSchema = z.object({ id: z.string().uuid(), name: z.string(), email: z.string(), color: z.string() }).strict();
const settingsSchema = rowSchema(householdSettings);

const envelopeSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  exportedAt: isoTimestamp,
  schemaMigration: z.object({ tag: z.string().nullable(), createdAt: z.number().int() }),
  household: z.object({ name: z.string() }),
  members: z.array(memberSchema),
  settings: settingsSchema.nullable(),
  tables: z.record(z.string(), z.array(z.unknown())),
});

export type BackupRow = Record<string, unknown>;

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  schemaMigration: { tag: string | null; createdAt: number };
  household: { name: string };
  members: { id: string; name: string; email: string; color: string }[];
  settings: BackupRow | null;
  tables: Record<string, BackupRow[]>;
};

// ---------------------------------------------------------------------------
// Migration aplicada
// ---------------------------------------------------------------------------

type Reader = Pick<typeof db, 'execute'>;

/** Última migration aplicada no banco; o `tag` sai do journal quando ele está legível. */
export async function currentSchemaMigration(reader: Reader = db): Promise<BackupFile['schemaMigration']> {
  const rows = await reader.execute(
    sql`select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`,
  );
  const createdAt = Number((rows[0] as { created_at?: unknown } | undefined)?.created_at ?? 0);
  let tag: string | null = null;
  try {
    const journal = JSON.parse(readFileSync(join(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8')) as {
      entries: { when: number; tag: string }[];
    };
    tag = journal.entries.find((entry) => entry.when === createdAt)?.tag ?? null;
  } catch {
    // Sem o journal (ambiente sem a pasta drizzle/): o `createdAt` basta para comparar.
  }
  return { tag, createdAt };
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

function toBackupRow(table: PgTable, row: Record<string, unknown>, where: string): BackupRow {
  const out: BackupRow = {};
  for (const [key, column] of backupColumns(table)) {
    const value = row[key];
    if (column.columnType === 'PgTimestamp' && value !== null && value !== undefined) {
      // O driver devolve objeto de data; o arquivo leva ISO 8601 em UTC.
      out[key] = (value as { toISOString(): string }).toISOString();
    } else if (column.columnType === 'PgBigInt53' && value !== null && !Number.isSafeInteger(value)) {
      throw new Error(`Backup: valor fora do inteiro seguro em ${where}.${key}; nada foi exportado.`);
    } else {
      out[key] = value ?? null;
    }
  }
  return out;
}

async function selectScoped(spec: TableSpec, householdId: string): Promise<Record<string, unknown>[]> {
  if (spec.scope === 'card') {
    return db
      .select({ row: statements })
      .from(statements)
      .innerJoin(creditCards, eq(creditCards.id, statements.creditCardId))
      .where(eq(creditCards.householdId, householdId))
      .then((rows) => rows.map((item) => item.row as Record<string, unknown>));
  }
  if (spec.scope === 'plan') {
    return db
      .select({ row: investmentScenarios })
      .from(investmentScenarios)
      .innerJoin(investmentPlans, eq(investmentPlans.id, investmentScenarios.investmentPlanId))
      .where(eq(investmentPlans.householdId, householdId))
      .then((rows) => rows.map((item) => item.row as Record<string, unknown>));
  }
  const table = spec.table as PgTable & { householdId: PgColumn };
  return (await db.select().from(table).where(eq(table.householdId, householdId))) as Record<string, unknown>[];
}

/** O household inteiro num objeto JSON-serializável. Só leitura. */
/** `exportedAt` vem de quem chama (`/lib` não lê o relógio, CONVENTIONS §4). */
export async function exportHousehold(householdId: string, exportedAt: string): Promise<BackupFile> {
  const [household] = await db.select({ name: households.name }).from(households).where(eq(households.id, householdId));
  if (household === undefined) throw new Error('Household não encontrado.');
  const [memberRows, settingsRows, schemaMigration] = await Promise.all([
    db
      .select({ id: members.id, name: members.name, email: members.email, color: members.color })
      .from(members)
      .where(eq(members.householdId, householdId)),
    db.select().from(householdSettings).where(eq(householdSettings.householdId, householdId)),
    currentSchemaMigration(),
  ]);
  const selected = await Promise.all(TABLES.map((spec) => selectScoped(spec, householdId)));
  const tables: Record<string, BackupRow[]> = {};
  TABLES.forEach((spec, index) => {
    tables[spec.key] = (selected[index] ?? [])
      .map((row) => toBackupRow(spec.table, row, spec.key))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  });
  const settings = settingsRows[0];
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    schemaMigration,
    household: { name: household.name },
    members: memberRows.sort((a, b) => a.email.localeCompare(b.email)),
    settings: settings === undefined ? null : toBackupRow(householdSettings, settings, 'settings'),
    tables,
  };
}

// ---------------------------------------------------------------------------
// Validação (a mesma no dry-run e na restauração)
// ---------------------------------------------------------------------------

export class BackupInvalidError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Backup inválido: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? ` (e mais ${String(problems.length - 5)})` : ''}`);
    this.name = 'BackupInvalidError';
    this.problems = problems;
  }
}

export class BackupTargetNotEmptyError extends Error {
  readonly nonEmpty: string[];

  constructor(nonEmpty: string[]) {
    super(
      `Restauração recusada: este household já tem dados (${nonEmpty.join(', ')}). A restauração só entra num household vazio e nunca sobrescreve nada.`,
    );
    this.name = 'BackupTargetNotEmptyError';
    this.nonEmpty = nonEmpty;
  }
}

const ROW_SCHEMAS = new Map(TABLES.map((spec) => [spec.key, rowSchema(spec.table)]));
const REQUIRED_KEYS = new Map(TABLES.map((spec) => [spec.key, requiredKeys(spec.table)]));

/** Backup de outra versão do schema: aviso, não erro (a forma é que decide). `null` se igual. */
export function migrationWarning(
  file: Pick<BackupFile, 'schemaMigration'>,
  current: BackupFile['schemaMigration'],
): string | null {
  if (file.schemaMigration.createdAt === current.createdAt) return null;
  const name = (migration: BackupFile['schemaMigration']) => migration.tag ?? String(migration.createdAt);
  return `O backup foi gerado na versão ${name(file.schemaMigration)}; o app está na ${name(current)}. Colunas que o backup não tem recebem o valor padrão.`;
}
const MAX_PROBLEMS = 50;

/**
 * Formato, versão, Zod linha a linha contra as colunas do schema ATUAL (compatibilidade de
 * forma: ver `rowSchema`), ids únicos por tabela e FKs internas fechando. Puro: a migration
 * diferente não é erro, é aviso (`migrationWarning`).
 */
export function validateBackup(input: unknown): BackupFile {
  const problems: string[] = [];
  const envelope = envelopeSchema.safeParse(input);
  if (!envelope.success) {
    for (const issue of envelope.error.issues.slice(0, MAX_PROBLEMS)) {
      problems.push(`${issue.path.join('.') || 'arquivo'}: ${issue.message}`);
    }
    throw new BackupInvalidError(problems);
  }
  const file = envelope.data;
  const unknownTables = Object.keys(file.tables).filter((key) => !ROW_SCHEMAS.has(key));
  for (const key of unknownTables) problems.push(`tables.${key}: tabela desconhecida`);
  for (const key of BACKUP_TABLES) if (!(key in file.tables)) problems.push(`tables.${key}: ausente`);

  // E-mail repetido faria um membro sumir no casamento por e-mail da restauração.
  const emails = new Set<string>();
  for (const member of file.members) {
    const email = member.email.toLowerCase();
    if (emails.has(email)) problems.push(`members: e-mail repetido ${member.email}`);
    emails.add(email);
  }
  const ids = new Map<string, Set<string>>([['members', new Set(file.members.map((member) => member.id))]]);
  const rows: Record<string, BackupRow[]> = {};
  for (const spec of TABLES) {
    const schema = ROW_SCHEMAS.get(spec.key) as z.ZodTypeAny;
    const parsed: BackupRow[] = [];
    const required = REQUIRED_KEYS.get(spec.key) ?? [];
    (file.tables[spec.key] ?? []).forEach((raw, index) => {
      if (raw !== null && typeof raw === 'object') {
        const missing = required.filter((key) => !(key in raw));
        if (missing.length > 0) {
          problems.push(
            `${spec.key}[${String(index)}]: falta a coluna obrigatória ${missing.join(', ')} (o schema atual não tem valor padrão aceitável para ela)`,
          );
          return;
        }
      }
      const result = schema.safeParse(raw);
      if (!result.success) {
        const issue = result.error.issues[0];
        problems.push(`${spec.key}[${String(index)}].${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'inválido'}`);
      } else {
        parsed.push(result.data as BackupRow);
      }
    });
    const seen = new Set<string>();
    for (const row of parsed) {
      const id = String(row.id);
      if (seen.has(id)) problems.push(`${spec.key}: id repetido ${id}`);
      seen.add(id);
    }
    ids.set(spec.key, seen);
    rows[spec.key] = parsed;
  }
  for (const spec of TABLES) {
    for (const row of rows[spec.key] ?? []) {
      for (const [column, target] of Object.entries(spec.fks)) {
        const value = row[column];
        if (value !== null && value !== undefined && !ids.get(target)?.has(String(value))) {
          problems.push(`${spec.key} ${String(row.id)}: ${column} aponta para ${target} que não está no backup`);
        }
      }
    }
  }
  if (problems.length > 0) throw new BackupInvalidError(problems.slice(0, MAX_PROBLEMS));
  return { ...file, settings: (file.settings ?? null) as BackupRow | null, tables: rows } as BackupFile;
}

/** Linhas por tabela, para o resumo do dry-run. */
export function backupCounts(file: BackupFile): Record<string, number> {
  return Object.fromEntries(BACKUP_TABLES.map((key) => [key, file.tables[key]?.length ?? 0]));
}

/** Tabelas de dado com alguma linha no household (vazio = pode restaurar). */
export async function nonEmptyDataTables(householdId: string, reader: Pick<typeof db, 'select'> = db): Promise<string[]> {
  const found: string[] = [];
  for (const { key, table } of DATA_TABLES) {
    const [row] = await reader.select({ one: sql<number>`1` }).from(table).where(eq(table.householdId, householdId)).limit(1);
    if (row !== undefined) found.push(key);
  }
  return found;
}

/** O que a restauração vai fazer além de inserir (para o resumo e para quem restaura). */
export async function restoreWarnings(
  file: BackupFile,
  householdId: string,
  fallbackMemberId: string,
  current: BackupFile['schemaMigration'],
): Promise<string[]> {
  const targetMembers = await db
    .select({ id: members.id, email: members.email })
    .from(members)
    .where(eq(members.householdId, householdId));
  const emails = new Set(targetMembers.map((member) => member.email.toLowerCase()));
  const fallback = targetMembers.find((member) => member.id === fallbackMemberId);
  const warnings: string[] = [];
  const version = migrationWarning(file, current);
  if (version !== null) warnings.push(version);
  for (const member of file.members) {
    if (!emails.has(member.email.toLowerCase())) {
      warnings.push(
        `O membro ${member.name} (${member.email}) não existe neste household: o que era dele passa para ${fallback?.email ?? 'quem está restaurando'}.`,
      );
    }
  }
  const [{ count: categoryCount } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(categories)
    .where(eq(categories.householdId, householdId));
  if (categoryCount > 0) {
    warnings.push(
      `As ${String(categoryCount)} categorias e as regras de categorização atuais deste household serão substituídas pelas do backup.`,
    );
  }
  if (file.settings !== null) warnings.push('As premissas (reserva, alertas, horizontes) passam a ser as do backup.');
  return warnings;
}

// ---------------------------------------------------------------------------
// Restauração
// ---------------------------------------------------------------------------

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const CHUNK = 300;

async function insertRows(tx: Tx, table: PgTable, rows: BackupRow[]): Promise<void> {
  for (let start = 0; start < rows.length; start += CHUNK) {
    await tx.insert(table).values(rows.slice(start, start + CHUNK) as never);
  }
}

/** Linha do backup -> linha do banco: ids novos, FKs remapeadas, timestamps convertidos no SQL. */
function toInsertRow(
  spec: TableSpec,
  row: BackupRow,
  idMap: Map<string, string>,
  householdId: string,
  deferred: readonly string[] = [],
): BackupRow {
  const columns = getTableColumns(spec.table);
  const out: BackupRow = {};
  for (const [key, value] of Object.entries(row)) {
    const column = columns[key];
    if (key === 'id') out.id = idMap.get(String(value));
    else if (key in spec.fks) out[key] = value === null || deferred.includes(key) ? null : idMap.get(String(value));
    else if (column?.columnType === 'PgTimestamp' && typeof value === 'string') out[key] = sql`${value}::timestamptz`;
    else out[key] = value;
  }
  if ('householdId' in columns) out.householdId = householdId;
  return out;
}

export type RestoreResult = {
  tables: Record<string, number>;
  warnings: string[];
  /** id do backup -> id gravado (inclui membros: id do backup -> membro do destino). */
  idMap: Map<string, string>;
};

/**
 * Restaura `input` no household `householdId`, numa transação. `fallbackMemberId` recebe o
 * que era de membro sem par no destino (normalmente quem está restaurando).
 * Lança `BackupInvalidError` (arquivo) ou `BackupTargetNotEmptyError` (household com dado).
 */
export async function restoreHousehold(
  householdId: string,
  input: unknown,
  fallbackMemberId: string,
): Promise<RestoreResult> {
  const expected = await currentSchemaMigration();
  const file = validateBackup(input);
  const warnings = await restoreWarnings(file, householdId, fallbackMemberId, expected);

  const idMap = await db.transaction(async (tx) => {
    // A mesma trava das outras escritas do household: ninguém grava no meio.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${householdId}))`);
    const nonEmpty = await nonEmptyDataTables(householdId, tx);
    if (nonEmpty.length > 0) throw new BackupTargetNotEmptyError(nonEmpty);

    const map = new Map<string, string>();
    const targetMembers = await tx
      .select({ id: members.id, email: members.email })
      .from(members)
      .where(eq(members.householdId, householdId));
    const byEmail = new Map(targetMembers.map((member) => [member.email.toLowerCase(), member.id]));
    if (!targetMembers.some((member) => member.id === fallbackMemberId)) {
      throw new BackupInvalidError(['quem restaura não é membro deste household']);
    }
    for (const member of file.members) map.set(member.id, byEmail.get(member.email.toLowerCase()) ?? fallbackMemberId);
    for (const spec of TABLES) for (const row of file.tables[spec.key] ?? []) map.set(String(row.id), randomUUID());

    // O seed do destino sai: regras, depois filhas, depois raízes (parent_id não tem cascata).
    await tx.delete(categorizationRules).where(eq(categorizationRules.householdId, householdId));
    await tx.delete(categories).where(and(eq(categories.householdId, householdId), isNotNull(categories.parentId)));
    await tx.delete(categories).where(and(eq(categories.householdId, householdId), isNull(categories.parentId)));

    if (file.settings !== null) {
      const values = { ...file.settings, householdId } as typeof householdSettings.$inferInsert;
      await tx.insert(householdSettings).values(values).onConflictDoUpdate({ target: householdSettings.householdId, set: values });
    }

    for (const spec of TABLES) {
      const rows = file.tables[spec.key] ?? [];
      if (spec.key === 'categories') {
        // Raízes antes das filhas.
        const ordered = [...rows].sort(
          (a, b) => Number((a.parentId ?? null) !== null) - Number((b.parentId ?? null) !== null),
        );
        await insertRows(tx, spec.table, ordered.map((row) => toInsertRow(spec, row, map, householdId)));
      } else if (spec.key === 'statements') {
        // `paidTransactionId` só depois dos lançamentos.
        await insertRows(tx, spec.table, rows.map((row) => toInsertRow(spec, row, map, householdId, ['paidTransactionId'])));
      } else if (spec.key === 'transactions') {
        // A `reconciled` entra depois do `posted` que a cumpriu (FK RESTRICT e o CHECK do par).
        const first = rows.filter((row) => (row.reconciledByTransactionId ?? null) === null);
        const later = rows.filter((row) => (row.reconciledByTransactionId ?? null) !== null);
        await insertRows(tx, spec.table, first.map((row) => toInsertRow(spec, row, map, householdId)));
        await insertRows(tx, spec.table, later.map((row) => toInsertRow(spec, row, map, householdId)));
      } else {
        await insertRows(tx, spec.table, rows.map((row) => toInsertRow(spec, row, map, householdId)));
      }
    }

    for (const row of file.tables.statements ?? []) {
      if ((row.paidTransactionId ?? null) === null) continue;
      await tx
        .update(statements)
        .set({ paidTransactionId: map.get(String(row.paidTransactionId)) })
        .where(eq(statements.id, map.get(String(row.id)) as string));
    }
    return map;
  });

  return { tables: backupCounts(file), warnings, idMap };
}

/** Dry-run: a mesma validação, sem gravar. `targetHasData` avisa que a restauração seria recusada. */
export async function dryRunRestore(
  householdId: string,
  input: unknown,
  fallbackMemberId: string,
): Promise<{ tables: Record<string, number>; warnings: string[]; targetHasData: string[] }> {
  const current = await currentSchemaMigration();
  const file = validateBackup(input);
  return {
    tables: backupCounts(file),
    warnings: await restoreWarnings(file, householdId, fallbackMemberId, current),
    targetHasData: await nonEmptyDataTables(householdId),
  };
}

// ---------------------------------------------------------------------------
// CSV dos lançamentos (sem dependência: um arquivo só, não um .zip)
// ---------------------------------------------------------------------------

function csvCell(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Texto livre (descrição, nomes, observação) que começa com `=`, `+`, `-` ou `@` vira fórmula
 * ao abrir na planilha: o apóstrofo na frente o mantém como texto. Não vale para o valor,
 * que é número e começa com `-` de propósito.
 */
function csvText(value: string): string {
  return csvCell(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
}

/** `-123456` -> `-1234,56` (vírgula decimal, sem milhar: a planilha pt-BR lê como número). */
function centsToDecimal(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}${String(Math.trunc(abs / 100))},${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Os lançamentos do backup como CSV para planilha em pt-BR: `;` como separador, vírgula
 * decimal, CRLF, BOM UTF-8 (o Excel reconhece os acentos). Nomes no lugar dos ids.
 */
export function transactionsCsv(file: BackupFile): string {
  const names = (key: string, field: string) =>
    new Map((file.tables[key] ?? []).map((row) => [String(row.id), String(row[field] ?? '')]));
  const categoryNames = names('categories', 'name');
  const accountNames = names('accounts', 'name');
  const cardNames = names('credit_cards', 'name');
  const memberNames = new Map(file.members.map((member) => [member.id, member.name]));
  const header = ['data', 'competencia', 'data_caixa', 'descricao', 'valor', 'tipo', 'status', 'categoria', 'conta', 'cartao', 'membro', 'parcela', 'observacao'];
  const lines = [header.join(';')];
  const rows = [...(file.tables.transactions ?? [])].sort((a, b) =>
    `${String(a.occurredOn)}${String(a.id)}`.localeCompare(`${String(b.occurredOn)}${String(b.id)}`),
  );
  const ref = (map: Map<string, string>, value: unknown) => (value === null ? '' : (map.get(String(value)) ?? ''));
  for (const row of rows) {
    lines.push(
      [
        csvCell(String(row.occurredOn)),
        csvCell(String(row.competence)),
        csvCell(row.cashDate === null ? '' : String(row.cashDate)),
        csvText(String(row.description)),
        csvCell(centsToDecimal(Number(row.amountCents))),
        csvCell(String(row.kind)),
        csvCell(String(row.status)),
        csvText(ref(categoryNames, row.categoryId)),
        csvText(ref(accountNames, row.accountId)),
        csvText(ref(cardNames, row.creditCardId)),
        csvText(ref(memberNames, row.memberId)),
        csvCell(row.installmentNumber === null ? '' : String(row.installmentNumber)),
        csvText(row.note === null ? '' : String(row.note)),
      ].join(';'),
    );
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Usado pelo teste para provar que nenhuma tabela de dado ficou fora de `TABLES`. */
export const BACKUP_TABLE_NAMES: readonly string[] = TABLES.map((spec) => getTableName(spec.table));
