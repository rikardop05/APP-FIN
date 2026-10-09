import { addCompetence, toCompetence, type Competence } from '@/lib/date';
import type { Cents } from '@/lib/money';

/**
 * A meta como carnê: o que falta guardar vira canhotos PRESOS, um aporte por mês até a data-alvo. Sem
 * histórico de aportes individuais (a meta só sabe o saldo atual), o que já foi guardado é UM total
 * "guardado", não uma lista de canhotos pagos. Pura e fora do .tsx para o vitest.
 */
export type GoalInstallment = {
  /** 1..total: a numeração do talão (Parcela). */
  number: number;
  total: number;
  competence: Competence;
  amountCents: Cents;
};

/**
 * Os aportes que faltam: `months` canhotos de `requiredMonthlyCents`, o último no mês da data-alvo e os
 * demais nos meses anteriores, contados para trás (sem ler o relógio). Menos de 1 mês: lista vazia.
 */
export function goalInstallments(input: {
  targetDate: string;
  months: number;
  requiredMonthlyCents: Cents;
}): GoalInstallment[] {
  const { targetDate, months, requiredMonthlyCents } = input;
  if (!Number.isInteger(months) || months < 1) return [];
  const last = toCompetence(targetDate);
  return Array.from({ length: months }, (_, index) => ({
    number: index + 1,
    total: months,
    competence: addCompetence(last, index + 1 - months),
    amountCents: requiredMonthlyCents,
  }));
}

/** Quantos canhotos mostrar de saída; o resto fica atrás de "ver os outros". */
export const VISIBLE_INSTALLMENTS = 4;

export function splitInstallments(list: readonly GoalInstallment[]): {
  visible: GoalInstallment[];
  hidden: GoalInstallment[];
} {
  return { visible: list.slice(0, VISIBLE_INSTALLMENTS), hidden: list.slice(VISIBLE_INSTALLMENTS) };
}
