/**
 * Planejador de renda passiva — CONTRACTS §12, formulas de SPEC §5.6.
 *
 * Modulo puro (CONVENTIONS §5): recebe dados, devolve dados, sem I/O e sem
 * relogio. A competencia de partida (`fromCompetence`) entra por parametro e a
 * aritmetica de calendario e de `lib/date`.
 *
 * ## Tudo em valores REAIS
 *
 * Retorno e retirada sao taxas reais (ja descontada a inflacao), e por isso todo
 * valor que sai daqui esta em "R$ de hoje" (RF-INV-01). Nenhuma funcao deste
 * modulo aplica inflacao.
 *
 * ## Notacao (a mesma de SPEC §5.6)
 *
 *   R  = renda passiva mensal desejada       r = retorno real anual (bp / 10_000)
 *   P0 = patrimonio atual                    w = retirada real anual (bp / 10_000)
 *   A  = aporte mensal                       n = meses
 *   i  = (1 + r)^(1/12) - 1                  g = (1 + i)^n = (1 + r)^(n/12)
 *
 * `i` e SEMPRE a raiz 12 de (1 + r). `r / 12` e taxa nominal, nao equivalente:
 * a 5 % a.a. ela da 0,4167 % a.m. em vez de 0,4074 % e superestima o patrimonio
 * em 20 anos. CONVENTIONS §3 chama isso de bug, e o teste o reprova.
 *
 * `g` e calculado como `(1 + r)^(n/12)`, que e a MESMA quantidade que
 * `(1 + i)^n` (identidade algebrica), com uma potencia a menos de erro de ponto
 * flutuante. Para n multiplo de 12 isso e a capitalizacao anual exata.
 *
 * ## Aporte no FIM do mes
 *
 * `FV(n) = P0*g + A*(g - 1)/i` e a anuidade postecipada: o aporte do mes k entra
 * no fim do mes k e nao rende nada nele. `FV(0) = P0`; `FV(1) = P0*(1+i) + A`.
 *
 * ## Arredondamento — a regra, e onde ela vive
 *
 * As contas com juro composto rodam em `number` de ponto flutuante: potencia e
 * logaritmo nao existem em inteiro, e nao ha como fazer juro composto em
 * centavos sem arredondar a cada mes. O que CONVENTIONS §2 proibe e dinheiro em
 * float NA FRONTEIRA — e nenhum valor sai daqui sem virar `Cents`.
 *
 * Ha DOIS tipos de resultado, e cada um tem uma regra aplicada em UM ponto:
 *
 * 1. ESTADO (quanto ha / quanto rende): `futureValue`, `targetPortfolio`,
 *    `projectedMonthlyIncome`, cada ponto da curva, e `surplusUsageBp`.
 *    Regra: centavo (ou bp) MAIS PROXIMO, meio se afasta do zero
 *    (1,5 -> 2; 4,5 -> 5; -1,5 -> -2). A mesma de `applyRate` em lib/money.
 *    Duas execucoes da MESMA regra, uma por natureza do numero:
 *    - razao exata entre inteiros (`targetPortfolio`, `projectedMonthlyIncome`,
 *      `surplusUsageBp`): divisao em `bigint` em `divideRounded`. Nada de
 *      `bp / 10_000` em float aqui: o empate exato k + 0,5 as vezes vira
 *      k + 0,4999... em float e arredonda para baixo (laudo T-301, A2:
 *      R = 187 c, w = 1.408 bp da 15.937,5 exato).
 *    - resultado de potencia (`futureValue` e a curva): `roundFloat`, sobre o
 *      valor nao arredondado de `futureValueRaw`.
 *
 * 2. REQUISITO (o minimo que atinge): `requiredContribution` e `monthsToTarget`.
 *    Regra: o MENOR inteiro (centavo de aporte, mes) que faz o valor futuro NAO
 *    ARREDONDADO alcancar o alvo. E arredondar para CIMA o resultado da formula
 *    fechada — arredondar para o mais proximo poderia devolver um aporte que
 *    fica a centavos da meta, ou um mes em que a meta ainda nao chegou.
 *    Ponto unico: `smallestReaching`.
 *
 * Nada e arredondado no meio de uma serie: cada ponto da curva e o `FV(n)`
 * fechado a partir de P0, nunca o ponto anterior arredondado vezes (1 + i). Em
 * 240 meses, arredondar a cada passo acumularia ate 240 meios centavos.
 *
 * ## Dominio das entradas (fixado pelo Orquestrador na revisao do T-301)
 *
 * Fora dele a funcao LANCA `RangeError` com mensagem em portugues: entrada fora
 * do dominio e erro de validacao de quem chamou, e um numero devolvido a partir
 * dela seria enganoso (laudo A1: aporte negativo dava "viavel" ao lado de renda
 * projetada negativa).
 *
 * - Patrimonio (`p0`, `currentPortfolio`, `portfolio`) e alvo: `>= 0`, em todas
 *   as funcoes que os recebem. Patrimonio negativo seria divida, e divida nao e
 *   assunto do planejador.
 * - Aporte mensal (`monthlyContribution`, `currentMonthlyContribution`): `>= 0`.
 *   Aporte e o que a familia POE; saque nao e aporte.
 * - Retorno anual: `> -100 %` (`1 + r <= 0` nao tem raiz 12 real). Pode ser
 *   negativo acima disso.
 * - Prazo em meses: inteiro, `0 <= n <= 1.200` (100 anos); `>= 1` em
 *   `requiredContribution`. Horizonte em anos: inteiro, `1 <= anos <= 100`. O
 *   teto existe porque `1,07^(1.000.000/12)` estoura para `Infinity` em float, e
 *   nenhum plano de familia passa de um seculo. `monthsToTarget` NAO tem teto:
 *   ele devolve a resposta verdadeira, mesmo que seja "830 anos", e a tela
 *   decide como mostrar (nota do laudo A4 para o T-303).
 * - Renda desejada (`targetPortfolio`, `scenarioTable`): `>= 0`. Renda 0 da
 *   alvo 0. A renda negativa e checada ANTES de `w`: com renda negativa a
 *   funcao lanca mesmo que `w <= 0` (que, com renda valida, continua `null`).
 * - Taxa de retirada em `projectedMonthlyIncome`: `>= 0`. `w = 0` e valido e da
 *   renda 0; `w < 0` lanca (retirada negativa seria aporte disfarcado).
 * - Aporte exigido em `contributionFeasibility`: `>= 0`.
 *
 * ## `null` (tabela "Quando cada `null` acontece" de CONTRACTS §12)
 *
 * - `targetPortfolio`: `withdrawalBp <= 0`.
 * - `monthsToTarget`: a curva nunca cruza o alvo. Com `i != 0`, vale
 *   `FV(n) = K*g - A/i` com `K = (P0*i + A)/i`; a formula exige
 *   `(T*i + A) > 0` E `(P0*i + A) > 0`. Com `i > 0` isso e "o aporte mais o
 *   rendimento de P0 e positivo" (SPEC: `A + P0*i <= 0` e inalcancavel). Com
 *   `i < 0` o patrimonio converge para a assintota `-A/i`, e e alcancavel so
 *   se ela fica acima do alvo — que e `T*i + A > 0`. Com `i = 0`: `A <= 0`.
 *   Nunca `NaN`, `Infinity` ou numero grande no lugar do infinito.
 */

import { addCompetence, type Competence } from '@/lib/date';
import { basisPoints, bpToDecimal, cents, type BasisPoints, type Cents } from '@/lib/money';

export interface ScenarioParams {
  label: 'conservative' | 'moderate' | 'optimistic';
  realReturnBp: BasisPoints;
  withdrawalBp: BasisPoints;
}

/** Horizontes da tela (SPEC §5.6): aporte necessario em 5, 10, 15 e 20 anos. */
export const DEFAULT_HORIZONS_YEARS: readonly number[] = [5, 10, 15, 20];

const MONTHS_PER_YEAR = 12;

/**
 * Folga de comparacao "o valor futuro alcancou o alvo", em centavos.
 *
 * Um milionesimo de centavo: existe so para que uma resposta EXATA (aporte de
 * R$ 10,00 que fecha o alvo no centavo) nao vire 1 centavo ou 1 mes a mais
 * porque `pow` errou na 16a casa. Nao muda nenhuma resposta que nao esteja a
 * menos de 1e-6 centavo da fronteira.
 */
const REACH_EPSILON_CENTS = 1e-6;

/** Basis points em 100 %, como `bigint` para as razoes exatas. */
const BP_SCALE = 10_000n;

/** Teto de prazo: 100 anos. Ver "Dominio das entradas" no cabecalho. */
const MAX_MONTHS = 1_200;
const MAX_YEARS = MAX_MONTHS / MONTHS_PER_YEAR;

/**
 * Regra de estado, execucao em FLOAT (resultado de potencia): inteiro mais
 * proximo, meio se afasta do zero. `Math.round` sozinho arredonda -1,5 para -1
 * (meio vai para +infinito), entao o sinal e tratado a parte.
 */
function roundFloat(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/**
 * Regra de estado, execucao EXATA: `numerator / denominator` em `bigint`,
 * inteiro mais proximo, meio se afasta do zero — o mesmo algoritmo de
 * `applyRate`. `denominator` e sempre positivo aqui (quem chama garante).
 */
function divideRounded(numerator: bigint, denominator: bigint): number {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const rounded = (2n * magnitude + denominator) / (2n * denominator);
  return Number(negative ? -rounded : rounded);
}

/** Meses: inteiro em [min, 1.200]. Fracao de mes nao existe num plano de aporte mensal. */
function assertMonths(months: number, min: number, name: string): void {
  if (!Number.isSafeInteger(months) || months < min) {
    throw new RangeError(
      `${name} deve ser inteiro >= ${String(min)}; recebido: ${String(months)}.`,
    );
  }
  if (months > MAX_MONTHS) {
    throw new RangeError(
      `${name} de ${String(months)} meses passa do limite de ${String(MAX_MONTHS)} meses (${String(MAX_YEARS)} anos).`,
    );
  }
}

/** Patrimonio, alvo e aporte sao quantias que a familia tem ou poe: negativo e erro de quem chamou. */
function assertNonNegative(value: Cents, name: string): void {
  if (cents(value) < 0) {
    throw new RangeError(`${name} nao pode ser negativo; recebido: ${String(value)} centavos.`);
  }
}

/** `r` decimal, recusando retorno de -100 % ou pior (1 + r <= 0 nao tem raiz real). */
function annualDecimal(annualBp: BasisPoints): number {
  const r = bpToDecimal(annualBp);
  if (r <= -1) {
    throw new RangeError(
      `Retorno anual deve ser maior que -100 %; recebido: ${String(annualBp)} bp.`,
    );
  }
  return r;
}

/** `g = (1 + r)^(n/12)`, identico a `(1 + i)^n` — ver o cabecalho. */
function growthFactor(annualBp: BasisPoints, months: number): number {
  return Math.pow(1 + annualDecimal(annualBp), months / MONTHS_PER_YEAR);
}

/**
 * FV(n) SEM arredondar. Todo resultado do modulo deriva daqui; so a fronteira
 * arredonda. `i = 0` cai no limite da formula: `P0 + A*n`.
 */
function futureValueRaw(p0: number, a: number, annualBp: BasisPoints, months: number): number {
  const i = monthlyRate(annualBp);
  if (i === 0) return p0 + a * months;
  const g = growthFactor(annualBp, months);
  return p0 * g + (a * (g - 1)) / i;
}

/**
 * O UNICO arredondamento de requisito: o menor inteiro `k >= 0` com
 * `reaches(k)`, partindo da estimativa da formula fechada.
 *
 * `reaches` e monotona (mais aporte ou mais meses nunca afastam da meta nos
 * casos em que este modulo a chama), e a estimativa erra por float em no
 * maximo um passo — os dois lacos andam 0 ou 1 vez na pratica. Eles existem
 * para que a resposta seja definida pelo criterio, e nao pela 16a casa do `pow`.
 */
function smallestReaching(estimate: number, reaches: (k: number) => boolean): number {
  let k = Math.max(0, Math.ceil(estimate));
  while (k > 0 && reaches(k - 1)) k -= 1;
  while (!reaches(k)) k += 1;
  return k;
}

/**
 * Patrimonio-alvo para viver de `R` por mes retirando `w` ao ano, perpetuamente
 * em termos reais: `(R * 12) / w`. `null` quando `w <= 0` (alvo infinito).
 */
export function targetPortfolio(
  desiredMonthlyIncome: Cents,
  withdrawalBp: BasisPoints,
): Cents | null {
  assertNonNegative(desiredMonthlyIncome, 'Renda desejada');
  const income = BigInt(cents(desiredMonthlyIncome));
  const w = BigInt(basisPoints(withdrawalBp));
  if (w <= 0n) return null;
  // R * 12 / (w / 10_000) = R * 12 * 10_000 / w, exato em bigint.
  return cents(divideRounded(income * BigInt(MONTHS_PER_YEAR) * BP_SCALE, w));
}

/** Taxa mensal equivalente: `(1 + r)^(1/12) - 1`. Jamais `r / 12`. */
export function monthlyRate(annualBp: BasisPoints): number {
  return Math.pow(1 + annualDecimal(annualBp), 1 / MONTHS_PER_YEAR) - 1;
}

/** `P0*(1+i)^n + A*((1+i)^n - 1)/i`; com `i = 0`, `P0 + A*n`. Aporte no fim do mes. */
export function futureValue(
  p0: Cents,
  monthlyContribution: Cents,
  annualBp: BasisPoints,
  months: number,
): Cents {
  assertNonNegative(p0, 'Patrimonio atual');
  assertNonNegative(monthlyContribution, 'Aporte mensal');
  assertMonths(months, 0, 'Prazo em meses');
  return cents(roundFloat(futureValueRaw(p0, monthlyContribution, annualBp, months)));
}

/**
 * Menor numero INTEIRO de meses `n` com `FV(n) >= target`, ou `null` quando a
 * curva nunca cruza o alvo. 0 quando `p0` ja basta.
 *
 * A formula `ln((T*i + A)/(P0*i + A)) / ln(1 + i)` da o instante fracionario do
 * cruzamento; como o aporte e mensal, a meta e atingida no fim do mes seguinte
 * a ele — `ceil` da formula, via `smallestReaching`.
 */
export function monthsToTarget(
  target: Cents,
  p0: Cents,
  monthlyContribution: Cents,
  annualBp: BasisPoints,
): number | null {
  assertNonNegative(target, 'Alvo');
  assertNonNegative(p0, 'Patrimonio atual');
  assertNonNegative(monthlyContribution, 'Aporte mensal');
  const t = cents(target);
  const start = cents(p0);
  const a = cents(monthlyContribution);
  if (start >= t) return 0;

  const reaches = (n: number) =>
    futureValueRaw(start, a, annualBp, n) >= t - REACH_EPSILON_CENTS;

  const i = monthlyRate(annualBp);
  let estimate: number;
  if (i === 0) {
    if (a <= 0) return null;
    estimate = (t - start) / a;
  } else {
    const numerator = t * i + a;
    const denominator = start * i + a;
    if (numerator <= 0 || denominator <= 0) return null;
    // ln(1 + i) = ln(1 + r) / 12, sem passar pelo `i` ja arredondado em float.
    estimate =
      Math.log(numerator / denominator) /
      (Math.log1p(annualDecimal(annualBp)) / MONTHS_PER_YEAR);
  }
  // Finito mas fora do inteiro seguro nao tem mes representavel: nao e resposta.
  if (!Number.isFinite(estimate) || estimate > Number.MAX_SAFE_INTEGER) return null;
  return smallestReaching(estimate, reaches);
}

/**
 * Menor aporte mensal, em centavos inteiros, com `FV(months) >= target`:
 * `(T - P0*(1+i)^n) * i / ((1+i)^n - 1)` arredondado para cima; com `i = 0`,
 * `(T - P0) / n`. 0 quando `p0` sozinho (rendendo) ja atinge o alvo no prazo.
 *
 * Sempre existe resposta para `months >= 1`: o valor futuro cresce com o aporte
 * em qualquer taxa (o coeficiente `(g - 1)/i` e positivo). `months = 0` lanca —
 * com prazo zero nao ha aporte que mude nada, e o contrato nao tem `null` aqui.
 */
export function requiredContribution(
  target: Cents,
  p0: Cents,
  annualBp: BasisPoints,
  months: number,
): Cents {
  assertNonNegative(target, 'Alvo');
  assertNonNegative(p0, 'Patrimonio atual');
  assertMonths(months, 1, 'Prazo em meses');
  const t = cents(target);
  const start = cents(p0);

  const reaches = (a: number) =>
    futureValueRaw(start, a, annualBp, months) >= t - REACH_EPSILON_CENTS;
  if (reaches(0)) return cents(0);

  const i = monthlyRate(annualBp);
  let estimate: number;
  if (i === 0) {
    estimate = (t - start) / months;
  } else {
    const g = growthFactor(annualBp, months);
    estimate = ((t - start * g) * i) / (g - 1);
  }
  return cents(smallestReaching(estimate, reaches));
}

/** Renda mensal que um patrimonio paga retirando `w` ao ano: `FV * w / 12`. */
export function projectedMonthlyIncome(portfolio: Cents, withdrawalBp: BasisPoints): Cents {
  assertNonNegative(portfolio, 'Patrimonio');
  if (basisPoints(withdrawalBp) < 0) {
    throw new RangeError(
      `Taxa de retirada nao pode ser negativa; recebido: ${String(withdrawalBp)} bp.`,
    );
  }
  // FV * (w / 10_000) / 12 = FV * w / 120_000, exato em bigint.
  return cents(
    divideRounded(
      BigInt(portfolio) * BigInt(basisPoints(withdrawalBp)),
      BigInt(MONTHS_PER_YEAR) * BP_SCALE,
    ),
  );
}

/**
 * Curva de acumulacao: `months + 1` pontos, de `competenceOffset = 0` (a propria
 * `fromCompetence`, com `P0` e nenhum aporte) ate `months`. O ponto `n` e o
 * patrimonio no FIM da competencia `fromCompetence + n`, depois de `n` aportes.
 *
 * `month` e `competenceOffset` sao o mesmo numero `n` (o contrato expoe os dois).
 * `passiveIncomeCents` e `projectedMonthlyIncome` do `portfolioCents` exibido no
 * mesmo ponto, para que a tela nunca mostre um par incoerente.
 */
export function accumulationCurve(input: {
  p0: Cents;
  monthlyContribution: Cents;
  annualBp: BasisPoints;
  months: number;
  withdrawalBp: BasisPoints;
  fromCompetence: Competence;
}): {
  month: number;
  competenceOffset: number;
  competence: Competence;
  portfolioCents: Cents;
  passiveIncomeCents: Cents;
}[] {
  assertMonths(input.months, 0, 'Quantidade de meses');
  const withdrawal = basisPoints(input.withdrawalBp);

  const curve: {
    month: number;
    competenceOffset: number;
    competence: Competence;
    portfolioCents: Cents;
    passiveIncomeCents: Cents;
  }[] = [];
  for (let n = 0; n <= input.months; n += 1) {
    // FV fechado a partir de P0 em cada ponto: nada de iterar sobre o anterior.
    const portfolioCents = futureValue(input.p0, input.monthlyContribution, input.annualBp, n);
    curve.push({
      month: n,
      competenceOffset: n,
      competence: addCompetence(input.fromCompetence, n),
      portfolioCents,
      passiveIncomeCents: projectedMonthlyIncome(portfolioCents, withdrawal),
    });
  }
  return curve;
}

/**
 * A tabela da tela: uma linha por cenario.
 *
 * Decisoes que o contrato nao fixava (registradas no relatorio do T-301):
 *
 * - Cenario com `withdrawalBp <= 0` LANCA. A linha tem `targetPortfolioCents:
 *   Cents` (sem `null`), e alvo infinito nao cabe nela. Cenario assim e erro de
 *   validacao de quem gravou a premissa, nao estado que a tela deva desenhar.
 * - `projectedIncomeWithCurrentPlanCents`: renda que o plano ATUAL (P0 + aporte
 *   atual) paga ao fim do MAIOR horizonte de `horizonsYears`. Lista vazia: a
 *   renda de hoje, sobre P0.
 * - `feasible`: o aporte atual atinge o alvo DENTRO do maior horizonte
 *   (`monthsWithCurrentContribution !== null` e `<= maior horizonte * 12`).
 *   "Alcancavel algum dia" nao serve: com qualquer aporte positivo e retorno
 *   positivo a meta chega, nem que seja em 90 anos.
 * - `fromCompetence` e validada, mas nenhum campo da linha depende dela: a
 *   ancora existe para a curva que a tela desenha ao lado.
 */
export function scenarioTable(input: {
  desiredMonthlyIncome: Cents;
  currentPortfolio: Cents;
  currentMonthlyContribution: Cents;
  scenarios: ScenarioParams[];
  horizonsYears: number[];
  fromCompetence: Competence;
}): {
  label: ScenarioParams['label'];
  targetPortfolioCents: Cents;
  monthsWithCurrentContribution: number | null;
  requiredByHorizon: { years: number; contributionCents: Cents }[];
  projectedIncomeWithCurrentPlanCents: Cents;
  feasible: boolean;
}[] {
  // Lanca se a ancora nao e uma competencia valida.
  addCompetence(input.fromCompetence, 0);
  // Validados aqui, e nao so dentro de cada cenario, para que uma lista de
  // cenarios vazia nao deixe entrada invalida passar calada.
  assertNonNegative(input.desiredMonthlyIncome, 'Renda desejada');
  assertNonNegative(input.currentPortfolio, 'Patrimonio atual');
  assertNonNegative(input.currentMonthlyContribution, 'Aporte atual');
  for (const years of input.horizonsYears) {
    if (!Number.isSafeInteger(years) || years < 1 || years > MAX_YEARS) {
      throw new RangeError(
        `Horizonte deve ser um numero inteiro de anos entre 1 e ${String(MAX_YEARS)}; recebido: ${String(years)}.`,
      );
    }
  }
  const longestHorizonMonths = Math.max(0, ...input.horizonsYears) * MONTHS_PER_YEAR;

  return input.scenarios.map((scenario) => {
    const target = targetPortfolio(input.desiredMonthlyIncome, scenario.withdrawalBp);
    if (target === null) {
      throw new RangeError(
        `Cenario ${scenario.label} sem taxa de retirada positiva (${String(scenario.withdrawalBp)} bp): nao existe patrimonio-alvo.`,
      );
    }

    const monthsWithCurrentContribution = monthsToTarget(
      target,
      input.currentPortfolio,
      input.currentMonthlyContribution,
      scenario.realReturnBp,
    );

    const requiredByHorizon = input.horizonsYears.map((years) => ({
      years,
      contributionCents: requiredContribution(
        target,
        input.currentPortfolio,
        scenario.realReturnBp,
        years * MONTHS_PER_YEAR,
      ),
    }));

    const portfolioAtLongestHorizon = futureValue(
      input.currentPortfolio,
      input.currentMonthlyContribution,
      scenario.realReturnBp,
      longestHorizonMonths,
    );

    return {
      label: scenario.label,
      targetPortfolioCents: target,
      monthsWithCurrentContribution,
      requiredByHorizon,
      projectedIncomeWithCurrentPlanCents: projectedMonthlyIncome(
        portfolioAtLongestHorizon,
        scenario.withdrawalBp,
      ),
      feasible:
        monthsWithCurrentContribution !== null &&
        monthsWithCurrentContribution <= longestHorizonMonths,
    };
  });
}

/**
 * RF-INV-05: o aporte que a meta exige cabe na sobra real do orcamento?
 *
 * - `gapCents`: quanto FALTA, nunca negativo — `max(0, exigido - sobra)`, com
 *   sobra negativa contando como zero (deficit nao financia aporte). 0 quando
 *   cabe.
 * - `feasible`: `gapCents === 0`. Aporte exigido 0 e sempre viavel, mesmo com
 *   sobra negativa: a meta nao pede nada.
 * - `surplusUsageBp`: fracao da sobra que o aporte consome, em bp pela regra de
 *   estado (pode passar de 10_000). `null` quando a sobra e `<= 0`.
 */
export function contributionFeasibility(input: {
  requiredContributionCents: Cents;
  averageMonthlySurplusCents: Cents;
}): { gapCents: Cents; feasible: boolean; surplusUsageBp: BasisPoints | null } {
  assertNonNegative(input.requiredContributionCents, 'Aporte exigido');
  const required = cents(input.requiredContributionCents);
  const surplus = cents(input.averageMonthlySurplusCents);

  const gapCents = cents(Math.max(0, required - Math.max(0, surplus)));
  return {
    gapCents,
    feasible: gapCents === 0,
    surplusUsageBp:
      surplus <= 0
        ? null
        : basisPoints(divideRounded(BigInt(required) * BP_SCALE, BigInt(surplus))),
  };
}
