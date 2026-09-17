/**
 * KPIs do dashboard — CONTRACTS §14.
 *
 * Modulo puro (CONVENTIONS §5): recebe dados, devolve dados. Nao le relogio,
 * nao toca banco e nao faz conta de calendario por si — a janela de meses vem
 * de `lib/date`.
 *
 * ---
 *
 * ## Regras de dominio que decidem este modulo (RC-03/RC-04)
 *
 * 1. **`transfer` e `credit_card_payment` sao INVISIVEIS em todos os campos.**
 *    Transferencia entre contas da familia nao tira dinheiro do patrimonio, so
 *    muda de lugar; o pagamento de fatura ja foi contado nos itens da fatura.
 *    Somar qualquer um dos dois infla a despesa do mes (RC-03).
 * 2. **`investment_contribution` sai em `contributionsCents`, separado da
 *    despesa** (RC-04). Aporte nao e consumo, e patrimonio mudando de forma.
 * 3. **Aporte NAO e subtraido da sobra.** Ele e *destino* da sobra, nao reducao
 *    dela — subtrair contaria duas vezes quem investe, fazendo a familia achar
 *    que gasta mais do que gasta (CONTRACTS §14, decisao de 2026-09-17).
 *
 * ## Sinal — cada balde e o LIQUIDO na direcao natural, com piso em zero
 *
 * O lancamento e gravado com sinal (saida negativa, CONVENTIONS §2). O KPI
 * publica, nao o modulo, mas o liquido na direcao natural do balde, cortado em
 * zero (CONTRACTS §14, decisao de 2026-09-17, achado do Corvo):
 *
 * ```
 * incomeCents        = max(0,  soma dos kind 'income')
 * expenseCents       = max(0, -soma dos kind 'expense')
 * contributionsCents = max(0, -soma dos kind 'investment_contribution')
 * ```
 *
 * **Nao e modulo.** Um mes so com estorno (`kind: 'expense'` positivo, dinheiro
 * voltando) teria `expenseCents` positivo em modulo — o painel anunciaria
 * "despesa: R$ 50,00" num mes em que a familia RECEBEU R$ 50. O mesmo espelho
 * vale para estorno de receita (`income` negativo) e resgate de investimento
 * (`contribution` positivo): nenhum dos dois e ganho/aporte. E o mesmo criterio
 * que o §5 fixou no T-110, onde mes so com estorno nao conta como
 * comprometimento.
 *
 * **Limitacao deliberada:** quando o estorno SUPERA o gasto, a sobra e cortada
 * pelo piso e nao aparece em balde nenhum — estorno nao vira receita. E perda de
 * informacao aceita em troca de nunca exibir despesa negativa no KPI. Nao
 * "consertar" sem reabrir a decisao.
 *
 * `surplusCents = incomeCents - expenseCents` continua, e PODE ser negativo — e
 * deficit.
 *
 * ## Classificacao
 *
 * Balde por `kind`, nunca por `categoryNature`. `categoryNature` entra so em
 * `essentialShareBp`. Uma unica fonte de verdade para classificar dinheiro
 * evita que as duas divirjam.
 *
 * ## Status
 *
 * `posted` e `planned` somam os dois: a familia quer o custo do mes INTEIRO
 * (parcela que cai dia 28 e despesa daquele mes mesmo em dia 3). O
 * comprometimento *alem* do mes sai separado em `futureInstallmentsCents`.
 */

import { addCompetence, competenceStart, type Competence } from '@/lib/date';
import { reconcileStatement } from '@/lib/finance/billing';
import {
  addCents,
  basisPoints,
  cents,
  type BasisPoints,
  type Cents,
} from '@/lib/money';

/**
 * Espelho de `transaction_kind` de `lib/db/enums.ts` (DATA-MODEL §1).
 *
 * Declarado aqui, e nao importado, porque CONVENTIONS §5 proibe `/lib/finance`
 * de alcancar `/lib/db` — o ESLint bloqueia o import, inclusive de tipo. A
 * fonte de verdade continua sendo o enum do banco; estes literais tem de
 * acompanhar qualquer valor novo la. Mudar um lado so e bug silencioso de
 * classificacao.
 */
export type TransactionKind =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'credit_card_payment'
  | 'investment_contribution';

/** Espelho de `category_nature` de `lib/db/enums.ts`. Ver nota acima. */
export type CategoryNature =
  | 'essential'
  | 'non_essential'
  | 'investment'
  | 'income';

export interface MonthlyKpisInput {
  competence: Competence;
  transactions: {
    amountCents: Cents;
    kind: TransactionKind;
    status: 'posted' | 'planned';
    categoryNature: CategoryNature;
  }[];
  futureInstallmentsCents: Cents;
  uncategorizedCount: number;
}

export interface MonthlyKpis {
  incomeCents: Cents;
  expenseCents: Cents;
  contributionsCents: Cents;
  surplusCents: Cents;
  savingsRateBp: BasisPoints | null;
  essentialShareBp: BasisPoints | null;
  futureInstallmentsCents: Cents;
  uncategorizedCount: number;
}

/** Basis points em 100 %. `500 bp = 5,00 %` (CONVENTIONS §3). */
const BP_SCALE = 10_000n;

/**
 * Teto do `BasisPoints` representavel (`safe integer`). Razao acima disso e
 * dado patologico (ex.: renda de 1 centavo com despesa gigante) e e saturada em
 * vez de lancar — um KPI nao pode derrubar o dashboard inteiro. Nao se usa
 * `null`: `null` ja significa "sem base de calculo" (renda zero).
 */
const MAX_BASIS_POINTS = BigInt(Number.MAX_SAFE_INTEGER);

/** Meses anteriores usados na media de `spendingByCategory`. */
const AVERAGE_WINDOW = 3;

/** Valor zero tipado, usado como semente das somas. */
function zero(): Cents {
  return cents(0);
}

/**
 * `max(0, value)`: piso em zero. Aplicado na DIRECAO natural de cada balde, e o
 * que impede estorno puro de virar despesa/receita/aporte (ver o docblock).
 */
function positivePart(value: Cents): Cents {
  return value > 0 ? value : zero();
}

/** Saida liquida de um balde: `max(0, -net)`. O net entra com sinal. */
function netOutflow(net: Cents): Cents {
  return positivePart(cents(-net));
}

/**
 * Razao `numerator / denominator` em basis points inteiros, arredondada para o
 * bp mais proximo (empate afasta do zero, como `applyRate`).
 *
 * O produto estoura o safe integer bem antes do limite de `Cents`, entao a
 * conta roda em bigint. O sinal e o da razao: `num` e `den` negativos dao bp
 * positivo. Quem chama garante `denominator !== 0`.
 *
 * **Nunca lanca**: razao acima do teto satura em `MAX_BASIS_POINTS`.
 */
function ratioBasisPoints(numerator: Cents, denominator: Cents): BasisPoints {
  const num = BigInt(cents(numerator));
  const den = BigInt(cents(denominator));
  const negative = num < 0n !== den < 0n;
  const absNum = num < 0n ? -num : num;
  const absDen = den < 0n ? -den : den;
  // round(absNum * S / absDen) = floor((2*absNum*S + absDen) / (2*absDen)).
  const rounded = (absNum * 2n * BP_SCALE + absDen) / (absDen * 2n);
  const capped = rounded > MAX_BASIS_POINTS ? MAX_BASIS_POINTS : rounded;
  return basisPoints(Number(negative ? -capped : capped));
}

/**
 * Divisao inteira arredondada para o centavo mais proximo (empate afasta do
 * zero). Usada para a MEDIA de `spendingByCategory`, que e um unico valor
 * derivado — nao ha "partes" a somar, entao `allocate` nao se aplica.
 */
function divideRound(value: Cents, parts: number): Cents {
  const total = BigInt(cents(value));
  const divisor = BigInt(parts);
  const negative = total < 0n;
  const absTotal = negative ? -total : total;
  const rounded = (absTotal * 2n + divisor) / (divisor * 2n);
  return cents(Number(negative ? -rounded : rounded));
}

/**
 * KPIs do mes (CONTRACTS §14).
 *
 * `competence` e validada (formato `YYYY-MM`) e nao entra em nenhum calculo: as
 * transacoes ja chegam recortadas pelo mes. Ela existe na entrada para a
 * fronteira falhar cedo em competencia malformada, do mesmo jeito que o resto
 * do motor.
 */
export function monthlyKpis(input: MonthlyKpisInput): MonthlyKpis {
  competenceStart(input.competence);

  let income = zero();
  let expense = zero();
  let essentialExpense = zero();
  let contributions = zero();

  for (const transaction of input.transactions) {
    const amount = cents(transaction.amountCents);
    switch (transaction.kind) {
      case 'income':
        income = addCents(income, amount);
        break;
      case 'expense':
        expense = addCents(expense, amount);
        // `categoryNature` so pesa aqui: o balde de dinheiro e o `kind`.
        if (transaction.categoryNature === 'essential') {
          essentialExpense = addCents(essentialExpense, amount);
        }
        break;
      case 'investment_contribution':
        contributions = addCents(contributions, amount);
        break;
      case 'transfer':
      case 'credit_card_payment':
        // Invisiveis: RC-03. Nao tocam nenhum acumulador.
        break;
    }
  }

  // Cada balde e o LIQUIDO na direcao natural, com piso em zero. Estorno puro
  // (kind 'expense' positivo) da zero, nao "despesa" — ver o docblock.
  const incomeCents = positivePart(income);
  const expenseCents = netOutflow(expense);
  const contributionsCents = netOutflow(contributions);
  const surplusCents = addCents(incomeCents, cents(-expenseCents));

  return {
    incomeCents,
    expenseCents,
    contributionsCents,
    surplusCents,
    savingsRateBp:
      incomeCents === 0 ? null : ratioBasisPoints(surplusCents, incomeCents),
    essentialShareBp:
      incomeCents === 0
        ? null
        : ratioBasisPoints(netOutflow(essentialExpense), incomeCents),
    futureInstallmentsCents: cents(input.futureInstallmentsCents),
    uncategorizedCount: input.uncategorizedCount,
  };
}

export interface SpendingByCategoryInput {
  competence: Competence;
  transactions: {
    competence: Competence;
    amountCents: Cents;
    kind: TransactionKind;
    categoryId: string | null;
  }[];
  categories: { id: string; name: string; nature: CategoryNature }[];
}

export interface CategorySpending {
  categoryId: string;
  name: string;
  nature: CategoryNature;
  /** Gasto do mes de `competence`: `max(0, -liquido)`, nunca negativo. */
  spentCents: Cents;
  /** Media das 3 competencias ANTERIORES, arredondada ao centavo. */
  average3mCents: Cents;
  /** `(spent - media) / media`; `null` quando a media e zero. */
  variationBp: BasisPoints | null;
}

/**
 * Gasto por categoria no mes, com variacao contra a media dos 3 meses
 * anteriores (SPEC §5.8, linha 2, item 2).
 *
 * Uma unica passada O(n) sobre `transactions`: o cruzamento
 * `categoria x competencia` e acumulado em mapa e so depois percorrido, nao ha
 * varredura por categoria dentro de laco de mes.
 *
 * Conta apenas `kind === 'expense'` — transferencia, pagamento de fatura e
 * aporte nao sao gasto de consumo (RC-03/RC-04). O valor de cada mes e a saida
 * liquida `max(0, -liquido)`: categoria cujo mes so teve estorno da zero, nao
 * "gasto" (mesma regra de sinal do `monthlyKpis`). Lancamento sem categoria
 * (`categoryId === null`) fica fora: ele alimenta a fila de nao categorizados,
 * nao o grafico.
 *
 * Quais categorias saem: as que tiveram gasto no mes OU em qualquer um dos 3
 * anteriores. Zerada nos quatro fica fora. Categoria que sumiu e sinal, nao
 * ausencia — `spentCents: 0` com `average3mCents` alto e o que a familia precisa
 * ver.
 *
 * A ordem de saida e a ordem de `categories`; quem desenha o grafico ordena
 * como quiser.
 *
 * `categoryId` que nao esta em `categories` e descartado, porque sem a entrada
 * correspondente nao ha nome nem natureza para publicar.
 */
export function spendingByCategory(
  input: SpendingByCategoryInput,
): CategorySpending[] {
  const current = input.competence;
  const window: Competence[] = [
    addCompetence(current, -3),
    addCompetence(current, -2),
    addCompetence(current, -1),
    current,
  ];
  const inWindow = new Set(window);

  // categoria -> competencia -> soma COM sinal (piso em zero so no fim).
  const buckets = new Map<string, Map<Competence, Cents>>();
  for (const transaction of input.transactions) {
    if (transaction.kind !== 'expense') continue;
    if (transaction.categoryId === null) continue;
    if (!inWindow.has(transaction.competence)) continue;

    const perMonth =
      buckets.get(transaction.categoryId) ?? new Map<Competence, Cents>();
    perMonth.set(
      transaction.competence,
      addCents(
        perMonth.get(transaction.competence) ?? zero(),
        cents(transaction.amountCents),
      ),
    );
    buckets.set(transaction.categoryId, perMonth);
  }

  const result: CategorySpending[] = [];
  for (const category of input.categories) {
    const perMonth = buckets.get(category.id) ?? new Map<Competence, Cents>();
    // Saida liquida de cada mes: estorno puro da zero, nao "gasto".
    const monthly = window.map((competence) =>
      netOutflow(perMonth.get(competence) ?? zero()),
    );
    const currentSpent = monthly[monthly.length - 1] ?? zero();
    const previous = monthly.slice(0, monthly.length - 1); // os 3 anteriores
    const previousTotal = addCents(...previous);

    const hasActivity = monthly.some((value) => value !== 0);
    if (!hasActivity) continue;

    const average3mCents = divideRound(previousTotal, AVERAGE_WINDOW);

    result.push({
      categoryId: category.id,
      name: category.name,
      nature: category.nature,
      spentCents: currentSpent,
      average3mCents,
      variationBp:
        average3mCents === 0
          ? null
          : ratioBasisPoints(
              addCents(currentSpent, cents(-average3mCents)),
              average3mCents,
            ),
    });
  }

  return result;
}

export interface DivergentStatementInput {
  statementId: string;
  reportedTotalCents: Cents | null;
  transactions: { amountCents: Cents }[];
}

export interface DivergentStatement {
  statementId: string;
  /** `computedTotal - reportedTotal` (CONTRACTS §3). */
  differenceCents: Cents;
}

/**
 * Faturas cujo total informado nao bate com a soma dos lancamentos
 * (CONTRACTS §14). Alimenta a fila de pendencias do dashboard.
 *
 * Reusa `reconcileStatement` de `billing.ts` — a conferencia e a mesma da
 * importacao, com o sinal ja documentado la. Fatura sem total informado
 * (`reportedTotalCents === null`) nao tem o que conferir e fica fora; diferenca
 * exatamente zero nao e divergencia e tambem fica fora. Preserva a ordem de
 * entrada.
 */
export function divergentStatements(
  statements: DivergentStatementInput[],
): DivergentStatement[] {
  const result: DivergentStatement[] = [];
  for (const statement of statements) {
    if (statement.reportedTotalCents === null) continue;
    const { differenceCents } = reconcileStatement({
      reportedTotal: statement.reportedTotalCents,
      transactions: statement.transactions,
    });
    if (differenceCents !== 0) {
      result.push({ statementId: statement.statementId, differenceCents });
    }
  }
  return result;
}
