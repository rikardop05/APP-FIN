/**
 * Remontagem de linha por coordenada — CONTRACTS §15 (`groupIntoRows`), T-117.
 *
 * RF-IMP-12. O PDF nao emite "linhas": emite runs de texto posicionados. Na
 * fatura do Santander, 884 runs rendem **uma unica** linha com data e valor
 * juntos — a informacao de qual run pertence a qual linha visual existe so nas
 * coordenadas. Reconstruir pela ordem do stream produz o texto embaralhado e,
 * pior, silenciosamente errado: a ordem do stream nao e a ordem de leitura.
 *
 * Esta funcao e **infraestrutura comum aos tres bancos**. Nubank, Santander e
 * Mercado Pago diferem no mapeamento de colunas (o parser de cada um aplica as
 * faixas de x), nao em como uma linha se forma.
 *
 * ---
 *
 * ## Como a linha e remontada
 *
 * 1. **Agrupa por `y` com tolerancia** (default 2pt). Runs na mesma linha visual
 *    tem o mesmo `y` de base, ou quase: a tolerancia absorve o ruido de
 *    subpixel de quem gerou o PDF. O agrupamento e por pagina — `y` iguais em
 *    paginas diferentes sao linhas diferentes.
 * 2. **Ordena as celulas por `x`.** Run mais a esquerda primeiro.
 * 3. **Une as celulas por espaco.** O contrato chama isso de `text`, e e a
 *    heuristica simples que o parser de texto colado e os parsers por banco
 *    reaproveitam sem reimplementar coordenada.
 *
 * ## Duas tabelas na mesma `y` — `xBands` (Santander, IMPORT-SOURCES §8)
 *
 * Na fatura do Santander **duas tabelas independentes dividem as mesmas linhas
 * `y`**: os lancamentos ocupam `x < 250` e um quadro-resumo ocupa `x > 320`. Na
 * mesma `y=425` convivem uma compra e um totalizador sem relacao nenhuma.
 *
 * Agrupar so por `y` nao corrompe as celulas (cada uma guarda o seu `x`), mas
 * **contamina o `text`**: ele cola a descricao da compra ao rotulo do resumo, e
 * qualquer heuristica que leia `text` — como `detectPdfIssuer` — herda o lixo.
 *
 * `opts.xBands` resolve isso: as faixas de `x` sao declaradas por **quem conhece
 * o banco** (o parser do banco), e cada faixa vira uma `PdfTextRow` propria, com
 * o seu `text` ja limpo. A interpretacao de coluna continua no parser, nao na
 * infra.
 *
 * A infra **nao** detecta as tabelas sozinha. Um corte por "maior vao
 * horizontal" com limiar fixo partiria toda linha do Nubank em duas: la a
 * descricao termina perto de `x=400` e o valor comeca em `x=491`, um vao grande
 * dentro da **mesma** tabela. So faixa explicita distingue os dois casos.
 *
 * Celulas fora de todas as faixas **nao sao descartadas**: viram uma linha
 * propria, recolocada na ordem de `x` — a infra nunca engole run.
 *
 * A ordem de saida e a de leitura: pagina crescente, `y` decrescente e, dentro
 * de um grupo de `y`, faixa a faixa da esquerda para a direita.
 *
 * Modulo puro (CONVENTIONS §5): zero I/O — recebe os runs e devolve linhas.
 */

import type { PdfTextItem } from './extract';

/** Uma linha visual reconstruida a partir dos runs posicionados. */
export interface PdfTextRow {
  /** Numero da pagina, a partir de 1. */
  page: number;
  /** `y` representativo da linha (media das bases dos runs), em pontos. */
  y: number;
  /** Celulas da linha, ordenadas por `x`. */
  cells: { x: number; text: string }[];
  /** Celulas unidas por espaco, para a heuristica simples. */
  text: string;
}

/** Opcoes de agrupamento. */
export interface GroupIntoRowsOptions {
  /** Distancia maxima em `y` para dois runs caírem na mesma linha. Default 2pt. */
  yTolerance?: number;
  /**
   * Faixas de `x` (`[minX, maxX)`), para separar tabelas que dividem a mesma `y`
   * (caso do Santander). Declaradas pelo parser do banco, que e quem conhece a
   * geometria. Sem esta opcao, o grupo de `y` inteiro vira uma unica
   * `PdfTextRow` — o comportamento default, que nao muda para o Nubank.
   *
   * As faixas sao aplicadas em ordem crescente de `minX`; celulas fora de todas
   * elas viram uma linha de "resto", nunca sao descartadas.
   */
  xBands?: readonly (readonly [number, number])[];
}

/** CONTRACTS §15: tolerancia default de 2pt entre bases da mesma linha. */
const DEFAULT_Y_TOLERANCE = 2;

/** Junta espacos repetidos e apara as pontas do texto montado. */
function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** `y` representativo do grupo: media das bases dos runs. */
function meanY(group: PdfTextItem[]): number {
  return group.reduce((sum, item) => sum + item.y, 0) / group.length;
}

/**
 * Constroi a linha a partir dos runs dados: celulas ordenadas por `x` e `text`
 * unido por espaco. Runs so de espaco nao viram celula.
 */
function buildRow(page: number, y: number, items: PdfTextItem[]): PdfTextRow {
  const cells = items
    .map((item) => ({ x: item.x, text: item.text.trim() }))
    .filter((cell) => cell.text !== '')
    .sort((a, b) => a.x - b.x);

  return {
    page,
    y,
    cells,
    text: collapseSpaces(cells.map((cell) => cell.text).join(' ')),
  };
}

/**
 * Agrupa os runs em linhas por coordenada.
 *
 * Dentro de cada pagina os runs sao ordenados por `y` decrescente e `x`
 * crescente, e um run entra na linha corrente enquanto a distancia vertical ate
 * a base dessa linha couber na tolerancia. Empate de `y` em paginas diferentes
 * nao mistura as linhas.
 *
 * Com `xBands`, o grupo de `y` e cortado nas faixas de `x` declaradas (ver a
 * secao sobre o Santander no topo do arquivo) e cada faixa vira uma linha.
 *
 * ```ts
 * const rows = groupIntoRows(items);            // tolerancia 2pt
 * const rows = groupIntoRows(items, { yTolerance: 4 });
 * // Santander: duas tabelas nas mesmas y
 * const rows = groupIntoRows(items, { xBands: [[0, 250], [320, 595]] });
 * ```
 */
export function groupIntoRows(
  items: PdfTextItem[],
  opts?: GroupIntoRowsOptions,
): PdfTextRow[] {
  const tolerance = Math.max(0, opts?.yTolerance ?? DEFAULT_Y_TOLERANCE);
  // Ordem crescente de `minX` garante saida da esquerda para a direita mesmo que
  // o chamador declare as faixas fora de ordem.
  const bands = [...(opts?.xBands ?? [])].sort((a, b) => a[0] - b[0]);

  const byPage = new Map<number, PdfTextItem[]>();
  for (const item of items) {
    const bucket = byPage.get(item.page);
    if (bucket === undefined) {
      byPage.set(item.page, [item]);
    } else {
      bucket.push(item);
    }
  }

  const rows: PdfTextRow[] = [];
  const pages = [...byPage.keys()].sort((a, b) => a - b);
  for (const page of pages) {
    // `?? []` so por causa de noUncheckedIndexedAccess; `page` veio das chaves.
    const pageItems = [...(byPage.get(page) ?? [])].sort(
      (a, b) => b.y - a.y || a.x - b.x,
    );

    let group: PdfTextItem[] = [];
    let groupY: number | null = null;
    const flush = (): void => {
      if (group.length === 0) return;
      const y = meanY(group);

      if (bands.length === 0) {
        const row = buildRow(page, y, group);
        if (row.cells.length > 0) rows.push(row);
        group = [];
        return;
      }

      const placed = new Set<PdfTextItem>();
      const segmentRows: PdfTextRow[] = [];
      for (const band of bands) {
        const inBand = group.filter(
          (item) => item.x >= band[0] && item.x < band[1],
        );
        for (const item of inBand) placed.add(item);
        const row = buildRow(page, y, inBand);
        if (row.cells.length > 0) segmentRows.push(row);
      }
      // Fora de todas as faixas: linha propria, nunca descartada.
      const rest = buildRow(
        page,
        y,
        group.filter((item) => !placed.has(item)),
      );
      if (rest.cells.length > 0) segmentRows.push(rest);

      segmentRows.sort((a, b) => (a.cells[0]?.x ?? 0) - (b.cells[0]?.x ?? 0));
      rows.push(...segmentRows);
      group = [];
    };

    for (const item of pageItems) {
      if (groupY === null || Math.abs(item.y - groupY) <= tolerance) {
        if (groupY === null) groupY = item.y;
        group.push(item);
      } else {
        flush();
        groupY = item.y;
        group.push(item);
      }
    }
    flush();
  }

  return rows;
}
