/**
 * "Ainda presos": as parcelas FUTURAS que o lote em revisao projeta, por
 * competencia (o mes da fatura em que cada uma sera cobrada). E a coluna da
 * tela de revisao da fatura, no mundo do carne: os canhotos ainda presos.
 *
 * Le o resultado de `finalizeImport` em vez de refazer a conta: a projecao e a
 * MESMA que o commit grava (plano por descricao + total, parcelas a partir da
 * competencia da fatura, linha desmarcada e valor zero fora, dedupe do lote).
 * A rota `/api/import/recalculate` devolve este resumo a cada edicao da tela
 * (parcela, inclusao, valor, data), junto do total do placar.
 *
 * Modulo puro e **seguro para o cliente**: so `import type` do pipeline, entao
 * o `node:crypto` do dedupe nao entra no bundle de quem o importar.
 */

import type { Competence } from '@/lib/date';
import type { FinalizeResult } from '@/lib/import/pipeline';
import { addCents, cents, type Cents } from '@/lib/money';

/** Uma parcela futura, com a linha confirmada que a originou. */
export interface StillHeldItem {
  /** `index` da linha confirmada que abriu o plano. */
  sourceIndex: number;
  /** Descricao do plano, sem o sufixo de parcela. */
  description: string;
  installmentNumber: number;
  installmentsCount: number;
  /** Com o sinal do sistema: saida negativa. */
  amountCents: Cents;
}

/** As parcelas presas numa competencia. */
export interface StillHeldMonth {
  competence: Competence;
  /** Soma de `items`, com sinal. */
  totalCents: Cents;
  /** Ordenadas por `sourceIndex`, depois por numero da parcela. */
  items: StillHeldItem[];
}

/** Resumo da coluna. Lote sem parcela futura: `{ months: [], totalCents: 0, count: 0 }`. */
export interface StillHeldSummary {
  /** Competencias em ordem crescente; so as que tem parcela. */
  months: StillHeldMonth[];
  /** Soma de todas as competencias, com sinal. */
  totalCents: Cents;
  /** Quantas parcelas futuras. */
  count: number;
}

/**
 * Agrupa as parcelas projetadas por `finalizeImport` por competencia.
 *
 * Projetada = transacao de plano com `rawDescription` vazio (a mesma marca que
 * o commit usa para grava-la como `planned`). A linha real do plano (a parcela
 * impressa nesta fatura) nao e presa: ela e o canhoto que esta sendo destacado.
 */
export function summarizeStillHeld(
  result: Pick<FinalizeResult, 'transactions' | 'installmentPlans'>,
): StillHeldSummary {
  const plans = new Map(result.installmentPlans.map((plan) => [plan.ref, plan]));
  const byCompetence = new Map<Competence, StillHeldItem[]>();

  for (const transaction of result.transactions) {
    if (transaction.rawDescription !== '' || transaction.installmentPlanRef === null) continue;
    const plan = plans.get(transaction.installmentPlanRef);
    if (plan === undefined || transaction.installmentNumber === null) continue;
    const items = byCompetence.get(transaction.competence) ?? [];
    items.push({
      sourceIndex: plan.sourceIndex,
      description: plan.description,
      installmentNumber: transaction.installmentNumber,
      installmentsCount: plan.installmentsCount,
      amountCents: transaction.amountCents,
    });
    byCompetence.set(transaction.competence, items);
  }

  const months = [...byCompetence.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([competence, items]) => ({
      competence,
      totalCents: addCents(...items.map((item) => item.amountCents)),
      items: items.sort(
        (a, b) => a.sourceIndex - b.sourceIndex || a.installmentNumber - b.installmentNumber,
      ),
    }));

  return {
    months,
    totalCents: months.length === 0 ? cents(0) : addCents(...months.map((month) => month.totalCents)),
    count: months.reduce((sum, month) => sum + month.items.length, 0),
  };
}
