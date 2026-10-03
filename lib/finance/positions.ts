/**
 * Posicoes reais de investimento — T-404, parte pura (`.notas/contrato-t404.md`,
 * decisoes D3, D5 e D6, com P1-P3 aprovados pelo Orquestrador em 2026-10-03).
 *
 * Responde duas perguntas:
 *
 * 1. "Estou aportando o que planejei?" — `contributionAdherence`.
 * 2. "Meu patrimonio real esta na curva?" — `portfolioVsProjection`.
 *
 * Modulo puro (CONVENTIONS §5): sem I/O, sem relogio. O mes corrente e a
 * competencia de inicio do plano entram por parametro; competencia e data sao
 * lidas so por `lib/date`.
 *
 * ## Sinais
 *
 * `actualCents` e o aporte efetivo do mes como MAGNITUDE (>= 0): quanto a
 * familia pos. No banco o lancamento `investment_contribution` e saida de caixa,
 * portanto NEGATIVO (CONVENTIONS §2). Quem monta o input inverte o sinal da
 * soma. Valor negativo aqui LANCA em vez de virar aderencia negativa em
 * silencio: e o sinal esquecido, nao um mes ruim.
 *
 * `diffCents` = real - projetado: positivo e "a frente da curva".
 *
 * ## Arredondamento
 *
 * Razoes em bp (`adherenceBp`, `averageAdherenceBp`, `diffBp`) sao divisoes de
 * inteiros, feitas em `bigint` por `divideRounded`: bp mais proximo, meio se
 * afasta do zero (a regra de `applyRate` e de `lib/finance/investment`). Os
 * centavos nao sao arredondados: sao somas e diferencas de inteiros.
 */

import { diffMonths, toCompetence, type Competence, type IsoDate } from '@/lib/date';
import type { accumulationCurve, ScenarioParams } from '@/lib/finance/investment';
import { addCents, basisPoints, cents, type BasisPoints, type Cents } from '@/lib/money';

/** Basis points em 100 %. */
const BP_SCALE = 10_000n;

/** Um ponto da saida de `accumulationCurve` (CONTRACTS §12). */
export type CurvePoint = ReturnType<typeof accumulationCurve>[number];

/**
 * `numerator / denominator` em `bigint`, inteiro mais proximo, meio se afasta
 * do zero. `denominator > 0` (quem chama garante).
 *
 * Copia do helper privado de `lib/finance/investment.ts`: a posse deste T-404 e
 * so `positions*`, e o helper la nao e exportado. Se um terceiro modulo
 * precisar, o lugar dele e `lib/money`.
 */
function divideRounded(numerator: bigint, denominator: bigint): number {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const rounded = (2n * magnitude + denominator) / (2n * denominator);
  return Number(negative ? -rounded : rounded);
}

function assertNonNegative(value: Cents, name: string): void {
  if (cents(value) < 0) {
    throw new RangeError(`${name} nao pode ser negativo; recebido: ${String(value)} centavos.`);
  }
}

/** `part / whole` em bp; `null` quando `whole` e 0 (razao sem sentido). */
function ratioBp(part: number, whole: number): BasisPoints | null {
  if (whole === 0) return null;
  return basisPoints(divideRounded(BigInt(part) * BP_SCALE, BigInt(whole)));
}

/**
 * Aderencia do aporte efetivo ao planejado, mes a mes (D5, D6).
 *
 * - `months` e a janela que quem chama montou (D5: 12 meses fechados + o
 *   corrente; mes sem aporte entra com 0). A funcao nao completa nem corta a
 *   janela: devolve o que recebeu, ordenado por competencia.
 * - `inProgress`: `competence === currentCompetence`. Mes POSTERIOR ao corrente
 *   lanca (aporte no futuro e erro de quem montou a janela). Competencia
 *   repetida lanca.
 * - `adherenceBp` = efetivo / planejado em bp; `null` com planejado 0.
 * - `belowPlan` = efetivo < planejado; sempre `false` com planejado 0. Vale
 *   tambem para o mes em andamento — e a tela que le `inProgress` e decide se o
 *   "abaixo" de um mes pela metade merece alerta.
 * - `summary` olha so os meses FECHADOS (`inProgress = false`):
 *   `averageAdherenceBp` = soma(efetivo) / (planejado * n), que e a media das
 *   aderencias mensais porque o planejado e o mesmo em todo mes, mas sem somar
 *   bp ja arredondados. `null` com planejado 0 ou sem mes fechado.
 */
export function contributionAdherence(input: {
  months: { competence: Competence; actualCents: Cents }[];
  plannedMonthlyCents: Cents;
  currentCompetence: Competence;
}): {
  months: {
    competence: Competence;
    actualCents: Cents;
    plannedCents: Cents;
    adherenceBp: BasisPoints | null;
    belowPlan: boolean;
    inProgress: boolean;
  }[];
  summary: { closedMonths: number; averageAdherenceBp: BasisPoints | null; monthsBelowPlan: number };
} {
  assertNonNegative(input.plannedMonthlyCents, 'Aporte planejado');
  const planned = cents(input.plannedMonthlyCents);

  const seen = new Set<Competence>();
  for (const month of input.months) {
    assertNonNegative(month.actualCents, `Aporte efetivo de ${month.competence}`);
    // diffMonths valida o formato das duas competencias.
    if (diffMonths(month.competence, input.currentCompetence) > 0) {
      throw new RangeError(
        `Competencia ${month.competence} e posterior ao mes corrente ${input.currentCompetence}.`,
      );
    }
    if (seen.has(month.competence)) {
      throw new RangeError(`Competencia repetida na janela de aportes: ${month.competence}.`);
    }
    seen.add(month.competence);
  }

  const months = [...input.months]
    .sort((a, b) => diffMonths(a.competence, b.competence))
    .map((month) => ({
      competence: month.competence,
      actualCents: cents(month.actualCents),
      plannedCents: planned,
      adherenceBp: ratioBp(month.actualCents, planned),
      belowPlan: planned > 0 && month.actualCents < planned,
      inProgress: month.competence === input.currentCompetence,
    }));

  const closed = months.filter((month) => !month.inProgress);
  const closedActual = addCents(...closed.map((month) => month.actualCents));
  return {
    months,
    summary: {
      closedMonths: closed.length,
      averageAdherenceBp: ratioBp(closedActual, planned * closed.length),
      monthsBelowPlan: closed.filter((month) => month.belowPlan).length,
    },
  };
}

/**
 * Patrimonio real registrado contra a curva projetada de cada cenario (D3).
 *
 * - Cada registro e comparado com o ponto da curva na competencia
 *   `toCompetence(asOf)`. O ponto da curva e o patrimonio no FIM daquele mes
 *   (aporte no fim do mes, ver `accumulationCurve`), entao um registro do dia 5
 *   e comparado com o fim do mes: no meio do mes o real tende a parecer um
 *   pouco atras. SIMPLIFICACAO aceita (P3), nao interpolacao.
 * - `status`:
 *   - `'before_plan'`: competencia anterior a `planStartCompetence`. Registro
 *     mostrado, sem comparacao: `projectedCents`, `diffCents`, `diffBp` `null`.
 *   - `'beyond_curve'`: competencia depois do ultimo ponto da curva. Idem.
 *   - `'compared'`: os tres preenchidos (`diffBp` `null` so com projetado 0).
 * - `diffBp` = (real - projetado) / projetado em bp.
 * - Toda curva tem de comecar em `planStartCompetence` (D3) e todas tem de ter
 *   o mesmo comprimento — saem do mesmo plano; divergir e erro de montagem e
 *   lanca. Label repetido lanca. `byScenario` segue a ordem de `curves`.
 * - Saida ordenada por `asOf`. Data repetida lanca (o banco tem
 *   `unique (household_id, as_of)`).
 */
export function portfolioVsProjection(input: {
  snapshots: { asOf: IsoDate; portfolioCents: Cents }[];
  curves: { label: ScenarioParams['label']; points: CurvePoint[] }[];
  planStartCompetence: Competence;
}): {
  asOf: IsoDate;
  competence: Competence;
  portfolioCents: Cents;
  status: 'compared' | 'before_plan' | 'beyond_curve';
  byScenario: {
    label: ScenarioParams['label'];
    projectedCents: Cents | null;
    diffCents: Cents | null;
    diffBp: BasisPoints | null;
  }[];
}[] {
  const labels = new Set<string>();
  let curveLength: number | null = null;
  for (const curve of input.curves) {
    if (labels.has(curve.label)) {
      throw new RangeError(`Cenario repetido nas curvas: ${curve.label}.`);
    }
    labels.add(curve.label);
    const first = curve.points[0];
    if (first === undefined || first.competence !== input.planStartCompetence) {
      throw new RangeError(
        `Curva ${curve.label} deve comecar em ${input.planStartCompetence}; comeca em ${first?.competence ?? '(vazia)'}.`,
      );
    }
    curveLength ??= curve.points.length;
    if (curve.points.length !== curveLength) {
      throw new RangeError(
        `Curvas com comprimentos diferentes: ${curve.label} tem ${String(curve.points.length)} pontos, esperado ${String(curveLength)}.`,
      );
    }
  }

  const dates = new Set<IsoDate>();
  for (const snapshot of input.snapshots) {
    assertNonNegative(snapshot.portfolioCents, `Posicao de ${snapshot.asOf}`);
    if (dates.has(snapshot.asOf)) {
      throw new RangeError(`Posicao repetida na data ${snapshot.asOf}.`);
    }
    dates.add(snapshot.asOf);
  }

  // Ordem por competencia e, dentro dela, pelo dia: 'YYYY-MM-DD' ja validado por
  // toCompetence compara certo como texto.
  const ordered = input.snapshots
    .map((snapshot) => ({ ...snapshot, competence: toCompetence(snapshot.asOf) }))
    .sort((a, b) => diffMonths(a.competence, b.competence) || (a.asOf < b.asOf ? -1 : 1));

  return ordered.map((snapshot) => {
    const offset = diffMonths(snapshot.competence, input.planStartCompetence);
    const status: 'compared' | 'before_plan' | 'beyond_curve' =
      offset < 0 ? 'before_plan' : offset >= (curveLength ?? 0) ? 'beyond_curve' : 'compared';

    const byScenario = input.curves.map((curve) => {
      const point = status === 'compared' ? curve.points[offset] : undefined;
      if (point === undefined) {
        return { label: curve.label, projectedCents: null, diffCents: null, diffBp: null };
      }
      if (point.competence !== snapshot.competence) {
        throw new RangeError(
          `Curva ${curve.label} fora de sequencia: ponto ${String(offset)} e ${point.competence}, esperado ${snapshot.competence}.`,
        );
      }
      const diff = cents(snapshot.portfolioCents - point.portfolioCents);
      return {
        label: curve.label,
        projectedCents: point.portfolioCents,
        diffCents: diff,
        diffBp: ratioBp(diff, point.portfolioCents),
      };
    });

    return {
      asOf: snapshot.asOf,
      competence: snapshot.competence,
      portfolioCents: cents(snapshot.portfolioCents),
      status,
      byScenario,
    };
  });
}
