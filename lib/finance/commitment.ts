/**
 * Comprometimento futuro — CONTRACTS §5.
 *
 * Modulo puro (CONVENTIONS §5): recebe dados, devolve dados. Nao le relogio,
 * nao toca banco e nao faz conta de calendario por si — a janela de
 * competencias vem de `lib/date` (`competenceRange`), que e o unico lugar do
 * sistema com aritmetica de calendario (CONVENTIONS §4).
 *
 * RF-CC-03: "tabela dos proximos 24 meses com o total ja contratado por cartao
 * (soma das parcelas futuras), grafico de barras decrescente e o mes em que o
 * comprometimento zera".
 *
 * ---
 *
 * ## Decisoes que o contrato nao fixa e que estao resolvidas aqui
 *
 * 1. **A janela e pavimentada.** `byCompetence` tem exatamente `months` entradas
 *    a partir de `fromCompetence`, inclusive as de total zero. A tela e uma
 *    tabela de meses fixos: mes sem parcela e uma linha com zero, nao a
 *    ausencia de linha. Mesmo espirito das janelas de fatura de `billing.ts`,
 *    que pavimentam o calendario sem lacuna.
 *
 * 2. **O sinal e preservado** (CONVENTIONS §2: saida de dinheiro e negativa).
 *    Compra de cartao e saida, entao `totalCents` e `byCardId` vem negativos.
 *    Este modulo nao "melhora" o sinal para exibicao — quem exibe usa a
 *    magnitude (`formatBRL(v, { sign: 'never' })`). `usageBp` e uma razao, nao
 *    um valor monetario, entao e calculado sobre o modulo (ver item 5).
 *
 * 3. **`status` nao filtra.** A competencia ja coloca cada lancamento no mes
 *    dele; um parcelamento tem a parcela corrente `posted` e as futuras
 *    `planned`, e as duas sao dinheiro comprometido. Contar so `planned`
 *    apagaria a parcela corrente da tabela. O campo existe na entrada porque o
 *    consumidor carrega os dois estados juntos, nao porque o motor os separe.
 *
 * 4. **`lastCommittedCompetence` e o ULTIMO mes da janela com saldo DEVEDOR**
 *    (`totalCents < 0`), ou `null` quando nenhum mes deve dinheiro. Nao e "o
 *    primeiro mes que zera": essa leitura nem sempre existe (parcelas alem do
 *    fim da janela) e faria o nome do campo mentir. Mes com saldo POSITIVO —
 *    so estorno, entrada liquida — **nao conta**: nao se deve nada nele, e
 *    aponta-lo faria a tela anunciar "voce termina de pagar" num mes em que a
 *    familia RECEBE. Semantica fixada em CONTRACTS §5 (nota de 2026-09-16)
 *    apos conflito entre contrato, aceite e SPEC.
 *
 * 5. **`limitUsage` cobre todo cartao de `cards`, na ordem de entrada**, e mais
 *    qualquer cartao que apareca em lancamento e nao esteja em `cards` (para o
 *    dinheiro nao sumir), esse com `usageBp` nulo. `usedCents` e o
 *    comprometimento do cartao na janela, com sinal; `usageBp` e a razao
 *    `usado / limite` em basis points, arredondada para o bp mais proximo.
 *    `usageBp` e `null` quando o limite e `null` (RF-CC-05: cartao sem limite
 *    cadastrado) **ou nao-positivo** — limite zero dividiria por zero.
 */

import { competenceRange, type Competence } from '@/lib/date';
import {
  addCents,
  basisPoints,
  cents,
  type BasisPoints,
  type Cents,
} from '@/lib/money';

export interface CommitmentInput {
  transactions: {
    competence: Competence;
    amountCents: Cents;
    creditCardId: string;
    status: 'posted' | 'planned';
  }[];
  fromCompetence: Competence;
  months: number;
  cards: { id: string; name: string; creditLimitCents: Cents | null }[];
}

/** Basis points em 100 %. `500 bp = 5,00 %` (CONVENTIONS §3). */
const BP_SCALE = 10_000n;

/**
 * Teto do `BasisPoints` representavel (`safe integer`). Razao que passa disso e
 * dado patologico (limite cadastrado errado, ex.: 1 centavo) e e saturada neste
 * valor em vez de lancar — ver `usageBasisPoints`.
 */
const MAX_BASIS_POINTS = BigInt(Number.MAX_SAFE_INTEGER);

/** Valor zero tipado, usado como semente das somas. */
function zero(): Cents {
  return cents(0);
}

/**
 * Soma de um mapa de parciais em um unico `Cents`. Lista vazia devolve zero.
 * A soma passa por `addCents`, que acumula em bigint e so valida o total —
 * somar centavo a centavo em `number` nao perde precisao aqui porque cada
 * parcial ja e um inteiro seguro e `addCents` cuida do resto.
 */
function sumValues(values: Iterable<Cents>): Cents {
  return addCents(...values);
}

/**
 * Razao `used / limit` em basis points inteiros, arredondada para o bp mais
 * proximo (empate afasta do zero, como `applyRate`).
 *
 * O produto `used * 10_000` estoura o safe integer bem antes do limite de
 * `Cents`, entao a conta roda em bigint. Numerador e denominador entram em
 * modulo: a razao de "quanto do limite foi usado" nao tem sinal.
 *
 * **Nunca lanca.** Uma razao absurda so aparece com limite cadastrado errado
 * (ex.: 1 centavo) e lancar derrubaria a visao inteira de comprometimento por
 * causa de UM cartao com dado ruim — inclusive os cartoes corretos. A razao
 * fora do teto satura em `MAX_BASIS_POINTS`, que mantem o alerta do RF-CC-05
 * gritando (e nao `null`, que ja significa "cartao sem limite cadastrado").
 */
function usageBasisPoints(used: Cents, limit: Cents): BasisPoints {
  const magnitude = BigInt(used) < 0n ? -BigInt(used) : BigInt(used);
  const denominator = BigInt(limit);
  // round(magnitude * S / denominator) = floor((2*magnitude*S + denominator) / (2*denominator)).
  const rounded =
    (magnitude * 2n * BP_SCALE + denominator) / (denominator * 2n);
  const capped = rounded > MAX_BASIS_POINTS ? MAX_BASIS_POINTS : rounded;
  return basisPoints(Number(capped));
}

export function futureCommitment(input: CommitmentInput): {
  byCompetence: {
    competence: Competence;
    totalCents: Cents;
    byCardId: Record<string, Cents>;
  }[];
  totalCents: Cents;
  lastCommittedCompetence: Competence | null;
  limitUsage: { cardId: string; usedCents: Cents; usageBp: BasisPoints | null }[];
} {
  // `competenceRange` valida `fromCompetence` e exige `months` inteiro >= 0.
  const window = competenceRange(input.fromCompetence, input.months);
  const inWindow = new Set(window);

  // Acumuladores: total do cartao na janela e o cruzamento mes x cartao. Cada
  // somatorio replica o parcial anterior por `addCents`; o total do mes sai do
  // cruzamento (soma dos cartoes daquele mes).
  const cardTotals = new Map<string, Cents>();
  const monthCardTotals = new Map<Competence, Map<string, Cents>>();
  // Cartoes vistos em lancamento, na ordem em que aparecem — so para os que
  // nao estiverem em `cards` entrarem em `limitUsage` sem sumir calados.
  const seenCardIds: string[] = [];
  const seen = new Set<string>();

  for (const transaction of input.transactions) {
    if (!inWindow.has(transaction.competence)) continue;

    const amount = cents(transaction.amountCents);
    const cardId = transaction.creditCardId;

    cardTotals.set(cardId, addCents(cardTotals.get(cardId) ?? zero(), amount));

    const perCard =
      monthCardTotals.get(transaction.competence) ?? new Map<string, Cents>();
    perCard.set(cardId, addCents(perCard.get(cardId) ?? zero(), amount));
    monthCardTotals.set(transaction.competence, perCard);

    if (!seen.has(cardId)) {
      seen.add(cardId);
      seenCardIds.push(cardId);
    }
  }

  const byCompetence = window.map((competence) => {
    const perCard = monthCardTotals.get(competence) ?? new Map<string, Cents>();
    const byCardId: Record<string, Cents> = {};
    for (const [cardId, amount] of perCard) {
      byCardId[cardId] = amount;
    }
    return {
      competence,
      totalCents: sumValues(perCard.values()),
      byCardId,
    };
  });

  const cardsById = new Map(input.cards.map((card) => [card.id, card]));
  const limitUsage: {
    cardId: string;
    usedCents: Cents;
    usageBp: BasisPoints | null;
  }[] = [];
  const cardIdsInOrder = [...input.cards.map((card) => card.id), ...seenCardIds];
  const alreadyListed = new Set<string>();
  for (const cardId of cardIdsInOrder) {
    if (alreadyListed.has(cardId)) continue;
    alreadyListed.add(cardId);

    const usedCents = cardTotals.get(cardId) ?? zero();
    const limit = cardsById.get(cardId)?.creditLimitCents ?? null;
    limitUsage.push({
      cardId,
      usedCents,
      // Limite ausente ou nao-positivo nao tem percentual: `null`, nunca
      // `Infinity`/`NaN` (aceite do T-110 e CONVENTIONS §8).
      usageBp:
        limit === null || limit <= 0
          ? null
          : usageBasisPoints(usedCents, limit),
    });
  }

  // Ultimo mes DEVEDOR (saldo negativo) — nao o ultimo mes com movimento:
  // um mes so de estorno (saldo positivo) nao e comprometimento. CONTRACTS §5.
  let lastCommittedCompetence: Competence | null = null;
  for (let index = byCompetence.length - 1; index >= 0; index -= 1) {
    if ((byCompetence[index]?.totalCents ?? 0) < 0) {
      lastCommittedCompetence = byCompetence[index]?.competence ?? null;
      break;
    }
  }

  const totalCents = sumValues(
    byCompetence.map((entry) => entry.totalCents),
  );

  return { byCompetence, totalCents, lastCommittedCompetence, limitUsage };
}
