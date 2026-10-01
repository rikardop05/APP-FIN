/**
 * Validação pura de recorrência — sem `@/lib/db`, sem `db`, sem `process.env`.
 *
 * Esse módulo é separado de `recurring.ts` por uma razão específica: testes
 * de domínio puro (regra `frequency × oneOffCompetence × startsOn × endsOn`,
 * `endsOn < startsOn`, formato da competência eventual) não podem viver em
 * um arquivo que importa `@/lib/db`. O import de `@/lib/db` executa
 * `getClient()` no top-level, que lê `DATABASE_URL` e abre o pool do
 * postgres — o que, na ausência de env, joga "DATABASE_URL não definida" e,
 * na presença, conecta no banco errado.
 *
 * Resultado: extrair essas regras aqui permite testá-las em isolamento e
 * evita a tentação de contornar com `vitest.setup.ts` carregando `.env.local`
 * — que foi exatamente o buraco aberto antes deste arquivo existir.
 *
 * Erro tipado: `RecurringReferenceError` (também vive aqui — sem `lib/db`,
 * nem `drizzle-orm`). `recurring.ts` re-exporta o erro para a borda da rota
 * usar `error.name === 'RecurringReferenceError'` sem precisar importar este
 * módulo.
 *
 * Tipos de entrada (`IncomeInput`, `RecurringExpenseInput`): moram aqui
 * também — o tipo de entrada da validação pertence a quem valida, e a rota
 * deriva o seu do `Zod.infer` (não do `IncomeInput` em si). Re-exportados de
 * `recurring.ts` para a borda da API.
 */

import type { Cents } from '@/lib/money';
import type { Frequency, IncomeKind } from '@/lib/db/enums';

export type RecurringExpenseFrequency = Frequency;
export type RecurringIncomeKind = IncomeKind;

/** Entrada de `createIncome` / `updateIncome`. */
export type IncomeInput = {
  description: string;
  kind: IncomeKind;
  expectedCents: Cents;
  memberId: string;
  receiveDay: number;
  frequency: Frequency;
  oneOffCompetence: string | null;
  startsOn: string | null;
  endsOn: string | null;
};

/** Entrada de `createRecurringExpense` / `updateRecurringExpense`. */
export type RecurringExpenseInput = {
  description: string;
  expectedCents: Cents;
  categoryId: string;
  dueDay: number;
  frequency: Frequency;
  accountId: string | null;
  creditCardId: string | null;
  startsOn: string;
  endsOn: string | null;
  annualAdjustmentBp: number | null;
};

/** Alias semântico para o patch de receita. */
export type IncomePatch = IncomeInput;
/** Alias semântico para o patch de despesa. */
export type RecurringExpensePatch = RecurringExpenseInput;

export class RecurringReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecurringReferenceError';
  }
}

const COMPETENCE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Coerência `frequency` × `oneOffCompetence` × `startsOn` × `endsOn` para
 * receita (recurring ou eventual).
 *
 * - `one_off`: `oneOffCompetence` é **obrigatório** (a coluna do banco tem
 *   CHECK, mas o Zod da rota reforça a regra antes da query para a mensagem
 *   de erro ficar em pt-BR). `startsOn` pode ser `null` (a competência é o
 *   que vale, ver CONTRACTS §8 / `expandOneOff`).
 * - Demais frequências: `oneOffCompetence` deve ser `null` (o motor ignora) e
 *   `startsOn` deve estar preenchido (sem `startsOn` não há cadência para
 *   projetar).
 */
export function assertIncomeShape(input: IncomeInput): void {
  if (input.frequency === 'one_off') {
    if (input.oneOffCompetence === null) {
      throw new RecurringReferenceError('Receita eventual exige uma competência fixa.');
    }
    if (!COMPETENCE_PATTERN.test(input.oneOffCompetence)) {
      throw new RecurringReferenceError('Competência inválida.');
    }
    return;
  }
  if (input.oneOffCompetence !== null) {
    throw new RecurringReferenceError(
      'Competência fixa só se aplica a receitas eventuais.',
    );
  }
  if (input.startsOn === null) {
    throw new RecurringReferenceError('Informe a data de início da receita.');
  }
  if (input.endsOn !== null && input.endsOn < input.startsOn) {
    throw new RecurringReferenceError('Data final não pode ser anterior à data inicial.');
  }
}

/**
 * Garante coerência entre `frequency` e `endsOn` / `startsOn` para despesa.
 * Mantida na assinatura por crescimento futuro (a regra "recorrência X
 * precisa de startsOn" virá aqui).
 */
export function assertRecurrenceShape(
  frequency: Frequency,
  startsOn: string,
  endsOn: string | null,
): void {
  // Argumento silenciosamente ignorado hoje; mantido na assinatura para
  // crescimento futuro sem mexer em caller.
  void frequency;
  if (endsOn !== null && endsOn < startsOn) {
    throw new RecurringReferenceError('Data final não pode ser anterior à data inicial.');
  }
}
