/**
 * Detector de parcelas — CONTRACTS §15 (`detectInstallment`), T-121.
 *
 * Le a descricao crua de um lancamento e devolve a parcela que ela anuncia,
 * mais a descricao sem o sufixo. Consumido pelo parser de PDF (T-117/b/c), pelo
 * de texto colado (T-119) e pelo pipeline (T-107) — por isso mora em modulo
 * proprio, e nao dentro de um parser.
 *
 * Os quatro padroes exigidos: `PARC 03/10`, `03/10`, `PARCELA 3 DE 10` e
 * `(3 de 10)`.
 *
 * ---
 *
 * ## O caso dificil: `03/10` tambem e 3 de outubro
 *
 * Um `N/M` solto na descricao pode ser parcela ou data, e as duas leituras sao
 * gramaticalmente identicas. O erro nao e simetrico:
 *
 * - **Falso positivo** (data lida como parcela) projeta um comprometimento
 *   futuro inexistente por M meses — uma compra de outubro vira dez parcelas
 *   fantasma no fluxo de caixa.
 * - **Falso negativo** (parcela lida como texto) deixa a compra entrar como
 *   lancamento unico, com `03/10` visivel na descricao, e o usuario corrige o
 *   campo de parcela na tela de confirmacao (CONTRACTS §16: `installment` e
 *   editavel).
 *
 * Mesmo assim o aceite exige reconhecer `03/10` solto, entao a ambiguidade nao
 * pode ser resolvida so recusando. O criterio adotado tem quatro filtros, do
 * mais forte para o mais fraco:
 *
 * 1. **Palavra-chave manda.** `PARC`/`PARCELA` antes do numero, ou a forma
 *    `N de M`, decidem sozinhas: nenhuma data em pt-BR se escreve `3 de 10` —
 *    a forma por extenso nomeia o mes (`3 de outubro`).
 * 2. **Data completa nao e candidata.** `03/10/2026` e `2026/03/10` sao
 *    rejeitados na propria expressao: o par so vale quando nao ha terceiro
 *    grupo de digitos colado por `/`, `.` ou `-`. Isso elimina toda data que
 *    traz o ano, que e a forma mais comum em descricao de cartao.
 * 3. **Aritmetica de parcela.** Vale `1 <= N <= M` e `M >= 2`. Isso rejeita
 *    sozinho toda data cujo dia e maior que o mes — `25/12`, `31/01`, `10/03` —
 *    que e a maioria das datas. E rejeita `1/1`, que como parcela e um plano de
 *    uma prestacao (nao ha o que projetar) e como data e 1 de janeiro.
 * 4. **Preposicao de data antes do numero derruba o palpite.** `em`, `dia`,
 *    `data`, `desde`, `ate`, `venc`, `vcto`: `ASSINATURA EM 03/10` e data, nao
 *    parcela. A palavra-chave do filtro 1 tem precedencia sobre esta.
 *
 * 5. **Teto de plano.** Sem evidencia direta, `M` nao passa de
 *    `MAX_TOTAL_UNMARKED` (24). A faixa `M > 12` nao e alcancada por nenhum dos
 *    filtros anteriores — nenhum mes passa de 12 e `N <= M` e trivial quando
 *    `M` e grande —, entao um codigo de produto, peso ou contrato no fim da
 *    descricao (`COMPRA 2/60`) viraria cinco anos de despesa inexistente no
 *    fluxo de caixa. Com evidencia direta o teto sobe para `MAX_TOTAL` (99):
 *    quem escreveu `PARCELA 2 DE 60` disse que e parcela, e nao cabe a
 *    heuristica desmentir.
 *
 * O que sobra depois dos cinco filtros — `N/M` solto, sem evidencia direta, com
 * `1 <= N <= M <= 24` — e aceito como parcela, **inclusive na faixa `M > 12`**,
 * onde nenhuma leitura de data e possivel. E a unica escolha compativel com o
 * aceite, e a rede de protecao e a tela de confirmacao.
 *
 * Duas ambiguidades que sobrevivem de proposito, porque o dominio decide:
 *
 * - `03/24` poderia ser marco de 2024 escrito como `mm/aa`, mas plano de 24
 *   vezes e comum no Brasil e `M > 12` nunca e mes: fica parcela. Ja `03/26`,
 *   solto, cai no filtro 5 — acima do teto, o par tem mais cara de outro numero
 *   que de plano.
 * - `1/2` poderia ser "meia porcao"; como parcela de 2 vezes e frequente e a
 *   forma e a mesma, fica parcela.
 *
 * E uma regra de desempate: **duas ou mais candidatas sem evidencia direta do
 * filtro 1 devolvem `null`**. Se a linha traz `03/10` e `1/2`, nao ha criterio
 * para escolher, e escolher errado e o erro caro. Havendo uma candidata com
 * evidencia direta, e ela que vale — `PARC 03/10 PIZZA 1/2` nao e ambiguo.
 *
 * ---
 *
 * Modulo puro (CONVENTIONS §5), sem dependencia: nao ha conta de calendario
 * aqui — nenhuma data e construida, so descartada. Aritmetica de calendario
 * vive em `lib/date` (CONVENTIONS §4).
 */

/** Parcela reconhecida em uma descricao. */
export interface DetectedInstallment {
  /** Numero desta parcela, `1..total`. */
  current: number;
  /** Total de parcelas do plano, `>= 2`. */
  total: number;
  /** Descricao sem o sufixo de parcela, com espacos e separadores soltos limpos. */
  cleanDescription: string;
}

/**
 * Par `N/M` ou `N de M`, com as duas guardas de forma do filtro 2:
 *
 * - `(?<![\d/.\-])` — o `N` nao pode ser continuacao de um numero maior nem vir
 *   depois de um separador de data (`2026/03/10` nao rende `03/10`).
 * - `(?!\d)(?![/.\-]\d)` — o `M` nao pode ter terceiro grupo colado
 *   (`03/10/2026`, `03/10-26`) nem continuar em digito.
 *
 * A segunda guarda exige o separador **colado** no digito seguinte, de
 * proposito: `PARC 3/10 - 2 UN` continua sendo parcela, e nenhuma data se
 * escreve com espaco em volta da barra.
 *
 * No maximo dois digitos de cada lado: `2026/03` nunca e candidato e `100/120`
 * nao e plano de parcela. O flag `i` cobre `DE`/`de`.
 */
const CANDIDATE_PATTERN =
  /(?<![\d/.\-])(\d{1,2})\s*(?:\/|\s+de\s+)\s*(\d{1,2})(?!\d)(?![/.\-]\d)/gi;

/**
 * Palavra-chave imediatamente antes do numero: `PARC`, `PARC.`, `PARCELA`,
 * `PARCELAS`, opcionalmente com `n.`/`nº` ou `de` no meio
 * (`PARCELA Nº 3/10`, `PARCELA DE 3/10`). Casa no fim do trecho anterior ao
 * numero, tolerando espacos, ponto, hifen e abre-parenteses entre os dois.
 */
const KEYWORD_BEFORE = /\bparc(?:elas|ela)?\.?\s*(?:n[.º°o]?\s*)?(?:de\s+)?[([\s.\-]*$/i;

/**
 * Preposicao que anuncia data (filtro 4). Lista curta e fechada de proposito:
 * cada palavra aqui transforma uma parcela legitima em falso negativo, entao so
 * entram as que praticamente nunca precedem um numero de parcela.
 */
const DATE_WORD_BEFORE = /\b(?:em|dia|data|desde|at[eé]|venc(?:imento)?|vcto)\.?\s*$/i;

/** Ruido de separador que sobra nas pontas quando o sufixo sai do meio da frase. */
const EDGE_NOISE = /^[\s\-–—•|,;:/.]+|[\s\-–—•|,;:/.]+$/g;

/** Plano de uma parcela so nao e plano: nao ha parcela futura a projetar. */
const MIN_TOTAL = 2;

/**
 * Teto absoluto do par, alinhado com `MAX_INSTALLMENT_COUNT` de
 * `lib/finance/dedupe.ts` — os dois modulos leem o mesmo sufixo, e teto
 * divergente entre eles faria o dedupe reconhecer parcela que o detector
 * descartou. Coincide com o limite de dois digitos de `CANDIDATE_PATTERN`, e
 * esta nomeado de proposito: teto de dominio nao deve ser consequencia
 * acidental de uma expressao regular.
 */
const MAX_TOTAL = 99;

/**
 * Teto da candidata **sem** evidencia direta (filtro 5).
 *
 * O numero sai da assimetria de custo, nao da cobertura: falso negativo o
 * usuario corrige em dois cliques na tela de confirmacao, enquanto falso
 * positivo cria despesa fantasma discreta, projetada por ate `M` meses numa
 * fatura de 40 linhas — e ninguem percebe ate o comprometimento futuro estar
 * errado. Sem a palavra escrita a candidata e ambigua por definicao, entao o
 * teto conservador vale mais que a cobertura: parcelamento de cartao acima de
 * 24x e raro, e quando existe quase sempre traz `PARC`/`PARCELA` na descricao —
 * caso em que o teto e `MAX_TOTAL` e nao este.
 *
 * Decisao de dominio do humano, registrada em CONTRACTS §15 e ja default em
 * ORCHESTRATION §5: nao se rediscute sem ele.
 */
const MAX_TOTAL_UNMARKED = 24;

/** Candidata ja localizada no texto, antes dos filtros de plausibilidade. */
interface Candidate {
  current: number;
  total: number;
  /** Inicio da remocao no texto original — inclui a palavra-chave, quando ha. */
  start: number;
  /** Fim exclusivo da remocao. */
  end: number;
  /**
   * Evidencia direta de parcela (filtro 1): palavra-chave `PARC`/`PARCELA`
   * antes do numero, **ou** a forma por extenso `N de M`. As duas dizem
   * "parcela" sem depender de contexto, e por isso vencem o filtro 4 e o
   * desempate. `3/10` solto nao e forte: e o par que tambem pode ser data.
   */
  strong: boolean;
}

/**
 * Estende a remocao para os parenteses ou colchetes que envolvem **apenas** o
 * marcador: `AMAZON (3 de 10)` nao pode virar `AMAZON ()`.
 */
function expandWrappers(
  raw: string,
  start: number,
  end: number,
): { start: number; end: number } {
  let from = start;
  let to = end;
  for (;;) {
    // `charAt` fora do intervalo devolve string vazia, entao nao precisa de guarda.
    const open = raw.charAt(from - 1);
    const close = raw.charAt(to);
    if ((open === '(' && close === ')') || (open === '[' && close === ']')) {
      from -= 1;
      to += 1;
      continue;
    }
    return { start: from, end: to };
  }
}

/** Colapsa espaco e tira separador solto das pontas. Nao mexe em caixa nem acento. */
function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').replace(EDGE_NOISE, '').trim();
}

/** Localiza todo par `N/M` ou `N de M` do texto, sem julgar plausibilidade. */
function collectCandidates(raw: string): Candidate[] {
  const candidates: Candidate[] = [];

  // `matchAll` nao mexe no `lastIndex` do regex original — o modulo continua
  // reentrante, que e o que uma funcao pura precisa.
  for (const match of raw.matchAll(CANDIDATE_PATTERN)) {
    const current = Number(match[1] ?? '');
    const total = Number(match[2] ?? '');
    const matchStart = match.index;
    const matchEnd = matchStart + (match[0] ?? '').length;

    const before = raw.slice(0, matchStart);
    const keyword = KEYWORD_BEFORE.exec(before);
    // A forma por extenso e a propria evidencia: `3 de 10` nao e data em
    // pt-BR — a data por extenso nomeia o mes (`3 de outubro`). Testado pelo
    // que a candidata casou, e nao pela ausencia de barra: se `CANDIDATE_PATTERN`
    // ganhar um separador novo, este teste continua dizendo a verdade.
    const spelledOut = /\sde\s/i.test(match[0] ?? '');

    candidates.push({
      current,
      total,
      start: keyword === null ? matchStart : keyword.index,
      end: matchEnd,
      strong: keyword !== null || spelledOut,
    });
  }

  return candidates;
}

/** Filtros 1, 3, 4 e 5. O filtro 2 ja aconteceu na expressao das candidatas. */
function isPlausible(raw: string, candidate: Candidate): boolean {
  const { current, total, strong } = candidate;

  // Filtro 3, mais o teto absoluto: valem para toda candidata.
  if (current < 1 || total < MIN_TOTAL || total > MAX_TOTAL || current > total) {
    return false;
  }
  // Filtro 1: evidencia direta dispensa contexto.
  if (strong) return true;
  // Filtro 5: sem evidencia, o plano tem de ser um plano praticado.
  if (total > MAX_TOTAL_UNMARKED) return false;

  return !DATE_WORD_BEFORE.test(raw.slice(0, candidate.start));
}

/**
 * Reconhece o sufixo de parcela de uma descricao de lancamento.
 *
 * Devolve `null` quando nao ha padrao, quando a descricao esta vazia e quando a
 * evidencia e ambigua demais para decidir — ver o criterio completo no topo do
 * arquivo.
 *
 * ```ts
 * detectInstallment('NETFLIX - Parcela 3/10')
 * // { current: 3, total: 10, cleanDescription: 'NETFLIX' }
 * detectInstallment('UBER *TRIP 03/10/2026')
 * // null — data completa
 * ```
 */
export function detectInstallment(
  rawDescription: string,
): DetectedInstallment | null {
  if (typeof rawDescription !== 'string' || rawDescription === '') return null;

  const accepted = collectCandidates(rawDescription).filter((candidate) =>
    isPlausible(rawDescription, candidate),
  );

  const marked = accepted.filter((candidate) => candidate.strong);

  let chosen: Candidate | undefined;
  if (marked.length > 0) {
    chosen = marked[0];
  } else if (accepted.length === 1) {
    chosen = accepted[0];
  }
  if (chosen === undefined) return null;

  const { start, end } = expandWrappers(rawDescription, chosen.start, chosen.end);
  const cleanDescription = tidy(
    `${rawDescription.slice(0, start)} ${rawDescription.slice(end)}`,
  );

  return { current: chosen.current, total: chosen.total, cleanDescription };
}
