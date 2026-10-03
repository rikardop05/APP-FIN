import { z } from 'zod';

/**
 * Textos da seção de backup (T-402). Fora do .tsx porque o vitest não transforma JSX.
 * O que restaurar vai fazer quem decide é a API (`/api/backup/restore?dryRun=1`); aqui só
 * se escolhe como dizer.
 */

/** [singular, plural]. */
const TABLE_LABELS: Record<string, [string, string]> = {
  accounts: ['conta', 'contas'],
  credit_cards: ['cartão', 'cartões'],
  categories: ['categoria', 'categorias'],
  categorization_rules: ['regra de categorização', 'regras de categorização'],
  import_mappings: ['mapeamento de importação', 'mapeamentos de importação'],
  installment_plans: ['parcelamento', 'parcelamentos'],
  recurring_expenses: ['despesa fixa', 'despesas fixas'],
  incomes: ['receita', 'receitas'],
  budgets: ['orçamento', 'orçamentos'],
  goals: ['meta', 'metas'],
  investment_plans: ['plano de investimento', 'planos de investimento'],
  investment_scenarios: ['cenário de investimento', 'cenários de investimento'],
  investment_snapshots: ['registro de posição', 'registros de posição'],
  statements: ['fatura', 'faturas'],
  import_batches: ['importação', 'importações'],
  skipped_occurrences: ['previsão dispensada', 'previsões dispensadas'],
  transactions: ['lançamento', 'lançamentos'],
};

/** Rótulo da tabela; `count === 1` no singular. */
export function tableLabel(key: string, count = 2): string {
  const labels = TABLE_LABELS[key];
  if (labels === undefined) return key;
  return count === 1 ? labels[0] : labels[1];
}

export const dryRunResponseSchema = z.object({
  tables: z.record(z.string(), z.number().int()),
  warnings: z.array(z.string()),
  targetHasData: z.array(z.string()),
});

export type DryRunResponse = z.infer<typeof dryRunResponseSchema>;

/** "72 lançamentos, 3 cartões, …" (só o que tem linha), na ordem da API. */
export function backupContentsText(tables: Record<string, number>): string {
  const parts = Object.entries(tables)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${String(count)} ${tableLabel(key, count)}`);
  return parts.length === 0 ? 'O backup está vazio.' : `O backup tem ${parts.join(', ')}.`;
}

/** `null` = pode restaurar; senão, o motivo da recusa (que a API vai repetir com 409). */
export function refusalText(targetHasData: readonly string[]): string | null {
  if (targetHasData.length === 0) return null;
  return `Este household já tem dados (${targetHasData.map((key) => tableLabel(key)).join(', ')}). A restauração só entra num household vazio e nunca sobrescreve nada: ela será recusada.`;
}

/** Mensagem de erro da API (400 já resume os problemas, 409, 500) para a tela. */
export function apiErrorText(body: unknown, fallback: string): string {
  const parsed = z.object({ error: z.string() }).safeParse(body);
  return parsed.success ? parsed.data.error : fallback;
}
