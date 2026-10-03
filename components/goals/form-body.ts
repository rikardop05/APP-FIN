import { cents, formatBRL, parseBRL, type Cents } from '@/lib/money';

import type { GoalView } from './schemas';

/** Valores do formulário, todos como o usuário os digita (texto). */
export type GoalFormValues = {
  name: string;
  /** "R$ 10.000,00". Ignorado na reserva de emergência (alvo calculado). */
  target: string;
  /** `YYYY-MM-DD` ou vazio (sem prazo). */
  targetDate: string;
  /** Valor atual digitado. Ignorado quando há conta vinculada. */
  current: string;
  /** Id da conta vinculada ou vazio. */
  accountId: string;
  priority: string;
  status: 'active' | 'achieved' | 'paused';
  isEmergencyFund: boolean;
};

export type GoalRequestBody = {
  name: string;
  targetCents: Cents | null;
  targetDate: string | null;
  currentCents: Cents;
  accountId: string | null;
  priority: number;
  status: 'active' | 'achieved' | 'paused';
  isEmergencyFund: boolean;
};

export type FormResult =
  | { ok: true; body: GoalRequestBody }
  | { ok: false; errors: Partial<Record<keyof GoalFormValues, string>> };

export function initialGoalValues(goal: GoalView | undefined, emergency = false): GoalFormValues {
  return {
    name: goal?.name ?? (emergency ? 'Reserva de emergência' : ''),
    target: goal?.targetCents != null && !goal.isEmergencyFund ? formatBRL(goal.targetCents) : '',
    targetDate: goal?.targetDate ?? '',
    current: goal && goal.accountId === null ? formatBRL(goal.currentCents) : formatBRL(cents(0)),
    accountId: goal?.accountId ?? '',
    priority: String(goal?.priority ?? (emergency ? 1 : 100)),
    status: goal === undefined || goal.status === 'cancelled' ? 'active' : goal.status,
    isEmergencyFund: goal?.isEmergencyFund ?? emergency,
  };
}

/**
 * Formulário -> corpo da API. Validação de BORDA (texto -> número); as regras de negócio
 * (alvo > 0, reserva única, conta do household) são do servidor.
 *
 * O dinheiro passa por `parseBRL` (nunca `parseFloat`), e "sem prazo" é `null`, não data vazia.
 */
export function goalFormToBody(values: GoalFormValues): FormResult {
  const errors: Partial<Record<keyof GoalFormValues, string>> = {};

  const name = values.name.trim();
  if (name === '') errors.name = 'Dê um nome à meta.';

  let targetCents: Cents | null = null;
  if (!values.isEmergencyFund) {
    const parsed = parseBRL(values.target);
    if (parsed === null || parsed <= 0) errors.target = 'Informe um valor-alvo maior que zero.';
    else targetCents = parsed;
  }

  let currentCents: Cents = cents(0);
  if (values.accountId === '') {
    const parsed = parseBRL(values.current);
    if (parsed === null || parsed < 0) errors.current = 'Informe um valor válido (zero ou mais).';
    else currentCents = parsed;
  }

  const priority = Number(values.priority);
  if (!Number.isInteger(priority) || priority < 1 || priority > 10_000) {
    errors.priority = 'Use um número inteiro de 1 a 10000.';
  }

  if (values.targetDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(values.targetDate)) {
    errors.targetDate = 'Informe uma data válida.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    body: {
      name,
      targetCents,
      targetDate: values.targetDate === '' ? null : values.targetDate,
      currentCents,
      accountId: values.accountId === '' ? null : values.accountId,
      priority,
      status: values.status,
      isEmergencyFund: values.isEmergencyFund,
    },
  };
}
