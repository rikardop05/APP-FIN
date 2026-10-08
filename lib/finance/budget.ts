/**
 * Orcamento por categoria — CONTRACTS §10.
 *
 * Modulo puro (CONVENTIONS §5). O eixo de competencia e a aritmetica de mes vem
 * de `lib/date`.
 *
 * ## O que a cor mede: o TOTAL ESPERADO do mes (decisao 10b do Ricardo, 2026-10-07)
 *
 * `esperado = realizado + previsto a realizar`. A cor responde "ainda posso gastar
 * nesta categoria?", nao "quanto ja gastei". Dia 5, orcamento de 1.000, 100 gastos
 * e 800 de recorrente ainda por vir: a folga real e 100, e a cor e amarela (90%),
 * nao verde (10%). `usageBp`, `remainingCents` e `light` saem todos do
 * esperado; `spentCents` e `upcomingCents` saem separados para a tela mostrar as
 * duas linhas. Sem `upcoming` o esperado e o realizado. Custo aceito: um mes com
 * muita recorrente pode nascer amarelo no dia 1.
 *
 * Semaforo — RF-ORC-05 e §10. O limite de alerta NAO e fixo no motor: chega no
 * parametro `warnBp` (o `budget_warn_bp` do household_settings, default 8000 no
 * seed). Verde/amarelo/vermelho por `usageBp`:
 *
 *   verde    usageBp <  warnBp
 *   amarelo  warnBp <= usageBp <= 10000
 *   vermelho usageBp >  10000
 *
 * Ou seja, nas fronteiras exatas: 7999 bp verde, 8000 bp amarelo, 10000 bp
 * amarelo, 10001 bp vermelho. A cor muda uma unidade depois do limite, nunca
 * antes — a familia decide pela COR, entao o limite e inclusivo no amarelo.
 *
 * `usageBp` e arredondado para o bp mais proximo, e a COR usa esse MESMO
 * inteiro. Assim o percentual exibido e a cor nunca divergem: 15999/20000 =
 * 7999,5 bp arredonda para 8000 bp, e a tela mostra 80,00% com amarelo — em vez
 * de uma cor decidida por uma fracao que ninguem ve (achado do Corvo no T-203).
 *
 * `plannedCents = 0` — decisao fixada com o Orquestrador (o contrato nao a
 * define). Nao ha divisao: `usageBp` sai `null`. O tipo de retorno nao tem
 * "sem semaforo", entao a cor precisa ser escolhida: devolvemos **vermelho se
 * houve gasto e verde se nao houve**. Motivo: devolver verde com gasto > 0
 * esconderia exatamente o estouro que a cor existe para denunciar ("nao defini
 * orcamento, mas gastei" nao pode aparecer como verde). Com gasto zero nao ha o
 * que alertar. `remainingCents` fica `planned - spent`, negativo quando gastou.
 *
 * Sinal — os `amountCents` de `spent` seguem a convencao do projeto (saida
 * negativa, como `transactions.amountCents`). A agregacao por categoria e
 * `max(0, -soma)`, a regra de CONTRACTS §14 para valor agregado de despesa:
 * estorno que supera o gasto nao vira "despesa negativa".
 */

import { diffMonths, type Competence } from '@/lib/date';
import {
  addCents,
  basisPoints,
  cents,
  type BasisPoints,
  type Cents,
} from '@/lib/money';

/** 100 % em basis points. O vermelho comeca acima disto. */
const FULL_BP = 10_000;

export type BudgetLight = 'green' | 'yellow' | 'red';

export interface BudgetStatusRow {
  categoryId: string;
  plannedCents: Cents;
  /** Realizado (`posted`), em modulo. */
  spentCents: Cents;
  /** Previsto a realizar (`planned`), em modulo. */
  upcomingCents: Cents;
  /** `spentCents + upcomingCents`: o que a cor mede. */
  expectedCents: Cents;
  /** `plannedCents - expectedCents`: a folga real do mes (negativa = vai passar). */
  remainingCents: Cents;
  /** Esperado / orcado, em bp. */
  usageBp: BasisPoints | null;
  light: BudgetLight;
}

function assertWarnBp(value: BasisPoints): BasisPoints {
  const bp = basisPoints(value);
  if (bp < 0 || bp > FULL_BP) {
    throw new RangeError(
      `warnBp deve estar entre 0 e ${String(FULL_BP)}; recebido: ${String(bp)}. Acima de 100% a faixa amarela sumiria e um gasto de 100% apareceria como verde.`,
    );
  }
  return bp;
}

/** Percentual gasto em bp inteiros, arredondado. `planned` tem de ser > 0. */
function usageBp(spent: Cents, planned: Cents): BasisPoints {
  const s = BigInt(spent);
  const p = BigInt(planned);
  return basisPoints(Number((s * BigInt(FULL_BP) + p / 2n) / p));
}

function lightFor(usage: BasisPoints | null, expected: Cents, warnBp: BasisPoints): BudgetLight {
  if (usage === null) {
    // Orcamento zero: vermelho so quando ha gasto, realizado ou previsto (ver o cabecalho).
    return expected > 0 ? 'red' : 'green';
  }
  if (usage > FULL_BP) return 'red';
  if (usage < warnBp) return 'green';
  return 'yellow';
}

/** Soma com sinal por categoria. */
function sumByCategory(entries: readonly { categoryId: string; amountCents: Cents }[]): Map<string, Cents> {
  const totals = new Map<string, Cents>();
  for (const entry of entries) {
    totals.set(entry.categoryId, addCents(totals.get(entry.categoryId) ?? cents(0), entry.amountCents));
  }
  return totals;
}

/** `max(0, -soma)`: estorno que supera o gasto nao vira despesa negativa (§14). */
function outflow(net: Cents | undefined): Cents {
  return net !== undefined && net < 0 ? cents(-net) : cents(0);
}

/**
 * Situacao do orcamento por categoria. Uma linha por entrada de `budgets`, na
 * ordem recebida (o schema garante categoria unica por periodo; duplicata aqui e
 * responsabilidade de quem chama). Categoria que so aparece em `spent` ou
 * `upcoming`, sem orcamento, nao gera linha.
 *
 * `spent` e `upcoming` seguem a convencao de sinal do projeto (saida negativa) e cada
 * um passa por `max(0, -soma)` SEPARADO: um estorno no realizado nao come o previsto.
 */
export function budgetStatus(input: {
  budgets: { categoryId: string; plannedCents: Cents }[];
  spent: { categoryId: string; amountCents: Cents }[];
  /** Previsto a realizar no mes (`planned`). Ausente = nada previsto. */
  upcoming?: { categoryId: string; amountCents: Cents }[];
  warnBp: BasisPoints;
}): BudgetStatusRow[] {
  const warnBp = assertWarnBp(input.warnBp);
  const spentByCategory = sumByCategory(input.spent);
  const upcomingByCategory = sumByCategory(input.upcoming ?? []);

  return input.budgets.map((budget) => {
    const plannedCents = cents(budget.plannedCents);
    if (plannedCents < 0) {
      throw new RangeError(
        `plannedCents nao pode ser negativo; recebido: ${String(plannedCents)}. Orcamento negativo inverteria a cor do semaforo.`,
      );
    }

    const spentCents = outflow(spentByCategory.get(budget.categoryId));
    const upcomingCents = outflow(upcomingByCategory.get(budget.categoryId));
    const expectedCents = addCents(spentCents, upcomingCents);

    const remainingCents = addCents(plannedCents, cents(-expectedCents));
    const usage = plannedCents === 0 ? null : usageBp(expectedCents, plannedCents);

    return {
      categoryId: budget.categoryId,
      plannedCents,
      spentCents,
      upcomingCents,
      expectedCents,
      remainingCents,
      usageBp: usage,
      light: lightFor(usage, expectedCents, warnBp),
    };
  });
}

function assertMonths(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(
      `months deve ser inteiro >= 1; recebido: ${String(value)}.`,
    );
  }
  return value;
}

/** Maior competencia do historico, comparando as strings 'YYYY-MM'. */
function latestCompetence(history: { competence: Competence }[]): Competence {
  let latest = history[0]?.competence ?? '0000-00';
  for (const entry of history) {
    if (entry.competence > latest) latest = entry.competence;
  }
  return latest;
}

/** Media inteira, arredondada. `total` e `months` sao >= 0. */
function averageCents(total: Cents, months: number): Cents {
  const t = BigInt(cents(total));
  const m = BigInt(months);
  return cents(Number((t + m / 2n) / m));
}

/**
 * Sugere orcamento por categoria a partir do historico — RF-ORC-04 ("media dos
 * ultimos 3 meses"; `months: 1` e o "repetir o mes anterior").
 *
 * Semantica fixada com o Orquestrador (o contrato nao a define):
 * - a janela sao os `months` meses ATE a ancora, inclusive. Por padrao a ancora
 *   e a maior competencia do proprio historico, sem `today`: quem chama recorta
 *   o que quer considerar. **Isso falha em silencio quando o mes mais recente
 *   esteve vazio:** "repetir o mes anterior" repetiria o de DOIS meses atras, com
 *   um numero plausivel (a mesma forma do G-07). Quem orca um mes especifico
 *   passa `opts.anchor` (o mes anterior ao orcado): a janela deixa de depender
 *   do que o historico contem, mes vazio conta como zero, e lancamento
 *   posterior a ancora e ignorado;
 * - mes sem lancamento conta como ZERO (divide por `months`). Gastar em 1 de 3
 *   meses sugere 1/3 daquele valor, nao o valor cheio;
 * - so sai categoria com pelo menos um lancamento na janela; categoria cujo
 *   gasto ficou todo fora da janela nao aparece;
 * - a soma da janela passa por `max(0, -soma)` (§14) antes de dividir.
 *
 * Ordem de saida: primeira aparicao no historico.
 */
export function suggestBudgetFromHistory(
  history: { competence: Competence; categoryId: string; amountCents: Cents }[],
  opts: { months: number; anchor?: Competence },
): { categoryId: string; suggestedCents: Cents }[] {
  if (history.length === 0) return [];
  const months = assertMonths(opts.months);
  const anchor = opts.anchor ?? latestCompetence(history);

  const totals = new Map<string, Cents>();
  for (const entry of history) {
    const offset = diffMonths(anchor, entry.competence);
    if (offset < 0 || offset > months - 1) continue;
    const current = totals.get(entry.categoryId) ?? cents(0);
    totals.set(entry.categoryId, addCents(current, entry.amountCents));
  }

  const suggestions: { categoryId: string; suggestedCents: Cents }[] = [];
  for (const [categoryId, total] of totals) {
    const spent = total < 0 ? cents(-total) : cents(0);
    suggestions.push({ categoryId, suggestedCents: averageCents(spent, months) });
  }
  return suggestions;
}
