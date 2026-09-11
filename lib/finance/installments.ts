/**
 * Parcelas de cartao — CONTRACTS §4.
 *
 * Modulo puro (CONVENTIONS §5). A divisao do valor e sempre `allocate` de
 * `lib/money`: a soma das parcelas fecha EXATAMENTE com o total, com o resto
 * nas primeiras. Nada aqui reimplementa arredondamento.
 */

import { addCompetence, diffMonths, type Competence } from '@/lib/date';
import { addCents, allocate, cents, type Cents } from '@/lib/money';

export interface InstallmentPlanInput {
  totalCents: Cents;
  installmentsCount: number;
  firstCompetence: Competence;
  description: string;
  categoryId?: string | null;
}

export interface PlannedInstallment {
  installmentNumber: number;
  competence: Competence;
  amountCents: Cents;
  /** "Descricao (3/10)" — o sufixo diz qual parcela e de quantas. */
  description: string;
}

function assertInstallmentsCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(
      `installmentsCount deve ser inteiro >= 1; recebido: ${String(value)}.`,
    );
  }
  return value;
}

/** "Mercado Livre" + 3 de 10 -> "Mercado Livre (3/10)". */
function describeInstallment(
  description: string,
  installmentNumber: number,
  installmentsCount: number,
): string {
  return `${description} (${String(installmentNumber)}/${String(installmentsCount)})`;
}

/**
 * Monta as parcelas de 1 a N em competencias consecutivas a partir de
 * `firstCompetence`.
 *
 * `amounts` ja vem dimensionado por `allocate`, e `offset` diz quantas parcelas
 * do inicio do plano nao estao nesta lista (usado pelo replan, que so devolve
 * as futuras) — o numero da parcela e a competencia continuam contando desde o
 * comeco do plano, nao desde o comeco da lista.
 */
function buildInstallments(
  amounts: Cents[],
  offset: number,
  input: InstallmentPlanInput,
): PlannedInstallment[] {
  return amounts.map((amountCents, index) => {
    const installmentNumber = offset + index + 1;
    return {
      installmentNumber,
      competence: addCompetence(input.firstCompetence, installmentNumber - 1),
      amountCents,
      description: describeInstallment(
        input.description,
        installmentNumber,
        input.installmentsCount,
      ),
    };
  });
}

/**
 * Gera as N parcelas do plano. A soma dos `amountCents` e exatamente
 * `totalCents` (garantia de `allocate`), e as competencias sao consecutivas.
 */
export function expandInstallmentPlan(
  input: InstallmentPlanInput,
): PlannedInstallment[] {
  assertInstallmentsCount(input.installmentsCount);
  const amounts = allocate(cents(input.totalCents), input.installmentsCount);
  return buildInstallments(amounts, 0, input);
}

/**
 * Replaneja um plano editado: preserva o que ja foi realizado e regenera so o
 * futuro.
 *
 * Devolve APENAS as parcelas futuras, e nao o plano inteiro. Nao e escolha de
 * estilo: `opts` traz `settledCents` como AGREGADO do que ja foi realizado, sem
 * o valor de cada parcela preservada — com isso e impossivel reconstruir as
 * linhas antigas, e devolve-las inventadas seria pior do que nao devolve-las.
 * Quem chama mantem as realizadas como estao e troca dai em diante.
 *
 * As parcelas devolvidas continuam a numeracao e as competencias do plano
 * original: se 3 de 10 foram preservadas, a primeira devolvida e a de numero 4,
 * com descricao "(4/10)".
 *
 * O que sobra a distribuir e `totalCents - settledCents`. Se o novo total for
 * MENOR do que o ja realizado, a sobra e negativa e as parcelas futuras saem
 * negativas — um credito. E aritmeticamente correto e a soma continua fechando;
 * cabe a borda decidir se quer mostrar isso ao usuario como estorno.
 *
 * LANCA quando nao sobrou nenhuma parcela futura E ainda ha diferenca entre o
 * total e o realizado: nesse caso nao existe onde acomodar o valor, e devolver
 * lista vazia esconderia a diferenca. Garantia do modulo: sempre que esta
 * funcao RETORNA, `settledCents` mais a soma do que ela devolveu e exatamente
 * `totalCents`.
 */
export function replanInstallments(
  input: InstallmentPlanInput,
  opts: { keepThroughCompetence: Competence; settledCents: Cents },
): PlannedInstallment[] {
  assertInstallmentsCount(input.installmentsCount);

  // Quantas parcelas cabem de firstCompetence ate keepThroughCompetence,
  // inclusive. Competencia anterior ao inicio do plano preserva nada.
  const monthsKept = diffMonths(opts.keepThroughCompetence, input.firstCompetence) + 1;
  const keptCount = Math.min(
    Math.max(monthsKept, 0),
    input.installmentsCount,
  );

  // Subtracao via addCents: o acumulador em bigint nao perde centavo quando o
  // parcial passa do safe integer.
  const settled = cents(opts.settledCents);
  const remainingTotal = addCents(cents(input.totalCents), cents(-settled));

  const remainingCount = input.installmentsCount - keptCount;
  if (remainingCount === 0) {
    // Sem parcela futura, nao ha onde acomodar o que sobrou. Devolver lista
    // vazia aqui faria a diferenca DESAPARECER em silencio: quem chama veria
    // "plano completo" com `settledCents` diferente de `totalCents` e nunca
    // saberia. Motor de dinheiro nao perde centavo calado — a entrada e
    // inconsistente e quem chama tem de resolver.
    if (remainingTotal !== 0) {
      throw new RangeError(
        `Plano sem parcela futura para acomodar ${String(remainingTotal)} centavos: ` +
          `total ${String(cents(input.totalCents))} e realizado ${String(settled)} ` +
          `com as ${String(input.installmentsCount)} parcelas ja preservadas.`,
      );
    }
    return [];
  }
  const amounts = allocate(remainingTotal, remainingCount);

  return buildInstallments(amounts, keptCount, input);
}
