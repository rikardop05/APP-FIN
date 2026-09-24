/**
 * Conciliacao previsto x realizado — CONTRACTS §9.
 *
 * Modulo puro (CONVENTIONS §5): recebe listas, devolve listas. A distancia em
 * dias vem de `lib/date` (CONVENTIONS §4).
 *
 * O criterio de "melhor par" e as demais decisoes foram fixados com o
 * Orquestrador antes de codar e ratificados no CONTRACTS §9 (secoes fixadas em
 * 2026-09-24). Cada decisao abaixo muda o resultado em silencio:
 *
 * 1. **Par viavel** exige: mesma categoria (ambos os lados com `categoryId`
 *    nao-nulo e iguais), valor dentro da tolerancia e data dentro da janela.
 *
 * 2. **Tolerancia relativa ao PREVISTO, em basis points** (CONTRACTS §9): a
 *    diferenca relativa `|real − previsto| / |previsto|`, em bp inteiros, tem de
 *    ser <= `toleranceBp`. O MESMO numero e o filtro e o `score`, entao o score
 *    NUNCA passa de `toleranceBp` — nao ha dois arredondamentos divergindo
 *    (achado do Corvo). `previsto` zero NAO entra em candidato: sem magnitude
 *    nao ha referencia para a tolerancia.
 *
 * 3. **Melhor par = lexicografico: valor, depois data, depois id.** O `score`
 *    devolvido e a diferenca RELATIVA de valor em basis points inteiros, e
 *    MENOR e melhor. Por que valor primeiro: o valor e o sinal mais forte de que
 *    o lancamento realizado e aquele previsto (o mesmo aluguel, a mesma conta);
 *    a data escorrega alguns dias de forma normal (fim de semana, feriado, atraso
 *    de boleto), entao ela desempata, nao decide. Empate de valor e data cai no
 *    id crescente, para o resultado ser deterministico.
 *
 * 4. **Casamento guloso por melhor score** — literal de "melhor par primeiro,
 *    sem reuso": monta TODOS os pares viaveis, ordena pelo criterio acima e
 *    consome, pulando qualquer id ja usado. A alternativa (otimo global, que
 *    maximiza o numero de pares) nao foi escolhida: e bem mais cara e o ganho
 *    so aparece num triangulo patologico. O custo conhecido esta travado por
 *    teste.
 *
 * 5. **Sem reuso e a invariante dura**: cada previsto casa com no maximo um
 *    realizado e vice-versa, garantido pelos conjuntos de ids usados.
 *
 * O sinal dos valores e preservado: comparamos a distancia absoluta, entao
 * despesa (negativa) casa com despesa e receita (positiva) com receita.
 */

import { diffDays, type IsoDate } from '@/lib/date';
import {
  addCents,
  basisPoints,
  cents,
  type BasisPoints,
  type Cents,
} from '@/lib/money';

export interface MatchCandidate {
  id: string;
  occurredOn: IsoDate;
  amountCents: Cents;
  categoryId: string | null;
}

/** Par viavel com o custo ja calculado, para ordenar uma vez so. */
interface FeasiblePair {
  plannedId: string;
  postedId: string;
  score: number;
  dayDistance: number;
}

const BP_SCALE = 10_000;

/**
 * Diferenca relativa `diff / base` em basis points inteiros, arredondada para o
 * bp mais proximo. `base` nunca e zero quando chamada de `matchPlannedToPosted`
 * (previsto zero e pulado antes); o guarda fica so como defesa contra 0/0.
 *
 * Em `bigint` porque `diff * 10000` estoura o safe integer bem antes do limite
 * de `Cents` — mesmo cuidado de `applyRate`.
 */
function relativeDiffBp(diff: number, base: number): number {
  if (base === 0) return 0;
  const d = BigInt(diff);
  const b = BigInt(base);
  return Number((d * BigInt(BP_SCALE) + b / 2n) / b);
}

/** Comparacao de id por code unit, nao por locale — determinismo entre maquinas. */
function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function assertToleranceBp(value: BasisPoints): BasisPoints {
  const bp = basisPoints(value);
  if (bp < 0) {
    throw new RangeError(
      `toleranceBp deve ser >= 0; recebido: ${String(bp)}. Tolerancia negativa nao casa nada e esconderia um erro de chamada.`,
    );
  }
  return bp;
}

function assertDayWindow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `dayWindow deve ser inteiro >= 0 (dias); recebido: ${String(value)}.`,
    );
  }
  return value;
}

/**
 * Casa previsto com realizado: mesma categoria, valor dentro de `toleranceBp`,
 * data dentro de `dayWindow`. Melhor par primeiro, sem reuso. Ver o cabecalho
 * para o criterio de "melhor" e as demais decisoes.
 */
export function matchPlannedToPosted(
  planned: MatchCandidate[],
  posted: MatchCandidate[],
  opts: { toleranceBp: BasisPoints; dayWindow: number },
): {
  matches: { plannedId: string; postedId: string; score: number }[];
  unmatchedPlanned: string[];
  unmatchedPosted: string[];
} {
  const toleranceBp = assertToleranceBp(opts.toleranceBp);
  const dayWindow = assertDayWindow(opts.dayWindow);

  const feasible: FeasiblePair[] = [];
  for (const plannedItem of planned) {
    // CONTRACTS §9: previsto zero nao entra em candidato — sem magnitude nao ha
    // referencia para medir a tolerancia (e a diferenca relativa seria 0/0).
    if (plannedItem.amountCents === 0) continue;
    const plannedMagnitude = Math.abs(plannedItem.amountCents);
    for (const postedItem of posted) {
      // "Mesma categoria" exige os dois lados categorizados: casar dois "sem
      // categoria" seria casar por ausencia de sinal.
      if (plannedItem.categoryId === null || postedItem.categoryId === null) {
        continue;
      }
      if (plannedItem.categoryId !== postedItem.categoryId) continue;

      const diff = Math.abs(
        addCents(postedItem.amountCents, cents(-plannedItem.amountCents)),
      );
      // O mesmo numero e o filtro e o score: criterio do contrato (diferenca
      // relativa em bp) e `score <= toleranceBp` sao a MESMA condicao.
      const score = relativeDiffBp(diff, plannedMagnitude);
      if (score > toleranceBp) continue;

      const dayDistance = Math.abs(
        diffDays(postedItem.occurredOn, plannedItem.occurredOn),
      );
      if (dayDistance > dayWindow) continue;

      feasible.push({
        plannedId: plannedItem.id,
        postedId: postedItem.id,
        score,
        dayDistance,
      });
    }
  }

  // Melhor par primeiro: valor (score asc), depois data (dias asc), depois id.
  feasible.sort(
    (a, b) =>
      a.score - b.score ||
      a.dayDistance - b.dayDistance ||
      compareIds(a.plannedId, b.plannedId) ||
      compareIds(a.postedId, b.postedId),
  );

  const usedPlanned = new Set<string>();
  const usedPosted = new Set<string>();
  const matches: { plannedId: string; postedId: string; score: number }[] = [];

  for (const pair of feasible) {
    if (usedPlanned.has(pair.plannedId) || usedPosted.has(pair.postedId)) continue;
    usedPlanned.add(pair.plannedId);
    usedPosted.add(pair.postedId);
    matches.push({
      plannedId: pair.plannedId,
      postedId: pair.postedId,
      score: pair.score,
    });
  }

  const unmatchedPlanned = planned
    .filter((item) => !usedPlanned.has(item.id))
    .map((item) => item.id);
  const unmatchedPosted = posted
    .filter((item) => !usedPosted.has(item.id))
    .map((item) => item.id);

  return { matches, unmatchedPlanned, unmatchedPosted };
}
