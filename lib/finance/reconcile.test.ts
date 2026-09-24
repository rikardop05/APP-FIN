import { describe, expect, it } from 'vitest';

import {
  matchPlannedToPosted,
  type MatchCandidate,
} from '@/lib/finance/reconcile';
import { basisPoints, cents } from '@/lib/money';

function cand(
  id: string,
  occurredOn: string,
  amountCents: number,
  categoryId: string | null,
): MatchCandidate {
  return { id, occurredOn, amountCents: cents(amountCents), categoryId };
}

/** Tolerancia de 5% e janela de 5 dias, sobrescritas em cada caso. */
const OPTS = { toleranceBp: basisPoints(500), dayWindow: 5 };

describe('matchPlannedToPosted — par exato e fronteiras', () => {
  it('casa o par identico (mesma categoria, valor e data)', () => {
    const result = matchPlannedToPosted(
      [cand('p1', '2026-03-05', -150000, 'a')],
      [cand('q1', '2026-03-05', -150000, 'a')],
      OPTS,
    );

    expect(result.matches).toEqual([{ plannedId: 'p1', postedId: 'q1', score: 0 }]);
    expect(result.unmatchedPlanned).toEqual([]);
    expect(result.unmatchedPosted).toEqual([]);
  });

  it('aceita diferenca de valor dentro da tolerancia, com score = diferenca relativa em bp', () => {
    // Tolerancia 500 bp = 5% de 100000 = 5000 centavos. Realizado -104000:
    // |−104000 − (−100000)| = 4000 <= 5000; score = 4000/100000 = 4% = 400 bp.
    const result = matchPlannedToPosted(
      [cand('p1', '2026-03-05', -100000, 'a')],
      [cand('q1', '2026-03-05', -104000, 'a')],
      OPTS,
    );
    expect(result.matches).toEqual([{ plannedId: 'p1', postedId: 'q1', score: 400 }]);
  });

  it('a fronteira da tolerancia e inclusiva (500 bp casa, 510 bp nao)', () => {
    // -105000 dista exatamente 5000 = 5% de 100000 -> score 500, casa.
    const naFronteira = matchPlannedToPosted(
      [cand('p1', '2026-03-05', -100000, 'a')],
      [cand('q1', '2026-03-05', -105000, 'a')],
      OPTS,
    );
    expect(naFronteira.matches).toEqual([
      { plannedId: 'p1', postedId: 'q1', score: 500 },
    ]);

    // -105100 dista 5100 > 5000 -> nao casa.
    const acima = matchPlannedToPosted(
      [cand('p1', '2026-03-05', -100000, 'a')],
      [cand('q1', '2026-03-05', -105100, 'a')],
      OPTS,
    );
    expect(acima.matches).toEqual([]);
    expect(acima.unmatchedPlanned).toEqual(['p1']);
    expect(acima.unmatchedPosted).toEqual(['q1']);
  });

  it('o score nunca passa de toleranceBp: filtro e score sao o mesmo numero', () => {
    // base 333, tolerancia 500 bp. diff 16 -> score round(16/333 x 10000) = 480,
    // casa. diff 17 -> score 511 > 500, NAO casa. O criterio (CONTRACTS §9) e a
    // diferenca relativa |real - previsto| / |previsto| em bp, o mesmo numero
    // que sai no score (achado do Corvo, evitando dois arredondamentos).
    const aceito = matchPlannedToPosted(
      [cand('p1', '2026-03-05', -333, 'a')],
      [cand('q1', '2026-03-05', -349, 'a')],
      OPTS,
    );
    expect(aceito.matches).toEqual([{ plannedId: 'p1', postedId: 'q1', score: 480 }]);

    const recusado = matchPlannedToPosted(
      [cand('p1', '2026-03-05', -333, 'a')],
      [cand('q1', '2026-03-05', -350, 'a')],
      OPTS,
    );
    expect(recusado.matches).toEqual([]);
  });

  it('a janela de data e inclusiva', () => {
    // 05/03 -> 20/03 = 15 dias. Janela 14 nao casa; 15 casa.
    const fora = matchPlannedToPosted(
      [cand('p1', '2026-03-05', -100000, 'a')],
      [cand('q1', '2026-03-20', -100000, 'a')],
      { toleranceBp: basisPoints(500), dayWindow: 14 },
    );
    expect(fora.matches).toEqual([]);

    const naBorda = matchPlannedToPosted(
      [cand('p1', '2026-03-05', -100000, 'a')],
      [cand('q1', '2026-03-20', -100000, 'a')],
      { toleranceBp: basisPoints(500), dayWindow: 15 },
    );
    expect(naBorda.matches).toEqual([
      { plannedId: 'p1', postedId: 'q1', score: 0 },
    ]);
  });

  it('casa receita positiva com receita positiva (sinal preservado)', () => {
    const result = matchPlannedToPosted(
      [cand('p1', '2026-03-05', 150000, 'r')],
      [cand('q1', '2026-03-06', 150000, 'r')],
      OPTS,
    );
    expect(result.matches).toEqual([{ plannedId: 'p1', postedId: 'q1', score: 0 }]);
  });

  it('valor previsto zero nao entra em candidato (CONTRACTS §9)', () => {
    // Sem magnitude nao ha referencia para medir a tolerancia. Fica orfao mesmo
    // diante de um realizado zero.
    const result = matchPlannedToPosted(
      [cand('p1', '2026-03-05', 0, 'a')],
      [cand('q1', '2026-03-05', 0, 'a'), cand('q2', '2026-03-05', -100, 'a')],
      OPTS,
    );
    expect(result.matches).toEqual([]);
    expect(result.unmatchedPlanned).toEqual(['p1']);
    expect(result.unmatchedPosted).toEqual(['q1', 'q2']);
  });
});

describe('matchPlannedToPosted — categoria', () => {
  it('nao casa categorias diferentes', () => {
    const result = matchPlannedToPosted(
      [cand('p1', '2026-03-05', -100000, 'a')],
      [cand('q1', '2026-03-05', -100000, 'b')],
      OPTS,
    );
    expect(result.matches).toEqual([]);
  });

  it('nao casa quando falta categoria em qualquer lado', () => {
    const semPrevisto = matchPlannedToPosted(
      [cand('p1', '2026-03-05', -100000, null)],
      [cand('q1', '2026-03-05', -100000, 'a')],
      OPTS,
    );
    expect(semPrevisto.matches).toEqual([]);

    const semRealizado = matchPlannedToPosted(
      [cand('p1', '2026-03-05', -100000, 'a')],
      [cand('q1', '2026-03-05', -100000, null)],
      OPTS,
    );
    expect(semRealizado.matches).toEqual([]);

    // Dois "sem categoria" tambem nao casam: seria casar por ausencia de sinal.
    const doisNulos = matchPlannedToPosted(
      [cand('p1', '2026-03-05', -100000, null)],
      [cand('q1', '2026-03-05', -100000, null)],
      OPTS,
    );
    expect(doisNulos.matches).toEqual([]);
  });
});

describe('matchPlannedToPosted — melhor par e sem reuso', () => {
  it('sem reuso: uma realizada nao casa com duas previstas', () => {
    // p1 e p2 sao identicos em valor; q1 cabe nas duas. So um par sai; a outra
    // prevista fica orfa — nunca dois pares dividindo a mesma realizada.
    const result = matchPlannedToPosted(
      [
        cand('p1', '2026-03-05', -100000, 'a'),
        cand('p2', '2026-03-06', -100000, 'a'),
      ],
      [cand('q1', '2026-03-05', -100000, 'a')],
      { toleranceBp: basisPoints(0), dayWindow: 2 },
    );

    expect(result.matches).toEqual([{ plannedId: 'p1', postedId: 'q1', score: 0 }]);
    expect(result.unmatchedPlanned).toEqual(['p2']);
    expect(result.unmatchedPosted).toEqual([]);
  });

  it('sem reuso: uma prevista nao casa com duas realizadas', () => {
    const result = matchPlannedToPosted(
      [cand('p1', '2026-03-05', -100000, 'a')],
      [
        cand('q1', '2026-03-05', -100000, 'a'),
        cand('q2', '2026-03-06', -100000, 'a'),
      ],
      { toleranceBp: basisPoints(0), dayWindow: 2 },
    );

    expect(result.matches).toEqual([{ plannedId: 'p1', postedId: 'q1', score: 0 }]);
    expect(result.unmatchedPlanned).toEqual([]);
    expect(result.unmatchedPosted).toEqual(['q2']);
  });

  it('melhor par: valor manda sobre data', () => {
    // p1 tem dois candidatos: q1 casa no valor exato (score 0, 1 dia depois) e
    // q2 dista 3000 (score 300) mas na data exata. O valor vence -> q1.
    const result = matchPlannedToPosted(
      [cand('p1', '2026-03-05', -100000, 'a')],
      [
        cand('q1', '2026-03-06', -100000, 'a'),
        cand('q2', '2026-03-05', -103000, 'a'),
      ],
      OPTS,
    );

    expect(result.matches).toEqual([{ plannedId: 'p1', postedId: 'q1', score: 0 }]);
    expect(result.unmatchedPosted).toEqual(['q2']);
  });

  it('melhor par: empate de valor desempata pela data mais proxima', () => {
    // Os dois candidatos casam no valor exato (score 0). q2 dista 1 dia, q1
    // dista 3 -> q2 vence.
    const result = matchPlannedToPosted(
      [cand('p1', '2026-03-05', -100000, 'a')],
      [
        cand('q1', '2026-03-08', -100000, 'a'),
        cand('q2', '2026-03-06', -100000, 'a'),
      ],
      OPTS,
    );

    expect(result.matches).toEqual([{ plannedId: 'p1', postedId: 'q2', score: 0 }]);
    expect(result.unmatchedPosted).toEqual(['q1']);
  });

  it('casa varias duplas e devolve os pares do melhor para o pior', () => {
    // p1-q1: valor exato (score 0). p2-q2: |−201000 + 200000| = 1000 sobre
    // 200000 = 0,5% = 50 bp.
    const result = matchPlannedToPosted(
      [
        cand('p1', '2026-03-05', -100000, 'a'),
        cand('p2', '2026-04-01', -200000, 'a'),
      ],
      [
        cand('q1', '2026-03-05', -100000, 'a'),
        cand('q2', '2026-04-02', -201000, 'a'),
      ],
      OPTS,
    );

    expect(result.matches).toEqual([
      { plannedId: 'p1', postedId: 'q1', score: 0 },
      { plannedId: 'p2', postedId: 'q2', score: 50 },
    ]);
    expect(result.unmatchedPlanned).toEqual([]);
    expect(result.unmatchedPosted).toEqual([]);
  });

  it('limite conhecido do guloso: num triangulo deixa um orfao que o otimo global casaria', () => {
    // p1(04/03), p2(02/03); q1(04/03), q2(06/03); janela 2 dias.
    // viaveis: p1-q1 (0 dia), p1-q2 (2), p2-q1 (2); p2-q2 (4) e inviavel.
    // Guloso pega p1-q1 (melhor) e q1 sai; p1-q2 e p2-q1 ficam bloqueados ->
    // 1 par. O otimo global faria p1-q2 + p2-q1 = 2. Decisao: guloso.
    const result = matchPlannedToPosted(
      [
        cand('p1', '2026-03-04', -100000, 'a'),
        cand('p2', '2026-03-02', -100000, 'a'),
      ],
      [
        cand('q1', '2026-03-04', -100000, 'a'),
        cand('q2', '2026-03-06', -100000, 'a'),
      ],
      { toleranceBp: basisPoints(0), dayWindow: 2 },
    );

    expect(result.matches).toEqual([{ plannedId: 'p1', postedId: 'q1', score: 0 }]);
    expect(result.unmatchedPlanned).toEqual(['p2']);
    expect(result.unmatchedPosted).toEqual(['q2']);
  });

  it('unmatched preserva a ordem de entrada', () => {
    const result = matchPlannedToPosted(
      [
        cand('p1', '2026-03-05', -100000, 'a'),
        cand('p2', '2026-03-06', -100000, 'a'),
        cand('p3', '2026-03-07', -100000, 'a'),
      ],
      [cand('q1', '2026-03-06', -100000, 'a')],
      { toleranceBp: basisPoints(0), dayWindow: 1 },
    );

    expect(result.matches).toEqual([{ plannedId: 'p2', postedId: 'q1', score: 0 }]);
    expect(result.unmatchedPlanned).toEqual(['p1', 'p3']);
  });
});

describe('matchPlannedToPosted — listas vazias e validacao', () => {
  it('listas vazias devolvem tudo vazio', () => {
    expect(matchPlannedToPosted([], [], OPTS)).toEqual({
      matches: [],
      unmatchedPlanned: [],
      unmatchedPosted: [],
    });
  });

  it('realizado sem previsto correspondente fica orfao', () => {
    const result = matchPlannedToPosted(
      [cand('p1', '2026-03-05', -100000, 'a')],
      [cand('q1', '2026-08-05', -100000, 'a')],
      OPTS,
    );
    expect(result.matches).toEqual([]);
    expect(result.unmatchedPlanned).toEqual(['p1']);
    expect(result.unmatchedPosted).toEqual(['q1']);
  });

  it('recusa toleranceBp negativo', () => {
    expect(() =>
      matchPlannedToPosted([], [], { toleranceBp: basisPoints(-1), dayWindow: 5 }),
    ).toThrow(RangeError);
  });

  it('recusa dayWindow negativo ou fracionario', () => {
    expect(() =>
      matchPlannedToPosted([], [], { toleranceBp: basisPoints(500), dayWindow: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      matchPlannedToPosted([], [], { toleranceBp: basisPoints(500), dayWindow: 1.5 }),
    ).toThrow(RangeError);
  });
});
