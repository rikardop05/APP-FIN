import { describe, expect, it } from 'vitest';

import type { PdfTextItem } from '@/lib/import/pdf/extract';
import { extractPdfTextItems } from '@/lib/import/pdf/extract';
import { groupIntoRows } from '@/lib/import/pdf/rows';
import { buildPositionedPdf } from '@/lib/import/pdf/__fixtures__/synthetic-pdf';

function item(page: number, x: number, y: number, text: string): PdfTextItem {
  return { page, x, y, width: text.length * 5, text };
}

describe('groupIntoRows — remontagem por coordenada (RF-IMP-12)', () => {
  it('agrupa por y dentro da tolerancia e ordena as linhas de cima para baixo', () => {
    const rows = groupIntoRows([
      item(1, 30, 680, 'segunda linha'),
      item(1, 30, 700.5, 'primeira A'),
      item(1, 120, 700, 'primeira B'),
      item(1, 200, 699.8, 'primeira C'),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.text).toBe('primeira A primeira B primeira C');
    expect(rows[1]?.text).toBe('segunda linha');
  });

  it('ordena as celulas por x, nao pela ordem do stream', () => {
    const rows = groupIntoRows([
      item(1, 400, 500, 'R$ 154,32'),
      item(1, 30, 500, '22/08'),
      item(1, 120, 500, 'MERCADO CENTRAL'),
    ]);

    expect(rows[0]?.cells.map((cell) => cell.text)).toEqual([
      '22/08',
      'MERCADO CENTRAL',
      'R$ 154,32',
    ]);
    expect(rows[0]?.text).toBe('22/08 MERCADO CENTRAL R$ 154,32');
  });

  it('separa linhas quando a distancia vertical excede a tolerancia', () => {
    const rows = groupIntoRows([
      item(1, 30, 700, 'linha 1'),
      item(1, 30, 697, 'linha 2'),
    ]);
    expect(rows.map((row) => row.text)).toEqual(['linha 1', 'linha 2']);
  });

  it('respeita tolerancia customizada', () => {
    const items = [item(1, 30, 700, 'acima'), item(1, 30, 703, 'abaixo')];

    expect(groupIntoRows(items, { yTolerance: 2 })).toHaveLength(2);
    expect(groupIntoRows(items, { yTolerance: 3 })).toHaveLength(1);
  });

  it('nao mistura paginas diferentes com o mesmo y', () => {
    const rows = groupIntoRows([
      item(1, 30, 700, 'pagina 1'),
      item(2, 30, 700, 'pagina 2'),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.page)).toEqual([1, 2]);
    expect(rows.map((row) => row.text)).toEqual(['pagina 1', 'pagina 2']);
  });

  it('descarta runs vazios ou so de espaco', () => {
    const rows = groupIntoRows([
      item(1, 30, 700, 'data'),
      item(1, 40, 700, '   '),
      item(1, 50, 700, 'valor'),
    ]);

    expect(rows[0]?.cells).toHaveLength(2);
    expect(rows[0]?.text).toBe('data valor');
  });

  it('lista vazia devolve lista vazia', () => {
    expect(groupIntoRows([])).toEqual([]);
  });

  it('remonta uma linha a partir de muitos runs separados (caso Santander)', () => {
    // Cada celula e um run; juntos formam uma unica linha de data+descricao+valor.
    const runs: PdfTextItem[] = [
      item(1, 470, 612.4, '1.234,56'),
      item(1, 24.1, 612.1, '22/08'),
      item(1, 96.7, 612.6, 'SUPERMERCADO'),
      item(1, 170.2, 612.3, 'BOM'),
      item(1, 196.9, 612.5, 'PRECO'),
      item(1, 452.3, 612.2, 'R$'),
    ];

    const rows = groupIntoRows(runs);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toBe('22/08 SUPERMERCADO BOM PRECO R$ 1.234,56');
    expect(rows[0]?.cells).toHaveLength(6);
  });
});

/**
 * Caso real do Santander (IMPORT-SOURCES §8): lancamentos em x<250 e um
 * quadro-resumo em x>320 dividem as mesmas `y`. Sem `xBands`, o `text` das duas
 * tabelas sai colado; com `xBands`, cada faixa vira uma linha propria e limpa.
 */
describe('groupIntoRows — duas tabelas na mesma y (Santander, §8)', () => {
  const duasTabelas: PdfTextItem[] = [
    item(1, 33, 425, '22/08 SUPERMERCADO ANONIMO'),
    item(1, 205, 425, '154,32'),
    item(1, 350, 425, '(-) LIMITE DISPONIVEL'),
    item(1, 430, 425, '1.000,00'),
  ];
  const santanderBands = [[0, 250], [320, 595]] as const;

  it('sem xBands, as duas tabelas viram uma linha com text contaminado', () => {
    const rows = groupIntoRows(duasTabelas);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toBe(
      '22/08 SUPERMERCADO ANONIMO 154,32 (-) LIMITE DISPONIVEL 1.000,00',
    );
  });

  it('com xBands, cada tabela vira sua PdfTextRow com text limpo', () => {
    const rows = groupIntoRows(duasTabelas, { xBands: santanderBands });

    expect(rows).toHaveLength(2);
    expect(rows[0]?.text).toBe('22/08 SUPERMERCADO ANONIMO 154,32');
    expect(rows[0]?.cells.map((cell) => cell.x)).toEqual([33, 205]);
    expect(rows[1]?.text).toBe('(-) LIMITE DISPONIVEL 1.000,00');
    expect(rows[1]?.cells.map((cell) => cell.x)).toEqual([350, 430]);
  });

  it('celulas fora de todas as faixas viram linha propria, na ordem de x', () => {
    const rows = groupIntoRows(
      [
        item(1, 33, 425, 'COMPRA'),
        item(1, 300, 425, 'FORA DAS FAIXAS'),
        item(1, 400, 425, 'RESUMO'),
      ],
      { xBands: santanderBands },
    );

    expect(rows.map((row) => row.text)).toEqual([
      'COMPRA',
      'FORA DAS FAIXAS',
      'RESUMO',
    ]);
  });

  it('ordena as faixas por minX mesmo declaradas fora de ordem', () => {
    const rows = groupIntoRows(duasTabelas, {
      xBands: [
        [320, 595],
        [0, 250],
      ],
    });
    expect(rows.map((row) => row.text)).toEqual([
      '22/08 SUPERMERCADO ANONIMO 154,32',
      '(-) LIMITE DISPONIVEL 1.000,00',
    ]);
  });

  it('nao altera o caso de uma tabela so (default do Nubank)', () => {
    const nubankRow: PdfTextItem[] = [
      item(1, 123, 700, '15 SET'),
      item(1, 185, 700, 'PADARIA ANONIMA'),
      item(1, 496, 700, 'R$ 20,00'),
    ];
    const rows = groupIntoRows(nubankRow);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toBe('15 SET PADARIA ANONIMA R$ 20,00');
  });
});

describe('groupIntoRows — ponta a ponta com fixture de duas tabelas', () => {
  it('extrai e separa duas tabelas na mesma y a partir do PDF sintetico', async () => {
    // Geometria do Santander: lancamentos x<250, resumo x>320, mesma y.
    const bytes = buildPositionedPdf([
      { x: 33, y: 425, text: '22/08 SUPERMERCADO ANONIMO' },
      { x: 205, y: 425, text: '154,32' },
      { x: 350, y: 425, text: '(-) LIMITE DISPONIVEL' },
      { x: 430, y: 425, text: '1.000,00' },
    ]);

    const items = await extractPdfTextItems(bytes);
    expect(groupIntoRows(items)).toHaveLength(1);

    const rows = groupIntoRows(items, {
      xBands: [
        [0, 250],
        [320, 595],
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.text).toBe('22/08 SUPERMERCADO ANONIMO 154,32');
    expect(rows[1]?.text).toBe('(-) LIMITE DISPONIVEL 1.000,00');
  });
});
