import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Enums do banco, traduzidos de DATA-MODEL §1 na ordem em que aparecem lá.
 * Valores em ingles snake_case (CONVENTIONS §1). A ordem dos valores importa:
 * mudar depois exige migration.
 */

export const accountKind = pgEnum('account_kind', [
  'checking',
  'savings',
  'cash',
  'brokerage',
]);

export const cardBrand = pgEnum('card_brand', [
  'visa',
  'mastercard',
  'elo',
  'amex',
  'other',
]);

export const statementStatus = pgEnum('statement_status', [
  'open',
  'closed',
  'paid',
]);

export const recordSource = pgEnum('record_source', [
  'import',
  'manual',
  'generated',
]);

export const transactionKind = pgEnum('transaction_kind', [
  'expense',
  'income',
  'transfer',
  'credit_card_payment',
  'investment_contribution',
]);

export const transactionStatus = pgEnum('transaction_status', [
  'posted',
  'planned',
]);

export const categoryNature = pgEnum('category_nature', [
  'essential',
  'non_essential',
  'investment',
  'income',
]);

export const matchType = pgEnum('match_type', ['contains', 'regex', 'exact']);

export const frequency = pgEnum('frequency', [
  'monthly',
  'bimonthly',
  'quarterly',
  'semiannual',
  'annual',
  'one_off',
]);

export const incomeKind = pgEnum('income_kind', [
  'salary',
  'pro_labore',
  'variable',
  'rent',
  'other',
]);

export const goalStatus = pgEnum('goal_status', [
  'active',
  'achieved',
  'paused',
  'cancelled',
]);

export const scenarioLabel = pgEnum('scenario_label', [
  'conservative',
  'moderate',
  'optimistic',
]);

export const importStatus = pgEnum('import_status', [
  'pending',
  'committed',
  'reverted',
  'failed',
]);

export const importFormat = pgEnum('import_format', [
  'ofx',
  'csv',
  'xlsx',
  'pdf',
  'text',
]);

/** Tipos derivados, para uso fora do schema sem reescrever a lista. */
export type AccountKind = (typeof accountKind.enumValues)[number];
export type CardBrand = (typeof cardBrand.enumValues)[number];
export type StatementStatus = (typeof statementStatus.enumValues)[number];
export type RecordSource = (typeof recordSource.enumValues)[number];
export type TransactionKind = (typeof transactionKind.enumValues)[number];
export type TransactionStatus = (typeof transactionStatus.enumValues)[number];
export type CategoryNature = (typeof categoryNature.enumValues)[number];
export type MatchType = (typeof matchType.enumValues)[number];
export type Frequency = (typeof frequency.enumValues)[number];
export type IncomeKind = (typeof incomeKind.enumValues)[number];
export type GoalStatus = (typeof goalStatus.enumValues)[number];
export type ScenarioLabel = (typeof scenarioLabel.enumValues)[number];
export type ImportStatus = (typeof importStatus.enumValues)[number];
export type ImportFormat = (typeof importFormat.enumValues)[number];
